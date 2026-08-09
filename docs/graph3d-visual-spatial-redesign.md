# BrainBar 3D Visual and Spatial Redesign

Status: implemented and owner-accepted for the v0.10 release candidate
Product scope: BrainBar v0.10 3D Focus Window
Decision state: release-review boundary accepted
Last updated: 2026-08-09

## Executive summary

BrainBar's 3D graph is functionally mature, complete, deterministic, and performant enough for the current large-graph contract. Its main weakness is now visual: a large vault is presented as a dense, uniformly weighted mass of nodes and edges. The renderer communicates that the graph is large, but it does not communicate its structure quickly enough.

This redesign turns the graph from a single dense cloud into a legible spatial system built around community islands, progressive detail, strong focus states, restrained edge rendering, intentional camera framing, and a collapsible context panel.

The redesign must not weaken the contracts established by Milestones 0–5:

- every valid source node and edge remains queryable;
- node and edge identity remains exact;
- layout remains deterministic for the same graph, lens, layout schema, and profile;
- Search, Focus, Path, Recent Orbit, Graph Story, Community Spotlight, Agent Activity, Workflows, Graph Check, Open Note, and Saved Views remain available;
- loading, cancellation, retry, latest-wins, privacy, and read-only behavior remain unchanged;
- large-graph performance remains within the approved budgets;
- presentation-level reduction is always disclosed as painted detail, never described as graph truncation.

The intended result is a Native Premium graph surface: dark, precise, calm, spatially expressive, and useful before it is decorative.

## 1. Problem statement

### 1.1 Current experience

The current renderer has strong foundations:

- `GraphDataStore` validates and versions the graph off-main;
- a dedicated Worker computes deterministic coordinates;
- the layout cache reuses coordinates by graph digest, lens, and schema;
- the complete graph remains queryable;
- the renderer exposes content-free diagnostics;
- a perspective camera provides an unambiguous spatial reading while semantic presets preserve predictable navigation;
- degree affects node radius and depth affects presence;
- active modes dim unrelated content;
- labels, paths, workflows, activity, recent notes, and hub glows use separate visual layers.

The default overview still has four structural problems:

1. Communities visually overlap into one rectangular cloud.
2. Most nodes receive similar visual weight.
3. Base edges remain visible together, creating texture rather than explanation.
4. The fixed sidebar removes graph space before the user selects anything.

The result is technically complete but cognitively expensive. A user cannot immediately answer:

- Where are the major areas of the vault?
- Which regions are dense, peripheral, or isolated?
- What matters now?
- Where is the selected node relative to its community?
- Which edges matter for the current task?

### 1.2 Design opportunity

The renderer should answer those questions through composition before the user reads a panel. The global view should reveal macro-structure; zoom and focus should progressively reveal local topology; explicit workflows should temporarily override ambient hierarchy without destroying context.

## 2. Goals and non-goals

### 2.1 Goals

1. Make major communities recognizable in under five seconds.
2. Make the selected node and its local neighborhood unambiguous.
3. Preserve orientation between overview, community, focus, and path modes.
4. Reduce edge noise without hiding graph availability.
5. Use the available window area efficiently at every sidebar state and aspect ratio.
6. Preserve stable spatial memory across loads, lenses, saved views, and mode changes.
7. Keep the renderer responsive on the inspected graph and bounded on the 25k stress fixture.
8. Keep motion purposeful, interruptible, and compatible with Reduce Motion.
9. Make every presentation trade-off observable through content-free diagnostics.

### 2.2 Non-goals

This project will not:

- replace Graphify's community assignment;
- infer semantic meaning not present in the graph;
- add note editing or graph mutation;
- introduce cloud processing, remote assets, or telemetry;
- make 3D a substitute for the 2D Workbench;
- expose physics sliders as the primary UX;
- add automatic camera tours or continuous rotation;
- change raw graph identity, edge normalization, or validation rules;
- weaken the missing-endpoint validation boundary;
- add Semantic Lens, Temporal Replay, federation, or another Later Bet.

## 3. Product principles

### 3.1 Structure before spectacle

Layout, hierarchy, contrast, and progressive disclosure take priority over glow, particles, animation, or decorative depth.

### 3.2 Complete is not the same as simultaneously painted

All graph identities remain queryable. The overview may paint a bounded structural representation. BrainBar must report queryable and painted counts truthfully.

### 3.3 Context survives focus

Selecting a node attenuates the wider graph instead of erasing it. Isolation remains an explicit action.

