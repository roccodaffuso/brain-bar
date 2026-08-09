# Performance testing

## Reference host

The reference machine for the first measurement pass is a MacBook Air Mac15,12 with an Apple M3 (8 cores), 16 GB memory, and macOS 26.5.2 (build 25F84). Record the exact app revision, fixture name, browser/webview state, and any concurrent workload with every result.

## Fixture protocol

Use the deterministic fixture generator for four content-free Graphify-shaped graphs: 1k, 10k, the inspected 12,547-node / 29,868-edge shape, and 25k stress. Generate fixtures into a temporary directory; they are test artifacts and must not be committed.

```sh
node scripts/generate-large-graph-fixtures.mjs --all --output-dir "$(mktemp -d)"
node scripts/test-large-graph-fixtures.mjs
```

The 25k fixture contains 59,512 edges, calculated as `round(29,868 * 25,000 / 12,547)` to preserve the inspected edges-per-node ratio (and approximate average-degree shape). Fixture labels and source paths are synthetic identifiers only; no vault note contents are included.

## Measurement protocol

For each fixture and relevant graph view, collect one cold run after restarting the app/webview, then perform at least two warmups followed by nine measured warm runs. Report p50, p95, and coefficient of variation (CV) for each metric. Do not aggregate cold and warm runs.

Capture these metrics separately:

- graph-ready time (request/load start to usable graph)
- main-thread work during graph initialization
- peak or sampled process memory while loading
- layout duration
- interaction latency for representative pan, zoom, hover, search, and selection actions

Use content-free fixture names, counts, timing aggregates, and system metadata in diagnostics. Never emit note text, graph labels from a real vault, paths to private vault content, or graph payloads.

The provisional v0.10 single-visible-WebView release-review memory ceiling is documented below. The existing Graph3D layout benchmark is scoped evidence for its isolated local-node separation routine only; it is not a graph-ready, renderer, memory, or interaction performance result for the full application.

The approved Module Worker slice uses `threeDLayoutZeroDelayTimerProbeMs` as its primary responsiveness measure. The matched inspected-shape result improved from 1,537 / 1,567.4 ms p50/p95 before the Worker to 20 / 22.6 ms after it (nine measured runs, exact parity), a proven 98.70% median improvement. The 25k supporting run improved from 5,499 / 6,081.6 ms to 35 / 66.6 ms, but its 34.57% after CV is explicitly noisy. Raw evidence is stored in `outputs/layout-worker-baseline.json`, `outputs/layout-worker-after-inspected.json`, and `outputs/layout-worker-after-25k.json`.

## 3D layout cache protocol

The production `brainbar3d://` origin keeps an asynchronous IndexedDB cache of deterministic 3D coordinates only. A record contains a schema version, raw graph SHA-256 digest, normalized source lens, node count, and a finite `Float64Array` coordinate buffer. It contains no node IDs, labels, paths, edges, or graph payload. The key is `layout-schema-version + digest + lens`; a schema bump is required for any layout-algorithm change. At most the three source-lens records for the active digest are retained, and a successful write clears records for older digests.

The cache is eligible only while all communities are enabled and a valid digest is present in the current custom-scheme URL. A validated hit reconstructs positions against the current deterministic node order and still passes normal generation/lens/revision/epoch latest-wins checks. Missing, corrupt, unavailable, quota-failed, test-mode, and community-filtered cases leave the Worker path unchanged; writes happen after the Worker commit and never block cold layout work.

`brainBarRendererDiagnostics()` reports the content-free `layoutCache` state (`disabled`, `lookup`, `miss`, `stored`, or `hit`). The opt-in renderer harness clears the query-gated cache before its cold sample and requires `stored` for both its All and Graphify layouts. It then requires `hit` for both cacheable layouts in every warmup and measured sample; it retains its existing public report schema.

The matched 25k cache proof completed on 2026-08-08 with exact 25,000-node / 59,512-edge parity. Warm 3D load-to-settled improved from 8,940.14 / 9,156.40 ms p50/p95 to 4,717.80 / 4,892.89 ms; Graphify-lens-to-settled improved from 4,223.82 / 4,401.83 ms to 181.11 / 195.76 ms. The load median improvement is 47.23% at 2.99% after CV and is classified `PROVEN`. Raw cache reports are `outputs/layout-cache-before-25k.json` and `outputs/layout-cache-after-25k.json`.

## GraphDataStore digest encoding proof

The final M1 performance slice preserves CryptoKit SHA-256 while replacing 32 formatter-created strings per digest with one reserved 64-byte lowercase UTF-8 buffer. A hardcoded known vector verifies the exact digest representation; reorder, multiplicity, retry, cancellation/latest-wins, cache-key, and renderer-parity behavior remain unchanged.

The test-only renderer host lifecycle was stabilized before collecting either side: 3D fetch and Worker work are explicitly aborted, the WebView navigates to a blank document, the harness waits for `document.readyState === "complete"`, then removes handlers and closes the host once. This lifecycle repair is therefore not part of the measured production difference.

