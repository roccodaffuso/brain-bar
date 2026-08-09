#!/usr/bin/env node
// Content-free acceptance evidence for the Graph3D visual/presentation layer.
//
// This deliberately measures the deterministic planner only. A hosted WebKit
// driver must add the runtime-only metrics declared in the manifest below;
// planner timings must never be presented as renderer frame timings.
import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as presentation from '../BrainBar/Resources/Graph3D/graph3d-presentation-utils.mjs';
import { coefficientOfVariation, percentile, validateMeasurementReport } from './renderer-measurement-utils.mjs';
import { generateFixture, loadFixtureManifest } from './generate-large-graph-fixtures.mjs';

export const acceptanceSchemaVersion = 1;
export const baselineCommit = '0137a2e';
export const measuredFixtureNames = Object.freeze(['1k', 'inspected-shape', '25k-stress']);
export const scenarioNames = Object.freeze([
  'overview-collapsed', 'overview-docked', 'community', 'node-focus',
  'path', 'recent', 'narrow-overlay', 'reduce-motion'
]);
export const requiredRuntimeDiagnostics = Object.freeze([
  'layoutSchemaVersion', 'layoutProfile', 'detailLevel', 'detailReason',
  'paintedNodeCount', 'paintedEdgeCount', 'communityAnchorCount',
  'persistentLabelCount', 'sidebarState', 'cameraPreset',
  'staticLayerRebuildMs', 'labelAllocationMs', 'frameQuality'
]);
export const runtimeOnlyMetrics = Object.freeze([
  'panOrbitFrameTimeMs', 'hoverToHighlightMs', 'selectionToFirstFeedbackMs',
  'sidebarOpenReframeMs', 'overviewCommunityTransitionMs', 'frameQuality'
]);
export const provisionalOverviewNodeBudget = presentation.presentationPaintBudget('overview').structuralNodeLimit;

const warmupRuns = 2;
const measuredRuns = 9;
const sourcePath = 'BrainBar/Resources/Graph3D/graph3d.js';

export function summarizeSamples(samples) {
  if (!Array.isArray(samples) || samples.length !== measuredRuns || !samples.every(Number.isFinite)) {
    throw new Error(`Expected ${measuredRuns} finite samples.`);
  }
  return {
    samples: samples.map((value) => round(value)),
    p50: round(percentile(samples, 0.5)),
    p95: round(percentile(samples, 0.95)),
    cvPercent: round(coefficientOfVariation(samples))
  };
}

export function scenarioDefinition(name, nodes) {
  const orderedIDs = nodes.map((node) => String(node.id)).sort();
  const selected = orderedIDs[0] || '';
  const pathNodeIds = orderedIDs.slice(0, Math.min(5, orderedIDs.length));
  const recentNodeIds = orderedIDs.slice(-Math.min(6, orderedIDs.length));
  const safeRegions = name === 'overview-docked'
    ? [{ x: 760, y: 0, width: 240, height: 720 }]
    : [];
  const interaction = name === 'path'
    ? { selectedNodeId: selected, pathNodeIds }
    : name === 'recent'
      ? { selectedNodeId: selected, recentNodeIds }
      : name === 'community' || name === 'node-focus'
        ? { selectedNodeId: selected }
        : {};
  return {
    name,
    detailLevel: 'overview',
    userDetailLevel: 'overview',
    reduceMotion: name === 'reduce-motion',
    sidebarState: name === 'overview-docked' ? 'docked' : (name === 'narrow-overlay' ? 'overlay' : 'collapsed'),
    safeRegions,
    interaction,
    cameraPreset: name === 'community' ? 'Community' : name === 'node-focus' ? 'Node Focus' : name === 'path' ? 'Active Path' : name === 'recent' ? 'Recent Orbit' : 'Overview'
  };
}

export function activePromotionNodeCount(interaction = {}) {
  const ids = new Set();
  for (const value of [
    interaction.selectedNodeId,
    interaction.hoverNodeId,
    interaction.focusNodeId,
    interaction.searchNodeId,
    interaction.searchRevealNodeId,
    interaction.pathNodeId,
    interaction.workflowNodeId,
    interaction.activityNodeId,
    interaction.storyNodeId,
    ...(interaction.selectedNodeIds || []),
    ...(interaction.hoverNodeIds || []),
    ...(interaction.focusNodeIds || []),
    ...(interaction.pathNodeIds || []),
    ...(interaction.workflowNodeIds || []),
    ...(interaction.recentNodeIds || []),
    ...(interaction.storyNodeIds || []),
    ...(interaction.searchNodeIds || []),
    ...(interaction.activityNodeIds || [])
  ]) {
    if (typeof value === 'string' && value) ids.add(value);
  }
  return ids.size;
}

