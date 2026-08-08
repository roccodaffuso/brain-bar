# BrainBar Innovation Plan

**Status:** Complete — Milestones 0 through 5 are implemented; Later Bets remain behind explicit decision gates.
**Updated:** 2026-08-08
**Public release baseline:** BrainBar v0.9.81 (`8bc670f`)
**Working branch evidence:** BrainBar v0.10.0 release-candidate worktree, including Milestones 0–5 and offline 2D closure

## Executive Summary

BrainBar should evolve from a graph viewer into a **local memory debugger**: a graph-first macOS workspace that can answer, within seconds:

- Where am I?
- What changed?
- Why are these items connected?
- What needs attention?
- What did local agents touch?
- What is the next safe action?

The recommended sequence is:

1. Establish measurement and reliability gates.
2. Make large graphs a first-class product constraint.
3. Improve setup, search, and continuity between 2D and 3D.
4. Add local change intelligence.
5. Project metadata-only agent events into readable workflows.
6. Add guided, reviewable maintenance actions.

This sequence deliberately prioritizes trust and daily usefulness over adding more showcase modes. BrainBar already ships advanced graph exploration; the next release arc should make that capability faster, more coherent, and easier to operate.

## Product Contract

The innovation plan preserves the current BrainBar contract:

- Markdown remains canonical.
- Graphify output remains the source of graph truth.
- BrainBar does not silently write to the vault.
- Graph exploration remains local and usable without cloud services.
- Agent Activity remains metadata-only.
- Deterministic evidence is preferred over opaque recommendations.
- New capabilities must preserve the graph as the primary surface.

It adds one scale invariant for all new renderer work: large graphs may use progressive presentation, but never silent data truncation.

BrainBar is not becoming a note editor, a generic AI chat sidebar, a cloud sync service, or a hidden agent runtime.

## Current Baseline

The public BrainBar v0.9.81 release already includes:

- 3D Search Reveal, Focus Orbit, Shortest Path, Explain Path, Path Compare, Community Spotlight, Recent Orbit, and Graph Story;
- a 2D Workbench with Source Lens, Graph Check, edge provenance, graph-health views, and bridges into 3D;
- metadata-only Agent Activity with Codex and Claude integrations;
- local workflow hooks, Review Queue integration, System Status, signed releases, and notarized DMGs.

The innovation plan must not repackage these shipped capabilities as new work.

The current release-candidate worktree builds on the unreleased Graphify discovery and startup fixes that first appeared after v0.9.81, then completes the bounded Milestone 0–5 slices documented below.

The 2026-08-07 decision not to vendor Vis.js was superseded by an explicit owner decision on 2026-08-08 after release-candidate testing confirmed that network loss made the existing 2D Workbench unusable. BrainBar now bundles the pinned Vis Network 9.1.6 UMD runtime with its MIT license and checksum, blocks Graphify's matching remote script, and lazily evaluates the local runtime at Graphify's first `vis` access. Offline 2D therefore works when Graphify provides `graph.html`; JSON-only output still uses the bundled 3D Focus renderer. A BrainBar-owned JSON-native 2D renderer remains deferred.

### Scale evidence

The real graph inspected while preparing this plan contains:

| Measure | Current value |
| --- | ---: |
| Nodes | 12,547 |
| Edges | 29,868 |
| `graph.json` size | 18,587,861 bytes |

Current architecture also exposes several scale risks:

- the graph-opening path reads, parses, normalizes, serializes, and injects the full JSON payload through a main-actor cache;
- the cache can retain up to six complete generated scripts;
- total 3D graph-ready time remains several seconds on stress graphs even after the event-loop layout work moved to a Worker;
- Agent Activity rescans tracked vault files every two seconds and rereads the JSONL event log;
- the 2D Workbench still depends on generated `graph.html` while 3D reads `graph.json` directly;
- CI runs on release tags, not as a pull-request performance and regression gate.

These findings are structural evidence, not yet a complete performance benchmark. Milestone 0 exists to measure them before approving hard numeric budgets.

## Roadmap Overview

| Milestone | Outcome | Priority | Primary dependency |
| --- | --- | --- | --- |
| 0. Measurement and safety | Reproducible performance, reliability, and privacy gates | P0 | Current codebase |
| 1. Large-graph foundation | Full graph access through the supported 3D path without blocking or silent loss | P0 | Milestone 0 |
| 2. Orientation and continuity | Predictable setup, global search, and 2D/3D handoff | P0 | Shared graph state from Milestone 1 |
| 3. Change intelligence | Explain what changed after a refresh | P1 | Stable graph identity and snapshots |
| 4. Workflow intelligence | Explain agent work across metadata-only events | P1 | Incremental activity pipeline |
| 5. Guided maintenance | Turn graph findings into safe, reviewable next actions | P1 | Stable inspector and evidence model |
| Later bets | Temporal, cross-vault, semantic, and automation surfaces | P2 | Validated earlier milestones |