On the deterministic 25k fixture, warm load-to-settled improved from 4,856.48 / 5,573.57 ms p50/p95 to 2,100.98 / 2,290.05 ms with exact 25,000-node / 59,512-edge parity. The 56.74% median gain is `PROVEN` against a 12.28% noise threshold. The final 25k layout, lens, and search p95 values are 2.00, 226.94, and 54.22 ms. The inspected-shape confirmation records 1,031.65 / 1,081.96 ms load p50/p95, plus 1.00, 95.16, and 35.54 ms layout/lens/search p95 with exact 12,547-node / 29,868-edge parity. These results pass every approved M1 budget without revising the target.

Raw reports are `outputs/digest-hex-before-25k.json`, `outputs/digest-hex-after-25k.json`, and `outputs/digest-hex-after-inspected.json`. The statistical comparison is `outputs/speedup-proof-results.json`; the human-readable verdict is `outputs/speedup-proof-report.md`.

## Opt-in renderer measurement harness

Run the harness deliberately on the reference host; it is not part of the ordinary XCTest suite or pull-request CI:

```sh
node scripts/run-renderer-measurements.mjs --case 1k --format markdown
```

To isolate main-actor transport preparation with repeated cache-miss paths, compare the retained legacy seam with the production path:

```sh
node scripts/run-renderer-measurements.mjs --case inspected-shape --transport-only --transport-implementation legacy --format json
node scripts/run-renderer-measurements.mjs --case inspected-shape --transport-only --transport-implementation current --format json
```

The command accepts only `1k`, `10k`, `inspected-shape`, or `25k-stress`. It materializes the selected fixture under a temporary `/private/tmp/brainbar-renderer-measurements-*` directory, creates a versioned, single-use request marker for the selected XCTest, validates the content-free JSON report, prints it to standard output, and removes the fixture and report. The request records its measurement root; the XCTest consumes it before work and rejects stale, unsafe, unreviewed, dead-launcher, or symlink-escaping requests, so ordinary test runs remain inert. Use `--format json` when an automation consumer needs the reviewed schema.

Each full-renderer invocation prepares stable temporary transport, 3D graph, and 2D `graph.html` paths once. The first run is cold for those paths and cache entries; two discarded warmups and nine measured runs reuse the same paths and WebKit process caches while creating fresh test WebViews/configurations. Transport-only comparisons instead use distinct graph paths for every sample so the app-level payload/version cache is cold while filesystem caches can warm equally for both implementations. The report uses linearly interpolated percentiles and population-standard-deviation CV (`standard deviation / mean * 100`). It reports observed values only; it never turns a result into an approved budget.

The report contains only fixture counts/name, protocol counts, process/OS numeric metadata, timing samples and summaries, and queryable-count parity. It contains no graph payload, node or edge identity, label, source path, search query, or note content. The metrics are:

- `graphTransportPreparationMs`: main-actor wall time to inspect the graph file version before starting the local 3D resource transport.
- `appProcessResidentDeltaAfterTransportPreparationBytes` and `appProcessResidentMaxSampleBytes`: app test-process resident samples taken before transport preparation, after transport preparation, after 3D teardown, and after 2D teardown. The latter is the maximum of those discrete samples, not a process peak. Neither includes WebKit WebContent helper processes or represents whole-renderer memory.
- `threeDLoadToSettledPaintMs`: 3D load start to the first completed, settled visual-canvas overlay paint. `threeDNativePrepareToIndexMs` measures native GraphDataStore preparation through digest-bound navigation availability; `threeDNavigationToAPIReadyMs` measures that navigation through renderer API readiness. The remaining 3D phases partition fetch/parse, graph preparation, layout and paint without exposing graph content.
- `threeDLayoutCallReturnMs` and `threeDLayoutZeroDelayTimerProbeMs`: test-only, content-free WebKit responsiveness probes. A visible `WKWebView` opens the real `brainbar3d://` resource without its navigation delegate, fetches the real scheme-served `graph.json` in-page, schedules a zero-delay timer immediately before calling `brainBarLoadGraph`, and awaits `Promise.resolve(result)`. The first metric is the call-return delay; the second is the timer's observed delay. With synchronous layout they include the blocked event-loop interval; with an asynchronous Worker they measure the main-thread responsiveness of that handoff. They are not a whole-app interaction-latency budget.
- `threeDLensToSettledMs` and `threeDSearchToSettledMs`: action dispatch to the corresponding settled 3D diagnostics state.
- `threeDPanOrbitFrameMs`, `threeDHoverToHighlightMs`, `threeDSelectionToFirstFeedbackMs`, `threeDSidebarOpenReframeMs`, and `threeDOverviewCommunityTransitionMs`: query-gated, hosted-`WKWebView` production-renderer measurements. The first three bind the redesign candidate gates (pan/orbit p95 ≤33 ms; hover/selection feedback p95 ≤50 ms). Sidebar reframe and Overview-to-Community are reported as observed timing until an owner-approved limit exists. They contain only durations, never node, edge, label, path, search, or viewport content.
- `twoDRuntimeLoadToDiagnosticsMs`, `twoDRuntimeLensToDiagnosticsMs`, and `twoDRuntimeSearchToDiagnosticsMs`: production BrainBar 2D runtime diagnostic latency with deterministic DataSet/network stubs. They are not a whole 2D Vis.js renderer graph-ready measurement. Both runtimes report queryable node/edge counts, which must exactly equal fixture counts in the same run.

