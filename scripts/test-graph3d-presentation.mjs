#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { generateFixture, loadFixtureManifest } from './generate-large-graph-fixtures.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const presentation = await import(pathToFileURL(join(
  root,
  'BrainBar/Resources/Graph3D/graph3d-presentation-utils.mjs'
)));

assert.equal(presentation.adaptiveDetailLevel(0), 'balanced');
assert.equal(presentation.adaptiveDetailLevel(2500), 'balanced');
assert.equal(presentation.adaptiveDetailLevel(12547), 'balanced');
assert.equal(presentation.adaptiveDetailLevel(16000), 'balanced');
assert.equal(presentation.adaptiveDetailLevel(16001), 'overview');
assert.deepEqual(presentation.presentationPaintBudget('overview', { communityCount: 64, promotionCount: 9 }), {
  detailLevel: 'overview',
  structuralNodeLimit: 7000,
  promotionAllowance: 9,
  paintedNodeLimit: 7009,
  structuralEdgeLimit: 7000
});

const zoomOverview = presentation.resolveZoomDetailLevel({ nodeCount: 25000, zoom: 0.69 });
assert.deepEqual(zoomOverview, {
  detailLevel: 'overview',
  detailReason: 'adaptive-default',
  nextAutoDetailLevel: 'overview'
});
const zoomBalanced = presentation.resolveZoomDetailLevel({
  nodeCount: 25000,
  zoom: 0.70,
  previousAutoDetailLevel: zoomOverview.nextAutoDetailLevel
});
assert.equal(zoomBalanced.detailLevel, 'balanced');
assert.equal(presentation.resolveZoomDetailLevel({
  nodeCount: 25000,
  zoom: 0.60,
  previousAutoDetailLevel: zoomBalanced.nextAutoDetailLevel
}).detailLevel, 'balanced');
assert.equal(presentation.resolveZoomDetailLevel({
  nodeCount: 25000,
  zoom: 0.58,
  previousAutoDetailLevel: zoomBalanced.nextAutoDetailLevel
}).detailLevel, 'overview');
const zoomFull = presentation.resolveZoomDetailLevel({
  nodeCount: 2000,
  zoom: 1.34,
  previousAutoDetailLevel: 'balanced'
});
assert.equal(zoomFull.detailLevel, 'full');
assert.equal(presentation.resolveZoomDetailLevel({
  nodeCount: 2000,
  zoom: 1.20,
  previousAutoDetailLevel: zoomFull.nextAutoDetailLevel
}).detailLevel, 'full');
assert.equal(presentation.resolveZoomDetailLevel({
  nodeCount: 2000,
  zoom: 1.18,
  previousAutoDetailLevel: zoomFull.nextAutoDetailLevel
}).detailLevel, 'balanced');
assert.equal(presentation.resolveZoomDetailLevel({ nodeCount: 9999, zoom: 9, userDetailLevel: 'overview' }).detailReason, 'user');
const automaticTransitionPlan = presentation.buildPresentationPlan({
  nodes: Array.from({ length: 2501 }, (_, index) => ({ id: `auto-${index}`, community: 'Auto' })),
  edges: [],
  detailLevel: 'overview',
  detailReason: 'adaptive-default',
  previousAutoDetailLevel: 'overview',
  zoom: 0.70,
  labelBudget: 0
});
assert.equal(automaticTransitionPlan.detailLevel, 'balanced');
assert.equal(automaticTransitionPlan.detailReason, 'adaptive-default');