The milestones are ordered by dependency, not by calendar date. Scheduling should happen only after ownership and available capacity are known.

## Milestone 0 — Measurement and Safety

### Objective

Make performance and reliability visible before changing the renderer architecture.

### Current implementation status

Completed safety foundation: pull-request CI, deterministic content-free fixtures, renderer diagnostics and hosted WebKit integration coverage, bounded command/server process handling, and an opt-in measurement harness that records cold and warm p50/p95/CV evidence. The first reference-host pass is complete for all four fixture sizes with exact queryable node/edge parity. The performance harness still measures the 2D BrainBar runtime with deterministic stubs rather than full Vis rendering; offline Vis delivery is covered separately by a production WebKit functional gate. A bounded API spike also confirmed that public WebKit APIs do not expose a per-`WKWebView` WebContent PID, so automated WebContent memory sampling is excluded rather than using private SPI or global process enumeration; whole-renderer memory remains a manual Instruments check. The owner approved the numeric 3D budgets below on 2026-08-08. Milestone 0 is complete.

### Observed reference-host baseline

The following results were measured on 2026-08-07 using the fixed protocol in `docs/performance-testing.md`. They are observations, not approved budgets. Times are p50 / p95 in milliseconds.

| Fixture | Nodes / edges | 3D load to settled paint | 3D layout preparation | 2D runtime load to diagnostics | 2D lens to diagnostics | Queryable parity |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| 1k | 1,000 / 2,380 | 273.25 / 284.96 | 90.00 / 99.20 | 127.28 / 143.54 | 6.89 / 7.20 | Exact |
| 10k | 10,000 / 23,805 | 1,495.92 / 1,518.39 | 1,142.00 / 1,163.00 | 215.34 / 1,338.18 | 1,200.69 / 1,229.31 | Exact |
| Inspected shape | 12,547 / 29,868 | 1,833.47 / 1,902.87 | 1,419.00 / 1,454.80 | 292.37 / 2,041.30 | 1,765.63 / 1,791.01 | Exact |
| 25k stress | 25,000 / 59,512 | 4,894.84 / 5,090.65 | 4,028.00 / 4,175.80 | 718.10 / 7,680.06 | 6,746.65 / 6,760.97 | Exact |

This first pass shows controlled 3D growth dominated by layout preparation and a highly variable 2D load tail at larger sizes. The 2D figures measure the BrainBar runtime with deterministic DataSet/network stubs, not a full Vis.js render. App-process RSS samples exclude WebContent and are not yet suitable as whole-renderer memory budgets.

### Approved 3D budgets — approved 2026-08-08

The non-regression ceilings include approximately 15% headroom over the observed p95 to absorb normal host variance. The M1 targets require a material improvement on the inspected and stress shapes; passing the ceiling alone is not a performance success.

| Fixture | Metric | Non-regression p95 ceiling | M1 p95 target |
| --- | --- | ---: | ---: |
| Inspected shape | Load to settled paint | 2,200 ms | 1,500 ms |
| Inspected shape | Layout preparation | 1,700 ms | 1,000 ms |
| Inspected shape | Lens to settled | 1,800 ms | 1,200 ms |
| Inspected shape | Search to settled | 40 ms | 40 ms |
| 25k stress | Load to settled paint | 5,900 ms | 4,000 ms |
| 25k stress | Layout preparation | 4,900 ms | 3,000 ms |
| 25k stress | Lens to settled | 5,100 ms | 3,500 ms |
| 25k stress | Search to settled | 80 ms | 80 ms |

Every budget is subordinate to exact queryable node/edge parity and zero renderer exceptions. The 25k case remains a stress gate, not the normal interaction promise. The owner approved these values on 2026-08-08; they are now enforceable.

### Deliverables

- Add pull-request CI for Swift tests, JavaScript runtime checks, and public-safety checks.
- Add fixed-seed graph fixtures at 1k and 10k nodes, a fixture matching the inspected 12,547-node/29,868-edge shape, and a 25k-node stress fixture.
- Define the reference Mac and macOS version plus cold-load and warm-load protocols.
- Record p50 and p95 graph-ready time, main-thread blocking, peak memory, layout time, and interaction responsiveness.
- Add WebKit integration coverage for loading, Source Lens changes, node selection, search, and 2D/3D switching.
- Drain command stdout and stderr concurrently with bounded capture.
- Prevent the local graph server from blocking on undrained output.
- Expose local, content-free renderer diagnostics suitable for support and QA.

### Exit gates

