import assert from 'node:assert/strict';
import { loadFixtureManifest, generateFixture, fixtureDigest } from './generate-large-graph-fixtures.mjs';

const requiredNodeFields = ['community', 'id', 'label', 'source_file'];
const requiredEdgeFields = ['from', 'id', 'relation', 'to'];
const expectedDefinitions = [
  { name: '1k', node_count: 1000, edge_count: 2380, community_count: 10, seed: 439041101, sha256: '1f7ec933358a7bd1ff5405278d986a3998b4f37f6c4d9df621dfe08071260bad' },
  { name: '10k', node_count: 10000, edge_count: 23805, community_count: 50, seed: 725372254, sha256: 'd7910d8a11fb556179d6fd9542189b70763bea8c06719e06cfd25e8cee16e967' },
  { name: 'inspected-shape', node_count: 12547, edge_count: 29868, community_count: 64, seed: 1010580540, sha256: 'e1a4217a3ce6f117ac4155710c67f5f36754d2b3d9599bca08b817506534438f' },
  { name: '25k-stress', node_count: 25000, edge_count: 59512, community_count: 100, seed: 1283429605, sha256: '976754cd0af582b0a9252c11d8e5211078075931a014ea89387033a0add99479' }
];

function sortedKeys(value) {
  return Object.keys(value).sort();
}

function normalizedEdgeIdentity(edge) {
  const endpoints = [edge.from, edge.to].sort();
  return `${endpoints[0]}\u0000${endpoints[1]}\u0000${edge.relation}`;
}

function assertFixture(definition, fixture) {
  assert.deepEqual(sortedKeys(fixture), ['edges', 'nodes'], `${definition.name} has unexpected root fields`);
  assert.equal(fixture.nodes.length, definition.node_count, `${definition.name} node count`);
  assert.equal(fixture.edges.length, definition.edge_count, `${definition.name} edge count`);

  const nodeIDs = new Set();
  for (const node of fixture.nodes) {
    assert.deepEqual(sortedKeys(node), requiredNodeFields, `${definition.name} node contains non-fixture fields`);
    assert.equal(typeof node.id, 'string');
    assert.equal(typeof node.label, 'string');
    assert.equal(typeof node.community, 'string');
    assert.equal(typeof node.source_file, 'string');
    assert(!nodeIDs.has(node.id), `${definition.name} duplicate node ID: ${node.id}`);
    nodeIDs.add(node.id);
  }

  const edgeIDs = new Set();
  const edgeIdentities = new Set();
  for (const edge of fixture.edges) {
    assert.deepEqual(sortedKeys(edge), requiredEdgeFields, `${definition.name} edge contains non-fixture fields`);
    assert.equal(typeof edge.id, 'string');
    assert.equal(typeof edge.from, 'string');
    assert.equal(typeof edge.to, 'string');
    assert.equal(typeof edge.relation, 'string');
    assert(nodeIDs.has(edge.from), `${definition.name} unknown edge source: ${edge.from}`);
    assert(nodeIDs.has(edge.to), `${definition.name} unknown edge target: ${edge.to}`);
    assert.notEqual(edge.from, edge.to, `${definition.name} self-loop: ${edge.id}`);
    assert(!edgeIDs.has(edge.id), `${definition.name} duplicate edge ID: ${edge.id}`);
    edgeIDs.add(edge.id);
    const identity = normalizedEdgeIdentity(edge);
    assert(!edgeIdentities.has(identity), `${definition.name} duplicate normalized edge identity: ${identity}`);
    edgeIdentities.add(identity);
  }
}

const manifest = await loadFixtureManifest();
assert.equal(manifest.schema_version, 1);
assert.equal(manifest.fixtures.length, 4);
assert.deepEqual(
  manifest.fixtures.map(({ name, node_count, edge_count, community_count, seed, sha256 }) => ({ name, node_count, edge_count, community_count, seed, sha256 })),
  expectedDefinitions,
  'fixture definitions do not match the approved roadmap cases'
);

for (const definition of manifest.fixtures) {
  const first = generateFixture(definition);
  const second = generateFixture(definition);
  assertFixture(definition, first);
  assert.deepEqual(first.nodes.map((node) => node.id).sort(), second.nodes.map((node) => node.id).sort(), `${definition.name} node ID set is not deterministic`);
  assert.deepEqual(first.edges.map(normalizedEdgeIdentity).sort(), second.edges.map(normalizedEdgeIdentity).sort(), `${definition.name} edge identities are not deterministic`);
  const firstDigest = fixtureDigest(first);
  const secondDigest = fixtureDigest(second);
  assert.equal(firstDigest, secondDigest, `${definition.name} content digest is not deterministic`);
  assert.equal(firstDigest, definition.sha256, `${definition.name} content digest differs from manifest`);
  console.log(`${definition.name}: ${first.nodes.length} nodes, ${first.edges.length} edges, ${firstDigest}`);
}

console.log('Large graph fixtures: all checks passed.');
