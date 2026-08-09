import assert from 'node:assert/strict';
import { captureRequestPath, captureRequestVersion, captureScenarios, createCaptureRequest, matchedCoreScenarioNames, reviewedFixtureDigests, validateCaptureManifest, xcodebuildCaptureArguments } from './run-graph3d-visual-capture.mjs';

const root = '/private/tmp/brainbar-graph3d-visual-capture-test';
const fixturePaths = {
  '1k': `${root}/fixtures/1k.json`,
  'inspected-shape': `${root}/fixtures/inspected-shape.json`
};
const request = createCaptureRequest({ captureRoot: root, fixturePaths, outputRoot: `${root}/output`, createdAt: 1, launcherPID: 2 });
assert.equal(captureRequestPath, '/private/tmp/brainbar-graph3d-visual-capture-request.json');
assert.equal(request.version, captureRequestVersion);
assert.deepEqual(request.scenarios, captureScenarios);
assert.throws(() => createCaptureRequest({ captureRoot: root, fixturePaths: { ...fixturePaths, extra: `${root}/fixtures/extra.json` }, outputRoot: `${root}/output` }));
assert.throws(() => createCaptureRequest({ captureRoot: root, fixturePaths: { ...fixturePaths, '1k': '/private/tmp/elsewhere/1k.json' }, outputRoot: `${root}/output` }));
assert.ok(xcodebuildCaptureArguments().includes('-only-testing:BrainBarTests/BrainBarTests/testOptInGraph3DVisualCapture'));

const manifest = {
  schemaVersion: 1,
  kind: 'graph3d-visual-acceptance',
  captures: captureScenarios.map((scenario) => ({
    scenario: scenario.name,
    fixture: { name: scenario.fixtureName, sha256: reviewedFixtureDigests[scenario.fixtureName], nodeCount: scenario.fixtureName === '1k' ? 1000 : 12547, edgeCount: scenario.fixtureName === '1k' ? 2380 : 29868 },
    viewport: { width: scenario.width, height: scenario.height },
    snapshot: scenario.outputName,
    coordinateFingerprint: '0123456789abcdef',
    diagnostics: {
      layoutSchemaVersion: 4, layoutProfile: 'community-islands', detailLevel: 'overview', detailReason: 'adaptive-default', paintedNodeCount: 1, paintedEdgeCount: 1, communityAnchorCount: 1, persistentLabelCount: 1, persistentLabelMaxOverlapArea: 0, activeMode: 'none', selectedNodeCount: 0, agentActivityEventCount: 0, agentActivityRenderableCount: 0, workflowHighlightNodeCount: 0, workflowHighlightPendingPathCount: 0, graphCheckVisible: false, sidebarState: 'collapsed', cameraPreset: 'overview', staticLayerRebuildMs: 1, labelAllocationMs: 1, frameQuality: 'high', paintedProjectedCoverageX: 0.1, paintedProjectedCoverageY: 0.1, paintedProjectedCoverageWidth: 0.8, paintedProjectedCoverageHeight: 0.8, visualPixelRatio: 2, baseStateHubGlowEnabled: false, balancedDiscMinimumAlpha: 0.72, darkSeparationRimWidth: 0.8, balancedEdgeAlpha: 0.18, staticRebuildP95Ms: 1, visualBackingWidth: 1000, visualBackingHeight: 720
    }
  }))
};
assert.equal(validateCaptureManifest(manifest), manifest);
assert.throws(() => validateCaptureManifest({ ...manifest, captures: manifest.captures.slice(1) }));
assert.equal(matchedCoreScenarioNames.length, 12);
const mismatchedCoreViewport = structuredClone(manifest);
mismatchedCoreViewport.captures.find((capture) => capture.scenario === '1k-overview-docked').viewport.width = 999;
assert.throws(() => validateCaptureManifest(mismatchedCoreViewport));
const mismatchedCoreCoordinates = structuredClone(manifest);
mismatchedCoreCoordinates.captures.find((capture) => capture.scenario === '1k-community').coordinateFingerprint = 'abcdef';
assert.throws(() => validateCaptureManifest(mismatchedCoreCoordinates));
console.log('Graph3D visual capture runner tests passed.');
