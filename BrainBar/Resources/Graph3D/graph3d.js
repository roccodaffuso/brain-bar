import * as THREE from './vendor/three.module.min.js';
import { OrbitControls } from './vendor/OrbitControls.js';
import {
  breathingStyle,
  communityBreathingVisual,
  createLivingPulse,
  edgeCurrentVisual,
  pruneLivingPulses,
  pulseVisualState,
  recentSparkVisual,
  selectAmbientCurrentEdgeIds,
  selectCommunityPulseGroups,
  selectAmbientRecentNodeIds
} from './graph3d-living-utils.mjs';
import { computePathVariants, explainShortestPath } from './graph3d-path-utils.mjs';
import {
  activeModeFromState,
  buildProjectedNodeGrid,
  labelBudgetForMode,
  nearbyProjectedNodeIds,
  spotlightBudgets
} from './graph3d-polish-utils.mjs';
import { nearestKeyNotePath, recentOrbitCandidates } from './graph3d-recent-utils.mjs';
import { searchGraphNodes } from './graph3d-search-utils.mjs';
import { buildGraphStorySteps, graphStoryPresentation } from './graph3d-story-utils.mjs';
import {
  clearLayoutCacheForTesting,
  isLayoutCacheDigest,
  layoutCacheKey,
  normalizeLayoutCacheLens,
  overwriteLayoutCacheForTesting,
  readLayoutCache,
  writeLayoutCache
} from './graph3d-layout-cache.mjs';

const stage = document.getElementById('stage');
const graphVisual = document.getElementById('graph-visual');
const visualContext = graphVisual?.getContext('2d', { alpha: true });
const staticVisualLayer = document.createElement('canvas');
const staticVisualContext = staticVisualLayer.getContext('2d', { alpha: true });
const overlay = document.getElementById('overlay');
const search = document.getElementById('search');
const searchResults = document.getElementById('search-results');
const nodeInfo = document.getElementById('node-info');
const legend = document.getElementById('legend');
const stats = document.getElementById('stats');
const hud = document.getElementById('hud');

const palette = [
  '#6f89a9', '#b58a58', '#ad6970', '#70a4a0', '#78976c', '#b8a25d',
  '#9a7895', '#b7828b', '#927765', '#aaa6a0', '#657e9d', '#a97855',
  '#a7666d', '#76a29d', '#77916b', '#b09d5a', '#92748c', '#aa7d86'
];

const accentPalette = [
  '#8fb7df', '#f0a35a', '#dc747b', '#8fd1cb', '#8fc07e', '#dec56b',
  '#c995bf', '#f0a4af', '#bd987c', '#d4cec5', '#7fa2c8', '#df9555',
  '#cb737a', '#91d0ca', '#8abd7b', '#d7bd67', '#bd91b3', '#e79aa5'
];

const baseEdgeColor = '#6f7f9d';
const selectedStrokeColor = '#f1f4ff';
const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
const ambientRuntimeEnabled = false;
const responsePulseRuntimeEnabled = true;
const staticRecentWarmthEnabled = true;
const staticHubGlowEnabled = true;
const edgeGlintsRuntimeEnabled = false;
const renderHiddenWebGLLayer = false;
const ambientIdleFrameInterval = 90;
const ambientBusyFrameInterval = 180;
const edgeGlintFrameInterval = 220;
const ambientInteractionQuietMs = 520;
const overlaySlowFrameMs = 24;
const overlayRecoveryMs = 1200;
const overlayDenseNodeThreshold = 3200;
const overlayDenseEdgeThreshold = 7600;
const overlayVeryDenseNodeThreshold = 5000;
const overlayVeryDenseEdgeThreshold = 12000;
const ambientMotionScale = prefersReducedMotion ? 0 : 1;
const ambientLocalAmplitude = 1.8 * ambientMotionScale;
const ambientSampleTarget = 520;
const ambientRecentNodeLimit = 24;
const staticHubGlowLimit = 18;
const ambientCurrentIdleEdgeLimit = 18;
const ambientCurrentActiveEdgeLimit = 24;
const ambientCommunityLimit = 8;
const ambientCommunityNodeLimit = 36;
const livingPulseNodeLimit = 16;
const livingPulseEdgeLimit = 48;
const spotlightFocusNodeLimit = 72;
const spotlightSmallCommunityLimit = 80;
const spotlightInternalEdgeLimit = 180;
const spotlightBridgeEdgeLimit = 80;
const recentOrbitNodeLimit = 24;
const recentOrbitPanelLimit = 12;
const recentOrbitKeyNoteLimit = 12;
const graphStoryRecentLimit = 12;
const graphStoryKeyNoteLimit = 12;
const graphStoryCommunityLimit = 3;
const graphStoryBridgeLimit = 10;
const graphStoryEdgeLimit = 80;
const graphStoryPreviewLimit = 3;
const searchResultLimit = 20;
const searchRevealNeighborLimit = 16;
const selectedNeighborVisualLimit = 48;
const selectedEdgeVisualLimit = 96;
const collapsedCommunityLimit = 8;
const expandedCommunityLimit = 32;
const layoutWorkerTestMode = (() => {
  const parameters = new URLSearchParams(window.location.search);
  if (parameters.get('layout-worker-test') !== '1') {
    return '';
  }
  const mode = parameters.get('layout-worker-mode');
  return mode === 'failStartup' || mode === 'holdResult' ? mode : '';
})();
const graphIdentityTestMode = new URLSearchParams(window.location.search).get('identity-test') === '1';
const layoutCacheTestMode = new URLSearchParams(window.location.search).get('layout-cache-test');
const layoutCacheTestEnabled = layoutCacheTestMode === 'enable' || layoutCacheTestMode === 'corrupt' || layoutCacheTestMode === 'hold';

const pointTexture = createPointTexture();

const state = {
  graph: null,
  evidenceInput: null,
  evidenceReport: null,
  evidenceNow: null,
  lens: 'all',
  communities: [],
  communityByName: new Map(),
  communityEnabled: new Set(),
  legendExpanded: false,
  visibleNodes: [],
  visibleEdges: [],
  visibleNodeIds: new Set(),
  positions: new Map(),
  degreeByNode: new Map(),
  adjacencyByNode: new Map(),
  edgesByNode: new Map(),
  edgeById: new Map(),
  projectedPoints: new Map(),
  visualCacheDirty: true,
  selectedNode: null,
  inspectedEdge: null,
  hoveredNode: null,
  hoveredEdge: null,
  hoverVisualNode: null,
  hoverTrails: new Map(),
  edgeTrails: new Map(),
  hoverIntensity: 0,
  focusMode: false,
  focusDepth: 1,
  focusNodeId: null,
  focusNodeIds: new Set(),
  focusEdgeIds: new Set(),
  focusNodeDistance: new Map(),
  communitySpotlightName: null,
  communitySpotlightNodeIds: new Set(),
  communitySpotlightEdgeIds: new Set(),
  communitySpotlightFocusNodeIds: new Set(),
  communitySpotlightOverlayEdgeIds: new Set(),
  communitySpotlightSummary: null,
  recentOrbitMode: false,
  recentOrbitNodeIds: new Set(),
  recentOrbitActiveNodeId: null,
  recentOrbitTargetNodeId: null,
  recentOrbitPathNodeIds: new Set(),
  recentOrbitPathEdgeIds: new Set(),
  recentOrbitOrderedNodeIds: [],
  recentOrbitOrderedEdgeIds: [],
  recentOrbitItems: [],
  recentOrbitMessage: '',
  graphStoryMode: false,
  graphStorySteps: [],
  graphStoryStepIndex: 0,
  graphStoryNodeIds: new Set(),
  graphStoryEdgeIds: new Set(),
  graphStoryFocusNodeIds: new Set(),
  graphStoryActiveNodeId: null,
  graphStoryActiveCommunityName: null,
  graphStoryMessage: '',
  searchResultIds: [],
  searchRevealNodeId: null,
  searchRevealNeighborIds: new Set(),
  searchRevealEdgeIds: new Set(),
  searchRevealRestore: null,
  pathMode: false,
  pathSourceId: null,
  pathTargetId: null,
  pathNodeIds: new Set(),
  pathEdgeIds: new Set(),
  pathOrderedNodeIds: [],
  pathOrderedEdgeIds: [],
  pathVariants: [],
  activePathVariantId: 'shortest',
  pathMessage: '',
  pathPulsePhase: 0,
  agentActivityEvents: [],
  agentActivityRenderableEvents: [],
  agentActivityNodeIds: new Set(),
  agentActivityPendingPaths: [],
  agentActivityLastEventAt: null,
  agentActivityTracingEnabled: false,
  agentActivityEventLogPath: '',
  agentActivityWorkflows: [],
  workflowSelectionID: '',
  workflowHighlight: { workflowID: '', nodeIds: [], pendingPaths: [] },
  lastDiagnostic: '',
  cameraPreset: 'Fit',
  lastFrameStatus: 'Waiting',
  visibleProjectedNodeCount: 0,
  paintedNodeCount: 0,
  paintedEdgeCount: 0,
  paintedCountsSettled: false,
  visibleGraphRevision: 0,
  visualRevision: 0,
  projectedPointGrid: null,
  overlayCache: { key: '', edges: [] },
  spotlightCache: new Map(),
  livingPulseEvents: [],
  ambientRecentNodeIds: new Set(),
  staticHubNodeIds: [],
  ambientCurrentEdgeIds: new Set(),
  ambientCommunityPulseGroups: [],
  lastLivingInteractionAt: 0,
  lastAmbientLayerAt: 0,
  lastOverlaySlowAt: 0,
  overlayQuality: 'high',
  performanceStats: {
    staticRebuildMs: 0,
    layoutPreparationMs: 0,
    layoutWorkerComputeMs: 0,
    layoutCommitMs: 0,
    layoutCache: 'disabled',
    overlayFrameMs: 0,
    visualPixelRatio: 1,
    staticHubGlowCount: 0,
    highlightedEdgeCount: 0,
    lastHitTestCandidateCount: 0,
    livingPulseCount: 0,
    ambientRecentCount: 0,
    ambientCurrentEdgeCount: 0,
    ambientCommunityPulseCount: 0,
    recentSparkCount: 0
  },
  pointer: new THREE.Vector2(),
  raycaster: new THREE.Raycaster(),
  nodeIndexById: new Map(),
  pendingNodeRevealId: '',
  pendingPointerEvent: null,
  pointerHitFrame: null,
  graphLoadController: null,
  graphLoadEpoch: 0,
  graphGeneration: 0,
  pendingGraphGeneration: null,
  layoutEpoch: 0,
  activeLayoutRequest: null,
  heldLayoutResult: null,
  heldLayoutCacheLookup: null,
  layoutState: 'idle',
  committedLayoutContext: null,
  animationFrame: null,
  ambientFrame: null,
  ambientPhase: 0,
  lastAmbientTimestamp: 0
};

let renderer;
let scene;
let camera;
let controls;
let nodePoints;
let edgeLines;
let selectedMarker;

initScene();
wireEvents();
resize();
installWindowAPI();

if (window.__brainBarGraphJSON) {
  window.brainBarLoadGraph(window.__brainBarGraphJSON, window.__brainBarPendingGraphLens || 'all');
} else if (window.__brainBarPendingGraphRequest) {
  const request = window.__brainBarPendingGraphRequest;
  window.__brainBarPendingGraphRequest = null;
  void window.brainBarLoadGraphFromURL(request.graphURL, request.metadataURL, request.lens, request.generation);
} else if (!isBrainBarWebKitScheme()) {
  fetch('./graph.json')
    .then((response) => {
      if (!response.ok && response.status !== 0) {
        throw new Error(`Graph data unavailable (${response.status})`);
      }
      return response.json();
    })
    .then((payload) => {
      window.__brainBarGraphJSON = payload;
      window.brainBarLoadGraph(payload, window.__brainBarPendingGraphLens || 'all');
    })
    .catch((error) => {
      reportDiagnostic(error.message || 'Graph data unavailable', true);
    });
} else {
  updateHud();
}

function initScene() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color('#060912');

  renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance'
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor('#060912', 1);
  renderer.domElement.classList.add('webgl-hit-layer');
  stage.prepend(renderer.domElement);

  camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10000);
  camera.position.set(0, 860, 520);
  camera.lookAt(0, 0, 0);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = false;
  controls.enablePan = true;
  controls.enableZoom = true;
  controls.enableRotate = true;
  controls.zoomToCursor = true;
  controls.minPolarAngle = 0.08;
  controls.maxPolarAngle = Math.PI - 0.08;
  controls.minZoom = 0.08;
  controls.maxZoom = 8;
  controls.screenSpacePanning = true;
  controls.target.set(0, 0, 0);
  controls.addEventListener('change', () => {
    markLivingInteraction();
    state.cameraPreset = state.cameraPreset === 'Fit' ? 'Manual' : state.cameraPreset;
    markVisualCacheDirty();
    requestRender();
    scheduleGraphSessionState();
  });

  selectedMarker = new THREE.Mesh(
    new THREE.SphereGeometry(6, 18, 12),
    new THREE.MeshBasicMaterial({
      color: '#f4f6ff',
      transparent: true,
      opacity: 0.95,
      depthTest: false
    })
  );
  selectedMarker.visible = false;
  scene.add(selectedMarker);

  state.raycaster.params.Points.threshold = 14;
}

function normalizeGraph(payload) {
  if (!payload) {
    return { nodes: [], edges: [] };
  }

  const rawNodes = Array.isArray(payload.nodes) ? payload.nodes : [];
  const rawEdges = Array.isArray(payload.links) ? payload.links : (Array.isArray(payload.edges) ? payload.edges : []);
  const nodes = rawNodes.map((node, index) => {
    const id = String(node.id ?? node.label ?? node.name ?? index);
    const community = node.community_name ?? node.community ?? node.group ?? node.cluster ?? 'Community 0';
    return {
      ...node,
      id,
      label: String(node.label ?? node.name ?? id),
      community: String(community).startsWith('Community') ? String(community) : `Community ${community}`,
      sourceFile: node.source_file ?? node._source_file ?? node.sourceFile ?? ''
    };
  });

  const nodeIds = new Set(nodes.map((node) => node.id));
  const explicitEdgeIDs = new Set(rawEdges
    .map((edge) => edge?.id == null ? '' : String(edge.id))
    .filter(Boolean));
  const usedEdgeIDs = new Set(explicitEdgeIDs);
  const idlessOrdinals = new Map();
  const edges = rawEdges.map((edge) => {
    const source = endpointId(edge.source ?? edge.from);
    const target = endpointId(edge.target ?? edge.to);
    const relation = String(edge.relation ?? edge.context ?? edge.type ?? '');
    const explicitID = edge.id == null ? '' : String(edge.id);
    const semanticKey = normalizedEdgeSemanticKey(source, target, relation, edge);
    return {
      ...edge,
      id: explicitID,
      semanticKey,
      source,
      target,
      relation
    };
  }).filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target)).map((edge) => {
    if (edge.id) {
      delete edge.semanticKey;
      return edge;
    }
    const ordinal = idlessOrdinals.get(edge.semanticKey) ?? 0;
    idlessOrdinals.set(edge.semanticKey, ordinal + 1);
    const baseID = `edge:${edge.semanticKey}:${ordinal}`;
    let candidateID = baseID;
    let collisionOrdinal = 1;
    while (usedEdgeIDs.has(candidateID)) {
      candidateID = `${baseID}:derived-${collisionOrdinal}`;
      collisionOrdinal += 1;
    }
    usedEdgeIDs.add(candidateID);
    edge.id = candidateID;
    delete edge.semanticKey;
    return edge;
  });

  return { nodes, edges };
}

function evidenceScalar(value) {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value) ? value : '';
}

function evidenceEndpoint(value) {
  const candidate = value && typeof value === 'object'
    ? value.id ?? value.label ?? value.name
    : value;
  return evidenceScalar(candidate);
}

function evidenceInputForGraphPayload(payload) {
  const rawNodes = Array.isArray(payload?.nodes) ? payload.nodes : [];
  const rawEdges = Array.isArray(payload?.edges)
    ? payload.edges
    : (Array.isArray(payload?.links) ? payload.links : []);
  return {
    nodes: rawNodes.map((node) => ({
      id: evidenceScalar(node?.id),
      label: evidenceScalar(node?.label ?? node?.title ?? node?.name),
      source_file: evidenceScalar(node?.source_file ?? node?._source_file ?? node?.sourceFile),
      community: evidenceScalar(node?.community ?? node?.community_name ?? node?.group ?? node?.cluster),
      mtime: evidenceScalar(node?.mtime ?? node?.modified_at ?? node?.modifiedAt ?? node?.updated_at ?? node?.updatedAt),
      status: evidenceScalar(node?.status),
      category: evidenceScalar(node?.category ?? node?.type)
    })),
    edges: rawEdges.map((edge) => ({
      id: evidenceScalar(edge?.id),
      source: evidenceEndpoint(edge?.source ?? edge?.from),
      target: evidenceEndpoint(edge?.target ?? edge?.to),
      relation: evidenceScalar(edge?.relation ?? edge?.type),
      context: evidenceScalar(edge?.context),
      source_file: evidenceScalar(edge?.source_file ?? edge?._source_file ?? edge?.sourceFile)
    }))
  };
}

function endpointId(value) {
  if (value && typeof value === 'object') {
    return String(value.id ?? value.label ?? value.name ?? '');
  }
  return String(value ?? '');
}

function normalizedEdgeSemanticKey(source, target, relation, edge) {
  const attributes = {};
  const excludedKeys = new Set(['id', 'source', 'from', 'target', 'to']);
  Object.keys(edge).sort().forEach((key) => {
    if (!excludedKeys.has(key)) {
      attributes[key] = canonicalEdgeValue(edge[key]);
    }
  });
  return JSON.stringify({ source, target, relation, attributes });
}

function canonicalEdgeValue(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalEdgeValue);
  }
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = canonicalEdgeValue(value[key]);
      return result;
    }, {});
  }
  return value;
}

function prepareCommunities(graph) {
  const counts = new Map();
  graph.nodes.forEach((node) => {
    counts.set(node.community, (counts.get(node.community) ?? 0) + 1);
  });
  state.communities = Array.from(counts.entries())
    .map(([name, count], index) => ({
      name,
      count,
      color: palette[index % palette.length],
      accentColor: accentPalette[index % accentPalette.length],
      index
    }))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name));
  state.communityByName = new Map(state.communities.map((community) => [community.name, community]));
  state.communityEnabled = new Set(state.communities.map((community) => community.name));
}

async function applyLens(fit = true, { generation = null, emitGraphReady = false } = {}) {
  try {
    const graph = state.graph;
    if (!graph) {
      return false;
    }
    let lensEdges = graph.edges;
    if (state.lens === 'obsidian') {
      lensEdges = graph.edges.filter(isObsidianEdge);
    } else if (state.lens === 'graphify') {
      lensEdges = graph.edges.filter((edge) => !isObsidianEdge(edge));
    }

    const connectedIds = new Set();
    lensEdges.forEach((edge) => {
      connectedIds.add(edge.source);
      connectedIds.add(edge.target);
    });

    const lensNodes = state.lens === 'all'
      ? graph.nodes
      : graph.nodes.filter((node) => connectedIds.has(node.id));

    state.visibleNodes = lensNodes.filter((node) => state.communityEnabled.has(node.community));
    state.visibleNodeIds = new Set(state.visibleNodes.map((node) => node.id));
    state.visibleEdges = lensEdges.filter((edge) => state.visibleNodeIds.has(edge.source) && state.visibleNodeIds.has(edge.target));
    updateWorkflowHighlight();
    state.hoveredNode = null;
    state.hoveredEdge = null;
    state.hoverVisualNode = null;
    state.hoverTrails = new Map();
    state.edgeTrails = new Map();
    state.hoverIntensity = 0;
    clearInteractiveModes();
    state.visibleGraphRevision += 1;
    state.spotlightCache.clear();
    updateAmbientRecentNodes();
    updateAmbientSignalCaches();
    clearLivingPulses(false);
    markVisualCacheDirty();

    const layoutContext = {
      graphGeneration: generation ?? state.graphGeneration,
      lens: state.lens,
      visibleGraphRevision: state.visibleGraphRevision
    };
    const didLayout = await requestLayout(layoutContext);
    const didCommitCurrentLayout = matchesLayoutContext(state.committedLayoutContext, layoutContext);
    if (!didLayout && !didCommitCurrentLayout) {
      return false;
    }
    if (!isCurrentLayoutContext(layoutContext)) {
      return false;
    }
    rebuildMeshes();
    if (fit) {
      fitCameraToGraph('Fit');
    }
    flushPendingNodeReveal();
    renderSidebar();
    updateOverlay();
    state.lastDiagnostic = '';
    updateHud();
    requestRender();
    startAmbientMotion();
    if (emitGraphReady && isCurrentLayoutContext(layoutContext)) {
      window.__brainBarGraphReady = true;
      window.webkit?.messageHandlers?.brainBarGraphDiagnostic?.postMessage({
        event: 'graphReady',
        generation: layoutContext.graphGeneration,
        lens: layoutContext.lens
      });
    }
    return true;
  } catch (error) {
    failLayout();
    return false;
  }
}

function normalizeLens(lens) {
  return lens === 'obsidian' || lens === 'graphify' ? lens : 'all';
}

function activeMode() {
  return activeModeFromState(state);
}

function markLivingInteraction() {
  if (!ambientRuntimeEnabled && !edgeGlintsRuntimeEnabled) {
    return;
  }
  state.lastLivingInteractionAt = performance.now();
}

function updateOverlayQuality(frameMs) {
  const now = performance.now();
  if (Number.isFinite(frameMs) && frameMs > overlaySlowFrameMs) {
    state.lastOverlaySlowAt = now;
    state.overlayQuality = 'low';
    return;
  }
  state.overlayQuality = now - state.lastOverlaySlowAt > overlayRecoveryMs ? 'high' : 'low';
}

function isInteractionQuiet(now = performance.now()) {
  return now - state.lastLivingInteractionAt > ambientInteractionQuietMs;
}

function shouldDrawAmbientDecorations({ now, mode, hoverAmount }) {
  if (prefersReducedMotion || state.overlayQuality === 'low') {
    return false;
  }
  if (!isInteractionQuiet(now) || hoverAmount > 0.04) {
    return false;
  }
  if (mode !== 'none' && mode !== 'recent') {
    return false;
  }
  if (now - state.lastAmbientLayerAt < ambientIdleFrameInterval) {
    return false;
  }
  state.lastAmbientLayerAt = now;
  return true;
}

function shouldDrawEdgeGlints({ now, mode, hoverAmount }) {
  if (!edgeGlintsRuntimeEnabled || prefersReducedMotion || state.overlayQuality === 'low') {
    return false;
  }
  if (mode !== 'none' || hoverAmount > 0.04 || !isInteractionQuiet(now)) {
    return false;
  }
  return state.ambientCurrentEdgeIds.size > 0;
}

function shouldDrawAgentActivity() {
  return state.agentActivityRenderableEvents.length > 0 && state.overlayQuality !== 'low';
}

function clearInteractiveModes({ preservePathSource = false } = {}) {
  clearLivingPulses(false);
  clearFocusOrbit(false);
  if (!(preservePathSource && state.pathMode && state.pathSourceId && !state.pathTargetId)) {
    clearPathMode(false);
  }
  clearCommunitySpotlight(false);
  clearRecentOrbit(false);
  clearGraphStory(false);
  clearSearchReveal(false);
}

function isObsidianEdge(edge) {
  const values = [edge.context, edge.relation, edge.label, edge.title]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase());
  return values.some((value) => value === 'obsidian_wikilink' || value.includes('obsidian_wikilink'));
}

function requestLayout(layoutContext) {
  cancelActiveLayoutRequest();
  const epoch = ++state.layoutEpoch;
  layoutContext.epoch = epoch;
  const { graphGeneration, lens, visibleGraphRevision } = layoutContext;
  state.layoutState = 'starting';
  state.performanceStats.layoutPreparationMs = 0;
  state.performanceStats.layoutWorkerComputeMs = 0;
  state.performanceStats.layoutCommitMs = 0;
  const preparationStartedAt = performance.now();
  const nodes = state.visibleNodes.map((node) => ({
    id: String(node.id),
    label: String(node.label),
    community: String(node.community)
  }));
  const edges = state.visibleEdges.map((edge) => ({
    source: String(edge.source),
    target: String(edge.target)
  }));
  state.performanceStats.layoutPreparationMs = performance.now() - preparationStartedAt;
  const context = { ...layoutContext, graphGeneration, lens, visibleGraphRevision, nodes, edges };

  return new Promise((resolve) => {
    const request = {
      resolve,
      context,
      ready: false,
      readyTimer: null,
      resultTimer: null,
      settled: false,
      worker: null
    };
    state.activeLayoutRequest = request;
    const cacheIdentity = currentLayoutCacheIdentity();
    if (cacheIdentity) {
      state.performanceStats.layoutCache = 'lookup';
      void resolveCachedLayout(request, cacheIdentity);
      return;
    }
    state.performanceStats.layoutCache = 'disabled';
    startWorkerLayout(request);
  });
}

async function resolveCachedLayout(request, cacheIdentity) {
  if (layoutCacheTestMode === 'hold') {
    state.layoutState = 'holding-cache';
    await new Promise((resolve) => {
      state.heldLayoutCacheLookup = { request, resolve };
    });
  }
  const cachedCoordinates = await readLayoutCache(cacheIdentity, request.context.nodes.length);
  if (state.activeLayoutRequest !== request || request.settled || !isCurrentLayoutContext(request.context)) {
    return;
  }
  if (cachedCoordinates) {
    const positions = unpackCachedLayoutPositions(cachedCoordinates, request.context.nodes);
    if (positions) {
      const commitStartedAt = performance.now();
      state.positions = positions;
      state.performanceStats.layoutWorkerComputeMs = 0;
      state.performanceStats.layoutCommitMs = performance.now() - commitStartedAt;
      state.performanceStats.layoutCache = 'hit';
      state.layoutState = 'committed';
      state.committedLayoutContext = request.context;
      settleLayoutRequest(request, true);
      return;
    }
  }
  state.performanceStats.layoutCache = 'miss';
  startWorkerLayout(request);
}

