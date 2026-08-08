#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const runtime = require(join(root, 'BrainBar/Resources/Graph2D/brainbar-graph-runtime.js'));
const graph3dPath = await import(pathToFileURL(join(root, 'BrainBar/Resources/Graph3D/graph3d-path-utils.mjs')));
const graph3dLiving = await import(pathToFileURL(join(root, 'BrainBar/Resources/Graph3D/graph3d-living-utils.mjs')));
const graph3dPolish = await import(pathToFileURL(join(root, 'BrainBar/Resources/Graph3D/graph3d-polish-utils.mjs')));
const graph3dRecent = await import(pathToFileURL(join(root, 'BrainBar/Resources/Graph3D/graph3d-recent-utils.mjs')));
const graph3dSearch = await import(pathToFileURL(join(root, 'BrainBar/Resources/Graph3D/graph3d-search-utils.mjs')));
const graph3dStory = await import(pathToFileURL(join(root, 'BrainBar/Resources/Graph3D/graph3d-story-utils.mjs')));
const graph3dLayout = await import(pathToFileURL(join(root, 'BrainBar/Resources/Graph3D/graph3d-layout-utils.mjs')));
const graph3dLayoutCache = await import(pathToFileURL(join(root, 'BrainBar/Resources/Graph3D/graph3d-layout-cache.mjs')));
const fixture = JSON.parse(readFileSync(join(root, 'BrainBarTests/Fixtures/graph-runtime-fixture.json'), 'utf8'));
const graph3dSource = readFileSync(join(root, 'BrainBar/Resources/Graph3D/graph3d.js'), 'utf8');
const graph2dSource = readFileSync(join(root, 'BrainBar/Resources/Graph2D/brainbar-graph-runtime.js'), 'utf8');

assert.ok(graph2dSource.includes('brainBarApplyGraphSessionState'));
assert.ok(graph2dSource.includes('brainBarGraphSessionSnapshot'));
assert.ok(graph3dSource.includes('brainBarApplyGraphSessionState'));
assert.ok(graph3dSource.includes('brainBarGraphSessionSnapshot'));

const graph3dNormalizationSource = graph3dSource.match(/function normalizeGraph\(payload\) \{[\s\S]*?\nfunction prepareCommunities/);
assert.ok(graph3dNormalizationSource);
const graph3dNormalizationContext = {};
vm.runInNewContext(
  `${graph3dNormalizationSource[0].replace(/\nfunction prepareCommunities$/, '')}\nglobalThis.normalizeFixtureGraph = normalizeGraph;`,
  graph3dNormalizationContext
);
const normalizeFixtureGraph = graph3dNormalizationContext.normalizeFixtureGraph;

const idlessGraph = {
  nodes: [
    { id: 'node-a', label: 'A', community: 'One' },
    { id: 'node-b', label: 'B', community: 'One' }
  ],
  edges: [
    { from: 'node-a', to: 'node-b', relation: 'linked', source_file: 'Notes/A.md', confidence: 0.9 },
    { from: 'node-a', to: 'node-b', relation: 'linked', source_file: 'Notes/A.md', confidence: 0.9 },
    { source: 'node-b', target: 'node-a', context: 'linked', source_location: '12:4' }
  ]
};
const reversedIdlessGraph = {
  nodes: [...idlessGraph.nodes].reverse(),
  edges: [...idlessGraph.edges].reverse()
};
const normalizedIdlessGraph = normalizeFixtureGraph(idlessGraph);
const reorderedNormalizedIdlessGraph = normalizeFixtureGraph(reversedIdlessGraph);
const normalizedEdgeIdentities = (graph) => graph.edges
  .map((edge) => JSON.stringify([edge.id, edge.source, edge.target, edge.relation]))
  .sort();
assert.equal(normalizedIdlessGraph.edges.length, 3);
assert.equal(new Set(normalizedIdlessGraph.edges.map((edge) => edge.id)).size, 3);
assert.deepEqual(normalizedEdgeIdentities(normalizedIdlessGraph), normalizedEdgeIdentities(reorderedNormalizedIdlessGraph));
assert.deepEqual(
  normalizedIdlessGraph.edges.map((edge) => edge.id).filter((id) => id.startsWith('edge:')).sort(),
  reorderedNormalizedIdlessGraph.edges.map((edge) => edge.id).filter((id) => id.startsWith('edge:')).sort()
);

const collisionAndLabelGraph = {
  nodes: idlessGraph.nodes,
  edges: [
    { from: 'node-a', to: 'node-b', relation: 'linked', source_file: 'yqgj2ye3a2b5' },
    { from: 'node-a', to: 'node-b', relation: 'linked', source_file: 'pmkx2sxy62bn' },
    { from: 'node-a', to: 'node-b', relation: 'linked', label: 'first', details: { z: 2, a: [true, 'x'] } },
    { from: 'node-a', to: 'node-b', relation: 'linked', title: 'second', details: { a: [true, 'x'], z: 2 } }
  ]
};
const reorderedCollisionAndLabelGraph = {
  nodes: [...collisionAndLabelGraph.nodes].reverse(),
  edges: [...collisionAndLabelGraph.edges].reverse()
};
const normalizedCollisionAndLabelGraph = normalizeFixtureGraph(collisionAndLabelGraph);
const reorderedCollisionAndLabelGraphNormalized = normalizeFixtureGraph(reorderedCollisionAndLabelGraph);
const edgeIDsBySemanticLabel = (graph) => new Map(graph.edges.map((edge) => [
  edge.source_file ?? edge.label ?? edge.title,
  edge.id
]));
const firstSemanticIDs = edgeIDsBySemanticLabel(normalizedCollisionAndLabelGraph);
const reorderedSemanticIDs = edgeIDsBySemanticLabel(reorderedCollisionAndLabelGraphNormalized);
assert.notEqual(firstSemanticIDs.get('yqgj2ye3a2b5'), firstSemanticIDs.get('pmkx2sxy62bn'));
assert.notEqual(firstSemanticIDs.get('first'), firstSemanticIDs.get('second'));
assert.deepEqual([...firstSemanticIDs.entries()].sort(), [...reorderedSemanticIDs.entries()].sort());

const derivedID = normalizeFixtureGraph({
  nodes: idlessGraph.nodes,
  edges: [{ from: 'node-a', to: 'node-b', relation: 'linked', label: 'collision' }]
}).edges[0].id;
const explicitDerivedCollisionGraph = {
  nodes: idlessGraph.nodes,
  edges: [
    { from: 'node-a', to: 'node-b', relation: 'linked', label: 'collision' },
    { id: derivedID, from: 'node-b', to: 'node-a', relation: 'explicit-collision' }
  ]
};
const reorderedExplicitDerivedCollisionGraph = {
  nodes: [...explicitDerivedCollisionGraph.nodes].reverse(),
  edges: [...explicitDerivedCollisionGraph.edges].reverse()
};
const normalizedExplicitDerivedCollision = normalizeFixtureGraph(explicitDerivedCollisionGraph);
const reorderedExplicitDerivedCollision = normalizeFixtureGraph(reorderedExplicitDerivedCollisionGraph);
const collisionIDs = normalizedExplicitDerivedCollision.edges.map((edge) => edge.id).sort();
assert.equal(new Set(collisionIDs).size, 2);
assert.ok(collisionIDs.includes(derivedID));
assert.ok(collisionIDs.includes(`${derivedID}:derived-1`));
assert.deepEqual(collisionIDs, reorderedExplicitDerivedCollision.edges.map((edge) => edge.id).sort());

const contextIdentityGraph = {
  nodes: idlessGraph.nodes,
  edges: [
    { from: 'node-a', to: 'node-b', relation: 'linked', context: 'obsidian_wikilink' },
    { from: 'node-a', to: 'node-b', relation: 'linked', context: 'semantic_similarity' }
  ]
};
const reorderedContextIdentityGraph = {
  nodes: [...contextIdentityGraph.nodes].reverse(),
  edges: [...contextIdentityGraph.edges].reverse()
};
const contextIDs = (graph) => new Map(graph.edges.map((edge) => [edge.context, edge.id]));
const firstContextIDs = contextIDs(normalizeFixtureGraph(contextIdentityGraph));
const reorderedContextIDs = contextIDs(normalizeFixtureGraph(reorderedContextIdentityGraph));
assert.notEqual(firstContextIDs.get('obsidian_wikilink'), firstContextIDs.get('semantic_similarity'));
assert.deepEqual([...firstContextIDs.entries()].sort(), [...reorderedContextIDs.entries()].sort());

const explicitIdGraph = normalizeFixtureGraph({
  nodes: idlessGraph.nodes,
  links: [
    { id: 'explicit-edge', source: 'node-a', target: 'node-b', type: 'linked' },
    { id: 7, source: 'node-b', target: 'node-a', type: 'linked' }
  ]
});
assert.deepEqual(explicitIdGraph.edges.map((edge) => edge.id), ['explicit-edge', '7']);
assert.ok(graph3dSource.includes('canonicalEdgeValue'));
assert.ok(!graph3dSource.includes('normalizedEdgeIdentityHash'));
assert.ok(graph3dSource.includes('generation: state.graphGeneration'));

function positionsFor(nodes, positionFor) {
  return new Map(nodes.map((node, index) => [node.id, positionFor(node, index)]));
}

function minimumCommunityDistance(nodesByCommunity, positions) {
  let minimum = Infinity;
  nodesByCommunity.forEach((nodes) => {
    for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
        const left = positions.get(nodes[leftIndex].id);
        const right = positions.get(nodes[rightIndex].id);
        minimum = Math.min(minimum, Math.hypot(right.x - left.x, right.z - left.z));
      }
    }
  });
  return minimum;
}

