#!/usr/bin/env node
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const layoutUtils = await import(pathToFileURL(join(root, 'BrainBar/Resources/Graph3D/graph3d-layout-utils.mjs')));
const cache = await import(pathToFileURL(join(root, 'BrainBar/Resources/Graph3D/graph3d-layout-cache.mjs')));

const nodes = [
  { id: 'a1', label: 'Alpha 1', community: 'Alpha' },
  { id: 'a2', label: 'Alpha 2', community: 'Alpha' },
  { id: 'a3', label: 'Alpha 3', community: 'Alpha' },
  { id: 'a4', label: 'Alpha 4', community: 'Alpha' },
  { id: 'b1', label: 'Beta 1', community: 'Beta' },
  { id: 'b2', label: 'Beta 2', community: 'Beta' },
  { id: 'b3', label: 'Beta 3', community: 'Beta' },
  { id: 'b4', label: 'Beta 4', community: 'Beta' },
  { id: 'c1', label: 'Gamma 1', community: 'Gamma' },
  { id: 'c2', label: 'Gamma 2', community: 'Gamma' }
];
// Edges intentionally have neither IDs nor de-duplication. Their endpoint multiplicity is
// structural supergraph weight, so order and duplicated records must not change coordinates.
const edges = [
  { source: 'a1', target: 'a2' }, { source: 'a2', target: 'a3' }, { source: 'a3', target: 'a4' },
  { source: 'b1', target: 'b2' }, { source: 'b2', target: 'b3' }, { source: 'b3', target: 'b4' },
  { source: 'a2', target: 'b2' }, { source: 'a2', target: 'b2' }, { source: 'a3', target: 'b3' }
];

const first = layoutUtils.computeDeterministicGraphLayout({ nodes, edges });
const second = layoutUtils.computeDeterministicGraphLayout({ nodes: [...nodes].reverse(), edges: [...edges].reverse() });

assert.equal(layoutUtils.graph3dLayoutSchemaVersion, 4);
assert.equal(first.communityCount, 3);
assert.equal(layoutUtils.validateDeterministicGraphLayout(first, nodes.length), true);
assert.deepEqual(coordinatesById(first), coordinatesById(second));
assert.deepEqual(metadataByCommunity(first, nodes), metadataByCommunity(second, [...nodes].reverse()));
assert.deepEqual(ranksById(first), ranksById(second));
assert.ok(new Set(first.structuralRanks).size === nodes.length);
assertCommunityBounds(first, nodes);
assertCommunitySeparation(first, nodes);

const invalidLayout = {
  ...first,
  communityBounds: new Float64Array(first.communityBounds)
};
invalidLayout.communityBounds[0] = invalidLayout.communityBounds[1] + 1;
assert.equal(layoutUtils.validateDeterministicGraphLayout(invalidLayout, nodes.length), false);

const digest = 'b'.repeat(64);
const metadata = {
  communityCount: first.communityCount,
  communityIndexByNode: first.communityIndexByNode.buffer.slice(0),
  communityCenters: first.communityCenters.buffer.slice(0),
  communityBounds: first.communityBounds.buffer.slice(0),
  structuralRanks: first.structuralRanks.buffer.slice(0)
};
const record = cache.layoutCacheRecord({
  digest,
  lens: 'all',
  nodeCount: nodes.length,
  coordinates: first.positions.buffer,
  communityLayout: metadata
});
assert.equal(cache.layoutCacheSchemaVersion, 4);
assert.equal(record.key, `4:${digest}:all`);
assert.ok(cache.validateLayoutCacheRecord(record, { digest, lens: 'all', nodeCount: nodes.length }));
assert.ok(cache.validateLayoutCacheMetadata(record, { nodeCount: nodes.length, communityCount: first.communityCount }));
assert.equal(cache.validateLayoutCacheMetadata({ ...record, structuralRanks: new ArrayBuffer(0) }, {
  nodeCount: nodes.length,
  communityCount: first.communityCount
}), null);

assert.throws(() => layoutUtils.computeDeterministicGraphLayout({
  nodes: [{ id: 'only', label: 'Only', community: 'One' }],
  edges: [{ source: 'only', target: 'missing' }]
}), /Invalid graph layout input/);