- The same fixed-seed fixture produces repeatable cold and warm measurements across the approved run count on the reference Mac.
- CI fails on graph data loss, renderer exceptions, process deadlocks, or public-safety violations.
- Large-command-output and repeated-local-server-request tests complete without hanging.
- Numeric p50/p95 performance budgets are documented and owner-approved before Milestone 1 can pass.

## Milestone 1 — Large-Graph Foundation

### Objective

Open and explore the full graph without making an arbitrary node ceiling the product boundary.

### Current implementation status

Nine bounded slices were completed across 2026-08-07 and 2026-08-08. The supported 3D path now reads `graph.json` through the local `brainbar3d://` scheme instead of reading, parsing, normalizing, serializing, and injecting the full payload on the main actor. Node file metadata is computed off-main after the graph has started rendering, then refreshes metadata-dependent UI without a second layout. A versioned pending-request handshake covers either WebKit/module boot order, and a graph-ready replay preserves the latest Source Lens, Agent Activity snapshot, and pending viewport command. Newer loads cancel older JavaScript requests; native parsing already in progress may finish, but token, generation, digest, and scheme-task checks suppress every stale commit or callback.

The transport slice reduced repeated cold-cache main-actor preparation for the inspected 12,547-node / 29,868-edge fixture from 402.57 ms p50 to 0.029 ms p50. Its proof is retained in `outputs/transport-speedup-proof-report.md`.

The second slice moved the complete deterministic 3D layout into a same-origin Dedicated Module Worker while retaining the bounded spatial algorithm. Compact node/edge records cross the Worker boundary and coordinates return in a transferred `Float64Array`. Epoch, graph generation, Source Lens, and visible-graph revision enforce latest-wins. Readiness includes both generation and lens, so Agent Activity and viewport state replay only after the current layout commits. Missing-graph, in-flight lens change, overlapping result, startup-failure, timeout, and stale-result paths fail or converge explicitly without a premature `graphReady`.

On the inspected fixture, the zero-delay event-loop probe improved from 1,537 / 1,567.4 ms p50/p95 to 20 / 22.6 ms with exact queryable parity, a proven 98.70% median improvement. On 25k, the same probe improved from 5,499 / 6,081.6 ms to 35 / 66.6 ms while preserving exactly 25,000 nodes and 59,512 edges. The small after values on 25k are noisy (34.57% CV), so that fixture is supporting evidence rather than the primary statistical proof. Total graph-ready work was not eliminated: final 3D load-to-settled paint measured 1,670.43 / 1,762.77 ms on the inspected shape and 5,964.91 / 7,140.93 ms on 25k. The page is responsive during that work, but total 25k latency and variance still miss the proposed M1 target. The raw `outputs/layout-worker-*.json` files retain that evidence.

The third slice added explicit `idle`, `loading`, `ready`, `stale`, and `failed` product states keyed by renderer and surface, so the menu-bar popover and Focus window cannot overwrite one another. Renderer callbacks are attempt-gated; late navigation or layout results cannot replace the current state. Reload preserves the previous-ready identity, failures expose a retry action, and WebKit process termination becomes an explicit renderer failure. The 2D path reports ready only after its actual Vis network is available, so an unavailable runtime is an explicit compatibility failure rather than a false ready state. Tests cover current-attempt wins, surface independence, verified 2D readiness, missing-network failure, rapid reload, retry, and 3D Worker failure. The v0.10.0 closure subsequently made the pinned runtime local and offline-capable.

The fourth slice introduced a background `GraphDataStore` owned by the app and injected into the 3D renderer. It reads and validates one raw snapshot off-main, assigns an authoritative SHA-256 digest, derives a reorder-stable semantic fingerprint, and serves graph plus path-contained metadata only for the same digest-bound handle. Invalid JSON, invalid shapes, missing or duplicate string identities, unresolved endpoints, retry, same-signature content changes, distinct same-size sources, symlink escape, and overlapping latest-wins loads now have explicit tests. Id-less Graphify edges remain supported: their runtime identities are derived from canonical edge semantics, preserve multiplicity, remain stable under reorder, and cannot collide with explicit IDs. Renderer diagnostics are generation-tagged, so failures from an older page cannot fail the current attempt.

The fifth slice added deterministic production-WKWebView coverage for the shipped 2D Workbench: exact Source Lens, Focus, Recent, Needs Links, Key Notes, Review, community, and Graph Check views, plus edge provenance and the Open Note bridge. The native Graph Health action now routes to the 2D Workbench when `graph.html` exists and reports distinct compatibility messages for JSON-only and missing-output vaults. A separate hosted 3D matrix verifies the committed/queryable contract for Focus, Recent Orbit, Community Spotlight, Path, and Open Note with exact node/edge counts. It intentionally does not treat `requestAnimationFrame` paint settlement in an inactive XCTest window as semantic parity; painted-frame timing remains in the dedicated visible renderer measurement harness. Offline 2D delivery was added later as a release-candidate closure without changing this parity boundary.