function startWorkerLayout(request) {
  const { context } = request;
  if (state.activeLayoutRequest !== request || request.settled || !isCurrentLayoutContext(context)) {
    return;
  }
  if (layoutWorkerTestMode === 'failStartup' || typeof Worker !== 'function') {
    finishLayoutFailure(context, request.resolve);
    return;
  }
  let worker;
  try {
    worker = new Worker(new URL('./graph3d-layout-worker.mjs', import.meta.url), {
      type: 'module',
      name: 'brainbar-3d-layout'
    });
  } catch (_) {
    finishLayoutFailure(context, request.resolve);
    return;
  }
  request.worker = worker;
    request.readyTimer = window.setTimeout(() => finishLayoutFailure(context, request.resolve), 6000);
    worker.onmessage = ({ data }) => {
      if (state.activeLayoutRequest !== request || request.settled) {
        return;
      }
      if (data?.type === 'ready') {
        request.ready = true;
        window.clearTimeout(request.readyTimer);
        request.readyTimer = null;
        state.layoutState = 'running';
        request.resultTimer = window.setTimeout(() => finishLayoutFailure(context, request.resolve), 60000);
        try {
          worker.postMessage({ type: 'layout', ...context });
        } catch (_) {
          finishLayoutFailure(context, request.resolve);
        }
        return;
      }
      if (data?.type === 'result') {
        if (layoutWorkerTestMode === 'holdResult' && !state.heldLayoutResult) {
          state.heldLayoutResult = { request, result: data };
          state.layoutState = 'holding';
          return;
        }
        finishLayoutResult(request, data);
        return;
      }
      finishLayoutFailure(context, request.resolve);
    };
    worker.onerror = () => finishLayoutFailure(context, request.resolve);
    worker.onmessageerror = () => finishLayoutFailure(context, request.resolve);
}

function cancelActiveLayoutRequest() {
  const request = state.activeLayoutRequest;
  if (!request || request.settled) {
    return;
  }
  request.settled = true;
  window.clearTimeout(request.readyTimer);
  window.clearTimeout(request.resultTimer);
  request.worker?.terminate();
  state.activeLayoutRequest = null;
  if (state.heldLayoutResult?.request === request) {
    state.heldLayoutResult = null;
  }
  if (state.heldLayoutCacheLookup?.request === request) {
    const heldLookup = state.heldLayoutCacheLookup;
    state.heldLayoutCacheLookup = null;
    heldLookup.resolve();
  }
  request.resolve(false);
}

function releaseHeldLayoutWorkerResult() {
  const held = state.heldLayoutResult;
  state.heldLayoutResult = null;
  if (!held || state.activeLayoutRequest !== held.request || held.request.settled) {
    return false;
  }
  finishLayoutResult(held.request, held.result);
  return true;
}

function releaseHeldLayoutCacheLookup() {
  const heldLookup = state.heldLayoutCacheLookup;
  state.heldLayoutCacheLookup = null;
  if (!heldLookup || state.activeLayoutRequest !== heldLookup.request || heldLookup.request.settled) {
    return false;
  }
  heldLookup.resolve();
  return true;
}

function finishLayoutResult(request, result) {
  const { context } = request;
  if (!matchesLayoutContext(result, context) || !isCurrentLayoutContext(context)) {
    settleLayoutRequest(request, false);
    return;
  }
  const positions = unpackLayoutPositions(result, context.nodes);
  if (!positions) {
    finishLayoutFailure(context, request.resolve);
    return;
  }
  const commitStartedAt = performance.now();
  state.positions = positions;
  state.performanceStats.layoutWorkerComputeMs = Number.isFinite(result.workerComputeMs) ? result.workerComputeMs : 0;
  state.performanceStats.layoutCommitMs = performance.now() - commitStartedAt;
  state.layoutState = 'committed';
  state.committedLayoutContext = context;
  const cacheIdentity = currentLayoutCacheIdentity(context);
  if (cacheIdentity) {
    void writeLayoutCache(cacheIdentity, context.nodes.length, result.positions).then((didWrite) => {
      if (matchesLayoutContext(state.committedLayoutContext, context) && isCurrentLayoutContext(context)) {
        state.performanceStats.layoutCache = didWrite ? 'stored' : 'miss';
      }
    });
  }
  settleLayoutRequest(request, true);
}

function finishLayoutFailure(context, resolve) {
  const request = state.activeLayoutRequest;
  if (request?.context.epoch === context.epoch) {
    state.layoutState = 'failed';
    settleLayoutRequest(request, false);
  }
  if (!request || request.context.epoch !== context.epoch) {
    resolve(false);
  }
  if (isCurrentLayoutContext(context)) {
    state.layoutState = 'failed';
    failLayout();
  }
}

function settleLayoutRequest(request, value) {
  if (request.settled) {
    return;
  }
  request.settled = true;
  window.clearTimeout(request.readyTimer);
  window.clearTimeout(request.resultTimer);
  if (request.worker) {
    request.worker.onmessage = null;
    request.worker.onerror = null;
    request.worker.onmessageerror = null;
  }
  if (!value) {
    request.worker?.terminate();
  }
  if (state.activeLayoutRequest === request) {
    state.activeLayoutRequest = null;
  }
  if (state.heldLayoutResult?.request === request) {
    state.heldLayoutResult = null;
  }
  request.resolve(value);
}

function matchesLayoutContext(result, context) {
  return result?.epoch === context.epoch
    && result?.graphGeneration === context.graphGeneration
    && result?.lens === context.lens
    && result?.visibleGraphRevision === context.visibleGraphRevision;
}

function isCurrentLayoutContext(context) {
  return context.graphGeneration === state.graphGeneration
    && context.lens === state.lens
    && context.visibleGraphRevision === state.visibleGraphRevision
    && context.epoch === state.layoutEpoch;
}

function unpackLayoutPositions(result, expectedNodes) {
  if (!Array.isArray(result?.nodeIds) || result.nodeIds.length !== expectedNodes.length) {
    return null;
  }
  const idsMatch = result.nodeIds.every((id, index) => id === expectedNodes[index].id);
  if (!idsMatch || !(result.positions instanceof ArrayBuffer) || result.positions.byteLength !== expectedNodes.length * 3 * Float64Array.BYTES_PER_ELEMENT) {
    return null;
  }
  const packed = new Float64Array(result.positions);
  const positions = new Map();
  for (let index = 0; index < expectedNodes.length; index += 1) {
    const x = packed[index * 3];
    const y = packed[index * 3 + 1];
    const z = packed[index * 3 + 2];
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      return null;
    }
    positions.set(expectedNodes[index].id, { x, y, z });
  }
  return positions;
}

function unpackCachedLayoutPositions(coordinates, expectedNodes) {
  if (!(coordinates instanceof Float64Array) || coordinates.length !== expectedNodes.length * 3) {
    return null;
  }
  const positions = new Map();
  for (let index = 0; index < expectedNodes.length; index += 1) {
    const x = coordinates[index * 3];
    const y = coordinates[index * 3 + 1];
    const z = coordinates[index * 3 + 2];
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      return null;
    }
    positions.set(expectedNodes[index].id, { x, y, z });
  }
  return positions;
}

function currentLayoutCacheIdentity(context = null) {
  const parameters = new URLSearchParams(window.location.search);
  const digest = parameters.get('digest');
  const allCommunitiesEnabled = state.communityEnabled.size === state.communities.length
    && state.communities.every((community) => state.communityEnabled.has(community.name));
  if (
    !isBrainBarWebKitScheme() ||
    layoutWorkerTestMode ||
    graphIdentityTestMode ||
    (layoutCacheTestMode && !layoutCacheTestEnabled) ||
    !allCommunitiesEnabled ||
    !isLayoutCacheDigest(digest) ||
    (context && context.lens !== state.lens)
  ) {
    return null;
  }
  return { digest, lens: normalizeLayoutCacheLens(context?.lens ?? state.lens) };
}

function failLayout() {
  window.__brainBarGraphReady = false;
  reportDiagnostic('3D graph layout could not be completed', true);
}

function flushPendingNodeReveal() {
  const nodeId = state.pendingNodeRevealId;
  state.pendingNodeRevealId = '';
  const node = nodeId ? nodeForId(nodeId) : null;
  if (node) {
    revealSearchNode(node);
  }
}

function buildDegreeMap(edges) {
  const degreeMap = new Map();
  edges.forEach((edge) => {
    degreeMap.set(edge.source, (degreeMap.get(edge.source) ?? 0) + 1);
    degreeMap.set(edge.target, (degreeMap.get(edge.target) ?? 0) + 1);
  });
  return degreeMap;
}

function buildAdjacencyMap(edges) {
  const adjacency = new Map();
  edges.forEach((edge) => {
    if (!adjacency.has(edge.source)) {
      adjacency.set(edge.source, new Set());
    }
    if (!adjacency.has(edge.target)) {
      adjacency.set(edge.target, new Set());
    }
    adjacency.get(edge.source).add(edge.target);
    adjacency.get(edge.target).add(edge.source);
  });
  return adjacency;
}

function buildEdgeMap(edges) {
  const edgeMap = new Map();
  edges.forEach((edge) => {
    if (!edgeMap.has(edge.source)) {
      edgeMap.set(edge.source, []);
    }
    if (!edgeMap.has(edge.target)) {
      edgeMap.set(edge.target, []);
    }
    edgeMap.get(edge.source).push(edge);
    edgeMap.get(edge.target).push(edge);
  });
  return edgeMap;
}

function pointOnDisc(index, count, radius) {
  if (count <= 1) {
    return { x: 0, y: 0 };
  }
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const localRadius = Math.sqrt((index + 0.5) / count) * radius;
  const angle = index * goldenAngle;
  return {
    x: Math.cos(angle) * localRadius,
    y: Math.sin(angle) * localRadius
  };
}

function rebuildMeshes() {
  removeGraphObjects();
  state.nodeIndexById = new Map();

  const nodePositions = new Float32Array(state.visibleNodes.length * 3);
  const nodeColors = new Float32Array(state.visibleNodes.length * 3);
  const nodeSizes = new Float32Array(state.visibleNodes.length);
  const degreeMap = buildDegreeMap(state.visibleEdges);
  state.degreeByNode = degreeMap;
  state.adjacencyByNode = buildAdjacencyMap(state.visibleEdges);
  state.edgesByNode = buildEdgeMap(state.visibleEdges);
  state.edgeById = new Map(state.visibleEdges.map((edge) => [edge.id, edge]));
  updateStaticHubNodes(degreeMap);
  markVisualCacheDirty();

  state.visibleNodes.forEach((node, index) => {
    const position = state.positions.get(node.id) ?? { x: 0, y: 0, z: 0 };
    const color = new THREE.Color(colorForCommunity(node.community));
    const degree = degreeMap.get(node.id) ?? 0;
    const size = clamp(4.5 + Math.log1p(degree) * 1.8, 4.5, 13);
    nodePositions.set([position.x, position.y, position.z], index * 3);
    nodeColors.set([color.r, color.g, color.b], index * 3);
    nodeSizes[index] = size;
    state.nodeIndexById.set(node.id, index);
  });

  const nodeGeometry = new THREE.BufferGeometry();
  nodeGeometry.setAttribute('position', new THREE.BufferAttribute(nodePositions, 3));
  nodeGeometry.setAttribute('color', new THREE.BufferAttribute(nodeColors, 3));
  nodeGeometry.setAttribute('size', new THREE.BufferAttribute(nodeSizes, 1));

  const nodeMaterial = new THREE.PointsMaterial({
    size: 7.2,
    sizeAttenuation: false,
    map: pointTexture,
    vertexColors: true,
    transparent: true,
    opacity: 0.96,
    alphaTest: 0.08,
    depthWrite: false
  });
  nodePoints = new THREE.Points(nodeGeometry, nodeMaterial);
  nodePoints.renderOrder = 2;
  scene.add(nodePoints);

  const edgePositions = new Float32Array(state.visibleEdges.length * 2 * 3);
  const edgeColors = new Float32Array(state.visibleEdges.length * 2 * 3);
  state.visibleEdges.forEach((edge, index) => {
    const source = state.positions.get(edge.source);
    const target = state.positions.get(edge.target);
    if (!source || !target) {
      return;
    }
    edgePositions.set([source.x, source.y, source.z, target.x, target.y, target.z], index * 6);
    const sourceNode = state.visibleNodes[state.nodeIndexById.get(edge.source)];
    const targetNode = state.visibleNodes[state.nodeIndexById.get(edge.target)];
    const sourceColor = new THREE.Color(colorForCommunity(sourceNode?.community ?? ''));
    const targetColor = new THREE.Color(colorForCommunity(targetNode?.community ?? ''));
    edgeColors.set([sourceColor.r, sourceColor.g, sourceColor.b, targetColor.r, targetColor.g, targetColor.b], index * 6);
  });

  const edgeGeometry = new THREE.BufferGeometry();
  edgeGeometry.setAttribute('position', new THREE.BufferAttribute(edgePositions, 3));
  edgeGeometry.setAttribute('color', new THREE.BufferAttribute(edgeColors, 3));

  const edgeMaterial = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });
  edgeLines = new THREE.LineSegments(edgeGeometry, edgeMaterial);
  edgeLines.renderOrder = 1;
  scene.add(edgeLines);

  selectedMarker.visible = false;
}

function removeGraphObjects() {
  if (nodePoints) {
    scene.remove(nodePoints);
    nodePoints.geometry.dispose();
    nodePoints.material.dispose();
    nodePoints = null;
  }
  if (edgeLines) {
    scene.remove(edgeLines);
    edgeLines.geometry.dispose();
    edgeLines.material.dispose();
    edgeLines = null;
  }
}

function fitCameraToGraph(preset = 'Fit') {
  fitCameraWithTilt(preset, 1.12, 0.54);
}

function fitCameraWithTilt(preset, zTilt, heightMultiplier) {
  if (!state.visibleNodes.length || !state.positions.size) {
    state.cameraPreset = preset;
    markVisualCacheDirty();
    requestRender();
    return;
  }

  const bounds = boundsForVisibleNodes();
  const width = Math.max(bounds.maxX - bounds.minX, 120);
  const depth = Math.max(bounds.maxZ - bounds.minZ, 120);
  const height = Math.max(bounds.maxY - bounds.minY, 120);
  const radius = Math.max(width, depth, height * 0.66);
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  const centerZ = (bounds.minZ + bounds.maxZ) / 2;
  const verticalSpan = Math.max(depth * 0.58, height * 1.08);

  controls.target.set(centerX, centerY, centerZ);
  camera.position.set(centerX, centerY + radius * heightMultiplier, centerZ + radius * zTilt);
  camera.lookAt(controls.target);
  camera.zoom = clamp(Math.min(stage.clientWidth / (width * 1.08), stage.clientHeight / (verticalSpan * 1.08)), 0.08, 6);
  camera.updateProjectionMatrix();
  controls.update();

  state.cameraPreset = preset;
  markVisualCacheDirty();
  updateHud();
  requestRender();
}

function boundsForVisibleNodes() {
  return state.visibleNodes.reduce((bounds, node) => {
    const position = state.positions.get(node.id);
    if (!position) {
      return bounds;
    }
    return {
      minX: Math.min(bounds.minX, position.x),
      maxX: Math.max(bounds.maxX, position.x),
      minY: Math.min(bounds.minY, position.y),
      maxY: Math.max(bounds.maxY, position.y),
      minZ: Math.min(bounds.minZ, position.z),
      maxZ: Math.max(bounds.maxZ, position.z)
    };
  }, { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity });
}

function boundsForPositions(positions) {
  return positions.reduce((bounds, position) => ({
    minX: Math.min(bounds.minX, position.x),
    maxX: Math.max(bounds.maxX, position.x),
    minY: Math.min(bounds.minY, position.y),
    maxY: Math.max(bounds.maxY, position.y),
    minZ: Math.min(bounds.minZ, position.z),
    maxZ: Math.max(bounds.maxZ, position.z)
  }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity });
}

function fitCameraToPositions(positions, preset, options = {}) {
  const validPositions = (positions || []).filter(Boolean);
  if (!validPositions.length) {
    return;
  }
  const bounds = boundsForPositions(validPositions);
  const center = new THREE.Vector3(
    (bounds.minX + bounds.maxX) / 2,
    (bounds.minY + bounds.maxY) / 2,
    (bounds.minZ + bounds.maxZ) / 2
  );
  const span = Math.max(
    bounds.maxX - bounds.minX,
    bounds.maxY - bounds.minY,
    bounds.maxZ - bounds.minZ,
    options.minimumSpan ?? 160
  );
  const widthPadding = options.widthPadding ?? 1.18;
  const heightPadding = options.heightPadding ?? 0.96;
  const minZoom = options.minZoom ?? 0.2;
  const maxZoom = options.maxZoom ?? 4.8;
  const zoom = clamp(Math.min(stage.clientWidth / (span * widthPadding), stage.clientHeight / (span * heightPadding)), minZoom, maxZoom);
  orbitCameraTo(center, zoom, preset);
}

function fitCameraToNodeIds(nodeIds, preset, options = {}) {
  const positions = Array.from(nodeIds || [])
    .map((nodeId) => state.positions.get(nodeId))
    .filter(Boolean);
  fitCameraToPositions(positions, preset, options);
}

function resize() {
  const rect = stage.getBoundingClientRect();
  const width = Math.max(Math.floor(rect.width), 1);
  const height = Math.max(Math.floor(rect.height), 1);

  renderer.setSize(width, height, false);
  markVisualCacheDirty();
  camera.left = -width / 2;
  camera.right = width / 2;
  camera.top = height / 2;
  camera.bottom = -height / 2;
  camera.updateProjectionMatrix();

  if (state.graph) {
    fitCameraToGraph(state.cameraPreset || 'Fit');
  } else {
    requestRender();
  }
}

function render() {
  state.paintedCountsSettled = false;
  controls.update();
  if (renderHiddenWebGLLayer) {
    renderer.render(scene, camera);
  }
  updateHoverIntensity();
  if (renderVisualOverlay() && state.layoutState === 'committed') {
    completePaintedCounts();
  }
  state.lastFrameStatus = state.visibleProjectedNodeCount > 0 ? 'Visible' : 'Waiting for view';
  updateHud();
}

function renderVisualOverlay() {
  if (!graphVisual || !visualContext || !staticVisualContext) {
    return false;
  }

  const startedAt = performance.now();
  const metrics = ensureVisualCanvas();
  if (!metrics) {
    return;
  }

  if (!state.visibleNodes.length || !state.positions.size) {
    state.visibleProjectedNodeCount = 0;
    state.projectedPoints = new Map();
    state.performanceStats.visualPixelRatio = metrics.pixelRatio;
    visualContext.setTransform(metrics.pixelRatio, 0, 0, metrics.pixelRatio, 0, 0);
    visualContext.clearRect(0, 0, metrics.width, metrics.height);
    return true;
  }

  state.performanceStats.visualPixelRatio = metrics.pixelRatio;
  if (state.visualCacheDirty) {
    rebuildStaticVisualLayer(metrics);
  }

  drawVisualFrame(metrics);
  const frameMs = performance.now() - startedAt;
  state.performanceStats.overlayFrameMs = frameMs;
  updateOverlayQuality(frameMs);
  return true;
}

function completePaintedCounts() {
  const projected = state.projectedPoints ?? new Map();
  state.paintedNodeCount = projected.size;
  state.paintedEdgeCount = state.visibleEdges.reduce((count, edge) => (
    projected.has(edge.source) && projected.has(edge.target) ? count + 1 : count
  ), 0);
  state.paintedCountsSettled = true;
}

function ensureVisualCanvas() {
  const rect = stage.getBoundingClientRect();
  const width = Math.max(Math.floor(rect.width), 1);
  const height = Math.max(Math.floor(rect.height), 1);
  const pixelRatio = visualOverlayPixelRatio();
  const backingWidth = Math.max(Math.floor(width * pixelRatio), 1);
  const backingHeight = Math.max(Math.floor(height * pixelRatio), 1);

  if (graphVisual.width !== backingWidth || graphVisual.height !== backingHeight) {
    graphVisual.width = backingWidth;
    graphVisual.height = backingHeight;
    graphVisual.style.width = `${width}px`;
    graphVisual.style.height = `${height}px`;
    markVisualCacheDirty();
  }

  if (staticVisualLayer.width !== backingWidth || staticVisualLayer.height !== backingHeight) {
    staticVisualLayer.width = backingWidth;
    staticVisualLayer.height = backingHeight;
    markVisualCacheDirty();
  }

  return { width, height, pixelRatio };
}

function visualOverlayPixelRatio() {
  const deviceRatio = Math.min(window.devicePixelRatio || 1, 2);
  const nodeCount = state.visibleNodes.length;
  const edgeCount = state.visibleEdges.length;
  if (nodeCount >= overlayVeryDenseNodeThreshold || edgeCount >= overlayVeryDenseEdgeThreshold) {
    return Math.min(deviceRatio, 1);
  }
  if (nodeCount >= overlayDenseNodeThreshold || edgeCount >= overlayDenseEdgeThreshold) {
    return Math.min(deviceRatio, 1.25);
  }
  return deviceRatio;
}

function rebuildStaticVisualLayer({ width, height, pixelRatio }) {
  const startedAt = performance.now();
  camera.updateMatrixWorld();
  const projected = new Map();
  const vector = new THREE.Vector3();
  let projectedNodeCount = 0;

  state.visibleNodes.forEach((node) => {
    const position = state.positions.get(node.id);
    if (!position) {
      return;
    }
    vector.set(position.x, position.y, position.z).project(camera);
    if (vector.z < -1 || vector.z > 1) {
      return;
    }
    const x = (vector.x * 0.5 + 0.5) * width;
    const y = (-vector.y * 0.5 + 0.5) * height;
    projected.set(node.id, {
      x,
      y,
      z: vector.z,
      node
    });
    if (x >= 0 && x <= width && y >= 0 && y <= height) {
      projectedNodeCount += 1;
    }
  });

  state.visibleProjectedNodeCount = projectedNodeCount;
  state.projectedPoints = projected;
  state.projectedPointGrid = buildProjectedNodeGrid(projected);
  staticVisualContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  staticVisualContext.globalAlpha = 1;
  staticVisualContext.clearRect(0, 0, width, height);

  const baseEdgePath = new Path2D();

  state.visibleEdges.forEach((edge) => {
    const source = projected.get(edge.source);
    const target = projected.get(edge.target);
    if (!source || !target) {
      return;
    }
    addCurvedEdge(baseEdgePath, edge, source, target, 0.74);
  });

  staticVisualContext.save();
  staticVisualContext.lineWidth = 0.62;
  staticVisualContext.lineCap = 'round';
  staticVisualContext.lineJoin = 'round';
  staticVisualContext.globalAlpha = 0.22;
  staticVisualContext.strokeStyle = baseEdgeColor;
  staticVisualContext.stroke(baseEdgePath);
  staticVisualContext.restore();

  drawStaticHubGlows(projected);

  state.visibleNodes.forEach((node) => {
    const point = projected.get(node.id);
    if (!point) {
      return;
    }
    const degree = state.degreeByNode.get(node.id) ?? 0;
    const depth = depthPresence(point.z);
    const radius = nodeRadiusForDegree(degree, depth);
    staticVisualContext.save();
    staticVisualContext.beginPath();
    staticVisualContext.arc(point.x, point.y, Math.max(radius - 0.35, 1.2), 0, Math.PI * 2);
    staticVisualContext.fillStyle = colorForCommunity(node.community);
    staticVisualContext.globalAlpha = 0.035 + depth * 0.015;
    staticVisualContext.fill();
    staticVisualContext.beginPath();
    staticVisualContext.arc(point.x, point.y, radius, 0, Math.PI * 2);
    staticVisualContext.strokeStyle = colorForCommunity(node.community);
    staticVisualContext.globalAlpha = 0.58 + depth * 0.24;
    staticVisualContext.lineWidth = clamp(0.68 + Math.log1p(degree) * 0.08, 0.68, 1.25);
    staticVisualContext.stroke();
    staticVisualContext.restore();
  });

  state.visualCacheDirty = false;
  state.performanceStats.staticRebuildMs = performance.now() - startedAt;
}

function updateStaticHubNodes(degreeMap = state.degreeByNode) {
  if (!staticHubGlowEnabled) {
    state.staticHubNodeIds = [];
    state.performanceStats.staticHubGlowCount = 0;
    return;
  }
  state.staticHubNodeIds = state.visibleNodes
    .map((node) => ({
      id: node.id,
      degree: degreeMap.get(node.id) ?? 0
    }))
    .filter((item) => item.degree > 1)
    .sort((left, right) => right.degree - left.degree || left.id.localeCompare(right.id))
    .slice(0, staticHubGlowLimit)
    .map((item) => item.id);
}

function drawStaticHubGlows(projected) {
  if (!staticHubGlowEnabled || !state.staticHubNodeIds.length) {
    state.performanceStats.staticHubGlowCount = 0;
    return;
  }
  let rendered = 0;
  staticVisualContext.save();
  state.staticHubNodeIds.forEach((nodeId) => {
    const node = nodeForId(nodeId);
    const point = projected.get(nodeId);
    if (!node || !point) {
      return;
    }
    const degree = state.degreeByNode.get(nodeId) ?? 0;
    const depth = depthPresence(point.z);
    const radius = nodeRadiusForDegree(degree, depth);
    const color = accentColorForCommunity(node.community);
    const haloRadius = radius + clamp(Math.log1p(degree) * 1.8, 5.5, 13);
    staticVisualContext.beginPath();
    staticVisualContext.arc(point.x, point.y, haloRadius, 0, Math.PI * 2);
    staticVisualContext.fillStyle = color;
    staticVisualContext.globalAlpha = (0.038 + depth * 0.028) * (prefersReducedMotion ? 0.65 : 1);
    staticVisualContext.shadowColor = color;
    staticVisualContext.shadowBlur = prefersReducedMotion ? 0 : 10;
    staticVisualContext.fill();
    rendered += 1;
  });
  staticVisualContext.restore();
  state.performanceStats.staticHubGlowCount = rendered;
}