const layoutNodes = Array.from({ length: 16 }, (_, index) => ({ id: `layout-${index}` }));
const layoutCommunities = new Map([['A', layoutNodes]]);
const layoutPositions = positionsFor(layoutNodes, (_, index) => ({
  x: (index % 4) * 2,
  y: index,
  z: Math.floor(index / 4) * 2
}));
graph3dLayout.separateLocalNodesByGrid({ nodesByCommunity: layoutCommunities, positions: layoutPositions });
assert.ok(minimumCommunityDistance(layoutCommunities, layoutPositions) >= 13 - 1e-6);
assert.ok([...layoutPositions.values()].every((position) => (
  Number.isFinite(position.x) && Number.isFinite(position.y) && Number.isFinite(position.z)
)));

const deterministicPositions = () => positionsFor(layoutNodes, (_, index) => ({
  x: (index % 4) * 2,
  y: index,
  z: Math.floor(index / 4) * 2
}));
const firstLayout = deterministicPositions();
const secondLayout = deterministicPositions();
graph3dLayout.separateLocalNodesByGrid({ nodesByCommunity: layoutCommunities, positions: firstLayout });
graph3dLayout.separateLocalNodesByGrid({ nodesByCommunity: layoutCommunities, positions: secondLayout });
assert.deepEqual([...firstLayout.entries()], [...secondLayout.entries()]);

const workerLayoutNodes = [
  { id: 'worker-a', label: 'Alpha', community: 'Community North' },
  { id: 'worker-b', label: 'Beta', community: 'Community North' },
  { id: 'worker-c', label: 'Gamma', community: 'Community South' },
  { id: 'worker-d', label: 'Delta', community: 'Community South' }
];
const workerLayoutEdges = [
  { source: 'worker-a', target: 'worker-b' },
  { source: 'worker-b', target: 'worker-c' },
  { source: 'worker-c', target: 'worker-d' }
];
const firstWorkerLayout = graph3dLayout.computeDeterministicGraphLayout({
  nodes: workerLayoutNodes,
  edges: workerLayoutEdges
});
const secondWorkerLayout = graph3dLayout.computeDeterministicGraphLayout({
  nodes: workerLayoutNodes,
  edges: workerLayoutEdges
});
assert.deepEqual(firstWorkerLayout.nodeIds, workerLayoutNodes.map((node) => node.id));
assert.deepEqual([...firstWorkerLayout.positions], [...secondWorkerLayout.positions]);
assert.ok([...firstWorkerLayout.positions].every(Number.isFinite));
assert.notEqual(firstWorkerLayout.positions[1], firstWorkerLayout.positions[4]);
assert.throws(
  () => graph3dLayout.computeDeterministicGraphLayout({
    nodes: [{ id: 'missing-label', community: 'Community Invalid' }],
    edges: []
  }),
  /Invalid graph layout input/
);

const layoutCacheDigest = 'a'.repeat(64);
const layoutCacheCoordinates = new Float64Array([1.5, -2, 3.25, 4, 5.5, -6]);
const validLayoutCacheRecord = graph3dLayoutCache.layoutCacheRecord({
  digest: layoutCacheDigest,
  lens: 'unexpected-lens',
  nodeCount: 2,
  coordinates: layoutCacheCoordinates.buffer
});
assert.equal(graph3dLayoutCache.layoutCacheSchemaVersion, 1);
assert.equal(validLayoutCacheRecord.key, `1:${layoutCacheDigest}:all`);
assert.equal(validLayoutCacheRecord.lens, 'all');
assert.deepEqual(
  [...graph3dLayoutCache.validateLayoutCacheRecord(validLayoutCacheRecord, {
    digest: layoutCacheDigest,
    lens: 'all',
    nodeCount: 2
  })],
  [...layoutCacheCoordinates]
);
assert.equal(
  graph3dLayoutCache.validateLayoutCacheRecord(
    { ...validLayoutCacheRecord, schemaVersion: 0 },
    { digest: layoutCacheDigest, lens: 'all', nodeCount: 2 }
  ),
  null
);
const nonFiniteCoordinates = new Float64Array([1, 2, 3, 4, NaN, 6]);
assert.equal(
  graph3dLayoutCache.layoutCacheRecord({
    digest: layoutCacheDigest,
    lens: 'all',
    nodeCount: 2,
    coordinates: nonFiniteCoordinates.buffer
  }),
  null
);
assert.equal(graph3dLayoutCache.layoutCacheKey({ digest: 'not-a-sha', lens: 'all' }), '');
assert.equal(
  graph3dLayoutCache.shouldRetainLayoutCacheRecord(
    { ...validLayoutCacheRecord, schemaVersion: 0, key: `0:${layoutCacheDigest}:all` },
    layoutCacheDigest
  ),
  false
);
assert.equal(
  graph3dLayoutCache.shouldRetainLayoutCacheRecord(validLayoutCacheRecord, layoutCacheDigest),
  true
);
assert.equal(await graph3dLayoutCache.readLayoutCache({ digest: layoutCacheDigest, lens: 'all' }, 2), null);
assert.equal(await graph3dLayoutCache.writeLayoutCache({ digest: layoutCacheDigest, lens: 'all' }, 2, layoutCacheCoordinates.buffer), false);
assert.throws(
  () => graph3dLayout.computeDeterministicGraphLayout({
    nodes: [{ id: 'only', label: 'Only', community: 'Community One' }],
    edges: [{ source: 'only', target: 'missing' }]
  }),
  /Invalid graph layout input/
);

