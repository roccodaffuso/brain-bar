#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateFixture, loadFixtureManifest } from './generate-large-graph-fixtures.mjs';

const require = createRequire(import.meta.url);
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const evidence = require(join(root, 'BrainBar/Resources/GraphEvidence/brainbar-graph-evidence.js'));
const now = Date.parse('2026-08-08T00:00:00Z');

const graph = {
  nodes: [
    { id: 'a', label: 'Alpha', source_file: 'notes/Alpha.md', community: 'One', mtime: '2026-01-01', status: 'active', category: 'project', body: 'PRIVATE_SENTINEL_NOTE_BODY' },
    { id: 'b', label: 'Beta', source_file: 'notes/Beta.md', community: 'One' },
    { id: 'c', label: 'Gamma', source_file: 'notes/Gamma.md', community: 'Two' },
    { id: 'd', label: 'Delta', source_file: 'notes/Delta.md', community: 'Two' },
    { id: 'e', label: 'Epsilon', source_file: 'notes/Epsilon.md', community: 'Two' },
    { id: 'is1', label: 'Isolated 1', source_file: 'notes/Isolated1.md' },
    { id: 'is2', label: 'Isolated 2', source_file: 'notes/Isolated2.md' },
    { id: 'orphan', label: 'Orphan', source_file: 'notes/Orphan.md' }
  ],
  edges: [
    { id: 'wikilink', from: 'a', to: 'b', relation: 'obsidian_wikilink', source_file: 'notes/Alpha.md' },
    { id: 'graphify', source: 'b', target: 'c', context: 'graphify_inferred', source_file: 'graphify-out/graph.json' },
    { id: 'parallel-1', from: 'c', to: 'd', relation: 'linked' },
    { id: 'parallel-2', from: 'c', to: 'd', relation: 'linked' },
    { id: 'isolated', from: 'is1', to: 'is2', relation: 'linked' },
    { id: 'missing', from: 'e', to: 'missing-target', relation: 'linked', source_file: 'notes/Epsilon.md' },
    { id: 'no-guess', from: 'e', relation: 'linked', source_file: 'notes/Epsilon.md' }
  ]
};

const result = evidence.build(graph, { now });
assert.equal(evidence.schemaVersion, 1);
assert.equal(result.schemaVersion, 1);
assert.deepEqual(Object.keys(result.nodeEvidenceById.a), ['id', 'label', 'sourceFile', 'community', 'mtime', 'status', 'category', 'incoming', 'outgoing']);
assert.equal(result.nodeEvidenceById.a.outgoing[0].id, 'wikilink');
assert.equal(result.nodeEvidenceById.b.incoming[0].id, 'wikilink');
assert.equal(result.edgeEvidenceById.wikilink.provenance, 'Wikilink');
assert.equal(result.edgeEvidenceById.graphify.provenance, 'Graphify');
assert.equal(result.edgeEvidenceById['parallel-1'].provenance, 'Unknown');

const byRule = (rule) => result.proposals.filter((proposal) => proposal.rule.id === rule);
assert.ok(byRule('orphan-node').some((proposal) => proposal.subject.nodeIds[0] === 'orphan'));
assert.deepEqual(byRule('isolated-component').map((proposal) => proposal.subject.nodeIds), [['is1', 'is2']]);
assert.deepEqual(byRule('unresolved-explicit-edge').map((proposal) => proposal.subject.edgeIds), [['missing']]);
assert.equal(byRule('unresolved-explicit-edge')[0].evidence.missingEndpointIds[0], 'missing-target');
assert.ok(!result.proposals.some((proposal) => JSON.stringify(proposal).includes('PRIVATE_SENTINEL_NOTE_BODY')));
assert.ok(result.proposals.every((proposal) => proposal.preview.text.includes('No writes.')));
assert.ok(result.proposals.every((proposal) => proposal.rule.version === 1 && proposal.id && proposal.threshold.caveat));

