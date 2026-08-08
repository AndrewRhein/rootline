// POST /api/process-transcript
//
// Stateless by design: takes a transcript plus a snapshot of the graph the
// client already has in memory, runs a Claude tool-use loop against the
// fixed action vocabulary in api/lib/claude-tools.js, and returns the list
// of proposed actions. It does NOT touch the database and does NOT mutate
// anything — the client applies each action with the exact same
// addPerson/editPersonFields/TIES.push/etc. logic a human-driven form
// submit uses (see applyAiAction() in index.html), then persists the
// result through the normal PUT /api/graph snapshot save.
//
// Why stateless: the graph-mutation logic (parent/child bookkeeping,
// CHILDREN_OF index maintenance, tier derivation) already exists once, in
// the client, battle-tested. Reimplementing it here in Node would mean two
// copies of that logic drifting apart. This endpoint's only job is
// language understanding: turn a transcript into a small set of structured
// actions.
const Anthropic = require("@anthropic-ai/sdk");
const { ACTION_TOOLS } = require("./lib/claude-tools");
const { requireAuth } = require("./lib/auth");

const MODEL = "claude-opus-5";
const MAX_ITERATIONS = 6;

module.exports = async function handler(req, res) {
  if (!requireAuth(req, res)) return;
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const { transcript, people, stories, recorderId, recorderName } = req.body || {};
  if (!transcript || typeof transcript !== "string" || !transcript.trim()) {
    return res.status(400).json({ error: "invalid_request", message: "transcript is required" });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: "server_misconfigured", message: "ANTHROPIC_API_KEY is not set." });
  }

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const peopleList = Object.keys(people || {})
      .map((id) => {
        const p = people[id];
        return `- ${id}: ${p.name}${p.years ? " (" + p.years + ")" : ""}${p.gender ? " [" + p.gender + "]" : ""}`;
      })
      .join("\n");

    const storiesList = (stories || [])
      .map((s) => `- ${s.id}: "${s.title}"${s.date ? " (" + s.date + ")" : ""}`)
      .join("\n");

    const systemPrompt = [
      "You are the archivist for a private family history app called Rootline. Your job is to read a transcript of a recorded conversation (usually one family member interviewing an older relative) and turn it into structured updates to the family archive, using only the tools provided.",
      "",
      "Ground rules:",
      "- Never invent people, dates, or facts that aren't supported by the transcript. If something is ambiguous, prefer to skip it or record it more generally rather than guessing specifics.",
      "- Always check the existing people list before creating someone new — match on name, accounting for nicknames, shortened names, and clear misspellings. Never create a duplicate of someone already on record.",
      "- Use add_story generously — the whole point of recording these conversations is capturing anecdotes that would otherwise be lost. Don't limit yourself to 'major' events.",
      "- Do not ask questions or produce commentary — only call tools. If you have nothing to add, simply stop without calling any tools.",
      "- When you're done proposing actions, stop calling tools and the turn will end naturally.",
      "",
      "Existing people in the archive:",
      peopleList || "(none yet)",
      "",
      "Existing stories already on the timeline:",
      storiesList || "(none yet)",
      recorderName ? `\nThis recording was made by ${recorderName}.` : "",
    ].join("\n");

    const messages = [
      { role: "user", content: "Here is the transcript:\n\n" + transcript },
    ];

    const proposedActions = [];
    let iterations = 0;
    let finalMessage = null;

    while (iterations < MAX_ITERATIONS) {
      iterations++;
      const stream = client.messages.stream({
        model: MODEL,
        max_tokens: 8000,
        system: systemPrompt,
        thinking: { type: "adaptive" },
        output_config: { effort: "medium" },
        tools: ACTION_TOOLS,
        messages,
      });
      finalMessage = await stream.finalMessage();

      const toolUseBlocks = finalMessage.content.filter((b) => b.type === "tool_use");
      toolUseBlocks.forEach((b) => {
        proposedActions.push({ type: b.name, input: b.input, id: b.id });
      });

      if (finalMessage.stop_reason !== "tool_use") break;

      // Feed back a lightweight acknowledgement for each tool call so the
      // loop can continue (e.g. Claude wants to create a person, then
      // reference that new person in a later add_story call in the same
      // pass). We're not actually executing anything server-side, so the
      // "result" is just a receipt.
      messages.push({ role: "assistant", content: finalMessage.content });
      messages.push({
        role: "user",
        content: toolUseBlocks.map((b) => ({
          type: "tool_result",
          tool_use_id: b.id,
          content: "Recorded. Continue if there's more to extract, or stop if you're done.",
        })),
      });
    }

    return res.status(200).json({
      ok: true,
      actions: proposedActions,
      model: MODEL,
    });
  } catch (err) {
    console.error("POST /api/process-transcript failed", err);
    return res.status(500).json({ error: "server_error", message: err.message });
  }
};
