// The fixed action vocabulary the AI is allowed to use to update the family
// archive. Every tool here maps 1:1 to a mutation the client already knows
// how to perform locally (addPerson, editPersonFields, TIES.push, a new
// timeline entry, ...) — see applyAiAction() in index.html. Keeping this
// vocabulary small and fixed (rather than letting the model invent
// arbitrary edits) is what lets the client apply AI-proposed actions with
// the same confidence as a human-driven form submit.

const ACTION_TOOLS = [
  {
    name: "create_person",
    description:
      "Add a new person to the family archive who was mentioned in the transcript but isn't in the archive yet. Always check the 'Existing people' list first — never create a person who's already there (match on name, accounting for nicknames/variants). Give every new person a temp_id you make up (e.g. 'new_1', 'new_2') so later tool calls in this same batch can reference them before they have a real id.",
    input_schema: {
      type: "object",
      properties: {
        temp_id: { type: "string", description: "A short id you invent for this person, unique within this batch, e.g. 'new_1'." },
        name: { type: "string", description: "Full name as best determined from context." },
        years: { type: "string", description: "Birth/death years if mentioned, formatted like '1959–' (alive) or '1938–2010' (deceased). Omit if unknown." },
        gender: { type: "string", enum: ["m", "f"], description: "Only set if clearly determinable from context (pronouns, relationship terms). Omit if unclear." },
        relation: {
          type: "string",
          enum: ["child", "spouse", "standalone"],
          description: "'child' if this person's parent(s) are known (set parent_ids), 'spouse' if they're the spouse of an existing/new person (set spouse_id), 'standalone' if their connection to the family isn't yet clear (e.g. a family friend, neighbor, doctor mentioned in passing).",
        },
        parent_ids: {
          type: "array",
          items: { type: "string" },
          description: "Existing person ids or temp_ids of this person's parent(s), one or two. Required when relation is 'child'.",
        },
        spouse_id: {
          type: "string",
          description: "Existing person id or temp_id of this person's spouse. Required when relation is 'spouse'.",
        },
      },
      required: ["temp_id", "name", "relation"],
    },
  },
  {
    name: "edit_person",
    description:
      "Correct or fill in a field on a person who already exists in the archive — e.g. the transcript reveals a birth year, death year, or full name that wasn't on record. Only call this when the transcript gives new or corrected information, not to restate what's already there.",
    input_schema: {
      type: "object",
      properties: {
        person_id: { type: "string", description: "Existing person id or a temp_id created earlier in this batch." },
        name: { type: "string", description: "Corrected/fuller name. Omit if unchanged." },
        years: { type: "string", description: "Corrected years string. Omit if unchanged." },
        gender: { type: "string", enum: ["m", "f"], description: "Omit if unchanged." },
      },
      required: ["person_id"],
    },
  },
  {
    name: "add_relationship",
    description:
      "Record a relationship between two people who both already exist in the archive (or were just created in this batch) but aren't yet linked — e.g. the transcript reveals two people already on record are married, or that someone already on record is actually the parent of someone else already on record.",
    input_schema: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["spouse", "parent"], description: "'spouse' links the two as married/partnered. 'parent' adds parent_id as a parent of person_id." },
        person_id: { type: "string", description: "Existing person id or temp_id." },
        related_person_id: { type: "string", description: "For type 'spouse': the other spouse. For type 'parent': the parent being added." },
      },
      required: ["type", "person_id", "related_person_id"],
    },
  },
  {
    name: "add_story",
    description:
      "Record a story, anecdote, or notable event from the transcript onto the timeline. Use this liberally — any concrete anecdote, event, place, or turning point worth remembering belongs here, not just 'major' life events. Write desc in the voice of a family history entry (a sentence or two), not a verbatim quote.",
    input_schema: {
      type: "object",
      properties: {
        date: { type: "string", description: "Year or rough date if mentioned/inferable, e.g. '1961' or 'Summer 1961'. Omit if truly unknown." },
        title: { type: "string", description: "Short title, e.g. 'Flood damages the diner'." },
        desc: { type: "string", description: "A sentence or two of narrative detail." },
        people_ids: { type: "array", items: { type: "string" }, description: "Existing person ids or temp_ids this story is about or involves." },
        tags: { type: "array", items: { type: "string" }, description: "Short lowercase tags, e.g. ['hardship'], ['courtship'], ['marriage']. Reuse tags already present in the archive's tag list when they fit." },
      },
      required: ["title", "desc", "people_ids"],
    },
  },
  {
    name: "edit_story",
    description: "Correct or add detail to a story that's already on the timeline (see 'Existing stories' in context) — matched by story_id.",
    input_schema: {
      type: "object",
      properties: {
        story_id: { type: "string" },
        date: { type: "string" },
        title: { type: "string" },
        desc: { type: "string" },
      },
      required: ["story_id"],
    },
  },
];

module.exports = { ACTION_TOOLS };
