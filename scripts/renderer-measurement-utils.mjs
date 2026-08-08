export const reviewedFixtures = Object.freeze({
  '1k': Object.freeze({ nodeCount: 1000, edgeCount: 2380 }),
  '10k': Object.freeze({ nodeCount: 10000, edgeCount: 23805 }),
  'inspected-shape': Object.freeze({ nodeCount: 12547, edgeCount: 29868 }),
  '25k-stress': Object.freeze({ nodeCount: 25000, edgeCount: 59512 })
});

const metricNames = new Set([
  'graphTransportPreparationMs',
  'appProcessResidentDeltaAfterTransportPreparationBytes',
  'appProcessResidentMaxSampleBytes',
  'threeDLoadToSettledPaintMs',
  'threeDLayoutPreparationMs',
  'threeDLayoutCallReturnMs',
  'threeDLayoutZeroDelayTimerProbeMs',
  'threeDLensToSettledMs',
  'threeDSearchToSettledMs',
  'twoDRuntimeLoadToDiagnosticsMs',
  'twoDRuntimeLensToDiagnosticsMs',
  'twoDRuntimeSearchToDiagnosticsMs'
]);

export function isReviewedFixtureName(name) {
  return typeof name === 'string' && Object.hasOwn(reviewedFixtures, name);
}

export function percentile(samples, percentileValue) {
  if (!Array.isArray(samples) || samples.length === 0 || !Number.isFinite(percentileValue)) {
    throw new Error('Percentile requires finite samples and a percentile value.');
  }
  const sorted = [...samples];
  if (!sorted.every(Number.isFinite)) {
    throw new Error('Percentile samples must be finite.');
  }
  sorted.sort((left, right) => left - right);
  const index = (sorted.length - 1) * Math.min(1, Math.max(0, percentileValue));
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  return sorted[lower] + ((sorted[upper] - sorted[lower]) * (index - lower));
}

export function coefficientOfVariation(samples) {
  if (!Array.isArray(samples) || samples.length === 0 || !samples.every(Number.isFinite)) {
    throw new Error('CV requires finite samples.');
  }
  const mean = samples.reduce((total, value) => total + value, 0) / samples.length;
  if (mean === 0) {
    return 0;
  }
  const variance = samples.reduce((total, value) => total + ((value - mean) ** 2), 0) / samples.length;
  return (Math.sqrt(variance) / mean) * 100;
}

export function summarize(samples) {
  return {
    samples,
    p50: percentile(samples, 0.5),
    p95: percentile(samples, 0.95),
    cvPercent: coefficientOfVariation(samples)
  };
}

export function validateMeasurementReport(report) {
  if (!report || typeof report !== 'object' || Array.isArray(report)) {
    throw new Error('Measurement report must be an object.');
  }
  const expectedTopLevel = new Set(['schemaVersion', 'fixture', 'protocol', 'environment', 'cold', 'measured', 'parity', 'memoryScope']);
  if (!sameKeys(report, expectedTopLevel) || report.schemaVersion !== 1) {
    throw new Error('Unexpected measurement report schema.');
  }
  validateFixture(report.fixture);
  validateProtocol(report.protocol);
  validateEnvironment(report.environment);
  if (report.memoryScope !== 'app_process_resident_max_sample_bytes_only') {
    throw new Error('Unexpected memory scope.');
  }
  validateParity(report.parity, report.fixture);
  validateMetricCollection(report.cold, 'cold');
  validateMetricCollection(report.measured, 'measured');
  assertContentFree(report);
  return report;
}

export function formatMarkdownReport(report) {
  validateMeasurementReport(report);
  const rows = Object.entries(report.measured)
    .map(([name, summary]) => `| ${name} | ${summary.p50.toFixed(2)} | ${summary.p95.toFixed(2)} | ${summary.cvPercent.toFixed(2)}% |`)
    .join('\n');
  return [
    `# Observed renderer measurements: ${report.fixture.name}`,
    '',
    `Fixture: ${report.fixture.nodeCount} nodes / ${report.fixture.edgeCount} edges. These are observed measurements, not approved budgets.`,
    '',
    '| Metric | p50 | p95 | CV |',
    '| --- | ---: | ---: | ---: |',
    rows,
    '',
    'Memory scope: app-process resident maximum discrete sample only; WebContent is excluded.',
    `Queryable parity matches fixture: ${report.parity.matchesFixture}.`
  ].join('\n');
}