const duplicateAndIdless = {
  nodes: [
    { id: 'a', community: 'One' },
    { id: 'b', community: 'One' },
    { id: 'c', community: 'Two' },
    { id: 'a', community: 'One' },
    { community: 'Ignored without a stable identity' }
  ],
  edges: [
    { source: 'a', target: 'b', relation: 'linked', source_file: 'A.md' },
    { source: 'a', target: 'b', relation: 'linked', source_file: 'A.md' },
    { source: 'a', target: 'missing', relation: 'invalid endpoint' }
  ]
};
const normalizedForward = presentation.normalizePresentationGraph(duplicateAndIdless.nodes, duplicateAndIdless.edges);
const normalizedReordered = presentation.normalizePresentationGraph(
  [...duplicateAndIdless.nodes].reverse(),
  [...duplicateAndIdless.edges].reverse()
);
assert.deepEqual(normalizedForward, normalizedReordered);
assert.deepEqual(normalizedForward.nodes.map((node) => node.id), ['a', 'b', 'c']);
assert.equal(normalizedForward.edges.length, 1);
assert.match(normalizedForward.edges[0].id, /^edge:[0-9a-f]{8}$/);

const goldenNodes = [
  { id: 'a', community: 'Alpha' },
  { id: 'b', community: 'Alpha' },
  { id: 'c', community: 'Alpha' },
  { id: 'd', community: 'Beta' },
  { id: 'e', community: 'Beta' },
  { id: 'f', community: 'Beta' }
];
const goldenEdges = [
  { id: 'ab', source: 'a', target: 'b' },
  { id: 'ac', source: 'a', target: 'c' },
  { id: 'de', source: 'd', target: 'e' },
  { id: 'df', source: 'd', target: 'f' },
  { id: 'bd', source: 'b', target: 'd' }
];
const goldenPlan = presentation.buildPresentationPlan({
  nodes: goldenNodes,
  edges: goldenEdges,
  userDetailLevel: 'overview',
  interaction: {
    searchNodeIds: ['f'],
    pathNodeIds: ['c', 'd'],
    pathEdgeIds: ['bd']
  },
  labelBudget: 0
});
assert.deepEqual(goldenPlan.paintedNodeIds, ['a', 'b', 'c', 'd', 'e', 'f']);
assert.deepEqual(goldenPlan.paintedEdgeIds, ['bd']);
assert.deepEqual([...goldenPlan.nodeTiersById.entries()].sort(), [
  ['a', 'B'], ['b', 'A'], ['c', 'A'], ['d', 'A'], ['e', 'D'], ['f', 'A']
]);
assert.deepEqual([...goldenPlan.communityAnchorByName], [['Alpha', 'a'], ['Beta', 'd']]);
assert.deepEqual(goldenPlan.diagnostics, {
  detailLevel: 'overview',
  detailReason: 'user',
  queryableNodeCount: 6,
  queryableEdgeCount: 5,
  paintedNodeCount: 6,
  paintedEdgeCount: 1,
  communityAnchorCount: 2,
  persistentLabelCount: 0
});

const workerMetadataPlan = presentation.buildPresentationPlan({
  nodes: goldenNodes,
  edges: goldenEdges,
  userDetailLevel: 'overview',
  structuralRanks: new Map([['f', 0], ['e', 1], ['a', 9]]),
  communityAnchors: new Map([['Beta', 'e']]),
  labelBudget: 0
});
assert.equal(workerMetadataPlan.communityAnchorByName.get('Beta'), 'e');
assert.equal(workerMetadataPlan.nodeTiersById.get('f'), 'B');
assert.equal(workerMetadataPlan.nodeTiersById.get('e'), 'B');
const typedWorkerRankPlan = presentation.buildPresentationPlan({
  nodes: goldenNodes,
  edges: goldenEdges,
  userDetailLevel: 'overview',
  structuralRanks: new Uint32Array([0, 1, 6, 7, 8, 9]),
  structuralRankNodeIds: [goldenNodes[5], goldenNodes[4], goldenNodes[3], goldenNodes[2], goldenNodes[1], goldenNodes[0]],
  labelBudget: 0
});
assert.equal(typedWorkerRankPlan.nodeTiersById.get('f'), 'B');

const priority = presentation.prioritizeEdges({
  edges: goldenEdges,
  interaction: {
    selectedNodeId: 'a',
    pathEdgeIds: ['bd'],
    edgeInspectorEdgeIds: ['de'],
    workflowEdgeIds: ['df']
  },
  communityByNodeId: new Map(goldenNodes.map((node) => [node.id, node.community]))
});
assert.deepEqual(priority.map((candidate) => [candidate.edgeId, candidate.priority]), [
  ['ab', 1], ['ac', 1], ['bd', 2], ['de', 3], ['df', 4]
]);