function drawVisualFrame({ width, height, pixelRatio }) {
  const now = performance.now();
  const mode = activeMode();
  const hoverTrails = updateHoverTrails();
  const edgeTrails = updateEdgeTrails();
  const activeAmount = Math.max(
    state.pathMode && state.pathOrderedNodeIds.length ? 1 : 0,
    state.focusMode ? 1 : 0,
    state.communitySpotlightName ? 1 : 0,
    state.recentOrbitMode ? 1 : 0,
    state.graphStoryMode ? 1 : 0,
    state.searchRevealNodeId ? 1 : 0,
    state.selectedNode ? 1 : 0,
    hoverTrails.reduce((max, trail) => Math.max(max, trail.intensity), 0),
    edgeTrails.reduce((max, trail) => Math.max(max, trail.intensity), 0)
  );
  const hoverAmount = smoothstep(activeAmount);

  visualContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  visualContext.globalAlpha = 1;
  visualContext.clearRect(0, 0, width, height);

  visualContext.drawImage(staticVisualLayer, 0, 0, width, height);
  const drawAmbientDecorations = ambientRuntimeEnabled && shouldDrawAmbientDecorations({ now, mode, hoverAmount });
  if (drawAmbientDecorations) {
    drawAmbientNodeMotion(width, height);
    drawAmbientRecentWarmth(width, height);
    drawAmbientCommunityBreathing(width, height);
    drawAmbientEdgeCurrents(width, height);
    drawRecentSparks(width, height);
  } else if (
    staticRecentWarmthEnabled &&
    !prefersReducedMotion &&
    mode === 'none' &&
    state.overlayQuality !== 'low' &&
    hoverAmount <= 0.04 &&
    state.ambientRecentNodeIds.size
  ) {
    drawAmbientRecentWarmth(width, height);
  }
  if (shouldDrawEdgeGlints({ now, mode, hoverAmount })) {
    drawAmbientEdgeCurrents(width, height);
  }
  if (shouldDrawAgentActivity()) {
    drawAgentActivityOverlay(width, height);
  }
  drawWorkflowHighlightOverlay(width, height);

  if (hoverAmount > 0.01) {
    visualContext.save();
    const dimAlpha = state.focusMode ? 0.28 : (state.communitySpotlightName || state.recentOrbitMode || state.graphStoryMode || state.searchRevealNodeId ? 0.18 : 0.1);
    visualContext.globalAlpha = dimAlpha * hoverAmount;
    visualContext.fillStyle = '#050812';
    visualContext.fillRect(0, 0, width, height);
    visualContext.restore();
  }

  drawActiveVisualOverlay(hoverTrails, edgeTrails, hoverAmount, width, height);
  if (responsePulseRuntimeEnabled) {
    drawLivingPulses(width, height);
  }
  if (state.pathMode && state.pathOrderedEdgeIds.length && !prefersReducedMotion) {
    state.pathPulsePhase = performance.now() * 0.001;
    requestRender();
  }
  if (responsePulseRuntimeEnabled && state.livingPulseEvents.length && !prefersReducedMotion && state.overlayQuality !== 'low') {
    requestRender();
  }
}

function drawAmbientNodeMotion(width, height) {
  if (!state.ambientPhase || ambientMotionScale <= 0 || !state.projectedPoints.size) {
    return;
  }
  const stride = Math.max(1, Math.ceil(state.visibleNodes.length / ambientSampleTarget));
  visualContext.save();
  visualContext.lineWidth = 0.86;
  state.visibleNodes.forEach((node, index) => {
    if (index % stride !== 0) {
      return;
    }
    const rawPoint = state.projectedPoints.get(node.id);
    if (!rawPoint) {
      return;
    }
    const degree = state.degreeByNode.get(node.id) ?? 0;
    const depth = depthPresence(rawPoint.z);
    const baseRadius = nodeRadiusForDegree(degree, depth) * 0.82;
    const breath = breathingStyle({
      phase: state.ambientPhase,
      nodeId: node.id,
      baseRadius,
      depth,
      reducedMotion: prefersReducedMotion
    });
    const point = {
      ...rawPoint,
      x: rawPoint.x + breath.offsetX,
      y: rawPoint.y + breath.offsetY
    };
    const radius = breath.radius;
    visualContext.beginPath();
    visualContext.arc(point.x, point.y, Math.max(radius - 0.55, 1.2), 0, Math.PI * 2);
    visualContext.fillStyle = colorForCommunity(node.community);
    visualContext.globalAlpha = breath.fillAlpha;
    visualContext.fill();
    visualContext.beginPath();
    visualContext.arc(point.x, point.y, radius, 0, Math.PI * 2);
    visualContext.strokeStyle = colorForCommunity(node.community);
    visualContext.globalAlpha = breath.strokeAlpha;
    visualContext.stroke();
  });
  visualContext.restore();
}

function drawAmbientRecentWarmth(width, height) {
  if (!state.ambientRecentNodeIds.size || !state.projectedPoints.size) {
    return;
  }
  const mode = activeMode();
  const activeDamping = mode === 'none' ? 1 : 0.42;
  const phase = state.ambientPhase || performance.now() * 0.001;
  visualContext.save();
  state.ambientRecentNodeIds.forEach((nodeId) => {
    const node = nodeForId(nodeId);
    const rawPoint = state.projectedPoints.get(nodeId);
    if (!node || !rawPoint) {
      return;
    }
    const point = ambientProjectedPoint(rawPoint, width, height);
    const degree = state.degreeByNode.get(node.id) ?? 0;
    const depth = depthPresence(point.z);
    const baseRadius = nodeRadiusForDegree(degree, depth);
    const wave = prefersReducedMotion ? 0.35 : (Math.sin(phase * 0.84 + hashString(nodeId) * 0.003) + 1) * 0.5;
    const radius = baseRadius + 2.8 + wave * 2.2;
    visualContext.beginPath();
    visualContext.arc(point.x, point.y, radius + 4.5, 0, Math.PI * 2);
    visualContext.fillStyle = accentColorForCommunity(node.community);
    visualContext.globalAlpha = (prefersReducedMotion ? 0.045 : 0.052 + wave * 0.042) * activeDamping;
    visualContext.shadowColor = 'rgba(164, 224, 214, 0.18)';
    visualContext.shadowBlur = prefersReducedMotion ? 0 : 10 + wave * 8;
    visualContext.fill();
    visualContext.beginPath();
    visualContext.arc(point.x, point.y, Math.max(baseRadius + 0.8, 2.2), 0, Math.PI * 2);
    visualContext.strokeStyle = accentColorForCommunity(node.community);
    visualContext.globalAlpha = (prefersReducedMotion ? 0.10 : 0.12 + wave * 0.08) * activeDamping;
    visualContext.lineWidth = 0.85;
    visualContext.stroke();
  });
  visualContext.restore();
}

function drawAmbientCommunityBreathing(width, height) {
  if (!state.ambientCommunityPulseGroups.length || !state.projectedPoints.size) {
    state.performanceStats.ambientCommunityPulseCount = 0;
    return;
  }
  const mode = activeMode();
  const damping = mode === 'none' ? 1 : 0.38;
  const phase = state.ambientPhase || performance.now() * 0.001;
  let rendered = 0;
  visualContext.save();
  state.ambientCommunityPulseGroups.forEach((group) => {
    const visual = communityBreathingVisual({
      phase,
      community: group.community,
      reducedMotion: prefersReducedMotion
    });
    const color = colorForCommunity(group.community);
    group.nodeIds.forEach((nodeId) => {
      const node = nodeForId(nodeId);
      const rawPoint = state.projectedPoints.get(nodeId);
      if (!node || !rawPoint) {
        return;
      }
      const point = ambientProjectedPoint(rawPoint, width, height);
      const degree = state.degreeByNode.get(node.id) ?? 0;
      const depth = depthPresence(point.z);
      const baseRadius = nodeRadiusForDegree(degree, depth);
      visualContext.beginPath();
      visualContext.arc(point.x, point.y, baseRadius + 6.5 * visual.radiusScale, 0, Math.PI * 2);
      visualContext.fillStyle = color;
      visualContext.globalAlpha = visual.alpha * depth * damping;
      visualContext.shadowColor = color;
      visualContext.shadowBlur = prefersReducedMotion ? 0 : 8 * visual.radiusScale;
      visualContext.fill();
      rendered += 1;
    });
  });
  visualContext.restore();
  state.performanceStats.ambientCommunityPulseCount = rendered;
}

function drawAmbientEdgeCurrents(width, height) {
  if (!state.projectedPoints.size || prefersReducedMotion) {
    state.performanceStats.ambientCurrentEdgeCount = 0;
    return;
  }
  const mode = activeMode();
  const edgeIds = mode === 'none'
    ? Array.from(state.ambientCurrentEdgeIds)
    : activeCurrentEdgeIds(ambientCurrentActiveEdgeLimit);
  if (!edgeIds.length) {
    state.performanceStats.ambientCurrentEdgeCount = 0;
    return;
  }
  const phase = state.ambientPhase || performance.now() * 0.001;
  const modeDamping = mode === 'none' ? 1 : 0.72;
  let rendered = 0;
  visualContext.save();
  visualContext.lineCap = 'round';
  visualContext.lineJoin = 'round';
  edgeIds.slice(0, mode === 'none' ? ambientCurrentIdleEdgeLimit : ambientCurrentActiveEdgeLimit).forEach((edgeId, index) => {
    const edge = state.edgeById.get(edgeId);
    const source = edge ? state.projectedPoints.get(edge.source) : null;
    const target = edge ? state.projectedPoints.get(edge.target) : null;
    if (!edge || !source || !target) {
      return;
    }
    const sourcePoint = ambientProjectedPoint(source, width, height);
    const targetPoint = ambientProjectedPoint(target, width, height);
    const control = curvedEdgeControl(edge, sourcePoint, targetPoint, 0.96);
    const visual = edgeCurrentVisual({ phase, edgeId, index, reducedMotion: prefersReducedMotion });
    const head = pointOnQuadratic(sourcePoint, control, targetPoint, visual.progress);
    const tailProgress = clamp(visual.progress - 0.055, 0, 1);
    const tail = pointOnQuadratic(sourcePoint, control, targetPoint, tailProgress);
    const color = colorForEdge(edge);

    visualContext.beginPath();
    visualContext.moveTo(tail.x, tail.y);
    visualContext.lineTo(head.x, head.y);
    visualContext.strokeStyle = color;
    visualContext.globalAlpha = visual.tailAlpha * modeDamping;
    visualContext.lineWidth = 0.95;
    visualContext.shadowColor = color;
    visualContext.shadowBlur = 6;
    visualContext.stroke();

    visualContext.beginPath();
    visualContext.arc(head.x, head.y, visual.radius, 0, Math.PI * 2);
    visualContext.fillStyle = color;
    visualContext.globalAlpha = visual.alpha * modeDamping;
    visualContext.shadowColor = 'rgba(218, 242, 255, 0.24)';
    visualContext.shadowBlur = 7;
    visualContext.fill();
    rendered += 1;
  });
  visualContext.restore();
  state.performanceStats.ambientCurrentEdgeCount = rendered;
}

function drawRecentSparks(width, height) {
  if (!state.ambientRecentNodeIds.size || !state.projectedPoints.size) {
    state.performanceStats.recentSparkCount = 0;
    return;
  }
  const mode = activeMode();
  if (mode !== 'none' && mode !== 'recent') {
    state.performanceStats.recentSparkCount = 0;
    return;
  }
  const phase = state.ambientPhase || performance.now() * 0.001;
  let rendered = 0;
  visualContext.save();
  Array.from(state.ambientRecentNodeIds).slice(0, ambientRecentNodeLimit).forEach((nodeId, index) => {
    const node = nodeForId(nodeId);
    const rawPoint = state.projectedPoints.get(nodeId);
    if (!node || !rawPoint) {
      return;
    }
    const visual = recentSparkVisual({
      phase,
      nodeId,
      index,
      reducedMotion: prefersReducedMotion
    });
    const point = ambientProjectedPoint(rawPoint, width, height);
    const depth = depthPresence(point.z);
    const baseRadius = nodeRadiusForDegree(state.degreeByNode.get(node.id) ?? 0, depth);
    const radius = baseRadius + 2.2 * visual.radiusScale;
    visualContext.beginPath();
    visualContext.arc(point.x, point.y, radius, 0, Math.PI * 2);
    visualContext.fillStyle = accentColorForCommunity(node.community);
    visualContext.globalAlpha = visual.alpha * (mode === 'recent' ? 0.78 : 0.52);
    visualContext.shadowColor = 'rgba(189, 250, 232, 0.24)';
    visualContext.shadowBlur = prefersReducedMotion ? 0 : 7 + visual.radiusScale * 2;
    visualContext.fill();
    rendered += 1;
  });
  visualContext.restore();
  state.performanceStats.recentSparkCount = rendered;
}

function drawAgentActivityOverlay(width, height) {
  if (!state.agentActivityRenderableEvents.length || !state.projectedPoints.size) {
    return;
  }
  const now = Date.now();
  visualContext.save();
  state.agentActivityRenderableEvents.forEach((event, index) => {
    if (!event.nodeId || event.pending) {
      return;
    }
    const node = nodeForId(event.nodeId);
    const rawPoint = state.projectedPoints.get(event.nodeId);
    if (!node || !rawPoint) {
      return;
    }
    const ageMs = Number.isFinite(event.timestampMs) ? Math.max(0, now - event.timestampMs) : index * 1000;
    const ageFade = clamp(1 - ageMs / 120000, 0.18, 1);
    const actionColor = agentActivityColor(event.action);
    const point = ambientProjectedPoint(rawPoint, width, height);
    const depth = depthPresence(point.z);
    const radius = nodeRadiusForDegree(state.degreeByNode.get(node.id) ?? 0, depth);
    const isFocus = event.action === 'focus';
    const isStrongAction = ['write', 'create', 'closeout', 'decision', 'focus'].includes(event.action);
    visualContext.beginPath();
    visualContext.arc(point.x, point.y, radius + (isStrongAction ? 11.5 : 9), 0, Math.PI * 2);
    visualContext.fillStyle = actionColor;
    visualContext.globalAlpha = (isStrongAction ? 0.11 : 0.075) * ageFade;
    visualContext.shadowColor = actionColor;
    visualContext.shadowBlur = prefersReducedMotion ? 0 : 18;
    visualContext.fill();
    visualContext.beginPath();
    visualContext.arc(point.x, point.y, radius + (isFocus ? 9.5 : 7.5), 0, Math.PI * 2);
    visualContext.strokeStyle = actionColor;
    visualContext.globalAlpha = (isFocus ? 0.72 : 0.54) * ageFade;
    visualContext.lineWidth = isFocus ? 2.35 : 1.85;
    visualContext.shadowColor = actionColor;
    visualContext.shadowBlur = prefersReducedMotion ? 0 : 14;
    visualContext.stroke();
    if (isStrongAction) {
      visualContext.beginPath();
      visualContext.arc(point.x, point.y, Math.max(radius + 1.8, 3.2), 0, Math.PI * 2);
      visualContext.fillStyle = actionColor;
      visualContext.globalAlpha = 0.36 * ageFade;
      visualContext.fill();
    }
  });
  visualContext.restore();
}

function drawWorkflowHighlightOverlay(width, height) {
  const highlight = state.workflowHighlight;
  if (!highlight?.nodeIds?.length || !state.projectedPoints.size) {
    return;
  }
  const nodeIds = new Set(highlight.nodeIds);
  visualContext.save();
  state.visibleEdges.forEach((edge) => {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      return;
    }
    const source = state.projectedPoints.get(edge.source);
    const target = state.projectedPoints.get(edge.target);
    if (!source || !target) {
      return;
    }
    visualContext.beginPath();
    visualContext.moveTo(source.x, source.y);
    visualContext.lineTo(target.x, target.y);
    visualContext.strokeStyle = 'rgba(126, 231, 203, 0.82)';
    visualContext.lineWidth = 2.2;
    visualContext.shadowColor = 'rgba(126, 231, 203, 0.72)';
    visualContext.shadowBlur = prefersReducedMotion ? 0 : 10;
    visualContext.stroke();
  });
  highlight.nodeIds.forEach((nodeId) => {
    const node = nodeForId(nodeId);
    const point = state.projectedPoints.get(nodeId);
    if (!node || !point) {
      return;
    }
    const radius = nodeRadiusForDegree(state.degreeByNode.get(node.id) ?? 0, depthPresence(point.z));
    visualContext.beginPath();
    visualContext.arc(point.x, point.y, radius + 12, 0, Math.PI * 2);
    visualContext.fillStyle = 'rgba(126, 231, 203, 0.14)';
    visualContext.fill();
    visualContext.beginPath();
    visualContext.arc(point.x, point.y, radius + 8, 0, Math.PI * 2);
    visualContext.strokeStyle = 'rgba(154, 246, 219, 0.96)';
    visualContext.lineWidth = 2;
    visualContext.stroke();
  });
  visualContext.restore();
}

function drawActiveVisualOverlay(hoverTrails, edgeTrails, hoverAmount, width, height) {
  const nodeFocus = buildNodeFocusMap(hoverTrails, edgeTrails);
  const highlightedEdges = buildHighlightedEdges(hoverTrails, edgeTrails, width, height);
  state.performanceStats.highlightedEdgeCount = highlightedEdges.length;
  const labelCandidates = [];
  if (hoverAmount > 0.01) {
    visualContext.save();
    visualContext.lineWidth = 0.72 + hoverAmount * 0.68;
    visualContext.lineCap = 'round';
    visualContext.lineJoin = 'round';
    visualContext.shadowColor = 'rgba(210, 222, 255, 0.22)';
    visualContext.shadowBlur = 8 * hoverAmount;
    highlightedEdges.forEach((edge) => {
      visualContext.globalAlpha = 0.14 + edge.intensity * 0.5;
      visualContext.strokeStyle = edge.color;
      visualContext.stroke(edge.path);
    });
    visualContext.restore();
  }

  nodeFocus.forEach((focusState, nodeId) => {
    const nodeIndex = state.nodeIndexById.get(nodeId);
    const node = state.visibleNodes[nodeIndex];
    const rawPoint = state.projectedPoints.get(nodeId);
    if (!node || !rawPoint) {
      return;
    }
    const point = ambientProjectedPoint(rawPoint, width, height);
    if (!point) {
      return;
    }
    const degree = state.degreeByNode.get(node.id) ?? 0;
    const isSelected = state.selectedNode?.id === node.id;
    const selfAmount = smoothstep(focusState.self);
    const neighborAmount = smoothstep(focusState.neighbor);
    const isHovered = selfAmount > 0.02;
    const isNeighbor = neighborAmount > 0.02;
    const depth = depthPresence(point.z);
    const baseRadius = isSelected ? nodeRadiusForDegree(degree, depth) * 1.18 : nodeRadiusForDegree(degree, depth);
    const radius = baseRadius + 1.8 * selfAmount + 0.8 * neighborAmount;
    const baseAlpha = 0.68 + depth * 0.22;
    const dimmedAlpha = hoverTrails.length && !isHovered && !isNeighbor ? baseAlpha - 0.42 * hoverAmount : baseAlpha;
    const alpha = dimmedAlpha + ((isHovered || isNeighbor) ? 0.12 * Math.max(selfAmount, neighborAmount) : 0);
    const fillColor = isSelected || isHovered || isNeighbor
      ? accentColorForCommunity(node.community)
      : colorForCommunity(node.community);
    const labelAmount = isSelected ? 1 : Math.max(selfAmount, neighborAmount * 0.82);

    if (isSelected || isHovered) {
      visualContext.save();
      visualContext.beginPath();
      visualContext.arc(point.x, point.y, radius + 2.4 + 3.2 * Math.max(selfAmount, 0.55), 0, Math.PI * 2);
      visualContext.fillStyle = accentColorForCommunity(node.community);
      visualContext.globalAlpha = isHovered ? 0.08 + selfAmount * 0.2 : 0.1;
      visualContext.shadowColor = 'rgba(214, 226, 255, 0.22)';
      visualContext.shadowBlur = 12 * Math.max(selfAmount, 0.55);
      visualContext.fill();
      visualContext.restore();
    }

    visualContext.beginPath();
    visualContext.arc(point.x, point.y, radius, 0, Math.PI * 2);
    visualContext.fillStyle = fillColor;
    visualContext.globalAlpha = isSelected || isHovered ? 1 : alpha;
    visualContext.fill();

    if (isSelected || isHovered) {
      visualContext.globalAlpha = 1;
      visualContext.lineWidth = isHovered ? 1.2 + selfAmount : 1.8;
      visualContext.strokeStyle = selectedStrokeColor;
      visualContext.stroke();
    }

    if (labelAmount > 0.14) {
      labelCandidates.push({
        node,
        point,
        radius,
        amount: labelAmount,
        isPrimary: isSelected || isHovered,
        degree,
        color: accentColorForCommunity(node.community)
      });
    }
  });

  drawActiveNodeLabels(labelCandidates, width, height);
  drawPathPulseOverlay(width, height);
}

function drawActiveNodeLabels(candidates, width, height) {
  if (!candidates.length) {
    return;
  }

  const maxLabels = labelBudgetForMode(activeMode(), {
    hasSelected: !!state.selectedNode,
    hasHover: !!state.hoveredNode || !!state.hoveredEdge
  });
  if (maxLabels <= 0) {
    return;
  }
  const placedLabels = [];
  const orderedCandidates = candidates
    .sort((left, right) => {
      const leftScore = (left.isPrimary ? 100 : 0) + left.amount * 12 + Math.log1p(left.degree);
      const rightScore = (right.isPrimary ? 100 : 0) + right.amount * 12 + Math.log1p(right.degree);
      return rightScore - leftScore;
    })
    .slice(0, maxLabels * 2);

  visualContext.save();
  visualContext.textBaseline = 'middle';
  orderedCandidates.forEach((candidate) => {
    if (placedLabels.length >= maxLabels) {
      return;
    }

    const label = compactNodeLabel(candidate.node.label);
    const fontSize = candidate.isPrimary ? 12.5 : 11;
    const alpha = clamp(candidate.amount, 0, 1);
    visualContext.font = `${candidate.isPrimary ? 700 : 600} ${fontSize}px -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif`;
    const metrics = visualContext.measureText(label);
    const horizontalPadding = candidate.isPrimary ? 9 : 7;
    const labelWidth = metrics.width + horizontalPadding * 2;
    const labelHeight = candidate.isPrimary ? 24 : 20;
    const preferredRight = candidate.point.x + candidate.radius + 10 + labelWidth < width - 10;
    const x = preferredRight
      ? candidate.point.x + candidate.radius + 10
      : candidate.point.x - candidate.radius - 10 - labelWidth;
    const y = clamp(candidate.point.y - candidate.radius - labelHeight * 0.35, 12, height - labelHeight - 12);
    const box = {
      x: clamp(x, 10, width - labelWidth - 10),
      y,
      width: labelWidth,
      height: labelHeight
    };

    if (placedLabels.some((placed) => rectanglesOverlap(placed, box))) {
      return;
    }
    placedLabels.push(box);

    visualContext.save();
    visualContext.globalAlpha = alpha;
    if (candidate.isPrimary) {
      visualContext.shadowColor = 'rgba(214, 226, 255, 0.18)';
      visualContext.shadowBlur = 12;
    }
    roundedRect(visualContext, box.x, box.y, box.width, box.height, 9);
    visualContext.fillStyle = candidate.isPrimary ? 'rgba(16, 20, 34, 0.82)' : 'rgba(10, 14, 25, 0.62)';
    visualContext.fill();
    visualContext.lineWidth = candidate.isPrimary ? 0.9 : 0.65;
    visualContext.strokeStyle = candidate.color;
    visualContext.globalAlpha = alpha * (candidate.isPrimary ? 0.62 : 0.38);
    visualContext.stroke();
    visualContext.globalAlpha = alpha * (candidate.isPrimary ? 0.96 : 0.72);
    visualContext.fillStyle = candidate.isPrimary ? '#eef3ff' : '#c4ccdc';
    visualContext.fillText(label, box.x + horizontalPadding, box.y + box.height / 2);
    visualContext.restore();
  });
  visualContext.restore();
}

function cachedOverlayEdges(cacheKey, entries) {
  const key = `${state.visualRevision}:${cacheKey}`;
  if (state.overlayCache.key === key) {
    return state.overlayCache.edges;
  }
  const highlightedEdges = [];
  entries.forEach((entry) => {
    const source = state.projectedPoints.get(entry.edge.source);
    const target = state.projectedPoints.get(entry.edge.target);
    if (!source || !target) {
      return;
    }
    const highlightedPath = new Path2D();
    addCurvedEdge(highlightedPath, entry.edge, source, target, entry.strength ?? 1);
    highlightedEdges.push({
      path: highlightedPath,
      color: entry.color,
      intensity: entry.intensity
    });
  });
  state.overlayCache = { key, edges: highlightedEdges };
  return highlightedEdges;
}