### 3.4 Stable space is a feature

The same graph and layout profile produce the same positions. A user can learn where communities live.

### 3.5 Color has one job at a time

Community color describes structure. Accent describes selection. Warning and success describe state. Agent and workflow overlays must not compete with all three simultaneously.

### 3.6 Motion explains change

Animation shows where the camera moved, what expanded, or which relationship became active. Motion must not exist merely to keep the graph alive.

## 4. Target experience

### 4.1 Opening the graph

The user sees separated community constellations instead of a full-edge cloud. The largest or most connected communities are identifiable through footprint and sparse labels. The sidebar is collapsed unless a Saved View explicitly restores it.

The HUD communicates:

- active Source Lens;
- total queryable nodes and edges;
- current painted detail level;
- current camera preset.

Example: `All · 12,799 nodes · 30,542 edges · Overview`.

### 4.2 Hovering

Hovering a node:

- raises its visual tier and label;
- reveals direct edges at higher contrast;
- gently attenuates unrelated marks;
- does not open the sidebar;
- does not change Saved View or session state.

### 4.3 Selecting

Selecting a node:

- opens the context panel;
- reframes only when the node lies outside a comfortable focus region;
- highlights incoming and outgoing evidence;
- preserves a faint view of the parent community;
- exposes Focus, Path, Open Note, and evidence actions.

### 4.4 Entering a community

Community Spotlight transitions from macro island to local constellation. Neighboring communities remain as muted orientation anchors. Returning to Overview restores the previous camera and panel state.

### 4.5 Following a path

The path becomes the dominant visual object. Path nodes and edges remain fully legible; alternative edges remain low-contrast context. Direction is shown through sparse travel motion or endpoint treatment, not arrows on every edge.

## 5. Spatial architecture

### 5.1 Two-level layout model

The next layout schema separates macro placement from local placement.

#### Level A: community supergraph

Build a compact supergraph where:

- each Graphify community is one macro node;
- macro-node weight is contained node count;
- macro-edge weight is cross-community edge count;
- deterministic ordering uses exact community identity;
- the largest connected macro component is centered;
- disconnected macro components occupy clearly separated peripheral regions.

The supergraph determines community centers and broad relationships. It must not scan every original edge during every visual frame.

#### Level B: local community layout

Within each community:

- local graph edges influence placement;
- high-degree nodes sit closer to the community center;
- leaves and orphans occupy outer regions;
- minimum separation scales with node count and community radius;
- the existing spatial-hash collision pass remains the bounded separation mechanism;
- local positions are normalized before translation into the macro volume.

### 5.2 Community volumes

Each community receives a deterministic ellipsoidal volume. Initial sizing rule:

`community radius ∝ sqrt(node count)`, clamped to reviewed minimum and maximum values.

Cross-community edges may slightly pull macro centers together, but may not collapse their boundaries.

The first implementation does not draw permanent hulls. Community identity comes from spacing, shared color, sparse labels, and optional focus halos. Hulls may be evaluated later only if they improve rather than obscure the graph.

### 5.3 Depth model

The owner-rejected first implementation showed that an orthographic camera makes the dense real vault read as a flat diagram. The accepted redesign uses a perspective camera with explicit framing and preserves camera position/target/zoom session compatibility. Depth becomes more legible through:

- deterministic community depth bands;
- bounded local depth variation;
- luminance and alpha attenuation;
- scale and halo attenuation;
- parallax during orbit;
- optional low-contrast guides in active community mode.

Perspective projection is the accepted rendering path. It requires matched usability and session compatibility checks before final acceptance.

### 5.4 Determinism and cache identity

Any algorithm change requires a new layout schema version.

The layout cache key remains based on:

- layout schema version;
- authoritative raw graph digest;
- normalized Source Lens;
- layout profile, if more than one deterministic profile is introduced.

Viewport width, sidebar width, and transient detail level must not enter the coordinate-cache key. World layout remains stable; camera framing adapts to the viewport.

## 6. Progressive detail

### 6.1 User-facing levels

| Level | Purpose | Default presentation |
| --- | --- | --- |
| Overview | Understand macro structure | Community anchors, structural hubs, sparse cross-community edges, minimal labels |
| Balanced | Explore normal topology | More local nodes, selected community detail, bounded local edges |
| Full | Inspect dense topology | All valid nodes and edges eligible for painting, using frame-safe batching |

Adaptive starting behavior:

- graphs up to 16,000 nodes start in Balanced; this keeps a 12–13k vault at 65–80% painted density without selecting Full;
- graphs above 16,000 nodes start in bounded Overview (7,000 nodes and 7,000 edges); Balanced is bounded at 10,000 nodes and 12,000 edges;
- Saved Views may restore an explicit level.

These thresholds are accepted by the visual and 25k bounded-plan gates.

### 6.2 Queryable versus painted

Progressive painting must never change the searchable source index.

Diagnostics expose:

- `queryableNodeCount`;
- `queryableEdgeCount`;
- `paintedNodeCount`;
- `paintedEdgeCount`;
- `detailLevel`;
- `detailReason`: `user`, `adaptive-default`, `focus-override`, or `performance-degrade`.

A hidden search result remains revealable. Reveal temporarily promotes the node, community anchor, and required path into the painted set.

### 6.3 Structural selection

Always paint:

- selected, hovered, focused, searched, path, workflow, activity, and story nodes;
- community anchors;
- nodes required by an active interaction;
- endpoints of active evidence edges.

Then paint, in order:

1. top-degree nodes per community;
2. cross-community bridge endpoints;
3. recently changed nodes in Recent context;
4. deterministic representatives preserving community shape.

Representative selection must never use randomness or array-index identity.

### 6.4 Hysteresis

Automatic transitions use separate enter and exit thresholds so small zoom changes do not repeatedly add and remove marks.

- User-selected detail overrides automatic changes until Reset.
- Interaction promotion does not permanently change the chosen level.
- Detail changes animate opacity and scale, not positions.

## 7. Node visual system

### 7.1 Tiers

| Tier | Meaning | Default treatment |
| --- | --- | --- |
| A | Selected, active path/workflow, explicit reveal | Solid core, bright outline, label, restrained halo |
| B | Community anchor or top structural hub | Larger ring/core, persistent label where space allows |
| C | Relevant local node | Standard ring, hover/local-focus label |
| D | Peripheral context | Small low-contrast mark, no persistent label |

Initial static classification:

- Tier B: community anchor and top 1% degree within the visible lens;
- Tier C: next 9% degree or explicit graph-health attention;
- Tier D: remaining nodes.

Percentiles are provisional. Dynamic interaction state always overrides static tier.

### 7.2 Construction

A node consists of:

1. low-opacity filled core;
2. community-colored outer ring;
3. optional state ring or halo;
4. separately rendered interaction label.

Only Tier A and a bounded number of Tier B nodes may use blur or glow in the same frame. Ambient glow on hundreds of nodes is prohibited.

### 7.3 State encoding

- Community: outer-ring hue.
- Selection: BrainBar accent outline and scale lift.
- Recent: warm secondary ring or brief pulse.
- Agent Activity: source-specific activity marker.
- Workflow: additive highlight that preserves community identity.
- Warning: warning marker, not total recoloring.
- Hidden by active mode: reduced alpha unless explicitly isolated.

Color must not be the sole representation of selection, warning, or workflow state.

## 8. Edge visual system

### 8.1 Base edges

In Overview:

- local background edges are omitted or near-background;
- a bounded structural set of cross-community edges remains visible;
- blending must not create a bright central haze.

In Balanced:

- edges adjacent to painted nodes may appear at restrained contrast;
- local edges remain subordinate to node structure.

In Full:

- all valid edges are eligible for painting;
- frame-safe batching and density-based alpha remain allowed;
- HUD and diagnostics identify Full as a dense mode.

### 8.2 Active-edge priority

1. Selected-node neighborhood.
2. Active path.
3. Edge-inspector target.
4. Workflow trail.
5. Recent or story trail.
6. Ambient structural edges.

An active path may use slow directional motion when Reduce Motion is off. It stops when the path is inactive.

### 8.3 Direction and provenance

Direction appears only for path motion, inspected endpoints, selected incoming/outgoing groups, and explicitly declared workflow source-to-output trails. Do not add arrowheads to every edge.

## 9. Labels and typography

### 9.1 Policy

Overview may show community names, a bounded set of hubs, and the selected/revealed node. Balanced may add local hubs, hovered neighbors, and active search results. Full does not imply all labels.

### 9.2 Collision allocation

The allocator must:

- sort by active state, tier, degree, then stable identity;
- reserve selected and path labels first;
- avoid HUD and sidebar-safe regions;
- reject overlaps beyond the approved limit;
- retain labels during small camera motion to reduce flicker;
- use a leader line only for the selected node when necessary.

### 9.3 Type scale