const emptyPositions = new Map();
assert.deepEqual(
  graph3dLayout.separateLocalNodesByGrid({ nodesByCommunity: new Map(), positions: emptyPositions }),
  { comparisons: 0, corrections: 0, passes: 0, converged: true, fallbackUsed: false }
);
const singleNode = [{ id: 'only' }];
const singlePositions = positionsFor(singleNode, () => ({ x: 4, y: 2, z: -3 }));
graph3dLayout.separateLocalNodesByGrid({
  nodesByCommunity: new Map([['single', singleNode]]),
  positions: singlePositions
});
assert.deepEqual(singlePositions.get('only'), { x: 4, y: 2, z: -3 });

const denseNodes = Array.from({ length: 25 }, (_, index) => ({ id: `dense-${index}` }));
const denseCommunities = new Map([['dense', denseNodes]]);
const densePositions = positionsFor(denseNodes, () => ({ x: 0, y: 0, z: 0 }));
graph3dLayout.separateLocalNodesByGrid({ nodesByCommunity: denseCommunities, positions: densePositions });
assert.ok(minimumCommunityDistance(denseCommunities, densePositions) >= 13 - 1e-6);
assert.ok([...densePositions.values()].every((position) => Number.isFinite(position.x) && Number.isFinite(position.z)));

let denseSeed = 70;
const denseRandom = () => {
  denseSeed = (Math.imul(denseSeed, 1664525) + 1013904223) >>> 0;
  return denseSeed / 0x100000000;
};
const denseNearCoincidentNodes = Array.from({ length: 300 }, (_, index) => ({ id: `near-${index}` }));
const denseNearCoincidentCommunities = new Map([['near', denseNearCoincidentNodes]]);
const denseNearCoincidentPositions = positionsFor(denseNearCoincidentNodes, () => ({
  x: denseRandom() * 10,
  y: denseRandom() * 10,
  z: denseRandom() * 10
}));
const denseNearCoincidentResult = graph3dLayout.separateLocalNodesByGrid({
  nodesByCommunity: denseNearCoincidentCommunities,
  positions: denseNearCoincidentPositions
});
assert.equal(denseNearCoincidentResult.converged, true);
assert.equal(denseNearCoincidentResult.fallbackUsed, true);
assert.ok(minimumCommunityDistance(denseNearCoincidentCommunities, denseNearCoincidentPositions) >= 13 - 1e-6);
assert.ok([...denseNearCoincidentPositions.values()].every((position) => (
  Number.isFinite(position.x) && Number.isFinite(position.y) && Number.isFinite(position.z)
)));

const crossCommunityNodes = [{ id: 'a' }, { id: 'b' }];
const crossCommunityPositions = new Map([
  ['a', { x: 0, y: 0, z: 0 }],
  ['b', { x: 0, y: 0, z: 0 }]
]);
graph3dLayout.separateLocalNodesByGrid({
  nodesByCommunity: new Map([['first', [crossCommunityNodes[0]]], ['second', [crossCommunityNodes[1]]]]),
  positions: crossCommunityPositions
});
assert.deepEqual(crossCommunityPositions.get('a'), { x: 0, y: 0, z: 0 });
assert.deepEqual(crossCommunityPositions.get('b'), { x: 0, y: 0, z: 0 });

const graphLinks = fixture.edges;

assert.equal(runtime.cleanRelationshipLabel('contains [EXTRACTED]'), '');
assert.equal(runtime.cleanRelationshipLabel('semantic_similarity'), 'semantic similarity');
assert.equal(runtime.sourceFileForNode(fixture.nodes[1]), 'notes/Beta.md');
assert.deepEqual(runtime.nodeActionPayload('openNode', fixture.nodes[0]), {
  action: 'openNode',
  nodeId: 'a',
  label: 'Alpha',
  sourceFile: 'notes/Alpha.md'
});

const edgeDetails = runtime.edgeInspectorDetails(fixture.edges[1], {
  nodes: fixture.nodes,
  graphLinks
});
assert.equal(edgeDetails.provenance, 'Graphify');
assert.equal(edgeDetails.sourceLabel, 'Beta');
assert.equal(edgeDetails.targetLabel, 'Gamma');
assert.equal(edgeDetails.relationship, 'semantic similarity');
assert.equal(edgeDetails.sourceFile, 'notes/Beta.md');

const focusDiff = runtime.computeFocusDiff({
  centerNodeId: 'b',
  depth: 1,
  originalNodes: fixture.nodes,
  originalEdges: fixture.edges,
  currentNodes: fixture.nodes,
  currentEdges: fixture.edges
});
assert.deepEqual(new Set(focusDiff.visibleNodeIds), new Set(['a', 'b', 'c']));
assert.deepEqual(new Set(focusDiff.visibleEdgeIds), new Set(['0', '1']));
assert.deepEqual(focusDiff.nodeUpdates, [{ id: 'd', hidden: true }]);
assert.deepEqual(focusDiff.edgeUpdates, [{ id: 2, hidden: true }]);

const health = runtime.computeGraphHealth({
  nodes: [...fixture.nodes, { id: 'e', label: 'Epsilon', source_file: 'notes/Epsilon.md' }],
  edges: fixture.edges,
  graphLinks
});
assert.equal(health.counts.nodes, 5);
assert.equal(health.counts.edges, 3);
assert.equal(health.counts.wikilinkEdges, 1);
assert.equal(health.counts.graphifyEdges, 2);
assert.deepEqual(health.orphanNodes.map((node) => node.id), ['e']);

assert.equal(runtime.nodeTimestamp({ label: '2026-05-27.md' }) > 0, true);
assert.deepEqual(runtime.recentNodeIds([
  { id: 'old', label: '2026-05-01.md' },
  { id: 'new', label: '2026-05-27.md' },
  { id: 'undated', label: 'Inbox' }
]), ['new', 'old']);

globalThis.__brainBarNodeFileMetadata = {
  byNodeId: {
    recentByMetadata: { source_file: 'notes/Recent.md', mtime: 1780000000 }
  },
  bySourceFile: {}
};
assert.equal(runtime.nodeTimestamp({ id: 'recentByMetadata', label: 'Recent', source_file: 'notes/Recent.md' }), 1780000000000);
delete globalThis.__brainBarNodeFileMetadata;

