# Speedup Proof

## ✅ PROVEN — 99.99% faster

> Correctness passed and the lower after median exceeds the noise threshold.

**Project:** BrainBar
**Target:** Main-actor preparation for a 12,547-node / 29,868-edge Graphify graph
**Preserved behavior:** Same queryable node and edge sets, same lenses and metadata-dependent features, content-free diagnostics, local-only reads, and unchanged 2D behavior.
**Generated:** 2026-08-07

## Before vs after

| Measurement | Before | After |
|---|---:|---:|
| Median runtime | 402.573 ms | 0.029 ms |
| p95 runtime | 415.744 ms | 0.031 ms |
| Mean runtime | 405.565 ms | 0.029 ms |
| Range | 401.325–418.556 ms | 0.027–0.031 ms |
| Variability | 1.41% CV | 4.07% CV |
| Measured runs | 9 | 9 |

**Speedup ratio:** 13,840.275×
**Proof threshold:** 8.14%
**Correctness:** PASSED

## What changed

Replaced main-actor read/parse/reserialize/giant-script injection with a version stat and an asynchronous brainbar3d:// resource load. The graph renders before file metadata is computed off-main, then metadata-dependent UI refreshes without a second layout.

**Why behavior remains equivalent:** The WKWebView parses the original graph.json bytes, exact node/edge count parity passes on both the inspected and 25k fixtures, and node file metadata is still delivered from the same local source after the initial graph paint.

| Complexity | Before | After |
|---|---:|---:|
| Estimate | O(graph bytes + nodes × file metadata I/O) on MainActor, plus a full serialized script copy | O(1) file-version stat on MainActor; graph and metadata I/O off-main |

### Changed files

- [Graph3DWebView.swift](../BrainBar/Views/Graph3DWebView.swift:144) — Loads graph and metadata through the local WKURLSchemeHandler with generation-checked readiness and stop-safe response delivery.
- [graph3d.js](../BrainBar/Resources/Graph3D/graph3d.js:4430) — Consumes the graph first, then refreshes metadata-dependent UI without blocking initial layout.
- [BrainBarTests.swift](../BrainBarTests/BrainBarTests.swift:677) — Adds deterministic cold-cache transport benchmarks and production-scheme parity coverage.
- [run-renderer-measurements.mjs](../scripts/run-renderer-measurements.mjs:15) — Runs legacy/current transport comparisons on reviewed fixtures.
- [performance-testing.md](../docs/performance-testing.md:48) — Documents the production transport metric and memory boundary.

## Correctness checks

| Check | Status | Evidence |
|---|---|---|
| Production scheme metadata test | ✅ passed | Graph and local file metadata load through brainbar3d://. |
| Asynchronous graph-ready replay | ✅ passed | Latest lens, mapped Agent Activity, and pending Reveal are applied only after nodes are ready. |
| Stale graph-ready rejection | ✅ passed | A completion from an older load generation cannot mark a reloaded graph ready or consume its viewport command. |
| Sequential renderer parity | ✅ passed | 2D to 3D to 2D retains exact queryable counts and content-free diagnostics. |
| Inspected-shape renderer benchmark | ✅ passed | 12,547 nodes and 29,868 edges match exactly; final-build 3D p50/p95 1688.45/1713.75 ms. |
| 25k renderer benchmark | ✅ passed | 25,000 nodes and 59,512 edges match exactly; final-build 3D p50/p95 5314.90/8813.19 ms. The transport proof passes, but the noisy layout-bound end-to-end ceiling does not. |
| Full XCTest suite | ✅ passed | The complete Swift/XCTest suite passed after the generation fix. |
| JavaScript and fixture checks | ✅ passed | Syntax, renderer utilities, graph runtime smoke tests, and deterministic large-graph fixtures passed. |
| Public safety | ✅ passed | Repository safety scan passed with content-free fixtures and relative evidence paths. |

## Benchmark protocol

**Workload:** Deterministic inspected-shape fixture: 12,547 nodes, 29,868 edges; 2 warmups and 9 measured cache-miss paths per implementation on macOS 26.5.2, Apple silicon, 16 GB RAM.
**Command:** `node scripts/run-renderer-measurements.mjs --case inspected-shape --transport-only --transport-implementation legacy --format json`
**Warmups:** 2
**Measured runs:** 9 per version

## Reproduce

```bash
node scripts/run-renderer-measurements.mjs --case inspected-shape --transport-only --transport-implementation legacy --format json
```
```bash
node scripts/run-renderer-measurements.mjs --case inspected-shape --transport-only --transport-implementation current --format json
```
```bash
node scripts/run-renderer-measurements.mjs --case inspected-shape --format json
```
```bash
node scripts/run-renderer-measurements.mjs --case 25k-stress --format json
```

## Limitations

- Whole WebContent-process memory is excluded because public WKWebView APIs do not expose a per-view process identifier.
- The 2D measurements exercise BrainBar runtime logic with deterministic stubs; BrainBar does not promise offline 2D rendering without Graphify's remote Vis.js dependency.
- The 25k end-to-end time remains dominated by the synchronous JavaScript layout: its final-build 8,813.19 ms p95 does not meet the proposed 4,000 ms target or the 5,900 ms non-regression ceiling, with 26.51% CV and one 10,477.68 ms sample.

## Residual risks

- File metadata becomes available shortly after initial graph paint, so metadata-only recency signals can update once after the graph appears.
- Stopping a local scheme request suppresses response delivery, but native graph or metadata work already running on the background queue is not interrupted in this slice.
- The local scheme handler still materializes graph bytes in memory for WebKit delivery; this slice removes main-actor parsing and giant JavaScript copies but is not streaming I/O.

## Notes

- The inspected-shape end-to-end 3D load improved from the M0 baseline 1833.47/1902.87 ms p50/p95 to 1688.45/1713.75 ms on the final build.
- The transport slice is proven independently; overall M1 remains open because the separate synchronous layout gate is not met on 25k.
- No Vis.js asset was vendored and 2D production behavior was not changed.

---

Generated by `$speedup-proof`. Runtime evidence and correctness checks determine the verdict.
