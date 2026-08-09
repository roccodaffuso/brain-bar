import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const report = JSON.parse(await readFile('outputs/graph3d-whole-renderer-memory-evidence.json', 'utf8'));
assert.equal(report.schemaVersion, 1);
assert.equal(report.kind, 'graph3d-whole-renderer-memory-evidence');
assert.equal(report.captureKind, 'synchronized-all-process-activity-monitor-sample');
assert.equal(report.focusedTest.name, 'testGraph3DOverviewFitKeepsReviewedSpatialFixturesVisibleInCompactViewport');
assert.equal(report.focusedTest.durationSeconds, 3.11);
assert.deepEqual(report.focusedTest.fixtureSequence.map(({ name, nodeCount, edgeCount }) => ({ name, nodeCount, edgeCount })), [
  { name: '1k', nodeCount: 1000, edgeCount: 2380 },
  { name: 'inspected-shape', nodeCount: 12547, edgeCount: 29868 },
  { name: '25k-stress', nodeCount: 25000, edgeCount: 59512 }
]);

const parts = report.singleFocusedWebView.physicalFootprintBytes;
assert.deepEqual(report.singleFocusedWebView.sampleRows, {
  applicationRows: 2,
  directChildRows: 4,
  processesAtMaximumSample: 5
});
const familyParts = [
  parts.applicationTestProcess,
  parts.webKitGPU,
  parts.webKitNetworking,
  parts.webKitWebContent,
  parts.supportingMediaHelper
];
assert.ok(familyParts.every((value) => Number.isInteger(value) && value > 0));
assert.equal(familyParts.reduce((sum, value) => sum + value, 0), parts.family);
assert.equal(Number((parts.family / (1024 * 1024)).toFixed(2)), report.singleFocusedWebView.familyPhysicalFootprintMiB);
assert.equal(report.singleFocusedWebView.measurementScope, 'maximum-sampled-physical-footprint');
assert.deepEqual(report.releaseReviewBudget, {
  classification: 'provisional-single-view-maximum-sampled-family-physical-footprint',
  referenceHostCeilingMiB: 900,
  observedMiB: 788.89,
  headroomMiB: 111.11,
  passed: true,
  scope: 'one-focused-visible-webview-on-the-reference-host'
});
assert.equal(report.harnessStressUpperBound.maximumConcurrentFamilySampleBytes, 3196977184);
assert.equal(report.harnessStressUpperBound.maximumConcurrentFamilySampleMiB, 3048.88);
assert.equal(report.harnessStressUpperBound.classification, 'harness-stress-upper-bound-not-product-single-view-memory');
assert.ok(report.limitations.includes('provisional-release-ceiling-is-not-an-allocation-or-leak-proof'));

const serialized = JSON.stringify(report).toLowerCase();
for (const disallowed of ['/users/', '/private/', '.trace', ' pid', 'username']) {
  assert.equal(serialized.includes(disallowed), false, `memory evidence must stay content-free: ${disallowed}`);
}

console.log('Graph3D whole-renderer memory evidence validated.');
