#!/usr/bin/env node
// Deliberate, public-fixture-only capture runner for Graph3D visual review.
// Ordinary XCTest runs never see this request marker and therefore write no
// screenshots. The XCTest consumes the marker once, validates it, and writes
// only below the temporary capture root.
import { copyFile, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { fixtureDigest, generateFixture, loadFixtureManifest } from './generate-large-graph-fixtures.mjs';

export const captureRequestPath = '/private/tmp/brainbar-graph3d-visual-capture-request.json';
export const captureRequestVersion = 1;
export const captureDirectoryPrefix = '/private/tmp/brainbar-graph3d-visual-capture-';
export const captureOutputDirectory = 'outputs/graph3d-visual-acceptance';
export const reviewedFixtureDigests = Object.freeze({
  '1k': '1f7ec933358a7bd1ff5405278d986a3998b4f37f6c4d9df621dfe08071260bad',
  'inspected-shape': 'e1a4217a3ce6f117ac4155710c67f5f36754d2b3d9599bca08b817506534438f'
});

export const captureScenarios = Object.freeze([
  Object.freeze({ name: '1k-overview-collapsed', fixtureName: '1k', width: 1000, height: 720, outputName: '1k-overview-collapsed.png' }),
  Object.freeze({ name: '1k-overview-docked', fixtureName: '1k', width: 1000, height: 720, outputName: '1k-overview-docked.png' }),
  Object.freeze({ name: 'inspected-overview-collapsed', fixtureName: 'inspected-shape', width: 1000, height: 720, outputName: 'inspected-overview-collapsed.png' }),
  Object.freeze({ name: 'inspected-overview-docked', fixtureName: 'inspected-shape', width: 1000, height: 720, outputName: 'inspected-overview-docked.png' }),
  Object.freeze({ name: '1k-community', fixtureName: '1k', width: 1000, height: 720, outputName: '1k-community.png' }),
  Object.freeze({ name: '1k-node-focus', fixtureName: '1k', width: 1000, height: 720, outputName: '1k-node-focus.png' }),
  Object.freeze({ name: '1k-selected-hub', fixtureName: '1k', width: 1000, height: 720, outputName: '1k-selected-hub.png' }),
  Object.freeze({ name: '1k-selected-peripheral', fixtureName: '1k', width: 1000, height: 720, outputName: '1k-selected-peripheral.png' }),
  Object.freeze({ name: '1k-active-path', fixtureName: '1k', width: 1000, height: 720, outputName: '1k-active-path.png' }),
  Object.freeze({ name: '1k-recent-orbit', fixtureName: '1k', width: 1000, height: 720, outputName: '1k-recent-orbit.png' }),
  Object.freeze({ name: '1k-agent-activity', fixtureName: '1k', width: 1000, height: 720, outputName: '1k-agent-activity.png' }),
  Object.freeze({ name: '1k-workflow-highlight', fixtureName: '1k', width: 1000, height: 720, outputName: '1k-workflow-highlight.png' }),
  Object.freeze({ name: '1k-graph-check', fixtureName: '1k', width: 1000, height: 720, outputName: '1k-graph-check.png' }),
  Object.freeze({ name: '1k-narrow-overlay', fixtureName: '1k', width: 620, height: 720, outputName: '1k-narrow-overlay.png' }),
  Object.freeze({ name: '1k-reduce-motion', fixtureName: '1k', width: 1000, height: 720, outputName: '1k-reduce-motion.png' })
]);

export const matchedCoreScenarioNames = Object.freeze([
  '1k-overview-collapsed', '1k-overview-docked', '1k-community', '1k-node-focus',
  '1k-selected-hub', '1k-selected-peripheral', '1k-active-path', '1k-recent-orbit',
  '1k-agent-activity', '1k-workflow-highlight', '1k-graph-check', '1k-reduce-motion'
]);

function isDirectChild(root, candidate) {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(candidate);
  return resolvedCandidate.startsWith(`${resolvedRoot}/`);
}

export function createCaptureRequest({ captureRoot, fixturePaths, fixtureDigests = reviewedFixtureDigests, outputRoot, createdAt = Date.now() / 1_000, launcherPID = process.pid }) {
  if (!captureRoot?.startsWith(captureDirectoryPrefix) || !isDirectChild(captureRoot, outputRoot) || !Number.isFinite(createdAt) || !Number.isInteger(launcherPID) || launcherPID <= 0) {
    throw new Error('Invalid temporary visual capture request.');
  }
  const expectedFixtures = ['1k', 'inspected-shape'];
  if (!fixturePaths || Object.keys(fixturePaths).sort().join(',') !== expectedFixtures.join(',')) {
    throw new Error('Visual capture request must contain only reviewed public fixtures.');
  }
  if (JSON.stringify(fixtureDigests) !== JSON.stringify(reviewedFixtureDigests)) {
    throw new Error('Visual capture request must use exact reviewed fixture identities.');
  }
  for (const fixtureName of expectedFixtures) {
    if (!isDirectChild(captureRoot, fixturePaths[fixtureName]) || resolve(fixturePaths[fixtureName]) !== resolve(captureRoot, 'fixtures', `${fixtureName}.json`)) {
      throw new Error('Visual capture fixture path escapes its temporary root.');
    }
  }
  return {
    version: captureRequestVersion,
    captureRoot,
    fixturePaths,
    fixtureDigests,
    outputRoot,
    scenarios: captureScenarios,
    createdAt,
    launcherPID
  };
}

export function xcodebuildCaptureArguments() {
  return [
    'test', '-project', 'BrainBar.xcodeproj', '-scheme', 'BrainBar',
    '-destination', 'platform=macOS', 'CODE_SIGNING_ALLOWED=NO',
    '-only-testing:BrainBarTests/BrainBarTests/testOptInGraph3DVisualCapture'
  ];
}

export function validateCaptureManifest(manifest) {
  if (!manifest || manifest.schemaVersion !== 1 || manifest.kind !== 'graph3d-visual-acceptance' || !Array.isArray(manifest.captures) || manifest.captures.length !== captureScenarios.length) {
    throw new Error('Invalid visual capture manifest.');
  }
  for (const scenario of captureScenarios) {
    const capture = manifest.captures.find((value) => value?.scenario === scenario.name);
    if (!capture || capture.fixture?.name !== scenario.fixtureName || capture.fixture?.sha256 !== reviewedFixtureDigests[scenario.fixtureName] || capture.viewport?.width !== scenario.width || capture.viewport?.height !== scenario.height || capture.snapshot !== scenario.outputName || !Number.isInteger(capture.fixture?.nodeCount) || !Number.isInteger(capture.fixture?.edgeCount) || typeof capture.coordinateFingerprint !== 'string' || !/^[a-f0-9]{1,64}$/i.test(capture.coordinateFingerprint)) {
      throw new Error(`Invalid capture entry: ${scenario.name}`);
    }
    for (const key of ['layoutSchemaVersion', 'layoutProfile', 'detailLevel', 'detailReason', 'paintedNodeCount', 'paintedEdgeCount', 'communityAnchorCount', 'persistentLabelCount', 'persistentLabelMaxOverlapArea', 'activeMode', 'selectedNodeCount', 'agentActivityEventCount', 'agentActivityRenderableCount', 'workflowHighlightNodeCount', 'workflowHighlightPendingPathCount', 'graphCheckVisible', 'sidebarState', 'cameraPreset', 'staticLayerRebuildMs', 'labelAllocationMs', 'frameQuality', 'paintedProjectedCoverageX', 'paintedProjectedCoverageY', 'paintedProjectedCoverageWidth', 'paintedProjectedCoverageHeight', 'visualPixelRatio', 'baseStateHubGlowEnabled', 'balancedDiscMinimumAlpha', 'darkSeparationRimWidth', 'balancedEdgeAlpha', 'staticRebuildP95Ms', 'visualBackingWidth', 'visualBackingHeight']) {
      if (!(key in (capture.diagnostics || {}))) throw new Error(`Missing content-free diagnostic: ${key}`);
    }
  }
  const matchedCoreCaptures = matchedCoreScenarioNames.map((name) => manifest.captures.find((capture) => capture?.scenario === name));
  const firstMatchedCapture = matchedCoreCaptures[0];
  for (const capture of matchedCoreCaptures) {
    if (capture?.fixture?.name !== '1k' || capture.fixture.sha256 !== reviewedFixtureDigests['1k'] || capture.viewport?.width !== 1000 || capture.viewport?.height !== 720 || capture.coordinateFingerprint !== firstMatchedCapture?.coordinateFingerprint) {
      throw new Error('Matched core visual captures must use the same 1k fixture, viewport, and coordinates.');
    }
  }
  if (JSON.stringify(manifest).toLowerCase().includes('/users/') || JSON.stringify(manifest).toLowerCase().includes('private_sentinel')) {
    throw new Error('Visual capture manifest is not public-safe.');
  }
  return manifest;
}

async function run(command, argumentsList) {
  return await new Promise((resolvePromise, reject) => {
    const child = spawn(command, argumentsList, { cwd: process.cwd(), env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (data) => { output += data; });
    child.stderr.on('data', (data) => { output += data; });
    child.on('error', reject);
    child.on('close', (code) => resolvePromise({ code, output }));
  });
}

async function main() {
  const captureRoot = await mkdtemp(captureDirectoryPrefix);
  const fixtureDirectory = join(captureRoot, 'fixtures');
  const temporaryOutput = join(captureRoot, 'output');
  let requestCreated = false;
  try {
    const manifest = await loadFixtureManifest();
    const fixturePaths = {};
    await mkdir(fixtureDirectory, { recursive: true });
    for (const fixtureName of ['1k', 'inspected-shape']) {
      const definition = manifest.fixtures.find((fixture) => fixture.name === fixtureName);
      if (!definition) throw new Error(`Missing reviewed fixture: ${fixtureName}`);
      const fixturePath = join(fixtureDirectory, `${fixtureName}.json`);
      const fixture = generateFixture(definition);
      if (fixtureDigest(fixture) !== reviewedFixtureDigests[fixtureName]) {
        throw new Error(`Reviewed fixture identity changed: ${fixtureName}`);
      }
      await writeFile(fixturePath, JSON.stringify(fixture));
      fixturePaths[fixtureName] = fixturePath;
    }
    const request = createCaptureRequest({ captureRoot, fixturePaths, outputRoot: temporaryOutput });
    await writeFile(captureRequestPath, JSON.stringify(request), { flag: 'wx' });
    requestCreated = true;
    const result = await run('xcodebuild', xcodebuildCaptureArguments());
    if (result.code !== 0) throw new Error(`Visual capture XCTest failed:\n${result.output}`);
    const manifestData = JSON.parse(await readFile(join(temporaryOutput, 'manifest.json'), 'utf8'));
    validateCaptureManifest(manifestData);
    const destination = resolve(captureOutputDirectory);
    await mkdir(destination, { recursive: true });
    for (const scenario of captureScenarios) {
      const source = join(temporaryOutput, scenario.outputName);
      const stat = await lstat(source);
      if (!stat.isFile() || stat.size < 1_000) throw new Error(`Snapshot was not a valid PNG: ${scenario.outputName}`);
      await copyFile(source, join(destination, scenario.outputName));
    }
    await writeFile(join(destination, 'manifest.json'), `${JSON.stringify(manifestData, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify({ output: destination, captures: captureScenarios.map((scenario) => scenario.outputName) }, null, 2)}\n`);
  } finally {
    if (requestCreated) await rm(captureRequestPath, { force: true });
    await rm(captureRoot, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