const recentMetadata = {
  byNodeId: {
    fresh: { source_file: 'notes/Fresh.md', mtime: 1780500000 },
    older: { source_file: 'notes/Older.md', mtime: 1780000000 }
  },
  bySourceFile: {
    'notes/BySource.md': { source_file: 'notes/BySource.md', mtime: 1780250000 }
  }
};
assert.equal(
  graph3dRecent.nodeTimestamp({ id: 'fresh', label: 'Fresh', source_file: 'notes/Fresh.md' }, recentMetadata),
  1780500000000
);
assert.equal(
  graph3dRecent.nodeTimestamp({ id: 'sourceOnly', label: 'By Source', source_file: 'notes/BySource.md' }, recentMetadata),
  1780250000000
);
assert.equal(graph3dRecent.nodeTimestamp({ id: 'daily', label: '2026-06-09.md' }) > 0, true);

const manyRecentNodes = Array.from({ length: 30 }, (_, index) => ({
  id: `recent-${index}`,
  label: `Recent ${index}`,
  mtime: 1780000000 + index
}));
const cappedRecent = graph3dRecent.recentOrbitCandidates({ nodes: manyRecentNodes, limit: 24 });
assert.equal(cappedRecent.length, 24);
assert.equal(cappedRecent[0].id, 'recent-29');
assert.equal(cappedRecent[23].id, 'recent-6');

const recentPathNodes = [
  { id: 'recent', label: 'Recent Note' },
  { id: 'near-step', label: 'Near Step' },
  { id: 'near-key', label: 'Near Key' },
  { id: 'far-a', label: 'Far A' },
  { id: 'far-b', label: 'Far B' },
  { id: 'far-key', label: 'Far Key' }
];
const nearestKeyPath = graph3dRecent.nearestKeyNotePath({
  sourceId: 'recent',
  nodes: recentPathNodes,
  edges: [
    { id: 'recent-near-step', source: 'recent', target: 'near-step' },
    { id: 'near-step-near-key', source: 'near-step', target: 'near-key' },
    { id: 'recent-far-a', source: 'recent', target: 'far-a' },
    { id: 'far-a-far-b', source: 'far-a', target: 'far-b' },
    { id: 'far-b-far-key', source: 'far-b', target: 'far-key' }
  ],
  degreeByNode: new Map([
    ['near-key', 12],
    ['far-key', 80]
  ])
});
assert.equal(nearestKeyPath.found, true);
assert.equal(nearestKeyPath.targetId, 'near-key');
assert.deepEqual(nearestKeyPath.orderedNodeIds, ['recent', 'near-step', 'near-key']);

const noRecentKeyPath = graph3dRecent.nearestKeyNotePath({
  sourceId: 'recent',
  nodes: [{ id: 'recent' }, { id: 'key' }],
  edges: [],
  degreeByNode: new Map([['key', 9]])
});
assert.equal(noRecentKeyPath.found, false);
assert.equal(noRecentKeyPath.message, 'No visible path to a key note in current view');

const storyNodes = [
  { id: 'recent-a', label: 'Recent A', community: 'Community 1' },
  { id: 'key-a', label: 'Key A', community: 'Community 1' },
  { id: 'bridge-a', label: 'Bridge A', community: 'Community 1' },
  { id: 'bridge-b', label: 'Bridge B', community: 'Community 2' },
  { id: 'community-b', label: 'Community B', community: 'Community 2' },
  { id: 'orphan', label: 'Orphan', community: 'Community 3' }
];
const storyEdges = [
  { id: 'recent-key', source: 'recent-a', target: 'key-a' },
  { id: 'key-bridge-a', source: 'key-a', target: 'bridge-a' },
  { id: 'bridge-cross', source: 'bridge-a', target: 'bridge-b' },
  { id: 'bridge-community-b', source: 'bridge-b', target: 'community-b' }
];
const storyDegree = new Map([
  ['recent-a', 1],
  ['key-a', 5],
  ['bridge-a', 4],
  ['bridge-b', 3],
  ['community-b', 1],
  ['orphan', 0]
]);
const storySteps = graph3dStory.buildGraphStorySteps({
  nodes: storyNodes,
  edges: storyEdges,
  communities: [
    { name: 'Community 1', count: 3 },
    { name: 'Community 2', count: 2 },
    { name: 'Community 3', count: 1 }
  ],
  degreeByNode: storyDegree,
  metadata: {
    byNodeId: {
      'recent-a': { mtime: 1780500000 }
    }
  },
  limits: {
    recent: 12,
    keyNotes: 12,
    communities: 3,
    bridgeNotes: 10,
    edges: 160
  }
});
assert.deepEqual(storySteps.map((step) => step.id), [
  'recent',
  'key-notes',
  'community-1',
  'community-2',
  'community-3',
  'bridge-notes',
  'needs-attention'
]);
assert.equal(storySteps.find((step) => step.id === 'key-notes').items[0].id, 'key-a');
assert.equal(storySteps.find((step) => step.id === 'community-1').activeCommunityName, 'Community 1');
assert.equal(storySteps.find((step) => step.id === 'bridge-notes').items[0].id, 'bridge-a');
assert.equal(storySteps.find((step) => step.id === 'needs-attention').items[0].id, 'orphan');
storySteps.forEach((step, index) => {
  const presentation = graph3dStory.graphStoryPresentation(step, {
    stepIndex: index,
    totalSteps: storySteps.length,
    activeNodeId: step.activeNodeId,
    previewLimit: 3
  });
  assert.match(presentation.eyebrow, /^Step \d+ of \d+$/);
  assert.ok(presentation.title);
  assert.ok(presentation.summary);
  assert.ok(presentation.takeaway);
  assert.ok(presentation.primary);
  assert.ok(presentation.supportingItems.length <= 3);
});
const keyPresentation = graph3dStory.graphStoryPresentation(storySteps.find((step) => step.id === 'key-notes'), {
  stepIndex: 1,
  totalSteps: storySteps.length,
  activeNodeId: 'bridge-a',
  previewLimit: 3
});
assert.equal(keyPresentation.primary.id, 'bridge-a');
assert.equal(keyPresentation.supportingItems.some((item) => item.id === 'bridge-a'), false);

const storyWithoutOptionalSteps = graph3dStory.buildGraphStorySteps({
  nodes: storyNodes.filter((node) => node.id !== 'orphan').map((node) => ({ ...node, label: node.label.replace('Recent', 'Plain') })),
  edges: storyEdges,
  degreeByNode: storyDegree,
  metadata: {},
  limits: { communities: 0 }
});
assert.equal(storyWithoutOptionalSteps.some((step) => step.id === 'recent'), false);
assert.equal(storyWithoutOptionalSteps.some((step) => step.id === 'needs-attention'), false);