function buildHighlightedEdges(hoverTrails, edgeTrails, width, height) {
  const highlightedEdges = [];
  const seenEdges = new Set();
  if (state.pathMode) {
    if (state.pathOrderedEdgeIds.length) {
      return cachedOverlayEdges(
        `path:${state.activePathVariantId}:${state.pathOrderedEdgeIds.join('|')}`,
        pathOverlayEdges().map((edge, index) => ({
          edge,
          color: index === 0 ? '#f6f8ff' : '#aebdff',
          intensity: 1,
          strength: 1.04
        }))
      );
    }
    return highlightedEdges;
  }
  if (state.focusMode && state.focusEdgeIds.size) {
    const edges = focusOverlayEdges();
    return cachedOverlayEdges(
      `focus:${state.focusNodeId}:${state.focusDepth}:${edges.map((edge) => edge.id).join('|')}`,
      edges.map((edge) => ({
        edge,
        color: colorForEdge(edge),
        intensity: edge.source === state.focusNodeId || edge.target === state.focusNodeId ? 1 : 0.56
      }))
    );
  }
  if (state.communitySpotlightName && state.communitySpotlightEdgeIds.size) {
    const edges = communitySpotlightOverlayEdges();
    return cachedOverlayEdges(
      `community:${state.communitySpotlightName}:${edges.map((edge) => edge.id).join('|')}`,
      edges.map((edge) => ({
        edge,
        color: colorForCommunity(state.communitySpotlightName),
        intensity: 0.64,
        strength: 0.9
      }))
    );
  }
  if (state.recentOrbitMode && state.recentOrbitPathEdgeIds.size) {
    return cachedOverlayEdges(
      `recent:${state.recentOrbitActiveNodeId}:${state.recentOrbitTargetNodeId}:${state.recentOrbitOrderedEdgeIds.join('|')}`,
      recentOrbitOverlayEdges().map((edge, index) => ({
        edge,
        color: index === 0 ? '#f4f7ff' : '#9dd8ca',
        intensity: 0.82
      }))
    );
  }
  if (state.graphStoryMode && state.graphStoryEdgeIds.size) {
    const edges = graphStoryOverlayEdges();
    return cachedOverlayEdges(
      `story:${state.graphStoryStepIndex}:${edges.map((edge) => edge.id).join('|')}`,
      edges.map((edge) => ({
        edge,
        color: state.graphStoryActiveCommunityName ? colorForCommunity(state.graphStoryActiveCommunityName) : '#d8e6ff',
        intensity: 0.7,
        strength: 0.94
      }))
    );
  }
  if (state.searchRevealNodeId && state.searchRevealEdgeIds.size) {
    const edges = searchRevealOverlayEdges();
    return cachedOverlayEdges(
      `search:${state.searchRevealNodeId}:${edges.map((edge) => edge.id).join('|')}`,
      edges.map((edge) => ({
        edge,
        color: accentColorForCommunity(nodeForId(state.searchRevealNodeId)?.community ?? ''),
        intensity: 0.78
      }))
    );
  }
  if (state.selectedNode) {
    const linkedEdges = (state.edgesByNode.get(state.selectedNode.id) ?? [])
      .slice()
      .sort((left, right) => {
        const leftNeighborId = left.source === state.selectedNode.id ? left.target : left.source;
        const rightNeighborId = right.source === state.selectedNode.id ? right.target : right.source;
        return degreeForNode(rightNeighborId) - degreeForNode(leftNeighborId) || left.id.localeCompare(right.id);
      })
      .slice(0, selectedEdgeVisualLimit);
    return cachedOverlayEdges(
      `selected:${state.selectedNode.id}:${linkedEdges.map((edge) => edge.id).join('|')}`,
      linkedEdges.map((edge) => ({
        edge,
        color: accentColorForCommunity(state.selectedNode.community),
        intensity: 1
      }))
    );
  }
  hoverTrails.forEach((trail) => {
    const linkedEdges = state.edgesByNode.get(trail.node.id) ?? [];
    linkedEdges.forEach((edge) => {
      if (trail.intensity <= 0.02 || seenEdges.has(edge.id)) {
        return;
      }
      const source = state.projectedPoints.get(edge.source);
      const target = state.projectedPoints.get(edge.target);
      if (!source || !target) {
        return;
      }
      const highlightedPath = new Path2D();
      addCurvedEdge(
        highlightedPath,
        edge,
        ambientProjectedPoint(source, width, height),
        ambientProjectedPoint(target, width, height),
        1
      );
      highlightedEdges.push({
        path: highlightedPath,
        color: accentColorForCommunity(trail.node.community),
        intensity: smoothstep(trail.intensity)
      });
      seenEdges.add(edge.id);
    });
  });
  edgeTrails.forEach((trail) => {
    if (trail.intensity <= 0.02 || seenEdges.has(trail.edge.id)) {
      return;
    }
    const source = state.projectedPoints.get(trail.edge.source);
    const target = state.projectedPoints.get(trail.edge.target);
    if (!source || !target) {
      return;
    }
    const highlightedPath = new Path2D();
    addCurvedEdge(
      highlightedPath,
      trail.edge,
      ambientProjectedPoint(source, width, height),
      ambientProjectedPoint(target, width, height),
      1
    );
    highlightedEdges.push({
      path: highlightedPath,
      color: colorForEdge(trail.edge),
      intensity: smoothstep(trail.intensity)
    });
    seenEdges.add(trail.edge.id);
  });
  return highlightedEdges;
}

function pathOverlayEdges() {
  return state.pathOrderedEdgeIds
    .map((edgeId) => state.edgeById.get(edgeId))
    .filter(Boolean);
}

function pathEdgeRenderSegment(edge, index, width, height) {
  const renderedSource = state.projectedPoints.get(edge.source);
  const renderedTarget = state.projectedPoints.get(edge.target);
  if (!renderedSource || !renderedTarget) {
    return null;
  }
  const pathFrom = state.pathOrderedNodeIds[index];
  const pathTo = state.pathOrderedNodeIds[index + 1];
  return {
    sourcePoint: ambientProjectedPoint(renderedSource, width, height),
    targetPoint: ambientProjectedPoint(renderedTarget, width, height),
    reverse: edge.source === pathTo && edge.target === pathFrom
  };
}

function drawPathPulseOverlay(width, height) {
  if (!state.pathMode || !state.pathOrderedEdgeIds.length) {
    return;
  }
  const phase = prefersReducedMotion ? 0.5 : state.pathPulsePhase;
  visualContext.save();
  state.pathOrderedEdgeIds.forEach((edgeId, index) => {
    const edge = state.edgeById.get(edgeId);
    if (!edge) {
      return;
    }
    const segment = pathEdgeRenderSegment(edge, index, width, height);
    if (!segment) {
      return;
    }
    const control = curvedEdgeControl(edge, segment.sourcePoint, segment.targetPoint, 1.04);
    const pathT = prefersReducedMotion ? 0.5 : ((phase * 0.82 + index * 0.18) % 1);
    const pulseT = segment.reverse ? 1 - pathT : pathT;
    const pulse = pointOnQuadratic(segment.sourcePoint, control, segment.targetPoint, pulseT);
    const radius = prefersReducedMotion ? 3.4 : 3.2 + Math.sin((phase + index) * 3.2) * 0.8;
    visualContext.beginPath();
    visualContext.arc(pulse.x, pulse.y, radius + 4.5, 0, Math.PI * 2);
    visualContext.fillStyle = '#dfe8ff';
    visualContext.globalAlpha = prefersReducedMotion ? 0.16 : 0.18;
    visualContext.shadowColor = 'rgba(214, 226, 255, 0.5)';
    visualContext.shadowBlur = prefersReducedMotion ? 8 : 14;
    visualContext.fill();
    visualContext.beginPath();
    visualContext.arc(pulse.x, pulse.y, radius, 0, Math.PI * 2);
    visualContext.fillStyle = '#f7f9ff';
    visualContext.globalAlpha = 0.88;
    visualContext.fill();
  });
  visualContext.restore();
}

function drawLivingPulses(width, height) {
  if (!state.livingPulseEvents.length) {
    state.performanceStats.livingPulseCount = 0;
    return;
  }
  if (state.overlayQuality === 'low') {
    clearLivingPulses(false);
    return;
  }
  const now = performance.now();
  state.livingPulseEvents = pruneLivingPulses(state.livingPulseEvents, now, {
    reducedMotion: prefersReducedMotion
  });
  state.performanceStats.livingPulseCount = state.livingPulseEvents.length;
  if (!state.livingPulseEvents.length || prefersReducedMotion) {
    return;
  }

  visualContext.save();
  state.livingPulseEvents.forEach((pulse) => {
    const visual = pulseVisualState(pulse, now);
    if (visual.expired || visual.alpha <= 0.01) {
      return;
    }
    const origin = pulse.originNodeId ? nodeForId(pulse.originNodeId) : null;
    const pulseColor = origin ? accentColorForCommunity(origin.community) : '#dbe7ff';

    visualContext.lineCap = 'round';
    visualContext.lineJoin = 'round';
    visualContext.shadowColor = 'rgba(210, 226, 255, 0.24)';
    visualContext.shadowBlur = 12 * visual.alpha;
    visualContext.lineWidth = 0.8 + visual.alpha * 1.4;
    visualContext.strokeStyle = pulseColor;
    visualContext.globalAlpha = 0.08 + visual.alpha * 0.22;
    pulse.edgeIds.forEach((edgeId) => {
      const edge = state.edgeById.get(edgeId);
      const source = edge ? state.projectedPoints.get(edge.source) : null;
      const target = edge ? state.projectedPoints.get(edge.target) : null;
      if (!edge || !source || !target) {
        return;
      }
      const path = new Path2D();
      addCurvedEdge(path, edge, ambientProjectedPoint(source, width, height), ambientProjectedPoint(target, width, height), 0.94);
      visualContext.stroke(path);
    });

    pulse.nodeIds.forEach((nodeId) => {
      const node = nodeForId(nodeId);
      const rawPoint = state.projectedPoints.get(nodeId);
      if (!node || !rawPoint) {
        return;
      }
      const point = ambientProjectedPoint(rawPoint, width, height);
      const degree = state.degreeByNode.get(node.id) ?? 0;
      const depth = depthPresence(point.z);
      const baseRadius = nodeRadiusForDegree(degree, depth);
      const radius = baseRadius + 3.2 * visual.radiusScale;
      visualContext.beginPath();
      visualContext.arc(point.x, point.y, radius, 0, Math.PI * 2);
      visualContext.fillStyle = accentColorForCommunity(node.community);
      visualContext.globalAlpha = 0.04 + visual.alpha * 0.12;
      visualContext.fill();
      visualContext.beginPath();
      visualContext.arc(point.x, point.y, baseRadius + visual.radiusScale * 1.8, 0, Math.PI * 2);
      visualContext.strokeStyle = selectedStrokeColor;
      visualContext.globalAlpha = 0.14 + visual.alpha * 0.34;
      visualContext.lineWidth = 0.9 + visual.alpha * 0.8;
      visualContext.stroke();
    });
  });
  visualContext.restore();
}

function focusOverlayEdges() {
  const directEdges = [];
  const otherEdges = [];
  state.focusEdgeIds.forEach((edgeId) => {
    const edge = state.edgeById.get(edgeId);
    if (!edge) {
      return;
    }
    if (edge.source === state.focusNodeId || edge.target === state.focusNodeId) {
      directEdges.push(edge);
    } else {
      otherEdges.push(edge);
    }
  });
  return directEdges.concat(otherEdges).slice(0, 720);
}

function communitySpotlightOverlayEdges() {
  const directEdges = [];
  const bridgeEdges = [];
  state.communitySpotlightOverlayEdgeIds.forEach((edgeId) => {
    const edge = state.edgeById.get(edgeId);
    if (!edge) {
      return;
    }
    if (state.communitySpotlightNodeIds.has(edge.source) && state.communitySpotlightNodeIds.has(edge.target)) {
      directEdges.push(edge);
    } else {
      bridgeEdges.push(edge);
    }
  });
  return directEdges.concat(bridgeEdges).slice(0, 720);
}

function recentOrbitOverlayEdges() {
  return state.recentOrbitOrderedEdgeIds
    .map((edgeId) => state.edgeById.get(edgeId))
    .filter(Boolean);
}

function graphStoryOverlayEdges() {
  return Array.from(state.graphStoryEdgeIds)
    .map((edgeId) => state.edgeById.get(edgeId))
    .filter(Boolean)
    .slice(0, graphStoryEdgeLimit);
}

function searchRevealOverlayEdges() {
  return Array.from(state.searchRevealEdgeIds)
    .map((edgeId) => state.edgeById.get(edgeId))
    .filter(Boolean)
    .slice(0, searchRevealNeighborLimit);
}

function addCurvedEdge(path, edge, source, target, strength = 1) {
  const control = curvedEdgeControl(edge, source, target, strength);
  path.moveTo(source.x, source.y);
  path.quadraticCurveTo(control.x, control.y, target.x, target.y);
}

function curvedEdgeControl(edge, source, target, strength = 1) {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const length = Math.max(Math.hypot(dx, dy), 0.001);
  const bendSeed = hashString(edge.id || `${edge.source}:${edge.target}`);
  const sign = bendSeed % 2 === 0 ? 1 : -1;
  const bend = clamp(length * 0.075, 4, 34) * strength * sign;
  return {
    x: (source.x + target.x) / 2 + (-dy / length) * bend,
    y: (source.y + target.y) / 2 + (dx / length) * bend
  };
}

function depthPresence(projectedZ) {
  const distance = clamp((projectedZ + 1) / 2, 0, 1);
  return clamp(0.98 - distance * 0.2, 0.78, 0.98);
}

function nodeRadiusForDegree(degree, depth = 1) {
  return clamp(1.65 + Math.log1p(degree) * 0.9 + Math.sqrt(Math.max(degree, 0)) * 0.12, 1.65, 8.8) * depth;
}

function ambientProjectedPoint(point, width, height) {
  if (!state.ambientPhase || ambientMotionScale <= 0) {
    return point;
  }
  const seed = hashString(point.node.id);
  const phase = state.ambientPhase + (seed % 628) * 0.01;
  const depth = depthPresence(point.z);
  const interactionDamping = state.hoveredNode || state.selectedNode ? 0.58 : 1;
  const amplitude = ambientLocalAmplitude * depth * interactionDamping;
  return {
    ...point,
    x: point.x + Math.cos(phase * 0.88) * amplitude,
    y: point.y + Math.sin(phase * 0.7 + (seed % 97) * 0.013) * amplitude * 0.72
  };
}

function updateHoverTrails() {
  const hoveredNode = state.selectedNode ? null : state.hoveredNode;
  if (hoveredNode) {
    const current = state.hoverTrails.get(hoveredNode.id);
    state.hoverTrails.set(hoveredNode.id, {
      node: hoveredNode,
      intensity: current?.intensity ?? 0
    });
  }

  state.hoverTrails.forEach((trail, nodeId) => {
    const target = hoveredNode?.id === nodeId ? 1 : 0;
    const speed = target > trail.intensity ? 0.24 : 0.075;
    trail.intensity += (target - trail.intensity) * speed;
    if (target === 0 && trail.intensity < 0.025) {
      state.hoverTrails.delete(nodeId);
    }
  });

  return Array.from(state.hoverTrails.values());
}

function updateEdgeTrails() {
  const hoveredEdge = state.selectedNode ? null : state.hoveredEdge;
  if (hoveredEdge) {
    const current = state.edgeTrails.get(hoveredEdge.id);
    state.edgeTrails.set(hoveredEdge.id, {
      edge: hoveredEdge,
      intensity: current?.intensity ?? 0
    });
  }

  state.edgeTrails.forEach((trail, edgeId) => {
    const target = hoveredEdge?.id === edgeId ? 1 : 0;
    const speed = target > trail.intensity ? 0.22 : 0.08;
    trail.intensity += (target - trail.intensity) * speed;
    if (target === 0 && trail.intensity < 0.025) {
      state.edgeTrails.delete(edgeId);
    }
  });

  return Array.from(state.edgeTrails.values());
}

function buildNodeFocusMap(hoverTrails, edgeTrails) {
  const focus = new Map();
  if (state.pathMode) {
    if (state.pathNodeIds.size) {
      state.pathOrderedNodeIds.forEach((nodeId, index) => {
        const isEndpoint = index === 0 || index === state.pathOrderedNodeIds.length - 1;
        mergeNodeFocus(focus, nodeId, isEndpoint ? 1 : 0, isEndpoint ? 0 : 0.74);
      });
    } else {
      if (state.pathSourceId) {
        mergeNodeFocus(focus, state.pathSourceId, 1, 0);
      }
      if (state.pathTargetId) {
        mergeNodeFocus(focus, state.pathTargetId, 0.76, 0);
      }
    }
    return focus;
  }
  if (state.focusMode && state.focusNodeIds.size) {
    state.focusNodeIds.forEach((nodeId) => {
      const distance = state.focusNodeDistance.get(nodeId) ?? state.focusDepth;
      if (distance === 0) {
        mergeNodeFocus(focus, nodeId, 1, 0);
      } else {
        const neighborStrength = clamp(0.9 - (distance - 1) * 0.22, 0.36, 0.9);
        mergeNodeFocus(focus, nodeId, 0, neighborStrength);
      }
    });
    return focus;
  }
  if (state.communitySpotlightName && state.communitySpotlightNodeIds.size) {
    const focusNodeIds = state.communitySpotlightFocusNodeIds.size
      ? state.communitySpotlightFocusNodeIds
      : state.communitySpotlightNodeIds;
    focusNodeIds.forEach((nodeId) => {
      const node = nodeForId(nodeId);
      const degree = node ? degreeForNode(node.id) : 0;
      const amount = clamp(0.42 + Math.log1p(degree) * 0.08, 0.42, 0.82);
      mergeNodeFocus(focus, nodeId, state.selectedNode?.id === nodeId ? 1 : 0, amount);
    });
    return focus;
  }
  if (state.recentOrbitMode && state.recentOrbitNodeIds.size) {
    state.recentOrbitNodeIds.forEach((nodeId) => {
      const isActive = state.recentOrbitActiveNodeId === nodeId;
      const isTarget = state.recentOrbitTargetNodeId === nodeId;
      const isPath = state.recentOrbitPathNodeIds.has(nodeId);
      mergeNodeFocus(focus, nodeId, isActive || isTarget ? 1 : 0, isPath ? 0.82 : 0.58);
    });
    if (state.recentOrbitTargetNodeId) {
      mergeNodeFocus(focus, state.recentOrbitTargetNodeId, 0.9, 0);
    }
    state.recentOrbitPathNodeIds.forEach((nodeId) => {
      mergeNodeFocus(focus, nodeId, state.recentOrbitActiveNodeId === nodeId ? 1 : 0, 0.76);
    });
    return focus;
  }
  if (state.graphStoryMode && state.graphStoryNodeIds.size) {
    const focusNodeIds = state.graphStoryFocusNodeIds.size
      ? state.graphStoryFocusNodeIds
      : state.graphStoryNodeIds;
    focusNodeIds.forEach((nodeId) => {
      const node = nodeForId(nodeId);
      const degree = node ? degreeForNode(node.id) : 0;
      const isActive = state.graphStoryActiveNodeId === nodeId;
      const amount = clamp(0.48 + Math.log1p(degree) * 0.08, 0.48, 0.86);
      mergeNodeFocus(focus, nodeId, isActive ? 1 : 0, amount);
    });
    return focus;
  }
  if (state.searchRevealNodeId) {
    mergeNodeFocus(focus, state.searchRevealNodeId, 1, 0);
    state.searchRevealNeighborIds.forEach((nodeId) => {
      mergeNodeFocus(focus, nodeId, 0, 0.72);
    });
    return focus;
  }
  if (state.selectedNode) {
    mergeNodeFocus(focus, state.selectedNode.id, 1, 0);
    topNeighborsForNode(state.selectedNode.id, selectedNeighborVisualLimit).forEach((neighbor) => {
      mergeNodeFocus(focus, neighbor.id, 0, 0.78);
    });
    return focus;
  }
  state.agentActivityNodeIds.forEach((nodeId) => {
    mergeNodeFocus(focus, nodeId, 0.78, 0.28);
  });
  hoverTrails.forEach((trail) => {
    mergeNodeFocus(focus, trail.node.id, trail.intensity, 0);
    const neighbors = state.adjacencyByNode.get(trail.node.id) ?? new Set();
    neighbors.forEach((neighborId) => {
      mergeNodeFocus(focus, neighborId, 0, trail.intensity * 0.78);
    });
  });
  edgeTrails.forEach((trail) => {
    mergeNodeFocus(focus, trail.edge.source, 0, trail.intensity);
    mergeNodeFocus(focus, trail.edge.target, 0, trail.intensity);
  });
  return focus;
}

function mergeNodeFocus(focus, nodeId, self, neighbor) {
  const current = focus.get(nodeId) ?? { self: 0, neighbor: 0 };
  focus.set(nodeId, {
    self: Math.max(current.self, self),
    neighbor: Math.max(current.neighbor, neighbor)
  });
}

function updateHoverIntensity() {
  const target = state.hoveredNode || state.hoveredEdge ? 1 : 0;
  const delta = target - state.hoverIntensity;
  if (Math.abs(delta) < 0.012) {
    state.hoverIntensity = target;
    if (target === 0) {
      state.hoverVisualNode = null;
    }
    return;
  }
  state.hoverIntensity += delta * 0.18;
  requestRender();
}

function smoothstep(value) {
  const x = clamp(value, 0, 1);
  return x * x * (3 - 2 * x);
}

function requestRender() {
  if (state.animationFrame) {
    return;
  }
  state.animationFrame = requestAnimationFrame(() => {
    state.animationFrame = null;
    render();
  });
}

function markVisualCacheDirty() {
  state.paintedCountsSettled = false;
  state.visualCacheDirty = true;
  state.visualRevision += 1;
  state.projectedPointGrid = null;
  state.overlayCache = { key: '', edges: [] };
}

function startAmbientMotion() {
  if ((!ambientRuntimeEnabled && !edgeGlintsRuntimeEnabled) || prefersReducedMotion || state.ambientFrame || !state.visibleNodes.length) {
    return;
  }
  state.ambientFrame = requestAnimationFrame(ambientMotionTick);
}

function ambientMotionTick(timestamp) {
  state.ambientFrame = null;
  if (!ambientRuntimeEnabled && !edgeGlintsRuntimeEnabled) {
    return;
  }
  if (document.hidden || !state.visibleNodes.length) {
    return;
  }
  const mode = activeMode();
  const quiet = isInteractionQuiet(timestamp);
  if (!ambientRuntimeEnabled && (!quiet || mode !== 'none' || state.overlayQuality === 'low')) {
    startAmbientMotion();
    return;
  }
  const interval = !ambientRuntimeEnabled
    ? edgeGlintFrameInterval
    : (state.overlayQuality === 'low' || !quiet || mode !== 'none'
        ? ambientBusyFrameInterval
        : ambientIdleFrameInterval);
  if (timestamp - state.lastAmbientTimestamp >= interval) {
    state.lastAmbientTimestamp = timestamp;
    state.ambientPhase = timestamp * 0.001;
    renderVisualOverlay();
  }
  startAmbientMotion();
}

function renderSidebar() {
  renderNodeInfo(state.selectedNode);
  renderLegend();
  renderStats();
  renderSearchResults();
}

function graphEvidenceReport() {
  const evidence = window.BrainBarGraphEvidence;
  if (!evidence?.build) {
    return null;
  }
  if (state.evidenceReport) {
    return state.evidenceReport;
  }
  if (!state.evidenceInput) {
    return null;
  }
  state.evidenceNow = Date.now();
  state.evidenceReport = evidence.build(state.evidenceInput, { now: state.evidenceNow });
  state.evidenceInput = null;
  return state.evidenceReport;
}

function evidenceValueText3D(value) {
  if (value === undefined || value === null || value === '') return 'not specified';
  if (typeof value !== 'object') return String(value);
  const stable = (item) => {
    if (item === null || typeof item !== 'object') return item;
    return Array.isArray(item)
      ? item.map(stable)
      : Object.keys(item).sort().reduce((result, key) => {
          result[key] = stable(item[key]);
          return result;
        }, {});
  };
  return JSON.stringify(stable(value));
}

function proposalSubjectText3D(proposal) {
  const subject = proposal.subject || {};
  const summary = (values, label) => {
    const entries = values || [];
    const sample = entries.slice(0, 3).join(', ') || 'none';
    return `${label} (${entries.length}): ${sample}${entries.length > 3 ? ', …' : ''}`;
  };
  return `${summary(subject.nodeIds, 'Nodes')} · ${summary(subject.edgeIds, 'Edges')} · ${summary(subject.sourcePaths, 'Sources')}`;
}

function renderEvidenceRows3D(rows) {
  return rows
    .filter(([, value]) => value !== undefined && value !== null && String(value) !== '')
    .map(([label, value]) => `<p><strong>${escapeHTML(label)}</strong><span>${escapeHTML(value)}</span></p>`)
    .join('');
}

function renderEvidenceLinks3D(title, links) {
  const rows = links.length
    ? links.slice(0, 8).map((link) => `<p>${escapeHTML(link.sourceId || 'unknown')} → ${escapeHTML(link.targetId || 'unknown')} · ${escapeHTML(link.relation || link.context || 'link')} · ${escapeHTML(link.provenance || 'Unknown')}</p>`).join('')
    : '<p class="muted">None in the current graph.</p>';
  return `<section class="evidence-links"><h4>${escapeHTML(title)} (${links.length})</h4>${rows}</section>`;
}

function evidenceSignals3D(report, nodeId = '', edgeId = '') {
  return (report.proposals || []).filter((proposal) => (
    (proposal.subject?.nodeIds || []).map(String).includes(String(nodeId || '')) ||
    (proposal.subject?.edgeIds || []).map(String).includes(String(edgeId || ''))
  ));
}