The sixth slice added user-owned cancellation and recovery to both renderers. Cancel is exposed only for the current renderer-and-surface loading attempt; it preserves any previously ready graph, cancels 3D preparation/navigation/scheme delivery/JavaScript fetch and Worker work, stops 2D navigation/bootstrap, and suppresses late cancellation failures. Retry always creates a new attempt. Focused tests cover surface-scoped cancellation, previous-ready preservation, retry, and failure-free cancellation in both coordinators.

The seventh closure slice distinguishes an unavailable 2D Vis/runtime from generic navigation or renderer failures. In Focus, that current-attempt compatibility failure routes once to the bundled 3D renderer when validated `graph.json` is available; the menu-bar popover keeps its 2D boundary and presents an explicit compatibility message instead of looping. Stale, cancelled, generic, or missing-output failures never change renderer mode. A separate production WebKit gate now compares the exact queryable node-ID set and normalized edge-identity multiset after GraphDataStore, digest-bound scheme transport, runtime normalization, and Worker commit. Its fixture covers exact whitespace IDs, endpoint aliases, an explicit edge ID, and duplicate idless edges while keeping public diagnostics content-free.

An eighth bounded slice added an asynchronous IndexedDB cache for deterministic 3D coordinates. Records are keyed by layout schema version, authoritative raw SHA-256 digest, and Source Lens; they retain only node count plus finite `Float64` coordinates, never node IDs, labels, paths, edges, or graph payload. Cache hits still pass generation, lens, revision, and epoch latest-wins checks. Missing, corrupt, unavailable, stale, community-filtered, or schema-mismatched records fall back to the unchanged Worker, and a cold first load intentionally remains unchanged.

On the approved 25k protocol, warm load-to-settled improved from 8,940.14 / 9,156.40 ms p50/p95 to 4,717.80 / 4,892.89 ms with exact 25,000-node / 59,512-edge parity. The 47.23% median gain is statistically proven at 2.99% after CV. Graphify-lens-to-settled improved from 4,223.82 / 4,401.83 ms to 181.11 / 195.76 ms. Raw evidence is retained in `outputs/layout-cache-before-25k.json` and `outputs/layout-cache-after-25k.json`.

A ninth slice removed the remaining native preparation bottleneck without changing the digest contract. `GraphDataStore` previously created 32 formatter-backed strings for every SHA-256 digest; it now emits the same lowercase 64-character value into one reserved UTF-8 buffer through a fixed lookup table. A hardcoded SHA-256 vector plus the existing reorder, multiplicity, retry, and latest-wins tests preserve byte-for-byte identity and downstream behavior. The renderer harness was first stabilized with an explicit, test-only abort and blank-page teardown; that repair was present on both sides of the matched comparison.

On 25k, warm load-to-settled improved from 4,856.48 / 5,573.57 ms p50/p95 to 2,100.98 / 2,290.05 ms. The 56.74% median improvement is `PROVEN` at a 12.28% noise threshold with exact 25,000-node / 59,512-edge parity. Layout, lens, and search p95 are 2.00, 226.94, and 54.22 ms. The inspected 12,547-node / 29,868-edge shape separately passes at 1,031.65 / 1,081.96 ms load p50/p95, with 1.00 ms layout, 95.16 ms lens, and 35.54 ms search p95. Raw evidence is retained in `outputs/digest-hex-before-25k.json`, `outputs/digest-hex-after-25k.json`, and `outputs/digest-hex-after-inspected.json`; the statistical verdict is in `outputs/speedup-proof-report.md`.

Every explicit Milestone 1 exit gate and every approved inspected-shape and 25k performance target now passes. Milestone 1 is complete; Milestone 2 may begin without revising the dependency or weakening the original budgets.

### Deliverables

#### Shared graph data pipeline

- ✅ Introduce a background graph data store responsible for versioning and validating each prepared `graph.json` snapshot once; an explicit retry intentionally creates and revalidates a new snapshot attempt.
- ✅ Keep only the active validated raw snapshot, digest-bound handle, and compact metadata seeds in native memory; normalization remains in the renderer.
- ✅ Move the full JSON payload build out of the main actor and replace giant generated JavaScript copies with a local read bridge or equivalent streaming-safe transport.
- ✅ Publish explicit loading, ready, stale, and failed states to both renderers.

#### Existing 2D compatibility boundary

- ✅ Keep the current Graphify `graph.html` path working with the pinned local Vis Network 9.1.6 runtime and block the matching remote request.
- ✅ Prove offline 2D initialization in a production WebKit test without weakening the `graph.html` requirement.
- ✅ Route JSON-only graph access to the bundled 3D renderer with an explicit explanation instead of showing an empty 2D surface.
- Preserve existing 2D behavior without making it a blocker for the large-graph foundation.