const searchNodes = [
  { id: 'memory-protocol', label: 'Memory Protocol', source_file: '05_Sessions/Memory Protocol.md', type: 'decision', tags: ['memory'], status: 'active', modified_at: '2026-08-08', agent: 'codex' },
  { id: 'protocol-memory', label: 'Protocol Memory', source_file: '05_Sessions/Protocol Memory.md', type: 'reference', tags: ['memory'], status: 'archived', modified_at: '2026-07-10' },
  { id: 'clip-runner', label: 'Web Clip Runner', source_file: '99_System/Web Clip Runner.md' },
  { id: 'source-only', label: 'Inbox', source_file: '99_System/Memory Protocol Notes.md' }
];
assert.deepEqual(
  graph3dSearch.searchGraphNodes({ query: 'Memory Protocol', nodes: searchNodes }).map((item) => item.id),
  ['memory-protocol', 'source-only', 'protocol-memory']
);
assert.deepEqual(
  graph3dSearch.searchGraphNodes({ query: 'protocol', nodes: searchNodes }).map((item) => item.id),
  ['protocol-memory', 'memory-protocol', 'source-only']
);
assert.deepEqual(
  graph3dSearch.searchGraphNodes({ query: 'clip runner', nodes: searchNodes }).map((item) => item.id),
  ['clip-runner']
);
assert.equal(
  graph3dSearch.searchGraphNodes({
    query: 'node',
    nodes: Array.from({ length: 30 }, (_, index) => ({ id: `node-${index}`, label: `Node ${String(index).padStart(2, '0')}` })),
    limit: 20
  }).length,
  20
);
assert.deepEqual(
  graph3dSearch.searchGraphNodes({
    query: 'type:decision tag:memory status:active source:sessions date:2026-08 agent:codex',
    nodes: searchNodes
  }).map((item) => item.id),
  ['memory-protocol']
);
assert.deepEqual(graph3dSearch.parseGraphSearchQuery('type:decision "Memory Protocol"'), {
  text: 'memory protocol',
  filters: [{ name: 'type', value: 'decision' }]
});

assert.equal(runtime.describeWorkflowView('orphans').title, 'Needs Links');
assert.equal(runtime.describeWorkflowView('hubs').title, 'Key Notes');
assert.equal(runtime.describeWorkflowView('groups').title, 'Groups');
assert.equal(runtime.describeWorkflowView('focus').empty, 'Select a node first, then focus it.');

const search2DMatches = runtime.search2DNodes({
  query: 'beta',
  nodes: [
    { id: 'a', label: 'Alpha', source_file: 'notes/Beta Source.md' },
    { id: 'b', label: 'Beta', source_file: 'notes/Beta.md' },
    { id: 'c', label: 'Beta Protocol', source_file: 'notes/Protocol.md' },
    { id: 'hidden', label: 'Beta Hidden', source_file: 'notes/Hidden.md' }
  ],
  visibleNodeIds: new Set(['a', 'b', 'c']),
  limit: 20
});
assert.deepEqual(search2DMatches.map((item) => item.id), ['b', 'hidden', 'c', 'a']);
assert.equal(search2DMatches.find((item) => item.id === 'hidden')?.hidden, true);
assert.deepEqual(runtime.search2DNodes({
  query: 'type:decision tag:memory status:active source:sessions date:2026-08 agent:codex',
  nodes: searchNodes,
  visibleNodeIds: new Set(['protocol-memory'])
}).map((item) => [item.id, item.hidden]), [['memory-protocol', true]]);
assert.equal(runtime.search2DNodes({
  query: 'node',
  nodes: Array.from({ length: 30 }, (_, index) => ({ id: `node-${index}`, label: `Node ${index}` })),
  limit: 20
}).length, 20);

const communitySummary = runtime.communitySummaries({
  nodes: [
    { id: 'a', label: 'A', community: 1, source_file: 'A.md' },
    { id: 'b', label: 'B', community: 1, source_file: 'B.md' },
    { id: 'c', label: 'C', community: 2, source_file: 'C.md' },
    { id: 'zero', label: 'No Community' }
  ],
  edges: [
    { id: 'ab', source: 'a', target: 'b' },
    { id: 'bc', source: 'b', target: 'c' }
  ]
});
assert.deepEqual(communitySummary.map((group) => [group.label, group.count]), [
  ['Community 1', 2],
  ['Community 2', 1]
]);
assert.equal(communitySummary[0].bridgeNotes[0].id, 'b');

const graphCheck = runtime.graphCheckSections(health, {
  nodes: [...fixture.nodes, { id: '2026', label: '2026-06-11.md' }]
});
assert.deepEqual(graphCheck.map((section) => section.id), ['orphans', 'hubs', 'components', 'recent', 'noise']);
assert.equal(graphCheck.find((section) => section.id === 'recent').items[0].id, '2026');

assert.deepEqual(runtime.bridgeActionPayload('revealIn3D', fixture.nodes[0], { communityId: '1', targetNodeId: 'b' }), {
  action: 'revealIn3D',
  nodeId: 'a',
  label: 'Alpha',
  sourceFile: 'notes/Alpha.md',
  communityId: '1',
  targetNodeId: 'b'
});