const labelCandidates = [
  { id: 'alpha', active: false, tier: 'B', degree: 9, point: { x: 10, y: 80 } },
  { id: 'beta', active: true, tier: 'D', degree: 0, point: { x: 150, y: 80 } },
  { id: 'gamma', active: false, tier: 'A', degree: 3, point: { x: 290, y: 80 } },
  { id: 'delta', active: false, tier: 'A', degree: 8, point: { x: 430, y: 80 } }
];
assert.deepEqual(
  presentation.allocateLabels({ candidates: labelCandidates, budget: 4 }).map((item) => item.id),
  ['beta', 'delta', 'gamma', 'alpha']
);
assert.deepEqual(
  presentation.allocateLabels({
    candidates: labelCandidates,
    budget: 4,
    safeRegions: [{ x: 150, y: 50, width: 120, height: 40 }]
  }).map((item) => item.id),
  ['delta', 'gamma', 'alpha']
);
const overlaySafeLabels = presentation.allocateLabels({
  candidates: [
    { id: 'obscured-by-sidebar', active: true, tier: 'A', degree: 12, point: { x: 370, y: 360 } },
    { id: 'left-safe', active: false, tier: 'B', degree: 9, point: { x: 80, y: 360 } }
  ],
  budget: 2,
  safeRegions: [{ x: 244, y: 16, width: 360, height: 688 }]
});
assert.deepEqual(overlaySafeLabels.map((item) => item.id), ['left-safe']);
for (const label of overlaySafeLabels) {
  const sidebar = { x: 244, y: 16, width: 360, height: 688 };
  const overlapWidth = Math.max(0, Math.min(label.rect.x + label.rect.width, sidebar.x + sidebar.width) - Math.max(label.rect.x, sidebar.x));
  const overlapHeight = Math.max(0, Math.min(label.rect.y + label.rect.height, sidebar.y + sidebar.height) - Math.max(label.rect.y, sidebar.y));
  assert.equal(overlapWidth * overlapHeight, 0, 'persistent labels must avoid the overlay sidebar safe region');
}
const boundedOverlayLabels = presentation.allocateLabels({
  candidates: [
    { id: 'off-left', active: true, tier: 'A', degree: 12, point: { x: -30, y: 360 } },
    { id: 'left-safe', active: false, tier: 'B', degree: 9, point: { x: 30, y: 360 } },
    { id: 'off-right', active: false, tier: 'B', degree: 8, point: { x: 590, y: 360 } },
    { id: 'behind-sidebar', active: false, tier: 'B', degree: 7, point: { x: 370, y: 360 } }
  ],
  budget: 4,
  bounds: { x: 10, y: 10, width: 600, height: 700 },
  safeRegions: [{ x: 244, y: 16, width: 360, height: 688 }]
});
assert.deepEqual(boundedOverlayLabels.map((item) => item.id), ['left-safe']);
for (const label of boundedOverlayLabels) {
  assert.ok(label.rect.x >= 10 && label.rect.y >= 10, 'accepted label must remain inside padded stage origin');
  assert.ok(label.rect.x + label.rect.width <= 610 && label.rect.y + label.rect.height <= 710, 'accepted label must remain inside padded stage extent');
}
const retainedCollision = presentation.allocateLabels({
  candidates: [
    { id: 'active', active: true, tier: 'A', degree: 9, point: { x: 10, y: 80 } },
    { id: 'retained', active: false, tier: 'B', degree: 8, point: { x: 105.5, y: 80 } }
  ],
  retainedLabelIds: ['retained'],
  budget: 2
});
assert.deepEqual(retainedCollision.map((item) => item.id), ['active', 'retained']);

