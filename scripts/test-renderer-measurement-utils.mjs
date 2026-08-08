import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { coefficientOfVariation, formatMarkdownReport, percentile, summarize, validateMeasurementReport } from './renderer-measurement-utils.mjs';
import { createMeasurementRequest, measurementRequestPath, measurementRequestVersion, parseHarnessArguments, xcodebuildArguments } from './run-renderer-measurements.mjs';

assert.equal(percentile([1, 2, 3, 4], 0.5), 2.5);
assert.ok(Math.abs(percentile([1, 2, 3, 4], 0.95) - 3.85) < 1e-12);
assert.equal(coefficientOfVariation([5, 5, 5]), 0);
assert.equal(summarize([1, 2, 3]).p50, 2);
assert.deepEqual(parseHarnessArguments(['--case', '1k', '--format', 'markdown']), { fixtureName: '1k', format: 'markdown', transportOnly: false, transportImplementation: 'current' });
assert.deepEqual(parseHarnessArguments(['--case', '1k', '--transport-only']), { fixtureName: '1k', format: 'json', transportOnly: true, transportImplementation: 'current' });
assert.deepEqual(parseHarnessArguments(['--case', '1k', '--transport-only', '--transport-implementation', 'legacy']), { fixtureName: '1k', format: 'json', transportOnly: true, transportImplementation: 'legacy' });
assert.throws(() => parseHarnessArguments(['--case', '1k', '--format', 'csv']));
assert.throws(() => parseHarnessArguments(['--case', '1k', '--transport-implementation', 'legacy']));
assert.throws(() => parseHarnessArguments(['--case', 'unreviewed']));
assert.ok(xcodebuildArguments().includes('-only-testing:BrainBarTests/BrainBarTests/testOptInRendererMeasurementHarness'));
assert.equal(measurementRequestPath, '/private/tmp/brainbar-renderer-measurements-request.json');
assert.deepEqual(
  createMeasurementRequest({ fixtureName: '1k', measurementRoot: '/private/tmp/brainbar-renderer-measurements-test', fixturePath: '/private/tmp/brainbar-renderer-measurements-test/fixtures/1k.json', outputPath: '/private/tmp/brainbar-renderer-measurements-test/report.json', createdAt: 1, launcherPID: 2 }),
  { version: measurementRequestVersion, fixtureName: '1k', measurementRoot: '/private/tmp/brainbar-renderer-measurements-test', fixturePath: '/private/tmp/brainbar-renderer-measurements-test/fixtures/1k.json', outputPath: '/private/tmp/brainbar-renderer-measurements-test/report.json', measurementKind: 'renderer', createdAt: 1, launcherPID: 2 }
);
assert.throws(() => createMeasurementRequest({ fixtureName: '1k', measurementRoot: '/private/tmp/brainbar-renderer-measurements-test', fixturePath: '/private/tmp/brainbar-renderer-measurements-test/fixtures/1k.json', outputPath: '/private/tmp/brainbar-renderer-measurements-test/report.json', measurementKind: 'transport', launcherPID: 1 }));
assert.throws(() => createMeasurementRequest({ fixtureName: 'unreviewed', measurementRoot: '/private/tmp/brainbar-renderer-measurements-test', fixturePath: '/private/tmp/brainbar-renderer-measurements-test/fixture.json', outputPath: '/private/tmp/brainbar-renderer-measurements-test/report.json', launcherPID: 1 }));
assert.throws(() => createMeasurementRequest({ fixtureName: '1k', measurementRoot: '/private/tmp/brainbar-renderer-measurements-test', fixturePath: '/private/tmp/elsewhere/1k.json', outputPath: '/private/tmp/brainbar-renderer-measurements-test/report.json', launcherPID: 1 }));
const invalidCLI = spawnSync(process.execPath, ['scripts/run-renderer-measurements.mjs', '--case', 'unreviewed'], { encoding: 'utf8' });
assert.equal(invalidCLI.status, 1);
assert.match(invalidCLI.stderr, /Usage:/);

const names = [
  'graphTransportPreparationMs', 'appProcessResidentDeltaAfterTransportPreparationBytes', 'appProcessResidentMaxSampleBytes',
  'threeDLoadToSettledPaintMs', 'threeDLayoutPreparationMs', 'threeDLayoutCallReturnMs', 'threeDLayoutZeroDelayTimerProbeMs',
  'threeDLensToSettledMs', 'threeDSearchToSettledMs',
  'twoDRuntimeLoadToDiagnosticsMs', 'twoDRuntimeLensToDiagnosticsMs', 'twoDRuntimeSearchToDiagnosticsMs'
];
const summary = (samples) => ({ samples, p50: percentile(samples, 0.5), p95: percentile(samples, 0.95), cvPercent: coefficientOfVariation(samples) });
const report = {
  schemaVersion: 1,
  fixture: { name: '1k', nodeCount: 1000, edgeCount: 2380 },
  protocol: { coldRuns: 1, warmupRuns: 2, measuredRuns: 9 },
  environment: { processIdentifier: 1, operatingSystemVersion: 'Version 26.5.2 (Build 25F84)', physicalMemoryBytes: 16 },
  cold: Object.fromEntries(names.map((name) => [name, summary([1])])),
  measured: Object.fromEntries(names.map((name) => [name, summary([1, 2, 3, 4, 5, 6, 7, 8, 9])])),
  parity: { threeDQueryableNodes: 1000, threeDQueryableEdges: 2380, twoDQueryableNodes: 1000, twoDQueryableEdges: 2380, matchesFixture: true },
  memoryScope: 'app_process_resident_max_sample_bytes_only'
};
assert.equal(validateMeasurementReport(report), report);
assert.match(formatMarkdownReport(report), /Observed renderer measurements: 1k/);
assert.throws(() => validateMeasurementReport({ ...report, fixture: { ...report.fixture, name: 'node-label' } }));
assert.throws(() => validateMeasurementReport({ ...report, measured: { ...report.measured, graphTransportPreparationMs: { ...report.measured.graphTransportPreparationMs, p50: 99 } } }));
assert.throws(() => {
  const { threeDLayoutCallReturnMs, ...missingResponsivenessMetric } = report.measured;
  validateMeasurementReport({ ...report, measured: missingResponsivenessMetric });
});
console.log('Renderer measurement utility tests passed.');
