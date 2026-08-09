# Graph3D presentation acceptance harness

This is the repeatable, content-free evidence harness for `G3D-00` and the
performance/visual evidence portion of `G3D-12`. It complements, rather than
replaces, the existing renderer measurement harness in
`scripts/run-renderer-measurements.mjs`.

## What it covers now

The Node harness generates the approved synthetic 1k, inspected-shape, and 25k
fixtures in memory. For every fixture it evaluates these deterministic states:

- Overview with a collapsed sidebar;
- Overview with a docked sidebar;
- Community;
- Node Focus;
- Path;
- Recent;
- a narrow-window overlay;
- Reduce Motion.

It records count-only, content-free evidence for queryable and painted nodes and
edges, community anchors, persistent labels, and the pure planner timing for a
static presentation plan, label allocation, and interaction-driven re-plan. The
machine-readable report deliberately labels all three as planner-only. They are
not canvas rebuild, frame, hover, or selection timings.

The count golden makes the initial presentation contract reviewable. It verifies
that Collapsed, Docked, and narrow Overlay do not change the painted set for the
same Overview input. A future implementation that intentionally changes the
selection rules must update the golden with matching rationale and visual proof.
The versioned manifest records the Overview limit of 7,000 nodes on graphs
above 16,000 nodes, plus one node of allowance for every explicitly active
promotion. The planner must pass that gate before a count golden is captured;
the checked-in harness enforces it on the approved synthetic fixtures.

## Run it

```sh
node scripts/test-graph3d-presentation-acceptance.mjs
BRAINBAR_ENFORCE_PRESENTATION_TIMINGS=1 node scripts/test-graph3d-presentation-acceptance.mjs
node scripts/graph3d-presentation-acceptance.mjs --format markdown
node scripts/graph3d-presentation-acceptance.mjs --enforce-provisional-gates --format markdown
# Validate a post-integration count golden:
node scripts/graph3d-presentation-acceptance.mjs --golden outputs/graph3d-presentation-count-golden-v1.json --format json
```

The default test is deterministic and suitable for shared CI. The opt-in
timing mode is reserved for the documented reference host; shared CI still
validates all fixture identities, counts, ordering, gates, and report shapes.

The reports contain fixture dimensions, scenario names, counts, numeric timing
aggregates, and capability state only. They contain no graph payload, node or
edge identity, label, source path, search query, note content, screenshot, or
private-vault artifact.

## Baseline before the redesign

`outputs/graph3d-presentation-baseline-before-0137a2e.json` was captured by
reading the immutable Git object for commit `0137a2e`, rather than the current
worktree. It proves that the historical renderer exposed `cameraPreset` but did
not yet expose the new presentation diagnostics. It intentionally records no
invented timing values; it is a structural before-baseline and does not qualify
as a renderer performance result.

Recreate it without modifying the worktree:

```sh
node scripts/graph3d-presentation-acceptance.mjs --baseline 0137a2e --format json
```

## Required hosted-WebKit integration

The runtime harness must invoke the production custom-scheme Graph3D page on
the same fixture/scenario matrix and add these exact content-free diagnostics to
`brainBarRendererDiagnostics()`:

- `layoutSchemaVersion`, `layoutProfile`, `detailLevel`, `detailReason`;
- `paintedNodeCount`, `paintedEdgeCount`, `communityAnchorCount`,
  `persistentLabelCount`;
- `sidebarState`, `cameraPreset`;
- `staticLayerRebuildMs`, `labelAllocationMs`, `frameQuality`.

It must additionally record p50/p95/CV for pan-orbit frame time,
hover-to-highlight, selection-to-first-feedback, sidebar-open reframe, and
Overview-to-Community transition. These values are intentionally absent from
the Node report because only a visible hosted `WKWebView` can make them true
renderer evidence. The existing 1k/inspected/25k renderer transport/layout
budgets in `docs/performance-testing.md` remain binding and separate.

After the runtime hook exists, capture the existing hosted renderer report on
the reference host, then attach it without rewriting or copying its values:

```sh
node scripts/graph3d-presentation-acceptance.mjs \
  --hosted-report /private/tmp/brainbar-renderer-measurements-.../report.json \
  --format markdown
```

When a validated hosted report is supplied, the acceptance output includes its
observed p50/p95/CV runtime metrics and binds feedback (≤50 ms) plus pan/orbit
frame (≤33 ms) gates. Sidebar reframe and Overview-to-Community remain
observational until an owner-approved limit exists. Without that report it says
only that runtime evidence was not captured; it makes no runtime claim.

Validate the count section against the golden and attach a public-safe visual
review. Do not use the count golden to claim frame performance or visual owner
acceptance.

## Recorded after evidence

The post-redesign evidence is captured in:

- `outputs/graph3d-renderer-measurements-1k-final.json`
- `outputs/graph3d-renderer-measurements-inspected-shape-final.json`
- `outputs/graph3d-renderer-measurements-25k-stress-final.json`
- `outputs/graph3d-presentation-acceptance-after.json`
- `outputs/graph3d-presentation-count-golden-v1.json`

The acceptance harness attaches the validated 25k hosted report. Its binding
gates pass: hover/selection feedback p95 is 13 ms against 50 ms, and pan/orbit
frame p95 is 3 ms against 33 ms. Sidebar-open reframe (13 ms p95) and
Overview-to-Community (58.2 ms p95) are first-rendered-feedback measurements,
not full animation-duration claims; they remain observed-only until an owner
approves limits.

Public synthetic screenshots are in `outputs/graph3d-visual-acceptance/`.
The matched core matrix uses the same public 1k fixture at 1000×720 for
Overview Collapsed/Docked, Community, Focus Orbit, selected hub/peripheral,
Active Path, Recent Orbit, Agent Activity, Workflow highlight, Graph Check,
and Reduce Motion. The runner requires their reviewed fixture SHA-256,
viewport, and coordinate fingerprint to match. The inspected-shape Overview
captures remain supplemental large-shape evidence; narrow Overlay remains the
deliberate 620×720 responsive exception. Recent Orbit uses four dated, empty
public fixture files so the production metadata scheme—not a test-only DOM
mutation—provides the recent-file signal.

The manifest records only fixture counts, reviewed public-fixture SHA-256
identities, viewports, coordinate fingerprints, and content-free diagnostics:
active mode, camera/sidebar state, selection count, activity/workflow counts,
and Graph Check visibility. The XCTest rejects changed fixture identities or
counts, validates each scenario's expected state, and confirms coordinate
stability; the matched core additionally requires same fixture SHA, viewport,
and fingerprint. These synthetic captures are not a substitute for owner review
of the real vault.

`outputs/graph3d-presentation-baseline-before-0137a2e.json` is deliberately a
read-only structural inspection of the historical Git object. The old renderer
had no safe capture hook, so no false before-image or matched-before claim is
made.

## Whole-renderer memory evidence

`outputs/graph3d-whole-renderer-memory-evidence.json` records the separate
reference-host all-process measurement. One focused visible WebView reached a
maximum sampled family physical footprint of 827,215,760 bytes (788.89 MiB)
while sequentially loading the public 1k, inspected-shape, and 25k-stress
fixtures. The provisional v0.10 release-review ceiling is 900 MiB for one
focused visible WebView on the reference host, so 788.89 MiB passes with
111.11 MiB of headroom. This remains sampled evidence, not a true peak or
leak/allocation proof.

The distinct 15-scenario/WebView capture reached 3,196,977,184 bytes
(3,048.88 MiB) with 14 concurrent WebContent processes. It is a harness-stress
upper bound only, not a single-view product memory result. The raw capture is
not checked in.