assert.equal(graph3dPolish.activeModeFromState({}), 'none');
assert.equal(graph3dPolish.activeModeFromState({ pathMode: true, searchRevealNodeId: 'a' }), 'path');
assert.equal(graph3dPolish.activeModeFromState({ communitySpotlightName: 'Community 1' }), 'community');
assert.equal(graph3dPolish.labelBudgetForMode('none'), 0);
assert.equal(graph3dPolish.labelBudgetForMode('none', { hasHover: true }), 8);
assert.equal(graph3dPolish.labelBudgetForMode('path'), 14);
assert.equal(graph3dPolish.labelBudgetForMode('community'), 12);
const breathA = graph3dLiving.breathingStyle({ phase: 1.2, nodeId: 'alpha', baseRadius: 4, depth: 0.9 });
const breathB = graph3dLiving.breathingStyle({ phase: 1.2, nodeId: 'alpha', baseRadius: 4, depth: 0.9 });
assert.deepEqual(breathA, breathB);
assert.equal(graph3dLiving.breathingStyle({ reducedMotion: true }).offsetX, 0);
assert.deepEqual(
  graph3dLiving.selectAmbientRecentNodeIds({
    recentItems: Array.from({ length: 30 }, (_, index) => ({ id: `recent-${index}` })),
    visibleNodeIds: new Set(Array.from({ length: 26 }, (_, index) => `recent-${index}`)),
    limit: 24
  }),
  Array.from({ length: 24 }, (_, index) => `recent-${index}`)
);
const currentEdges = Array.from({ length: 120 }, (_, index) => ({
  id: `edge-${String(index).padStart(3, '0')}`,
  source: `node-${index}`,
  target: `node-${index + 1}`
}));
assert.equal(graph3dLiving.selectAmbientCurrentEdgeIds({
  edges: currentEdges,
  recentNodeIds: new Set(['node-3', 'node-4']),
  activeNodeIds: new Set(['node-10']),
  limit: 90
}).length, 90);
assert.equal(graph3dLiving.selectAmbientCurrentEdgeIds({
  edges: currentEdges,
  activeNodeIds: new Set(['node-10']),
  limit: 48
}).length, 48);
assert.ok(['edge-009', 'edge-010'].includes(graph3dLiving.selectAmbientCurrentEdgeIds({
  edges: currentEdges,
  activeNodeIds: new Set(['node-10']),
  limit: 1
})[0]));
const communityPulseGroups = graph3dLiving.selectCommunityPulseGroups({
  nodes: Array.from({ length: 120 }, (_, index) => ({
    id: `node-${index}`,
    community: `Community ${Math.floor(index / 10)}`
  })),
  limitCommunities: 8,
  nodesPerCommunity: 6
});
assert.equal(communityPulseGroups.length, 8);
assert.ok(communityPulseGroups.every((group) => group.nodeIds.length <= 6));
assert.equal(graph3dLiving.edgeCurrentVisual({ phase: 10, edgeId: 'edge-a' }).alpha > 0, true);
assert.equal(graph3dLiving.edgeCurrentVisual({ reducedMotion: true }).alpha, 0);
assert.equal(graph3dLiving.communityBreathingVisual({ reducedMotion: true }).radiusScale, 1);
assert.equal(graph3dLiving.recentSparkVisual({ phase: 10, nodeId: 'recent-a' }).alpha > 0, true);
assert.equal(graph3dLiving.recentSparkVisual({ phase: 10, nodeId: 'recent-a' }).isStrong, false);
assert.equal(graph3dLiving.recentSparkVisual({ reducedMotion: true }).isStrong, false);
const livingPulse = graph3dLiving.createLivingPulse({
  nodeIds: Array.from({ length: 20 }, (_, index) => `n-${index}`),
  edgeIds: Array.from({ length: 60 }, (_, index) => `e-${index}`),
  originNodeId: 'n-0',
  now: 1000,
  durationMs: 1200
});
assert.equal(livingPulse.nodeIds.length, 16);
assert.equal(livingPulse.edgeIds.length, 48);
assert.equal(graph3dLiving.pulseVisualState(livingPulse, 1000).expired, false);
assert.equal(graph3dLiving.pulseVisualState(livingPulse, 1600).alpha <= 0.42, true);
assert.equal(graph3dLiving.pulseVisualState(livingPulse, 2300).expired, true);
assert.equal(graph3dLiving.pruneLivingPulses([livingPulse], 2300).length, 0);
assert.equal(graph3dLiving.pulseVisualState(livingPulse, 1100, { reducedMotion: true }).alpha, 0);
assert.deepEqual(graph3dPolish.spotlightBudgets(40), {
  focusNodeLimit: 80,
  internalEdgeLimit: 180,
  bridgeEdgeLimit: 80,
  useAllNodes: true
});
assert.deepEqual(graph3dPolish.spotlightBudgets(120), {
  focusNodeLimit: 40,
  internalEdgeLimit: 100,
  bridgeEdgeLimit: 60,
  useAllNodes: false
});

const projectedGrid = graph3dPolish.buildProjectedNodeGrid(new Map([
  ['near-a', { x: 10, y: 10 }],
  ['near-b', { x: 70, y: 65 }],
  ['far', { x: 260, y: 260 }]
]), { cellSize: 72 });
assert.deepEqual(
  new Set(graph3dPolish.nearbyProjectedNodeIds(projectedGrid, { x: 30, y: 30 }, 80)),
  new Set(['near-a', 'near-b'])
);

const workflowState = runtime.workflowViewState({
  nodes: [...fixture.nodes, { id: 'e', label: 'Epsilon', source_file: 'notes/Epsilon.md' }],
  edges: fixture.edges,
  graphLinks,
  reviewQueueTargets: []
});
assert.equal(workflowState.orphans.count, 1);
assert.equal(workflowState.hubs.count, 0);
assert.equal(workflowState.review.hidden, true);
assert.equal(workflowState.recent.disabled, true);

const starNodes = [
  { id: 'center', label: 'Center' },
  ...Array.from({ length: 10 }, (_, index) => ({ id: `leaf-${index}`, label: `Leaf ${index}` }))
];
const starEdges = Array.from({ length: 10 }, (_, index) => ({
  id: index,
  from: 'center',
  to: `leaf-${index}`
}));
const hubWorkflowState = runtime.workflowViewState({
  nodes: starNodes,
  edges: starEdges,
  graphLinks: starEdges,
  reviewQueueTargets: [{ node_id: 'center' }]
});
assert.equal(hubWorkflowState.hubs.count, 1);
assert.equal(hubWorkflowState.review.hidden, false);

const workflowActivitySnapshot = {
  events: [{
    id: 'event-workflow-a',
    version: 2,
    action: 'write',
    agent: 'codex',
    path: 'Notes/Output.md',
    timestamp: '2026-08-08T09:00:00Z',
    nodeId: 'node-a',
    pending: false,
    sessionId: 'session-42',
    project: 'BrainBar',
    source: 'agent',
    reason: 'render proof',
    status: 'completed',
    workflowId: 'workflow-42',
    workflowTitle: 'Render proof',
    pathRole: 'output'
  }],
  pendingPaths: ['Notes/Pending.md'],
  workflows: [{
    id: 'workflow:workflow-42',
    workflowId: 'workflow-42',
    nodeIds: ['node-a'],
    pendingPaths: ['Notes/Pending.md'],
    trail: [{ id: 'event-workflow-a' }]
  }]
};
const normalizedWorkflowActivity = runtime.normalizeAgentActivitySnapshot(workflowActivitySnapshot);
assert.equal(normalizedWorkflowActivity.events[0].version, 2);
assert.equal(normalizedWorkflowActivity.events[0].sessionId, 'session-42');
assert.equal(normalizedWorkflowActivity.events[0].project, 'BrainBar');
assert.equal(normalizedWorkflowActivity.events[0].source, 'agent');
assert.equal(normalizedWorkflowActivity.events[0].reason, 'render proof');
assert.equal(normalizedWorkflowActivity.events[0].status, 'completed');
assert.equal(normalizedWorkflowActivity.events[0].workflowId, 'workflow-42');
assert.equal(normalizedWorkflowActivity.events[0].workflowTitle, 'Render proof');
assert.equal(normalizedWorkflowActivity.events[0].pathRole, 'output');
const activeModesBeforeWorkflowHighlight = {
  search: 'Beacon', focus: 'node-b', path: 'node-a->node-c', recentOrbit: 'node-d', story: 'story-1', community: 'Community One'
};
const workflowHighlight = runtime.workflowHighlightState(
  normalizedWorkflowActivity,
  'workflow:workflow-42',
  ['node-a', 'node-b']
);
assert.deepEqual(workflowHighlight, {
  workflowID: 'workflow:workflow-42',
  nodeIds: ['node-a'],
  pendingPaths: ['Notes/Pending.md']
});
assert.deepEqual(activeModesBeforeWorkflowHighlight, {
  search: 'Beacon', focus: 'node-b', path: 'node-a->node-c', recentOrbit: 'node-d', story: 'story-1', community: 'Community One'
});
assert.deepEqual(
  runtime.workflowHighlightState(normalizedWorkflowActivity, '', ['node-a']),
  { workflowID: '', nodeIds: [], pendingPaths: [] }
);