function renderEvidenceNodePanel3D(node) {
  const report = graphEvidenceReport();
  const item = report?.nodeEvidenceById?.[String(node.id)];
  if (!item) return '';
  const signals = evidenceSignals3D(report, node.id);
  return `
    <section class="sidebar-section evidence-panel">
      <h4>Evidence</h4>
      <div class="sidebar-meta">${renderEvidenceRows3D([
        ['Community', item.community], ['Modified', item.mtime], ['Status', item.status], ['Category', item.category]
      ])}</div>
      ${renderEvidenceLinks3D('Incoming links', item.incoming || [])}
      ${renderEvidenceLinks3D('Outgoing links', item.outgoing || [])}
      <section class="evidence-links"><h4>Health signals (${signals.length})</h4>${signals.length
        ? signals.slice(0, 4).map((proposal) => `<p>${escapeHTML(proposal.severity || 'info')} · ${escapeHTML(evidenceValueText3D(proposal.evidence))}</p>`).join('')
        : '<p class="muted">No deterministic signals for this item.</p>'}</section>
  </section>`;
}

function evidenceItemForInspectedEdge3D(report, edge) {
  const direct = report?.edgeEvidenceById?.[String(edge?.id || '')];
  if (direct) return direct;
  const sourceId = String(evidenceEndpoint(edge?.source ?? edge?.from));
  const targetId = String(evidenceEndpoint(edge?.target ?? edge?.to));
  const relation = String(edge?.relation ?? edge?.type ?? '');
  const context = String(edge?.context ?? '');
  const sourceFile = String(edge?.source_file ?? edge?._source_file ?? edge?.sourceFile ?? '');
  return Object.values(report?.edgeEvidenceById || {})
    .filter((item) => (
      String(item.sourceId || '') === sourceId &&
      String(item.targetId || '') === targetId &&
      String(item.relation || '') === relation &&
      String(item.context || '') === context &&
      String(item.sourceFile || '') === sourceFile
    ))
    .sort((left, right) => String(left.id).localeCompare(String(right.id)))[0] || null;
}

function renderEvidenceEdgeInspector3D(edge) {
  const report = graphEvidenceReport();
  const item = evidenceItemForInspectedEdge3D(report, edge);
  if (!item) {
    return '<p class="muted italic">Connection evidence unavailable.</p>';
  }
  const source = report.nodeEvidenceById?.[String(item.sourceId)];
  const target = report.nodeEvidenceById?.[String(item.targetId)];
  const signals = evidenceSignals3D(report, '', item.id);
  return `
    <section class="sidebar-section evidence-panel">
      <div class="sidebar-section-header"><h3>Connection evidence</h3><span>read-only</span></div>
      <div class="sidebar-meta">${renderEvidenceRows3D([
        ['Link', `${item.sourceId} → ${item.targetId}`], ['Relationship', item.relation], ['Context', item.context], ['Provenance', item.provenance], ['Source', item.sourceFile],
        ['Source community', source?.community], ['Target community', target?.community], ['Source status', source?.status], ['Target status', target?.status]
      ])}</div>
      <section class="evidence-links"><h4>Health signals (${signals.length})</h4>${signals.length
        ? signals.slice(0, 4).map((proposal) => `<p>${escapeHTML(proposal.severity || 'info')} · ${escapeHTML(evidenceValueText3D(proposal.evidence))}</p>`).join('')
        : '<p class="muted">No deterministic signals for this connection.</p>'}</section>
      <div class="sidebar-actions"><button id="close-edge-evidence">Back to node</button></div>
    </section>`;
}

function showGraphHealthPanel3D() {
  const report = graphEvidenceReport();
  let panel = document.getElementById('graph-health-panel');
  if (!panel) {
    panel = document.createElement('section');
    panel.id = 'graph-health-panel';
    stage.appendChild(panel);
  }
  if (!report) {
    panel.innerHTML = '<button type="button" data-close-health>Close</button><h2>Graph Check</h2><p>Evidence is unavailable for this graph.</p>';
    panel.querySelector('[data-close-health]')?.addEventListener('click', () => { panel.hidden = true; });
    panel.hidden = false;
    return false;
  }
  const caveats = (report.caveats || []).map((caveat) => `<p class="evidence-caveat">${escapeHTML(caveat)}</p>`).join('');
  const allProposals = report.proposals || [];
  const visibleProposals = allProposals.slice(0, 100);
  const proposals = visibleProposals.map((proposal, index) => `
    <article class="evidence-proposal">
      <strong>${escapeHTML(proposal.severity || 'info')} · ${escapeHTML(proposal.category || proposal.rule?.id || 'proposal')}</strong>
      <p>${escapeHTML(evidenceValueText3D(proposal.evidence))}</p>
      <p class="muted">Rule ${escapeHTML(proposal.rule?.id || 'unknown')} v${escapeHTML(proposal.rule?.version || report.rulesVersion)} · threshold: ${escapeHTML(evidenceValueText3D(proposal.threshold?.rule))}</p>
      <p class="evidence-caveat">Caveat: ${escapeHTML(evidenceValueText3D(proposal.threshold?.caveat))}</p>
      <p class="muted">${escapeHTML(proposalSubjectText3D(proposal))}</p>
      <pre>${escapeHTML(proposal.preview?.text || '')}</pre>
      <button type="button" data-copy-proposal="${index}" ${proposal.preview?.text ? '' : 'disabled'}>Copy instruction</button>
    </article>`).join('') || '<p class="muted">No deterministic proposals.</p>';
  const proposalCount = allProposals.length > visibleProposals.length
    ? `<p class="evidence-caveat">Showing ${visibleProposals.length} of ${allProposals.length} proposals.</p>`
    : '';
  panel.innerHTML = `
    <button type="button" data-close-health>Close</button>
    <h2>Graph Check</h2>
    <p>Read-only evidence schema ${escapeHTML(report.schemaVersion)} · rules ${escapeHTML(report.rulesVersion)}.</p>
    ${caveats}
    ${proposalCount}
    <div class="evidence-proposals">${proposals}</div>`;
  panel.querySelector('[data-close-health]')?.addEventListener('click', () => { panel.hidden = true; });
  panel.querySelectorAll('[data-copy-proposal]').forEach((button) => {
    button.addEventListener('click', () => {
      const proposal = report.proposals?.[Number(button.dataset.copyProposal)];
      if (proposal?.preview?.text) {
        navigator.clipboard?.writeText(proposal.preview.text);
      }
    });
  });
  panel.hidden = false;
  return true;
}

function renderNodeInfo(node) {
  if (state.inspectedEdge) {
    nodeInfo.innerHTML = renderEvidenceEdgeInspector3D(state.inspectedEdge);
    document.getElementById('close-edge-evidence')?.addEventListener('click', () => {
      state.inspectedEdge = null;
      renderNodeInfo(state.selectedNode);
    });
    return;
  }
  if (!node) {
    nodeInfo.innerHTML = state.communitySpotlightName
      ? renderCommunitySpotlightPanel()
      : state.recentOrbitMode
      ? renderRecentOrbitPanel()
      : state.graphStoryMode
      ? renderGraphStoryPanel()
      : `
        <section class="sidebar-section context-empty">
          <div class="sidebar-section-header">
            <h3>Start exploring</h3>
            <span>3D</span>
          </div>
          <div class="sidebar-entry-list">
            ${renderGraphStoryEntry()}
            ${renderRecentOrbitEntry()}
            ${renderAgentActivityPanel()}
          </div>
          <p class="muted italic">Click a node to inspect it</p>
        </section>
      `;
    wireCommunitySpotlightPanel();
    wireRecentOrbitPanel();
    wireGraphStoryPanel();
    wireAgentActivityPanel();
    return;
  }

  const source = node.sourceFile || '';
  const sourceButton = source
    ? '<button class="primary-button" id="open-note">Open Note</button>'
    : '';
  const isFocused = state.focusMode && state.focusNodeId === node.id;
  const focusStatus = state.focusMode
    ? `<p class="focus-status">Focused · depth ${state.focusDepth} · ${state.focusNodeIds.size} notes</p>`
    : '';
  const pathStatus = state.pathMode && !state.pathTargetId && state.pathSourceId
    ? '<p class="focus-status">Path source set · click another node to trace</p>'
    : '';
  const revealStatus = state.searchRevealNodeId === node.id
    ? `<p class="focus-status">Revealed from search · ${state.searchRevealNeighborIds.size} visible neighbors</p>`
    : '';
  const topNeighbors = topNeighborsForNode(node.id, 12);
  nodeInfo.innerHTML = `
    <section class="sidebar-section node-summary">
      <div class="sidebar-section-header">
        <h3>${escapeHTML(node.label)}</h3>
        <span>${degreeForNode(node.id)} links</span>
      </div>
      ${sourceButton ? `<div class="sidebar-actions primary-actions">${sourceButton}</div>` : ''}
      <div class="focus-actions sidebar-actions">
        <button id="focus-orbit" class="${isFocused ? 'selected' : ''}">Focus</button>
        <button data-depth="1" ${state.focusDepth === 1 && isFocused ? 'class="selected"' : ''}>Depth 1</button>
        <button data-depth="2" ${state.focusDepth === 2 && isFocused ? 'class="selected"' : ''}>Depth 2</button>
        <button data-depth="3" ${state.focusDepth === 3 && isFocused ? 'class="selected"' : ''}>Depth 3</button>
        <button id="back-to-all" ${state.focusMode || state.pathMode || state.recentOrbitMode || state.graphStoryMode || state.searchRevealNodeId ? '' : 'disabled'}>Back to all</button>
      </div>
      <div class="path-actions sidebar-actions">
        <button id="start-path" class="${state.pathSourceId === node.id && !state.pathTargetId ? 'selected' : ''}">Start path</button>
        <button id="clear-path" ${state.pathMode ? '' : 'disabled'}>Clear path</button>
      </div>
      ${focusStatus}
      ${pathStatus}
      ${revealStatus}
      <div class="sidebar-meta">
        <p><strong>Type</strong><span>${escapeHTML(node.type ?? node.file_type ?? 'document')}</span></p>
        <p><strong>Community</strong><span>${escapeHTML(node.community)}</span></p>
        ${source ? `<p><strong>Source</strong><span>${escapeHTML(source)}</span></p>` : ''}
      </div>
      ${renderEvidenceNodePanel3D(node)}
    </section>
    ${state.communitySpotlightName ? renderCommunitySpotlightPanel() : ''}
    ${state.recentOrbitMode ? renderRecentOrbitPanel() : ''}
    ${state.graphStoryMode ? renderGraphStoryPanel() : ''}
    ${renderAgentActivityPanel()}
    ${renderPathPanel()}
    <section class="sidebar-section neighbor-section">
      <div class="sidebar-section-header">
        <h4>Top neighbors</h4>
        <span>${topNeighbors.length}</span>
      </div>
      <div class="neighbor-list">
        ${topNeighbors.length
          ? topNeighbors.map((neighbor) => `<button class="neighbor-button sidebar-row" data-node-id="${escapeHTML(neighbor.id)}">${escapeHTML(neighbor.label)}<span>${neighbor.degree}</span></button>`).join('')
          : '<p class="muted">No neighbors in this view.</p>'}
      </div>
    </section>
  `;

  const button = document.getElementById('open-note');
  if (button) {
    button.addEventListener('click', () => sendNodeAction('openNode', node));
  }
  document.getElementById('focus-orbit')?.addEventListener('click', () => applyFocusOrbit(node, state.focusDepth || 1));
  nodeInfo.querySelectorAll('button[data-depth]').forEach((depthButton) => {
    depthButton.addEventListener('click', () => {
      const depth = Number(depthButton.dataset.depth) || 1;
      applyFocusOrbit(node, depth, depth === 1 || !state.focusMode);
    });
  });
  document.getElementById('back-to-all')?.addEventListener('click', () => backToAll());
  document.getElementById('start-path')?.addEventListener('click', () => armPathSource(node));
  document.getElementById('clear-path')?.addEventListener('click', () => clearPathMode(true));
  wireCommunitySpotlightPanel();
  wireRecentOrbitPanel();
  wireGraphStoryPanel();
  wireAgentActivityPanel();
  nodeInfo.querySelectorAll('.path-step[data-node-id]').forEach((pathButton) => {
    pathButton.addEventListener('click', () => {
      const pathNode = nodeForId(pathButton.dataset.nodeId);
      if (pathNode) {
        selectNode(pathNode, true, { preservePath: true });
      }
    });
  });
  nodeInfo.querySelectorAll('.path-variant[data-variant-id]').forEach((variantButton) => {
    variantButton.addEventListener('click', () => applyPathVariant(variantButton.dataset.variantId));
  });
  nodeInfo.querySelectorAll('.neighbor-button[data-node-id]').forEach((neighborButton) => {
    neighborButton.addEventListener('click', () => {
      const neighbor = nodeForId(neighborButton.dataset.nodeId);
      if (neighbor) {
        if (state.pathMode && state.pathSourceId && !state.pathTargetId) {
          applyPathToNode(neighbor);
        } else {
          applyFocusOrbit(neighbor, state.focusMode ? state.focusDepth : 1);
        }
      }
    });
  });
}

function renderCommunitySpotlightPanel() {
  const spotlight = state.communitySpotlightSummary;
  if (!spotlight) {
    return '';
  }
  const topButtons = spotlight.topNodes.map((item, index) => `
    <button class="spotlight-node" data-node-id="${escapeHTML(item.id)}">
      <span>${index + 1}</span>${escapeHTML(item.label)}<small>${item.degree}</small>
    </button>
  `).join('');
  const bridgeButtons = spotlight.bridgeNodes.map((item) => `
    <button class="spotlight-node" data-node-id="${escapeHTML(item.id)}">
      <span>*</span>${escapeHTML(item.label)}<small>${item.bridgeCount} bridge ${item.bridgeCount === 1 ? 'edge' : 'edges'}</small>
    </button>
  `).join('');
  return `
    <section class="spotlight-panel">
      <div class="spotlight-heading">
        <div>
          <h4>Community Spotlight</h4>
          <p>${escapeHTML(spotlight.name)} · ${spotlight.nodeCount} notes · ${spotlight.edgeCount} internal edges</p>
        </div>
        <button id="clear-spotlight">Clear</button>
      </div>
      <p class="spotlight-summary">${escapeHTML(spotlight.summary)}</p>
      <h5>Top notes</h5>
      <div class="spotlight-list">${topButtons || '<p class="muted">No notes in this community.</p>'}</div>
      <h5>Bridge notes</h5>
      <div class="spotlight-list">${bridgeButtons || '<p class="muted">No visible bridge notes.</p>'}</div>
    </section>
  `;
}

function wireCommunitySpotlightPanel() {
  document.getElementById('clear-spotlight')?.addEventListener('click', () => clearCommunitySpotlight(true));
  nodeInfo.querySelectorAll('.spotlight-node[data-node-id]').forEach((button) => {
    button.addEventListener('click', () => {
      const node = nodeForId(button.dataset.nodeId);
      if (node) {
        selectNode(node, true, { preserveCommunitySpotlight: true });
      }
    });
  });
}

function renderRecentOrbitEntry() {
  const items = recentOrbitVisibleItems(recentOrbitNodeLimit);
  if (!items.length) {
    return '';
  }
  return `
    <button class="sidebar-command" id="start-recent-orbit">
      <span class="sidebar-command-icon recent">R</span>
      <span class="sidebar-command-copy">
        <strong>Recent Orbit</strong>
        <small>${items.length} recently changed notes</small>
      </span>
      <span class="sidebar-command-chevron">&gt;</span>
    </button>
  `;
}

function renderRecentOrbitPanel() {
  const items = state.recentOrbitItems.length
    ? state.recentOrbitItems
    : recentOrbitVisibleItems(recentOrbitNodeLimit);
  const activeNode = nodeForId(state.recentOrbitActiveNodeId);
  const targetNode = nodeForId(state.recentOrbitTargetNodeId);
  const pathText = targetNode && state.recentOrbitOrderedNodeIds.length
    ? `${Math.max(state.recentOrbitOrderedNodeIds.length - 1, 0)} steps to ${targetNode.label}`
    : state.recentOrbitMessage || 'No visible path to a key note in current view';
  const itemButtons = items.slice(0, recentOrbitPanelLimit).map((item, index) => `
    <button class="recent-orbit-node ${item.id === state.recentOrbitActiveNodeId ? 'selected' : ''}" data-node-id="${escapeHTML(item.id)}">
      <span>${index + 1}</span>
      <strong>${escapeHTML(item.label)}</strong>
      <small>${escapeHTML(formatRecentTimestamp(item.timestamp))}</small>
    </button>
  `).join('');

  return `
    <section class="recent-orbit-panel">
      <div class="recent-orbit-heading">
        <div>
          <h4>Recent Orbit</h4>
          <p>${items.length} recent notes · ${escapeHTML(activeNode?.label || 'No active note')}</p>
        </div>
        <button id="clear-recent-orbit">Back to all</button>
      </div>
      <p class="recent-orbit-summary">${escapeHTML(pathText)}</p>
      <div class="recent-orbit-list">${itemButtons || '<p class="muted">No recent metadata in current view.</p>'}</div>
    </section>
  `;
}

function wireRecentOrbitPanel() {
  document.getElementById('start-recent-orbit')?.addEventListener('click', () => applyRecentOrbit());
  document.getElementById('clear-recent-orbit')?.addEventListener('click', () => clearRecentOrbit(true));
  nodeInfo.querySelectorAll('.recent-orbit-node[data-node-id]').forEach((button) => {
    button.addEventListener('click', () => {
      const node = nodeForId(button.dataset.nodeId);
      if (node) {
        applyRecentOrbit(node.id, true);
      }
    });
  });
}

function renderAgentActivityPanel() {
  const events = state.agentActivityEvents.slice(0, 3);
  const pending = state.agentActivityPendingPaths;
  if (!events.length && !pending.length) {
    return '';
  }
  const eventRows = events.map((event) => {
    const label = event.label || event.path || event.nodeId || 'Unmapped activity';
    const mapped = event.nodeId && !event.pending;
    const brand = agentActivityBrand(event.agent);
    return `
      <button class="agent-activity-row" data-node-id="${escapeHTML(event.nodeId || '')}" data-source-file="${escapeHTML(event.sourceFile || event.path || '')}" ${mapped ? '' : 'disabled'}>
        <span class="agent-brand ${escapeHTML(brand.key)}" title="${escapeHTML(brand.label)}">${brand.icon ? `<img src="${escapeHTML(brand.icon)}" alt="${escapeHTML(brand.label)}">` : escapeHTML(brand.mark)}</span>
        <span class="agent-activity-copy">
          <strong>${escapeHTML(label)}</strong>
          <small>${escapeHTML(brand.label)} · ${escapeHTML(event.action || 'activity')}</small>
        </span>
      </button>
    `;
  }).join('');
  const pendingSummary = pending.length
    ? `<button class="sidebar-command compact agent-pending-summary" disabled>
        <span class="sidebar-command-icon pending">!</span>
        <span class="sidebar-command-copy">
          <strong>Pending graph refresh</strong>
          <small>${pending.length} ${pending.length === 1 ? 'path' : 'paths'} not in graph yet</small>
        </span>
      </button>`
    : '';
  return `
    <section class="agent-activity-panel">
      <div class="agent-activity-heading">
        <h4>Agent Activity</h4>
        <span>${events.length} recent</span>
      </div>
      <div class="agent-activity-list">${eventRows || '<p class="muted">No mapped events yet.</p>'}</div>
      ${pendingSummary}
    </section>
  `;
}

function wireAgentActivityPanel() {
  nodeInfo.querySelectorAll('.agent-activity-row[data-node-id]').forEach((button) => {
    button.addEventListener('click', () => {
      const node = nodeForId(button.dataset.nodeId);
      if (node) {
        selectNode(node, true);
      }
    });
  });
}

function renderGraphStoryEntry() {
  const steps = graphStoryVisibleSteps();
  if (!steps.length) {
    return '';
  }
  return `
    <button class="sidebar-command primary" id="start-graph-story">
      <span class="sidebar-command-icon story">G</span>
      <span class="sidebar-command-copy">
        <strong>Graph Story</strong>
        <small>${steps.length} guided steps through this graph</small>
      </span>
      <span class="sidebar-command-chevron">&gt;</span>
    </button>
  `;
}

function renderGraphStoryPanel() {
  const step = currentGraphStoryStep();
  if (!step) {
    return `
      <section class="graph-story-panel">
        <div class="graph-story-heading">
          <div>
            <h4>Graph Story</h4>
            <p>No story steps in current view.</p>
          </div>
          <button id="clear-graph-story">Exit tour</button>
        </div>
      </section>
    `;
  }
  const canGoBack = state.graphStoryStepIndex > 0;
  const canGoNext = state.graphStoryStepIndex < state.graphStorySteps.length - 1;
  const story = graphStoryPresentation(step, {
    stepIndex: state.graphStoryStepIndex,
    totalSteps: state.graphStorySteps.length,
    activeNodeId: state.graphStoryActiveNodeId,
    previewLimit: graphStoryPreviewLimit
  });
  const activeNode = story.primary?.id ? nodeForId(story.primary.id) : null;
  const openDisabled = activeNode?.sourceFile ? '' : 'disabled';
  const focusDisabled = activeNode ? '' : 'disabled';
  const primaryButton = story.primary
    ? `<button class="graph-story-primary-node" data-node-id="${escapeHTML(story.primary.id)}">
        <span>Start here</span>
        <strong>${escapeHTML(story.primary.label)}</strong>
        <small>${escapeHTML(story.primary.detail || '')}</small>
      </button>`
    : '<p class="muted">No primary note for this step.</p>';
  const supportingButtons = story.supportingItems.map((item) => `
    <button class="graph-story-support-node" data-node-id="${escapeHTML(item.id)}">
      <strong>${escapeHTML(item.label)}</strong>
      <small>${escapeHTML(item.detail || '')}</small>
    </button>
  `).join('');
  return `
    <section class="graph-story-panel">
      <div class="graph-story-heading">
        <div>
          <h4>Graph Story</h4>
          <p>${escapeHTML(story.eyebrow)}</p>
        </div>
        <button id="clear-graph-story">Exit tour</button>
      </div>
      <div class="graph-story-copy">
        <h3>${escapeHTML(story.title)}</h3>
        <p>${escapeHTML(story.summary || state.graphStoryMessage || '')}</p>
        <p class="graph-story-takeaway">${escapeHTML(story.takeaway)}</p>
      </div>
      <div class="graph-story-primary">${primaryButton}</div>
      <div class="graph-story-actions">
        <button id="graph-story-focus-note" ${focusDisabled}>Focus note</button>
        <button id="graph-story-open-note" ${openDisabled}>Open note</button>
      </div>
      <div class="graph-story-controls">
        <button id="graph-story-back" ${canGoBack ? '' : 'disabled'}>Back</button>
        <button id="graph-story-next" ${canGoNext ? '' : 'disabled'}>Next</button>
      </div>
      ${supportingButtons ? `<div class="graph-story-supporting"><h5>Also highlighted</h5>${supportingButtons}</div>` : ''}
    </section>
  `;
}

function wireGraphStoryPanel() {
  document.getElementById('start-graph-story')?.addEventListener('click', () => startGraphStory());
  document.getElementById('clear-graph-story')?.addEventListener('click', () => clearGraphStory(true));
  document.getElementById('graph-story-back')?.addEventListener('click', () => applyGraphStoryStep(state.graphStoryStepIndex - 1));
  document.getElementById('graph-story-next')?.addEventListener('click', () => applyGraphStoryStep(state.graphStoryStepIndex + 1));
  document.getElementById('graph-story-focus-note')?.addEventListener('click', () => {
    const node = nodeForId(state.graphStoryActiveNodeId);
    if (node) {
      applyFocusOrbit(node, state.focusDepth || 1);
    }
  });
  document.getElementById('graph-story-open-note')?.addEventListener('click', () => {
    const node = nodeForId(state.graphStoryActiveNodeId);
    if (node) {
      sendNodeAction('openNode', node);
    }
  });
  nodeInfo.querySelectorAll('.graph-story-primary-node[data-node-id], .graph-story-support-node[data-node-id]').forEach((button) => {
    button.addEventListener('click', () => {
      activateGraphStoryNode(button.dataset.nodeId);
    });
  });
}

function renderPathPanel() {
  if (!state.pathMode) {
    return '';
  }
  const source = nodeForId(state.pathSourceId);
  const target = nodeForId(state.pathTargetId);
  const activeVariant = activePathVariant();
  const hasPath = state.pathOrderedNodeIds.length > 0;
  const title = hasPath ? (activeVariant?.label || 'Shortest path') : 'Path';
  const summary = hasPath
    ? `${Math.max(state.pathOrderedNodeIds.length - 1, 0)} steps · ${escapeHTML(source?.label || 'Source')} → ${escapeHTML(target?.label || 'Target')}`
    : escapeHTML(state.pathMessage || 'Select target');
  const steps = state.pathOrderedNodeIds.slice(0, 9).map((nodeId, index) => {
    const node = nodeForId(nodeId);
    const label = node?.label || nodeId;
    return `<button class="path-step" data-node-id="${escapeHTML(nodeId)}"><span>${index + 1}</span>${escapeHTML(label)}</button>`;
  }).join('');
  const overflow = state.pathOrderedNodeIds.length > 9
    ? `<p class="muted">+${state.pathOrderedNodeIds.length - 9} more steps</p>`
    : '';
  const explanation = hasPath
    ? explainShortestPath({
        orderedNodeIds: state.pathOrderedNodeIds,
        orderedEdgeIds: state.pathOrderedEdgeIds,
        nodes: state.visibleNodes,
        edges: state.visibleEdges,
        lens: state.lens,
        degreeByNode: state.degreeByNode
      })
    : null;
  return `
    <section class="path-panel">
      <h4>${title}</h4>
      <p>${summary}</p>
      ${hasPath ? renderPathCompare(activeVariant) : renderNoPathHint(source, target)}
      ${steps ? `<div class="path-step-list">${steps}${overflow}</div>` : ''}
      ${renderPathExplanation(explanation)}
    </section>
  `;
}