function validateFixture(fixture) {
  if (!fixture || typeof fixture !== 'object' || Array.isArray(fixture) || !sameKeys(fixture, new Set(['name', 'nodeCount', 'edgeCount'])) || !isReviewedFixtureName(fixture.name)) {
    throw new Error('Invalid fixture metadata.');
  }
  const expected = reviewedFixtures[fixture.name];
  if (fixture.nodeCount !== expected.nodeCount || fixture.edgeCount !== expected.edgeCount) {
    throw new Error('Fixture counts do not match the reviewed definition.');
  }
}

function validateProtocol(protocol) {
  if (!isIntegerObject(protocol, new Set(['coldRuns', 'warmupRuns', 'measuredRuns'])) ||
      protocol.coldRuns !== 1 || protocol.warmupRuns !== 2 || protocol.measuredRuns !== 9) {
    throw new Error('Unexpected measurement protocol.');
  }
}

function validateEnvironment(environment) {
  if (!environment || typeof environment !== 'object' || Array.isArray(environment) || !sameKeys(environment, new Set(['processIdentifier', 'operatingSystemVersion', 'physicalMemoryBytes'])) ||
      !Number.isInteger(environment.processIdentifier) || !Number.isInteger(environment.physicalMemoryBytes) || environment.physicalMemoryBytes < 1 ||
      typeof environment.operatingSystemVersion !== 'string' || !/^Version \d+\.\d+(?:\.\d+)? \(Build [A-Za-z0-9]+\)$/.test(environment.operatingSystemVersion)) {
    throw new Error('Invalid content-free environment metadata.');
  }
}

function validateParity(parity, fixture) {
  if (!parity || typeof parity !== 'object' || Array.isArray(parity) || !sameKeys(parity, new Set(['threeDQueryableNodes', 'threeDQueryableEdges', 'twoDQueryableNodes', 'twoDQueryableEdges', 'matchesFixture'])) ||
      !Number.isInteger(parity.threeDQueryableNodes) || !Number.isInteger(parity.threeDQueryableEdges) ||
      !Number.isInteger(parity.twoDQueryableNodes) || !Number.isInteger(parity.twoDQueryableEdges) || parity.matchesFixture !== true ||
      parity.threeDQueryableNodes !== fixture.nodeCount || parity.threeDQueryableEdges !== fixture.edgeCount ||
      parity.twoDQueryableNodes !== fixture.nodeCount || parity.twoDQueryableEdges !== fixture.edgeCount) {
    throw new Error('Invalid queryable parity metadata.');
  }
}

function validateMetricCollection(collection, name) {
  if (!collection || typeof collection !== 'object' || Array.isArray(collection) || !sameKeys(collection, metricNames)) {
    throw new Error(`Unexpected ${name} metrics.`);
  }
  for (const [metricName, value] of Object.entries(collection)) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || !sameKeys(value, new Set(['samples', 'p50', 'p95', 'cvPercent'])) ||
        !Array.isArray(value.samples) || value.samples.length !== (name === 'cold' ? 1 : 9) || !value.samples.every(Number.isFinite) || ![value.p50, value.p95, value.cvPercent].every(Number.isFinite)) {
      throw new Error(`Invalid metric values: ${metricName}`);
    }
    const computed = summarize(value.samples);
    if (!approximatelyEqual(value.p50, computed.p50) || !approximatelyEqual(value.p95, computed.p95) || !approximatelyEqual(value.cvPercent, computed.cvPercent)) {
      throw new Error(`Metric summary does not match samples: ${metricName}`);
    }
  }
}

function isIntegerObject(value, expectedKeys) {
  return value && typeof value === 'object' && !Array.isArray(value) && sameKeys(value, expectedKeys) && Object.values(value).every(Number.isInteger);
}

function sameKeys(value, expected) {
  const keys = Object.keys(value);
  return keys.length === expected.size && keys.every((key) => expected.has(key));
}

function approximatelyEqual(left, right) {
  return Math.abs(left - right) <= Math.max(1e-9, Math.max(Math.abs(left), Math.abs(right)) * 1e-9);
}

function assertContentFree(value) {
  const serialized = JSON.stringify(value);
  for (const forbidden of ['label', 'source_file', 'sourceFile', 'fixture ', 'node-', 'edge-', '.md']) {
    if (serialized.toLowerCase().includes(forbidden.toLowerCase())) {
      throw new Error(`Measurement report contains disallowed content-bearing value: ${forbidden}`);
    }
  }
}