export function overviewPaintGate({ detailLevel, queryableNodeCount, paintedNodeCount, activePromotionNodeCount: promotionCount = 0 }) {
  if (detailLevel !== 'overview' || queryableNodeCount <= 2500) {
    return { status: 'not-applicable', budget: provisionalOverviewNodeBudget, allowance: promotionCount };
  }
  const allowance = Math.max(0, Number(promotionCount) || 0);
  const limit = provisionalOverviewNodeBudget + allowance;
  return {
    status: paintedNodeCount <= limit ? 'pass' : 'fail',
    budget: provisionalOverviewNodeBudget,
    allowance,
    limit,
    observed: paintedNodeCount
  };
}

export function projectedNodesFor(nodes) {
  const projected = new Map();
  for (const [index, node] of nodes.entries()) {
    projected.set(String(node.id), {
      x: 24 + ((index * 67) % 700),
      y: 24 + ((Math.floor(index / 10) * 41) % 620)
    });
  }
  return projected;
}

// Mirrors the renderer-owned indexes that already exist after graph readiness.
// This setup is deliberately outside the measured index-build phase.
export function rendererPresentationInputs(fixture) {
  const nodes = fixture.nodes.map((node) => ({ id: String(node.id), community: String(node.community || 'Unassigned') }));
  const edges = fixture.edges.map((edge) => ({ id: String(edge.id), source: String(edge.source ?? edge.from), target: String(edge.target ?? edge.to) }));
  const degreeByNode = new Map(nodes.map((node) => [node.id, 0]));
  const edgesByNode = new Map(nodes.map((node) => [node.id, []]));
  const communitiesByName = new Map();
  const communityByNodeId = new Map();
  nodes.forEach((node) => {
    degreeByNode.set(node.id, degreeByNode.get(node.id) ?? 0);
    communityByNodeId.set(node.id, node.community);
    const records = communitiesByName.get(node.community) ?? [];
    records.push(node);
    communitiesByName.set(node.community, records);
  });
  edges.forEach((edge) => {
    degreeByNode.set(edge.source, (degreeByNode.get(edge.source) ?? 0) + 1);
    degreeByNode.set(edge.target, (degreeByNode.get(edge.target) ?? 0) + 1);
    edgesByNode.get(edge.source)?.push(edge);
    if (edge.target !== edge.source) edgesByNode.get(edge.target)?.push(edge);
  });
  return {
    normalizedNodes: nodes,
    normalizedEdges: edges,
    degreeByNode,
    edgesByNode,
    communitiesByName,
    communityByNodeId
  };
}

export function buildScenarioPlan(fixture, definition, index) {
  return presentation.buildPresentationPlan({
    index,
    nodes: fixture.nodes,
    edges: fixture.edges,
    detailLevel: definition.detailLevel,
    userDetailLevel: definition.userDetailLevel,
    interaction: definition.interaction,
    projectedNodes: projectedNodesFor(fixture.nodes),
    safeRegions: definition.safeRegions,
    reduceMotion: definition.reduceMotion
  });
}

function labelCandidatesFor(plan, fixture) {
  const points = projectedNodesFor(fixture.nodes);
  return plan.paintedNodeIds.map((id, index) => ({
    id,
    tier: plan.nodeTiersById.get(id) || 'D',
    active: index === 0,
    degree: plan.paintedEdgeIds.length - index,
    point: points.get(id)
  }));
}

function measure(action) {
  for (let index = 0; index < warmupRuns; index += 1) action();
  const samples = [];
  for (let index = 0; index < measuredRuns; index += 1) {
    const started = performance.now();
    action();
    samples.push(performance.now() - started);
  }
  return summarizeSamples(samples);
}

