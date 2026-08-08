# Changelog

All notable changes to BrainBar are documented here.

## Unreleased

## 0.10.0 - 2026-08-08

- Added an off-main, digest-bound graph data pipeline, cancellable loading states, retry recovery, and exact node/edge identity checks for large graphs.
- Moved deterministic 3D layout work into a Web Worker, replaced pairwise separation with bounded spatial work, and added a privacy-safe layout cache for repeated graph and Source Lens loads.
- Added Setup Doctor diagnostics, global filtered search, versioned 2D/3D session continuity, and saved local graph views.
- Added Change Radar with local rolling snapshots, deterministic diffs, a compact Change Inbox, bounded retention, and no vault writes.
- Replaced periodic Agent Activity vault scans with event-driven watching and incremental JSONL tailing; added exclusions, retention controls, metadata preview, and clear-history actions.
- Added explicit-ID Agent Workflows with versioned metadata, deterministic source/output/touched trails, pending-refresh paths, and additive graph highlighting.
- Added a shared Guided Maintenance evidence engine, unified 2D/3D inspectors, versioned Graph Check rules, and copy-only proposals that never mutate Markdown.
- Restored offline 2D Workbench rendering when Graphify provides `graph.html` by bundling pinned Vis Network 9.1.6, blocking the matching remote script, and loading the verified local runtime instead.
- Added pull-request CI, deterministic large-graph fixtures, renderer performance measurements, process deadlock regressions, and public-safety gates.
- Added Agent Workflows product documentation, including the explicit metadata-only boundary for future Hermes integration.

## 0.9.81 - 2026-06-16

- Restored smooth 3D drag and zoom performance by disabling the invisible WebGL render pass while keeping the full canvas graph visible.
- Disabled continuous living-graph animation loops by default and kept only low-cost static/reactive visual signals.
- Added adaptive 3D canvas pixel ratio for dense graphs to reduce Retina overdraw during camera movement.
- Reduced selected-node overlay cost for high-degree nodes by capping highlighted neighbor and edge work.
- Cached 3D graph metadata payloads and made Agent Activity polling/publishing lighter to reduce app-wide update pressure.

## 0.9.8 - 2026-06-15

- Added one-click Claude Agent Activity integration with a bundled Claude skill/plugin and managed `CLAUDE.md` fallback instructions.
- Added official Codex and Claude icons to Agent Activity rows and Settings integration status.
- Improved `brainbar-trace` agent detection so explicit `--agent`, environment hints, and parent process inference can distinguish Codex and Claude events.
- Updated the menu bar extra to use the official BrainBar mark as a correctly scaled template icon.
- Extended Agent Activity tests for Claude installation, managed instructions, and trace agent inference.

## 0.9.7 - 2026-06-14

- Added local Agent Activity overlay support with file activity, metadata-only JSONL events, the bundled `brainbar-trace` helper, and a one-click Codex integration installer.
- Added automatic Agent Activity log retention so event logs stay bounded without user cleanup.
- Refined Agent Activity visualization in 3D and compact activity/pending-refresh presentation in the sidebar.
- Reworked the app shell into a flatter premium macOS surface with shared theme tokens, quieter chrome, hidden non-actionable footer states, and a more native Settings layout.
- Polished 3D and 2D sidebar/control styling so graph panels feel like one restrained app surface instead of stacked web cards.
- Updated the app icon assets with the new monochrome mark.

## 0.9.6 - 2026-06-11

- Upgraded the 2D graph into a Workbench with operational views, Source Lens controls, searchable community details, Search Reveal, clearer Focus depth controls, Graph Check dashboard sections, stronger edge actions, and 2D-to-3D reveal/path/community bridge actions.
- Polished the 2D Workbench visual system with a calmer map canvas, quieter global edges, smaller ordered nodes, clearer search/focus/edge-inspector highlights, and more consistent toolbar, sidebar, tooltip, and panel styling.
- Strengthened 3D Living Graph polish with signal-flow edge currents, community breathing, and recent-note spark pulses.
- Softened the 3D Living Graph signal-flow pass so ambient motion remains visible without invasive flashes.
- Made 3D Explorer the default graph view and ordered the graph mode toggle as `3D` then `2D`.
- Added subtle 3D Living Graph polish with ambient breathing, recent-note warmth, and action response pulses that respect reduced-motion preferences.
- Clarified README onboarding copy around Graphify-powered graphs, Search Reveal, Recent Orbit, Graph Story v2, and release tagging.

## 0.9.5 - 2026-06-10

- Added 3D Search Reveal so search results can fly the camera to a visible node, highlight its local neighborhood, and act as a path target when `Start path` is armed.
- Improved 3D Explorer polish and performance with centralized interaction-mode cleanup, shared camera fitting, calmer label budgets, cached active overlays, capped large-community spotlight rendering, and grid-based pointer hit testing.
- Refined 3D Graph Story into a narrative tour card with concise takeaways, a primary note, limited supporting notes, and direct Focus/Open actions.

## 0.9.4 - 2026-06-09

- Added 3D Community Spotlight for highlighting a selected visible community with top notes, bridge notes, and a focused camera move.
- Optimized 3D Community Spotlight rendering for large communities by budgeting emphasized nodes and edges.
- Added 3D Daily/Recent Orbit for highlighting recently changed notes and tracing the active recent note to its nearest visible key note.
- Added 3D Graph Story, a deterministic guided tour through recent notes, key notes, communities, bridge notes, and needs-attention areas.
- Added 3D Path Compare for switching a traced route between Shortest visible, Different route, Best explained, Wikilinks-only, and Graphify-only variants.
- Clarified the 3D no-path state so disconnected nodes explain why compare variants are unavailable instead of showing only disabled options.
- Added deterministic 3D Explain Path summaries under Shortest Path, including provenance badges, bridge notes, community crossing notes, and conservative metadata caveats.
- Rewrote the README around the current 3D Explorer workflow, signed DMG install path, and release process.