- Community: 12–13 px semibold.
- Selected node: 12 px semibold.
- Hover label: 11 px medium.
- HUD/metadata: 10–11 px.

Use the existing native type stack. Labels may use subtle dark backing at high density but must not become floating cards.

## 10. Color, depth, and atmosphere

### 10.1 Background

Retain the dark blue-black BrainBar surface with:

- calm focus-centered radial emphasis;
- restrained edge vignette;
- no visible decorative grid by default;
- no unrelated star-field particles.

### 10.2 Community palette

Use approximately 12 luminance-balanced hues. Additional communities reuse families but stay distinguishable through separation and labels.

Requirements:

- sufficient ring contrast against the canvas;
- selected accent distinct from community hue;
- warning/success/error reserved for state;
- monochrome and color-vision QA.

### 10.3 Depth cues

Combine alpha attenuation, slight radius attenuation, reduced far-plane saturation, lower distant-edge contrast, parallax, and stronger near-plane labels. Active path and selected nodes remain discoverable at every depth.

## 11. Camera and navigation

### 11.1 Presets

- Overview.
- Community.
- Node Focus.
- Active Path.
- Recent Orbit.
- Manual.

Each preset defines target, zoom range, tilt, safe margins, and sidebar compensation.

### 11.2 Transitions

Use interruptible transitions around 320–480 ms.

- User input cancels immediately.
- Target and zoom interpolate together.
- No overshoot or elastic easing.
- Back restores previous semantic state and camera.
- Reduce Motion uses immediate change or short fade.
- Saved View restore has no introductory animation.

### 11.3 Framing

Camera fitting accounts for stage dimensions, sidebar state, HUD bounds, selected label, aspect ratio, and breathing margin. Sidebar changes never recompute graph coordinates. Known presets reframe; Manual camera remains unless its target becomes occluded.

### 11.4 Orientation history

Maintain a bounded semantic stack, for example Overview → Community → Node Focus → Path. Manual movement updates the current entry rather than creating one per frame.

## 12. Sidebar and controls

### 12.1 States

- Collapsed: compact affordance only.
- Overlay: floats above the graph on constrained widths.
- Docked: resizable persistent panel on wide windows.

Defaults:

- Overview starts Collapsed.
- Node selection opens Docked on wide windows and Overlay on narrow windows.
- Explicit user state restores locally.
- Search may open without forcing the inspector.

### 12.2 Width

- Minimum Docked: 300 px.
- Preferred: 340–380 px.
- Maximum: 44% of window width.
- Overlay margins: 16 px.

Replace the current fixed `minmax(308px, 25vw)` with stateful classes or data attributes.

### 12.3 Persistent controls

- Detail: Overview / Balanced / Full.
- Fit/Overview camera.
- Sidebar toggle.
- Existing native renderer and Source Lens controls.

Advanced rendering and physics controls remain diagnostics, not product UI.

## 13. Motion and feedback

### 13.1 Ambient motion

Allowed ambient families are recent-node warmth, explicit activity/workflow motion, and subtle community breathing while idle. Only one ambient family should dominate at a time.

### 13.2 Interaction feedback

- Hover begins within one visible frame where possible.
- Selection ring and label appear before camera motion finishes.
- Mode changes confirm the semantic target before moving the composition.
- Loading keeps the current ready graph visible when possible.

### 13.3 Reduced Motion

Disable breathing, sparks, flowing edges, and repeated pulses. Use immediate state or short fades. Preserve direction, selection, hierarchy, and all features without animation.

## 14. Accessibility

The redesign preserves or adds:

- keyboard focus for controls and sidebar actions;
- visible focus rings;
- non-color selection and warning indicators;
- accessible names for Detail/sidebar controls;
- status announcements for detail and focus changes;
- sufficient text/control contrast;
- no-motion direction equivalents;
- minimum 24 px pointer targets, 32 px preferred for primary toolbar actions.

Search results, context, communities, paths, evidence, and actions remain accessible through DOM controls even though the canvas is visual.

## 15. State, persistence, and privacy

### 15.1 Session fields

The next compatible `GraphSessionState` schema should consider:

- `detailLevel`;
- `sidebarState`;
- `sidebarWidth` when Docked;
- camera preset;
- existing camera position/target;
- bounded semantic parent context, only if compact and content-free.

New fields require normalization, defaults, future-version rejection, 2D preservation, and Saved View codec tests. 2D preserves 3D-only fields without rendering them.

### 15.2 Privacy