#### Scalable 3D layout

- ✅ Move JavaScript layout preparation into a Web Worker or a background graph service instead of running it inline in the WKWebView runtime.
- ✅ Replace pairwise node separation with spatial hashing or another bounded-neighborhood strategy.
- ✅ Cache layout by graph version and active lens where practical.
- Keep dense-graph visual budgets adaptive and deterministic.

### Exit gates

- ✅ A JSON-only Graphify vault opens the complete graph in 3D where that renderer is available; an offline vault with `graph.html` opens the 2D Workbench through the pinned local runtime.
- ✅ The queryable node-ID set and normalized edge-identity multiset exactly match the source fixture.
- Painted counts are a separate presentation metric and may vary only through declared progressive rendering; they are not evidence of identity parity.
- ✅ JSON corruption, duplicate identities, cancellation, retry, path containment, and overlapping latest-wins loads have explicit tested outcomes.
- ✅ The Lens, Focus, Recent, Needs Links, Key Notes, Review, Graph Check, community, Open Note, and edge-provenance parity matrix passes.
- ✅ The inspected-shape and 25k stress fixtures satisfy the performance budgets established in Milestone 0; 25k remains a stress target, not a normal interaction promise.
- ✅ The native app remains responsive while a graph loads and exposes retry/cancel recovery.
- ✅ Existing lens, path, node-opening, and edge-provenance behavior passes parity tests.

### Important trade-off

Milestone 1 itself improved the supported 3D path and shared loading pipeline without making offline 2D part of its performance budget. The later release-candidate closure added the pinned local Vis dependency and a focused WebKit gate. The 2D Workbench remains dependent on Graphify HTML, but no longer on network availability.

## Milestone 2 — Orientation and Continuity

### Objective

Make the first successful graph opening and every subsequent navigation step predictable.

### Deliverables

#### Setup Doctor

- ✅ Guide the user through selecting a vault and validating it before saving.
- ✅ Detect `graph.json`, optional `graph.html`, reports, Graphify, Git, and configured local commands.
- ✅ Show the exact executable path and environment BrainBar will use.
- ✅ Distinguish missing output, stale output, invalid configuration, permissions, and unavailable commands.
- ✅ Offer explicit, reversible actions for choosing a vault, copying the refresh command, and running Refresh Graph.
- ✅ Define a diagnosis matrix for no configuration, missing or unreadable vault, missing or invalid JSON, valid JSON-only output, missing or non-executable Graphify, failed refresh, stale output, and permission failures.
- ✅ Give every diagnosis a severity, supporting evidence, and one exact remediation.
- ✅ Define “stale” from explicit refresh state: an existing `graph.json` is stale only when it predates a later failed refresh attempt. A successful no-change refresh is not guessed stale.

The Setup Doctor runs filesystem and JSON inspection off the main actor, resolves commands with the same effective `PATH` as `CommandRunner`, and never surfaces command stderr or note contents. Saving is blocked only for an invalid configuration or missing/unreadable vault; missing output and unavailable tools remain actionable diagnostics so an existing vault can still be saved for read-only use. The focused diagnosis and save-gate matrix passes 6/6 tests.

#### Shared 2D/3D context

- ✅ Introduce a versioned `GraphSessionState` carrying at least graph version, node ID, Source Lens, focus depth, path endpoints/variant, community, and search state.
- ✅ Preserve that semantic state when switching modes.
- ✅ Add symmetric “Open this context in 2D/3D” actions.
- ✅ Preserve context across a window close/reopen within the same app session.
- ✅ Preserve and explain a state that one renderer cannot display instead of silently clearing it; camera coordinates do not need cross-renderer equivalence.

The shared state lives in the session-owned `AppModel`, is bridged bidirectionally through versioned WebKit messages, and is replayed only after each renderer is ready. The 2D Workbench retains a 3D-only path while explaining that it cannot paint it; returning to 3D restores the endpoints and variant. Exact full-state restoration now passes in production 2D and 3D WebKit fixtures (1/1 each), while model and codec coverage proves both mode round trips, same-session window reuse, schema rejection, and normalization (3/3).

#### Global search and saved views

- ✅ Search the complete graph rather than only the currently visible subset.
- ✅ Explain when a result is hidden by a lens, community, or active mode.
- ✅ Add filters for type, tag, status, source, date, and agent activity where metadata exists.
- ✅ Save local workspaces containing lens, focus, query, mode, and camera state.