const pathNodes = ['a', 'b', 'c', 'd'].map((id) => ({ id }));
const pathEdges = [
  { id: 'ab', source: 'a', target: 'b' },
  { id: 'bc', source: 'b', target: 'c' },
  { id: 'cd', source: 'c', target: 'd' }
];
const shortestPath = graph3dPath.computeShortestPath({
  sourceId: 'a',
  targetId: 'd',
  nodes: pathNodes,
  edges: pathEdges
});
assert.equal(shortestPath.found, true);
assert.deepEqual(shortestPath.orderedNodeIds, ['a', 'b', 'c', 'd']);
assert.deepEqual(shortestPath.orderedEdgeIds, ['ab', 'bc', 'cd']);
assert.deepEqual(new Set(shortestPath.nodeIds), new Set(['a', 'b', 'c', 'd']));

const noVisiblePath = graph3dPath.computeShortestPath({
  sourceId: 'a',
  targetId: 'd',
  nodes: pathNodes,
  edges: [{ id: 'ab', source: 'a', target: 'b' }]
});
assert.equal(noVisiblePath.found, false);
assert.equal(noVisiblePath.message, 'No visible path in current view');

const lensFilteredPath = graph3dPath.computeShortestPath({
  sourceId: 'a',
  targetId: 'd',
  nodes: pathNodes.filter((node) => node.id !== 'c'),
  edges: pathEdges
});
assert.equal(lensFilteredPath.found, false);

const comparedPaths = graph3dPath.computePathVariants({
  sourceId: 'a',
  targetId: 'd',
  nodes: [...pathNodes, { id: 'e' }],
  edges: [
    { id: 'ad', source: 'a', target: 'd' },
    { id: 'ab', source: 'a', target: 'b', relation: 'obsidian_wikilink' },
    { id: 'bd', source: 'b', target: 'd', relation: 'semantic_similarity' },
    { id: 'ac', source: 'a', target: 'c', relation: 'obsidian_wikilink' },
    { id: 'ce', source: 'c', target: 'e', relation: 'obsidian_wikilink' },
    { id: 'ed', source: 'e', target: 'd', relation: 'obsidian_wikilink' }
  ]
});
const comparedById = new Map(comparedPaths.map((variant) => [variant.id, variant]));
assert.deepEqual(comparedById.get('shortest').orderedNodeIds, ['a', 'd']);
assert.deepEqual(comparedById.get('different').orderedNodeIds, ['a', 'b', 'd']);
assert.deepEqual(comparedById.get('best-explained').orderedNodeIds, ['a', 'b', 'd']);
assert.deepEqual(comparedById.get('wikilinks').orderedNodeIds, ['a', 'c', 'e', 'd']);
assert.equal(comparedById.get('graphify').found, false);
assert.equal(comparedById.get('graphify').message, 'No Graphify-only path in current view');

const graphifyComparedPaths = graph3dPath.computePathVariants({
  sourceId: 'a',
  targetId: 'd',
  nodes: pathNodes,
  edges: [
    { id: 'ab', source: 'a', target: 'b', relation: 'semantic_similarity' },
    { id: 'bd', source: 'b', target: 'd', context: 'graphify_inferred' }
  ]
});
assert.deepEqual(
  new Map(graphifyComparedPaths.map((variant) => [variant.id, variant])).get('graphify').orderedNodeIds,
  ['a', 'b', 'd']
);
assert.equal(
  new Map(graphifyComparedPaths.map((variant) => [variant.id, variant])).get('graphify').sameAs,
  'shortest'
);

const explainNodes = [
  { id: 'a', label: 'Alpha', community: 'Community 1' },
  { id: 'b', label: 'Beta', community: 'Community 1' },
  { id: 'c', label: 'Gamma', community: 'Community 2' },
  { id: 'd', label: 'Delta', community: 'Community 3' }
];
const wikilinkExplanation = graph3dPath.explainShortestPath({
  orderedNodeIds: ['a', 'b', 'c'],
  orderedEdgeIds: ['ab', 'bc'],
  nodes: explainNodes,
  edges: [
    { id: 'ab', source: 'a', target: 'b', relation: 'obsidian_wikilink' },
    { id: 'bc', source: 'b', target: 'c', relation: 'obsidian_wikilink' }
  ]
});
assert.equal(wikilinkExplanation.summary, 'This route follows explicit wikilinks between notes.');
assert.ok(wikilinkExplanation.badges.includes('2 Wikilinks'));
assert.equal(wikilinkExplanation.caveat, '');

const graphifyExplanation = graph3dPath.explainShortestPath({
  orderedNodeIds: ['a', 'b', 'c'],
  orderedEdgeIds: ['ab', 'bc'],
  nodes: explainNodes,
  edges: [
    { id: 'ab', source: 'a', target: 'b', relation: 'semantic_similarity' },
    { id: 'bc', source: 'b', target: 'c', context: 'graphify_inferred' }
  ],
  lens: 'graphify'
});
assert.equal(graphifyExplanation.summary, 'This route is inferred from Graphify relationships in the visible graph.');
assert.ok(graphifyExplanation.badges.includes('2 Graphify'));
assert.ok(graphifyExplanation.bullets.some((bullet) => bullet.includes('Graphify lens')));

const mixedExplanation = graph3dPath.explainShortestPath({
  orderedNodeIds: ['a', 'b', 'c', 'd'],
  orderedEdgeIds: ['ab', 'bc', 'cd'],
  nodes: explainNodes,
  edges: [
    { id: 'ab', source: 'a', target: 'b', relation: 'obsidian_wikilink' },
    { id: 'bc', source: 'b', target: 'c', relation: 'semantic_similarity' },
    { id: 'cd', source: 'c', target: 'd', context: 'graphify_inferred' }
  ],
  degreeByNode: new Map([['b', 9], ['c', 3]])
});
assert.equal(mixedExplanation.summary, 'This route combines explicit wikilinks with inferred Graphify relationships.');
assert.ok(mixedExplanation.badges.includes('1 Wikilink'));
assert.ok(mixedExplanation.badges.includes('2 Graphify'));
assert.ok(mixedExplanation.badges.includes('3 communities'));
assert.ok(mixedExplanation.bullets.some((bullet) => bullet.includes('crosses 3 communities')));
assert.ok(mixedExplanation.bullets.some((bullet) => bullet.includes('Beta is the strongest bridge')));

const sparseExplanation = graph3dPath.explainShortestPath({
  orderedNodeIds: ['a', 'b'],
  orderedEdgeIds: ['ab'],
  nodes: explainNodes,
  edges: [{ id: 'ab', source: 'a', target: 'b' }]
});
assert.equal(sparseExplanation.summary, 'BrainBar can trace this route, but the visible graph has limited connection metadata.');
assert.ok(sparseExplanation.badges.includes('1 Unknown'));
assert.ok(sparseExplanation.caveat.includes('metadata is unavailable'));