Persist display state and permitted graph identities only. Never persist labels, note contents, graph payloads, search history, or inferred summaries as part of this redesign.

## 16. Technical architecture

### 16.1 Expected files

- `BrainBar/Resources/Graph3D/graph3d-layout-utils.mjs`
- `BrainBar/Resources/Graph3D/graph3d-layout-worker.mjs`
- `BrainBar/Resources/Graph3D/graph3d-layout-cache.mjs`
- `BrainBar/Resources/Graph3D/graph3d.js`
- `BrainBar/Resources/Graph3D/graph3d.css`
- `BrainBar/Resources/Graph3D/index.html`
- `BrainBar/AppModel.swift`
- `BrainBar/Views/Graph3DWebView.swift`
- `BrainBarTests/BrainBarTests.swift`
- `scripts/test-graph-runtime.mjs`
- `scripts/benchmark-graph3d-layout.mjs`
- `docs/performance-testing.md`

The list may shrink after implementation design. Create a new module only for an independently testable concern such as community layout or painted-set selection.

### 16.2 Renderer layers

Preserve the current separation:

1. WebGL geometry for interaction/raycasting;
2. cached static visual canvas for base nodes/edges;
3. active canvas for hover, selection, paths, activity, workflows, labels, and motion;
4. DOM sidebar/controls for accessible interaction.

Progressive detail updates visual and hit-test representations consistently. Queryable search data remains separate from painted geometry.

### 16.3 Worker output

The Worker may return ordered coordinates, deterministic community centers, normalized community bounds, and compact structural ranks. It must not return labels, paths, or note content. Prefer typed arrays and validate every buffer under existing generation/lens/revision/epoch latest-wins guards.

### 16.4 Failure behavior

If layout validation fails:

- never commit partial coordinates;
- report a generic content-free failure;
- keep the previous ready graph when available;
- expose Retry;
- do not fall back to synchronous main-thread layout;
- a legacy Worker fallback is allowed only behind an explicit tested schema boundary during rollout.

## 17. Performance contract

### 17.1 Existing budgets remain binding

| Fixture | Load p95 | Layout p95 | Lens p95 | Search p95 |
| --- | ---: | ---: | ---: | ---: |
| Inspected shape | 1,500 ms | 1,000 ms | 1,200 ms | 40 ms |
| 25k stress | 4,000 ms | 3,000 ms | 3,500 ms | 80 ms |

Exact queryable identity parity and zero renderer exceptions remain prerequisites.

### 17.2 New presentation measurements

Baseline before approving gates:

- static-layer rebuild duration by detail level;
- painted node and edge counts;
- pan/orbit frame time;
- hover-to-highlight latency;
- selection-to-first-feedback latency;
- sidebar-open reframe time;
- Overview ↔ Community transition duration;
- label allocation duration;
- memory delta for structural ranks/community metadata.

Candidate goals, subject to owner approval after measurement:

- interaction feedback p95 ≤ 50 ms on inspected shape;
- camera manipulation p95 ≤ 33 ms/frame in Overview and Balanced;
- no new main-thread task above 100 ms during cached load;
- exact deterministic coordinates for identical inputs after schema freeze;
- no content-bearing cache or diagnostic fields.

### 17.3 Degradation policy

Frame-pressure degradation may reduce ambient animation, glow count, device pixel ratio, nonessential labels, and background edges.

It must not reduce queryable identities, selected/path/workflow/search/evidence marks, accessibility, status feedback, or explicit Full detail without visible explanation.

## 18. Diagnostics

Extend `brainBarRendererDiagnostics()` with content-free values:

- `layoutSchemaVersion`;
- `layoutProfile`;
- `detailLevel` and `detailReason`;
- `paintedNodeCount` and `paintedEdgeCount`;
- `communityAnchorCount`;
- `persistentLabelCount`;
- `sidebarState`;
- `cameraPreset`;
- `staticLayerRebuildMs`;
- `labelAllocationMs`;
- `frameQuality`.

Never include node IDs, labels, paths, community names, search queries, or payload fragments.

## 19. Implementation plan

### Phase 0 — Baseline and visual contract

Deliverables:

- capture public-safe Overview, Community, Node Focus, Path, and Recent states;
- record presentation metrics on 1k, inspected-shape, and 25k fixtures;
- freeze initial palette and node-tier examples;
- add deterministic structural-rank and community-supergraph tests;
- approve the next layout schema number before cache writes.

Exit: current behavior and targets are measurable without private graph content.

