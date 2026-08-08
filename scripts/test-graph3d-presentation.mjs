#!/usr/bin/env node
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const presentation = await import(pathToFileURL(join(
  root,
  'BrainBar/Resources/Graph3D/graph3d-presentation-utils.mjs'
)));

assert.equal(presentation.adaptiveDetailLevel(0), 'balanced');
assert.equal(presentation.adaptiveDetailLevel(2500), 'balanced');
assert.equal(presentation.adaptiveDetailLevel(2501), 'overview');

const zoomOverview = presentation.resolveZoomDetailLevel({ nodeCount: 4000, zoom: 0.69 });
assert.deepEqual(zoomOverview, {
  detailLevel: 'overview',
  detailReason: 'adaptive-default',
  nextAutoDetailLevel: 'overview'
});
const zoomBalanced = presentation.resolveZoomDetailLevel({
  nodeCount: 4000,
  zoom: 0.70,
  previousAutoDetailLevel: zoomOverview.nextAutoDetailLevel
});
assert.equal(zoomBalanced.detailLevel, 'balanced');
assert.equal(presentation.resolveZoomDetailLevel({
  nodeCount: 4000,
  zoom: 0.60,
  previousAutoDetailLevel: zoomBalanced.nextAutoDetailLevel
}).detailLevel, 'balanced');
assert.equal(presentation.resolveZoomDetailLevel({
  nodeCount: 4000,
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
  detailLevel: 'overview',
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
  detailLevel: 'overview',
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
  detailLevel: 'overview',
  structuralRanks: new Uint32Array([9, 8, 7, 6, 1, 0]),
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
const retainedCollision = presentation.allocateLabels({
  candidates: [
    { id: 'active', active: true, tier: 'A', degree: 9, point: { x: 10, y: 80 } },
    { id: 'retained', active: false, tier: 'B', degree: 8, point: { x: 105.5, y: 80 } }
  ],
  retainedLabelIds: ['retained'],
  budget: 2
});
assert.deepEqual(retainedCollision.map((item) => item.id), ['active', 'retained']);

const largeNodes = Array.from({ length: 3000 }, (_, index) => ({
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
  interaction: { searchNodeIds: ['search-2999'] },
  labelBudget: 0
});
assert.equal(hiddenSearchPlan.detailLevel, 'overview');
assert.equal(hiddenSearchPlan.queryableNodeCount, 3000);
assert.equal(hiddenSearchPlan.queryableEdgeCount, 2999);
assert.ok(hiddenSearchPlan.paintedNodeIds.includes('search-2999'));
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
  detailLevel: 'overview',
  interaction: { searchNodeIds: ['stress-24999'] },
  labelBudget: 0
});
const elapsedMs = performance.now() - startedAt;
assert.equal(stressPlan.queryableNodeCount, 25000);
assert.equal(stressPlan.queryableEdgeCount, 24999);
assert.ok(stressPlan.paintedNodeIds.includes('stress-24999'));
assert.ok(stressPlan.paintedNodeIds.length <= 1400);
assert.ok(stressPlan.paintedEdgeIds.length <= 1800);
assert.ok(elapsedMs < 750, `25k presentation planning took ${elapsedMs.toFixed(1)}ms`);

console.log(`Graph3D presentation tests passed. 25k overview plan: ${elapsedMs.toFixed(1)}ms.`);