Both renderers now query their complete graph and accept composable local filters (`type:`, `tag:`, `status:`, `source:`, `date:`, and `agent:`). Hidden results identify the responsible Source Lens, community, or active mode. Revealing one creates a temporary view and restores the exact prior filters through “Return to filters” or “Back to all”; the production 2D and 3D WebKit scenarios each pass 1/1. Saved views are versioned JSON under BrainBar Application Support, contain only graph references and display state, support restore/delete, and preserve the 3D camera through the 2D renderer without requiring camera equivalence. Persistence, codec, normalization, and privacy coverage passes 3/3; final camera round trips pass 1/1 in each renderer.

### Exit gates

- ✅ Every Setup Doctor matrix case produces the expected severity, evidence, and remediation.
- ✅ A clean configuration reaches a useful graph or an actionable diagnosis without editing JSON manually.
- ✅ The 2D → 3D → 2D and 3D → 2D → 3D test matrices preserve the complete semantic context.
- ✅ Search reports hidden results and can reveal one without permanently discarding the user's filters.
- ✅ Saved views contain references and display state only; they never copy note contents.

## Milestone 3 — Change Intelligence

### Objective

Answer “what changed?” immediately after a successful graph refresh.

### Current implementation status

The bounded Change Radar integration is wired into `AppModel` and the Graph action menu. A refresh appends a snapshot only after the refresh command succeeds, the current `graph.json` validates through a Radar-dedicated `GraphDataStore`, and its attempt remains current; failed, invalid, superseded, and older overlapping attempts append nothing. The snapshot captures a cursor-bounded, privacy-projected Agent Activity interval: only id, action, agent, timestamp, contained relative path, node ID, status, and category are retained. The compact Change Inbox supports Reveal, bounded Focus, Compare, session-local Dismiss, retention warning, persisted load, and an explicit Radar-sidecar-only Clear History action. Activity labels describe a node as “Touched during interval” and do not imply causality.

Focused AppModel Change Radar coverage passes 9/9: validated append/privacy projection; failed, invalid, and thrown no-append with updated status; overlapping latest-wins; newer preflight failure superseding a held older refresh; renderer-store isolation; actor-claim and AppModel claim-boundary races; and persisted canonical activity/pending inbox state with load, clear, reveal, focus, compare, and all-dismissed session state. Existing verified evidence is preserved: Agent Activity/Privacy focused suite PASS 12/12; GraphChangeRadarTests PASS 9/9; GraphChangeRadarPerformance test PASS 1/1, 4.194s (<12s), size cap assertion passed.

### Deliverables

#### Graph Change Radar

- Keep bounded rolling snapshots under BrainBar Application Support, never inside the vault.
- Define stable node identity, normalized edge identity, graph content digest, snapshot schema/version, retention, and clear behavior before storing the first snapshot.
- Diff added, removed, and changed nodes and edges.
- Match communities across refreshes before describing community movement; do not treat cluster renumbering as a semantic change.
- Identify new or resolved needs-attention items and pending paths that became graph nodes.
- Present a concise change inbox with reveal, focus, compare, and dismiss actions.
- Link changes to available Agent Activity metadata without claiming unsupported causality.

#### Incremental Agent Activity

- Replace periodic full-vault scans with FSEvents or an equivalent event-driven local watcher.
- Tail the JSONL event log by byte offset and inode instead of reparsing it in full.
- Preserve bounded retention and handle rotation safely.
- Add a Privacy Center for source toggles, excluded paths/globs, retention, metadata preview, and log clearing.

### Exit gates

- The same before/after graph pair produces the same deterministic golden diff.
- Edge reorder only and an identical refresh both produce zero changes.
- Golden add/remove/change fixtures match expected results exactly.
- A failed Graphify refresh does not create a misleading snapshot.
- Change Radar remains responsive on the 25k-node fixture.
- Agent Activity stores only the documented metadata contract.
- Excluded paths never appear in new activity events.

## Milestone 4 — Workflow Intelligence

### Objective

Turn isolated activity events into short, explainable units of local work.

### Current implementation status

Agent Activity schema v2 now carries optional `workflow_id`, workflow title, and explicit `source`/`output` path roles while retaining v1 compatibility. Writer, parser, mapped events, retained history, snapshots, and both renderers preserve version, session, project, source, reason, status, and workflow metadata. Workflows are derived only from explicit workflow or session identifiers; no proximity or role inference is performed.

The native workflow inspector shows deterministic status, agents, declared Source/Output paths, chronological Touched paths, and pending graph refreshes without becoming an automation dashboard. Selecting a workflow adds an independent 2D/3D canvas overlay and does not alter Search, Focus, Path, Recent Orbit, Graph Story, Community Spotlight, lens, or saved session state. Workflow history reuses the visible Agent Activity retention and Clear controls, has no separate database, uses SHA-256 vault-scoped sidecars, and suppresses cross-vault projection.