const staleGraph = {
  nodes: Array.from({ length: 10 }, (_, index) => ({ id: index === 0 ? 'hub' : `n${index}`, source_file: `notes/${index}.md`, mtime: index === 0 ? '2026-01-01' : '' })),
  edges: Array.from({ length: 9 }, (_, index) => ({ from: 'hub', to: `n${index + 1}` }))
};
const stale = evidence.build(staleGraph, { now });
assert.equal(stale.proposals.filter((proposal) => proposal.rule.id === 'stale-hub').length, 1);
assert.equal(stale.proposals.find((proposal) => proposal.rule.id === 'stale-hub').subject.nodeIds[0], 'hub');
const missingNow = evidence.build(staleGraph);
assert.equal(missingNow.proposals.filter((proposal) => proposal.rule.id === 'stale-hub').length, 0);
assert.equal(missingNow.ruleResults.find((rule) => rule.id === 'stale-hub').status, 'unavailable');
const missingTimestamp = evidence.build({ ...staleGraph, nodes: staleGraph.nodes.map((node) => node.id === 'hub' ? { ...node, mtime: '' } : node) }, { now });
assert.equal(missingTimestamp.proposals.filter((proposal) => proposal.rule.id === 'stale-hub').length, 0);
assert.ok(missingTimestamp.caveats.some((caveat) => caveat.includes('hub')));

const whitespace = evidence.build({
  nodes: [{ id: ' a ', source_file: 'notes/Space.md' }, { id: 'a', source_file: 'notes/A.md' }],
  edges: [{ id: ' edge ', from: ' a ', to: 'a' }]
});
assert.ok(whitespace.nodeEvidenceById[' a ']);
assert.ok(whitespace.edgeEvidenceById[' edge ']);
assert.equal(whitespace.nodeEvidenceById[' a '].outgoing[0].targetId, 'a');

const cyclic = {};
cyclic.self = cyclic;
const nonScalar = evidence.build({
  nodes: [{ id: 'safe', label: cyclic, source_file: cyclic }],
  edges: [{ from: 'safe', to: cyclic, relation: cyclic }]
});
assert.ok(nonScalar.nodeEvidenceById.safe);
assert.equal(nonScalar.nodeEvidenceById.safe.label, 'safe');
assert.equal(Object.keys(nonScalar.edgeEvidenceById).length, 1);

const objectEndpoints = {
  nodes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
  edges: [
    { from: { id: 'a' }, to: { label: 'b' }, relation: 'linked' },
    { source: { name: 'b' }, target: { id: 'c' }, relation: 'linked' }
  ]
};
const scalarEndpoints = {
  nodes: objectEndpoints.nodes,
  edges: [{ from: 'a', to: 'b', relation: 'linked' }, { source: 'b', target: 'c', relation: 'linked' }]
};
const objectEndpointReport = evidence.build(objectEndpoints);
assert.equal(objectEndpointReport.nodeEvidenceById.a.outgoing.length, 1);
assert.equal(objectEndpointReport.nodeEvidenceById.b.incoming.length, 1);
assert.equal(objectEndpointReport.nodeEvidenceById.b.outgoing.length, 1);
assert.equal(objectEndpointReport.nodeEvidenceById.c.incoming.length, 1);
assert.deepEqual(
  Object.values(objectEndpointReport.edgeEvidenceById).map(({ sourceId, targetId }) => [sourceId, targetId]),
  Object.values(evidence.build(scalarEndpoints).edgeEvidenceById).map(({ sourceId, targetId }) => [sourceId, targetId])
);
assert.equal(
  JSON.stringify(objectEndpointReport),
  JSON.stringify(evidence.build({ nodes: [...objectEndpoints.nodes].reverse(), edges: [...objectEndpoints.edges].reverse() }))
);

const collisionEdges = evidence.build({
  nodes: [{ id: 'a' }, { id: 'b' }],
  edges: [
    { from: 'a', to: 'b', source_file: 'yqgj2ye3a2b5' },
    { from: 'a', to: 'b', source_file: 'pmkx2sxy62bn' }
  ]
});
assert.equal(new Set(Object.keys(collisionEdges.edgeEvidenceById)).size, 2);

const bridge = evidence.build({
  nodes: ['a', 'b', 'bridge', 'c', 'd'].map((id) => ({ id, source_file: `notes/${id}.md` })),
  edges: [
    { id: 'ab', from: 'a', to: 'b' }, { id: 'bb', from: 'b', to: 'bridge' },
    { id: 'bc', from: 'bridge', to: 'c' }, { id: 'cd', from: 'c', to: 'd' }
  ]
});
const bridges = bridge.proposals.filter((proposal) => proposal.rule.id === 'weak-bridge');
assert.deepEqual(bridges.map((proposal) => proposal.subject.nodeIds), [['b'], ['bridge'], ['c']]);
assert.equal(bridges.find((proposal) => proposal.subject.nodeIds[0] === 'bridge').evidence.removalComponentSizes.join(','), '2,2');

