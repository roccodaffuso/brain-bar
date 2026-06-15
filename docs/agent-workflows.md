# BrainBar Agent Workflows

BrainBar already shows local file activity and metadata-only agent trace events. Agent Workflows define the next layer: grouping those events into understandable work, without turning BrainBar into an agent runner or storing private transcripts.

## Product Direction

BrainBar should become the local cockpit for graph-aware agent work:

- **Agent Activity** answers: what touched the graph?
- **Agent Workflows** answer: what work is happening across those touches?
- **Hermes Agent** is the future first-class workflow agent: graph-aware, memory-aware, and observable through BrainBar.

Codex and Claude remain integrations that can emit events. Hermes should not be just a third logo in the activity list; it should represent a deeper workflow layer with sessions, intent, progress, source trails, and proposed outcomes.

## Current Layer: Agent Activity

Agent Activity is event-level observability.

Inputs:

- local file activity observed by BrainBar;
- metadata-only `brainbar-trace` JSONL events;
- one-click Codex and Claude integration instructions.

Event examples:

- `read`
- `write`
- `create`
- `delete`
- `focus`
- `closeout`
- `decision`

The event contract must stay metadata-only: agent, action, path, timestamp, optional reason/status/session/project/source/node id. Never store note contents, prompts, raw transcripts, stdout/stderr, secrets, credentials, build artifacts, dependency caches, or temporary files.

## Next Layer: Agent Workflows

Agent Workflows group events into a visible unit of work.

A workflow is not an automation engine. It is a local, readable interpretation of event metadata:

- which agent is working;
- what local project or vault area it is touching;
- which nodes/files form the source trail;
- what status the work appears to be in;
- which paths are pending graph refresh;
- what user-facing action is useful next.

Initial workflow types should stay conservative:

- **Research trail**: read/focus events across related notes or source files.
- **Draft/update trail**: write/create/delete events around one output.
- **Closeout trail**: closeout or decision events tied to session/project notes.
- **Graph refresh trail**: new files or pending paths that need Graphify refresh.

## Hermes Agent Positioning

Hermes Agent should be a native BrainBar workflow participant, not just another event source.

Hermes should eventually expose:

- active run intent, such as `Close loop`, `Prepare decision`, or `Map context`;
- source trail as graph nodes and paths;
- proposed writes before they happen when possible;
- decision or closeout artifacts as explicit workflow outputs;
- confidence/caveats based on available local context;
- graph refresh needs after creating or moving files.

BrainBar should show Hermes work as a visible workflow over the graph:

- active source nodes;
- touched files;
- generated or pending nodes;
- path from source context to output;
- final artifact and next action.

## UI Principles

- Keep the graph first. Workflows should highlight the graph, not replace it with a task dashboard.
- Show state before spectacle: active, pending, complete, blocked.
- Prefer short readable trails over long raw logs.
- Show Codex and Claude as event sources; show Hermes as a workflow actor when the workflow model exists.
- Make pending graph refresh obvious when new files are not in `graph.json` yet.
- Keep every workflow local-first, metadata-only, and explainable from visible events.

## Non-Goals

- No remote AI calls from BrainBar.
- No raw transcript storage.
- No note content storage inside Agent Activity events.
- No vault writes from BrainBar graph exploration.
- No hidden automation engine in the first workflow slice.
- No Hermes-specific private vault assumptions in public docs or code.

## First Implementation Slice

The first Agent Workflows implementation should build on existing Agent Activity:

1. Add a runtime workflow grouping layer over recent events.
2. Group by explicit `session_id` when present, otherwise by agent + project/path proximity + short time window.
3. Surface compact workflow cards in the 3D sidebar below Agent Activity.
4. Highlight touched nodes and pending paths without clearing Search, Path, Focus, Recent Orbit, Graph Story, or Community Spotlight.
5. Add a detail view for one workflow with source trail, touched files, pending refresh, and useful actions.

Hermes-specific UI should wait until there is a concrete Hermes event/source contract. Until then, use generic Agent Workflows terms and keep Hermes in product direction docs.

## Open Questions

- Should workflow grouping use only explicit `session_id` at first, or infer short local sessions from timestamps?
- Should `brainbar-trace` grow optional `workflow_id` and `workflow_title` fields, or should BrainBar derive workflows without changing the event schema?
- Should Hermes run state live in the existing JSONL stream, a separate local file, or a future local service API?
- Should completed workflows remain visible beyond the current two-minute live Agent Activity window?
- Should workflow actions be read-only first, or include explicit local commands later?