### Phase 1 — Declutter without coordinate changes

Deliverables:

- Detail control and painted diagnostics;
- reduced base-edge rendering;
- node tier styling;
- bounded labels;
- Collapsed/Overlay/Docked sidebar;
- safe camera reframe on panel changes.

Exit: current coordinates become materially clearer without identity, session, or performance regression.

### Phase 2 — Community-island layout

Deliverables:

- deterministic community supergraph;
- bounded community volumes;
- normalized local layouts;
- Worker payload/result validation;
- cache schema bump;
- coordinate digest tests;
- failure and stale-result tests.

Exit: reorder-stable inputs generate identical centers/coordinates; inspected communities are visibly separated; M1 budgets pass.

### Phase 3 — Progressive disclosure

Deliverables:

- Overview/Balanced/Full painted-set logic;
- deterministic representatives;
- zoom hysteresis;
- interaction promotion;
- unpainted search-result reveal;
- truthful HUD/diagnostics.

Exit: every identity remains reachable; active objects survive reduction; painted counts match golden results.

### Phase 4 — Camera and orientation

Deliverables:

- formal presets;
- interruptible transitions;
- semantic Back stack;
- sidebar-safe framing;
- Reduced Motion behavior;
- Saved View/session schema migration.

Exit: Overview → Community → Node → Path → Back restores context/camera; 2D round trips preserve 3D-only fields.

### Phase 5 — Polish and acceptance

Deliverables:

- final palette/depth attenuation;
- accessible controls/announcements;
- public-safe screenshots;
- performance proof and full regression suite;
- manual Instruments whole-renderer memory run;
- release notes and updated documentation.

Exit: owner accepts real-vault visual result; CI and renderer gates pass; no privacy, mutation, identity, loading, or accessibility regression remains.

## 20. Test strategy

### 20.1 Pure JavaScript

Test deterministic supergraph, radius calculation, local normalization, reorder stability, duplicate/id-less edges, painted-set selection, hysteresis, label ordering, active promotion, cache schema rejection, and Reduced Motion logic.

### 20.2 Swift and bridge

Test session defaults/migration, future-schema rejection, Saved View round trips, 2D preservation, commands before graph ready, stale callbacks, cancellation/retry, and content-free diagnostics.

### 20.3 Production WKWebView

Test real custom-scheme Worker load, exact queryable identities, deterministic painted counts, hidden search reveal, semantic camera transitions, sidebar changes without coordinate changes, Reduced Motion, cache miss/write/hit/corruption/schema invalidation, and viewport/activity/workflow replay after commit.

### 20.4 Visual QA matrix

Capture the matched core matrix on the same public 1k fixture at 1000×720,
with the same coordinate fingerprint, for:

- Overview collapsed and docked;
- Community Spotlight;
- selected hub and peripheral node;
- active path;
- Recent Orbit;
- Agent Activity;
- Workflow highlight;
- Graph Check;
- Reduce Motion.

Keep the inspected-shape Overview captures as supplemental large-shape evidence.
Capture narrow-window Overlay separately at its deliberate responsive viewport;
it is not part of the matched core comparison.

Review community separation, centering, breathing room, hierarchy, edge noise, labels, contrast, occlusion, orientation, and clipping.

## 21. Acceptance criteria

### Structure

- Major communities are distinguishable in the inspected-shape overview.
- The graph no longer reads as one uniformly dense rectangle.
- Selected relationships remain legible without erasing all context.

### Space

- Canvas uses the viewport with reviewed margins.
- Sidebar changes do not clip or permanently offset the graph.
- Presets frame targets consistently.

### Hierarchy

- Selection and structural importance do not rely only on color.
- Background edges remain subordinate.
- Labels are bounded, stable, and collision-aware.

### Interaction

- Hover, select, focus, path, search reveal, and Back remain predictable.
- Camera transitions are interruptible.
- Reduce Motion preserves semantics.

### Integrity

- Exact node-ID and edge-identity parity passes.
- No graph mutation is introduced.
- Cache/diagnostics remain metadata-only.
- Invalid graphs keep explicit validation behavior.

### Performance

- Approved M1 budgets stay green.
- New presentation gates are measured and approved before merge.
- 25k remains a stress gate, not a Full-detail default promise.

## 22. Risks and mitigations

### Community assignments can change after refresh

Layout stability applies to the same digest/schema. Change Radar explains graph changes; Saved Views restore semantic targets and reframe when coordinates legitimately change.