Final evidence: the integrated M4 gate passed 15/15 tests; the focused core suite passed 14/14 including relaunch, rotation after more than 160 events, duplicate basenames, and Vault A→B→A isolation; Graph runtime smoke tests passed; final read-only Sol verdict: `ship`.

### Deliverables

- Version the Agent Activity event schema and preserve session, project, source, reason, and status losslessly through writer, parser, mapping, snapshot, and renderer layers.
- Add `workflow_id`, workflow title, and explicit source/output roles only through a versioned schema change; do not infer that those raw fields already exist.
- Group the first workflow release by explicit identifiers only.
- Show declared source/output roles when present; otherwise show a chronological touched-path trail without assigning unsupported roles.
- Highlight workflow nodes without clearing Search, Focus, Path, Recent Orbit, Graph Story, or Community Spotlight.
- If Hermes integration is introduced, start it as a normal metadata-only activity source until it exposes a stable workflow contract.

### Exit gates

- Explicit sessions group deterministically.
- Duplicate, out-of-order, and colliding events have deterministic tested behavior.
- Optional metadata survives the complete pipeline without loss.
- Raw transcripts, prompts, note contents, stdout, and stderr never enter workflow storage.
- A workflow can be inspected without turning BrainBar into an automation dashboard.
- Completed-workflow retention and deletion are visible and configurable.

See [Agent Workflows](agent-workflows.md) for the detailed event and Hermes boundaries.

## Milestone 5 — Guided Maintenance

### Objective

Turn graph findings into safe actions while keeping the user in control of canonical Markdown.

### Current implementation status

The 2D and 3D renderers now consume the same versioned, metadata-only evidence engine. Node inspection shows exact incoming and outgoing edges, community, modification/status/category metadata when present, and deterministic health signals. Edge inspection shows direction, relation/context, provenance, source path, endpoint community/status, and related signals. Graph Check is available in both renderers and presents versioned rules, structured evidence, thresholds, caveats, bounded subject summaries, and an explicit **Copy instruction** action; it exposes no vault-write bridge.

Rule version 1 covers degree-zero orphans, non-primary isolated components, stale hubs using the documented degree and 90-day thresholds, articulation-point weak bridges, and explicit unresolved endpoints when that evidence is present in an accepted raw renderer input. The supported 3D application path intentionally retains Milestone 1 validation: `GraphDataStore` rejects a `graph.json` whose edge endpoint is absent, so that invalid file produces a load/Setup Doctor failure instead of a partially rendered 3D graph. The unresolved-endpoint rule remains golden-tested in the shared engine and is available to the raw 2D Workbench path; BrainBar does not weaken graph integrity to manufacture a 3D proposal.

The rules engine uses iterative articulation analysis and precomputed component edges. On deterministic 25k pathological fixtures it produced 12,499 disjoint-component proposals in about 150 ms / 19.25 MB and 24,998 chain bridge proposals in about 232 ms / 32.69 MB, below the 2-second and 35-MB regression ceilings. Both interfaces materialize at most 100 proposal cards at once and state the exact total without dropping structured report entries. Focused WebKit coverage proves 2D and 3D inspector/Graph Check wiring, object-form endpoint projection, copy-only behavior, content-free diagnostics, and recursive vault SHA-256 equality before and after node, edge, proposal, and copy interactions.

### Deliverables

#### Unified inspector

- ✅ Use the same node and edge evidence model in 2D and 3D.
- ✅ Show incoming and outgoing links, provenance, community, modification metadata already available at runtime, and graph-health signals.
- ✅ Display only evidence already present in graph or runtime metadata in the first slice.

#### Graph Check proposals

- ✅ Produce deterministic suggestions for orphans, isolated components, stale hubs, weak bridges, and unresolved explicit endpoints when accepted input contains that evidence; invalid 3D graphs remain validation failures.
- ✅ Show the evidence and caveats behind every suggestion.
- ✅ Offer a copyable instruction preview.
- ✅ Require a separate, explicit user action outside graph exploration before canonical Markdown changes; the current graph inspector exposes no mutation action.
- ✅ Version every rule, threshold, and caveat used to generate a proposal.

### Exit gates

- ✅ The same evidence produces the same deterministic proposal.
- ✅ Every proposal identifies its source nodes, edges, and caveats.
- ✅ BrainBar never applies a vault mutation from the graph inspector.
- ✅ Golden rule tests pass, and recursive vault content hashes remain unchanged after the covered 2D and 3D inspector and proposal interactions.

## Later Bets

These ideas should remain behind explicit decision gates until the earlier milestones prove daily value.

### 3D Visual and Spatial Redesign