const measuredBounds = presentation.allocateLabels({
  candidates: [
    { id: 'active-long', active: true, tier: 'A', degree: 9, point: { x: 20, y: 80 } },
    { id: 'overlapping-long', active: false, tier: 'B', degree: 8, point: { x: 120, y: 80 } },
    { id: 'separate-long', active: false, tier: 'B', degree: 7, point: { x: 220, y: 80 } }
  ],
  budget: 3,
  labelMetrics: () => ({ labelWidth: 120, labelHeight: 20 })
});
assert.deepEqual(measuredBounds.map((item) => item.id), ['active-long', 'separate-long']);
for (let index = 0; index < measuredBounds.length; index += 1) {
  for (let otherIndex = index + 1; otherIndex < measuredBounds.length; otherIndex += 1) {
    const left = measuredBounds[index].rect;
    const right = measuredBounds[otherIndex].rect;
    const overlap = Math.max(0, Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x))
      * Math.max(0, Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y));
    assert.equal(overlap, 0, 'accepted label rectangles must not exceed the approved zero-overlap limit');
  }
}

const largeNodes = Array.from({ length: 8000 }, (_, index) => ({
  id: `search-${String(index).padStart(4, '0')}`,
  community: `Community ${Math.floor(index / 100)}`
}));
const largeEdges = largeNodes.slice(1).map((node, index) => ({
  id: `search-edge-${index}`,
  source: largeNodes[index].id,
  target: node.id
}));
const hiddenSearchPlan = presentation.buildPresentationPlan({
  nodes: largeNodes,
  edges: largeEdges,
  userDetailLevel: 'overview',
  interaction: { searchNodeIds: ['search-7999'] },
  labelBudget: 0
});
assert.equal(hiddenSearchPlan.detailLevel, 'overview');
assert.equal(hiddenSearchPlan.queryableNodeCount, 8000);
assert.equal(hiddenSearchPlan.queryableEdgeCount, 7999);
assert.ok(hiddenSearchPlan.paintedNodeIds.includes('search-7999'));
assert.ok(hiddenSearchPlan.paintedNodeIds.length < hiddenSearchPlan.queryableNodeCount);
assert.deepEqual(Object.keys(hiddenSearchPlan.diagnostics).sort(), [
  'communityAnchorCount', 'detailLevel', 'detailReason', 'paintedEdgeCount',
  'paintedNodeCount', 'persistentLabelCount', 'queryableEdgeCount', 'queryableNodeCount'
]);

const reduceMotion = presentation.reduceMotionPolicy(true);
assert.deepEqual(reduceMotion, {
  reduceMotion: true,
  transitionDurationMs: 0,
  selectionFadeMs: 120,
  allowAmbientBreathing: false,
  allowEdgeFlow: false,
  allowRepeatedPulses: false
});

const stressNodes = Array.from({ length: 25000 }, (_, index) => ({
  id: `stress-${String(index).padStart(5, '0')}`,
  community: `C${Math.floor(index / 250)}`
}));
const stressEdges = stressNodes.slice(1).map((node, index) => ({
  id: `stress-edge-${String(index).padStart(5, '0')}`,
  source: stressNodes[index].id,
  target: node.id
}));
const startedAt = performance.now();
const stressPlan = presentation.buildPresentationPlan({
  nodes: stressNodes,
  edges: stressEdges,
  userDetailLevel: 'overview',
  interaction: { searchNodeIds: ['stress-24999'] },
  labelBudget: 0
});
const elapsedMs = performance.now() - startedAt;
assert.equal(stressPlan.queryableNodeCount, 25000);
assert.equal(stressPlan.queryableEdgeCount, 24999);
assert.ok(stressPlan.paintedNodeIds.includes('stress-24999'));
assert.ok(stressPlan.paintedNodeIds.length <= 7001);
assert.ok(stressPlan.paintedEdgeIds.length <= 7000);
assert.ok(elapsedMs < 750, `25k presentation planning took ${elapsedMs.toFixed(1)}ms`);