### Progressive detail may look like missing data

Keep queryable counts visible, label Detail, expose Full, and prove hidden-result reveal.

### Community layout may increase Worker time

Compute on the compact supergraph, retain bounded local algorithms, transfer typed arrays, benchmark before/after, and reject changes that break M1 budgets.

### Visual encodings may compete

Use priority: selection/path → workflow/activity → community → ambient. Only one primary and one secondary overlay dominate simultaneously.

### Sidebar animation may disorient

Never move world coordinates. Reframe known presets only and preserve Manual camera unless occluded.

### Perspective navigation must remain restrained

Perspective is required to avoid a flat first impression. Camera framing, range limits, semantic Back, and Reduce Motion remain the controls that make it predictable rather than decorative.

## 23. Decisions resolved here

- The original plan placed the redesign after v0.10. Because v0.10 was not yet public, the owner accepted folding the verified redesign into the first v0.10 release candidate on 2026-08-09.
- The default 3D renderer uses a bounded 48° perspective projection and an oblique Overview camera.
- The spatial metaphor is community islands/constellations.
- Progressive detail affects painting, never queryability.
- Overview, Balanced, and Full are the only user-facing detail levels.
- Sidebar states are Collapsed, Overlay, and Docked.
- World coordinates remain independent of viewport/sidebar size.
- Every layout change bumps cache schema.
- Edge reduction precedes decorative effects.
- No automatic orbit, particle field, or global arrowheads ship.

## 24. Open implementation questions

Answer these through prototype or measurement:

1. Which community-radius clamp fits 1k, inspected-shape, and 25k?
2. How many hub/community labels fit at the reference viewport?
3. Which Overview node/edge painting budgets are clearest?
4. Should disconnected components share a peripheral band or separate depth bands?
5. At what width should Docked become Overlay?
6. Does a focus-centered radial background improve orientation?
7. Can complete hit-test geometry coexist with reduced visual painting within budget?
8. Which transition duration remains calm during repeated focus actions?

## 25. Recommended first implementation package

1. Add Detail state and content-free painted diagnostics.
2. Reduce base-edge density/contrast by detail level.
3. Add deterministic node tiers and bounded labels.
4. Add Collapsed/Overlay/Docked sidebar states.
5. Make camera fitting sidebar-aware without changing coordinates.
6. Capture matched visual and performance evidence.

Only after acceptance should the branch change Worker layout and invalidate coordinate cache. This separates visual-system risk from spatial-algorithm risk and gives community islands a cleaner baseline.

## 26. Implementation backlog

| ID | Slice | Size | Depends on | Required evidence |
| --- | --- | --- | --- | --- |
| G3D-00 | Capture visual/performance baseline and approve presentation metrics | S | None | Public-safe captures, fixture reports, accepted targets |
| G3D-01 | Add normalized Detail state and queryable/painted diagnostics | M | G3D-00 | Pure state tests, WebKit diagnostics test, privacy scan |
| G3D-02 | Implement detail-aware base-edge selection and opacity | M | G3D-01 | Deterministic edge-set goldens, matched screenshots, frame metrics |
| G3D-03 | Implement deterministic node tiers and visual tokens | M | G3D-01 | Tier goldens, color/contrast review, inspected fixture capture |
| G3D-04 | Add bounded collision-aware label allocator | M | G3D-03 | Allocation goldens, camera-motion stability test, visual matrix |
| G3D-05 | Add Collapsed/Overlay/Docked sidebar and resize behavior | M | G3D-00 | Responsive WebKit tests, accessibility checks, no coordinate changes |
| G3D-06 | Make camera fitting sidebar-safe and add reviewed presets | M | G3D-05 | Framing matrix, Manual-camera preservation, Reduce Motion |
| G3D-07 | Build deterministic community supergraph | L | G3D-00 | Reorder/golden tests, 1k/inspected/25k benchmark |
| G3D-08 | Normalize local layouts into bounded community volumes | L | G3D-07 | Separation invariants, coordinate digests, inspected visual proof |
| G3D-09 | Bump and validate layout cache schema | M | G3D-08 | Cold/store/hit/corrupt/stale WebKit tests |
| G3D-10 | Implement Overview/Balanced/Full painted-set selection | L | G3D-02, G3D-03, G3D-08 | Exact queryable parity, painted goldens, search reveal, hysteresis |
| G3D-11 | Add interruptible camera transitions and semantic Back | L | G3D-06, G3D-10 | Round-trip state matrix, cancellation, 2D preservation |
| G3D-12 | Complete accessibility, full performance proof, and visual acceptance | L | G3D-01–11 | CI, renderer harness, Instruments, owner acceptance |

