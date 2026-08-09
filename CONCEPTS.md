# BrainBar Concepts

## Purpose

This file defines BrainBar's project vocabulary so humans and coding agents use the same names for the same ideas.

It is intentionally lightweight, public-safe, and operational. It should prevent parallel names from appearing in code, docs, issues, or agent-generated plans.

BrainBar is a local-first macOS control center for a Markdown or Obsidian-style vault with Graphify-generated graph output. It does not own the user's vault, rewrite generated Graphify files, or define private workflow semantics.

## Product Concepts

- **BrainBar**: the native macOS menu bar app in this repository.
- **Vault**: a user-configured local folder containing Markdown, Obsidian, or other Graphify-compatible source content. Use generic examples such as `local vault`; do not hardcode private paths.
- **Graphify**: the external graph generator BrainBar expects users to install separately. BrainBar runs a configured Graphify command and embeds Graphify output; it does not vendor, fork, or modify Graphify.
- **Graphify output**: the generated files BrainBar reads, usually `graphify-out/graph.html`, `graphify-out/graph.json`, and `graphify-out/GRAPH_REPORT.md`.
- **Menu bar popover**: the compact BrainBar surface opened from the macOS menu bar.
- **Focus Window**: the larger native BrainBar window for graph exploration and longer inspection.
- **2D Workbench**: the stable embedded Graphify/vis-network graph view used for operational inspection: graph checks, focus subgraphs, community detail, edge inspection, and bridge actions into 3D. BrainBar injects this runtime layer without rewriting Graphify output.
- **3D Explorer**: the BrainBar-owned 3D graph explorer in the Focus Window. It reads the same local graph metadata as 2D but renders through bundled 3D/canvas resources.
- **Source Lens**: the session-only graph edge filter for `All`, `Graphify`, and `Wikilinks`.
- **Review Queue**: a generic local status panel for configured queue or preflight commands. BrainBar displays command output and optional manual actions; it is not the worker.
- **Brain Check**: a configurable local command hook for the user's own vault validation script or CLI. BrainBar does not define what the check means.
- **Graph Check**: a read-only graph maintenance view inside the 2D runtime. It highlights graph-derived signals such as notes needing links, key notes, disconnected groups, and stale key notes when timestamps are available.
- **System Status**: the native app panel that checks local setup state such as vault path, graph file, Graphify command, Git state, Review Queue, and Brain Check configuration.
- **Agent Activity**: metadata-only local file and agent event observability. It shows what local tools or agents touched graph-relevant paths without storing note contents, prompts, transcripts, secrets, stdout/stderr, or build artifacts.
- **Agent Activity source**: a local tool or agent that emits metadata-only `brainbar-trace` events. Codex and Claude are shipped activity sources; future integrations such as Hermes should start at this same level.
- **Agent Workflows**: a planned grouping layer over Agent Activity events that explains what work is happening across multiple reads, writes, focus changes, closeouts, decisions, and pending graph refreshes. It is not an automation engine.
- **Workflow projection**: read-only interpretation of activity metadata as a unit of work with source trail, output trail, status, pending graph refresh, and next useful action.
- **Runtime control**: starting, scheduling, or commanding an agent from BrainBar. This is not part of Agent Activity or the first Agent Workflows slice.
- **Hermes Agent**: a future integration direction for graph-aware, memory-aware local work. Hermes is not a shipped BrainBar integration yet. It should first be treated as an Agent Activity source; it becomes workflow-native only if it exposes stable run metadata such as session id, workflow id, intent, status, source paths, and output paths.
- **Hermes SOUL**: Hermes' global identity/persona layer, usually `SOUL.md` under `HERMES_HOME`. It is not project context, not vault memory, and not a BrainBar integration target.
- **Hermes Memory**: Hermes' internal persistent memory/profile layer, including `MEMORY.md` and `USER.md`. BrainBar should not ingest, sync, display, or treat it as graph data.
- **Hermes Vault Skill**: a future BrainBar-managed or documented Hermes skill that teaches Hermes how to read/write a local vault safely and emit metadata-only BrainBar trace events. It should live as a skill or project context instruction, not in `SOUL.md`.

## User-Facing Terms

