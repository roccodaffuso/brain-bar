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
  readLayoutCacheLayout,
  writeLayoutCache
} from './graph3d-layout-cache.mjs';
import {
  buildPresentationPlan,
  buildPresentationIndex,
  allocateLabels,
  DETAIL_LEVELS,
  DETAIL_REASONS,
  adaptiveDetailLevel,
  normalizeDetailLevel,
  reduceMotionPolicy,
  resolveZoomDetailLevel
} from './graph3d-presentation-utils.mjs';

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
const app = document.getElementById('app');
const sidebar = document.getElementById('sidebar');
const detailLevelControl = document.getElementById('detail-level');
const sidebarToggle = document.getElementById('sidebar-toggle');
const sidebarResizer = document.getElementById('sidebar-resizer');
const cameraBackButton = document.getElementById('camera-back');
const graphStatus = document.getElementById('graph-status');
const navigationHint = document.getElementById('navigation-hint');

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
const staticHubGlowEnabled = false;
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
const balancedOverlayPixelRatio = 2;
const balancedDiscMinimumAlpha = 0.72;
const darkSeparationRimWidth = 0.8;
const balancedEdgeAlpha = 0.18;
const staticHubHaloBlur = 5;
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
const rendererMeasurementMode = new URLSearchParams(window.location.search).get('renderer-measurement') === '1';
const rendererTestMode = new URLSearchParams(window.location.search).get('renderer-test') === '1';
// Programmatic overview fits may need to show a very large spatial layout in a
// compact host viewport. Keep this far below the interactive/manual floor so
// the fit is governed by the actual graph bounds rather than an arbitrary cap.
const minimumProgrammaticFitZoom = 0.0001;
const navigationDragThreshold = 5;
const keyboardOrbitStep = THREE.MathUtils.degToRad(8);

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
  layoutMetadata: null,
  presentationPlan: null,
  presentationStructureKey: '',
  presentationNodes: [],
  presentationEdges: [],
  presentationIndex: null,
  autoDetailLevel: DETAIL_LEVELS.OVERVIEW,
  detailLevel: DETAIL_LEVELS.OVERVIEW,
  detailReason: DETAIL_REASONS.ADAPTIVE_DEFAULT,
  userDetailLevel: '',
  sidebarState: 'collapsed',
  sidebarWidth: 360,
  sidebarResizePointerId: null,
  cameraHistory: [],
  cameraTransitionFrame: null,
  cameraTransitionToken: 0,
  programmaticCameraDepth: 0,
  navigationPointerId: null,
  navigationPointerStartX: 0,
  navigationPointerStartY: 0,
  navigationPointerLastX: 0,
  navigationPointerLastY: 0,
  navigationPointerRotates: false,
  navigationPointerDragged: false,
  suppressSelectionClickUntil: 0,
  historySuppressed: false,
  reduceMotion: prefersReducedMotion,
  degreeByNode: new Map(),
  adjacencyByNode: new Map(),
  edgesByNode: new Map(),
  edgeById: new Map(),
  projectedPoints: new Map(),
  activeLabelRects: new Map(),
  activeLabelBounds: [],
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
    normalizeGraphMs: 0,
    graphFetchMs: 0,
    graphJSONParseMs: 0,
    evidenceBuildMs: 0,
    graphPreparationMs: 0,
    applyLensPreLayoutMs: 0,
    metadataReplayMs: 0,
    presentationIndexBuildMs: 0,
    layoutCacheReadMs: 0,
    meshHitGeometryMs: 0,
    firstProjectionStaticPaintMs: 0,
    staticRebuildMs: 0,
    labelAllocationMs: 0,
    layoutPreparationMs: 0,
    layoutWorkerComputeMs: 0,
    layoutCommitMs: 0,
    layoutEndToEndMs: 0,
    layoutCache: 'disabled',
    overlayFrameMs: 0,
    visualPixelRatio: 1,
    visualBackingWidth: 0,
    visualBackingHeight: 0,
    staticRebuildSamples: [],
    staticHubGlowCount: 0,
    highlightedEdgeCount: 0,
    lastHitTestCandidateCount: 0,
    livingPulseCount: 0,
    ambientRecentCount: 0,
    ambientCurrentEdgeCount: 0,
    ambientCommunityPulseCount: 0,
    recentSparkCount: 0,
    panOrbitFrameMs: 0,
    hoverToHighlightMs: 0,
    selectionToFirstFeedbackMs: 0,
    sidebarOpenReframeMs: 0,
    overviewCommunityTransitionMs: 0
  },
  firstStaticPaintPending: false,
  pointer: new THREE.Vector2(),
  raycaster: new THREE.Raycaster(),
  nodeIndexById: new Map(),
  pendingNodeRevealId: '',
  pendingPointerEvent: null,
  pointerHitFrame: null,
  evidenceBuildFrame: null,
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
  readyGraphSnapshot: null,
  pendingLayoutContext: null,
  animationFrame: null,
  selectionStaticRefreshFrame: null,
  ambientFrame: null,
  ambientPhase: 0,
  lastAmbientTimestamp: 0
};

const transactionalGraphStateKeys = [
  'graph', 'evidenceInput', 'evidenceReport', 'evidenceNow', 'lens', 'communities', 'communityByName', 'communityEnabled',
  'visibleNodes', 'visibleEdges', 'visibleNodeIds', 'positions', 'layoutMetadata', 'presentationPlan', 'presentationStructureKey',
  'presentationNodes', 'presentationEdges', 'presentationIndex', 'autoDetailLevel', 'detailLevel', 'detailReason',
  'degreeByNode', 'adjacencyByNode', 'edgesByNode', 'edgeById', 'projectedPoints', 'activeLabelRects', 'activeLabelBounds',
  'visualCacheDirty', 'selectedNode', 'inspectedEdge', 'hoveredNode', 'hoveredEdge', 'hoverVisualNode', 'hoverTrails', 'edgeTrails',
  'hoverIntensity', 'focusMode', 'focusDepth', 'focusNodeId', 'focusNodeIds', 'focusEdgeIds', 'focusNodeDistance',
  'communitySpotlightName', 'communitySpotlightNodeIds', 'communitySpotlightEdgeIds', 'communitySpotlightFocusNodeIds',
  'communitySpotlightOverlayEdgeIds', 'communitySpotlightSummary', 'recentOrbitMode', 'recentOrbitNodeIds', 'recentOrbitActiveNodeId',
  'recentOrbitTargetNodeId', 'recentOrbitPathNodeIds', 'recentOrbitPathEdgeIds', 'recentOrbitOrderedNodeIds', 'recentOrbitOrderedEdgeIds',
  'recentOrbitItems', 'recentOrbitMessage', 'graphStoryMode', 'graphStorySteps', 'graphStoryStepIndex', 'graphStoryNodeIds',
  'graphStoryEdgeIds', 'graphStoryFocusNodeIds', 'graphStoryActiveNodeId', 'graphStoryActiveCommunityName', 'graphStoryMessage',
  'searchResultIds', 'searchRevealNodeId', 'searchRevealNeighborIds', 'searchRevealEdgeIds', 'searchRevealRestore', 'pathMode',
  'pathSourceId', 'pathTargetId', 'pathNodeIds', 'pathEdgeIds', 'pathOrderedNodeIds', 'pathOrderedEdgeIds', 'pathVariants',
  'activePathVariantId', 'pathMessage', 'pathPulsePhase', 'workflowHighlight', 'cameraPreset', 'lastFrameStatus',
  'visibleProjectedNodeCount', 'paintedNodeCount', 'paintedEdgeCount', 'paintedCountsSettled', 'visibleGraphRevision',
  'visualRevision', 'projectedPointGrid', 'overlayCache', 'spotlightCache', 'livingPulseEvents', 'ambientRecentNodeIds',
  'staticHubNodeIds', 'ambientCurrentEdgeIds', 'ambientCommunityPulseGroups', 'firstStaticPaintPending', 'committedLayoutContext'
];

function copyTransactionalGraphStateValue(value) {
  if (value instanceof Map) return new Map(value);
  if (value instanceof Set) return new Set(value);
  if (Array.isArray(value)) return value.slice();
  if (value && typeof value === 'object' && value.constructor === Object) return { ...value };
  return value;
}

function captureTransactionalGraphState() {
  const values = Object.fromEntries(transactionalGraphStateKeys.map((key) => [key, copyTransactionalGraphStateValue(state[key])]));
  return {
    values,
    cameraState: graphCameraState(),
    graphReady: Boolean(window.__brainBarGraphReady),
    layoutState: state.layoutState
  };
}

function restoreTransactionalGraphState(snapshot) {
  if (!snapshot?.values) return false;
  transactionalGraphStateKeys.forEach((key) => {
    state[key] = copyTransactionalGraphStateValue(snapshot.values[key]);
  });
  state.layoutState = snapshot.layoutState;
  rebuildMeshes();
  if (snapshot.cameraState) applyGraphCameraState(snapshot.cameraState, { schedule: false });
  markVisualCacheDirty();
  renderSidebar();
  updateOverlay();
  updateHud();
  requestRender();
  return true;
}

let renderer;
let scene;
let camera;
let controls;
let nodePoints;
let edgeLines;
let selectedMarker;

initScene();
wireEvents();
applySidebarState('collapsed', state.sidebarWidth, { announce: false, reframe: false });
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
  renderer.domElement.tabIndex = 0;
  renderer.domElement.setAttribute(
    'aria-label',
    'Interactive 3D graph. Drag to orbit, Shift-drag to pan, scroll to zoom, or use the arrow keys to orbit.'
  );
  stage.prepend(renderer.domElement);

  // Orthographic projection made an otherwise spatial layout read as a flat
  // diagram. Perspective is intentional here: depth changes apparent size and
  // creates parallax during orbit without changing any stored coordinates.
  camera = new THREE.PerspectiveCamera(48, 1, 0.1, 100000);
  camera.position.set(680, 640, 920);
  camera.lookAt(0, 0, 0);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = false;
  controls.enablePan = true;
  controls.enableZoom = true;
  // BrainBar owns primary-pointer orbit below so WebKit drag behavior is
  // deterministic and can never collapse into a node click. OrbitControls
  // continues to provide modifier/right-button pan and wheel dolly.
  controls.enableRotate = false;
  controls.zoomToCursor = true;
  controls.rotateSpeed = 0.96;
  controls.zoomSpeed = 1.08;
  controls.panSpeed = 0.82;
  // Keep the initial oblique reading available and prevent accidental flips
  // underneath the graph, where labels and depth cues stop being intelligible.
  controls.minPolarAngle = 0.22;
  controls.maxPolarAngle = Math.PI - 0.22;
  controls.minDistance = 90;
  controls.maxDistance = 100000;
  controls.screenSpacePanning = true;
  controls.target.set(0, 0, 0);
  controls.addEventListener('change', () => {
    if (!state.programmaticCameraDepth) {
      markLivingInteraction();
      cancelCameraTransition();
      state.cameraPreset = 'manual';
    }
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

async function applyLens(fit = true, { generation = null, emitGraphReady = false, rollbackSnapshot = state.readyGraphSnapshot } = {}) {
  let layoutContext = null;
  try {
    const graph = state.graph;
    if (!graph) {
      return false;
    }
    const preLayoutStartedAt = performance.now();
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
    rebuildQueryableGraphIndexes();
    state.presentationNodes = state.visibleNodes.map((node) => ({ id: node.id, community: node.community }));
    state.presentationEdges = state.visibleEdges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target }));
    state.presentationStructureKey = '';
    state.presentationIndex = null;
    state.autoDetailLevel = adaptiveDetailLevel(state.visibleNodes.length);
    state.firstStaticPaintPending = true;
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
    state.performanceStats.applyLensPreLayoutMs = performance.now() - preLayoutStartedAt;

    layoutContext = {
      graphGeneration: generation ?? state.graphGeneration,
      lens: state.lens,
      visibleGraphRevision: state.visibleGraphRevision,
      rollbackSnapshot,
      candidate: captureTransactionalGraphState()
    };
    if (rollbackSnapshot) {
      state.pendingLayoutContext = layoutContext;
      window.__brainBarGraphReady = true;
    }
    const layoutPromise = requestLayout(layoutContext);
    if (state.pendingLayoutContext === layoutContext) {
      restoreTransactionalGraphState(rollbackSnapshot);
    }
    const didLayout = await layoutPromise;
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
    state.readyGraphSnapshot = captureTransactionalGraphState();
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
    failLayout(layoutContext);
    return false;
  }
}

function normalizeLens(lens) {
  return lens === 'obsidian' || lens === 'graphify' ? lens : 'all';
}

function activeMode() {
  return activeModeFromState(state);
}

function effectiveReduceMotion() {
  return Boolean(state.reduceMotion || prefersReducedMotion);
}