Sizes are relative implementation complexity, not calendar estimates. Each slice must remain independently reviewable and must not include unrelated product functionality.

## 27. Rollout and branch strategy

### 27.1 Release separation

The redesign was implemented on a dedicated branch to keep its evidence separate from the original v0.10 release-candidate work. On 2026-08-09 the owner chose to include the accepted branch in the first public v0.10 release rather than publish an immediately superseded build. The dedicated branch is:

`codex/graph3d-visual-spatial-redesign`

The planning document may remain visible in the 0.10 repository history, but production renderer changes belong to the later branch.

### 27.2 Internal rollout

During development:

- use a query-gated or test-only renderer mode for the new layout;
- keep production default on the accepted renderer until the current slice passes;
- do not expose a user-facing “legacy/new renderer” toggle unless owner testing proves it necessary;
- keep old and new layout cache schemas isolated;
- ensure a failed new-layout request cannot read or overwrite the previous schema record.

### 27.3 Cutover

The new visual system becomes default only when:

- exact identity and feature parity pass;
- inspected and 25k budgets pass;
- public-safe visual comparisons are accepted;
- Saved View migration passes;
- the fallback does not depend on synchronous layout;
- rollback consists of switching the layout schema/default path, not reverting unrelated M0–M5 work.

### 27.4 Commit discipline

Prefer one bounded commit per accepted slice. Raw measurement reports remain in the existing reviewed `outputs/` convention when required by performance-proof workflows. Temporary screenshots and private-vault captures must not be committed.

## 28. Definition of ready and done

### Definition of ready for an implementation slice

A slice is ready when:

- its input/output contract is explicit;
- the affected renderer state and files are known;
- deterministic fixtures cover the intended behavior;
- privacy and identity invariants are listed;
- the before measurement or visual reference exists;
- any proposed numeric gate is either already approved or clearly marked provisional.

### Definition of done for an implementation slice

A slice is done when:

- production code and focused tests pass;
- no existing graph mode regresses;
- `git diff --check`, JS syntax, runtime smoke, and relevant XCTest gates pass;
- diagnostics remain content-free;
- before/after evidence matches the declared success criterion;
- documentation reflects the implemented boundary rather than the intended one;
- no user-owned or unrelated worktree changes are included.

### Definition of done for the redesign

The redesign is done only after Phase 5 acceptance, not when the new layout first renders. A visually attractive prototype without identity parity, recovery behavior, accessibility, performance evidence, or state migration is not a shippable BrainBar redesign.

## 29. Owner-correction acceptance gates

The real-vault review rejected a flat, sparse Overview. The replacement implementation must prove all of the following before visual approval:

- layout schema 4 coordinates have a central Y/major-axis q05–q95 span ratio of at least 0.22 on the inspected-like fixture;
- non-primary disconnected components are packed inside a compact envelope rather than placed by a cumulative peripheral cursor;
- the adaptive default is Balanced through 16,000 nodes, with a 12,547-node fixture painting at least 65% of identities while remaining queryable and bounded;
- 25k starts in bounded Overview; Full remains explicit, and HUD exposes both painted and queryable counts;
- the default camera is perspective and oblique; Fit is sidebar-safe and manual resize never mutates coordinates;
- click hit testing follows the rendered projected layer, and double-click enters Node Focus rather than opening a note unexpectedly.

The public fixture capture records the accepted frame metrics: inspected-like Overview uses Balanced with 10,000/12,547 nodes painted (79.70%), projected coverage 67.58% × 58.12% without crop; the 1k capture covers 60.15% × 69.74%. The Detail control mirrors the adaptive level, including the 1k Balanced and 25k Overview defaults.

## 30. References

- `BrainBar/Resources/Graph3D/graph3d.js`
- `BrainBar/Resources/Graph3D/graph3d.css`
- `BrainBar/Resources/Graph3D/graph3d-layout-utils.mjs`
- `BrainBar/Resources/Graph3D/graph3d-layout-worker.mjs`
- `BrainBar/Resources/Graph3D/graph3d-layout-cache.mjs`
- `BrainBar/AppModel.swift`
- `BrainBar/Views/Graph3DWebView.swift`
- `docs/innovation-plan.md`
- `docs/performance-testing.md`
- `docs/brainbar-3d-entrypoints.png`
