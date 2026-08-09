import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  baselineCommit,
  buildAcceptanceReport,
  buildGolden,
  enforceProvisionalGates,
  inspectBaseline,
  measuredFixtureNames,
  requiredRuntimeDiagnostics,
  scenarioNames,
  overviewPaintGate,
  provisionalOverviewNodeBudget,
  validateGolden,
  hostedRuntimeEvidence,
  formatMarkdown
} from './graph3d-presentation-acceptance.mjs';
import { measurementMetricNames, summarize } from './renderer-measurement-utils.mjs';

const baseline = await inspectBaseline(baselineCommit);
assert.equal(baseline.capture, 'before');
assert.equal(baseline.sourceInspection, 'read-only-git-object');
assert.equal(baseline.renderedRuntime, false);
assert.deepEqual(Object.keys(baseline.diagnosticAvailability), requiredRuntimeDiagnostics);
assert.equal(Object.values(baseline.diagnosticAvailability).filter(Boolean).length, 1, 'only the pre-existing camera preset is exposed by name');
assert.deepEqual(
  overviewPaintGate({ detailLevel: 'overview', queryableNodeCount: 25000, paintedNodeCount: provisionalOverviewNodeBudget + 5, activePromotionNodeCount: 5 }),
  { status: 'pass', budget: provisionalOverviewNodeBudget, allowance: 5, limit: provisionalOverviewNodeBudget + 5, observed: provisionalOverviewNodeBudget + 5 }
);
assert.equal(
  overviewPaintGate({ detailLevel: 'overview', queryableNodeCount: 25000, paintedNodeCount: provisionalOverviewNodeBudget + 6, activePromotionNodeCount: 5 }).status,
  'fail'
);

const manifest = JSON.parse(await readFile('outputs/graph3d-presentation-acceptance-manifest-v1.json', 'utf8'));
assert.equal(manifest.schemaVersion, 1);
assert.equal(manifest.provisionalGates.overviewPaintedNodeLimit, provisionalOverviewNodeBudget);
assert.deepEqual(manifest.scenarios, scenarioNames);

const report = await buildAcceptanceReport();
assert.equal(report.schemaVersion, 1);
assert.deepEqual(report.protocol.fixtureNames, measuredFixtureNames);
assert.deepEqual(report.protocol.scenarioNames, scenarioNames);
assert.equal(report.fixtures.length, measuredFixtureNames.length);
for (const fixture of report.fixtures) {
  assert.equal(fixture.scenarios.length, scenarioNames.length);
  assert.equal(fixture.indexBuildMs.scope, 'pure-presentation-index; renderer indexes pre-existing');
  assert.equal(fixture.indexBuildMs.samples.length, 9);
  assert.ok(fixture.indexBuildMs.samples.every(Number.isFinite));
  // Index construction is a one-time readiness phase; interaction re-plans below
  // remain the binding 25k responsiveness check. Keep generous host-noise headroom.
  assert.ok(fixture.indexBuildMs.p95 < 250, `${fixture.name} index build p95 must stay below 250ms with renderer indexes`);
  if (fixture.nodeCount === 25000) {
    assert.ok(fixture.indexBuildMs.p95 < 120, `25k prepared presentation index p95 must stay below 120ms`);
  }
  const byName = new Map(fixture.scenarios.map((scenario) => [scenario.scenario, scenario]));
  const collapsed = byName.get('overview-collapsed');
  const docked = byName.get('overview-docked');
  const narrow = byName.get('narrow-overlay');
  const reduced = byName.get('reduce-motion');
  assert.equal(collapsed.queryableNodeCount, fixture.nodeCount);
  assert.equal(collapsed.queryableEdgeCount, fixture.edgeCount);
  assert.equal(collapsed.paintedNodeCount, docked.paintedNodeCount);
  assert.equal(collapsed.paintedEdgeCount, docked.paintedEdgeCount);
  assert.equal(collapsed.paintedNodeCount, narrow.paintedNodeCount);
  assert.equal(collapsed.paintedEdgeCount, narrow.paintedEdgeCount);
  assert.equal(reduced.reduceMotion, true);
  assert.equal(reduced.metrics.frameQuality.status, 'requires-runtime-diagnostics');
  if (fixture.nodeCount > 2500) {
    assert.equal(collapsed.gates.overviewPaintBudget.status, 'pass', 'Overview must remain within the bounded structural paint budget');
  }
  for (const scenario of fixture.scenarios) {
    assert.ok(scenario.paintedNodeCount <= scenario.queryableNodeCount);
    assert.ok(scenario.paintedEdgeCount <= scenario.queryableEdgeCount);
    for (const metricName of ['staticLayerPlanMs', 'labelAllocationMs', 'interactionReplanMs']) {
      const metric = scenario.metrics[metricName];
      assert.equal(metric.samples.length, 9);
      assert.ok(metric.samples.every(Number.isFinite));
    }
    if (fixture.nodeCount === 25000) {
      // Pure Node planner timing; the hosted WKWebView interaction feedback
      // limit remains independently enforced at 50 ms.
      assert.ok(scenario.metrics.interactionReplanMs.p95 < 100, `${scenario.scenario} 25k pure-planner replan p95 must stay below 100ms`);
    }
  }
}

const golden = buildGolden(report);
assert.equal(validateGolden(report, golden), true);
assert.equal(enforceProvisionalGates(report), true);
const hostedSamples = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const hostedReport = {
  schemaVersion: 1,
  fixture: { name: '1k', nodeCount: 1000, edgeCount: 2380 },
  protocol: { coldRuns: 1, warmupRuns: 2, measuredRuns: 9 },
  environment: { processIdentifier: 1, operatingSystemVersion: 'Version 26.5.2 (Build 25F84)', physicalMemoryBytes: 16 },
  cold: Object.fromEntries(measurementMetricNames.map((name) => [name, summarize([1])])),
  measured: Object.fromEntries(measurementMetricNames.map((name) => [name, summarize(hostedSamples)])),
  parity: { threeDQueryableNodes: 1000, threeDQueryableEdges: 2380, twoDQueryableNodes: 1000, twoDQueryableEdges: 2380, matchesFixture: true },
  memoryScope: 'app_process_resident_max_sample_bytes_only'
};
const hostedEvidence = hostedRuntimeEvidence(hostedReport);
assert.equal(hostedEvidence.status, 'verified-hosted-wkwebview');
assert.equal(hostedEvidence.gates.interactionFeedbackP95Ms.status, 'pass');
assert.equal(hostedEvidence.gates.panOrbitFrameP95Ms.status, 'pass');
const hostedAcceptance = await buildAcceptanceReport({ fixtureNames: ['1k'], hostedRendererReport: hostedReport });
assert.match(formatMarkdown(hostedAcceptance), /Hosted WKWebView runtime evidence/);
const text = JSON.stringify(report);
for (const disallowed of ['.md', 'source_file', 'sourcefile', 'graph.json', 'private_sentinel']) {
  assert.equal(text.toLowerCase().includes(disallowed), false, `content-free report contains ${disallowed}`);
}

console.log('Graph3D presentation acceptance harness tests passed.');