BrainBar does not vendor Vis.js. A full offline 2D Vis Network measurement is therefore intentionally excluded: Graphify's generated `graph.html` loads its pinned Vis Network dependency remotely. The stubbed 2D runtime metrics remain regression evidence for BrainBar's own logic only and must not be presented as offline-renderer performance.

The measurement XCTest hosts each test-only `WKWebView` in a small, visible, borderless on-screen `NSWindow` with mouse input disabled. This reduces the risk of `requestAnimationFrame` throttling, but the harness still requires an observed settled paint before accepting a timing sample. Functional hosted-WebKit tests use committed/queryable state instead and must not treat paint settlement in an inactive test window as semantic parity. Hosts are stopped, detached, and closed between samples. Background WebKit processes are intentionally not sampled for RSS. Public WebKit APIs do not expose the PID associated with a specific `WKWebView`; private SPI or global process enumeration would not provide an acceptable support or privacy boundary. Capture whole-renderer memory separately with Instruments.

For deterministic teardown, the 3D harness aborts graph and Worker work, navigates to a blank document, waits for it to complete, then removes handlers and closes the window once; 2D uses the same blank-document lifecycle.

Running the command directly in Terminal needs no BrainBar permission. Sandboxed agents or automation may need host permission to run `xcodebuild` and write its DerivedData.

## Whole-renderer memory evidence

Whole-renderer memory is measured separately from the app-process RSS samples
above. The content-free evidence is
`outputs/graph3d-whole-renderer-memory-evidence.json` (with a concise Markdown
summary beside it). It was captured on the reference MacBook Air Mac15,12,
Apple M3 (8 cores), 16 GB, macOS 26.5.2 (build 25F84), using a synchronized
all-process Instruments Activity Monitor sample.

The focused visible-`WKWebView` XCTest
`testGraph3DOverviewFitKeepsReviewedSpatialFixturesVisibleInCompactViewport`
passed in 3.110 s after sequential public-fixture loads of 1k,
inspected-shape, and 25k-stress. In its 3.172-second capture window, the
maximum sampled family physical footprint was 827,215,760 bytes (788.89 MiB)
at 8.704 s. The family consists of content-free application/test, WebKit GPU,
Networking, WebContent, and supporting-media-helper samples.

The provisional v0.10 release-review ceiling is 900 MiB for one focused,
visible WebView on this reference host. The observed 788.89 MiB passes with
111.11 MiB of headroom. This is still a maximum sampled physical footprint,
not a true peak, allocation measurement, or leak proof. Repeat the same
evidence on the signed distribution build before raising the ceiling.

A separate 15-scenario/WebView measurement-harness capture reached
3,196,977,184 bytes (3,048.88 MiB) with 14 concurrent WebContent processes.
It is documented only as a harness-stress upper bound, not as BrainBar
single-view product memory. The raw performance capture is deliberately not
committed.

## Graph3D redesign final observed reports

The final public-fixture reports are committed as content-free artifacts:
`outputs/graph3d-renderer-measurements-1k-final.json`,
`outputs/graph3d-renderer-measurements-inspected-shape-final.json`, and
`outputs/graph3d-renderer-measurements-25k-stress-final.json`. All retain
exact queryable parity. The corresponding presentation acceptance report is
`outputs/graph3d-presentation-acceptance-after.json`.

The redesign's binding hosted interaction evidence comes from 25k: pan/orbit
p95 is 3 ms (limit 33 ms); hover and selection first feedback p95 are 11 ms
and 13 ms respectively (combined gate limit 50 ms). Sidebar open reframe p95
is 13 ms and Overview-to-Community first-rendered feedback p95 is 58.2 ms.
Those latter two values do not claim that a complete camera animation finished
within that interval and remain observational until a reviewed product limit is
adopted.

For public visual QA, run `node scripts/run-graph3d-visual-capture.mjs`. It
creates reviewed synthetic fixture data under a single-use `/private/tmp`
request, runs only `testOptInGraph3DVisualCapture`, validates request version,
PID, TTL, and path containment, then copies validated screenshots and a
content-free manifest to `outputs/graph3d-visual-acceptance/`. Ordinary XCTest
runs have no request marker and do not emit capture files.