- **All**: show every visible graph edge for the current graph mode.
- **Graphify**: show generated Graphify relationships and hide exported wikilinks.
- **Wikilinks**: show wikilinks exported in Graphify metadata. This is the public label for the internal `obsidian` source lens raw value.
- **Open Note**: open the selected node's backing local source file through BrainBar's vault-safe path resolution.
- **Needs Links**: notes with no graph connections in the current graph data.
- **Key Notes**: unusually connected notes. They often act as indexes, protocols, dashboards, or central concepts. Avoid calling this user-facing view `Hubs`.
- **Review**: graph-targeted Review Queue items. Items need `source_file` or `node_id` to appear in this view.
- **Recent**: recently changed or date-named notes. It uses file modification time when available, otherwise dates found in node labels or paths.
- **Groups**: 2D Workbench view for visible communities, top notes, and bridge notes. Use `Community Spotlight` for the 3D version.
- **Graph Check**: the readable, user-facing name for graph health diagnostics.
- **Focus**: in 3D, focus the selected node and dim surrounding graph context. In 2D Workbench, focus creates a temporary runtime-only subgraph layout around the selected note and restores the Graphify layout when returning to global.
- **Depth 1 / Depth 2 / Depth 3**: expand the 3D focus orbit by BFS depth from the selected node.
- **Search Reveal**: search as navigation rather than filtering. In 3D it flies to a visible result and can complete a pending path target; in 2D Workbench it centers a visible result, exposes nearby notes, and offers bridge actions into 3D.
- **Start path**: arm the selected node as the source for a 3D shortest path trace. The user then clicks another node to trace the route.
- **Shortest path**: the shortest visible unweighted path between two selected nodes in the current 3D graph view.
- **Explain Path**: a deterministic, local-only explanation of a 3D shortest path using visible graph metadata such as edge provenance, communities, labels, and bridge nodes.
- **Path Compare**: a 3D path panel control for comparing deterministic route variants between the same selected source and target.
- **Best explained path**: a Path Compare variant that prefers routes with clearer Wikilink or Graphify metadata. It is still deterministic graph analysis, not semantic proof.
- **Community Spotlight**: a 3D runtime view that highlights one visible community, dims surrounding context, and lists top notes plus bridge notes.
- **Recent Orbit**: a 3D runtime view for recently changed or date-named notes. It highlights recent notes and traces one active recent note to its nearest visible key note when a path exists.
- **Graph Story**: a 3D runtime guided tour through deterministic graph signals such as recent notes, key notes, large communities, bridge notes, and needs-attention areas. It presents each step as a compact narrative card with a primary note and a short takeaway.
- **Living Graph Polish**: 3D visual responsiveness such as signal-flow edge currents, coordinated community breathing, recent-note warmth, and action response pulses. It is polish over the current runtime state, not a separate graph mode.
- **Agent Activity**: visible recent file or agent events mapped to graph nodes when possible. It is event-level observability.
- **Agent Workflow**: a readable unit of agent work built from one or more Agent Activity events. It should summarize intent, touched files, source trail, pending refresh, status, and next useful action.

## Internal Architecture Terms

- **`GraphSourceLens`**: Swift enum with raw values `all`, `graphify`, and `obsidian`. Keep `obsidian` as the compatibility raw value, but use `Wikilinks` as the public label.
- **`GraphViewMode`**: Swift enum for `2D` and `3D` Focus Window modes.
- **`GraphWebView`**: Swift WebKit bridge for the stable 2D Workbench. It loads generated `graph.html`, injects BrainBar runtime JS/CSS, applies Source Lens state, sends node/edge/community actions, and forwards Review Queue graph targets.
- **`Graph3DWebView`**: Swift WebKit bridge for the 3D renderer. It serves bundled `Graph3D` resources through the `brainbar3d://` scheme and injects local `graph.json` data.
- **2D runtime**: `BrainBar/Resources/Graph2D/brainbar-graph-runtime.js`. It augments generated Graphify HTML at runtime and must not rewrite `graph.html`.
- **3D runtime**: `BrainBar/Resources/Graph3D/graph3d.js`. It owns the 3D explorer's session state, rendering, focus orbit, path mode, and sidebar behavior.
- **Path utilities**: `BrainBar/Resources/Graph3D/graph3d-path-utils.mjs`. It contains reusable 3D path logic such as unweighted shortest-path BFS.
- **Path variants**: runtime-only 3D path results for `Shortest visible`, `Different route`, `Best explained`, `Wikilinks only`, and `Graphify only`.
- **Community spotlight state**: runtime-only 3D state for the selected community, highlighted node ids, highlighted edge ids, top notes, and bridge notes.
- **Recent orbit state**: runtime-only 3D state for recent node ids, active recent node, nearest key-note target, and the active recent-to-key path.
- **Graph story state**: runtime-only 3D state for the active tour step, highlighted nodes/edges, active community, and current guided-tour message.
- **Search reveal state**: runtime-only 3D state for the revealed node, highlighted neighbor ids, and highlighted edge ids.
- **Edge provenance**: runtime classification for a connection as `Wikilink`, `Graphify`, or `Unknown`, based on Graphify metadata and exported wikilink data.
- **Review Queue status payload**: JSON printed by a configured local status command. Required shape includes `pending_count`; `items` are optional.
- **Review Queue graph targets**: optional item fields `source_file` and `node_id` used only to highlight matching graph nodes.
- **Agent Activity event**: metadata-only JSONL record, currently versioned independently of Graphify output and vault content.
- **Agent Workflow state**: future runtime grouping over recent Agent Activity events. Prefer explicit event ids such as `session_id`, `workflow_id`, and `workflow_title` when present and conservative inferred grouping only when needed.
- **Brain KG**: a generic term for a generated or advisory knowledge graph produced by a user's local vault workflow. In BrainBar docs, avoid treating it as a required product subsystem unless code/config explicitly wires it through local commands.

