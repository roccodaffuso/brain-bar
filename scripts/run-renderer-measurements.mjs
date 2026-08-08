import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { formatMarkdownReport, isReviewedFixtureName, validateMeasurementReport } from './renderer-measurement-utils.mjs';

export const measurementRequestPath = '/private/tmp/brainbar-renderer-measurements-request.json';
export const measurementRequestVersion = 2;
const measurementDirectoryPrefix = '/private/tmp/brainbar-renderer-measurements-';

export function parseHarnessArguments(argumentsList) {
  let fixtureName;
  let format = 'json';
  let transportOnly = false;
  let transportImplementation = 'current';
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === '--case') {
      fixtureName = argumentsList[index + 1];
      index += 1;
    } else if (argument === '--format') {
      format = argumentsList[index + 1];
      index += 1;
    } else if (argument === '--transport-only') {
      transportOnly = true;
    } else if (argument === '--transport-implementation') {
      transportImplementation = argumentsList[index + 1];
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (!isReviewedFixtureName(fixtureName) || !['json', 'markdown'].includes(format) || !['legacy', 'current'].includes(transportImplementation) || (!transportOnly && transportImplementation !== 'current')) {
    throw new Error('Usage: node scripts/run-renderer-measurements.mjs --case <fixture-name> [--format json|markdown] [--transport-only --transport-implementation legacy|current]');
  }
  return { fixtureName, format, transportOnly, transportImplementation };
}

export function createMeasurementRequest({ fixtureName, measurementRoot, fixturePath, outputPath, measurementKind = 'renderer', createdAt = Date.now() / 1_000, launcherPID = process.pid }) {
  if (!isReviewedFixtureName(fixtureName)) {
    throw new Error(`Unknown reviewed fixture: ${fixtureName}`);
  }
  if (!measurementRoot?.startsWith(measurementDirectoryPrefix) || !fixturePath.startsWith(`${measurementRoot}/`) || !outputPath.startsWith(`${measurementRoot}/`) || !Number.isFinite(createdAt) || !Number.isInteger(launcherPID) || launcherPID <= 0) {
    throw new Error('Invalid temporary measurement request.');
  }
  if (!['renderer', 'transport-legacy', 'transport-current'].includes(measurementKind)) {
    throw new Error('Invalid measurement kind.');
  }
  return { version: measurementRequestVersion, fixtureName, measurementRoot, fixturePath, outputPath, measurementKind, createdAt, launcherPID };
}

export function xcodebuildArguments(transportOnly = false) {
  return [
    'test', '-project', 'BrainBar.xcodeproj', '-scheme', 'BrainBar',
    '-destination', 'platform=macOS', 'CODE_SIGNING_ALLOWED=NO',
    `-only-testing:BrainBarTests/BrainBarTests/${transportOnly ? 'testOptIn3DTransportPreparationBenchmark' : 'testOptInRendererMeasurementHarness'}`
  ];
}

async function run(command, argumentsList, environment) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, argumentsList, { cwd: process.cwd(), env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (data) => { output += data; });
    child.stderr.on('data', (data) => { output += data; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, output }));
  });
}

async function main() {
  const { fixtureName, format, transportOnly, transportImplementation } = parseHarnessArguments(process.argv.slice(2));
  const directory = await mkdtemp('/private/tmp/brainbar-renderer-measurements-');
  const fixtureDirectory = join(directory, 'fixtures');
  const reportPath = join(directory, 'report.json');
  let requestCreated = false;
  try {
    const generator = await run(process.execPath, ['scripts/generate-large-graph-fixtures.mjs', '--case', fixtureName, '--output-dir', fixtureDirectory], process.env);
    if (generator.code !== 0) {
      throw new Error(`Fixture generation failed:\n${generator.output}`);
    }
    const request = createMeasurementRequest({
      fixtureName,
      measurementKind: transportOnly ? `transport-${transportImplementation}` : 'renderer',
      measurementRoot: directory,
      fixturePath: join(fixtureDirectory, `${fixtureName}.json`),
      outputPath: reportPath
    });
    try {
      await writeFile(measurementRequestPath, JSON.stringify(request), { flag: 'wx' });
      requestCreated = true;
    } catch (error) {
      if (error?.code === 'EEXIST') {
        throw new Error(`Measurement request collision at ${measurementRequestPath}; another run may be active or a stale marker needs inspection and removal.`);
      }
      throw error;
    }
    const result = await run('xcodebuild', xcodebuildArguments(transportOnly), process.env);
    if (result.code !== 0) {
      throw new Error(`Measurement XCTest failed:\n${result.output}`);
    }
    const report = JSON.parse(await readFile(reportPath, 'utf8'));
    if (!transportOnly) {
      validateMeasurementReport(report);
    }
    process.stdout.write(`${format === 'markdown' ? formatMarkdownReport(report) : JSON.stringify(report, null, 2)}\n`);
  } finally {
    if (requestCreated) {
      await rm(measurementRequestPath, { force: true });
    }
    await rm(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
