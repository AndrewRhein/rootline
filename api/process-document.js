// POST /api/process-document
//
// The document/photo counterpart to /api/process-transcript.js — same
// design (stateless, same fixed action vocabulary, no DB writes here), but
// the input is a file (a PDF letter, a scanned certificate, a photographed
// document) instead of a transcript. Claude reads the file directly via a
// document or image content block and proposes the same kind of actions:
// new people, corrected details, new relationships, new stories.
//
// This is what closes the other half of "record conversations AND upload
// documents, and the AI catalogs both" — recordings go through
// process-transcript.js, files go through here. Plain-text (.txt) uploads
// don't need this endpoint at all — the client decodes them and sends them
// straight to process-transcript.js as if they were a transcript, since
// they're already just text.
const Anthropic = require("@anthropic-ai/sdk");
const { ACTION_TOOLS } = require("./lib/claude-tools");
const { requireAuth } = require("./lib/auth");

const MODEL = "claude-opus-5";
const MAX_ITERATIONS = 6;
const SUPPORTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];

module.exports = async function handler(req, res) {
  if (!requireAuth(req, res)) return;
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const { dataBase64, contentType, caption, meta, people, stories } = req.body || {};
  if (!dataBase64 || typeof dataBase64 !== "string") {
    return res.status(400).json({ error: "invalid_request", message: "dataBase64 is required" });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: "server_misconfigured", message: "ANTHROPIC_API_KEY is not set." });
  }

  var isPdf = contentType === "application/pdf";
  var isImage = SUPPORTED_IMAGE_TYPES.indexOf(contentType) > -1;
  if (!isPdf && !isImage) {
    // Word docs and anything else Claude can't read directly — the file is
    // still saved by the normal upload flow, it just isn't auto-catalogued.
    return res.status(200).json({ ok: true, actions: [], skipped: true, reason: "unsupported_file_type" });
  }

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const commaIdx = dataBase64.indexOf(",");
    const rawBase64 = commaIdx > -1 ? dataBase64.slice(commaIdx + 1) : dataBase64;

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
      "You are the archivist for a private family history app called Rootline. You've just been given a document or photo someone uploaded to the family archive — it might be a letter, a certificate, a scanned record, an old document, or just a family photo. Your job is to look at it and, only if it actually contains information worth recording, propose updates to the family archive using the tools provided.",
      "",
      "Ground rules:",
      "- Most uploads are just photographs of people with no extractable facts beyond what's already in the caption — if that's what this is, call no tools at all. Don't force a find.",
      "- Only propose an action when the file itself clearly supports it (a name, date, or relationship that's actually written or shown in the document) — never guess or infer beyond what's visible.",
      "- Always check the existing people list before creating someone new — match on name, accounting for nicknames, shortened names, and clear misspellings.",
      "- Do not ask questions or produce commentary — only call tools, or call nothing at all.",
      "",
      caption ? `The uploader captioned this: "${caption}"` : "",
      meta ? `Additional context given: "${meta}"` : "",
      "",
      "Existing people in the archive:",
      peopleList || "(none yet)",
      "",
      "Existing stories already on the timeline:",
      storiesList || "(none yet)",
    ].join("\n");

    const fileBlock = isPdf
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: rawBase64 } }
      : { type: "image", source: { type: "base64", media_type: contentType, data: rawBase64 } };

    const messages = [
      {
        role: "user",
        content: [
          fileBlock,
          { type: "text", text: "Here is the uploaded file. Catalog anything it clearly supports, using the tools available — or call nothing if there's nothing to add." },
        ],
      },
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

      messages.push({ role: "assistant", content: finalMessage.content });
      messages.push({
        role: "user",
        content: toolUseBlocks.map((b) => ({
          type: "tool_result",
          tool_use_id: b.id,
          content: "Recorded. Continue if there's more to catalog, or stop if you're done.",
        })),
      });
    }

    return res.status(200).json({ ok: true, actions: proposedActions, model: MODEL });
  } catch (err) {
    console.error("POST /api/process-document failed", err);
    return res.status(500).json({ error: "server_error", message: err.message });
  }
};