## Do Not Confuse

- **BrainBar is not Graphify.** BrainBar embeds and controls Graphify output; Graphify generates the graph.
- **BrainBar is not the vault.** It reads local files and opens source notes, but the vault remains user-owned.
- **2D Workbench is not 3D Explorer.** 2D is the stable embedded Graphify-powered operational surface. 3D Explorer is the BrainBar-owned renderer for spatial exploration.
- **Source Lens is not Graph View Mode.** Source Lens filters edge provenance. Graph View Mode switches between 2D and 3D.
- **Wikilinks is not a new raw value.** The internal raw value remains `obsidian`; the public label is `Wikilinks`.
- **Graph Check is not Brain Check.** Graph Check is built from graph data in the viewer. Brain Check is a configurable external command hook.
- **Review Queue is not an automation engine.** It displays local status and can run explicit manual actions; the background watcher only checks status.
- **Shortest path is not semantic proof.** It is an unweighted route through currently visible graph edges, not an AI explanation or claim of causality.
- **Explain Path is not AI reasoning.** It summarizes visible graph metadata conservatively and should not invent meaning beyond the current path data.
- **Best explained is not most true.** It prefers available connection metadata and should not be described as the only meaningful path.
- **Recent Orbit is not project detection.** It ranks visible recent notes by local metadata or date-like labels and uses visible degree for key notes.
- **Graph Story is not AI narration.** It is a deterministic narrative tour over visible graph signals and should skip unavailable categories instead of inventing interpretation.
- **Search Reveal is not a graph filter.** It searches currently visible nodes, moves attention to one result, and leaves the graph context present.
- **Living Graph Polish is not a new feature mode.** It should not add new UI, move nodes geometrically, or change graph data; it only makes the existing 3D graph feel more responsive.
- **3D Explorer is still local graph visualization, not AI interpretation.** Keep language conservative unless product docs and QA criteria change.
- **Agent Activity is not Agent Workflows.** Activity is event-level observability; workflows are grouped units of work over those events.
- **Agent Workflows are not an automation engine.** They should not imply BrainBar starts or controls agents unless a concrete local command/API explicitly does that.
- **Agent Activity sources are not workflow actors by default.** Codex, Claude, and future Hermes tracing can all emit events without implying workflow state.
- **Workflow projection is not runtime control.** Projected workflows are read-only graph overlays until a separate product decision adds explicit commands.
- **Hermes Agent is not shipped.** Codex and Claude are current event-source integrations. Hermes is a future direction that should start as an activity source and become workflow-native only after concrete metadata exists.
- **Hermes SOUL is not vault instructions.** Do not install BrainBar/Vault workflow rules into `SOUL.md`; use a Hermes skill or project context file instead.
- **Hermes Memory is not BrainBar memory.** Do not imply BrainBar syncs, ingests, or writes Hermes `MEMORY.md`/`USER.md`; BrainBar should visualize only declared metadata paths and events.
- **Hermes Vault Skill is not runtime control.** A skill can teach Hermes how to operate the vault, but BrainBar still does not start, schedule, or command Hermes runs.
- **Brain KG is not a public dependency.** Treat it as optional local/generated context unless a concrete integration is present.

## Agent Rules

- Read this file before renaming product concepts, changing graph terminology, or writing public-facing BrainBar docs.
- Prefer the user-facing names in this file for UI copy and docs.
- Preserve existing compatibility raw values such as `GraphSourceLens.obsidian` unless the user explicitly asks for a migration.
- Do not add alternate labels such as `Obsidian Lens`, `Hub View`, `Health`, `Queue`, or `3D Main` unless the product vocabulary is intentionally updated here first.
- Keep docs public-safe: no personal vault paths, private note names, credentials, local screenshots with private content, or machine-specific assumptions.
- Do not imply BrainBar writes to the vault unless code explicitly does so. Current graph views and lenses are runtime/session-only.
- When adding features, update this file if the feature introduces a durable concept users or agents must reuse.

## Open Terms To Clarify

- Whether `3D Explorer` should remain the durable user-facing name or become plain `3D` in all docs.
- Whether `Brain Check` should remain a generic hook or gain an official default contract.
- Whether `Graph Check` findings should stay read-only or eventually become guided workflows.
- Whether `Brain KG` should stay an external/local workflow term or become a documented BrainBar integration point.
- Whether `Review Queue` should keep its generic name or split into more specific public workflows later.
- Whether Agent Workflows should require explicit workflow/session ids or infer short sessions from recent metadata-only events.
- Whether BrainBar should install a Hermes Vault Skill, a project `.hermes.md`/`AGENTS.md` block, or both.
- Whether future Hermes Agent workflow metadata should use the existing Agent Activity JSONL stream, optional `brainbar-trace` fields, a separate local run-state file, or a future local service API.