function renderPathCompare(activeVariant) {
  if (!state.pathTargetId || state.pathVariants.length <= 1 || !state.pathVariants.some((variant) => variant.found)) {
    return '';
  }
  const buttons = state.pathVariants.map((variant) => {
    const classes = ['path-variant'];
    if (variant.id === activeVariant?.id) {
      classes.push('selected');
    }
    const disabled = variant.found && !variant.sameAs ? '' : 'disabled';
    const detail = variant.sameAs
      ? variant.message
      : variant.found
      ? `${variant.stepCount} ${variant.stepCount === 1 ? 'step' : 'steps'}`
      : variant.message;
    return `
      <button class="${classes.join(' ')}" data-variant-id="${escapeHTML(variant.id)}" ${disabled}>
        <span>${escapeHTML(variant.label)}</span>
        <small>${escapeHTML(detail)}</small>
      </button>
    `;
  }).join('');
  return `
    <div class="path-compare">
      <h5>Compare paths</h5>
      <div class="path-variant-list">${buttons}</div>
    </div>
  `;
}

function renderNoPathHint(source, target) {
  if (!target) {
    return '';
  }
  const sourceDegree = source ? degreeForNode(source.id) : 0;
  const targetDegree = target ? degreeForNode(target.id) : 0;
  const lensName = state.lens === 'all' ? 'All' : (state.lens === 'graphify' ? 'Graphify' : 'Wikilinks');
  const reason = state.lens === 'all'
    ? 'These notes appear to live in different disconnected groups of the visible graph.'
    : `The ${lensName} view may be hiding the bridge between these notes.`;
  return `
    <div class="path-empty">
      <h5>No route found</h5>
      <p>${escapeHTML(reason)}</p>
      <ul>
        <li>${escapeHTML(source?.label || 'Source')} has ${sourceDegree} visible ${sourceDegree === 1 ? 'connection' : 'connections'}.</li>
        <li>${escapeHTML(target.label || 'Target')} has ${targetDegree} visible ${targetDegree === 1 ? 'connection' : 'connections'}.</li>
        <li>Try a direct neighbor, switch lens, or return to All before tracing again.</li>
      </ul>
    </div>
  `;
}

function renderPathExplanation(explanation) {
  if (!explanation) {
    return '';
  }
  const badges = explanation.badges?.length
    ? `<div class="path-explain-badges">${explanation.badges.map((badge) => `<span>${escapeHTML(badge)}</span>`).join('')}</div>`
    : '';
  const bullets = explanation.bullets?.length
    ? `<ul>${explanation.bullets.map((bullet) => `<li>${escapeHTML(bullet)}</li>`).join('')}</ul>`
    : '';
  const caveat = explanation.caveat
    ? `<p class="muted">${escapeHTML(explanation.caveat)}</p>`
    : '';
  return `
    <div class="path-explanation">
      <h5>${escapeHTML(explanation.title || 'Why this path')}</h5>
      <p>${escapeHTML(explanation.summary || '')}</p>
      ${badges}
      ${bullets}
      ${caveat}
    </div>
  `;
}

function topNeighborsForNode(nodeId, limit = 12) {
  const edges = state.edgesByNode.get(nodeId) || [];
  const seen = new Set();
  return edges
    .map((edge) => edge.source === nodeId ? edge.target : edge.source)
    .filter((neighborId) => {
      if (seen.has(neighborId)) {
        return false;
      }
      seen.add(neighborId);
      return true;
    })
    .map((neighborId) => nodeForId(neighborId))
    .filter(Boolean)
    .sort((left, right) => degreeForNode(right.id) - degreeForNode(left.id) || left.label.localeCompare(right.label))
    .slice(0, limit)
    .map((neighbor) => ({
      id: neighbor.id,
      label: neighbor.label,
      degree: degreeForNode(neighbor.id)
    }));
}

function renderLegend() {
  legend.innerHTML = '';
  const visibleCommunities = state.legendExpanded
    ? state.communities.slice(0, expandedCommunityLimit)
    : state.communities.slice(0, collapsedCommunityLimit);
  const summary = document.createElement('div');
  summary.className = 'legend-summary';
  summary.innerHTML = `
    <span>${state.legendExpanded ? `Showing ${visibleCommunities.length}` : `Top ${visibleCommunities.length}`} of ${state.communities.length}</span>
    ${state.communities.length > collapsedCommunityLimit
      ? `<button id="legend-toggle">${state.legendExpanded ? 'Show less' : 'Show all'}</button>`
      : ''}
  `;
  legend.appendChild(summary);
  summary.querySelector('#legend-toggle')?.addEventListener('click', () => {
    state.legendExpanded = !state.legendExpanded;
    renderLegend();
  });

  visibleCommunities.forEach((community) => {
    const row = document.createElement('div');
    row.className = `legend-item ${state.communitySpotlightName === community.name || state.graphStoryActiveCommunityName === community.name ? 'spotlighted' : ''}`;
    row.innerHTML = `
      <input type="checkbox" ${state.communityEnabled.has(community.name) ? 'checked' : ''}>
      <button class="legend-label community-spotlight-button" data-community-name="${escapeHTML(community.name)}"><span class="color-dot" style="background:${community.color}"></span> ${escapeHTML(community.name)}</button>
      <span class="legend-count">${community.count}</span>
    `;
    row.querySelector('input').addEventListener('change', (event) => {
      if (event.target.checked) {
        state.communityEnabled.add(community.name);
      } else {
        state.communityEnabled.delete(community.name);
      }
      applyLens(false);
    });
    row.querySelector('.community-spotlight-button')?.addEventListener('click', () => {
      if (state.communitySpotlightName === community.name) {
        clearCommunitySpotlight(true);
      } else {
        applyCommunitySpotlight(community.name);
      }
    });
    legend.appendChild(row);
  });
  if (state.legendExpanded && state.communities.length > expandedCommunityLimit) {
    const overflow = document.createElement('p');
    overflow.className = 'legend-overflow muted';
    overflow.textContent = `+${state.communities.length - expandedCommunityLimit} more communities hidden for performance`;
    legend.appendChild(overflow);
  }
}

function renderStats() {
  const visibleCommunityCount = new Set(state.visibleNodes.map((node) => node.community)).size;
  stats.textContent = `${state.visibleNodes.length} nodes · ${state.visibleEdges.length} edges · ${visibleCommunityCount} communities`;
}

function renderSearchResults() {
  const query = search.value.trim();
  searchResults.innerHTML = '';
  if (!query) {
    state.searchResultIds = [];
    return;
  }
  const activityNodeIds = new Set(state.agentActivityEvents.map((event) => event.nodeId).filter(Boolean));
  const results = searchGraphNodes({
    query,
    nodes: state.graph?.nodes.map((node) => ({
      ...node,
      __brainBarAgentActive: activityNodeIds.has(node.id)
    })) || [],
    limit: searchResultLimit
  });
  state.searchResultIds = results.map((result) => result.id);
  results
    .forEach((result) => {
      const node = result.node;
      const hiddenReason = hiddenSearchResultReason(node);
      const button = document.createElement('button');
      button.className = 'search-item';
      button.innerHTML = `
        <span>${escapeHTML(node.label)}</span>
        <small>${escapeHTML(hiddenReason || result.sourceFile || 'Visible in the current graph')}</small>
      `;
      button.addEventListener('click', () => { void handleSearchResultClick(node); });
      searchResults.appendChild(button);
    });
}

function nodeMatchesCurrentLens(node) {
  if (state.lens === 'all') {
    return true;
  }
  return (state.graph?.edges || []).some((edge) => {
    if (edge.source !== node.id && edge.target !== node.id) {
      return false;
    }
    return state.lens === 'obsidian' ? isObsidianEdge(edge) : !isObsidianEdge(edge);
  });
}

function hiddenSearchResultReason(node) {
  if (state.visibleNodeIds.has(node.id)) {
    return '';
  }
  if (!nodeMatchesCurrentLens(node)) {
    return `Hidden by ${state.lens === 'obsidian' ? 'Wikilinks' : 'Graphify'} Source Lens · reveal temporarily`;
  }
  if (!state.communityEnabled.has(node.community)) {
    return `Hidden by community ${node.community} · reveal temporarily`;
  }
  return 'Hidden by the current graph view · reveal temporarily';
}

async function handleSearchResultClick(node) {
  if (!node) {
    return;
  }
  if (state.searchRevealRestore) {
    await restoreSearchRevealFilters(false);
  }
  if (!state.visibleNodeIds.has(node.id)) {
    state.searchRevealRestore = {
      lens: state.lens,
      communities: Array.from(state.communityEnabled)
    };
    state.lens = 'all';
    state.communityEnabled.add(node.community);
    const didReveal = await applyLens(true, { generation: state.graphGeneration, emitGraphReady: false });
    if (!didReveal) {
      state.searchRevealRestore = null;
      return;
    }
    node = nodeForId(node.id) || node;
  }
  if (state.pathMode && state.pathSourceId && !state.pathTargetId && node.id !== state.pathSourceId) {
    selectNode(node, true);
    return;
  }
  revealSearchNode(node);
}

function updateOverlay() {
  if (!state.graph || state.graph.nodes.length === 0) {
    showOverlay('Graph data unavailable');
  } else if (state.lens === 'obsidian' && state.visibleEdges.length === 0) {
    showOverlay('No wikilinks found');
  } else if (state.lens === 'graphify' && state.visibleEdges.length === 0) {
    showOverlay('No Graphify edges found');
  } else if (state.visibleNodes.length === 0) {
    showOverlay('No visible nodes');
  } else {
    overlay.hidden = true;
  }
}

function showOverlay(message) {
  overlay.textContent = message;
  overlay.hidden = false;
}

function updateHud() {
  if (!hud) {
    return;
  }
  if (!state.graph) {
    hud.hidden = true;
    return;
  }
  const lensLabel = state.lens === 'all'
    ? 'All'
    : (state.lens === 'graphify' ? 'Graphify' : 'Wikilinks');
  const edgeLabel = state.lens === 'obsidian' ? 'links' : 'edges';
  const focusText = state.focusMode
    ? `Focused · depth ${state.focusDepth} · ${state.focusNodeIds.size} nodes`
    : '';
  const spotlightText = state.communitySpotlightName
    ? `Spotlight · ${state.communitySpotlightName} · ${state.communitySpotlightNodeIds.size} nodes`
    : '';
  const recentText = state.recentOrbitMode
    ? `Recent Orbit · ${state.recentOrbitNodeIds.size} recent · ${nodeForId(state.recentOrbitTargetNodeId)?.label || state.recentOrbitMessage || 'no visible key-note path'}`
    : '';
  const storyStep = currentGraphStoryStep();
  const storyText = state.graphStoryMode && storyStep
    ? `Graph Story · ${state.graphStoryStepIndex + 1}/${state.graphStorySteps.length} · ${storyStep.title}`
    : '';
  const searchRevealText = state.searchRevealNodeId
    ? `Revealed · ${nodeForId(state.searchRevealNodeId)?.label || 'Search result'}`
    : '';
  const pathText = pathHudText();
  const base = pathText
    ? `${pathText} · ${lensLabel} · 3D`
    : state.focusMode
    ? `${focusText} · ${lensLabel} · 3D`
    : state.communitySpotlightName
    ? `${spotlightText} · ${lensLabel} · 3D`
    : state.recentOrbitMode
    ? `${recentText} · ${lensLabel} · 3D`
    : state.graphStoryMode
    ? `${storyText || 'Graph Story'} · ${lensLabel} · 3D`
    : state.searchRevealNodeId
    ? `${searchRevealText} · ${lensLabel} · 3D`
    : `${lensLabel} · ${state.visibleNodes.length} nodes · ${state.visibleEdges.length} ${edgeLabel} · 3D`;
  const status = state.lastFrameStatus === 'Visible'
    ? ''
    : ` · ${state.cameraPreset} · ${state.lastFrameStatus}`;
  const nextText = state.lastDiagnostic ? `${base} · ${state.lastDiagnostic}` : `${base}${status}`;
  if (hud.textContent !== nextText) {
    hud.textContent = nextText;
  }
  hud.hidden = false;
}

function pathHudText() {
  if (!state.pathMode) {
    return '';
  }
  if (!state.pathTargetId) {
    return state.pathMessage || 'Path source set · click another node';
  }
  if (state.pathOrderedNodeIds.length) {
    const variant = activePathVariant();
    const label = variant?.id && variant.id !== 'shortest' ? `${variant.label} · ` : '';
    return `Path · ${label}${Math.max(state.pathOrderedNodeIds.length - 1, 0)} steps · ${state.pathOrderedNodeIds.length} nodes`;
  }
  return state.pathMessage || 'No visible path in current view';
}

function selectNode(node, focusCamera = false, options = {}) {
  if (state.pathMode && state.pathSourceId && !state.pathTargetId && !options.preservePath && node.id !== state.pathSourceId) {
    applyPathToNode(node);
    return;
  }
  state.inspectedEdge = null;
  if (!options.preserveSearchReveal) {
    clearSearchReveal(false);
  }
  state.selectedNode = node;
  renderNodeInfo(node);
  positionSelectedMarker(node);
  emitLivingPulse({
    ...pulseNodeNeighborhood(node.id, 10, 32),
    originNodeId: node.id,
    intensity: 0.52,
    durationMs: 920
  });
  if (focusCamera) {
    focusNode(node);
  }
  requestRender();
}

function revealSearchNode(node) {
  if (!node) {
    return;
  }
  clearInteractiveModes();

  const topNeighbors = topNeighborsForNode(node.id, searchRevealNeighborLimit);
  const neighborIds = new Set(topNeighbors.map((neighbor) => neighbor.id));
  const edgeIds = new Set();
  (state.edgesByNode.get(node.id) || []).forEach((edge) => {
    const otherId = edge.source === node.id ? edge.target : edge.source;
    if (neighborIds.has(otherId) && edgeIds.size < searchRevealNeighborLimit) {
      edgeIds.add(edge.id);
    }
  });

  state.searchRevealNodeId = node.id;
  state.searchRevealNeighborIds = neighborIds;
  state.searchRevealEdgeIds = edgeIds;
  state.selectedNode = node;
  renderNodeInfo(node);
  positionSelectedMarker(node);
  focusSearchReveal(node);
  emitLivingPulse({
    nodeIds: [node.id, ...neighborIds],
    edgeIds: edgeIds,
    originNodeId: node.id,
    intensity: 0.68,
    durationMs: 1050
  });
  updateHud();
  requestRender();
}

function clearSearchReveal(render = true) {
  state.searchRevealNodeId = null;
  state.searchRevealNeighborIds = new Set();
  state.searchRevealEdgeIds = new Set();
  if (render) {
    renderNodeInfo(state.selectedNode);
    updateHud();
    requestRender();
  }
}

function applyCommunitySpotlight(communityName) {
  const spotlight = computeCommunitySpotlight(communityName);
  if (!spotlight.nodeIds.size) {
    return;
  }
  clearInteractiveModes();
  state.communitySpotlightName = communityName;
  state.communitySpotlightNodeIds = spotlight.nodeIds;
  state.communitySpotlightEdgeIds = spotlight.edgeIds;
  state.communitySpotlightFocusNodeIds = spotlight.focusNodeIds;
  state.communitySpotlightOverlayEdgeIds = spotlight.overlayEdgeIds;
  state.communitySpotlightSummary = spotlight;
  state.selectedNode = null;
  selectedMarker.visible = false;
  renderSidebar();
  focusCommunitySpotlight(spotlight);
  emitLivingPulse({
    nodeIds: Array.from(spotlight.focusNodeIds),
    edgeIds: Array.from(spotlight.overlayEdgeIds),
    originNodeId: spotlight.topNodes[0]?.id || Array.from(spotlight.focusNodeIds)[0] || null,
    intensity: 0.50,
    durationMs: 1300
  });
  updateHud();
  requestRender();
}

function clearCommunitySpotlight(render = true) {
  state.communitySpotlightName = null;
  state.communitySpotlightNodeIds = new Set();
  state.communitySpotlightEdgeIds = new Set();
  state.communitySpotlightFocusNodeIds = new Set();
  state.communitySpotlightOverlayEdgeIds = new Set();
  state.communitySpotlightSummary = null;
  if (render) {
    renderSidebar();
    updateHud();
    requestRender();
  }
}

function computeCommunitySpotlight(communityName) {
  const cacheKey = `${state.visibleGraphRevision}:${communityName}`;
  const cached = state.spotlightCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  const nodes = state.visibleNodes.filter((node) => node.community === communityName);
  const nodeIds = new Set(nodes.map((node) => node.id));
  const internalEdges = [];
  const bridgeEdges = [];
  const bridgeCounts = new Map();
  const edgeIds = new Set();

  state.visibleEdges.forEach((edge) => {
    const sourceInside = nodeIds.has(edge.source);
    const targetInside = nodeIds.has(edge.target);
    if (sourceInside && targetInside) {
      internalEdges.push(edge);
      edgeIds.add(edge.id);
    } else if (sourceInside || targetInside) {
      const insideId = sourceInside ? edge.source : edge.target;
      bridgeCounts.set(insideId, (bridgeCounts.get(insideId) ?? 0) + 1);
      bridgeEdges.push(edge);
      edgeIds.add(edge.id);
    }
  });

  const rankedNodes = nodes
    .map((node) => ({
      id: node.id,
      label: node.label,
      degree: degreeForNode(node.id)
    }))
    .sort((left, right) => right.degree - left.degree || left.label.localeCompare(right.label));
  const topNodes = rankedNodes.slice(0, 8);
  const bridgeNodes = nodes
    .map((node) => ({
      id: node.id,
      label: node.label,
      degree: degreeForNode(node.id),
      bridgeCount: bridgeCounts.get(node.id) ?? 0
    }))
    .filter((node) => node.bridgeCount > 0)
    .sort((left, right) => right.bridgeCount - left.bridgeCount || right.degree - left.degree || left.label.localeCompare(right.label))
    .slice(0, 6);
  const pinnedFocusNodeIds = new Set([
    ...topNodes.map((node) => node.id),
    ...bridgeNodes.map((node) => node.id)
  ]);
  const budgets = spotlightBudgets(nodes.length, {
    largeThreshold: spotlightSmallCommunityLimit,
    smallFocusNodeLimit: spotlightFocusNodeLimit,
    smallInternalEdgeLimit: spotlightInternalEdgeLimit,
    smallBridgeEdgeLimit: spotlightBridgeEdgeLimit
  });
  const focusNodeIds = budgets.useAllNodes
    ? new Set(nodeIds)
    : new Set([
      ...pinnedFocusNodeIds,
      ...rankedNodes
        .map((node) => node.id)
        .filter((nodeId) => !pinnedFocusNodeIds.has(nodeId))
        .slice(0, Math.max(0, budgets.focusNodeLimit - pinnedFocusNodeIds.size))
    ]);
  const rankedInternalEdges = internalEdges
    .slice()
    .sort((left, right) => edgeImportanceScore(right, nodeIds, bridgeCounts) - edgeImportanceScore(left, nodeIds, bridgeCounts) || left.id.localeCompare(right.id))
    .slice(0, budgets.internalEdgeLimit);
  const rankedBridgeEdges = bridgeEdges
    .slice()
    .sort((left, right) => edgeImportanceScore(right, nodeIds, bridgeCounts) - edgeImportanceScore(left, nodeIds, bridgeCounts) || left.id.localeCompare(right.id))
    .slice(0, budgets.bridgeEdgeLimit);
  const overlayEdgeIds = new Set(rankedInternalEdges.concat(rankedBridgeEdges).map((edge) => edge.id));
  const topLabels = topNodes.slice(0, 3).map((node) => node.label).join(', ');
  const spotlight = {
    name: communityName,
    nodeIds,
    edgeIds,
    focusNodeIds,
    overlayEdgeIds,
    nodeCount: nodes.length,
    edgeCount: internalEdges.length,
    topNodes,
    bridgeNodes,
    summary: topLabels
      ? `This community is centered around ${topLabels}.`
      : 'This community is visible in the current graph view.'
  };
  state.spotlightCache.set(cacheKey, spotlight);
  return spotlight;
}

function edgeImportanceScore(edge, spotlightNodeIds, bridgeCounts) {
  const sourceInside = spotlightNodeIds.has(edge.source);
  const targetInside = spotlightNodeIds.has(edge.target);
  const sourceDegree = degreeForNode(edge.source);
  const targetDegree = degreeForNode(edge.target);
  const bridgeBoost = sourceInside !== targetInside ? 80 : 0;
  const sourceBridge = sourceInside ? (bridgeCounts.get(edge.source) ?? 0) : 0;
  const targetBridge = targetInside ? (bridgeCounts.get(edge.target) ?? 0) : 0;
  return bridgeBoost + sourceBridge * 4 + targetBridge * 4 + Math.log1p(sourceDegree) + Math.log1p(targetDegree);
}

function recentOrbitVisibleItems(limit = recentOrbitNodeLimit) {
  return recentOrbitCandidates({
    nodes: state.visibleNodes,
    metadata: window.__brainBarNodeFileMetadata || {},
    limit
  });
}

function updateAmbientRecentNodes() {
  if (!ambientRuntimeEnabled && !staticRecentWarmthEnabled) {
    state.ambientRecentNodeIds = new Set();
    state.performanceStats.ambientRecentCount = 0;
    return;
  }
  const items = recentOrbitVisibleItems(ambientRecentNodeLimit);
  state.ambientRecentNodeIds = new Set(selectAmbientRecentNodeIds({
    recentItems: items,
    visibleNodeIds: state.visibleNodeIds,
    limit: ambientRecentNodeLimit
  }));
  state.performanceStats.ambientRecentCount = state.ambientRecentNodeIds.size;
}

function updateAmbientSignalCaches() {
  if (!ambientRuntimeEnabled && !edgeGlintsRuntimeEnabled) {
    state.ambientCurrentEdgeIds = new Set();
    state.ambientCommunityPulseGroups = [];
    state.performanceStats.ambientCurrentEdgeCount = 0;
    state.performanceStats.ambientCommunityPulseCount = 0;
    state.performanceStats.recentSparkCount = 0;
    return;
  }
  state.ambientCurrentEdgeIds = new Set(selectAmbientCurrentEdgeIds({
    edges: state.visibleEdges,
    recentNodeIds: state.ambientRecentNodeIds,
    activeNodeIds: activeAmbientNodeIds(),
    limit: ambientCurrentIdleEdgeLimit
  }));
  if (!ambientRuntimeEnabled) {
    state.ambientCommunityPulseGroups = [];
    state.performanceStats.ambientCurrentEdgeCount = state.ambientCurrentEdgeIds.size;
    state.performanceStats.ambientCommunityPulseCount = 0;
    state.performanceStats.recentSparkCount = 0;
    return;
  }
  state.ambientCommunityPulseGroups = selectCommunityPulseGroups({
    nodes: state.visibleNodes,
    limitCommunities: ambientCommunityLimit,
    nodesPerCommunity: ambientCommunityNodeLimit
  });
  state.performanceStats.ambientCurrentEdgeCount = state.ambientCurrentEdgeIds.size;
  state.performanceStats.ambientCommunityPulseCount = state.ambientCommunityPulseGroups
    .reduce((sum, group) => sum + group.nodeIds.length, 0);
}

function activeAmbientNodeIds() {
  const ids = new Set();
  if (state.selectedNode?.id) {
    ids.add(state.selectedNode.id);
  }
  if (state.hoveredNode?.id) {
    ids.add(state.hoveredNode.id);
  }
  [
    state.focusNodeIds,
    state.pathNodeIds,
    state.searchRevealNeighborIds,
    state.recentOrbitPathNodeIds,
    state.graphStoryFocusNodeIds
  ].forEach((nodeSet) => {
    nodeSet?.forEach?.((nodeId) => ids.add(nodeId));
  });
  if (state.searchRevealNodeId) {
    ids.add(state.searchRevealNodeId);
  }
  if (state.recentOrbitActiveNodeId) {
    ids.add(state.recentOrbitActiveNodeId);
  }
  if (state.communitySpotlightNodeIds?.size) {
    Array.from(state.communitySpotlightNodeIds).slice(0, 24).forEach((nodeId) => ids.add(nodeId));
  }
  return ids;
}

function activeCurrentEdgeIds(limit = ambientCurrentActiveEdgeLimit) {
  const ordered = [];
  const push = (edgeIds) => {
    Array.from(edgeIds || []).forEach((edgeId) => {
      const id = String(edgeId);
      if (id && !ordered.includes(id) && state.edgeById.has(id)) {
        ordered.push(id);
      }
    });
  };
  push(state.pathOrderedEdgeIds);
  push(state.recentOrbitOrderedEdgeIds);
  push(state.focusEdgeIds);
  push(state.searchRevealEdgeIds);
  push(state.graphStoryEdgeIds);
  push(state.communitySpotlightEdgeIds);
  if (state.selectedNode?.id) {
    push(pulseEdgesForNodeIds([state.selectedNode.id, ...topNeighborsForNode(state.selectedNode.id, 12).map((node) => node.id)], 24));
  }
  if (ordered.length < limit) {
    push(state.ambientCurrentEdgeIds);
  }
  return ordered.slice(0, limit);
}

function emitLivingPulse({
  nodeIds = [],
  edgeIds = [],
  originNodeId = null,
  intensity = 0.65,
  durationMs = 1100
} = {}) {
  if (!responsePulseRuntimeEnabled || prefersReducedMotion || state.overlayQuality === 'low') {
    state.livingPulseEvents = [];
    state.performanceStats.livingPulseCount = 0;
    return;
  }
  const pulseNodeIds = Array.from(nodeIds || []).filter((nodeId) => state.visibleNodeIds.has(String(nodeId)));
  const pulseEdgeIds = Array.from(edgeIds || []).filter((edgeId) => state.edgeById.has(String(edgeId)));
  if (!pulseNodeIds.length && !pulseEdgeIds.length) {
    return;
  }
  const now = performance.now();
  const pulse = createLivingPulse({
    nodeIds: pulseNodeIds,
    edgeIds: pulseEdgeIds,
    originNodeId,
    now,
    durationMs,
    intensity,
    maxNodes: livingPulseNodeLimit,
    maxEdges: livingPulseEdgeLimit
  });
  state.livingPulseEvents = pruneLivingPulses(state.livingPulseEvents, now).slice(-3);
  state.livingPulseEvents.push(pulse);
  state.lastLivingInteractionAt = now;
  state.performanceStats.livingPulseCount = state.livingPulseEvents.length;
  requestRender();
}

