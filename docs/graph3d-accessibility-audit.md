# Graph3D accessibility audit

Run the deterministic, public-safe source audit with:

```sh
node scripts/audit-graph3d-accessibility.mjs --write
```

It writes `outputs/graph3d-accessibility-audit.json` containing only token names,
composited colors, contrast ratios, control capability results, and test names.
It never reads a vault graph, node labels, paths, searches, notes, or screenshots.

The required runtime complement is:

```sh
xcodebuild test -project BrainBar.xcodeproj -scheme BrainBar \
  -only-testing:BrainBarTests/BrainBarTests/testGraph3DAccessibilityAuditUsesPublicFixture
```

That test uses the existing public synthetic renderer fixture and verifies actual
WKWebView accessibility names, DOM focusability, polite status updates, and rendered
24px minimum targets. The source audit verifies both `:focus` and `:focus-visible`
selectors plus their 2px solid outlines, because the headless WebKit document does
not receive system focus and therefore cannot reliably expose computed pseudo-state
styles. The source audit also records non-color evidence
for selected, path, and warning states: outline/scale and labels/numbered controls
for selected and paths; icon plus text for warnings.