const fixtureManifest = await loadFixtureManifest();
const largeGoldenExpectations = new Map([
  ['inspected-shape', { minimumDensity: 0.55, defaultMinimumDensity: 0.65 }],
  ['25k-stress', { minimumDensity: 0.27 }]
]);
for (const definition of fixtureManifest.fixtures.filter((fixture) => largeGoldenExpectations.has(fixture.name))) {
  const fixture = generateFixture(definition);
  const ids = fixture.nodes.map((node) => node.id);
  const activeIds = [
    ids.at(-1), ids.at(-2), ids.at(-3), ids.at(-4), ids.at(-5),
    ids.at(-6), ids.at(-7), ids.at(-8), ids.at(-9)
  ];
  const interaction = {
    selectedNodeId: activeIds[0],
    hoverNodeId: activeIds[1],
    focusNodeIds: [activeIds[2]],
    searchNodeIds: [activeIds[3]],
    pathNodeIds: [activeIds[4], activeIds[5]],
    workflowNodeIds: [activeIds[6]],
    activityNodeIds: [activeIds[7]],
    storyNodeIds: [activeIds[8]]
  };
  const directOverview = presentation.buildPresentationPlan({
    nodes: fixture.nodes,
    edges: fixture.edges,
    userDetailLevel: 'overview',
    interaction,
    labelBudget: 0
  });
  const adaptiveDefault = presentation.buildPresentationPlan({
    nodes: fixture.nodes,
    edges: fixture.edges,
    interaction,
    labelBudget: 0
  });
  const started = performance.now();
  const index = presentation.buildPresentationIndex({ nodes: fixture.nodes, edges: fixture.edges });
  const indexBuildMs = performance.now() - started;
  const overview = presentation.buildPresentationPlan({
    index,
    userDetailLevel: 'overview',
    interaction,
    labelBudget: 0
  });
  const preparedNodes = fixture.nodes.map((node) => ({ id: String(node.id), community: String(node.community || 'Unassigned') }));
  const preparedEdges = fixture.edges.map((edge) => ({
    id: String(edge.id),
    source: String(edge.source ?? edge.from),
    target: String(edge.target ?? edge.to)
  }));
  const preparedOverview = presentation.buildPresentationPlan({
    index: presentation.buildPresentationIndex({ normalizedNodes: preparedNodes, normalizedEdges: preparedEdges }),
    userDetailLevel: 'overview',
    interaction,
    labelBudget: 0
  });
  const expected = largeGoldenExpectations.get(definition.name);
  assert.deepEqual(overview.paintedNodeIds, directOverview.paintedNodeIds, `${definition.name} indexed Overview node parity`);
  assert.deepEqual(overview.paintedEdgeIds, directOverview.paintedEdgeIds, `${definition.name} indexed Overview edge parity`);
  assert.deepEqual(preparedOverview.paintedNodeIds, directOverview.paintedNodeIds, `${definition.name} prepared Overview node parity`);
  assert.deepEqual(preparedOverview.paintedEdgeIds, directOverview.paintedEdgeIds, `${definition.name} prepared Overview edge parity`);
  assert.ok(overview.paintedNodeIds.length / overview.queryableNodeCount >= expected.minimumDensity, `${definition.name} Overview density floor`);
  assert.ok(overview.paintedNodeIds.length <= overview.paintBudget.paintedNodeLimit, `${definition.name} Overview node budget`);
  assert.ok(overview.paintedEdgeIds.length <= overview.paintBudget.structuralEdgeLimit, `${definition.name} Overview edge budget`);
  assert.ok(overview.paintedNodeIds.length < overview.queryableNodeCount, `${definition.name} Overview must declutter`);
  assert.ok(activeIds.every((id) => overview.paintedNodeIds.includes(id)), `${definition.name} must retain every active promotion`);
  assert.ok([...overview.communityAnchorByName.values()].every((id) => overview.paintedNodeIds.includes(id)), `${definition.name} must represent every community`);
  assert.equal(overview.activePromotionNodeCount, activeIds.length, `${definition.name} promotion count`);
  assert.equal(overview.structuralPaintedNodeCount, 7000, `${definition.name} structural node budget`);
  assert.equal(overview.paintBudget.paintedNodeLimit, 7000 + activeIds.length, `${definition.name} node budget formula`);
  if (expected.defaultMinimumDensity) {
    assert.equal(adaptiveDefault.detailLevel, 'balanced', `${definition.name} starts in Balanced`);
    assert.equal(adaptiveDefault.detailReason, 'adaptive-default', `${definition.name} exposes adaptive default reason`);
    assert.ok(adaptiveDefault.paintedNodeIds.length / adaptiveDefault.queryableNodeCount >= expected.defaultMinimumDensity, `${definition.name} default density floor`);
  }
  assert.ok(indexBuildMs < 750, `${definition.name} initial index took ${indexBuildMs.toFixed(1)}ms`);

  const reorderedIndex = presentation.buildPresentationIndex({
    nodes: [...fixture.nodes].reverse(),
    edges: [...fixture.edges].reverse()
  });
  const reordered = presentation.buildPresentationPlan({
    index: reorderedIndex,
    userDetailLevel: 'overview',
    interaction,
    labelBudget: 0
  });
  assert.deepEqual(reordered.paintedNodeIds, overview.paintedNodeIds, `${definition.name} Overview node order must be input-order independent`);
  assert.deepEqual(reordered.paintedEdgeIds, overview.paintedEdgeIds, `${definition.name} Overview edge order must be input-order independent`);

  const reorderedPrepared = presentation.buildPresentationPlan({
    index: presentation.buildPresentationIndex({
      normalizedNodes: [...preparedNodes].reverse(),
      normalizedEdges: [...preparedEdges].reverse()
    }),
    userDetailLevel: 'overview',
    interaction,
    labelBudget: 0
  });
  assert.deepEqual(reorderedPrepared.paintedNodeIds, preparedOverview.paintedNodeIds, `${definition.name} prepared Overview node order must be input-order independent`);
  assert.deepEqual(reorderedPrepared.paintedEdgeIds, preparedOverview.paintedEdgeIds, `${definition.name} prepared Overview edge order must be input-order independent`);

  const balanced = presentation.buildPresentationPlan({
    index,
    userDetailLevel: 'balanced',
    interaction,
    labelBudget: 0
  });
  assert.ok(balanced.paintedNodeIds.length > overview.paintedNodeIds.length, `${definition.name} Balanced must reveal more than Overview`);
  assert.ok(balanced.paintedNodeIds.length < balanced.queryableNodeCount, `${definition.name} Balanced must remain bounded`);
  assert.ok(activeIds.every((id) => balanced.paintedNodeIds.includes(id)), `${definition.name} Balanced must retain active promotions`);

  const full = presentation.buildPresentationPlan({
    index,
    userDetailLevel: 'full',
    interaction,
    labelBudget: 0
  });
  assert.deepEqual(full.paintedNodeIds, ids.slice().sort(), `${definition.name} Full must paint every valid node`);
  assert.deepEqual(full.paintedEdgeIds, fixture.edges.map((edge) => edge.id).sort(), `${definition.name} Full must paint every valid edge`);

  if (definition.name === '25k-stress') {
    const replanSamples = [];
    for (let sample = 0; sample < 12; sample += 1) {
      const replanStart = performance.now();
      const replan = presentation.buildPresentationPlan({
        index,
        userDetailLevel: 'overview',
        interaction: { ...interaction, hoverNodeId: ids[(sample * 2083) % ids.length] },
        labelBudget: 0
      });
      replanSamples.push(performance.now() - replanStart);
      assert.ok(replan.paintedNodeIds.includes(ids[(sample * 2083) % ids.length]));
    }
    const sortedReplans = replanSamples.slice().sort((left, right) => left - right);
    const replanP95 = sortedReplans[Math.ceil(sortedReplans.length * 0.95) - 1];
    assert.ok(replanP95 < 50, `25k indexed interaction replan p95 took ${replanP95.toFixed(1)}ms`);
  }
}

console.log(`Graph3D presentation tests passed. 25k overview plan: ${elapsedMs.toFixed(1)}ms.`);

function digestIds(ids) {
  return createHash('sha256').update(ids.join('\u0000')).digest('hex');
}
