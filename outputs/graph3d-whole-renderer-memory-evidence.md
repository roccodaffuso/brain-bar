# Graph3D whole-renderer memory evidence

Reference host: MacBook Air Mac15,12, Apple M3 (8 cores), 16 GiB memory, macOS
26.5.2 (build 25F84).

One focused, visible-`WKWebView` XCTest completed in 3.110 s while sequentially
loading the public 1k, inspected-shape, and 25k-stress fixtures. During a
3.172-second synchronized all-process Activity Monitor capture, the maximum
sampled family physical footprint was 827,215,760 bytes (788.89 MiB), observed
at 8.704 seconds. The count is the sum of the application/test process,
WebKit GPU, Networking, WebContent, and supporting media helper samples.

This is a maximum sampled physical footprint, not a true peak, allocation or
leak proof, or a memory-budget pass. Numeric whole-renderer memory budgets
remain owner-pending.

The separate 15-scenario/WebView capture reached 3,196,977,184 bytes
(3,048.88 MiB) with 14 concurrent WebContent processes. It is an upper bound
for the measurement harness under concurrency, not product single-view memory.

The machine-readable companion is
`outputs/graph3d-whole-renderer-memory-evidence.json`; the raw performance
capture is intentionally not checked in.
