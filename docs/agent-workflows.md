# BrainBar Agent Workflows

BrainBar already shows local file activity and metadata-only agent trace events. Agent Workflows define the next layer: grouping those events into understandable work, without turning BrainBar into an agent runner or storing private transcripts.

## Product Direction

BrainBar should become the local cockpit for graph-aware agent work:

- **Agent Activity** answers: what touched the graph?
- **Agent Workflows** answer: what work is happening across those touches?
- **Hermes Agent** is a strong future workflow candidate because it already has concepts for skills, memory, toolsets, scheduled work, terminals, gateways, and subagents.

Codex and Claude are shipped integrations that emit events today. Hermes should start the same way, as a metadata-only activity source. It becomes a deeper workflow participant only after BrainBar can observe concrete run metadata such as session id, workflow id, intent, status, source trail, output trail, and pending graph refreshes.

Hermes also has its own identity and memory system. BrainBar should respect that boundary: Hermes can use its internal memory and persona to decide how to work, but BrainBar should only visualize declared file paths, trace events, and Graphify graph data.

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

Hermes Activity should use this same event contract first. A Hermes event should not imply BrainBar started, controlled, or inspected a Hermes run.

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

## Hermes Capability Reality

Hermes Agent is not just another chat client, but BrainBar should still integrate it in stages.

Relevant documented capabilities:

- **Personality**: Hermes uses `SOUL.md` from `HERMES_HOME` as its global identity and tone. BrainBar should not install vault workflow rules into `SOUL.md`.
- **Skills**: Hermes can load reusable procedures from `~/.hermes/skills` and supports slash-command style workflows.
- **Memory**: Hermes maintains persistent local memory files such as `MEMORY.md` and `USER.md`; BrainBar should not sync, ingest, or render those memories directly.
- **Context files**: Hermes discovers project instructions such as `.hermes.md`, `HERMES.md`, `AGENTS.md`, and `CLAUDE.md` from the working directory. Vault-specific BrainBar/Hermes rules belong here or in a Hermes skill, not in `SOUL.md`.
- **Toolsets**: Hermes can use broad tool categories such as search, browser, terminal/file editing, messaging, media, orchestration, memory, scheduled tasks, and MCP.
- **Terminal backends**: Hermes can run work through local shells or isolated/remote environments such as Docker, SSH, Singularity, Modal, and Daytona.
- **Gateways**: Hermes can operate through messaging surfaces such as Telegram, Discord, Slack, WhatsApp, Signal, and email.
- **Scheduled work**: Hermes supports cron-like scheduled tasks, but BrainBar should not become the scheduler or hidden automation controller.
- **Subagents**: Hermes can decompose work across specialized agents, which makes workflow projection useful once events expose stable metadata.

Sources:

- [NousResearch/hermes-agent](https://github.com/nousresearch/hermes-agent)
- [Hermes tools and toolsets](https://hermes-agent.nousresearch.com/docs/user-guide/features/tools)
- [Hermes skills](https://hermes-agent.nousresearch.com/docs/user-guide/features/skills)
- [Hermes persistent memory](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory)
- [Hermes context files](https://hermes-agent.nousresearch.com/docs/user-guide/features/context-files)
- [Hermes personality and SOUL.md](https://hermes-agent.nousresearch.com/docs/user-guide/features/personality)

## Hermes Memory Boundaries

Hermes has several context layers. BrainBar should not flatten them into one graph memory.

| Layer | Hermes file/system | Purpose | BrainBar stance |
| --- | --- | --- | --- |
| Identity | `SOUL.md` | Global Hermes persona, voice, tone, and communication defaults. | Never install vault workflow rules here. Do not read, sync, or display it. |
| Internal memory | `MEMORY.md`, `USER.md` | Hermes' persistent preferences and operational memory. | Do not ingest or visualize directly. Hermes may use it privately while working. |
| Project/vault context | `.hermes.md`, `HERMES.md`, `AGENTS.md`, `CLAUDE.md` | Local project and vault instructions. | Good place for BrainBar/Vault rules when user-approved. |
| Hermes skill | future `brainbar-vault-operator` | Reusable procedure for reading/writing the vault and emitting trace events. | BrainBar can install/manage this skill in a future integration. |
| Activity events | `agent-events.jsonl` | Metadata-only observable read/write/focus/decision events. | BrainBar reads and visualizes these events. |
| Graph truth | `graphify-out/graph.json` | Official nodes and edges generated by Graphify. | BrainBar reads this as graph truth. |

The durable rule is:

```text
Hermes Memory helps Hermes.
Vault Markdown informs Graphify.
Graphify informs BrainBar.
brainbar-trace makes activity visible.
```

If Hermes uses internal memory to produce work, that memory remains internal. Durable shared knowledge should be written as normal vault Markdown and traced with metadata-only events. New files remain pending until Graphify adds them to `graph.json`.

## Hermes Integration Phases

### Phase 0: Hermes Activity Integration

Hermes first behaves like Codex and Claude:

- install or document a Hermes skill/context instruction that calls `brainbar-trace`;
- optionally install a BrainBar-managed Hermes Vault Skill such as `brainbar-vault-operator`;
- emit metadata-only events such as `read`, `write`, `create`, `delete`, `focus`, `closeout`, and `decision`;
- show a Hermes badge/icon in Agent Activity;
- map paths to Graphify nodes when possible and list pending paths when graph refresh is needed.

This phase should not add Hermes-specific workflow UI, edit `SOUL.md`, read Hermes Memory, or imply BrainBar can inspect Hermes internals.

### Phase 1: Hermes Workflow Projection

Once Hermes can emit or expose stable run metadata, BrainBar can group Hermes events into workflows:

- `session_id` or `workflow_id`;
- human workflow title or short intent;
- status such as active, pending, complete, blocked, or failed;
- source paths and output paths;
- pending graph refresh paths;
- optional caveat/status reason.

Workflow Projection is read-only. BrainBar interprets local metadata and highlights the graph; it does not run Hermes.

### Phase 2: Hermes Runtime Control

Runtime control is deferred.

BrainBar should not start Hermes runs, manage Hermes cron, call Hermes gateways, or issue remote commands until there is an explicit local command or API contract and a separate product decision. If this ever ships, it should be opt-in and clearly separate from Agent Activity and Workflow Projection.

## Hermes Positioning Decisions

Hermes is a future workflow-native direction, not a shipped workflow feature.

Decisions to preserve:

- Hermes v0 is not special: it emits events like Codex and Claude.
- Hermes becomes special only when BrainBar can observe reliable workflow metadata.
- Prefer optional fields on the existing JSONL event stream before adding a second run-state file or local service API.
- Hermes `SOUL.md` remains identity/persona, not a vault workflow instruction target.
- Hermes Memory remains separate from Brain, Graphify, and BrainBar. BrainBar visualizes declared paths and events only.
- Hermes Vault Skill rules belong in a skill or project context file, not in `SOUL.md` or direct memory sync.
- Graphify remains the source of graph truth. New Hermes output files stay pending until Graphify adds them to `graph.json`.

When the workflow contract exists, BrainBar should show Hermes work as a visible workflow over the graph:

- active source nodes;
- touched files;
- generated or pending nodes;
- path from source context to output;
- final artifact and next action.

## UI Principles

- Keep the graph first. Workflows should highlight the graph, not replace it with a task dashboard.
- Show state before spectacle: active, pending, complete, blocked.
- Prefer short readable trails over long raw logs.
- Show Codex, Claude, and Hermes as event sources until a workflow contract exists; show Hermes as a workflow actor only after that contract exists.
- Make pending graph refresh obvious when new files are not in `graph.json` yet.
- Keep every workflow local-first, metadata-only, and explainable from visible events.

## Non-Goals

- No remote AI calls from BrainBar.
- No raw transcript storage.
- No note content storage inside Agent Activity events.
- No vault writes from BrainBar graph exploration.
- No hidden automation engine in the first workflow slice.
- No Hermes-specific private vault assumptions in public docs or code.
- No direct Hermes runtime control in the documentation-only or first implementation slice.
- No direct sync from Hermes Memory into BrainBar, Brain, Graphify, or the vault.
- No BrainBar writes to Hermes `SOUL.md` unless a separate explicit product decision exists; vault operation rules should live in a skill or project context file instead.

## First Implementation Slice

The first Agent Workflows implementation should build on existing Agent Activity:

1. Add a runtime workflow grouping layer over recent events.
2. Group by explicit `session_id` when present, otherwise by agent + project/path proximity + short time window.
3. Surface compact workflow cards in the 3D sidebar below Agent Activity.
4. Highlight touched nodes and pending paths without clearing Search, Path, Focus, Recent Orbit, Graph Story, or Community Spotlight.
5. Add a detail view for one workflow with source trail, touched files, pending refresh, and useful actions.

Hermes-specific workflow UI should wait until there is a concrete Hermes event/source contract. A Hermes Activity badge can ship earlier if it uses the same metadata-only `brainbar-trace` path as Codex and Claude.

Hermes Vault Skill work can ship before full workflow projection if it stays behavioral and local:

1. Teach Hermes how to read project/vault context.
2. Teach Hermes when to create, update, or avoid vault notes.
3. Teach Hermes to emit `brainbar-trace` for meaningful reads, writes, focus changes, decisions, and closeouts.
4. Keep `SOUL.md`, `MEMORY.md`, and `USER.md` out of BrainBar's graph model.

## Open Questions

- Should workflow grouping use only explicit `session_id` at first, or infer short local sessions from timestamps?
- Should `brainbar-trace` grow optional `workflow_id` and `workflow_title` fields, or should BrainBar derive workflows without changing the event schema?
- Should future Hermes run state live in the existing JSONL stream, a separate local file, or a future local service API?
- Should BrainBar install a Hermes Vault Skill only, a project `.hermes.md` block, or both?
- Should BrainBar ever offer optional instructions for `SOUL.md`, or should it permanently avoid that layer?
- Should completed workflows remain visible beyond the current two-minute live Agent Activity window?
- What is the minimum stable metadata Hermes can emit before BrainBar should render Hermes as a workflow rather than simple activity?