function clearLivingPulses(render = true) {
  state.livingPulseEvents = [];
  state.performanceStats.livingPulseCount = 0;
  state.performanceStats.recentSparkCount = 0;
  if (render) {
    requestRender();
  }
}

function pulseNodeNeighborhood(nodeId, nodeLimit = livingPulseNodeLimit, edgeLimit = livingPulseEdgeLimit) {
  const node = nodeForId(nodeId);
  if (!node) {
    return { nodeIds: [], edgeIds: [] };
  }
  const topNeighbors = topNeighborsForNode(node.id, Math.max(0, nodeLimit - 1));
  const nodeIds = [node.id, ...topNeighbors.map((neighbor) => neighbor.id)];
  const nodeSet = new Set(nodeIds);
  const edgeIds = (state.edgesByNode.get(node.id) || [])
    .filter((edge) => nodeSet.has(edge.source) && nodeSet.has(edge.target))
    .slice(0, edgeLimit)
    .map((edge) => edge.id);
  return { nodeIds, edgeIds };
}

function pulseEdgesForNodeIds(nodeIds, limit = livingPulseEdgeLimit) {
  const nodeSet = new Set(Array.from(nodeIds || []).map(String));
  const edgeIds = [];
  for (const edge of state.visibleEdges) {
    if (nodeSet.has(edge.source) && nodeSet.has(edge.target)) {
      edgeIds.push(edge.id);
      if (edgeIds.length >= limit) {
        break;
      }
    }
  }
  return edgeIds;
}

function graphStoryVisibleSteps() {
  return buildGraphStorySteps({
    nodes: state.visibleNodes,
    edges: state.visibleEdges,
    communities: state.communities.filter((community) => state.communityEnabled.has(community.name)),
    degreeByNode: state.degreeByNode,
    metadata: window.__brainBarNodeFileMetadata || {},
    limits: {
      recent: graphStoryRecentLimit,
      keyNotes: graphStoryKeyNoteLimit,
      communities: graphStoryCommunityLimit,
      bridgeNotes: graphStoryBridgeLimit,
      edges: graphStoryEdgeLimit
    }
  });
}

function startGraphStory() {
  const steps = graphStoryVisibleSteps();
  if (!steps.length) {
    showOverlay('No Graph Story steps in current view');
    return;
  }
  clearInteractiveModes();
  state.graphStoryMode = true;
  state.graphStorySteps = steps;
  state.graphStoryStepIndex = 0;
  applyGraphStoryStep(0, true);
}

function applyGraphStoryStep(index, render = true) {
  if (!state.graphStorySteps.length) {
    clearGraphStory(render);
    return;
  }
  const nextIndex = clamp(Math.round(Number(index) || 0), 0, state.graphStorySteps.length - 1);
  const step = state.graphStorySteps[nextIndex];
  state.graphStoryMode = true;
  state.graphStoryStepIndex = nextIndex;
  state.graphStoryNodeIds = new Set(step.nodeIds || []);
  state.graphStoryFocusNodeIds = new Set(step.focusNodeIds || step.nodeIds || []);
  state.graphStoryEdgeIds = new Set(step.edgeIds || []);
  state.graphStoryActiveNodeId = step.activeNodeId || Array.from(state.graphStoryFocusNodeIds)[0] || null;
  state.graphStoryActiveCommunityName = step.activeCommunityName || null;
  state.graphStoryMessage = step.summary || '';
  state.selectedNode = null;
  selectedMarker.visible = false;

  if (step.type === 'community' && step.activeCommunityName) {
    const spotlight = computeCommunitySpotlight(step.activeCommunityName);
    state.graphStoryNodeIds = spotlight.nodeIds;
    state.graphStoryFocusNodeIds = spotlight.focusNodeIds;
    state.graphStoryEdgeIds = spotlight.overlayEdgeIds;
    state.graphStoryActiveNodeId = step.activeNodeId || spotlight.topNodes[0]?.id || null;
  }

  if (state.graphStoryActiveNodeId) {
    const activeNode = nodeForId(state.graphStoryActiveNodeId);
    if (activeNode && !state.selectedNode) {
      positionSelectedMarker(activeNode);
    }
  }

  focusGraphStoryStep(step);
  emitLivingPulse({
    nodeIds: Array.from(state.graphStoryFocusNodeIds),
    edgeIds: Array.from(state.graphStoryEdgeIds),
    originNodeId: state.graphStoryActiveNodeId,
    intensity: 0.48,
    durationMs: 1180
  });
  if (render) {
    renderNodeInfo(state.selectedNode);
    updateHud();
    requestRender();
  }
}

function currentGraphStoryStep() {
  return state.graphStorySteps[state.graphStoryStepIndex] || null;
}

function activateGraphStoryNode(nodeId) {
  const step = currentGraphStoryStep();
  const node = nodeForId(nodeId);
  if (!step || !node) {
    return;
  }
  state.graphStoryActiveNodeId = node.id;
  state.selectedNode = null;
  positionSelectedMarker(node);
  focusGraphStoryStep(step);
  emitLivingPulse({
    ...pulseNodeNeighborhood(node.id, 8, 24),
    originNodeId: node.id,
    intensity: 0.42,
    durationMs: 900
  });
  renderNodeInfo(null);
  updateHud();
  requestRender();
}

function clearGraphStory(render = true) {
  state.graphStoryMode = false;
  state.graphStorySteps = [];
  state.graphStoryStepIndex = 0;
  state.graphStoryNodeIds = new Set();
  state.graphStoryEdgeIds = new Set();
  state.graphStoryFocusNodeIds = new Set();
  state.graphStoryActiveNodeId = null;
  state.graphStoryActiveCommunityName = null;
  state.graphStoryMessage = '';
  if (render) {
    selectedMarker.visible = !!state.selectedNode;
    if (state.selectedNode) {
      positionSelectedMarker(state.selectedNode);
    } else {
      fitCameraToGraph('Back to all');
    }
    renderNodeInfo(state.selectedNode);
    updateHud();
    requestRender();
  }
}

function focusGraphStoryStep(step) {
  const focusIds = state.graphStoryFocusNodeIds.size
    ? state.graphStoryFocusNodeIds
    : state.graphStoryNodeIds;
  fitCameraToNodeIds(focusIds, 'Graph Story', {
    minimumSpan: step?.type === 'community' ? 320 : 240,
    widthPadding: 1.24,
    heightPadding: 1.02,
    maxZoom: 2.9
  });
}

function applyRecentOrbit(preferredNodeId = null, selectActiveNode = false) {
  const items = recentOrbitVisibleItems(recentOrbitNodeLimit);
  if (!items.length) {
    showOverlay('No recent metadata in current view');
    return;
  }

  clearInteractiveModes();

  const preferred = preferredNodeId
    ? items.find((item) => item.id === String(preferredNodeId))
    : null;
  const match = preferred
    ? {
      item: preferred,
      path: nearestKeyNotePath({
        sourceId: preferred.id,
        nodes: state.visibleNodes,
        edges: state.visibleEdges,
        degreeByNode: state.degreeByNode,
        keyNoteLimit: recentOrbitKeyNoteLimit
      })
    }
    : firstRecentWithKeyPath(items) || {
      item: items[0],
      path: nearestKeyNotePath({
        sourceId: items[0].id,
        nodes: state.visibleNodes,
        edges: state.visibleEdges,
        degreeByNode: state.degreeByNode,
        keyNoteLimit: recentOrbitKeyNoteLimit
      })
    };

  if (!match.item) {
    showOverlay('No recent metadata in current view');
    return;
  }

  state.recentOrbitMode = true;
  state.recentOrbitItems = items;
  state.recentOrbitNodeIds = new Set(items.map((item) => item.id));
  state.recentOrbitActiveNodeId = match.item.id;
  applyRecentOrbitPathState(match.path);
  state.recentOrbitMessage = match.path.found ? '' : match.path.message;

  const activeNode = nodeForId(match.item.id);
  if (selectActiveNode && activeNode) {
    state.selectedNode = activeNode;
    positionSelectedMarker(activeNode);
  } else {
    state.selectedNode = null;
    selectedMarker.visible = false;
  }
  renderNodeInfo(state.selectedNode);
  focusRecentOrbit(match.path, activeNode);
  emitLivingPulse({
    nodeIds: state.recentOrbitOrderedNodeIds.length
      ? state.recentOrbitOrderedNodeIds
      : [match.item.id],
    edgeIds: state.recentOrbitOrderedEdgeIds,
    originNodeId: match.item.id,
    intensity: 0.54,
    durationMs: 1180
  });
  updateHud();
  requestRender();
}

function firstRecentWithKeyPath(items) {
  for (const item of items) {
    const path = nearestKeyNotePath({
      sourceId: item.id,
      nodes: state.visibleNodes,
      edges: state.visibleEdges,
      degreeByNode: state.degreeByNode,
      keyNoteLimit: recentOrbitKeyNoteLimit
    });
    if (path.found) {
      return { item, path };
    }
  }
  return null;
}

function applyRecentOrbitPathState(path) {
  state.recentOrbitTargetNodeId = path?.targetId || null;
  state.recentOrbitPathNodeIds = path?.nodeIds || new Set();
  state.recentOrbitPathEdgeIds = path?.edgeIds || new Set();
  state.recentOrbitOrderedNodeIds = path?.orderedNodeIds || [];
  state.recentOrbitOrderedEdgeIds = path?.orderedEdgeIds || [];
}

function focusRecentOrbit() {
  fitCameraWithTilt('Recent Orbit', 0.72, 0.88);
}

function clearRecentOrbit(render = true) {
  state.recentOrbitMode = false;
  state.recentOrbitNodeIds = new Set();
  state.recentOrbitActiveNodeId = null;
  state.recentOrbitTargetNodeId = null;
  state.recentOrbitPathNodeIds = new Set();
  state.recentOrbitPathEdgeIds = new Set();
  state.recentOrbitOrderedNodeIds = [];
  state.recentOrbitOrderedEdgeIds = [];
  state.recentOrbitItems = [];
  state.recentOrbitMessage = '';
  if (render) {
    fitCameraToGraph('Back to all');
    renderNodeInfo(state.selectedNode);
    updateHud();
    requestRender();
  }
}

function focusCommunitySpotlight(spotlight) {
  fitCameraToNodeIds(spotlight.focusNodeIds?.size ? spotlight.focusNodeIds : spotlight.nodeIds, 'Community Spotlight', {
    minimumSpan: 180,
    widthPadding: 1.18,
    heightPadding: 0.92,
    minZoom: 0.18,
    maxZoom: 4.2
  });
}

function applyFocusOrbit(node, depth = 1, focusCamera = true) {
  if (!node) {
    return;
  }
  clearInteractiveModes();
  const focus = computeFocusOrbit(node.id, depth);
  state.focusMode = true;
  state.focusDepth = focus.depth;
  state.focusNodeId = node.id;
  state.focusNodeIds = focus.nodeIds;
  state.focusEdgeIds = focus.edgeIds;
  state.focusNodeDistance = focus.nodeDistance;
  state.selectedNode = node;
  renderNodeInfo(node);
  positionSelectedMarker(node);
  if (focusCamera) {
    focusNode(node, 'Focus orbit');
  }
  emitLivingPulse({
    nodeIds: Array.from(focus.nodeIds),
    edgeIds: Array.from(focus.edgeIds),
    originNodeId: node.id,
    intensity: 0.60,
    durationMs: 1050
  });
  updateHud();
  requestRender();
}

function armPathSource(node) {
  if (!node) {
    return;
  }
  clearInteractiveModes();
  state.pathMode = true;
  state.pathSourceId = node.id;
  state.pathTargetId = null;
  state.pathNodeIds = new Set();
  state.pathEdgeIds = new Set();
  state.pathOrderedNodeIds = [];
  state.pathOrderedEdgeIds = [];
  state.pathVariants = [];
  state.activePathVariantId = 'shortest';
  state.pathMessage = 'Path source set · click another node';
  state.selectedNode = node;
  renderNodeInfo(node);
  positionSelectedMarker(node);
  focusNode(node, 'Path source');
  emitLivingPulse({
    ...pulseNodeNeighborhood(node.id, 8, 24),
    originNodeId: node.id,
    intensity: 0.50,
    durationMs: 900
  });
  updateHud();
  requestRender();
}

function applyPathToNode(targetNode) {
  const sourceNode = nodeForId(state.pathSourceId);
  if (!sourceNode || !targetNode || sourceNode.id === targetNode.id) {
    return;
  }
  clearInteractiveModes({ preservePathSource: true });
  const variants = computePathVariants({
    sourceId: sourceNode.id,
    targetId: targetNode.id,
    nodes: state.visibleNodes,
    edges: state.visibleEdges
  });
  const path = variants.find((variant) => variant.id === 'shortest') || variants[0];
  state.pathMode = true;
  state.pathSourceId = sourceNode.id;
  state.pathTargetId = targetNode.id;
  state.pathVariants = variants;
  state.activePathVariantId = path?.id || 'shortest';
  applyPathVariantState(path);
  state.selectedNode = targetNode;
  renderNodeInfo(targetNode);
  positionSelectedMarker(targetNode);
  if (path?.found) {
    focusPath(path, 'Shortest path');
  } else {
    focusNode(targetNode, 'Path target');
  }
  emitLivingPulse({
    nodeIds: path?.found ? path.orderedNodeIds : [sourceNode.id, targetNode.id],
    edgeIds: path?.found ? path.orderedEdgeIds : pulseEdgesForNodeIds([sourceNode.id, targetNode.id], 12),
    originNodeId: sourceNode.id,
    intensity: path?.found ? 0.76 : 0.44,
    durationMs: path?.found ? 1350 : 850
  });
  updateHud();
  requestRender();
}

function activePathVariant() {
  return state.pathVariants.find((variant) => variant.id === state.activePathVariantId) || state.pathVariants[0] || null;
}

function applyPathVariant(variantId) {
  const variant = state.pathVariants.find((item) => item.id === variantId);
  if (!variant || !variant.found || variant.sameAs) {
    return;
  }
  state.activePathVariantId = variant.id;
  applyPathVariantState(variant);
  renderNodeInfo(state.selectedNode);
  if (variant.found) {
    focusPath(variant, variant.label);
  }
  emitLivingPulse({
    nodeIds: variant.orderedNodeIds,
    edgeIds: variant.orderedEdgeIds,
    originNodeId: variant.orderedNodeIds[0],
    intensity: 0.64,
    durationMs: 1050
  });
  updateHud();
  requestRender();
}

function applyPathVariantState(path) {
  state.pathNodeIds = path?.nodeIds || new Set();
  state.pathEdgeIds = path?.edgeIds || new Set();
  state.pathOrderedNodeIds = path?.orderedNodeIds || [];
  state.pathOrderedEdgeIds = path?.orderedEdgeIds || [];
  state.pathMessage = path?.message || '';
}

function clearPathMode(render = true) {
  state.pathMode = false;
  state.pathSourceId = null;
  state.pathTargetId = null;
  state.pathNodeIds = new Set();
  state.pathEdgeIds = new Set();
  state.pathOrderedNodeIds = [];
  state.pathOrderedEdgeIds = [];
  state.pathVariants = [];
  state.activePathVariantId = 'shortest';
  state.pathMessage = '';
  state.pathPulsePhase = 0;
  if (render) {
    renderNodeInfo(state.selectedNode);
    updateHud();
    requestRender();
  }
}

async function restoreSearchRevealFilters(fit = true) {
  const restore = state.searchRevealRestore;
  if (!restore) {
    return false;
  }
  state.searchRevealRestore = null;
  state.lens = restore.lens;
  state.communityEnabled = new Set(restore.communities);
  await applyLens(fit, { generation: state.graphGeneration, emitGraphReady: false });
  return true;
}

async function backToAll() {
  const shouldRestoreSearchFilters = Boolean(state.searchRevealRestore);
  clearInteractiveModes();
  clearLivingPulses(false);
  if (shouldRestoreSearchFilters) {
    await restoreSearchRevealFilters(true);
  }
  fitCameraToGraph('All');
  renderNodeInfo(state.selectedNode);
  updateHud();
  requestRender();
}

function setFocusDepth(depth) {
  const focusNode = nodeForId(state.focusNodeId) || state.selectedNode;
  if (!focusNode) {
    return;
  }
  applyFocusOrbit(focusNode, depth, false);
}

function clearFocusOrbit(resetView = true) {
  state.focusMode = false;
  state.focusDepth = 1;
  state.focusNodeId = null;
  state.focusNodeIds = new Set();
  state.focusEdgeIds = new Set();
  state.focusNodeDistance = new Map();
  if (resetView) {
    markVisualCacheDirty();
    fitCameraToGraph('Back to all');
    renderNodeInfo(state.selectedNode);
    updateHud();
    requestRender();
  }
}

function computeFocusOrbit(centerNodeId, depth = 1) {
  const normalizedDepth = clamp(Math.round(Number(depth) || 1), 1, 3);
  const centerId = String(centerNodeId);
  const nodeIds = new Set([centerId]);
  const nodeDistance = new Map([[centerId, 0]]);
  let frontier = new Set([centerId]);

  for (let level = 1; level <= normalizedDepth; level += 1) {
    const next = new Set();
    frontier.forEach((nodeId) => {
      (state.adjacencyByNode.get(nodeId) || new Set()).forEach((neighborId) => {
        if (nodeIds.has(neighborId)) {
          return;
        }
        nodeIds.add(neighborId);
        nodeDistance.set(neighborId, level);
        next.add(neighborId);
      });
    });
    frontier = next;
    if (!frontier.size) {
      break;
    }
  }

  const edgeIds = new Set();
  nodeIds.forEach((nodeId) => {
    (state.edgesByNode.get(nodeId) || []).forEach((edge) => {
      if (nodeIds.has(edge.source) && nodeIds.has(edge.target)) {
        edgeIds.add(edge.id);
      }
    });
  });

  return {
    depth: normalizedDepth,
    nodeIds,
    edgeIds,
    nodeDistance
  };
}

function positionSelectedMarker(node) {
  const position = state.positions.get(node?.id);
  if (!position) {
    selectedMarker.visible = false;
    return;
  }
  selectedMarker.position.set(position.x, position.y, position.z);
  selectedMarker.visible = true;
}

function focusNode(node, preset = 'Node focus') {
  const position = state.positions.get(node.id);
  if (!position) {
    return;
  }
  orbitCameraTo(position, clamp(Math.max(camera.zoom, 1.7), 0.08, 8), preset);
}

function focusSearchReveal(node) {
  const nodeIds = new Set([node.id, ...state.searchRevealNeighborIds]);
  fitCameraToNodeIds(nodeIds, 'Search reveal', {
    minimumSpan: 180,
    maxZoom: 4.8
  });
}

function focusPath(path, preset = 'Shortest path') {
  const positions = path.orderedNodeIds
    .map((nodeId) => state.positions.get(nodeId))
    .filter(Boolean);
  fitCameraToPositions(positions, preset, {
    minimumSpan: 160,
    widthPadding: 1.25,
    heightPadding: 0.95,
    minZoom: 0.28,
    maxZoom: 3.8
  });
}

function orbitCameraTo(position, zoom, preset) {
  const target = new THREE.Vector3(position.x, position.y, position.z);
  if (prefersReducedMotion) {
    controls.target.copy(target);
    camera.zoom = zoom;
    camera.updateProjectionMatrix();
    controls.update();
    state.cameraPreset = preset;
    markVisualCacheDirty();
    updateHud();
    requestRender();
    return;
  }

  const startTarget = controls.target.clone();
  const startPosition = camera.position.clone();
  const startZoom = camera.zoom;
  const offset = startPosition.clone().sub(startTarget);
  const startedAt = performance.now();
  const duration = 320;

  function tick(now) {
    const t = smoothstep(clamp((now - startedAt) / duration, 0, 1));
    controls.target.lerpVectors(startTarget, target, t);
    camera.position.copy(controls.target).add(offset);
    camera.zoom = startZoom + (zoom - startZoom) * t;
    camera.updateProjectionMatrix();
    controls.update();
    markVisualCacheDirty();
    requestRender();
    if (t < 1) {
      requestAnimationFrame(tick);
    } else {
      state.cameraPreset = preset;
      updateHud();
    }
  }

  requestAnimationFrame(tick);
}

function nodeAtEvent(event) {
  if (!nodePoints) {
    return null;
  }
  const rect = renderer.domElement.getBoundingClientRect();
  state.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  state.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  state.raycaster.params.Points.threshold = Math.max(8, 12 / Math.max(camera.zoom, 0.2));
  state.raycaster.setFromCamera(state.pointer, camera);
  const intersections = state.raycaster.intersectObject(nodePoints, false);
  if (!intersections.length) {
    return null;
  }
  return state.visibleNodes[intersections[0].index] ?? null;
}

function edgeAtEvent(event) {
  if (!state.projectedPoints.size) {
    return null;
  }
  const rect = renderer.domElement.getBoundingClientRect();
  const point = {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top
  };
  const threshold = 8;
  let bestEdge = null;
  let bestDistance = threshold;
  const candidateEdges = candidateEdgesNearPoint(point, threshold);

  candidateEdges.forEach((edge) => {
    const source = state.projectedPoints.get(edge.source);
    const target = state.projectedPoints.get(edge.target);
    if (!source || !target) {
      return;
    }
    const padding = threshold + 34;
    if (
      point.x < Math.min(source.x, target.x) - padding ||
      point.x > Math.max(source.x, target.x) + padding ||
      point.y < Math.min(source.y, target.y) - padding ||
      point.y > Math.max(source.y, target.y) + padding
    ) {
      return;
    }

    const distance = distanceToCurvedEdge(point, edge, source, target);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestEdge = edge;
    }
  });

  return bestEdge;
}

function candidateEdgesNearPoint(point, threshold) {
  if (state.focusMode && state.focusEdgeIds.size) {
    const edges = focusOverlayEdges();
    state.performanceStats.lastHitTestCandidateCount = edges.length;
    return edges;
  }
  if (state.graphStoryMode && state.graphStoryEdgeIds.size) {
    const edges = graphStoryOverlayEdges();
    state.performanceStats.lastHitTestCandidateCount = edges.length;
    return edges;
  }

  const candidateIds = new Set();
  const nodeRadius = clamp(54 / Math.max(camera.zoom, 0.45), 18, 72);
  const nearbyNodeIds = state.projectedPointGrid
    ? nearbyProjectedNodeIds(state.projectedPointGrid, point, nodeRadius)
    : Array.from(state.projectedPoints.keys());
  nearbyNodeIds.forEach((nodeId) => {
    const projected = state.projectedPoints.get(nodeId);
    if (!projected) {
      return;
    }
    if (
      Math.abs(projected.x - point.x) > nodeRadius ||
      Math.abs(projected.y - point.y) > nodeRadius
    ) {
      return;
    }
    (state.edgesByNode.get(nodeId) || []).forEach((edge) => candidateIds.add(edge.id));
  });

  if (!candidateIds.size && state.selectedNode) {
    (state.edgesByNode.get(state.selectedNode.id) || []).forEach((edge) => candidateIds.add(edge.id));
  }

  const maxCandidates = state.selectedNode ? 260 : 160;
  const candidates = [];
  for (const edgeId of candidateIds) {
    const edge = state.edgeById.get(edgeId);
    if (edge) {
      candidates.push(edge);
    }
    if (candidates.length >= maxCandidates) {
      break;
    }
  }
  state.performanceStats.lastHitTestCandidateCount = candidates.length;
  return candidates;
}

function distanceToCurvedEdge(point, edge, source, target) {
  const control = curvedEdgeControl(edge, source, target, 0.74);
  let minDistance = Infinity;
  let previous = source;
  for (let step = 1; step <= 10; step += 1) {
    const current = pointOnQuadratic(source, control, target, step / 10);
    minDistance = Math.min(minDistance, distanceToSegment(point, previous, current));
    previous = current;
  }
  return minDistance;
}

function pointOnQuadratic(source, control, target, t) {
  const inverse = 1 - t;
  return {
    x: inverse * inverse * source.x + 2 * inverse * t * control.x + t * t * target.x,
    y: inverse * inverse * source.y + 2 * inverse * t * control.y + t * t * target.y
  };
}

function distanceToSegment(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }
  const t = clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared, 0, 1);
  const x = start.x + dx * t;
  const y = start.y + dy * t;
  return Math.hypot(point.x - x, point.y - y);
}

function compactNodeLabel(label) {
  const normalized = String(label || 'Untitled').replace(/\s+/g, ' ').trim();
  return normalized.length > 42 ? `${normalized.slice(0, 39)}...` : normalized;
}

function formatRecentTimestamp(timestamp) {
  if (!timestamp) {
    return 'recent';
  }
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return 'recent';
  }
  return date.toISOString().slice(0, 10);
}

function rectanglesOverlap(left, right) {
  const padding = 5;
  return !(
    left.x + left.width + padding < right.x ||
    right.x + right.width + padding < left.x ||
    left.y + left.height + padding < right.y ||
    right.y + right.height + padding < left.y
  );
}

function roundedRect(context, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.lineTo(x + width - r, y);
  context.quadraticCurveTo(x + width, y, x + width, y + r);
  context.lineTo(x + width, y + height - r);
  context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  context.lineTo(x + r, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - r);
  context.lineTo(x, y + r);
  context.quadraticCurveTo(x, y, x + r, y);
  context.closePath();
}

function resetCamera() {
  fitCameraToGraph('Fit');
}