// A single giant connected component plus tiny disconnected islands must stay
// compact: no append-only satellite cursor may dominate the world bounds.
const compactNodes = [
  ...Array.from({ length: 180 }, (_, index) => ({ id: `core-${index}`, label: `Core ${index}`, community: 'Core' })),
  ...Array.from({ length: 4 }, (_, index) => ({ id: `island-a-${index}`, label: `Island A ${index}`, community: 'Island A' })),
  ...Array.from({ length: 3 }, (_, index) => ({ id: `island-b-${index}`, label: `Island B ${index}`, community: 'Island B' }))
];
const compactEdges = [
  ...Array.from({ length: 179 }, (_, index) => ({ source: `core-${index}`, target: `core-${index + 1}` })),
  { source: 'island-a-0', target: 'island-a-1' },
  { source: 'island-a-1', target: 'island-a-2' },
  { source: 'island-a-2', target: 'island-a-3' },
  { source: 'island-b-0', target: 'island-b-1' },
  { source: 'island-b-1', target: 'island-b-2' }
];
const compactLayout = layoutUtils.computeDeterministicGraphLayout({ nodes: compactNodes, edges: compactEdges });
const compactBounds = boundsForLayout(compactLayout);
const compactCoreBounds = boundsForIds(compactLayout, new Set(compactNodes.filter((node) => node.community === 'Core').map((node) => node.id)));
assert.ok(compactBounds.width / compactCoreBounds.width < 2.25, 'disconnected islands must remain packed near the core');
assert.ok(compactBounds.depth / compactCoreBounds.depth < 2.25, 'disconnected islands must not create a distant fit outlier');
assert.ok(compactBounds.height / Math.max(compactBounds.width, compactBounds.depth) >= 0.22, 'layout must retain a useful 3D depth span');

console.log('Graph3D deterministic community layout tests passed.');

function coordinatesById(layout) {
  return Object.fromEntries(layout.nodeIds.map((id, index) => [id, [
    layout.positions[index * 3], layout.positions[index * 3 + 1], layout.positions[index * 3 + 2]
  ]]));
}

function ranksById(layout) {
  return Object.fromEntries(layout.nodeIds.map((id, index) => [id, layout.structuralRanks[index]]));
}

function metadataByCommunity(layout, inputNodes) {
  const rows = new Map();
  inputNodes.forEach((node, index) => {
    const communityIndex = layout.communityIndexByNode[index];
    if (!rows.has(communityIndex)) {
      const centerOffset = communityIndex * 3;
      const boundsOffset = communityIndex * 6;
      rows.set(communityIndex, {
        name: node.community,
        center: [...layout.communityCenters.slice(centerOffset, centerOffset + 3)],
        bounds: [...layout.communityBounds.slice(boundsOffset, boundsOffset + 6)]
      });
    }
  });
  return [...rows.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function assertCommunityBounds(layout, inputNodes) {
  inputNodes.forEach((node, index) => {
    const communityIndex = layout.communityIndexByNode[index];
    const boundsOffset = communityIndex * 6;
    const positionOffset = index * 3;
    const [minX, maxX, minY, maxY, minZ, maxZ] = layout.communityBounds.slice(boundsOffset, boundsOffset + 6);
    assert.ok(layout.positions[positionOffset] >= minX && layout.positions[positionOffset] <= maxX);
    assert.ok(layout.positions[positionOffset + 1] >= minY && layout.positions[positionOffset + 1] <= maxY);
    assert.ok(layout.positions[positionOffset + 2] >= minZ && layout.positions[positionOffset + 2] <= maxZ);
  });
}

function assertCommunitySeparation(layout, inputNodes) {
  const indexesByCommunity = new Map();
  inputNodes.forEach((node, index) => {
    const list = indexesByCommunity.get(node.community) ?? [];
    list.push(index);
    indexesByCommunity.set(node.community, list);
  });
  indexesByCommunity.forEach((indexes) => {
    for (let left = 0; left < indexes.length; left += 1) {
      for (let right = left + 1; right < indexes.length; right += 1) {
        const a = indexes[left] * 3;
        const b = indexes[right] * 3;
        assert.ok(Math.hypot(layout.positions[a] - layout.positions[b], layout.positions[a + 2] - layout.positions[b + 2]) >= 13 - 1e-6);
      }
    }
  });
}

function boundsForLayout(layout) {
  return boundsForIds(layout, new Set(layout.nodeIds));
}

function boundsForIds(layout, ids) {
  const points = layout.nodeIds.map((id, index) => ({ id, index })).filter(({ id }) => ids.has(id));
  const values = points.reduce((result, { index }) => {
    const offset = index * 3;
    result.minX = Math.min(result.minX, layout.positions[offset]);
    result.maxX = Math.max(result.maxX, layout.positions[offset]);
    result.minY = Math.min(result.minY, layout.positions[offset + 1]);
    result.maxY = Math.max(result.maxY, layout.positions[offset + 1]);
    result.minZ = Math.min(result.minZ, layout.positions[offset + 2]);
    result.maxZ = Math.max(result.maxZ, layout.positions[offset + 2]);
    return result;
  }, { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity });
  return { width: values.maxX - values.minX, height: values.maxY - values.minY, depth: values.maxZ - values.minZ };
}