## 0.9.3 - 2026-06-08

- Added Developer ID signing and Apple notarization for public release builds.
- Switched the public release asset from `BrainBar.zip` to notarized `BrainBar.dmg`.
- Added mounted-DMG verification in the release workflow using `codesign`, `stapler`, and `spctl`.
- Added a manual `Verify Release DMG` workflow that downloads the published release asset on a clean macOS runner and validates it independently.
- Updated the installer to download and install from the latest release DMG.

## 0.9.0 - 2026-06-08

- Added runtime 2D graph workflow views for Focus, Needs Links, Key Notes, Review, Recent, Wikilinks, Graphify, and Graph Check.
- Added clearer 2D workflow toolbar states with counts, hidden empty Review targets, disabled empty Recent view, and action panels.
- Added runtime-only file modification metadata from Swift so Recent can use real source-file mtimes when available.
- Added edge provenance inspection for selected graph connections, including source/target labels, relationship, source type, and source path when available.
- Added 3D Focus Orbit controls for focusing a selected node, expanding visible neighbors to depth 1-3, and returning to the full graph.
- Added 3D shortest path tracing with runtime-only path state, BFS over the visible graph, highlighted path nodes/edges, and a compact ordered path inspector.
- Added pure JS smoke coverage for focus filtering, edge provenance, and graph health calculations.
- Added optional Review Queue graph targets via `source_file` and `node_id` fields.
- Neutralized the failed Community Atlas direction as a default graph layout and restored a more stable 2D/3D runtime posture.
- Improved 3D Beta side-view readability by expanding graph depth proportionally to the visible layout.
- Refined README product positioning, feature tour, and Review Queue/3D Beta descriptions.
- Added updated public-safe README visuals for Source Lens, node navigation, and 3D Beta.

## 0.8.0 - 2026-06-03

- Added first-run product guidance for choosing a vault, checking Graphify output, and refreshing the graph.
- Added a System Status menu for quick local checks across Vault, Graph file, Graphify command, Git, Review Queue, and Brain Check.
- Refined the premium graph presentation with stronger native chrome, hollow 2D nodes, calmer visible edges, and a satin Dark Atlas sidebar.
- Renamed the public Source Lens label from Obsidian to Wikilinks while keeping the internal `obsidian` raw value compatible.
- Clarified the README positioning around BrainBar as a local-first macOS control center for seeing graphs, opening notes, and running local workflows.
- Tightened 2D/3D graph copy and sidebar proportions so the graph remains the primary surface.
- Added a generic local Review Queue dashboard for status-only checks, explicit manual actions, and an opt-in conservative background watcher that never runs mutating actions automatically.
- Extracted the 2D graph runtime into bundled JS/CSS resources for easier testing and profiling.
- Added JS smoke tests for Source Lens filtering, diff-only updates, Open Note payloads, and graph resource availability.
- Reduced repeated 2D graph work by avoiding automatic fit on lens switch and skipping unchanged hidden-state updates.
- Added an experimental custom 3D graph mode for the Focus Window.
- Added a session-only 2D/3D view switch that leaves the menu bar popover on the standard 2D graph.
- Added local bundled Three.js renderer assets for offline 3D graph rendering.
- Added 3D Source Lens support for All, Graphify, and Wikilinks graph layers.
- Added 3D node inspection and Open Note routing through the existing vault-safe source opener.
- Added documentation for the experimental 3D Focus Graph architecture and promotion criteria.

## 0.2.0 - 2026-05-27

- Added a dedicated 1280x640 GitHub social preview image.
- Refined the social preview banner with more native app chrome and quieter feature badges.
- Moved the real app screenshot lower in the README as product evidence instead of using it as the top banner.
- Ad-hoc sign release packages and verify the bundle before creating `BrainBar.zip`.
- Added release, GitHub repository, copyright, and MIT license links to Settings.
- Clarified the header Git badge so it explicitly refers to the configured vault.
- Added a session-only Graph Source Lens to switch between All, Graphify, and Wikilinks graph relationships.
- Fixed Graph Source Lens metadata loading by passing `graph.json` from Swift into WebKit.
- Stage the release app before signing so package verification is not affected by macOS extended attributes.

## 0.1.2 - 2026-05-26

- Added a real macOS app icon asset catalog so Finder no longer shows the default placeholder icon.
- Replaced the generated README preview SVG with a real public-safe BrainBar screenshot.

## 0.1.1 - 2026-05-26

- Added graph-first menu bar UI with embedded Graphify HTML view.
- Added Focus Window for larger graph exploration.
- Added runtime graph skin for generated Graphify output without modifying `graph.html`.
- Added Settings save confirmation and clearer Brain Check configuration copy.
- Added Graphify status based on generated graph modification time.
- Added footer refresh action for Graphify.
- Improved Settings window ordering when opened from the Focus Window.
- Updated README, installer guidance, and release documentation.

## 0.1.0 - 2026-05-26

- Initial native macOS menu bar app scaffold.
- Added local configuration at `~/Library/Application Support/BrainBar/config.json`.
- Added configurable vault path, Graphify refresh command, and brain check command.
- Added vault status, Git status, local graph server controls, installer, uninstaller, and GitHub Release packaging.
