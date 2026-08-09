# Graph3D presentation acceptance

Content-free deterministic planner evidence. Planner timings are not WebKit frame or interaction timings.

| Fixture | Scenario | Painted nodes | Painted edges | Labels | Index p95 ms | Replan p95 ms | Label p95 ms |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1k | overview-collapsed | 1000 | 1800 | 8 | 3.63 | 1.96 | 0.08 |
| 1k | overview-docked | 1000 | 1800 | 8 | 3.63 | 1.22 | 0.08 |
| 1k | community | 1000 | 1800 | 14 | 3.63 | 1.30 | 0.07 |
| 1k | node-focus | 1000 | 1800 | 14 | 3.63 | 1.44 | 0.08 |
| 1k | path | 1000 | 1800 | 14 | 3.63 | 1.39 | 0.06 |
| 1k | recent | 1000 | 1800 | 14 | 3.63 | 1.44 | 0.07 |
| 1k | narrow-overlay | 1000 | 1800 | 8 | 3.63 | 1.40 | 0.07 |
| 1k | reduce-motion | 1000 | 1800 | 8 | 3.63 | 1.51 | 0.07 |
| inspected-shape | overview-collapsed | 1200 | 1800 | 8 | 62.54 | 7.47 | 0.10 |
| inspected-shape | overview-docked | 1200 | 1800 | 8 | 62.54 | 6.32 | 0.07 |
| inspected-shape | community | 1201 | 1800 | 14 | 62.54 | 5.99 | 0.08 |
| inspected-shape | node-focus | 1201 | 1800 | 14 | 62.54 | 7.16 | 0.08 |
| inspected-shape | path | 1205 | 1800 | 14 | 62.54 | 5.63 | 0.08 |
| inspected-shape | recent | 1201 | 1800 | 14 | 62.54 | 6.65 | 0.08 |
| inspected-shape | narrow-overlay | 1200 | 1800 | 8 | 62.54 | 7.26 | 0.08 |
| inspected-shape | reduce-motion | 1200 | 1800 | 8 | 62.54 | 11.44 | 0.07 |
| 25k-stress | overview-collapsed | 1200 | 1800 | 8 | 114.86 | 11.07 | 0.10 |
| 25k-stress | overview-docked | 1200 | 1800 | 8 | 114.86 | 11.48 | 0.08 |
| 25k-stress | community | 1201 | 1800 | 14 | 114.86 | 11.54 | 0.08 |
| 25k-stress | node-focus | 1201 | 1800 | 14 | 114.86 | 11.78 | 0.08 |
| 25k-stress | path | 1205 | 1800 | 14 | 114.86 | 33.10 | 0.09 |
| 25k-stress | recent | 1201 | 1800 | 14 | 114.86 | 20.36 | 0.12 |
| 25k-stress | narrow-overlay | 1200 | 1800 | 8 | 114.86 | 11.83 | 0.07 |
| 25k-stress | reduce-motion | 1200 | 1800 | 8 | 114.86 | 8.37 | 0.08 |

Hosted WKWebView runtime evidence:

| Metric | p50 ms | p95 ms | CV |
| --- | ---: | ---: | ---: |
| panOrbitFrameTimeMs | 2.00 | 3.00 | 20.33% |
| hoverToHighlightMs | 10.00 | 11.00 | 6.67% |
| selectionToFirstFeedbackMs | 12.00 | 13.00 | 5.14% |
| sidebarOpenReframeMs | 12.00 | 13.00 | 3.40% |
| overviewCommunityTransitionMs | 55.00 | 58.20 | 4.11% |

Binding gates: interaction feedback pass; pan/orbit frame pass.