Evolve the mature 3D renderer from a dense uniform cloud into a deterministic community-island system with progressive painted detail, stronger node/edge hierarchy, bounded labels, intentional camera presets, and a collapsible context panel. The complete implementation contract, performance boundary, test matrix, and phased rollout are defined in [`graph3d-visual-spatial-redesign.md`](graph3d-visual-spatial-redesign.md). This work is explicitly post-0.10 and must preserve the completed M0–M5 identity, loading, privacy, read-only, and performance contracts.

### Temporal Replay

Combine Change Radar and Agent Workflows to replay how a body of work transformed the graph. This depends on stable snapshot identity and trustworthy workflow grouping.

### Inferred Workflow Grouping

Infer workflows only after an explicit-ID release provides a labeled evaluation corpus and the owner approves a precision threshold. Inference must remain optional and visibly non-canonical.

### Vault Profiles and read-only federation

Support multiple isolated vault configurations first, then consider a namespaced global view. Cross-vault relationships must retain provenance and must not copy Markdown between vaults.

### Query Console

Turn Graphify `query`, `path`, and `explain` results into temporary local subgraphs and saved views. BrainBar should remain a visual client of documented Graphify contracts rather than duplicating Graphify's analysis engine.

### On-device Semantic Lens

Offer opt-in local summaries or candidate relationships using a supported on-device model. Generated suggestions must be labeled, explain their source context, remain non-canonical, and degrade cleanly on unsupported Macs.

### App Intents and Shortcuts

Expose stable, explicit local actions such as Refresh Graph, Reveal Node, Open Recent Orbit, and Run Graph Check. Automation must never weaken existing confirmation or privacy boundaries.

### Public-safe export and local Quick Look

Explore selected-subgraph export and note preview only after their privacy boundaries are separately specified. Export must preview labels, paths, metadata, and relationships, support redaction, and prove excluded data is absent.

## Success Metrics

BrainBar does not need remote analytics to evaluate this plan. Metrics can come from deterministic fixtures, local diagnostics, release QA, and deliberate user testing.

| Outcome | Metric |
| --- | --- |
| Fast orientation | Time from graph open to first successful reveal/focus |
| Large-graph reliability | Graph-ready time, peak memory, longest main-thread stall, crash-free fixture runs |
| Data trust | Source-to-renderer node/edge parity; unexplained truncation count |
| Navigation continuity | Successful 2D/3D context handoff rate in automated scenarios |
| Change comprehension | Time to identify and open one meaningful graph change |
| Workflow clarity | Correct explicit grouping; inferred precision only after the later evaluation gate is enabled |
| Privacy | Content-bearing Agent Activity events or excluded-path leaks; target is zero |
| Maintenance safety | Proposals with visible evidence and zero silent vault writes |

Performance budgets should be set after Milestone 0 and then enforced as regression thresholds. They should not be invented from an unmeasured baseline.

## Release and Rollout Strategy

- Keep architecture changes behind local feature flags until parity tests pass.
- Ship renderer foundations before dependent product surfaces.
- Provide a visible fallback to the last stable renderer during the migration.
- Migrate local sidecar data with versioned schemas and bounded retention.
- Update README, screenshots, troubleshooting, release notes, and brainbar.io only after behavior is verified in a release candidate.
- Validate installer and upgrade flows on a clean macOS runner or clean user account.

## Decision Gates

Before implementation begins, the owner should approve:

1. The renderer strategy after a bounded technical spike; JSON-native 2D remains deferred, while Graphify-HTML 2D now uses pinned local Vis Network 9.1.6.
2. The reference Macs and performance budgets established in Milestone 0.
3. Snapshot and workflow retention defaults.
4. The explicit-ID-only first workflow release and the evaluation gate required before later inference.
5. Which later bet, if any, deserves discovery after Milestone 3.

## Recommended First Implementation Package

The first package should stop after the large-graph foundation is proven:

1. Add PR CI, large fixtures, and renderer measurements.
2. Fix command and graph-server pipe handling.
3. Introduce the background shared graph data store.
4. Make JSON-only fallback to 3D explicit and testable; keep Graphify-HTML 2D functional offline through the pinned local runtime.
5. Move 3D layout preparation into a worker/background service and retain the bounded spatial separation.
6. Run parity and performance gates on 1k, 10k, inspected-shape, and 25k stress fixtures.

Do not start Change Radar, Agent Workflows, semantic features, or cross-vault federation until this package passes its exit gates.

## References

- [BrainBar README](../README.md)
- [BrainBar Concepts](../CONCEPTS.md)
- [Agent Workflows](agent-workflows.md)
- [Configuration](configuration.md)
- [Historical May 2026 quality and performance audit](audits/brainbar-quality-performance-audit-2026-05.md)
- [Graphify](https://github.com/safishamsi/graphify)
- [Apple Foundation Models](https://developer.apple.com/documentation/FoundationModels)
- [Apple App Intents](https://developer.apple.com/documentation/AppIntents)