function setReduceMotion(value) {
  state.reduceMotion = Boolean(value);
  if (effectiveReduceMotion()) {
    cancelCameraTransition();
    if (state.ambientFrame) {
      cancelAnimationFrame(state.ambientFrame);
      state.ambientFrame = null;
    }
    state.pathPulsePhase = 0;
    clearLivingPulses(false);
  } else {
    startAmbientMotion();
  }
  markVisualCacheDirty();
  requestRender();
  scheduleGraphSessionState();
  return effectiveReduceMotion();
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
  if (effectiveReduceMotion() || state.overlayQuality === 'low') {
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
  if (!edgeGlintsRuntimeEnabled || effectiveReduceMotion() || state.overlayQuality === 'low') {
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
  state.layoutMetadata = null;
  state.presentationPlan = null;
  const epoch = ++state.layoutEpoch;
  layoutContext.epoch = epoch;
  const { graphGeneration, lens, visibleGraphRevision } = layoutContext;
  state.layoutState = 'starting';
  state.performanceStats.layoutPreparationMs = 0;
  state.performanceStats.layoutWorkerComputeMs = 0;
  state.performanceStats.layoutCommitMs = 0;
  state.performanceStats.layoutEndToEndMs = 0;
  state.performanceStats.layoutCacheReadMs = 0;
  state.performanceStats.presentationIndexBuildMs = 0;
  state.performanceStats.meshHitGeometryMs = 0;
  state.performanceStats.firstProjectionStaticPaintMs = 0;
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
  Object.assign(layoutContext, { graphGeneration, lens, visibleGraphRevision, nodes, edges });
  const context = layoutContext;

  return new Promise((resolve) => {
    const request = {
      resolve,
      context,
      ready: false,
      readyTimer: null,
      resultTimer: null,
      settled: false,
      worker: null,
      startedAt: performance.now()
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
    if (state.pendingLayoutContext !== request.context) {
      state.layoutState = 'holding-cache';
    }
    await new Promise((resolve) => {
      state.heldLayoutCacheLookup = { request, resolve };
    });
  }
  const cacheReadStartedAt = performance.now();
  const cachedLayout = await readLayoutCacheLayout(cacheIdentity, request.context.nodes.length);
  state.performanceStats.layoutCacheReadMs = performance.now() - cacheReadStartedAt;
  if (state.activeLayoutRequest !== request || request.settled || !isCurrentLayoutContext(request.context)) {
    return;
  }
  if (cachedLayout) {
    const positions = unpackCachedLayoutPositions(cachedLayout.coordinates, request.context.nodes);
    if (positions) {
      activateLayoutCandidate(request.context);
      const commitStartedAt = performance.now();
      state.positions = positions;
      state.layoutMetadata = cachedLayout.communityLayout;
      rebuildPresentationIndex();
      rebuildPresentationPlan();
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
        if (state.pendingLayoutContext !== context) {
          state.layoutState = 'running';
        }
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
          if (state.pendingLayoutContext !== context) {
            state.layoutState = 'holding';
          }
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
  if (state.pendingLayoutContext === request.context) {
    state.pendingLayoutContext = null;
  }
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

function failHeldLayoutWorkerResult() {
  const held = state.heldLayoutResult;
  state.heldLayoutResult = null;
  if (!held || state.activeLayoutRequest !== held.request || held.request.settled) {
    return false;
  }
  finishLayoutFailure(held.request.context, held.request.resolve);
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
  const layoutMetadata = unpackLayoutMetadata(result, context.nodes);
  if (!positions || !layoutMetadata) {
    finishLayoutFailure(context, request.resolve);
    return;
  }
  activateLayoutCandidate(context);
  const commitStartedAt = performance.now();
  state.positions = positions;
  state.layoutMetadata = layoutMetadata;
  rebuildPresentationIndex();
  rebuildPresentationPlan();
  state.performanceStats.layoutWorkerComputeMs = Number.isFinite(result.workerComputeMs) ? result.workerComputeMs : 0;
  state.performanceStats.layoutCommitMs = performance.now() - commitStartedAt;
  state.layoutState = 'committed';
  state.committedLayoutContext = context;
  const cacheIdentity = currentLayoutCacheIdentity(context);
  if (cacheIdentity) {
    void writeLayoutCache(cacheIdentity, context.nodes.length, result.positions, {
      communityCount: layoutMetadata.communityCount,
      communityIndexByNode: result.communityIndexByNode,
      communityCenters: result.communityCenters,
      communityBounds: result.communityBounds,
      structuralRanks: result.structuralRanks
    }).then((didWrite) => {
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
    failLayout(context);
  }
}

function settleLayoutRequest(request, value) {
  if (request.settled) {
    return;
  }
  request.settled = true;
  if (state.activeLayoutRequest === request) {
    state.performanceStats.layoutEndToEndMs = performance.now() - request.startedAt;
  }
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
  if (state.pendingLayoutContext === context) {
    return context.graphGeneration === state.graphGeneration
      && context.epoch === state.layoutEpoch;
  }
  return context.graphGeneration === state.graphGeneration
    && context.lens === state.lens
    && context.visibleGraphRevision === state.visibleGraphRevision
    && context.epoch === state.layoutEpoch;
}

function activateLayoutCandidate(context) {
  if (state.pendingLayoutContext !== context) return false;
  state.pendingLayoutContext = null;
  return restoreTransactionalGraphState(context.candidate);
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

function unpackLayoutMetadata(result, expectedNodes) {
  const count = expectedNodes.length;
  const communityCount = Number(result?.communityCount);
  if (!Number.isSafeInteger(communityCount) || communityCount < 0
    || !(result?.communityIndexByNode instanceof ArrayBuffer)
    || !(result?.communityCenters instanceof ArrayBuffer)
    || !(result?.communityBounds instanceof ArrayBuffer)
    || !(result?.structuralRanks instanceof ArrayBuffer)
    || result.communityIndexByNode.byteLength !== count * Uint32Array.BYTES_PER_ELEMENT
    || result.structuralRanks.byteLength !== count * Uint32Array.BYTES_PER_ELEMENT
    || result.communityCenters.byteLength !== communityCount * 3 * Float64Array.BYTES_PER_ELEMENT
    || result.communityBounds.byteLength !== communityCount * 6 * Float64Array.BYTES_PER_ELEMENT) {
    return null;
  }
  const communityIndexByNode = new Uint32Array(result.communityIndexByNode);
  const structuralRanks = new Uint32Array(result.structuralRanks);
  const communityCenters = new Float64Array(result.communityCenters);
  const communityBounds = new Float64Array(result.communityBounds);
  if (![...communityCenters, ...communityBounds].every(Number.isFinite)) return null;
  for (let index = 0; index < count; index += 1) {
    if (communityIndexByNode[index] >= communityCount || structuralRanks[index] >= count) return null;
  }
  for (let index = 0; index < communityCount; index += 1) {
    const offset = index * 6;
    if (communityBounds[offset] > communityBounds[offset + 1]
      || communityBounds[offset + 2] > communityBounds[offset + 3]
      || communityBounds[offset + 4] > communityBounds[offset + 5]) return null;
  }
  return { communityCount, communityIndexByNode, structuralRanks, communityCenters, communityBounds };
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

function failLayout(context = null) {
  if (context && state.pendingLayoutContext === context && context.rollbackSnapshot) {
    restoreTransactionalGraphState(context.rollbackSnapshot);
    state.pendingLayoutContext = null;
    state.layoutState = 'committed';
    window.__brainBarGraphReady = true;
    reportDiagnostic('3D graph refresh could not be completed. Retry.', true, context.graphGeneration);
    return;
  }
  window.__brainBarGraphReady = false;
  reportDiagnostic('3D graph layout could not be completed. Retry.', true);
}

function flushPendingNodeReveal() {
  const nodeId = state.pendingNodeRevealId;
  state.pendingNodeRevealId = '';
  const node = nodeId ? nodeForId(nodeId) : null;
  if (node) {
    revealSearchNode(node);
  }
}

function rebuildQueryableGraphIndexes() {
  const degreeByNode = new Map(state.visibleNodes.map((node) => [node.id, 0]));
  const adjacencyByNode = new Map(state.visibleNodes.map((node) => [node.id, new Set()]));
  const edgesByNode = new Map(state.visibleNodes.map((node) => [node.id, []]));
  const edgeById = new Map();
  state.visibleEdges.forEach((edge) => {
    degreeByNode.set(edge.source, (degreeByNode.get(edge.source) ?? 0) + 1);
    degreeByNode.set(edge.target, (degreeByNode.get(edge.target) ?? 0) + 1);
    adjacencyByNode.get(edge.source)?.add(edge.target);
    adjacencyByNode.get(edge.target)?.add(edge.source);
    edgesByNode.get(edge.source)?.push(edge);
    edgesByNode.get(edge.target)?.push(edge);
    edgeById.set(edge.id, edge);
  });
  state.degreeByNode = degreeByNode;
  state.adjacencyByNode = adjacencyByNode;
  state.edgesByNode = edgesByNode;
  state.edgeById = edgeById;
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
  const startedAt = performance.now();
  removeGraphObjects();
  state.nodeIndexById = new Map();

  const nodePositions = new Float32Array(state.visibleNodes.length * 3);
  const nodeColors = new Float32Array(state.visibleNodes.length * 3);
  const nodeSizes = new Float32Array(state.visibleNodes.length);
  const degreeMap = state.degreeByNode;
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
  state.performanceStats.meshHitGeometryMs = performance.now() - startedAt;
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
  const normalizedPreset = normalizedCameraPreset(preset);
  if (normalizedPreset === 'node-focus' && state.selectedNode) {
    focusNode(state.selectedNode, 'node-focus', { immediate: true });
    return;
  }
  if (normalizedPreset === 'community' && state.communitySpotlightSummary) {
    focusCommunitySpotlight(state.communitySpotlightSummary);
    return;
  }
  fitCameraWithTilt(preset, 1.12, 0.54);
}

function fitCameraWithTilt(preset, zTilt, heightMultiplier) {
  if (!state.visibleNodes.length || !state.positions.size) {
    state.cameraPreset = normalizedCameraPreset(preset);
    markVisualCacheDirty();
    requestRender();
    return;
  }

  const bounds = boundsForVisibleNodes();
  const width = Math.max(bounds.maxX - bounds.minX, 120);
  const depth = Math.max(bounds.maxZ - bounds.minZ, 120);
  const height = Math.max(bounds.maxY - bounds.minY, 120);
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  const centerZ = (bounds.minZ + bounds.maxZ) / 2;
  const farthestBoundDistance = Math.hypot(width / 2, height / 2, depth / 2);
  const frame = unobscuredCameraFrame();
  // With a perspective oblique camera, independent X/Z spans under-estimate
  // the projected diagonal and crop dense graph corners. Fit the enclosing
  // sphere instead, leaving the declared breathing margin in every orbit.
  const enclosingDiameter = farthestBoundDistance * 2;
  let cameraDistance = perspectiveDistanceForSpan(Math.max(
    enclosingDiameter * 1.12,
    (enclosingDiameter * 1.12) / Math.max(frame.width / frame.height, 0.2)
  ));

  withProgrammaticCamera(() => {
    const semanticCenter = new THREE.Vector3(centerX, centerY, centerZ);
    controls.target.copy(cameraTargetForSafeFrame(semanticCenter, frame, cameraDistance));
    const direction = new THREE.Vector3(0.36, heightMultiplier, zTilt).normalize();
    camera.position.copy(controls.target).addScaledVector(direction, cameraDistance);
    camera.lookAt(controls.target);
    camera.far = Math.max(10000, cameraDistance + farthestBoundDistance * 2 + 256);
    camera.zoom = 1;
    camera.updateProjectionMatrix();
    // Refine the conservative sphere estimate in camera space. This fills the
    // useful viewport without clipping oblique AABB corners or leaving a tiny
    // graph in the middle of the stage.
    for (let pass = 0; pass < 3; pass += 1) {
      camera.updateMatrixWorld();
      const span = projectedBoundsForWorldBounds(bounds);
      // Keep the AABB itself inside an 8–12% safe margin. The painted set is
      // intentionally a high-signal subset, so this fuller (but uncropped)
      // AABB fit prevents an Overview from reading as a miniature.
      const scale = Math.max(span.width / 1.70, span.height / 1.75);
      if (!Number.isFinite(scale) || Math.abs(scale - 1) < 0.025) break;
      cameraDistance = clamp(cameraDistance * scale, controls.minDistance, controls.maxDistance);
      camera.position.copy(controls.target).addScaledVector(direction, cameraDistance);
      camera.lookAt(controls.target);
      camera.far = Math.max(10000, cameraDistance + farthestBoundDistance * 2 + 256);
      camera.updateProjectionMatrix();
    }
    controls.update();
  });

  state.cameraPreset = normalizedCameraPreset(preset);
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
  const widthSpan = Math.max(bounds.maxX - bounds.minX, options.minimumSpan ?? 160);
  const heightSpan = Math.max(bounds.maxY - bounds.minY, options.minimumSpan ?? 160);
  const depthSpan = Math.max(bounds.maxZ - bounds.minZ, options.minimumSpan ?? 160);
  const widthPadding = options.widthPadding ?? 1.18;
  const heightPadding = options.heightPadding ?? 0.96;
  const frame = unobscuredCameraFrame();
  const viewportAspect = Math.max(frame.width / frame.height, 0.2);
  const enclosingDiameter = Math.hypot(widthSpan, heightSpan, depthSpan);
  const cameraDistance = perspectiveDistanceForSpan(Math.max(
    enclosingDiameter * heightPadding,
    (enclosingDiameter * widthPadding) / viewportAspect
  ));
  const semanticTarget = options.semanticTarget ?? center;
  orbitCameraTo(cameraTargetForSafeFrame(semanticTarget, frame, cameraDistance), 1, preset, {
    immediate: Boolean(options.immediate),
    cameraDistance
  });
}

function perspectiveDistanceForSpan(span) {
  const fovRadians = THREE.MathUtils.degToRad(camera?.fov ?? 48);
  return clamp((Math.max(span, 1) / 2) / Math.tan(fovRadians / 2), 90, 90000);
}

function projectedBoundsForWorldBounds(bounds) {
  const points = [];
  for (const x of [bounds.minX, bounds.maxX]) {
    for (const y of [bounds.minY, bounds.maxY]) {
      for (const z of [bounds.minZ, bounds.maxZ]) {
        points.push(new THREE.Vector3(x, y, z).project(camera));
      }
    }
  }
  const finite = points.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  if (!finite.length) return { width: Infinity, height: Infinity };
  const extent = finite.reduce((result, point) => ({
    minX: Math.min(result.minX, point.x), maxX: Math.max(result.maxX, point.x),
    minY: Math.min(result.minY, point.y), maxY: Math.max(result.maxY, point.y)
  }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
  return {
    ...extent,
    width: extent.maxX - extent.minX,
    height: extent.maxY - extent.minY
  };
}

function paintedProjectedCoverage() {
  const width = Math.max(stage.clientWidth, 1);
  const height = Math.max(stage.clientHeight, 1);
  const paintedNodeIds = state.presentationPlan?.paintedNodeIds ?? [];
  const points = paintedNodeIds
    .map((nodeId) => state.projectedPoints.get(nodeId))
    .filter(Boolean);
  if (!points.length) return null;
  const extent = points.reduce((result, point) => ({
    minX: Math.min(result.minX, point.x), maxX: Math.max(result.maxX, point.x),
    minY: Math.min(result.minY, point.y), maxY: Math.max(result.maxY, point.y)
  }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
  return {
    x: extent.minX / width,
    y: extent.minY / height,
    width: (extent.maxX - extent.minX) / width,
    height: (extent.maxY - extent.minY) / height
  };
}

function unobscuredCameraFrame() {
  const width = Math.max(stage.clientWidth, 1);
  const height = Math.max(stage.clientHeight, 1);
  const frame = { x: 0, y: 0, width, height };
  presentationSafeRegions().forEach((region) => {
    const verticallyDominant = region.height >= height * 0.7 && region.y <= height * 0.15 && region.y + region.height >= height * 0.85;
    if (!verticallyDominant) return;
    if (region.x <= width * 0.15 && region.x + region.width < width) {
      const nextX = region.x + region.width + 8;
      frame.width = Math.max(1, width - nextX);
      frame.x = nextX;
    } else if (region.x + region.width >= width * 0.85 && region.x > 0) {
      frame.width = Math.max(1, region.x - 8);
    }
  });
  return frame;
}

function cameraTargetForSafeFrame(semanticTarget, frame = unobscuredCameraFrame(), cameraDistance = camera.position.distanceTo(controls.target)) {
  const target = semanticTarget?.isVector3
    ? semanticTarget
    : new THREE.Vector3(semanticTarget?.x ?? 0, semanticTarget?.y ?? 0, semanticTarget?.z ?? 0);
  const width = Math.max(stage.clientWidth, 1);
  const height = Math.max(stage.clientHeight, 1);
  const offsetX = frame.x + frame.width / 2 - width / 2;
  const offsetY = frame.y + frame.height / 2 - height / 2;
  if (!offsetX && !offsetY) return target.clone();
  camera.updateMatrixWorld();
  const visibleHeight = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * Math.max(cameraDistance, 1) / Math.max(camera.zoom, 0.01);
  const visibleWidth = visibleHeight * Math.max(camera.aspect, 0.2);
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
  const screenOffset = right.multiplyScalar(offsetX / width * visibleWidth)
    .add(up.multiplyScalar(-offsetY / height * visibleHeight));
  return target.clone().sub(screenOffset);
}

function fitCameraToNodeIds(nodeIds, preset, options = {}) {
  const positions = Array.from(nodeIds || [])
    .map((nodeId) => state.positions.get(nodeId))
    .filter(Boolean);
  fitCameraToPositions(positions, preset, options);
}

function resize() {
  if (state.sidebarState === 'docked' && window.innerWidth < 760) {
    applySidebarState('overlay', state.sidebarWidth, { announce: false, reframe: false });
  }
  const rect = stage.getBoundingClientRect();
  const width = Math.max(Math.floor(rect.width), 1);
  const height = Math.max(Math.floor(rect.height), 1);

  renderer.setSize(width, height, false);
  markVisualCacheDirty();
  camera.aspect = width / height;
  camera.updateProjectionMatrix();

  if (state.graph && normalizedCameraPreset(state.cameraPreset) !== 'manual') {
    requestAnimationFrame(() => fitCameraToGraph(normalizedCameraPreset(state.cameraPreset)));
  }
  requestRender();
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
  const diagnostics = state.presentationPlan?.diagnostics;
  state.paintedNodeCount = diagnostics?.paintedNodeCount ?? 0;
  state.paintedEdgeCount = diagnostics?.paintedEdgeCount ?? 0;
  state.paintedCountsSettled = true;
}

function presentationInteraction() {
  return {
    selectedNodeId: state.selectedNode?.id,
    focusedNodeIds: [...state.focusNodeIds],
    searchNodeIds: state.searchResultIds,
    searchRevealNodeId: state.searchRevealNodeId,
    pathNodeIds: [...state.pathNodeIds],
    pathEdgeIds: [...state.pathEdgeIds],
    workflowNodeIds: state.workflowHighlight.nodeIds,
    activityNodeIds: [...state.agentActivityNodeIds],
    storyNodeIds: [...state.graphStoryNodeIds],
    storyEdgeIds: [...state.graphStoryEdgeIds],
    recentNodeIds: [...state.recentOrbitNodeIds],
    edgeInspectorEdgeId: state.inspectedEdge?.id
  };
}

function presentationInteractionKey(interaction) {
  const ids = (value) => Array.from(value || []).map(String).sort().join(',');
  return [
    interaction.selectedNodeId || '',
    ids(interaction.focusedNodeIds),
    ids(interaction.searchNodeIds),
    interaction.searchRevealNodeId || '',
    ids(interaction.pathNodeIds),
    ids(interaction.pathEdgeIds),
    ids(interaction.workflowNodeIds),
    ids(interaction.activityNodeIds),
    ids(interaction.storyNodeIds),
    ids(interaction.storyEdgeIds),
    ids(interaction.recentNodeIds),
    interaction.edgeInspectorEdgeId || ''
  ].join('|');
}

function rebuildPresentationIndex() {
  if (!state.presentationNodes.length) {
    state.presentationIndex = null;
    return null;
  }
  const startedAt = performance.now();
  state.presentationIndex = buildPresentationIndex({
    normalizedNodes: state.presentationNodes,
    normalizedEdges: state.presentationEdges,
    structuralRanks: state.layoutMetadata?.structuralRanks,
    degreeByNode: state.degreeByNode,
    edgesByNode: state.edgesByNode
  });
  state.performanceStats.presentationIndexBuildMs = performance.now() - startedAt;
  state.presentationStructureKey = '';
  return state.presentationIndex;
}

function presentationSafeRegions() {
  return [hud, navigationHint, state.sidebarState === 'overlay' ? sidebar : null]
    .map(stageClientRectForElement)
    .filter(Boolean);
}

function presentationLabelBounds() {
  const inset = 10;
  return {
    x: inset,
    y: inset,
    width: Math.max(1, stage.clientWidth - inset * 2),
    height: Math.max(1, stage.clientHeight - inset * 2)
  };
}

function stageClientRectForElement(element) {
  if (!element || element.hidden || !element.isConnected) return null;
  const stageRect = stage.getBoundingClientRect();
  const rect = element.getBoundingClientRect();
  const left = Math.max(rect.left, stageRect.left);
  const top = Math.max(rect.top, stageRect.top);
  const right = Math.min(rect.right, stageRect.right);
  const bottom = Math.min(rect.bottom, stageRect.bottom);
  if (right <= left || bottom <= top) return null;
  return {
    x: left - stageRect.left,
    y: top - stageRect.top,
    width: right - left,
    height: bottom - top
  };
}

function rectangleOverlapsAny(rectangle, regions) {
  return regions.some((region) => rectanglesOverlap(rectangle, region));
}

function pointIsObscured(point, regions = presentationSafeRegions()) {
  return regions.some((region) => (
    point.x >= region.x
    && point.x <= region.x + region.width
    && point.y >= region.y
    && point.y <= region.y + region.height
  ));
}

function rebuildPresentationPlan(projectedNodes = undefined) {
  if (!state.visibleNodes.length) {
    state.presentationPlan = null;
    state.paintedNodeCount = 0;
    state.paintedEdgeCount = 0;
    return null;
  }
  const interaction = presentationInteraction();
  // Perspective navigation uses camera distance rather than camera.zoom. A
  // fixed PerspectiveCamera zoom of 1 must not be mistaken for a user request
  // to promote a 25k Overview into its heavier level.
  const detailZoom = camera?.isPerspectiveCamera
    ? (state.visibleNodes.length > 16_000 && state.autoDetailLevel === DETAIL_LEVELS.OVERVIEW ? 0 : 1)
    : camera?.zoom ?? 0;
  const defaultAutoDetail = adaptiveDetailLevel(state.visibleNodes.length);
  const detailOverride = state.userDetailLevel || (state.communitySpotlightName ? DETAIL_LEVELS.OVERVIEW : '');
  const automatic = resolveZoomDetailLevel({
    nodeCount: state.visibleNodes.length,
    zoom: detailZoom,
    previousAutoDetailLevel: state.presentationStructureKey ? state.autoDetailLevel : defaultAutoDetail,
    userDetailLevel: detailOverride
  });
  state.autoDetailLevel = automatic.nextAutoDetailLevel;
  const level = detailOverride || automatic.detailLevel;
  const reason = state.userDetailLevel
    ? DETAIL_REASONS.USER
    : (state.communitySpotlightName ? DETAIL_REASONS.FOCUS_OVERRIDE : automatic.detailReason);
  const structureKey = [state.visibleGraphRevision, level, reason, presentationInteractionKey(interaction)].join(':');
  let plan = state.presentationPlan;
  if (!plan || state.presentationStructureKey !== structureKey) {
    const planStartedAt = performance.now();
    plan = buildPresentationPlan({
      nodes: state.presentationNodes,
      edges: state.presentationEdges,
      index: state.presentationIndex,
      detailLevel: level,
      detailReason: reason,
      zoom: detailZoom,
      previousAutoDetailLevel: state.autoDetailLevel,
      userDetailLevel: detailOverride,
      interaction,
      structuralRanks: state.layoutMetadata?.structuralRanks,
      reduceMotion: effectiveReduceMotion()
    });
    state.performanceStats.staticPlanMs = performance.now() - planStartedAt;
    state.presentationStructureKey = structureKey;
    state.presentationPlan = plan;
  }
  const labelStartedAt = performance.now();
  const labels = allocateLabels({
    candidates: plan.paintedNodeIds.map((id) => {
      const node = nodeForId(id);
      return {
        id,
        degree: state.degreeByNode.get(id) ?? 0,
        tier: plan.nodeTiersById.get(id) ?? 'D',
        active: id === state.selectedNode?.id || state.pathNodeIds.has(id) || state.searchResultIds.includes(id),
        point: projectedNodes?.get(id)
      };
    }),
    projectedNodes,
    safeRegions: presentationSafeRegions(),
    bounds: presentationLabelBounds(),
    retainedLabelIds: plan.persistentLabels?.map((label) => label.id) ?? [],
    labelMetrics: (candidate) => persistentLabelMetrics(nodeForId(candidate.id), candidate.tier),
    budget: labelBudgetForMode(activeMode(), {
      hasSelected: Boolean(state.selectedNode),
      hasHover: Boolean(state.hoveredNode)
    })
  });
  const primaryLabelIds = new Set([state.selectedNode?.id, state.hoveredNode?.id].filter(Boolean));
  buildNodeFocusMap([], []).forEach((focus, nodeId) => {
    if (focus.self > 0.02) primaryLabelIds.add(nodeId);
  });
  plan.persistentLabels = labels.filter((label) => !primaryLabelIds.has(label.id));
  plan.diagnostics.persistentLabelCount = plan.persistentLabels.length;
  state.detailLevel = plan.detailLevel;
  state.detailReason = plan.detailReason;
  if (detailLevelControl) detailLevelControl.value = plan.detailLevel;
  state.performanceStats.labelAllocationMs = performance.now() - labelStartedAt;
  state.paintedNodeCount = plan.diagnostics.paintedNodeCount;
  state.paintedEdgeCount = plan.diagnostics.paintedEdgeCount;
  state.paintedCountsSettled = true;
  return plan;
}

function persistentLabelMetrics(node, tier) {
  const isHub = tier === 'B';
  staticVisualContext.font = `${isHub ? 600 : 520} ${isHub ? 12 : 11}px -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif`;
  return {
    labelWidth: Math.ceil(staticVisualContext.measureText(compactNodeLabel(node?.label)).width) + 14,
    labelHeight: isHub ? 20 : 18
  };
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

  state.performanceStats.visualBackingWidth = backingWidth;
  state.performanceStats.visualBackingHeight = backingHeight;

  return { width, height, pixelRatio };
}

function visualOverlayPixelRatio() {
  const deviceRatio = Math.min(window.devicePixelRatio || 1, 2);
  const nodeCount = state.presentationPlan?.diagnostics?.paintedNodeCount ?? state.visibleNodes.length;
  const edgeCount = state.presentationPlan?.diagnostics?.paintedEdgeCount ?? state.visibleEdges.length;
  if (state.detailLevel === DETAIL_LEVELS.BALANCED && nodeCount <= 10_000 && edgeCount <= 12_000) {
    return Math.min(deviceRatio, balancedOverlayPixelRatio);
  }
  if (nodeCount >= overlayVeryDenseNodeThreshold || edgeCount >= overlayVeryDenseEdgeThreshold) {
    return Math.min(deviceRatio, 1);
  }
  if (nodeCount >= overlayDenseNodeThreshold || edgeCount >= overlayDenseEdgeThreshold) {
    return Math.min(deviceRatio, 1.25);
  }
  return deviceRatio;
}

function staticRebuildPercentile(percentile) {
  const samples = state.performanceStats.staticRebuildSamples;
  if (!samples.length) return 0;
  const sorted = [...samples].sort((left, right) => left - right);
  const position = (sorted.length - 1) * clamp(percentile, 0, 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function rebuildStaticVisualLayer({ width, height, pixelRatio }) {
  const startedAt = performance.now();
  camera.updateMatrixWorld();
  const projected = new Map();
  const vector = new THREE.Vector3();
  let projectedNodeCount = 0;
  const plan = rebuildPresentationPlan();
  const paintedNodeIds = new Set(plan?.paintedNodeIds ?? []);
  const projectedNodeIds = new Set(paintedNodeIds);
  activeAmbientNodeIds().forEach((nodeId) => projectedNodeIds.add(nodeId));
  if (state.hoveredNode?.id) projectedNodeIds.add(state.hoveredNode.id);
  activeCurrentEdgeIds().forEach((edgeId) => {
    const edge = state.edgeById.get(edgeId);
    if (edge) {
      projectedNodeIds.add(edge.source);
      projectedNodeIds.add(edge.target);
    }
  });

  projectedNodeIds.forEach((nodeId) => {
    const node = nodeForId(nodeId);
    if (!node) return;
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
  rebuildPresentationPlan(projected);
  const paintedEdgeIds = new Set(plan?.paintedEdgeIds ?? []);
  staticVisualContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  staticVisualContext.globalAlpha = 1;
  staticVisualContext.clearRect(0, 0, width, height);

  const baseEdgePath = new Path2D();

  paintedEdgeIds.forEach((edgeId) => {
    const edge = state.edgeById.get(edgeId);
    if (!edge) return;
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
  staticVisualContext.globalAlpha = state.detailLevel === DETAIL_LEVELS.OVERVIEW ? 0.14 : balancedEdgeAlpha;
  staticVisualContext.strokeStyle = baseEdgeColor;
  staticVisualContext.stroke(baseEdgePath);
  staticVisualContext.restore();

  paintedNodeIds.forEach((nodeId) => {
    const node = nodeForId(nodeId);
    if (!node) return;
    const point = projected.get(node.id);
    if (!point) {
      return;
    }
    const degree = state.degreeByNode.get(node.id) ?? 0;
    const tier = plan?.nodeTiersById?.get(node.id) ?? 'D';
    const depth = depthPresence(point.z);
    const tierScale = tier === 'A' ? 1.42 : (tier === 'B' ? 1.18 : (tier === 'C' ? 1 : 0.78));
    const radius = nodeRadiusForDegree(degree, depth) * tierScale;
    staticVisualContext.save();
    staticVisualContext.beginPath();
    staticVisualContext.arc(point.x, point.y, radius, 0, Math.PI * 2);
    staticVisualContext.fillStyle = '#070b14';
    staticVisualContext.globalAlpha = 0.9;
    staticVisualContext.fill();
    staticVisualContext.beginPath();
    staticVisualContext.arc(point.x, point.y, Math.max(radius - darkSeparationRimWidth, 1.05), 0, Math.PI * 2);
    staticVisualContext.fillStyle = colorForCommunity(node.community);
    staticVisualContext.globalAlpha = tier === 'D'
      ? balancedDiscMinimumAlpha
      : Math.min(0.92, balancedDiscMinimumAlpha + depth * 0.14);
    staticVisualContext.fill();
    staticVisualContext.restore();
  });

  drawPersistentPresentationLabels(plan, projected);

  state.visualCacheDirty = false;
  state.performanceStats.staticRebuildMs = performance.now() - startedAt;
  state.performanceStats.staticRebuildSamples.push(state.performanceStats.staticRebuildMs);
  if (state.performanceStats.staticRebuildSamples.length > 12) state.performanceStats.staticRebuildSamples.shift();
  if (state.firstStaticPaintPending) {
    state.performanceStats.firstProjectionStaticPaintMs = state.performanceStats.staticRebuildMs;
    state.firstStaticPaintPending = false;
  }
}

function drawPersistentPresentationLabels(plan, projected) {
  const labels = plan?.persistentLabels ?? [];
  if (!labels.length) return;
  staticVisualContext.save();
  staticVisualContext.textBaseline = 'middle';
  labels.forEach((candidate) => {
    if (candidate.id === state.selectedNode?.id) return;
    const point = projected.get(candidate.id);
    const node = nodeForId(candidate.id);
    if (!point || !node) return;
    const label = compactNodeLabel(node.label);
    const box = candidate.rect;
    const emphasized = candidate.active || candidate.tier === 'A';
    staticVisualContext.fillStyle = emphasized ? 'rgba(8, 12, 22, 0.88)' : 'rgba(8, 12, 22, 0.68)';
    staticVisualContext.strokeStyle = emphasized ? 'rgba(181, 200, 255, 0.42)' : 'rgba(255, 255, 255, 0.12)';
    staticVisualContext.lineWidth = 1;
    roundedRect(staticVisualContext, box.x, box.y, box.width, box.height, 5);
    staticVisualContext.fill();
    staticVisualContext.stroke();
    staticVisualContext.fillStyle = emphasized ? '#f2f5ff' : 'rgba(224, 230, 244, 0.86)';
    staticVisualContext.font = `${candidate.tier === 'B' ? 600 : 520} ${candidate.tier === 'B' ? 12 : 11}px -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif`;
    staticVisualContext.fillText(label, box.x + 7, box.y + box.height / 2);
  });
  staticVisualContext.restore();
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
  const painted = new Set(state.presentationPlan?.paintedNodeIds ?? []);
  staticVisualContext.save();
  state.staticHubNodeIds.forEach((nodeId) => {
    if (!painted.has(nodeId)) return;
    if (state.presentationPlan?.nodeTiersById?.get(nodeId) !== 'B') return;
    const node = nodeForId(nodeId);
    const point = projected.get(nodeId);
    if (!node || !point) {
      return;
    }
    const degree = state.degreeByNode.get(nodeId) ?? 0;
    const depth = depthPresence(point.z);
    const radius = nodeRadiusForDegree(degree, depth);
    const color = accentColorForCommunity(node.community);
    const haloRadius = radius + clamp(Math.log1p(degree) * 1.2, 3.5, 8);
    staticVisualContext.beginPath();
    staticVisualContext.arc(point.x, point.y, haloRadius, 0, Math.PI * 2);
    staticVisualContext.fillStyle = color;
    staticVisualContext.globalAlpha = (0.024 + depth * 0.018) * (effectiveReduceMotion() ? 0.65 : 1);
    staticVisualContext.shadowColor = color;
    staticVisualContext.shadowBlur = effectiveReduceMotion() ? 0 : staticHubHaloBlur;
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
    !effectiveReduceMotion() &&
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
  if (state.pathMode && state.pathOrderedEdgeIds.length && !effectiveReduceMotion()) {
    state.pathPulsePhase = performance.now() * 0.001;
    requestRender();
  }
  if (responsePulseRuntimeEnabled && state.livingPulseEvents.length && !effectiveReduceMotion() && state.overlayQuality !== 'low') {
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
      reducedMotion: effectiveReduceMotion()
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
    const wave = effectiveReduceMotion() ? 0.35 : (Math.sin(phase * 0.84 + hashString(nodeId) * 0.003) + 1) * 0.5;
    const radius = baseRadius + 2.8 + wave * 2.2;
    visualContext.beginPath();
    visualContext.arc(point.x, point.y, radius + 4.5, 0, Math.PI * 2);
    visualContext.fillStyle = accentColorForCommunity(node.community);
    visualContext.globalAlpha = (effectiveReduceMotion() ? 0.045 : 0.052 + wave * 0.042) * activeDamping;
    visualContext.shadowColor = 'rgba(164, 224, 214, 0.18)';
    visualContext.shadowBlur = effectiveReduceMotion() ? 0 : 10 + wave * 8;
    visualContext.fill();
    visualContext.beginPath();
    visualContext.arc(point.x, point.y, Math.max(baseRadius + 0.8, 2.2), 0, Math.PI * 2);
    visualContext.strokeStyle = accentColorForCommunity(node.community);
    visualContext.globalAlpha = (effectiveReduceMotion() ? 0.10 : 0.12 + wave * 0.08) * activeDamping;
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
      reducedMotion: effectiveReduceMotion()
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
      visualContext.shadowBlur = effectiveReduceMotion() ? 0 : 8 * visual.radiusScale;
      visualContext.fill();
      rendered += 1;
    });
  });
  visualContext.restore();
  state.performanceStats.ambientCommunityPulseCount = rendered;
}

function drawAmbientEdgeCurrents(width, height) {
  if (!state.projectedPoints.size || effectiveReduceMotion()) {
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
    const visual = edgeCurrentVisual({ phase, edgeId, index, reducedMotion: effectiveReduceMotion() });
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
      reducedMotion: effectiveReduceMotion()
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
    visualContext.shadowBlur = effectiveReduceMotion() ? 0 : 7 + visual.radiusScale * 2;
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
    visualContext.shadowBlur = effectiveReduceMotion() ? 0 : 18;
    visualContext.fill();
    visualContext.beginPath();
    visualContext.arc(point.x, point.y, radius + (isFocus ? 9.5 : 7.5), 0, Math.PI * 2);
    visualContext.strokeStyle = actionColor;
    visualContext.globalAlpha = (isFocus ? 0.72 : 0.54) * ageFade;
    visualContext.lineWidth = isFocus ? 2.35 : 1.85;
    visualContext.shadowColor = actionColor;
    visualContext.shadowBlur = effectiveReduceMotion() ? 0 : 14;
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
    visualContext.shadowBlur = effectiveReduceMotion() ? 0 : 10;
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
  state.activeLabelRects = new Map();
  state.activeLabelBounds = [];
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
      const isPathLabel = state.pathMode && (
        state.pathSourceId === node.id
        || state.pathTargetId === node.id
      );
      labelCandidates.push({
        node,
        point,
        radius,
        amount: labelAmount,
        isPrimary: isSelected || isHovered || isPathLabel,
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
  const persistentLabels = state.presentationPlan?.persistentLabels ?? [];
  const persistentLabelIds = new Set(persistentLabels.map((label) => label.id));
  const placedLabels = persistentLabels.map((label) => label.rect);
  const orderedCandidates = candidates
    .sort((left, right) => {
      const leftScore = (left.isPrimary ? 100 : 0) + left.amount * 12 + Math.log1p(left.degree);
      const rightScore = (right.isPrimary ? 100 : 0) + right.amount * 12 + Math.log1p(right.degree);
      return rightScore - leftScore;
    })
    .slice(0, maxLabels * 2);

  visualContext.save();
  visualContext.textBaseline = 'middle';
  const safeRegions = presentationSafeRegions();
  orderedCandidates.forEach((candidate) => {
    if (placedLabels.length >= maxLabels && !candidate.isPrimary) {
      return;
    }
    if (persistentLabelIds.has(candidate.node.id) && !candidate.isPrimary) {
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
    const boxes = activeLabelBoxes(candidate.point, candidate.radius, labelWidth, labelHeight, width, height);
    const box = boxes.find((candidateBox) => (
      !rectangleOverlapsAny(candidateBox, safeRegions)
      && (candidate.isPrimary || !placedLabels.some((placed) => rectanglesOverlap(placed, candidateBox)))
    ));
    if (!box) {
      return;
    }
    placedLabels.push(box);
    state.activeLabelBounds.push(box);
    if (candidate.isPrimary) {
      state.activeLabelRects.set(candidate.node.id, box);
    }

    visualContext.save();
    visualContext.globalAlpha = alpha;
    if (candidate.isPrimary) {
      visualContext.shadowColor = 'rgba(214, 226, 255, 0.18)';
      visualContext.shadowBlur = 12;
      const anchorX = clamp(candidate.point.x, box.x, box.x + box.width);
      const anchorY = clamp(candidate.point.y, box.y, box.y + box.height);
      if (Math.hypot(anchorX - candidate.point.x, anchorY - candidate.point.y) > 4) {
        visualContext.beginPath();
        visualContext.moveTo(candidate.point.x, candidate.point.y);
        visualContext.lineTo(anchorX, anchorY);
        visualContext.strokeStyle = candidate.color;
        visualContext.globalAlpha = alpha * 0.72;
        visualContext.lineWidth = 1;
        visualContext.stroke();
      }
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

function activeLabelBoxes(point, radius, labelWidth, labelHeight, width, height) {
  const inset = 10;
  const clampBox = (x, y) => ({
    x: clamp(x, inset, Math.max(inset, width - labelWidth - inset)),
    y: clamp(y, inset, Math.max(inset, height - labelHeight - inset)),
    width: labelWidth,
    height: labelHeight
  });
  return [
    clampBox(point.x + radius + 10, point.y - radius - labelHeight * 0.35),
    clampBox(point.x - radius - 10 - labelWidth, point.y - radius - labelHeight * 0.35),
    clampBox(point.x - labelWidth / 2, point.y - radius - labelHeight - 10),
    clampBox(point.x - labelWidth / 2, point.y + radius + 10)
  ];
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
  const phase = effectiveReduceMotion() ? 0.5 : state.pathPulsePhase;
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
    const pathT = effectiveReduceMotion() ? 0.5 : ((phase * 0.82 + index * 0.18) % 1);
    const pulseT = segment.reverse ? 1 - pathT : pathT;
    const pulse = pointOnQuadratic(segment.sourcePoint, control, segment.targetPoint, pulseT);
    const radius = effectiveReduceMotion() ? 3.4 : 3.2 + Math.sin((phase + index) * 3.2) * 0.8;
    visualContext.beginPath();
    visualContext.arc(pulse.x, pulse.y, radius + 4.5, 0, Math.PI * 2);
    visualContext.fillStyle = '#dfe8ff';
    visualContext.globalAlpha = effectiveReduceMotion() ? 0.16 : 0.18;
    visualContext.shadowColor = 'rgba(214, 226, 255, 0.5)';
    visualContext.shadowBlur = effectiveReduceMotion() ? 8 : 14;
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
    reducedMotion: effectiveReduceMotion()
  });
  state.performanceStats.livingPulseCount = state.livingPulseEvents.length;
  if (!state.livingPulseEvents.length || effectiveReduceMotion()) {
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
  // Perspective already moves points. This additional attenuation makes the
  // near/far relationship readable even in a dense ring-only visual language.
  return clamp(1.04 - distance * 0.48, 0.56, 1.04);
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

function scheduleSelectionStaticRefresh() {
  if (state.selectionStaticRefreshFrame) {
    return;
  }
  state.selectionStaticRefreshFrame = requestAnimationFrame(() => {
    state.selectionStaticRefreshFrame = null;
    markVisualCacheDirty();
    requestRender();
  });
}

function announceGraphStatus(message) {
  if (graphStatus) graphStatus.textContent = String(message || '');
}

function setDetailLevel(level, reason = DETAIL_REASONS.USER) {
  const normalized = normalizeDetailLevel(level, DETAIL_LEVELS.OVERVIEW);
  state.userDetailLevel = reason === DETAIL_REASONS.USER ? normalized : '';
  state.detailLevel = normalized;
  state.detailReason = reason;
  if (detailLevelControl) detailLevelControl.value = normalized;
  markVisualCacheDirty();
  updateHud();
  announceGraphStatus(`Detail ${normalized}. ${state.visibleNodes.length} queryable nodes remain available.`);
  requestRender();
  scheduleGraphSessionState();
  return normalized;
}

function resolvedSidebarState(value) {
  const requested = String(value || '').toLowerCase();
  if (requested === 'collapsed' || requested === 'overlay' || requested === 'docked') return requested;
  return window.innerWidth < 860 ? 'overlay' : 'docked';
}

function clampSidebarWidth(value) {
  const maximum = Math.max(300, window.innerWidth * 0.44);
  return clamp(Number(value) || 360, 300, maximum);
}

function applySidebarState(value, width = state.sidebarWidth, { announce = true, reframe = true, immediateReframe = false } = {}) {
  const previous = state.sidebarState;
  const next = resolvedSidebarState(value);
  state.sidebarState = next;
  state.sidebarWidth = clampSidebarWidth(width);
  if (app) {
    app.dataset.sidebarState = next;
    app.style.setProperty('--sidebar-width', `${state.sidebarWidth}px`);
  }
  if (sidebarToggle) {
    sidebarToggle.setAttribute('aria-expanded', String(next !== 'collapsed'));
    sidebarToggle.textContent = next === 'collapsed' ? 'Panel' : 'Hide';
  }
  if (sidebarResizer) {
    sidebarResizer.setAttribute('aria-valuemin', '300');
    sidebarResizer.setAttribute('aria-valuemax', String(Math.round(Math.max(300, window.innerWidth * 0.44))));
    sidebarResizer.setAttribute('aria-valuenow', String(Math.round(state.sidebarWidth)));
  }
  if (previous !== next && reframe) {
    const reframeForPanel = () => {
      if (state.cameraPreset !== 'Manual' && state.cameraPreset !== 'manual') {
        fitCameraToGraph(state.cameraPreset);
        return;
      }
      const selectedPoint = state.selectedNode ? state.projectedPoints.get(state.selectedNode.id) : null;
      if (selectedPoint && pointIsObscured(selectedPoint)) {
        fitCameraToNodeIds(focusNodeContextNodeIds(state.selectedNode), 'manual', {
          semanticTarget: state.positions.get(state.selectedNode.id),
          minimumSpan: 220,
          widthPadding: 1.24,
          heightPadding: 1.0,
          minZoom: 0.16,
          maxZoom: state.userDetailLevel === DETAIL_LEVELS.FULL ? 0.9 : 0.56,
          immediate: true
        });
      }
    };
    if (immediateReframe) {
      reframeForPanel();
    } else {
      requestAnimationFrame(reframeForPanel);
    }
  }
  if (announce && previous !== next) announceGraphStatus(`Context panel ${next}.`);
  scheduleGraphSessionState();
  return next;
}

function resizeDockedSidebar(width, { reframe = false } = {}) {
  if (state.sidebarState !== 'docked') return false;
  applySidebarState('docked', width, { announce: false, reframe: false });
  if (reframe && state.cameraPreset !== 'manual') {
    requestAnimationFrame(() => fitCameraToGraph(state.cameraPreset));
  }
  return true;
}

function renderMeasuredInteraction(action) {
  const startedAt = performance.now();
  action();
  render();
  return performance.now() - startedAt;
}

function measurePresentationInteractions() {
  if (!state.graph || state.layoutState !== 'committed' || !state.visibleNodes.length) {
    return null;
  }
  fitCameraToGraph('overview');
  markVisualCacheDirty();
  render();
  const node = state.visibleNodes.find((candidate) => state.projectedPoints.has(candidate.id));
  if (!node) {
    throw new Error('Renderer interaction measurement requires projected nodes after a forced rebuild.');
  }
  const point = state.projectedPoints.get(node.id);
  if (!point) {
    return null;
  }
  const canvasRect = renderer.domElement.getBoundingClientRect();
  const panOrbitFrameMs = renderMeasuredInteraction(() => {
    withProgrammaticCamera(() => {
      const offset = camera.position.clone().sub(controls.target);
      offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.012);
      camera.position.copy(controls.target).add(offset);
      camera.lookAt(controls.target);
      controls.update();
    });
  });
  const hoverToHighlightMs = renderMeasuredInteraction(() => {
    updatePointerHover({
      clientX: canvasRect.left + point.x,
      clientY: canvasRect.top + point.y
    });
  });
  const selectionToFirstFeedbackMs = renderMeasuredInteraction(() => selectNode(node, false));
  applySidebarState('collapsed', state.sidebarWidth, { announce: false, reframe: false });
  const sidebarOpenReframeMs = renderMeasuredInteraction(() => {
    applySidebarState('docked', state.sidebarWidth, {
      announce: false,
      reframe: true,
      immediateReframe: true
    });
  });
  clearCommunitySpotlight(false);
  fitCameraToGraph('overview');
  const community = state.communities.find((candidate) => candidate.count > 0);
  if (!community) {
    return null;
  }
  const overviewCommunityTransitionMs = renderMeasuredInteraction(() => {
    applyCommunitySpotlight(community.name, { immediateCamera: true });
  });
  const metrics = {
    panOrbitFrameMs,
    hoverToHighlightMs,
    selectionToFirstFeedbackMs,
    sidebarOpenReframeMs,
    overviewCommunityTransitionMs
  };
  Object.entries(metrics).forEach(([name, value]) => {
    state.performanceStats[name] = Number.isFinite(value) ? value : 0;
  });
  return metrics;
}

function cameraHistoryEntry() {
  return {
    preset: normalizedCameraPreset(state.cameraPreset),
    selectedNodeID: state.selectedNode?.id || null,
    communityID: state.communitySpotlightName || null,
    path: state.pathMode && state.pathSourceId ? {
      sourceNodeID: state.pathSourceId,
      targetNodeID: state.pathTargetId || null,
      variant: state.activePathVariantId || 'shortest'
    } : null,
    cameraState: graphCameraState()
  };
}

function normalizedCameraPreset(value) {
  const preset = String(value || '').toLowerCase();
  if (preset.includes('community') || preset.includes('spotlight')) return 'community';
  if (preset.includes('path')) return 'active-path';
  if (preset.includes('recent')) return 'recent-orbit';
  if (preset.includes('node') || preset.includes('focus') || preset.includes('search')) return 'node-focus';
  if (preset.includes('fit') || preset.includes('overview') || preset === 'all' || preset.includes('back to all')) return 'overview';
  return ['overview', 'community', 'node-focus', 'active-path', 'recent-orbit', 'manual'].includes(preset)
    ? preset
    : 'manual';
}

function pushCameraHistory() {
  if (state.historySuppressed) return;
  const current = cameraHistoryEntry();
  const last = state.cameraHistory[state.cameraHistory.length - 1];
  if (last && JSON.stringify(last.cameraState) === JSON.stringify(current.cameraState) && last.preset === current.preset) return;
  state.cameraHistory = [...state.cameraHistory, current].slice(-8);
  if (cameraBackButton) cameraBackButton.disabled = state.cameraHistory.length === 0;
}

function restorePreviousCameraState() {
  const entry = state.cameraHistory.pop();
  if (!entry) return false;
  cancelCameraTransition();
  state.historySuppressed = true;
  try {
    restoreSemanticCameraContext(entry);
    if (entry.cameraState) applyGraphCameraState(entry.cameraState, { schedule: false });
    state.cameraPreset = normalizedCameraPreset(entry.preset || entry.cameraState?.preset);
  } finally {
    state.historySuppressed = false;
  }
  if (cameraBackButton) cameraBackButton.disabled = state.cameraHistory.length === 0;
  announceGraphStatus('Returned to the previous graph view.');
  scheduleGraphSessionState();
  return true;
}

function restoreSemanticCameraContext(entry) {
  clearInteractiveModes();
  const selected = entry?.selectedNodeID ? nodeForId(entry.selectedNodeID) : null;
  if (entry?.communityID) {
    const spotlight = computeCommunitySpotlight(entry.communityID);
    if (spotlight.nodeIds.size) {
      state.communitySpotlightName = entry.communityID;
      state.communitySpotlightNodeIds = spotlight.nodeIds;
      state.communitySpotlightEdgeIds = spotlight.edgeIds;
      state.communitySpotlightFocusNodeIds = spotlight.focusNodeIds;
      state.communitySpotlightOverlayEdgeIds = spotlight.overlayEdgeIds;
      state.communitySpotlightSummary = spotlight;
    }
  }
  if (entry?.path?.sourceNodeID) {
    const source = nodeForId(entry.path.sourceNodeID);
    const target = entry.path.targetNodeID ? nodeForId(entry.path.targetNodeID) : null;
    if (source) {
      state.pathMode = true;
      state.pathSourceId = source.id;
      state.pathTargetId = target?.id || null;
      state.pathVariants = target ? computePathVariants({ sourceId: source.id, targetId: target.id, nodes: state.visibleNodes, edges: state.visibleEdges }) : [];
      state.activePathVariantId = entry.path.variant || 'shortest';
      applyPathVariantState(activePathVariant());
    }
  }
  state.selectedNode = selected;
  positionSelectedMarker(selected);
  renderSidebar();
  markVisualCacheDirty();
  requestRender();
}

function cancelCameraTransition() {
  state.cameraTransitionToken += 1;
  if (state.cameraTransitionFrame) {
    cancelAnimationFrame(state.cameraTransitionFrame);
    state.cameraTransitionFrame = null;
  }
}

function withProgrammaticCamera(update) {
  state.programmaticCameraDepth += 1;
  try {
    return update();
  } finally {
    state.programmaticCameraDepth -= 1;
  }
}

function startAmbientMotion() {
  if ((!ambientRuntimeEnabled && !edgeGlintsRuntimeEnabled) || effectiveReduceMotion() || state.ambientFrame || !state.visibleNodes.length) {
    return;
  }
  state.ambientFrame = requestAnimationFrame(ambientMotionTick);
}

function ambientMotionTick(timestamp) {
  state.ambientFrame = null;
  if ((!ambientRuntimeEnabled && !edgeGlintsRuntimeEnabled) || effectiveReduceMotion()) {
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
  const report = state.evidenceReport;
  if (!report && state.evidenceInput && window.BrainBarGraphEvidence?.build) {
    scheduleEvidenceReportForSelectedNode(node.id);
    return `
      <section class="sidebar-section evidence-panel">
        <h4>Evidence</h4>
        <p class="muted">Preparing graph evidence…</p>
      </section>`;
  }
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

function scheduleEvidenceReportForSelectedNode(nodeId) {
  if (state.evidenceBuildFrame) {
    return;
  }
  state.evidenceBuildFrame = requestAnimationFrame(() => {
    state.evidenceBuildFrame = null;
    graphEvidenceReport();
    if (state.selectedNode?.id === nodeId && !state.inspectedEdge) {
      renderNodeInfo(state.selectedNode);
    }
  });
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
      <input type="checkbox" aria-label="Show ${escapeHTML(community.name)} community" ${state.communityEnabled.has(community.name) ? 'checked' : ''}>
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
    : `${lensLabel} · ${state.visibleNodes.length} nodes · ${state.visibleEdges.length} ${edgeLabel} · ${state.detailLevel[0].toUpperCase()}${state.detailLevel.slice(1)} · ${state.paintedNodeCount}/${state.paintedEdgeCount} painted · 3D`;
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
  if (focusCamera) pushCameraHistory();
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
  applySidebarState(options.sidebarState ?? resolvedSidebarState(), state.sidebarWidth, { announce: false });
  requestRender();
  scheduleSelectionStaticRefresh();
}

function revealSearchNode(node) {
  if (!node) {
    return;
  }
  pushCameraHistory();
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
  applySidebarState(resolvedSidebarState(), state.sidebarWidth, { announce: false });
  markVisualCacheDirty();
  requestRender();
}

function clearSearchReveal(render = true) {
  state.searchRevealNodeId = null;
  state.searchRevealNeighborIds = new Set();
  state.searchRevealEdgeIds = new Set();
  if (render) {
    renderNodeInfo(state.selectedNode);
    updateHud();
    markVisualCacheDirty();
    requestRender();
  }
}

function applyCommunitySpotlight(communityName, { immediateCamera = false } = {}) {
  const spotlight = computeCommunitySpotlight(communityName);
  if (!spotlight.nodeIds.size) {
    return;
  }
  pushCameraHistory();
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
  applySidebarState(resolvedSidebarState(), state.sidebarWidth, { announce: false, reframe: false });
  focusCommunitySpotlight(spotlight, { immediate: immediateCamera });
  emitLivingPulse({
    nodeIds: Array.from(spotlight.focusNodeIds),
    edgeIds: Array.from(spotlight.overlayEdgeIds),
    originNodeId: spotlight.topNodes[0]?.id || Array.from(spotlight.focusNodeIds)[0] || null,
    intensity: 0.50,
    durationMs: 1300
  });
  updateHud();
  markVisualCacheDirty();
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
    markVisualCacheDirty();
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
  if (!responsePulseRuntimeEnabled || effectiveReduceMotion() || state.overlayQuality === 'low') {
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
  markVisualCacheDirty();
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

  pushCameraHistory();
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
  markVisualCacheDirty();
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

function focusCommunitySpotlight(spotlight, { immediate = false } = {}) {
  fitCameraToNodeIds(spotlight.nodeIds, 'Community Spotlight', {
    minimumSpan: 180,
    widthPadding: 1.18,
    heightPadding: 0.92,
    minZoom: 0.18,
    maxZoom: 1.0,
    immediate
  });
}

function applyFocusOrbit(node, depth = 1, focusCamera = true) {
  if (!node) {
    return;
  }
  if (focusCamera) pushCameraHistory();
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
  markVisualCacheDirty();
  requestRender();
}

function armPathSource(node) {
  if (!node) {
    return;
  }
  pushCameraHistory();
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
  pushCameraHistory();
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
    markVisualCacheDirty();
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

function focusNodeContextNodeIds(node) {
  const contextNodeIds = new Set([node.id]);
  state.visibleNodes.forEach((candidate) => {
    if (candidate.community === node.community) contextNodeIds.add(candidate.id);
  });
  topNeighborsForNode(node.id).forEach((neighbor) => contextNodeIds.add(neighbor.id));
  return contextNodeIds;
}

function focusNode(node, preset = 'Node focus', options = {}) {
  const position = state.positions.get(node.id);
  if (!position) {
    return;
  }
  if (normalizedCameraPreset(preset) === 'node-focus') {
    fitCameraToNodeIds(focusNodeContextNodeIds(node), preset, {
      semanticTarget: position,
      minimumSpan: 220,
      widthPadding: 1.24,
      heightPadding: 1.0,
      minZoom: 0.16,
      maxZoom: state.userDetailLevel === DETAIL_LEVELS.FULL ? 0.9 : 0.56,
      immediate: Boolean(options.immediate)
    });
    return;
  }
  orbitCameraTo(position, clamp(Math.max(camera.zoom, 1.7), 0.08, 8), preset, options);
}

function focusSearchReveal(node) {
  const nodeIds = new Set([node.id, ...state.searchRevealNeighborIds]);
  fitCameraToNodeIds(nodeIds, 'Search reveal', {
    semanticTarget: state.positions.get(node.id),
    minimumSpan: 180,
    maxZoom: 4.8
  });
}

function focusPath(path, preset = 'Shortest path') {
  const positions = path.orderedNodeIds
    .map((nodeId) => state.positions.get(nodeId))
    .filter(Boolean);
  fitCameraToPositions(positions, preset, {
    semanticTarget: state.positions.get(state.pathTargetId || state.selectedNode?.id) ?? positions[positions.length - 1],
    minimumSpan: 160,
    widthPadding: 1.25,
    heightPadding: 0.95,
    minZoom: 0.28,
    maxZoom: 3.8
  });
}

function orbitCameraTo(position, zoom, preset, { recordHistory = true, duration = 380, immediate = false, cameraDistance } = {}) {
  const target = new THREE.Vector3(position.x, position.y, position.z);
  const resolvedPreset = normalizedCameraPreset(preset);
  const previousPreset = normalizedCameraPreset(state.cameraPreset);
  cancelCameraTransition();
  state.cameraPreset = resolvedPreset;
  if (recordHistory && camera && controls && resolvedPreset !== previousPreset) {
    pushCameraHistory();
  }
  if (immediate || reduceMotionPolicy(effectiveReduceMotion()).reduceMotion) {
    withProgrammaticCamera(() => {
      const direction = camera.position.clone().sub(controls.target).normalize();
      controls.target.copy(target);
      if (Number.isFinite(cameraDistance)) camera.position.copy(target).addScaledVector(direction, cameraDistance);
      camera.zoom = zoom;
      camera.updateProjectionMatrix();
      controls.update();
    });
    state.cameraPreset = resolvedPreset;
    markVisualCacheDirty();
    updateHud();
    requestRender();
    return;
  }

  const startTarget = controls.target.clone();
  const startPosition = camera.position.clone();
  const startZoom = camera.zoom;
  const offset = startPosition.clone().sub(startTarget);
  const targetOffset = Number.isFinite(cameraDistance)
    ? offset.clone().normalize().multiplyScalar(cameraDistance)
    : offset;
  const startedAt = performance.now();
  const token = state.cameraTransitionToken;

  function tick(now) {
    if (token !== state.cameraTransitionToken) return;
    const t = smoothstep(clamp((now - startedAt) / duration, 0, 1));
    withProgrammaticCamera(() => {
      controls.target.lerpVectors(startTarget, target, t);
      camera.position.copy(controls.target).addScaledVector(offset, 1 - t).addScaledVector(targetOffset, t);
      camera.zoom = startZoom + (zoom - startZoom) * t;
      camera.updateProjectionMatrix();
      controls.update();
    });
    markVisualCacheDirty();
    requestRender();
    if (t < 1) {
      state.cameraTransitionFrame = requestAnimationFrame(tick);
    } else {
      state.cameraTransitionFrame = null;
      state.cameraPreset = resolvedPreset;
      updateHud();
      scheduleGraphSessionState();
    }
  }

  state.cameraTransitionFrame = requestAnimationFrame(tick);
}

function nodeAtEvent(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
  // The visual layer is the product surface, so its projected index is the
  // primary hit target. It remains consistent with progressive painting and
  // avoids PerspectiveCamera's world-unit Points threshold becoming tiny at a
  // far camera distance.
  const candidateIds = state.projectedPointGrid
    ? nearbyProjectedNodeIds(state.projectedPointGrid, point, 18)
    : Array.from(state.projectedPoints.keys());
  let nearest = null;
  let nearestDistance = 18;
  candidateIds.forEach((nodeId) => {
    const projected = state.projectedPoints.get(nodeId);
    if (!projected) return;
    const distance = Math.hypot(projected.x - point.x, projected.y - point.y);
    if (distance < nearestDistance || (distance === nearestDistance && projected.z < (nearest?.z ?? Infinity))) {
      nearest = projected;
      nearestDistance = distance;
    }
  });
  if (nearest?.node) return nearest.node;
  if (!nodePoints) return null;
  state.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  state.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  state.raycaster.params.Points.threshold = Math.max(12, camera.position.distanceTo(controls.target) * 0.012);
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

function maximumRectangleOverlapArea(rectangles) {
  let maximum = 0;
  for (let index = 0; index < rectangles.length; index += 1) {
    for (let otherIndex = index + 1; otherIndex < rectangles.length; otherIndex += 1) {
      const left = rectangles[index];
      const right = rectangles[otherIndex];
      if (![left?.x, left?.y, left?.width, left?.height, right?.x, right?.y, right?.width, right?.height].every(Number.isFinite)) {
        continue;
      }
      const width = Math.max(0, Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x));
      const height = Math.max(0, Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y));
      maximum = Math.max(maximum, width * height);
    }
  }
  return maximum;
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
  const distance = camera.position.distanceTo(controls.target);
  const nextDistance = clamp(distance / multiplier, controls.minDistance, controls.maxDistance);
  const direction = camera.position.clone().sub(controls.target).normalize();
  camera.position.copy(controls.target).addScaledVector(direction, nextDistance);
  camera.zoom = 1;
  camera.updateProjectionMatrix();
  state.cameraPreset = 'manual';
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

function applyCameraPreset(value) {
  const preset = normalizedCameraPreset(value);
  if (preset === 'overview') {
    fitCameraToGraph('overview');
    return true;
  }
  if (preset === 'community' && state.communitySpotlightSummary) {
    focusCommunitySpotlight(state.communitySpotlightSummary);
    return true;
  }
  if (preset === 'node-focus' && state.selectedNode) {
    focusNode(state.selectedNode, 'node-focus');
    return true;
  }
  if (preset === 'active-path' && state.pathMode) {
    focusPath(activePathVariant() || { orderedNodeIds: state.pathOrderedNodeIds }, 'active-path');
    return true;
  }
  if (preset === 'recent-orbit' && state.recentOrbitMode) {
    focusRecentOrbit();
    return true;
  }
  if (preset === 'manual') {
    cancelCameraTransition();
    state.cameraPreset = 'manual';
    scheduleGraphSessionState();
    return true;
  }
  return false;
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
  detailLevelControl?.addEventListener('change', () => setDetailLevel(detailLevelControl.value));
  sidebarToggle?.addEventListener('click', () => {
    applySidebarState(state.sidebarState === 'collapsed' ? resolvedSidebarState() : 'collapsed');
  });
  sidebarResizer?.addEventListener('pointerdown', (event) => {
    if (state.sidebarState !== 'docked' || event.button !== 0) return;
    state.sidebarResizePointerId = event.pointerId;
    try { sidebarResizer.setPointerCapture(event.pointerId); } catch (_) {}
    event.preventDefault();
  });
  sidebarResizer?.addEventListener('pointermove', (event) => {
    if (state.sidebarResizePointerId !== event.pointerId) return;
    resizeDockedSidebar(window.innerWidth - event.clientX);
  });
  sidebarResizer?.addEventListener('pointerup', (event) => {
    if (state.sidebarResizePointerId !== event.pointerId) return;
    state.sidebarResizePointerId = null;
    try { sidebarResizer.releasePointerCapture?.(event.pointerId); } catch (_) {}
    resizeDockedSidebar(state.sidebarWidth, { reframe: true });
    scheduleGraphSessionState();
  });
  sidebarResizer?.addEventListener('keydown', (event) => {
    if (state.sidebarState !== 'docked' || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    resizeDockedSidebar(state.sidebarWidth + (event.key === 'ArrowLeft' ? -12 : 12), { reframe: true });
  });
  cameraBackButton?.addEventListener('click', restorePreviousCameraState);
  renderer?.domElement?.addEventListener('focus', () => stage.classList.add('has-navigation-focus'));
  renderer?.domElement?.addEventListener('blur', () => stage.classList.remove('has-navigation-focus'));
  renderer?.domElement?.addEventListener('pointerdown', (event) => {
    cancelCameraTransition();
    renderer.domElement.focus({ preventScroll: true });
    const primaryMouseOrbit = event.pointerType !== 'touch' && event.button === 0 &&
      !event.shiftKey && !event.ctrlKey && !event.metaKey;
    const primaryTouchOrbit = event.pointerType === 'touch' && event.isPrimary;
    const modifierPan = event.pointerType !== 'touch' && (
      (event.button === 0 && (event.shiftKey || event.ctrlKey || event.metaKey)) ||
      event.button === 2
    );
    if (!primaryMouseOrbit && !primaryTouchOrbit && !modifierPan) return;
    state.navigationPointerId = event.pointerId;
    state.navigationPointerStartX = event.clientX;
    state.navigationPointerStartY = event.clientY;
    state.navigationPointerLastX = event.clientX;
    state.navigationPointerLastY = event.clientY;
    state.navigationPointerRotates = primaryMouseOrbit || primaryTouchOrbit;
    state.navigationPointerDragged = false;
    stage.classList.add('is-navigating');
  });
  renderer?.domElement?.addEventListener('pointermove', (event) => {
    if (state.navigationPointerId !== event.pointerId) return;
    const distance = Math.hypot(
      event.clientX - state.navigationPointerStartX,
      event.clientY - state.navigationPointerStartY
    );
    const wasDragged = state.navigationPointerDragged;
    if (!wasDragged && distance >= navigationDragThreshold) {
      state.navigationPointerDragged = true;
    }
    if (state.navigationPointerDragged && state.navigationPointerRotates) {
      const originX = wasDragged ? state.navigationPointerLastX : state.navigationPointerStartX;
      const originY = wasDragged ? state.navigationPointerLastY : state.navigationPointerStartY;
      const height = Math.max(renderer.domElement.clientHeight, 1);
      orbitManualCamera(
        -2 * Math.PI * (event.clientX - originX) / height * controls.rotateSpeed,
        2 * Math.PI * (event.clientY - originY) / height * controls.rotateSpeed
      );
      event.preventDefault();
    }
    state.navigationPointerLastX = event.clientX;
    state.navigationPointerLastY = event.clientY;
  });
  const finishPointerNavigation = (event) => {
    if (state.navigationPointerId !== event.pointerId) return;
    if (state.navigationPointerDragged) {
      state.suppressSelectionClickUntil = performance.now() + 180;
    }
    state.navigationPointerId = null;
    state.navigationPointerRotates = false;
    state.navigationPointerDragged = false;
    stage.classList.remove('is-navigating');
  };
  renderer?.domElement?.addEventListener('pointerup', finishPointerNavigation);
  renderer?.domElement?.addEventListener('pointercancel', finishPointerNavigation);
  renderer?.domElement?.addEventListener('wheel', cancelCameraTransition, { passive: true });
  renderer?.domElement?.addEventListener('wheel', (event) => {
    if (Math.abs(event.deltaX) <= Math.max(2, Math.abs(event.deltaY) * 1.2)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    orbitManualCamera(event.deltaX * 0.0024, 0);
  }, { capture: true, passive: false });
  renderer?.domElement?.addEventListener('keydown', (event) => {
    const direction = event.shiftKey ? 2 : 1;
    const orbit = {
      ArrowLeft: [-keyboardOrbitStep * direction, 0],
      ArrowRight: [keyboardOrbitStep * direction, 0],
      ArrowUp: [0, -keyboardOrbitStep * direction],
      ArrowDown: [0, keyboardOrbitStep * direction]
    }[event.key];
    if (!orbit) return;
    event.preventDefault();
    orbitManualCamera(orbit[0], orbit[1]);
  });
  renderer?.domElement?.addEventListener('pointermove', (event) => {
    markLivingInteraction();
    if (!state.navigationPointerDragged) schedulePointerHitTest(event);
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
    markVisualCacheDirty();
    requestRender();
  });

  renderer?.domElement?.addEventListener('click', (event) => {
    markLivingInteraction();
    if (performance.now() <= state.suppressSelectionClickUntil) {
      event.preventDefault();
      return;
    }
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
      selectNode(node, false);
      focusNode(node, 'Node focus');
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

function orbitManualCamera(deltaAzimuth, deltaPolar) {
  if (!camera || !controls) return false;
  cancelCameraTransition();
  const offset = camera.position.clone().sub(controls.target);
  const spherical = new THREE.Spherical().setFromVector3(offset);
  spherical.theta += deltaAzimuth;
  spherical.phi = clamp(
    spherical.phi + deltaPolar,
    controls.minPolarAngle,
    controls.maxPolarAngle
  );
  spherical.makeSafe();
  camera.position.copy(controls.target).add(offset.setFromSpherical(spherical));
  camera.lookAt(controls.target);
  controls.update();
  state.cameraPreset = 'manual';
  markVisualCacheDirty();
  requestRender();
  scheduleGraphSessionState();
  return true;
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
  markVisualCacheDirty();
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
  if (rendererMeasurementMode || rendererTestMode) {
    window.brainBarFlushRendererForMeasurement = () => {
      if (state.layoutState !== 'committed') return false;
      if (state.evidenceBuildFrame) {
        cancelAnimationFrame(state.evidenceBuildFrame);
        state.evidenceBuildFrame = null;
        graphEvidenceReport();
        if (state.selectedNode && !state.inspectedEdge) {
          renderNodeInfo(state.selectedNode);
        }
      }
      render();
      return state.paintedCountsSettled;
    };
    window.brainBarMeasurePresentationInteractions = measurePresentationInteractions;
    window.__brainBarResetProjectionForInteractionProbe = () => {
      if (state.layoutState !== 'committed') return false;
      state.projectedPoints = new Map();
      state.projectedPointGrid = null;
      state.visibleProjectedNodeCount = 0;
      state.paintedCountsSettled = false;
      state.visualCacheDirty = false;
      return true;
    };
  }
  if (layoutWorkerTestMode === 'holdResult') {
    window.__brainBarLayoutWorkerTestRelease = releaseHeldLayoutWorkerResult;
    window.__brainBarLayoutWorkerTestFail = failHeldLayoutWorkerResult;
    window.__brainBarLayoutWorkerTestHeld = () => {
      const context = state.heldLayoutResult?.request?.context;
      return context ? { lens: context.lens, generation: context.graphGeneration } : null;
    };
    window.__brainBarLayoutWorkerTestSnapshot = () => ({
      visibleNodeIDs: state.visibleNodes.map((node) => node.id).sort(),
      paintedNodeIDs: (state.presentationPlan?.paintedNodeIds ?? []).slice().sort(),
      coordinateFingerprint: presentationCoordinateFingerprint(),
      graphReady: Boolean(window.__brainBarGraphReady)
    });
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
      missingMetadata: async () => {
        const identity = currentLayoutCacheIdentity();
        if (!identity) return false;
        const coordinates = new Float64Array(state.visibleNodes.length * 3);
        state.visibleNodes.forEach((node, index) => {
          const position = state.positions.get(node.id);
          coordinates[index * 3] = position?.x ?? 0;
          coordinates[index * 3 + 1] = position?.y ?? 0;
          coordinates[index * 3 + 2] = position?.z ?? 0;
        });
        return await overwriteLayoutCacheForTesting({
          key: layoutCacheKey(identity),
          schemaVersion: 2,
          digest: identity.digest,
          lens: identity.lens,
          nodeCount: state.visibleNodes.length,
          coordinates: coordinates.buffer
        });
      },
      corruptMetadata: async () => {
        const identity = currentLayoutCacheIdentity();
        const metadata = state.layoutMetadata;
        if (!identity || !metadata) return false;
        const coordinates = new Float64Array(state.visibleNodes.length * 3);
        state.visibleNodes.forEach((node, index) => {
          const position = state.positions.get(node.id);
          coordinates[index * 3] = position?.x ?? 0;
          coordinates[index * 3 + 1] = position?.y ?? 0;
          coordinates[index * 3 + 2] = position?.z ?? 0;
        });
        return await overwriteLayoutCacheForTesting({
          key: layoutCacheKey(identity),
          schemaVersion: 2,
          digest: identity.digest,
          lens: identity.lens,
          nodeCount: state.visibleNodes.length,
          coordinates: coordinates.buffer,
          communityCount: metadata.communityCount,
          communityIndexByNode: metadata.communityIndexByNode.buffer.slice(0),
          communityCenters: metadata.communityCenters.buffer.slice(0),
          communityBounds: metadata.communityBounds.buffer.slice(0),
          structuralRanks: new ArrayBuffer(0)
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
      held: () => {
        const context = state.heldLayoutCacheLookup?.request?.context;
        return context
          ? { lens: context.lens, generation: context.graphGeneration }
          : null;
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
    window.__brainBarGraphReady = Boolean(state.readyGraphSnapshot);
    return true;
  };
  window.brainBarLoadGraph = async (payload, lens = 'all', generation = null, options = {}) => {
    const rollbackSnapshot = state.layoutState === 'committed' && state.graph
      ? captureTransactionalGraphState()
      : state.readyGraphSnapshot;
    if (!state.readyGraphSnapshot) window.__brainBarGraphReady = false;
    try {
      if (!options?.retainTransportTimings) {
        state.performanceStats.graphFetchMs = 0;
        state.performanceStats.graphJSONParseMs = 0;
        state.performanceStats.metadataReplayMs = 0;
      }
      const requestedGeneration = Number.isInteger(generation) ? generation : state.graphGeneration + 1;
      state.graphGeneration = Number.isInteger(state.pendingGraphGeneration)
        ? Math.max(requestedGeneration, state.pendingGraphGeneration)
        : requestedGeneration;
      state.pendingGraphGeneration = null;
      const evidenceStartedAt = performance.now();
      state.evidenceInput = evidenceInputForGraphPayload(payload);
      state.performanceStats.evidenceBuildMs = performance.now() - evidenceStartedAt;
      state.evidenceReport = null;
      state.evidenceNow = null;
      const normalizeStartedAt = performance.now();
      state.graph = normalizeGraph(payload);
      state.performanceStats.normalizeGraphMs = performance.now() - normalizeStartedAt;
      const preparationStartedAt = performance.now();
      state.lens = normalizeLens(window.__brainBarPendingGraphLens || lens);
      state.selectedNode = null;
      state.searchRevealRestore = null;
      clearInteractiveModes();
      prepareCommunities(state.graph);
      state.performanceStats.graphPreparationMs = performance.now() - preparationStartedAt;
      const didLoad = await applyLens(true, { generation: state.graphGeneration, emitGraphReady: true, rollbackSnapshot });
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
      state.performanceStats.graphFetchMs = 0;
      state.performanceStats.graphJSONParseMs = 0;
      state.performanceStats.metadataReplayMs = 0;
      const graphFetchStartedAt = performance.now();
      const graphResponse = await fetch(String(graphURL || ''), { signal: controller.signal });
      state.performanceStats.graphFetchMs = performance.now() - graphFetchStartedAt;
      if (!graphResponse.ok && graphResponse.status !== 0) {
        throw new Error('Graph data unavailable');
      }
      const graphParseStartedAt = performance.now();
      const payload = await graphResponse.json();
      state.performanceStats.graphJSONParseMs = performance.now() - graphParseStartedAt;
      if (epoch !== state.graphLoadEpoch) {
        return false;
      }
      window.__brainBarGraphJSON = payload;
      window.__brainBarNodeFileMetadata = { byNodeId: {}, bySourceFile: {} };
      const didLoad = await window.brainBarLoadGraph(payload, lens, generation, { retainTransportTimings: true });
      if (epoch !== state.graphLoadEpoch) {
        return false;
      }
      const layoutWasSuperseded = Number.isInteger(generation) && state.graphGeneration !== generation;
      if (!didLoad && !layoutWasSuperseded) {
        return false;
      }

      try {
        const metadataStartedAt = performance.now();
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
        state.performanceStats.metadataReplayMs = performance.now() - metadataStartedAt;
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
    const rollbackSnapshot = state.layoutState === 'committed' && state.graph
      ? captureTransactionalGraphState()
      : state.readyGraphSnapshot;
    if (!state.readyGraphSnapshot) window.__brainBarGraphReady = false;
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
    return await applyLens(true, { generation: state.graphGeneration, emitGraphReady: true, rollbackSnapshot });
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
    const schemaVersion = Number(value?.schemaVersion);
    if (!value || typeof value !== 'object' || (schemaVersion !== 1 && schemaVersion !== 2)) {
      return false;
    }
    const session = { ...value, schemaVersion };
    window.__brainBarPendingSessionState = session;
    state.historySuppressed = true;
    state.reduceMotion = schemaVersion === 2 ? Boolean(session.reduceMotion) : prefersReducedMotion;
    if (schemaVersion === 2) {
      state.userDetailLevel = session.detailReason === DETAIL_REASONS.USER
        ? normalizeDetailLevel(session.detailLevel, DETAIL_LEVELS.OVERVIEW)
        : '';
      state.detailLevel = normalizeDetailLevel(session.detailLevel, DETAIL_LEVELS.OVERVIEW);
      state.detailReason = Object.values(DETAIL_REASONS).includes(session.detailReason)
        ? session.detailReason
        : DETAIL_REASONS.ADAPTIVE_DEFAULT;
      state.cameraHistory = Array.isArray(session.cameraHistory) ? session.cameraHistory.slice(-8) : [];
      if (cameraBackButton) cameraBackButton.disabled = state.cameraHistory.length === 0;
      applySidebarState(session.sidebarState, session.sidebarWidth, { announce: false, reframe: false });
      if (detailLevelControl) detailLevelControl.value = state.detailLevel;
    } else {
      state.userDetailLevel = '';
      state.detailLevel = DETAIL_LEVELS.OVERVIEW;
      state.detailReason = DETAIL_REASONS.ADAPTIVE_DEFAULT;
      state.cameraHistory = [];
      applySidebarState('collapsed', state.sidebarWidth, { announce: false, reframe: false });
    }
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
      selectNode(focusNode, true, { sidebarState: session.sidebarState });
    }
    if (session.cameraState) applyGraphCameraState(session.cameraState, { schedule: false });
    state.historySuppressed = false;
    markVisualCacheDirty();
    scheduleGraphSessionState();
    return true;
  };

  window.brainBarResetCamera = resetCamera;
  window.brainBarZoom = zoomCamera;
  window.brainBarTopView = topView;
  window.brainBarResetTilt = resetTilt;
  window.brainBarSetDetailLevel = (level) => setDetailLevel(level);
  window.brainBarSetSidebarState = (sidebarState, sidebarWidth) => applySidebarState(sidebarState, sidebarWidth);
  window.brainBarCameraBack = restorePreviousCameraState;
  window.brainBarSetReduceMotion = setReduceMotion;
  window.brainBarApplyCameraPreset = applyCameraPreset;
  window.brainBarPresentationStateForTesting = () => ({
    coordinateFingerprint: presentationCoordinateFingerprint(),
    detailLevel: state.detailLevel,
    sidebarState: state.sidebarState,
    sidebarWidth: state.sidebarWidth,
    reduceMotion: effectiveReduceMotion(),
    queryableNodeCount: state.visibleNodes.length,
    paintedNodeCount: state.paintedNodeCount,
    paintedProjectedCoverage: paintedProjectedCoverage(),
    persistentLabelMaxOverlapArea: maximumRectangleOverlapArea(state.presentationPlan?.persistentLabels ?? []),
    selectedNodeProjection: state.selectedNode ? state.projectedPoints.get(state.selectedNode.id) ?? null : null,
    selectedContextProjectedCount: (() => {
      if (!state.selectedNode) return 0;
      const width = stage.clientWidth;
      const height = stage.clientHeight;
      return state.visibleNodes.filter((node) => {
        if (node.community !== state.selectedNode.community) return false;
        const point = state.projectedPoints.get(node.id);
        return point && point.x >= 0 && point.x <= width && point.y >= 0 && point.y <= height;
      }).length;
    })(),
    cameraTransitionActive: Boolean(state.cameraTransitionFrame),
    selectedNodeLabelRect: state.selectedNode
      ? state.activeLabelRects.get(state.selectedNode.id) ?? null
      : null,
    activePrimaryPersistentLabelCollisionCount: Array.from(state.activeLabelRects.keys())
      .filter((nodeId) => (state.presentationPlan?.persistentLabels ?? []).some((label) => label.id === nodeId)).length,
    persistentLabelRects: (state.presentationPlan?.persistentLabels ?? []).map((label) => label.rect),
    activeLabelRects: state.activeLabelBounds,
    unobscuredStage: (() => {
      const stageRect = stage.getBoundingClientRect();
      return {
        width: stageRect.width,
        height: stageRect.height,
        obscuredRegions: presentationSafeRegions()
      };
    })()
  });
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
    layoutSchemaVersion: 4,
    layoutProfile: 'community-islands',
    cameraProjection: camera?.isPerspectiveCamera ? 'perspective' : 'unknown',
    cameraDistance: camera && controls ? camera.position.distanceTo(controls.target) : 0,
    detailLevel: state.detailLevel,
    detailReason: state.detailReason,
    queryableNodeCount: state.presentationPlan?.diagnostics?.queryableNodeCount ?? state.visibleNodes.length,
    queryableEdgeCount: state.presentationPlan?.diagnostics?.queryableEdgeCount ?? state.visibleEdges.length,
    paintedNodeCount: state.presentationPlan?.diagnostics?.paintedNodeCount ?? state.paintedNodeCount,
    paintedEdgeCount: state.presentationPlan?.diagnostics?.paintedEdgeCount ?? state.paintedEdgeCount,
    communityAnchorCount: state.presentationPlan?.diagnostics?.communityAnchorCount ?? 0,
    persistentLabelCount: state.presentationPlan?.diagnostics?.persistentLabelCount ?? 0,
    sidebarState: state.sidebarState,
    reduceMotion: effectiveReduceMotion(),
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
    cameraPreset: normalizedCameraPreset(state.cameraPreset),
    cameraZoom: camera?.zoom ?? 0,
    drawCalls: renderer?.info?.render?.calls ?? 0,
    triangles: renderer?.info?.render?.triangles ?? 0,
    points: renderer?.info?.render?.points ?? 0,
    lines: renderer?.info?.render?.lines ?? 0,
    visibleProjectedNodeCount: state.visibleProjectedNodeCount,
    staticRebuildMs: Number(state.performanceStats.staticRebuildMs.toFixed(2)),
    staticLayerRebuildMs: Number(state.performanceStats.staticRebuildMs.toFixed(2)),
    labelAllocationMs: Number(state.performanceStats.labelAllocationMs.toFixed(2)),
    frameQuality: state.overlayQuality,
    normalizeGraphMs: Number(state.performanceStats.normalizeGraphMs.toFixed(2)),
    graphFetchMs: Number(state.performanceStats.graphFetchMs.toFixed(2)),
    graphJSONParseMs: Number(state.performanceStats.graphJSONParseMs.toFixed(2)),
    evidenceBuildMs: Number(state.performanceStats.evidenceBuildMs.toFixed(2)),
    graphPreparationMs: Number(state.performanceStats.graphPreparationMs.toFixed(2)),
    applyLensPreLayoutMs: Number(state.performanceStats.applyLensPreLayoutMs.toFixed(2)),
    metadataReplayMs: Number(state.performanceStats.metadataReplayMs.toFixed(2)),
    presentationIndexBuildMs: Number(state.performanceStats.presentationIndexBuildMs.toFixed(2)),
    layoutCacheReadMs: Number(state.performanceStats.layoutCacheReadMs.toFixed(2)),
    meshHitGeometryMs: Number(state.performanceStats.meshHitGeometryMs.toFixed(2)),
    firstProjectionStaticPaintMs: Number(state.performanceStats.firstProjectionStaticPaintMs.toFixed(2)),
    layoutPreparationMs: Number(state.performanceStats.layoutPreparationMs.toFixed(2)),
    layoutWorkerComputeMs: Number(state.performanceStats.layoutWorkerComputeMs.toFixed(2)),
    layoutCommitMs: Number(state.performanceStats.layoutCommitMs.toFixed(2)),
    layoutEndToEndMs: Number(state.performanceStats.layoutEndToEndMs.toFixed(2)),
    layoutCache: state.performanceStats.layoutCache,
    layoutState: state.layoutState,
    overlayFrameMs: Number(state.performanceStats.overlayFrameMs.toFixed(2)),
    visualPixelRatio: state.performanceStats.visualPixelRatio,
    staticHubGlowCount: state.performanceStats.staticHubGlowCount,
    baseStateHubGlowEnabled: staticHubGlowEnabled,
    balancedDiscMinimumAlpha,
    darkSeparationRimWidth,
    staticHubHaloBlur,
    balancedEdgeAlpha,
    staticRebuildP95Ms: Number(staticRebuildPercentile(0.95).toFixed(2)),
    visualBackingWidth: state.performanceStats.visualBackingWidth,
    visualBackingHeight: state.performanceStats.visualBackingHeight,
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

function presentationCoordinateFingerprint() {
  let fingerprint = 2166136261;
  state.visibleNodes.forEach((node) => {
    const position = state.positions.get(node.id);
    [position?.x, position?.y, position?.z].forEach((value) => {
      const text = Number.isFinite(value) ? String(value) : 'invalid';
      for (let index = 0; index < text.length; index += 1) {
        fingerprint = Math.imul(fingerprint ^ text.charCodeAt(index), 16777619) >>> 0;
      }
    });
  });
  return fingerprint.toString(16);
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
    schemaVersion: 2,
    graphVersion: pending.graphVersion || null,
    selectedNodeID: state.selectedNode?.id || pending.selectedNodeID || null,
    sourceLens: normalizeLens(state.lens || pending.sourceLens || 'all'),
    focusDepth: state.focusMode ? Number(state.focusDepth || 1) : (pending.focusDepth || null),
    path,
    communityID: state.communitySpotlightName || pending.communityID || null,
    searchQuery: String(search?.value || pending.searchQuery || ''),
    cameraState: graphCameraState() || pending.cameraState || null,
    detailLevel: state.detailLevel,
    detailReason: state.detailReason,
    sidebarState: state.sidebarState,
    sidebarWidth: state.sidebarState === 'docked' ? state.sidebarWidth : null,
    cameraPreset: normalizedCameraPreset(state.cameraPreset),
    cameraHistory: state.cameraHistory.slice(-8),
    reduceMotion: Boolean(state.reduceMotion)
  };
}

function graphCameraState() {
  if (!camera || !controls) return null;
  return {
    position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
    target: { x: controls.target.x, y: controls.target.y, z: controls.target.z },
    zoom: camera.zoom,
    preset: normalizedCameraPreset(state.cameraPreset)
  };
}

function applyGraphCameraState(cameraState, { schedule = true } = {}) {
  const values = [
    cameraState?.position?.x, cameraState?.position?.y, cameraState?.position?.z,
    cameraState?.target?.x, cameraState?.target?.y, cameraState?.target?.z,
    cameraState?.zoom
  ].map(Number);
  if (!camera || !controls || values.some((value) => !Number.isFinite(value)) || values[6] <= 0) {
    return false;
  }
  cancelCameraTransition();
  withProgrammaticCamera(() => {
    camera.position.set(values[0], values[1], values[2]);
    controls.target.set(values[3], values[4], values[5]);
    camera.zoom = clamp(values[6], 0.08, 8);
    camera.updateProjectionMatrix();
    camera.lookAt(controls.target);
    controls.update();
  });
  state.cameraPreset = normalizedCameraPreset(cameraState.preset);
  markVisualCacheDirty();
  requestRender();
  if (schedule) scheduleGraphSessionState();
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