export function measureScenario(fixture, definition, index) {
  const plan = buildScenarioPlan(fixture, definition, index);
  const labels = labelCandidatesFor(plan, fixture);
  const staticLayerPlanMs = measure(() => buildScenarioPlan(fixture, definition, index));
  const labelAllocationMs = measure(() => presentation.allocateLabels({
    candidates: labels,
    safeRegions: definition.safeRegions,
    budget: plan.persistentLabels.length
  }));
  const promotionCount = activePromotionNodeCount(definition.interaction);
  return {
    scenario: definition.name,
    sidebarState: definition.sidebarState,
    cameraPreset: definition.cameraPreset,
    detailLevel: plan.detailLevel,
    detailReason: plan.detailReason,
    reduceMotion: plan.motion.reduceMotion,
    queryableNodeCount: plan.queryableNodeCount,
    queryableEdgeCount: plan.queryableEdgeCount,
    paintedNodeCount: plan.diagnostics.paintedNodeCount,
    paintedEdgeCount: plan.diagnostics.paintedEdgeCount,
    communityAnchorCount: plan.diagnostics.communityAnchorCount,
    persistentLabelCount: plan.diagnostics.persistentLabelCount,
    activePromotionNodeCount: promotionCount,
    gates: {
      overviewPaintBudget: overviewPaintGate({
        detailLevel: plan.detailLevel,
        queryableNodeCount: plan.queryableNodeCount,
        paintedNodeCount: plan.diagnostics.paintedNodeCount,
        activePromotionNodeCount: promotionCount
      })
    },
    metrics: {
      staticLayerPlanMs: { scope: 'pure-presentation-planner', ...staticLayerPlanMs },
      labelAllocationMs: { scope: 'pure-presentation-planner', ...labelAllocationMs },
      interactionReplanMs: { scope: 'pure-presentation-planner', ...staticLayerPlanMs },
      frameQuality: { status: 'requires-runtime-diagnostics' }
    }
  };
}

export function hostedRuntimeEvidence(report) {
  validateMeasurementReport(report);
  const sources = {
    panOrbitFrameTimeMs: 'threeDPanOrbitFrameMs',
    hoverToHighlightMs: 'threeDHoverToHighlightMs',
    selectionToFirstFeedbackMs: 'threeDSelectionToFirstFeedbackMs',
    sidebarOpenReframeMs: 'threeDSidebarOpenReframeMs',
    overviewCommunityTransitionMs: 'threeDOverviewCommunityTransitionMs'
  };
  const metrics = Object.fromEntries(Object.entries(sources).map(([name, source]) => [name, report.measured[source]]));
  const feedbackP95 = Math.max(metrics.hoverToHighlightMs.p95, metrics.selectionToFirstFeedbackMs.p95);
  const evidence = {
    status: 'verified-hosted-wkwebview',
    fixture: report.fixture,
    protocol: report.protocol,
    metrics,
    gates: {
      interactionFeedbackP95Ms: { limit: 50, observed: feedbackP95, status: feedbackP95 <= 50 ? 'pass' : 'fail' },
      panOrbitFrameP95Ms: { limit: 33, observed: metrics.panOrbitFrameTimeMs.p95, status: metrics.panOrbitFrameTimeMs.p95 <= 33 ? 'pass' : 'fail' },
      sidebarOpenReframe: { status: 'observed' },
      overviewCommunityTransition: { status: 'observed' }
    }
  };
  assertContentFree(evidence);
  return evidence;
}

export async function buildAcceptanceReport({ fixtureNames = measuredFixtureNames, capture = 'after', hostedRendererReport = null } = {}) {
  const manifest = await loadFixtureManifest();
  const definitions = manifest.fixtures.filter((fixture) => fixtureNames.includes(fixture.name));
  if (definitions.length !== fixtureNames.length) throw new Error('Unknown acceptance fixture.');
  const fixtures = definitions.map((definition) => {
    const fixture = generateFixture(definition);
    const inputs = rendererPresentationInputs(fixture);
    const indexBuildMs = measure(() => presentation.buildPresentationIndex(inputs));
    const index = presentation.buildPresentationIndex(inputs);
    const scenarios = scenarioNames.map((name) => measureScenario(fixture, scenarioDefinition(name, fixture.nodes), index));
    return {
      name: definition.name,
      nodeCount: definition.node_count,
      edgeCount: definition.edge_count,
      communityCount: definition.community_count,
      indexBuildMs: { scope: 'pure-presentation-index; renderer indexes pre-existing', ...indexBuildMs },
      scenarios
    };
  });
  const report = {
    schemaVersion: acceptanceSchemaVersion,
    kind: 'graph3d-presentation-acceptance',
    capture,
    protocol: { warmupRuns, measuredRuns, fixtureNames, scenarioNames },
    metricScopes: {
      staticLayerPlanMs: 'pure-presentation-planner; not a canvas rebuild timing',
      labelAllocationMs: 'pure-presentation-planner; deterministic candidate set',
      interactionReplanMs: 'pure-presentation-planner; not hover or selection feedback latency',
      frameQuality: 'requires hosted WKWebView diagnostics'
    },
    provisionalGates: {
      overviewPaintedNodeLimit: provisionalOverviewNodeBudget,
      overviewPromotionAllowance: 'one additional painted node per active promoted identity',
      state: 'provisional; owner approval required before merge'
    },
    runtimeRequirements: {
      diagnostics: requiredRuntimeDiagnostics,
      metrics: runtimeOnlyMetrics
    },
    hostedRuntime: hostedRendererReport ? hostedRuntimeEvidence(hostedRendererReport) : { status: 'not-captured' },
    fixtures
  };
  assertContentFree(report);
  return report;
}