const reordered = evidence.build({ nodes: [...graph.nodes].reverse(), edges: [...graph.edges].reverse() }, { now });
assert.equal(JSON.stringify(result), JSON.stringify(reordered));
const unicode = {
  nodes: [{ id: 'é', source_file: 'notes/é.md' }, { id: 'Z', source_file: 'notes/Z.md' }, { id: 'a', source_file: 'notes/a.md' }],
  edges: [{ from: 'é', to: 'Z' }, { from: 'Z', to: 'a' }]
};
assert.equal(
  JSON.stringify(evidence.build(unicode)),
  JSON.stringify(evidence.build({ nodes: [...unicode.nodes].reverse(), edges: [...unicode.edges].reverse() }))
);
const before = JSON.stringify(graph);
evidence.build(graph, { now });
assert.equal(JSON.stringify(graph), before);

const largePrimary = Array.from({ length: 501 }, (_, index) => ({ id: `primary-${index}` }));
const largeSatellite = Array.from({ length: 500 }, (_, index) => ({ id: `satellite-${index}` }));
const largeComponents = evidence.build({
  nodes: [...largePrimary, ...largeSatellite],
  edges: [
    ...Array.from({ length: 500 }, (_, index) => ({ from: `primary-${index}`, to: `primary-${index + 1}` })),
    ...Array.from({ length: 499 }, (_, index) => ({ from: `satellite-${index}`, to: `satellite-${index + 1}` }))
  ]
});
const largeIsolated = largeComponents.proposals.find((proposal) => proposal.rule.id === 'isolated-component');
assert.equal(largeIsolated.subject.nodeIds.length, 500);
assert.ok(largeIsolated.id.length < 100);
assert.ok(largeIsolated.preview.text.length < 700);

const stressNodes = Array.from({ length: 5000 }, (_, index) => ({ id: `n${index}` }));
const stressEdges = Array.from({ length: 4999 }, (_, index) => ({ from: `n${index}`, to: `n${index + 1}` }));
const started = performance.now();
const stress = evidence.build({ nodes: stressNodes, edges: stressEdges });
assert.equal(stress.proposals.filter((proposal) => proposal.rule.id === 'weak-bridge').length, 4998);
assert.ok(performance.now() - started < 5000, 'Tarjan bridge analysis should remain linear for a 5k chain');

const pathologicalPairs = Array.from({ length: 25000 }, (_, index) => ({ id: `pair-${index}` }));
const pathologicalPairEdges = Array.from({ length: 12500 }, (_, index) => ({ from: `pair-${index * 2}`, to: `pair-${index * 2 + 1}` }));
const pairStarted = performance.now();
const pairReport = evidence.build({ nodes: pathologicalPairs, edges: pathologicalPairEdges });
const pairElapsed = performance.now() - pairStarted;
assert.equal(pairReport.proposals.filter((proposal) => proposal.rule.id === 'isolated-component').length, 12499);
assert.ok(pairElapsed < 2000, `25k disjoint pairs exceeded 2s: ${pairElapsed.toFixed(1)}ms`);
assert.ok(JSON.stringify(pairReport).length < 35_000_000, '25k disjoint-pair report exceeded 35MB');

const chain25kNodes = Array.from({ length: 25000 }, (_, index) => ({ id: `chain-${index}` }));
const chain25kEdges = Array.from({ length: 24999 }, (_, index) => ({ from: `chain-${index}`, to: `chain-${index + 1}` }));
const chainStarted = performance.now();
const chainReport = evidence.build({ nodes: chain25kNodes, edges: chain25kEdges });
const chainElapsed = performance.now() - chainStarted;
assert.equal(chainReport.proposals.filter((proposal) => proposal.rule.id === 'weak-bridge').length, 24998);
assert.ok(chainElapsed < 2000, `25k chain exceeded 2s: ${chainElapsed.toFixed(1)}ms`);
assert.ok(JSON.stringify(chainReport).length < 35_000_000, '25k chain report exceeded 35MB');

const manifest = await loadFixtureManifest();
const fixture25k = generateFixture(manifest.fixtures.find((fixture) => fixture.name === '25k-stress'));
const start25k = performance.now();
const report25k = evidence.build(fixture25k, { now });
const elapsed25k = performance.now() - start25k;
assert.equal(Object.keys(report25k.nodeEvidenceById).length, 25000);
assert.equal(Object.keys(report25k.edgeEvidenceById).length, 59512);
assert.ok(elapsed25k < 2000, `25k metadata build exceeded 2s: ${elapsed25k.toFixed(1)}ms`);

console.log(`graph evidence tests passed (${result.proposals.length} baseline proposals; 25k ${elapsed25k.toFixed(1)}ms)`);