function zoomCamera(multiplier) {
  camera.zoom = clamp(camera.zoom * multiplier, 0.08, 8);
  camera.updateProjectionMatrix();
  state.cameraPreset = multiplier > 1 ? 'Zoom in' : 'Zoom out';
  markVisualCacheDirty();
  updateHud();
  requestRender();
}

function topView() {
  fitCameraWithTilt('Top view', 0.001, 1.55);
}

function resetTilt() {
  fitCameraToGraph('Reset tilt');
}

function degreeForNode(nodeId) {
  return state.degreeByNode.get(nodeId) ?? 0;
}

function colorForCommunity(name) {
  const community = state.communityByName.get(name);
  return community?.color ?? palette[0];
}

function accentColorForCommunity(name) {
  const community = state.communityByName.get(name);
  return community?.accentColor ?? accentPalette[0];
}

function colorForEdge(edge) {
  const source = nodeForId(edge.source);
  const target = nodeForId(edge.target);
  return accentColorForCommunity(source?.community ?? target?.community ?? '');
}

function agentActivityColor(action) {
  switch (String(action || '').toLowerCase()) {
    case 'read':
    case 'open':
      return '#89b7ff';
    case 'write':
    case 'closeout':
    case 'decision':
      return '#f4b75e';
    case 'create':
      return '#80d596';
    case 'delete':
      return '#e9878f';
    case 'focus':
      return '#d8e4ff';
    case 'graph_refresh':
      return '#9bc7d9';
    default:
      return '#a9b5cf';
  }
}

function agentActivityBrand(agent) {
  const normalized = String(agent || '').toLowerCase();
  if (normalized.includes('codex')) {
    return { key: 'codex', label: 'Codex', mark: 'Codex', icon: 'assets/agent-codex.png' };
  }
  if (normalized.includes('claude')) {
    return { key: 'claude', label: 'Claude', mark: 'Claude', icon: 'assets/agent-claude.png' };
  }
  if (normalized.includes('local')) {
    return { key: 'local', label: 'Local file', mark: '•' };
  }
  return { key: 'agent', label: agent ? String(agent) : 'Agent', mark: 'Ag' };
}

function applyAgentActivitySnapshot(snapshot = {}) {
  const visibleNodeIds = state.visibleNodeIds || new Set();
  const events = Array.isArray(snapshot.events) ? snapshot.events : [];
  const normalizedEvents = events.slice(0, 80).map((event) => {
    const nodeId = event.nodeId ? String(event.nodeId) : '';
    const timestampMs = Date.parse(event.timestamp || event.timestampMs || '');
    return {
      id: String(event.id || `${event.agent || 'agent'}:${event.action || 'activity'}:${event.path || nodeId}`),
      version: Number(event.version || 1),
      action: String(event.action || 'activity').toLowerCase(),
      agent: String(event.agent || 'agent'),
      path: String(event.path || ''),
      nodeId,
      label: String(event.label || event.path || nodeId || ''),
      sourceFile: String(event.sourceFile || event.path || ''),
      pending: Boolean(event.pending) || (nodeId ? !visibleNodeIds.has(nodeId) : true),
      sessionId: event.sessionId == null ? null : String(event.sessionId),
      project: event.project == null ? null : String(event.project),
      source: event.source == null ? null : String(event.source),
      reason: event.reason == null ? null : String(event.reason),
      status: event.status == null ? null : String(event.status),
      workflowId: event.workflowId == null ? null : String(event.workflowId),
      workflowTitle: event.workflowTitle == null ? null : String(event.workflowTitle),
      pathRole: event.pathRole == null ? null : String(event.pathRole),
      timestamp: event.timestamp,
      timestampMs: Number.isFinite(timestampMs) ? timestampMs : 0
    };
  });
  state.agentActivityEvents = normalizedEvents;
  state.agentActivityRenderableEvents = normalizedEvents
    .filter((event) => event.nodeId && !event.pending && visibleNodeIds.has(event.nodeId))
    .slice(0, 24);
  state.agentActivityNodeIds = new Set(
    state.agentActivityRenderableEvents
      .map((event) => event.nodeId)
  );
  state.agentActivityPendingPaths = Array.isArray(snapshot.pendingPaths)
    ? snapshot.pendingPaths.slice(0, 24).map(String)
    : normalizedEvents.filter((event) => event.pending && event.path).map((event) => event.path).slice(0, 24);
  state.agentActivityLastEventAt = snapshot.lastEventAt || normalizedEvents[0]?.timestamp || null;
  state.agentActivityTracingEnabled = Boolean(snapshot.tracingEnabled);
  state.agentActivityEventLogPath = String(snapshot.eventLogPath || '');
  state.agentActivityWorkflows = Array.isArray(snapshot.workflows) ? snapshot.workflows : [];
  updateWorkflowHighlight();
  renderSidebar();
  updateHud();
  requestRender();
}

function updateWorkflowHighlight() {
  const workflow = state.agentActivityWorkflows.find((candidate) => (
    String(candidate?.id || '') === String(state.workflowSelectionID || '')
  ));
  if (!workflow) {
    state.workflowHighlight = { workflowID: '', nodeIds: [], pendingPaths: [] };
    return;
  }
  const visibleNodeIds = state.visibleNodeIds || new Set();
  state.workflowHighlight = {
    workflowID: String(workflow.id || ''),
    nodeIds: Array.from(new Set((Array.isArray(workflow.nodeIds) ? workflow.nodeIds : [])
      .map(String)
      .filter((nodeId) => visibleNodeIds.has(nodeId)))).sort(),
    pendingPaths: Array.from(new Set((Array.isArray(workflow.pendingPaths) ? workflow.pendingPaths : [])
      .map(String))).sort()
  };
}

function nodeForId(nodeId) {
  const index = state.nodeIndexById.get(nodeId);
  return Number.isInteger(index) ? state.visibleNodes[index] : null;
}

function reportDiagnostic(message, showsOverlay = false, generation = state.graphGeneration) {
  const text = String(message || '3D renderer failed');
  state.lastDiagnostic = text;
  updateHud();
  if (showsOverlay) {
    showOverlay(text);
  }
  if (window.webkit?.messageHandlers?.brainBarGraphDiagnostic) {
    window.webkit.messageHandlers.brainBarGraphDiagnostic.postMessage({
      message: text,
      generation,
      lens: state.lens,
      nodes: state.visibleNodes.length,
      edges: state.visibleEdges.length,
      cameraPreset: state.cameraPreset
    });
  }
}

function sendNodeAction(action, node) {
  if (!node || !window.webkit?.messageHandlers?.brainBarNodeAction) {
    return;
  }
  window.webkit.messageHandlers.brainBarNodeAction.postMessage({
    action,
    nodeId: node.id,
    label: node.label,
    sourceFile: node.sourceFile || ''
  });
}

function wireEvents() {
  renderer?.domElement?.addEventListener('pointermove', (event) => {
    markLivingInteraction();
    schedulePointerHitTest(event);
  });

  renderer?.domElement?.addEventListener('pointerleave', () => {
    markLivingInteraction();
    if (state.pointerHitFrame) {
      cancelAnimationFrame(state.pointerHitFrame);
      state.pointerHitFrame = null;
      state.pendingPointerEvent = null;
    }
    if (!state.hoveredNode && !state.hoveredEdge) {
      return;
    }
    state.hoveredNode = null;
    state.hoveredEdge = null;
    stage.style.cursor = 'grab';
    requestRender();
  });

  renderer?.domElement?.addEventListener('click', (event) => {
    markLivingInteraction();
    const node = nodeAtEvent(event);
    const edge = node ? null : edgeAtEvent(event);
    if (node) {
      if (state.pathMode && state.pathSourceId && !state.pathTargetId && node.id !== state.pathSourceId) {
        applyPathToNode(node);
      } else if (state.focusMode) {
        applyFocusOrbit(node, state.focusDepth);
      } else {
        selectNode(node);
      }
    } else if (edge) {
      state.inspectedEdge = edge;
      renderNodeInfo(state.selectedNode);
    } else if (state.selectedNode || state.focusMode || state.pathMode || state.searchRevealNodeId) {
      if (state.searchRevealRestore) {
        void backToAll();
        return;
      }
      clearFocusOrbit(false);
      clearPathMode(false);
      clearSearchReveal(false);
      state.selectedNode = null;
      selectedMarker.visible = false;
      renderNodeInfo(null);
      updateHud();
      requestRender();
    }
  });

  renderer?.domElement?.addEventListener('dblclick', (event) => {
    markLivingInteraction();
    const node = nodeAtEvent(event);
    if (node) {
      sendNodeAction('openNode', node);
    }
  });

  search.addEventListener('input', renderSearchResults);
  document.addEventListener('click', scheduleGraphSessionState);
  document.addEventListener('input', scheduleGraphSessionState);
  document.addEventListener('change', scheduleGraphSessionState);
  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      startAmbientMotion();
    }
  });
  new ResizeObserver(resize).observe(stage);

  window.addEventListener('error', (event) => {
    reportDiagnostic(event.message || '3D renderer failed', true);
  });

  window.addEventListener('unhandledrejection', (event) => {
    reportDiagnostic(event.reason?.message || '3D renderer failed', true);
  });

  renderer?.domElement?.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    reportDiagnostic('WebGL context lost', true);
  });
}

function schedulePointerHitTest(event) {
  state.pendingPointerEvent = {
    clientX: event.clientX,
    clientY: event.clientY
  };
  if (state.pointerHitFrame) {
    return;
  }
  state.pointerHitFrame = requestAnimationFrame(() => {
    const pendingEvent = state.pendingPointerEvent;
    state.pendingPointerEvent = null;
    state.pointerHitFrame = null;
    if (pendingEvent) {
      updatePointerHover(pendingEvent);
    }
  });
}

function updatePointerHover(event) {
  const node = nodeAtEvent(event);
  const edge = node ? null : edgeAtEvent(event);
  if (node === state.hoveredNode && edge === state.hoveredEdge) {
    return;
  }

  if (node && state.hoveredNode) {
    state.hoverIntensity = Math.min(state.hoverIntensity, 0.35);
  }
  state.hoveredNode = node;
  state.hoveredEdge = edge;
  if (node && !state.selectedNode) {
    state.hoverVisualNode = node;
  }
  stage.style.cursor = node ? 'pointer' : (edge ? 'crosshair' : 'grab');
  requestRender();
}

function isBrainBarWebKitScheme() {
  return window.location.protocol === 'brainbar3d:';
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function escapeHTML(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function createPointTexture() {
  const textureCanvas = document.createElement('canvas');
  textureCanvas.width = 64;
  textureCanvas.height = 64;
  const textureContext = textureCanvas.getContext('2d');
  const gradient = textureContext.createRadialGradient(32, 32, 0, 32, 32, 31);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.58, 'rgba(255,255,255,0.94)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  textureContext.fillStyle = gradient;
  textureContext.beginPath();
  textureContext.arc(32, 32, 31, 0, Math.PI * 2);
  textureContext.fill();
  const texture = new THREE.CanvasTexture(textureCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function installWindowAPI() {
  if (layoutWorkerTestMode === 'holdResult') {
    window.__brainBarLayoutWorkerTestRelease = releaseHeldLayoutWorkerResult;
  }
  if (graphIdentityTestMode) {
    window.__brainBarGraphIdentitySnapshot = () => ({
      nodeIDs: (state.graph?.nodes ?? []).map((node) => node.id).sort(),
      edgeIdentities: (state.graph?.edges ?? [])
        .map((edge) => [edge.id, edge.source, edge.target, edge.relation])
        .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
    });
    window.__brainBarGraphIdentityInspectEdge = (edgeId) => {
      const edge = state.edgeById.get(String(edgeId));
      if (!edge) return false;
      state.inspectedEdge = edge;
      renderNodeInfo(state.selectedNode);
      return true;
    };
  }
  if (layoutCacheTestEnabled) {
    window.__brainBarLayoutCacheTest = {
      clear: clearLayoutCacheForTesting,
      corrupt: async () => {
        const identity = currentLayoutCacheIdentity();
        if (!identity) {
          return false;
        }
        return await overwriteLayoutCacheForTesting({
          key: layoutCacheKey(identity),
          schemaVersion: 0,
          digest: identity.digest,
          lens: identity.lens,
          nodeCount: 0,
          coordinates: new ArrayBuffer(0)
        });
      },
      snapshot: () => {
        const packed = new Float64Array(state.visibleNodes.length * 3);
        state.visibleNodes.forEach((node, index) => {
          const position = state.positions.get(node.id);
          packed[index * 3] = position?.x ?? NaN;
          packed[index * 3 + 1] = position?.y ?? NaN;
          packed[index * 3 + 2] = position?.z ?? NaN;
        });
        const bytes = new Uint8Array(packed.buffer);
        let fingerprint = 2166136261;
        for (const byte of bytes) {
          fingerprint = Math.imul(fingerprint ^ byte, 16777619) >>> 0;
        }
        return { count: state.visibleNodes.length, fingerprint: fingerprint.toString(16) };
      },
      release: releaseHeldLayoutCacheLookup
    };
  }
  window.brainBarNormalizeGraphLens = normalizeLens;
  window.brainBarAbortGraphLoad = () => {
    state.graphLoadEpoch += 1;
    state.graphLoadController?.abort();
    state.graphLoadController = null;
    cancelActiveLayoutRequest();
    window.__brainBarGraphReady = false;
    return true;
  };
  window.brainBarLoadGraph = async (payload, lens = 'all', generation = null) => {
    window.__brainBarGraphReady = false;
    try {
      const requestedGeneration = Number.isInteger(generation) ? generation : state.graphGeneration + 1;
      state.graphGeneration = Number.isInteger(state.pendingGraphGeneration)
        ? Math.max(requestedGeneration, state.pendingGraphGeneration)
        : requestedGeneration;
      state.pendingGraphGeneration = null;
      state.evidenceInput = evidenceInputForGraphPayload(payload);
      state.evidenceReport = null;
      state.evidenceNow = null;
      state.graph = normalizeGraph(payload);
      state.lens = normalizeLens(window.__brainBarPendingGraphLens || lens);
      state.selectedNode = null;
      state.searchRevealRestore = null;
      clearInteractiveModes();
      prepareCommunities(state.graph);
      const didLoad = await applyLens(true, { generation: state.graphGeneration, emitGraphReady: true });
      return didLoad;
    } catch (error) {
      failLayout();
      return false;
    }
  };

  window.brainBarLoadGraphFromURL = async (graphURL, metadataURL, lens = 'all', generation = null) => {
    state.graphLoadEpoch += 1;
    const epoch = state.graphLoadEpoch;
    state.graphLoadController?.abort();
    const controller = new AbortController();
    state.graphLoadController = controller;
    try {
      const graphResponse = await fetch(String(graphURL || ''), { signal: controller.signal });
      if (!graphResponse.ok && graphResponse.status !== 0) {
        throw new Error('Graph data unavailable');
      }
      const payload = await graphResponse.json();
      if (epoch !== state.graphLoadEpoch) {
        return false;
      }
      window.__brainBarGraphJSON = payload;
      window.__brainBarNodeFileMetadata = { byNodeId: {}, bySourceFile: {} };
      const didLoad = await window.brainBarLoadGraph(payload, lens, generation);
      if (epoch !== state.graphLoadEpoch) {
        return false;
      }
      const layoutWasSuperseded = Number.isInteger(generation) && state.graphGeneration !== generation;
      if (!didLoad && !layoutWasSuperseded) {
        return false;
      }

      try {
        const metadataResponse = await fetch(String(metadataURL || ''), { signal: controller.signal });
        if (!metadataResponse.ok && metadataResponse.status !== 0) {
          throw new Error('Graph metadata unavailable');
        }
        const metadata = await metadataResponse.json();
        if (epoch !== state.graphLoadEpoch) {
          return false;
        }
        window.__brainBarNodeFileMetadata = metadata && typeof metadata === 'object'
          ? metadata
          : { byNodeId: {}, bySourceFile: {} };
        updateAmbientRecentNodes();
        renderSidebar();
        updateHud();
        requestRender();
      } catch (error) {
        if (error?.name !== 'AbortError' && epoch === state.graphLoadEpoch) {
          reportDiagnostic('3D file metadata could not be loaded', false, generation);
        }
      }
      return didLoad;
    } catch (error) {
      if (error?.name !== 'AbortError' && epoch === state.graphLoadEpoch) {
        reportDiagnostic('3D graph data could not be loaded', true, generation);
      }
      return false;
    } finally {
      if (epoch === state.graphLoadEpoch) {
        state.graphLoadController = null;
      }
    }
  };

  window.brainBarApplyGraphLens = async (lens, generation = null) => {
    window.__brainBarGraphReady = false;
    const desiredLens = normalizeLens(lens);
    window.__brainBarPendingGraphLens = desiredLens;
    if (!state.graph) {
      if (Number.isInteger(generation)) {
        state.pendingGraphGeneration = generation;
      }
      return false;
    }
    state.graphGeneration = Number.isInteger(generation) ? generation : state.graphGeneration + 1;
    state.lens = desiredLens;
    state.selectedNode = null;
    state.searchRevealRestore = null;
    clearInteractiveModes();
    return await applyLens(true, { generation: state.graphGeneration, emitGraphReady: true });
  };

  window.brainBarApplyAgentActivity = (snapshot) => {
    applyAgentActivitySnapshot(snapshot || {});
  };

  window.brainBarApplyWorkflowHighlight = (workflowID) => {
    state.workflowSelectionID = String(workflowID || '');
    updateWorkflowHighlight();
    requestRender();
  };

  window.brainBarGraphSessionSnapshot = graphSessionSnapshot;
  window.brainBarApplyGraphSessionState = (value) => {
    if (!value || typeof value !== 'object' || Number(value.schemaVersion) !== 1) {
      return false;
    }
    const session = { ...value, schemaVersion: 1 };
    window.__brainBarPendingSessionState = session;
    if (search && search.value !== String(session.searchQuery || '')) {
      search.value = String(session.searchQuery || '');
      renderSearchResults();
    }

    const pathSource = session.path?.sourceNodeID ? nodeForId(String(session.path.sourceNodeID)) : null;
    const pathTarget = session.path?.targetNodeID ? nodeForId(String(session.path.targetNodeID)) : null;
    const focusNode = session.selectedNodeID ? nodeForId(String(session.selectedNodeID)) : null;
    if (pathSource) {
      armPathSource(pathSource);
      if (pathTarget) {
        applyPathToNode(pathTarget);
        if (session.path?.variant) {
          applyPathVariant(String(session.path.variant));
        }
      }
    } else if (session.communityID) {
      const rawCommunity = String(session.communityID);
      applyCommunitySpotlight(rawCommunity.startsWith('Community') ? rawCommunity : `Community ${rawCommunity}`);
    } else if (focusNode && session.focusDepth) {
      applyFocusOrbit(focusNode, Number(session.focusDepth));
    } else if (focusNode) {
      selectNode(focusNode, true);
    }
    if (session.cameraState) {
      applyGraphCameraState(session.cameraState);
    }
    scheduleGraphSessionState();
    return true;
  };

  window.brainBarResetCamera = resetCamera;
  window.brainBarZoom = zoomCamera;
  window.brainBarTopView = topView;
  window.brainBarResetTilt = resetTilt;
  window.brainBarShowGraphHealth = showGraphHealthPanel3D;
  window.brainBarRevealNode3D = (nodeId) => {
    const normalizedNodeId = String(nodeId || '');
    const node = nodeForId(normalizedNodeId);
    if (node) {
      revealSearchNode(node);
    } else if (state.layoutState === 'starting' || state.layoutState === 'running') {
      state.pendingNodeRevealId = normalizedNodeId;
    }
  };
  window.brainBarStartPathFromNode3D = (nodeId) => {
    let sourceId = String(nodeId || '');
    let targetId = '';
    if (sourceId.startsWith('{')) {
      try {
        const payload = JSON.parse(sourceId);
        sourceId = String(payload.sourceId || payload.nodeId || '');
        targetId = String(payload.targetId || '');
      } catch (_) {
        targetId = '';
      }
    }
    const node = nodeForId(sourceId);
    if (node) {
      selectNode(node, true);
      armPathSource(node);
      const target = targetId ? nodeForId(targetId) : null;
      if (target) {
        applyPathToNode(target);
      }
    }
  };
  window.brainBarShowCommunity3D = (communityId) => {
    const raw = String(communityId || '');
    if (!raw) {
      return;
    }
    const communityName = raw.startsWith('Community') ? raw : `Community ${raw}`;
    applyCommunitySpotlight(communityName);
  };
  window.brainBarRendererDiagnostics = () => ({
    ambientRuntimeEnabled,
    responsePulseRuntimeEnabled,
    staticRecentWarmthEnabled,
    staticHubGlowEnabled,
    edgeGlintsRuntimeEnabled,
    renderHiddenWebGLLayer,
    activeMode: activeMode(),
    queryableNodes: state.graph?.nodes.length ?? 0,
    queryableEdges: state.graph?.edges.length ?? 0,
    visibleNodes: state.visibleNodes.length,
    visibleEdges: state.visibleEdges.length,
    paintedNodes: state.paintedNodeCount,
    paintedEdges: state.paintedEdgeCount,
    paintedCountsSettled: state.paintedCountsSettled,
    selectedNodeCount: state.selectedNode ? 1 : 0,
    searchResultCount: state.searchResultIds.length,
    agentActivityEventCount: state.agentActivityEvents.length,
    agentActivityRenderableCount: state.agentActivityRenderableEvents.length,
    workflowHighlightNodeCount: state.workflowHighlight.nodeIds.length,
    workflowHighlightPendingPathCount: state.workflowHighlight.pendingPaths.length,
    nodes: state.visibleNodes.length,
    edges: state.visibleEdges.length,
    highlightedEdges: state.performanceStats.highlightedEdgeCount,
    lens: state.lens,
    communities: state.communities.length,
    cameraPreset: state.cameraPreset,
    cameraZoom: camera?.zoom ?? 0,
    drawCalls: renderer?.info?.render?.calls ?? 0,
    triangles: renderer?.info?.render?.triangles ?? 0,
    points: renderer?.info?.render?.points ?? 0,
    lines: renderer?.info?.render?.lines ?? 0,
    visibleProjectedNodeCount: state.visibleProjectedNodeCount,
    staticRebuildMs: Number(state.performanceStats.staticRebuildMs.toFixed(2)),
    layoutPreparationMs: Number(state.performanceStats.layoutPreparationMs.toFixed(2)),
    layoutWorkerComputeMs: Number(state.performanceStats.layoutWorkerComputeMs.toFixed(2)),
    layoutCommitMs: Number(state.performanceStats.layoutCommitMs.toFixed(2)),
    layoutCache: state.performanceStats.layoutCache,
    layoutState: state.layoutState,
    overlayFrameMs: Number(state.performanceStats.overlayFrameMs.toFixed(2)),
    visualPixelRatio: state.performanceStats.visualPixelRatio,
    staticHubGlowCount: state.performanceStats.staticHubGlowCount,
    livingPulseCount: state.performanceStats.livingPulseCount,
    ambientRecentCount: state.performanceStats.ambientRecentCount,
    ambientCurrentEdgeCount: state.performanceStats.ambientCurrentEdgeCount,
    ambientCommunityPulseCount: state.performanceStats.ambientCommunityPulseCount,
    recentSparkCount: state.performanceStats.recentSparkCount,
    hitTestCandidateCount: state.performanceStats.lastHitTestCandidateCount,
    stageWidth: stage.clientWidth,
    stageHeight: stage.clientHeight,
    diagnostic: state.lastDiagnostic ? 'reported' : '',
    hasDiagnostic: Boolean(state.lastDiagnostic)
  });
}

function graphSessionSnapshot() {
  const pending = window.__brainBarPendingSessionState || {};
  const path = state.pathMode && state.pathSourceId
    ? {
        sourceNodeID: state.pathSourceId,
        targetNodeID: state.pathTargetId || null,
        variant: state.activePathVariantId || 'shortest'
      }
    : (pending.path || null);
  return {
    schemaVersion: 1,
    graphVersion: pending.graphVersion || null,
    selectedNodeID: state.selectedNode?.id || pending.selectedNodeID || null,
    sourceLens: normalizeLens(state.lens || pending.sourceLens || 'all'),
    focusDepth: state.focusMode ? Number(state.focusDepth || 1) : (pending.focusDepth || null),
    path,
    communityID: state.communitySpotlightName || pending.communityID || null,
    searchQuery: String(search?.value || pending.searchQuery || ''),
    cameraState: camera && controls
      ? {
          position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
          target: { x: controls.target.x, y: controls.target.y, z: controls.target.z },
          zoom: camera.zoom,
          preset: state.cameraPreset || 'Manual'
        }
      : (pending.cameraState || null)
  };
}

function applyGraphCameraState(cameraState) {
  const values = [
    cameraState?.position?.x, cameraState?.position?.y, cameraState?.position?.z,
    cameraState?.target?.x, cameraState?.target?.y, cameraState?.target?.z,
    cameraState?.zoom
  ].map(Number);
  if (!camera || !controls || values.some((value) => !Number.isFinite(value)) || values[6] <= 0) {
    return false;
  }
  camera.position.set(values[0], values[1], values[2]);
  controls.target.set(values[3], values[4], values[5]);
  camera.zoom = clamp(values[6], 0.08, 8);
  camera.updateProjectionMatrix();
  camera.lookAt(controls.target);
  controls.update();
  state.cameraPreset = String(cameraState.preset || 'Saved view');
  markVisualCacheDirty();
  requestRender();
  return true;
}

function emitGraphSessionState() {
  const snapshot = graphSessionSnapshot();
  window.__brainBarPendingSessionState = snapshot;
  window.webkit?.messageHandlers?.brainBarGraphSession?.postMessage(snapshot);
}

function scheduleGraphSessionState() {
  clearTimeout(window.__brainBarGraphSessionTimer);
  window.__brainBarGraphSessionTimer = setTimeout(emitGraphSessionState, 0);
}