export async function inspectBaseline(reference = baselineCommit) {
  const source = await gitShow(reference, sourcePath);
  const diagnosticsMatch = source.match(/window\.brainBarRendererDiagnostics\s*=\s*\(\)\s*=>\s*\(\{([\s\S]*?)\n\s*\}\);/);
  if (!diagnosticsMatch) throw new Error(`No renderer diagnostics surface at ${reference}.`);
  const body = diagnosticsMatch[1];
  const diagnostics = Object.fromEntries(requiredRuntimeDiagnostics.map((name) => [name, new RegExp(`\\b${name}\\s*:`).test(body)]));
  const report = {
    schemaVersion: acceptanceSchemaVersion,
    kind: 'graph3d-presentation-baseline',
    capture: 'before',
    referenceCommit: reference,
    sourceInspection: 'read-only-git-object',
    renderedRuntime: false,
    diagnosticAvailability: diagnostics,
    unavailableMetrics: runtimeOnlyMetrics,
    conclusion: 'new-presentation-metrics-not-exposed-at-baseline'
  };
  assertContentFree(report);
  return report;
}

export function buildGolden(report) {
  if (report?.kind !== 'graph3d-presentation-acceptance') throw new Error('Acceptance report required.');
  return {
    schemaVersion: acceptanceSchemaVersion,
    kind: 'graph3d-presentation-count-golden',
    sourceCapture: report.capture,
    fixtures: report.fixtures.map((fixture) => ({
      name: fixture.name,
      nodeCount: fixture.nodeCount,
      edgeCount: fixture.edgeCount,
      scenarios: fixture.scenarios.map((scenario) => ({
        scenario: scenario.scenario,
        sidebarState: scenario.sidebarState,
        cameraPreset: scenario.cameraPreset,
        detailLevel: scenario.detailLevel,
        detailReason: scenario.detailReason,
        reduceMotion: scenario.reduceMotion,
        queryableNodeCount: scenario.queryableNodeCount,
        queryableEdgeCount: scenario.queryableEdgeCount,
        paintedNodeCount: scenario.paintedNodeCount,
        paintedEdgeCount: scenario.paintedEdgeCount,
        communityAnchorCount: scenario.communityAnchorCount,
        persistentLabelCount: scenario.persistentLabelCount,
        activePromotionNodeCount: scenario.activePromotionNodeCount,
        overviewPaintBudget: scenario.gates.overviewPaintBudget
      }))
    }))
  };
}

export function provisionalGateFailures(report) {
  if (report?.kind !== 'graph3d-presentation-acceptance') throw new Error('Acceptance report required.');
  return report.fixtures.flatMap((fixture) => fixture.scenarios
    .filter((scenario) => scenario.gates?.overviewPaintBudget?.status === 'fail')
    .map((scenario) => ({ fixture: fixture.name, scenario: scenario.scenario, gate: scenario.gates.overviewPaintBudget })));
}

export function enforceProvisionalGates(report) {
  const failures = provisionalGateFailures(report);
  if (failures.length > 0) {
    const summary = failures.map(({ fixture, scenario, gate }) => `${fixture}/${scenario}: ${gate.observed} > ${gate.limit}`).join(', ');
    throw new Error(`Provisional presentation gates failed: ${summary}`);
  }
  return true;
}

export function validateGolden(report, golden) {
  const actual = buildGolden(report);
  if (JSON.stringify(actual) !== JSON.stringify(golden)) {
    throw new Error('Presentation count golden does not match the observed acceptance report.');
  }
  return true;
}