const graph3dWorkerPath = join(root, 'BrainBar/Resources/Graph3D/graph3d-layout-worker.mjs');
const graph3dCachePath = join(root, 'BrainBar/Resources/Graph3D/graph3d-layout-cache.mjs');
const graph3dWorkerSource = readFileSync(graph3dWorkerPath, 'utf8');
const graph3dCacheSource = readFileSync(graph3dCachePath, 'utf8');
assert.equal(existsSync(graph3dWorkerPath), true);
assert.equal(existsSync(graph3dCachePath), true);
assert.doesNotMatch(graph3dCacheSource, /\b(label|nodeId|sourceFile|payload)\b/i);
assert.match(graph3dSource, /new Worker\(new URL\('\.\/graph3d-layout-worker\.mjs', import\.meta\.url\), \{\s*type: 'module',\s*name: 'brainbar-3d-layout'/);
assert.match(graph3dSource, /layoutState/);
assert.match(graph3dSource, /function normalizedEdgeSemanticKey/);
assert.doesNotMatch(graph3dSource, /\$\{source\}-\$\{target\}-\$\{index\}/);
assert.match(graph3dSource, /worker\?\.terminate\(\)/);
assert.doesNotMatch(graph3dSource, /function calculateLayout\(/);
assert.doesNotMatch(graph3dSource, /function relaxLayout\(/);
assert.match(graph3dSource, /layout-worker-test/);
assert.match(graph3dSource, /layout-worker-mode/);
assert.match(graph3dSource, /__brainBarLayoutWorkerTestRelease/);
assert.match(graph3dSource, /if \(!state\.graph\) \{[\s\S]*pendingGraphGeneration[\s\S]*return false;/);
assert.match(graph3dSource, /event: 'graphReady',[\s\S]*generation: layoutContext\.graphGeneration,[\s\S]*lens: layoutContext\.lens/);
assert.match(graph3dSource, /if \(isCurrentLayoutContext\(context\)\) \{\s*state\.layoutState = 'failed';\s*failLayout\(\);/);
assert.match(graph3dWorkerSource, /self\.postMessage\(\{ type: 'ready' \}\)/);
assert.match(graph3dWorkerSource, /positions: layout\.positions\.buffer/);
assert.match(graph3dWorkerSource, /\[layout\.positions\.buffer\]/);
assert.match(graph3dSource, /function clearInteractiveModes[\s\S]*clearFocusOrbit\(false\)[\s\S]*clearPathMode\(false\)[\s\S]*clearGraphStory\(false\)/);
assert.match(graph3dSource, /Compare paths/);
assert.match(graph3dSource, /No route found/);
assert.match(graph3dSource, /Community Spotlight/);
assert.match(graph3dSource, /bridge notes/);
assert.match(graph3dSource, /Graph Story/);
assert.match(graph3dSource, /function applyFocusOrbit[\s\S]*clearInteractiveModes\(\)/);
assert.match(graph3dSource, /function applyPathToNode[\s\S]*clearInteractiveModes\(\{ preservePathSource: true \}\)/);
assert.match(graph3dSource, /function applyRecentOrbit[\s\S]*clearInteractiveModes\(\)/);
assert.match(graph3dSource, /function focusRecentOrbit\(\)[\s\S]*fitCameraWithTilt\('Recent Orbit'/);
assert.match(graph3dSource, /function renderSearchResults[\s\S]*searchGraphNodes/);
assert.match(graph3dSource, /function handleSearchResultClick[\s\S]*selectNode\(node, true\)/);
assert.match(graph3dSource, /function revealSearchNode[\s\S]*clearInteractiveModes\(\)/);
assert.match(graph3dSource, /Revealed from search/);
assert.match(graph3dSource, /emitLivingPulse/);
assert.match(graph3dSource, /clearLivingPulses/);
assert.match(graph3dSource, /function focusRecentOrbit\(\)[\s\S]*fitCameraWithTilt\('Recent Orbit', 0\.72, 0\.88\)/);

const obsidianDiff = runtime.computeLensDiff({
  lens: 'obsidian',
  originalNodes: fixture.nodes,
  originalEdges: fixture.edges,
  graphLinks,
  currentNodes: fixture.nodes,
  currentEdges: fixture.edges
});
assert.deepEqual(obsidianDiff.edgeUpdates, [
  { id: 1, hidden: true },
  { id: 2, hidden: true }
]);
assert.deepEqual(obsidianDiff.nodeUpdates, [
  { id: 'c', hidden: true },
  { id: 'd', hidden: true }
]);
assert.equal(obsidianDiff.filteredEdgeCount, 1);

const graphifyDiff = runtime.computeLensDiff({
  lens: 'graphify',
  originalNodes: fixture.nodes,
  originalEdges: fixture.edges,
  graphLinks,
  currentNodes: fixture.nodes,
  currentEdges: fixture.edges
});
assert.deepEqual(graphifyDiff.edgeUpdates, [{ id: 0, hidden: true }]);
assert.deepEqual(graphifyDiff.nodeUpdates, [{ id: 'a', hidden: true }]);
assert.equal(graphifyDiff.filteredEdgeCount, 2);

const alreadyApplied = runtime.computeLensDiff({
  lens: 'obsidian',
  originalNodes: fixture.nodes,
  originalEdges: fixture.edges,
  graphLinks,
  currentNodes: fixture.nodes.map((node) => ({
    ...node,
    hidden: node.id === 'c' || node.id === 'd'
  })),
  currentEdges: fixture.edges.map((edge) => ({
    ...edge,
    hidden: edge.id === 1 || edge.id === 2
  }))
});
assert.deepEqual(alreadyApplied.edgeUpdates, []);
assert.deepEqual(alreadyApplied.nodeUpdates, []);

const resetAll = runtime.computeLensDiff({
  lens: 'all',
  originalNodes: fixture.nodes,
  originalEdges: fixture.edges,
  graphLinks,
  currentNodes: fixture.nodes.map((node) => ({ ...node, hidden: true })),
  currentEdges: fixture.edges.map((edge) => ({ ...edge, hidden: true }))
});
assert.equal(resetAll.edgeUpdates.length, fixture.edges.length);
assert.equal(resetAll.nodeUpdates.length, fixture.nodes.length);
assert.ok(resetAll.edgeUpdates.every((update) => update.hidden === false));
assert.ok(resetAll.nodeUpdates.every((update) => update.hidden === false));

[
  'BrainBar/Resources/Graph3D/index.html',
  'BrainBar/Resources/Graph3D/graph3d.css',
  'BrainBar/Resources/Graph3D/graph3d.js',
  'BrainBar/Resources/Graph3D/graph3d-layout-utils.mjs',
  'BrainBar/Resources/Graph3D/graph3d-layout-cache.mjs',
  'BrainBar/Resources/Graph3D/graph3d-layout-worker.mjs',
  'BrainBar/Resources/Graph3D/graph3d-living-utils.mjs',
  'BrainBar/Resources/Graph3D/graph3d-path-utils.mjs',
  'BrainBar/Resources/Graph3D/graph3d-search-utils.mjs',
  'BrainBar/Resources/Graph3D/graph3d-story-utils.mjs',
  'BrainBar/Resources/Graph3D/vendor/three.module.min.js',
  'BrainBar/Resources/Graph3D/vendor/OrbitControls.js'
].forEach((relativePath) => {
  assert.ok(existsSync(join(root, relativePath)), `Missing ${relativePath}`);
});

console.log('Graph runtime smoke tests passed.');