export function formatMarkdown(report) {
  if (report.kind === 'graph3d-presentation-baseline') {
    const exposed = Object.entries(report.diagnosticAvailability).filter(([, value]) => value).map(([name]) => name);
    return [
      '# Graph3D presentation baseline', '',
      `Reference: \`${report.referenceCommit}\` read directly from the Git object database.`, '',
      `New diagnostic fields exposed before the redesign: ${exposed.length}/${requiredRuntimeDiagnostics.length}.`,
      '',
      'This baseline is structural: the historical renderer did not expose the new presentation timing or frame-quality hooks, so it intentionally records no fabricated measurements.'
    ].join('\n');
  }
  const rows = report.fixtures.flatMap((fixture) => fixture.scenarios.map((scenario) =>
    `| ${fixture.name} | ${scenario.scenario} | ${scenario.paintedNodeCount} | ${scenario.paintedEdgeCount} | ${scenario.persistentLabelCount} | ${fixture.indexBuildMs.p95.toFixed(2)} | ${scenario.metrics.interactionReplanMs.p95.toFixed(2)} | ${scenario.metrics.labelAllocationMs.p95.toFixed(2)} |`
  ));
  return [
    '# Graph3D presentation acceptance', '',
    'Content-free deterministic planner evidence. Planner timings are not WebKit frame or interaction timings.', '',
    '| Fixture | Scenario | Painted nodes | Painted edges | Labels | Index p95 ms | Replan p95 ms | Label p95 ms |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...rows,
    ...(report.hostedRuntime?.status === 'verified-hosted-wkwebview'
      ? [
          '',
          'Hosted WKWebView runtime evidence:',
          '',
          '| Metric | p50 ms | p95 ms | CV |',
          '| --- | ---: | ---: | ---: |',
          ...Object.entries(report.hostedRuntime.metrics).map(([name, metric]) => `| ${name} | ${metric.p50.toFixed(2)} | ${metric.p95.toFixed(2)} | ${metric.cvPercent.toFixed(2)}% |`),
          '',
          `Binding gates: interaction feedback ${report.hostedRuntime.gates.interactionFeedbackP95Ms.status}; pan/orbit frame ${report.hostedRuntime.gates.panOrbitFrameP95Ms.status}.`
        ]
      : ['', 'Runtime evidence not captured. Run the hosted WKWebView renderer harness and pass its validated report with `--hosted-report`.'])
  ].join('\n');
}

async function gitShow(reference, path) {
  return await new Promise((resolvePromise, reject) => {
    execFile('git', ['show', `${reference}:${path}`], { cwd: resolve('.') }, (error, stdout, stderr) => {
      if (error) reject(new Error(`Could not read baseline Git object: ${stderr || error.message}`));
      else resolvePromise(stdout);
    });
  });
}

function assertContentFree(value) {
  const serialized = JSON.stringify(value);
  for (const disallowed of ['.md', 'source_file', 'sourcefile', 'graph.json', 'private_sentinel']) {
    if (serialized.toLowerCase().includes(disallowed)) throw new Error(`Acceptance output contains disallowed content-bearing text: ${disallowed}`);
  }
}

function round(value) {
  return Number(Number(value).toFixed(4));
}

function parseArguments(argumentsList) {
  const options = { fixtureNames: measuredFixtureNames, format: 'json', capture: 'after', baseline: '', output: '', golden: '', writeGolden: '', hostedReport: '', enforceProvisionalGates: false };
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    const value = argumentsList[index + 1];
    if (argument === '--fixture') { options.fixtureNames = value === 'all' ? measuredFixtureNames : [value]; index += 1; }
    else if (argument === '--format') { options.format = value; index += 1; }
    else if (argument === '--capture') { options.capture = value; index += 1; }
    else if (argument === '--baseline') { options.baseline = value || baselineCommit; index += 1; }
    else if (argument === '--output') { options.output = value; index += 1; }
    else if (argument === '--golden') { options.golden = value; index += 1; }
    else if (argument === '--write-golden') { options.writeGolden = value; index += 1; }
    else if (argument === '--hosted-report') { options.hostedReport = value; index += 1; }
    else if (argument === '--enforce-provisional-gates') { options.enforceProvisionalGates = true; }
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!['json', 'markdown'].includes(options.format) || !['after', 'before'].includes(options.capture) || options.fixtureNames.some((name) => !measuredFixtureNames.includes(name))) throw new Error('Invalid acceptance harness arguments.');
  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const hostedRendererReport = options.hostedReport ? JSON.parse(await readFile(options.hostedReport, 'utf8')) : null;
  const report = options.baseline ? await inspectBaseline(options.baseline) : await buildAcceptanceReport({ ...options, hostedRendererReport });
  if (options.enforceProvisionalGates && !options.baseline) enforceProvisionalGates(report);
  if (options.golden) validateGolden(report, JSON.parse(await readFile(options.golden, 'utf8')));
  if (options.writeGolden) await writeFile(options.writeGolden, `${JSON.stringify(buildGolden(report), null, 2)}\n`);
  const output = options.format === 'markdown' ? formatMarkdown(report) : JSON.stringify(report, null, 2);
  if (options.output) await writeFile(options.output, `${output}\n`);
  process.stdout.write(`${output}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
