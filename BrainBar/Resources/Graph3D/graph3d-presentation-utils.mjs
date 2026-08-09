// Pure, deterministic presentation planning for the Graph3D renderer.
//
// This module deliberately knows nothing about Three.js, DOM labels, or session
// persistence. It plans what may be painted; callers must keep their full graph
// indexes for search, paths, and all other queryable operations.

export const DETAIL_LEVELS = Object.freeze({
  OVERVIEW: 'overview',
  BALANCED: 'balanced',
  FULL: 'full'
});

export const DETAIL_REASONS = Object.freeze({
  USER: 'user',
  ADAPTIVE_DEFAULT: 'adaptive-default',
  FOCUS_OVERRIDE: 'focus-override',
  PERFORMANCE_DEGRADE: 'performance-degrade'
});

const TIER_WEIGHT = Object.freeze({ A: 4, B: 3, C: 2, D: 1 });
const DETAIL_BUDGETS = Object.freeze({
  // Overview stays bounded for the 25k stress case while still exposing a
  // legible majority when it is deliberately selected on a mid-size graph.
  [DETAIL_LEVELS.OVERVIEW]: { nodeLimit: 7000, edgeLimit: 7000, hubsPerCommunity: 4 },
  // The product default through a medium-large vault is Balanced. At 12–13k
  // this preserves the graph's actual shape instead of showing a sparse proxy.
  [DETAIL_LEVELS.BALANCED]: { nodeLimit: 10000, edgeLimit: 12000, hubsPerCommunity: 12 },
  [DETAIL_LEVELS.FULL]: { nodeLimit: Infinity, edgeLimit: Infinity, hubsPerCommunity: Infinity }
});

/**
 * The adaptive default is intentionally independent of viewport and sidebar
 * width. Those are camera concerns and must not affect stable painted identity.
 */
export function adaptiveDetailLevel(nodeCount = 0) {
  return Number(nodeCount) <= 16000 ? DETAIL_LEVELS.BALANCED : DETAIL_LEVELS.OVERVIEW;
}

export function normalizeDetailLevel(value, fallback = DETAIL_LEVELS.BALANCED) {
  const normalized = String(value || '').toLowerCase();
  return Object.values(DETAIL_LEVELS).includes(normalized) ? normalized : fallback;
}

/**
 * Structural marks are capped by the detail level. Exact promoted identities
 * are a separate allowance so an active search/path can never disappear.
 * `communityCount` raises (never lowers) the structural limit so every
 * community keeps one anchor even in an unusually fragmented graph.
 */
export function presentationPaintBudget(detailLevel, {
  communityCount = 0,
  promotionCount = 0
} = {}) {
  const level = normalizeDetailLevel(detailLevel);
  const budget = DETAIL_BUDGETS[level] ?? DETAIL_BUDGETS[DETAIL_LEVELS.BALANCED];
  const communities = Math.max(0, Math.floor(finiteNumber(communityCount, 0)));
  const promotions = Math.max(0, Math.floor(finiteNumber(promotionCount, 0)));
  const structuralNodeLimit = level === DETAIL_LEVELS.FULL
    ? Infinity
    : Math.max(budget.nodeLimit, communities);
  return {
    detailLevel: level,
    structuralNodeLimit,
    promotionAllowance: level === DETAIL_LEVELS.FULL ? Infinity : promotions,
    paintedNodeLimit: level === DETAIL_LEVELS.FULL ? Infinity : structuralNodeLimit + promotions,
    structuralEdgeLimit: budget.edgeLimit
  };
}

/**
 * Builds immutable-by-contract structural data for one graph revision. Keep the
 * returned value alongside the renderer's existing queryable graph indexes and
 * replace it only when graph/lens/layout metadata changes. It contains graph
 * identities and numerical structure only; labels and note content are never
 * copied into it.
 */
export function buildPresentationIndex({
  nodes = [],
  edges = [],
  structuralRanks,
  structuralRankNodeIds,
  communityAnchors,
  normalizedGraph,
  normalizedNodes,
  normalizedEdges,
  degreeByNode,
  edgesByNode,
  communitiesByName,
  communityByNodeId,
  structuralEdgeRecords,
  ambientEdgeRecords
} = {}) {
  const graph = Array.isArray(normalizedGraph?.nodes) && Array.isArray(normalizedGraph?.edges)
    ? normalizedGraph
    : Array.isArray(normalizedNodes) && Array.isArray(normalizedEdges)
    ? preparedNormalizedGraph(normalizedNodes, normalizedEdges)
    : normalizePresentationGraph(nodes, edges);
  const rankById = normalizeRankMap(structuralRanks, graph.nodes, structuralRankNodeIds ?? nodes);
  const degreeById = degreeByNode instanceof Map ? degreeByNode : buildDegreeMap(graph.nodes, graph.edges);
  const byCommunity = communitiesByName instanceof Map ? communitiesByName : groupByCommunity(graph.nodes);
  const communityAnchorByName = resolveCommunityAnchors(graph, degreeById, rankById, communityAnchors, byCommunity);
  const hubIdsByCommunity = new Map();
  for (const [community, records] of byCommunity) {
    hubIdsByCommunity.set(community, records
      .slice()
      .sort((left, right) => compareStructuralNodes(left, right, rankById, degreeById))
      .slice(0, DETAIL_BUDGETS[DETAIL_LEVELS.BALANCED].hubsPerCommunity)
      .map((node) => node.id));
  }
  const bridgeIds = bridgeEndpointIds(graph.edges, graph.nodes, rankById, degreeById);
  const representativeIds = representativeRounds(byCommunity, rankById, degreeById);
  const nodeCommunityById = communityByNodeId instanceof Map
    ? communityByNodeId
    : new Map(graph.nodes.map((node) => [node.id, node.community]));
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const edgeById = new Map(graph.edges.map((edge) => [edge.id, edge]));
  const adjacencyByNode = edgesByNode instanceof Map ? edgesByNode : buildEdgesByNode(graph.nodes, graph.edges);
  const structuralEdges = Array.isArray(structuralEdgeRecords)
    ? structuralEdgeRecords
    : orderedIndexedEdges(
      graph.edges.filter((edge) => nodeCommunityById.get(edge.source) !== nodeCommunityById.get(edge.target)),
      degreeById,
      rankById
    );
  const ambientEdges = Array.isArray(ambientEdgeRecords)
    ? ambientEdgeRecords
    : orderedIndexedEdges(
      graph.edges.filter((edge) => nodeCommunityById.get(edge.source) === nodeCommunityById.get(edge.target)),
      degreeById,
      rankById
    );
  const indexedEdgeById = new Map([...structuralEdges, ...ambientEdges].map((record) => [record.edgeId, record]));
  const baseNodeTiers = classifyNodeTiers({
    nodes: graph.nodes,
    degreeById,
    rankById,
    communityAnchorByName
  });
  return Object.freeze({
    kind: 'brainbar-graph3d-presentation-index-v1',
    graph,
    rankById,
    degreeById,
    byCommunity,
    communityAnchorByName,
    communityByNodeId: nodeCommunityById,
    nodeById,
    edgeById,
    edgesByNode: adjacencyByNode,
    structuralEdges,
    ambientEdges,
    indexedEdgeById,
    structuralEdgeIds: new Set(structuralEdges.map(({ edgeId }) => edgeId)),
    ambientEdgeIds: new Set(ambientEdges.map(({ edgeId }) => edgeId)),
    baseNodeTiers,
    structuralCandidates: Object.freeze({
      anchors: [...communityAnchorByName.values()],
      hubIdsByCommunity,
      bridgeIds,
      representativeIds
    })
  });
}

/**
 * Applies zoom hysteresis only to automatic detail choice. A user choice must
 * be passed as `userDetailLevel` and is never overwritten by zoom.
 */
export function resolveZoomDetailLevel({
  nodeCount = 0,
  zoom = 0,
  previousAutoDetailLevel,
  userDetailLevel,
  performanceDegrade = false
} = {}) {
  const explicit = String(userDetailLevel || '').toLowerCase();
  if (Object.values(DETAIL_LEVELS).includes(explicit)) {
    return { detailLevel: explicit, detailReason: DETAIL_REASONS.USER, nextAutoDetailLevel: previousAutoDetailLevel || adaptiveDetailLevel(nodeCount) };
  }
  if (performanceDegrade) {
    return {
      detailLevel: DETAIL_LEVELS.OVERVIEW,
      detailReason: DETAIL_REASONS.PERFORMANCE_DEGRADE,
      nextAutoDetailLevel: DETAIL_LEVELS.OVERVIEW
    };
  }

  const normalizedZoom = finiteNumber(zoom, 0);
  const hasPreviousAutomaticLevel = Object.values(DETAIL_LEVELS).includes(String(previousAutoDetailLevel || '').toLowerCase());
  let next = normalizeDetailLevel(previousAutoDetailLevel, adaptiveDetailLevel(nodeCount));
  // The first frame is the adaptive default, not an implicit zoom-out event.
  // Subsequent camera changes apply hysteresis around that explicit baseline.
  if (!hasPreviousAutomaticLevel) {
    return { detailLevel: next, detailReason: DETAIL_REASONS.ADAPTIVE_DEFAULT, nextAutoDetailLevel: next };
  }
  // Enter thresholds are deliberately higher than the corresponding exits.
  if (next === DETAIL_LEVELS.OVERVIEW && normalizedZoom >= 0.70) {
    next = DETAIL_LEVELS.BALANCED;
  } else if (next === DETAIL_LEVELS.BALANCED && normalizedZoom <= 0.58) {
    next = DETAIL_LEVELS.OVERVIEW;
  } else if (next === DETAIL_LEVELS.BALANCED && normalizedZoom >= 1.34) {
    next = DETAIL_LEVELS.FULL;
  } else if (next === DETAIL_LEVELS.FULL && normalizedZoom <= 1.18) {
    next = DETAIL_LEVELS.BALANCED;
  }
  return { detailLevel: next, detailReason: DETAIL_REASONS.ADAPTIVE_DEFAULT, nextAutoDetailLevel: next };
}

/**
 * The renderer may use these flags to keep semantic feedback while removing
 * nonessential animation. No visual identity or interactive object is removed.
 */
export function reduceMotionPolicy(reduceMotion = false) {
  if (reduceMotion) {
    return {
      reduceMotion: true,
      transitionDurationMs: 0,
      selectionFadeMs: 120,
      allowAmbientBreathing: false,
      allowEdgeFlow: false,
      allowRepeatedPulses: false
    };
  }
  return {
    reduceMotion: false,
    transitionDurationMs: 380,
    selectionFadeMs: 180,
    allowAmbientBreathing: true,
    allowEdgeFlow: true,
    allowRepeatedPulses: true
  };
}

/**
 * Creates an ordered presentation plan. `structuralRanks` and
 * `communityAnchors` are optional Worker-owned metadata: ranks use lower values
 * for greater importance (a Map/object or a Uint32Array aligned to `nodes`,
 * or to explicit `structuralRankNodeIds`),
 * anchors map a community identity to a node identity.
 * When absent the same result is deterministically derived from this graph.
 */
export function buildPresentationPlan({
  index,
  nodes = [],
  edges = [],
  detailLevel,
  detailReason,
  zoom = 0,
  previousAutoDetailLevel,
  userDetailLevel,
  performanceDegrade = false,
  interaction = {},
  structuralRanks,
  structuralRankNodeIds,
  communityAnchors,
  healthAttentionNodeIds = [],
  projectedNodes,
  safeRegions = [],
  retainedLabelIds = [],
  labelBudget,
  reduceMotion = false
} = {}) {
  const structuralIndex = isPresentationIndex(index)
    ? index
    : buildPresentationIndex({ nodes, edges, structuralRanks, structuralRankNodeIds, communityAnchors });
  const graph = structuralIndex.graph;
  const automatic = resolveZoomDetailLevel({
    nodeCount: graph.nodes.length,
    zoom,
    previousAutoDetailLevel: previousAutoDetailLevel ?? (detailReason === DETAIL_REASONS.USER ? undefined : detailLevel),
    userDetailLevel,
    performanceDegrade
  });
  const level = automatic.detailLevel;
  const resolvedReason = validDetailReason(detailReason)
    ? detailReason
    : automatic.detailReason;
  const rankById = structuralIndex.rankById;
  const degreeById = structuralIndex.degreeById;
  const promotions = collectInteractionPromotion(interaction, structuralIndex.edgeById);
  normalizeIdSet(healthAttentionNodeIds).forEach((id) => promotions.nodeIds.add(id));
  const communityAnchorByName = structuralIndex.communityAnchorByName;
  const nodeTiers = resolveIndexedNodeTiers(structuralIndex, promotions.nodeIds, healthAttentionNodeIds);
  const nodeSelection = selectPaintedNodes({
    graph,
    index: structuralIndex,
    level,
    degreeById,
    rankById,
    communityAnchorByName,
    promotions,
    healthAttentionNodeIds
  });
  const edgeSelection = selectPaintedEdges({
    graph,
    index: structuralIndex,
    level,
    nodeIds: nodeSelection.nodeIds,
    promotionEdgeIds: promotions.edgeIds,
    interaction,
    degreeById,
    rankById
  });
  const candidates = graph.nodes
    .filter((node) => nodeSelection.nodeIdSet.has(node.id))
    .map((node) => ({
      id: node.id,
      degree: degreeById.get(node.id) ?? 0,
      tier: nodeTiers.get(node.id) ?? 'D',
      active: promotions.nodeIds.has(node.id),
      point: projectedPointFor(projectedNodes, node.id)
    }));
  const labels = allocateLabels({
    candidates,
    safeRegions,
    retainedLabelIds,
    budget: labelBudget ?? defaultLabelBudget(level, promotions.nodeIds.size > 0),
    projectedNodes
  });
  const diagnostics = presentationDiagnostics({
    level,
    reason: resolvedReason,
    graph,
    paintedNodeCount: nodeSelection.nodeIds.length,
    paintedEdgeCount: edgeSelection.edgeIds.length,
    communityAnchorCount: communityAnchorByName.size,
    persistentLabelCount: labels.length
  });
  const paintBudget = presentationPaintBudget(level, {
    communityCount: communityAnchorByName.size,
    promotionCount: promotions.nodeIds.size
  });

  return {
    detailLevel: level,
    detailReason: resolvedReason,
    nextAutoDetailLevel: automatic.nextAutoDetailLevel,
    queryableNodeCount: graph.nodes.length,
    queryableEdgeCount: graph.edges.length,
    paintedNodeIds: nodeSelection.nodeIds,
    paintedEdgeIds: edgeSelection.edgeIds,
    nodeTiersById: nodeTiers,
    communityAnchorByName,
    communityAnchorIds: [...communityAnchorByName.values()].sort(compareIds),
    paintBudget,
    activePromotionNodeCount: promotions.nodeIds.size,
    structuralPaintedNodeCount: nodeSelection.structuralNodeCount,
    persistentLabels: labels,
    motion: reduceMotionPolicy(reduceMotion),
    diagnostics
  };
}

export function normalizePresentationGraph(nodes = [], edges = []) {
  const nodeById = new Map();
  for (const node of nodes || []) {
    const id = stableNodeId(node);
    if (!id) continue;
    const normalized = {
      id,
      community: stableCommunity(node),
      fingerprint: stableValue({ id, community: stableCommunity(node), type: node?.type, kind: node?.kind })
    };
    const existing = nodeById.get(id);
    if (!existing || normalized.fingerprint.localeCompare(existing.fingerprint) < 0) {
      nodeById.set(id, normalized);
    }
  }
  const nodesOut = [...nodeById.values()].sort((left, right) => compareIds(left.id, right.id));
  const validNodeIds = new Set(nodesOut.map((node) => node.id));
  const edgeById = new Map();
  for (const edge of edges || []) {
    const source = stableEndpoint(edge?.source ?? edge?.from);
    const target = stableEndpoint(edge?.target ?? edge?.to);
    if (!source || !target || !validNodeIds.has(source) || !validNodeIds.has(target)) continue;
    const fingerprint = stableValue({
      source,
      target,
      relation: edge?.relation ?? edge?.context ?? edge?.type ?? '',
      provenance: edge?.provenance ?? edge?.source_file ?? edge?.sourceFile ?? '',
      weight: edge?.weight ?? edge?.confidence ?? ''
    });
    const explicit = stableEndpoint(edge?.id);
    const id = explicit || `edge:${hashString(fingerprint).toString(16).padStart(8, '0')}`;
    const normalized = { id, source, target, fingerprint };
    const existing = edgeById.get(id);
    if (!existing || fingerprint.localeCompare(existing.fingerprint) < 0) {
      edgeById.set(id, normalized);
    }
  }
  return {
    nodes: nodesOut,
    edges: [...edgeById.values()].sort((left, right) => compareIds(left.id, right.id))
  };
}

function preparedNormalizedGraph(nodes, edges) {
  const nodeById = new Map();
  for (const node of nodes) {
    const id = stableNodeId(node);
    if (!id) continue;
    const prepared = { id, community: stableCommunity(node) };
    const existing = nodeById.get(id);
    if (!existing || comparePreparedNodes(prepared, existing) < 0) {
      nodeById.set(id, prepared);
    }
  }
  const preparedNodes = [...nodeById.values()].sort((left, right) => compareIds(left.id, right.id));
  const nodeIds = new Set(preparedNodes.map((node) => node.id));
  const edgeById = new Map();
  for (const edge of edges) {
    const id = stableEndpoint(edge?.id);
    const source = stableEndpoint(edge?.source ?? edge?.from);
    const target = stableEndpoint(edge?.target ?? edge?.to);
    if (!id || !nodeIds.has(source) || !nodeIds.has(target)) continue;
    const prepared = { id, source, target };
    const existing = edgeById.get(id);
    if (!existing || comparePreparedEdges(prepared, existing) < 0) {
      edgeById.set(id, prepared);
    }
  }
  return {
    nodes: preparedNodes,
    edges: [...edgeById.values()].sort((left, right) => compareIds(left.id, right.id))
  };
}

function comparePreparedNodes(left, right) {
  return compareIds(left.community, right.community) || compareIds(left.id, right.id);
}

function comparePreparedEdges(left, right) {
  return compareIds(left.source, right.source)
    || compareIds(left.target, right.target)
    || compareIds(left.id, right.id);
}

export function classifyNodeTiers({
  nodes = [],
  degreeById = new Map(),
  rankById = new Map(),
  communityAnchorByName = new Map(),
  promotedNodeIds = new Set(),
  healthAttentionNodeIds = []
} = {}) {
  const promoted = normalizeIdSet(promotedNodeIds);
  const attention = normalizeIdSet(healthAttentionNodeIds);
  const anchors = new Set(communityAnchorByName instanceof Map
    ? communityAnchorByName.values()
    : Object.values(communityAnchorByName || {}));
  const ranked = [...nodes].sort((left, right) => compareStructuralNodes(left, right, rankById, degreeById));
  const tierBCount = Math.max(1, Math.ceil(ranked.length * 0.01));
  const tierCCount = Math.max(tierBCount, Math.ceil(ranked.length * 0.10));
  const tiers = new Map();
  ranked.forEach((node, index) => {
    let tier = index < tierBCount ? 'B' : (index < tierCCount ? 'C' : 'D');
    if (anchors.has(node.id)) tier = 'B';
    if (attention.has(node.id) && tier === 'D') tier = 'C';
    if (promoted.has(node.id)) tier = 'A';
    tiers.set(node.id, tier);
  });
  return tiers;
}

function resolveIndexedNodeTiers(index, promotedNodeIds, healthAttentionNodeIds) {
  const tiers = new Map(index.baseNodeTiers);
  const promoted = normalizeIdSet(promotedNodeIds);
  const attention = normalizeIdSet(healthAttentionNodeIds);
  promoted.forEach((id) => tiers.set(id, 'A'));
  attention.forEach((id) => {
    if (!promoted.has(id) && index.baseNodeTiers.get(id) === 'D') tiers.set(id, 'C');
  });
  return tiers;
}

/** Returns edge records ordered by the product's active-edge priority. */
export function prioritizeEdges({ edges = [], interaction = {}, degreeById = new Map(), rankById = new Map(), communityByNodeId = new Map() } = {}) {
  const selected = normalizeIdSet([interaction?.selectedNodeId, ...(interaction?.selectedNodeIds || [])]);
  const path = normalizeIdSet(interaction?.pathNodeIds);
  const pathEdges = normalizeIdSet([interaction?.pathEdgeId, ...(interaction?.pathEdgeIds || [])]);
  const inspected = normalizeIdSet([
    interaction?.edgeInspectorEdgeId,
    interaction?.inspectedEdgeId,
    ...(interaction?.edgeInspectorEdgeIds || []),
    ...(interaction?.inspectedEdgeIds || [])
  ]);
  const workflow = normalizeIdSet(interaction?.workflowNodeIds);
  const workflowEdges = normalizeIdSet([interaction?.workflowEdgeId, ...(interaction?.workflowEdgeIds || [])]);
  const trail = normalizeIdSet([
    ...(interaction?.recentNodeIds || []),
    ...(interaction?.storyNodeIds || [])
  ]);
  return (edges || []).map((edge) => {
    const edgeId = String(edge?.id ?? '');
    const source = String(edge?.source ?? '');
    const target = String(edge?.target ?? '');
    let priority = 8;
    if (selected.has(source) || selected.has(target)) priority = 1;
    else if (pathEdges.size ? pathEdges.has(edgeId) : (path.has(source) || path.has(target))) priority = 2;
    else if (inspected.has(edgeId)) priority = 3;
    else if (workflowEdges.size ? workflowEdges.has(edgeId) : (workflow.has(source) || workflow.has(target))) priority = 4;
    else if (trail.has(source) || trail.has(target)) priority = 5;
    else if (communityByNodeId.get(source) !== communityByNodeId.get(target)) priority = 6;
    const importance = (Number(degreeById.get(source)) || 0) + (Number(degreeById.get(target)) || 0);
    const rank = Math.min(normalizedRank(rankById.get(source)), normalizedRank(rankById.get(target)));
    return { edge, edgeId, priority, importance, rank };
  }).filter((candidate) => candidate.edgeId && candidate.edge?.source && candidate.edge?.target)
    .sort((left, right) => (
      left.priority - right.priority
      || left.rank - right.rank
      || right.importance - left.importance
      || compareIds(left.edgeId, right.edgeId)
    ));
}

/**
 * Allocation contains IDs and rectangles only. The caller owns rendered text;
 * this keeps diagnostics and any cache boundary content-free.
 */
export function allocateLabels({
  candidates = [],
  projectedNodes,
  safeRegions = [],
  bounds,
  retainedLabelIds = [],
  budget = 0,
  maxOverlapArea = 0,
  labelMetrics
} = {}) {
  const retained = normalizeIdSet(retainedLabelIds);
  const limit = Math.max(0, Math.floor(finiteNumber(budget, 0)));
  const reserved = normalizeRects(safeRegions);
  const labelBounds = normalizeRect(bounds);
  const accepted = [];
  const ordered = (candidates || []).map((candidate) => ({
    ...candidate,
    id: String(candidate?.id ?? ''),
    degree: finiteNumber(candidate?.degree, 0),
    tier: TIER_WEIGHT[candidate?.tier] ? candidate.tier : 'D',
    active: Boolean(candidate?.active),
    point: candidate?.point ?? projectedPointFor(projectedNodes, candidate?.id)
  })).filter((candidate) => candidate.id && candidate.point)
    .sort((left, right) => (
      Number(right.active) - Number(left.active)
      || TIER_WEIGHT[right.tier] - TIER_WEIGHT[left.tier]
      || right.degree - left.degree
      || compareIds(left.id, right.id)
    ));

  for (const candidate of ordered) {
    if (accepted.length >= limit) break;
    const metrics = typeof labelMetrics === 'function' ? labelMetrics(candidate) : null;
    const rect = labelRect(metrics ? { ...candidate, ...metrics } : candidate);
    if (labelBounds && !rectIsWithinBounds(rect, labelBounds)) continue;
    const allowedOverlap = retained.has(candidate.id) ? Math.max(maxOverlapArea, 12) : maxOverlapArea;
    if (reserved.some((other) => overlapArea(rect, other) > allowedOverlap)) continue;
    accepted.push({ id: candidate.id, tier: candidate.tier, active: candidate.active, rect });
    reserved.push(rect);
  }
  return accepted;
}

export function presentationDiagnostics({
  level,
  reason,
  graph = { nodes: [], edges: [] },
  paintedNodeCount = 0,
  paintedEdgeCount = 0,
  communityAnchorCount = 0,
  persistentLabelCount = 0
} = {}) {
  return {
    detailLevel: normalizeDetailLevel(level),
    detailReason: validDetailReason(reason) ? reason : DETAIL_REASONS.ADAPTIVE_DEFAULT,
    queryableNodeCount: graph.nodes?.length ?? 0,
    queryableEdgeCount: graph.edges?.length ?? 0,
    paintedNodeCount: Math.max(0, Math.floor(finiteNumber(paintedNodeCount, 0))),
    paintedEdgeCount: Math.max(0, Math.floor(finiteNumber(paintedEdgeCount, 0))),
    communityAnchorCount: Math.max(0, Math.floor(finiteNumber(communityAnchorCount, 0))),
    persistentLabelCount: Math.max(0, Math.floor(finiteNumber(persistentLabelCount, 0)))
  };
}

function selectPaintedNodes({ graph, index, level, degreeById, rankById, communityAnchorByName, promotions, healthAttentionNodeIds }) {
  const budget = DETAIL_BUDGETS[level] ?? DETAIL_BUDGETS[DETAIL_LEVELS.BALANCED];
  const nodeById = index?.nodeById ?? new Map(graph.nodes.map((node) => [node.id, node]));
  const byCommunity = index?.byCommunity ?? groupByCommunity(graph.nodes);
  const selected = new Set();
  const staticNodeIds = new Set();
  const add = (id) => {
    if (nodeById.has(id)) selected.add(id);
  };
  // Promotion is the only reason a plan may exceed its structural budget. This
  // keeps Search/Path/etc. exact while preventing a dense cross-community graph
  // from turning every bridge endpoint into an Overview mark.
  const paintBudget = presentationPaintBudget(level, {
    communityCount: byCommunity.size,
    promotionCount: promotions.nodeIds.size
  });
  const structuralLimit = paintBudget.structuralNodeLimit;
  const addStructural = (id) => {
    if (!nodeById.has(id) || selected.has(id) || staticNodeIds.size >= structuralLimit) return;
    staticNodeIds.add(id);
    selected.add(id);
  };
  promotions.nodeIds.forEach(add);
  (index?.structuralCandidates?.anchors ?? [...communityAnchorByName.values()]).forEach(addStructural);
  if (level === DETAIL_LEVELS.FULL) {
    graph.nodes.forEach((node) => add(node.id));
    return { nodeIds: [...selected].sort(compareIds), nodeIdSet: selected, structuralNodeCount: graph.nodes.length };
  }

  // Structural hubs, bridge endpoints, and Recent context are added before
  // representative samples, exactly in the product priority order. Each
  // structural source is capped by the same per-level budget.
  const cachedHubs = index?.structuralCandidates?.hubIdsByCommunity;
  if (cachedHubs) {
    for (const hubIds of cachedHubs.values()) {
      hubIds.slice(0, budget.hubsPerCommunity).forEach(addStructural);
    }
  } else {
    for (const records of byCommunity.values()) {
      records
        .slice()
        .sort((left, right) => compareStructuralNodes(left, right, rankById, degreeById))
        .slice(0, budget.hubsPerCommunity)
        .forEach((node) => addStructural(node.id));
    }
  }
  (index?.structuralCandidates?.bridgeIds ?? bridgeEndpointIds(graph.edges, graph.nodes, rankById, degreeById)).forEach(addStructural);
  normalizeIdSet(healthAttentionNodeIds).forEach(addStructural);
  normalizeIdSet(promotions.recentNodeIds).forEach(addStructural);

  const representatives = index?.structuralCandidates?.representativeIds ?? representativeRounds(byCommunity, rankById, degreeById);
  for (const id of representatives) {
    if (staticNodeIds.size >= structuralLimit) break;
    addStructural(id);
  }
  return { nodeIds: [...selected].sort(compareIds), nodeIdSet: selected, structuralNodeCount: staticNodeIds.size };
}

function selectPaintedEdges({ graph, index, level, nodeIds, promotionEdgeIds, interaction, degreeById, rankById }) {
  const budget = DETAIL_BUDGETS[level] ?? DETAIL_BUDGETS[DETAIL_LEVELS.BALANCED];
  const nodeIdSet = nodeIds instanceof Set ? nodeIds : new Set(nodeIds || []);
  const activeEdgeIds = normalizeIdSet(promotionEdgeIds);
  const selected = new Set();
  if (level === DETAIL_LEVELS.FULL) {
    graph.edges.forEach((edge) => selected.add(edge.id));
    return { edgeIds: [...selected].sort(compareIds), edgeIdSet: selected };
  }

  const edgeIndex = index;
  const priorityByEdgeId = interactionEdgePriorities(interaction, edgeIndex);
  const priorityBuckets = new Map();
  priorityByEdgeId.forEach((priority, edgeId) => {
    const edge = edgeIndex.edgeById.get(edgeId);
    if (!edge) return;
    const bucket = priorityBuckets.get(priority) ?? [];
    bucket.push(indexedEdgeRecord(edge, degreeById, rankById));
    priorityBuckets.set(priority, bucket);
  });
  for (const priority of [1, 2, 3, 4, 5]) {
    const bucket = priorityBuckets.get(priority);
    if (!bucket) continue;
    bucket.sort(compareIndexedEdges);
    bucket.forEach(({ edgeId }) => selected.add(edgeId));
  }

  appendSelectedNodeEdges({
    index: edgeIndex,
    selected,
    nodeIdSet,
    priorityByEdgeId,
    activeEdgeIds,
    edgeLimit: budget.edgeLimit,
    eligibleEdgeIds: edgeIndex.structuralEdgeIds
  });
  if (level !== DETAIL_LEVELS.OVERVIEW) {
    appendSelectedNodeEdges({
      index: edgeIndex,
      selected,
      nodeIdSet,
      priorityByEdgeId,
      activeEdgeIds,
      edgeLimit: budget.edgeLimit,
      eligibleEdgeIds: edgeIndex.ambientEdgeIds
    });
  }
  return { edgeIds: [...selected].sort(compareIds), edgeIdSet: selected };
}

function interactionEdgePriorities(interaction, index) {
  const priorities = new Map();
  const add = (edgeId, priority) => {
    if (!index.edgeById.has(edgeId)) return;
    const previous = priorities.get(edgeId);
    if (previous == null || priority < previous) priorities.set(edgeId, priority);
  };
  const addForNodes = (nodeIds, priority) => {
    normalizeIdSet(nodeIds).forEach((nodeId) => {
      index.edgesByNode.get(nodeId)?.forEach((edge) => add(edge.id, priority));
    });
  };
  addForNodes([interaction?.selectedNodeId, ...(interaction?.selectedNodeIds || [])], 1);
  const pathEdges = normalizeIdSet([interaction?.pathEdgeId, ...(interaction?.pathEdgeIds || [])]);
  if (pathEdges.size) pathEdges.forEach((edgeId) => add(edgeId, 2));
  else addForNodes([interaction?.pathNodeId, ...(interaction?.pathNodeIds || [])], 2);
  normalizeIdSet([
    interaction?.edgeInspectorEdgeId,
    interaction?.inspectedEdgeId,
    ...(interaction?.edgeInspectorEdgeIds || []),
    ...(interaction?.inspectedEdgeIds || [])
  ]).forEach((edgeId) => add(edgeId, 3));
  const workflowEdges = normalizeIdSet([interaction?.workflowEdgeId, ...(interaction?.workflowEdgeIds || [])]);
  if (workflowEdges.size) workflowEdges.forEach((edgeId) => add(edgeId, 4));
  else addForNodes([interaction?.workflowNodeId, ...(interaction?.workflowNodeIds || [])], 4);
  addForNodes([
    interaction?.recentNodeId,
    interaction?.storyNodeId,
    ...(interaction?.recentNodeIds || []),
    ...(interaction?.storyNodeIds || [])
  ], 5);
  return priorities;
}

function appendSelectedNodeEdges({ index, selected, nodeIdSet, priorityByEdgeId, activeEdgeIds, edgeLimit, eligibleEdgeIds }) {
  const candidates = new Map();
  for (const nodeId of nodeIdSet) {
    for (const edge of index.edgesByNode.get(nodeId) || []) {
      if (!eligibleEdgeIds.has(edge.id) || !nodeIdSet.has(edge.source) || !nodeIdSet.has(edge.target)) continue;
      candidates.set(edge.id, edge);
    }
  }
  const ordered = [...candidates.values()]
    .map((edge) => index.indexedEdgeById.get(edge.id))
    .filter(Boolean)
    .sort(compareIndexedEdges);
  for (const { edge, edgeId } of ordered) {
    if (priorityByEdgeId.has(edgeId)) continue;
    if (!nodeIdSet.has(edge.source) || !nodeIdSet.has(edge.target)) continue;
    if (selected.size >= edgeLimit && !activeEdgeIds.has(edgeId)) continue;
    selected.add(edgeId);
  }
}

function indexedEdgeRecord(edge, degreeById, rankById) {
  return {
    edge,
    edgeId: edge.id,
    importance: (Number(degreeById.get(edge.source)) || 0) + (Number(degreeById.get(edge.target)) || 0),
    rank: Math.min(normalizedRank(rankById.get(edge.source)), normalizedRank(rankById.get(edge.target)))
  };
}

function orderedIndexedEdges(edges, degreeById, rankById) {
  const groups = new Map();
  const idsAreOrdered = edges.every((edge, index) => index === 0 || compareIds(edges[index - 1].id, edge.id) <= 0);
  for (const edge of edges) {
    const record = indexedEdgeRecord(edge, degreeById, rankById);
    const rankKey = Number.isFinite(record.rank) ? String(record.rank) : 'infinity';
    const key = `${rankKey}\u0000${record.importance}`;
    const bucket = groups.get(key) ?? { rank: record.rank, importance: record.importance, records: [] };
    bucket.records.push(record);
    groups.set(key, bucket);
  }
  const ordered = [];
  [...groups.values()]
    .sort((left, right) => left.rank - right.rank || right.importance - left.importance)
    .forEach((bucket) => {
      if (!idsAreOrdered) bucket.records.sort((left, right) => compareIds(left.edgeId, right.edgeId));
      ordered.push(...bucket.records);
    });
  return ordered;
}

function buildEdgesByNode(nodes, edges) {
  const result = new Map(nodes.map((node) => [node.id, []]));
  for (const edge of edges) {
    result.get(edge.source)?.push(edge);
    if (edge.target !== edge.source) result.get(edge.target)?.push(edge);
  }
  return result;
}

function compareIndexedEdges(left, right) {
  return left.rank - right.rank
    || right.importance - left.importance
    || compareIds(left.edgeId, right.edgeId);
}

function collectInteractionPromotion(interaction, edgeById) {
  const nodeIds = normalizeIdSet([
    interaction?.selectedNodeId,
    interaction?.hoverNodeId,
    interaction?.focusNodeId,
    interaction?.searchNodeId,
    interaction?.searchRevealNodeId,
    interaction?.pathNodeId,
    interaction?.workflowNodeId,
    interaction?.activityNodeId,
    interaction?.storyNodeId,
    ...(interaction?.selectedNodeIds || []),
    ...(interaction?.hoverNodeIds || []),
    ...(interaction?.focusNodeIds || []),
    ...(interaction?.focusedNodeIds || []),
    ...(interaction?.searchNodeIds || []),
    ...(interaction?.pathNodeIds || []),
    ...(interaction?.workflowNodeIds || []),
    ...(interaction?.activityNodeIds || []),
    ...(interaction?.storyNodeIds || [])
  ]);
  const edgeIds = normalizeIdSet([
    ...(interaction?.pathEdgeIds || []),
    ...(interaction?.workflowEdgeIds || []),
    ...(interaction?.activityEdgeIds || []),
    ...(interaction?.storyEdgeIds || []),
    interaction?.pathEdgeId,
    interaction?.workflowEdgeId,
    interaction?.activityEdgeId,
    interaction?.storyEdgeId,
    interaction?.edgeInspectorEdgeId,
    interaction?.inspectedEdgeId,
    ...(interaction?.edgeInspectorEdgeIds || []),
    ...(interaction?.inspectedEdgeIds || [])
  ]);
  for (const edgeId of edgeIds) {
    const edge = edgeById?.get(edgeId);
    if (edge) {
      nodeIds.add(edge.source);
      nodeIds.add(edge.target);
    }
  }
  return { nodeIds, edgeIds, recentNodeIds: normalizeIdSet(interaction?.recentNodeIds) };
}

function resolveCommunityAnchors(graph, degreeById, rankById, suppliedAnchors, preparedCommunities) {
  const supplied = normalizeAnchorMap(suppliedAnchors);
  const anchors = new Map();
  for (const [community, records] of (preparedCommunities ?? groupByCommunity(graph.nodes))) {
    const provided = supplied.get(community);
    if (provided && records.some((node) => node.id === provided)) {
      anchors.set(community, provided);
      continue;
    }
    const anchor = records.slice().sort((left, right) => compareStructuralNodes(left, right, rankById, degreeById))[0];
    if (anchor) anchors.set(community, anchor.id);
  }
  return anchors;
}

function representativeRounds(byCommunity, rankById, degreeById) {
  const queues = [...byCommunity.entries()].map(([community, records]) => ({
    community,
    cursor: 0,
    ids: records
      .slice()
      .sort((left, right) => (
        normalizedRank(rankById.get(left.id)) - normalizedRank(rankById.get(right.id))
        || stableUnit(`${community}\u0000${left.id}`) - stableUnit(`${community}\u0000${right.id}`)
        || compareIds(left.id, right.id)
      ))
      .map((node) => node.id)
  })).sort((left, right) => compareIds(left.community, right.community));
  const result = [];
  for (let round = 0; queues.some((queue) => queue.cursor < queue.ids.length); round += 1) {
    for (const queue of queues) {
      const id = queue.ids[queue.cursor];
      queue.cursor += 1;
      if (id) result.push(id);
    }
  }
  return result;
}

function bridgeEndpointIds(edges, nodes, rankById, degreeById) {
  const communityById = new Map(nodes.map((node) => [node.id, node.community]));
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const ids = new Set();
  for (const edge of edges) {
    if (communityById.get(edge.source) !== communityById.get(edge.target)) {
      ids.add(edge.source);
      ids.add(edge.target);
    }
  }
  return [...ids]
    .map((id) => nodeById.get(id))
    .filter(Boolean)
    .sort((left, right) => compareStructuralNodes(left, right, rankById, degreeById))
    .map((node) => node.id);
}

function buildDegreeMap(nodes, edges) {
  const degrees = new Map(nodes.map((node) => [node.id, 0]));
  for (const edge of edges) {
    degrees.set(edge.source, (degrees.get(edge.source) ?? 0) + 1);
    degrees.set(edge.target, (degrees.get(edge.target) ?? 0) + 1);
  }
  return degrees;
}

function normalizeRankMap(value, nodes, rankNodes = nodes) {
  const typedRanks = ArrayBuffer.isView(value) ? value : (value instanceof ArrayBuffer ? new Uint32Array(value) : null);
  if (typedRanks) {
    const ranks = new Map();
    for (let index = 0; index < typedRanks.length; index += 1) {
      const id = stableNodeId(rankNodes[index]);
      if (id) ranks.set(id, normalizedRank(typedRanks[index]));
    }
    return ranks;
  }
  const raw = value instanceof Map ? value : new Map(Object.entries(value || {}));
  const ranks = new Map();
  for (const node of nodes) {
    const rank = raw.get(node.id);
    if (Number.isFinite(Number(rank))) ranks.set(node.id, Number(rank));
  }
  return ranks;
}

function isPresentationIndex(value) {
  return value?.kind === 'brainbar-graph3d-presentation-index-v1'
    && Array.isArray(value?.graph?.nodes)
    && Array.isArray(value?.graph?.edges)
    && value.degreeById instanceof Map
    && value.rankById instanceof Map
    && value.byCommunity instanceof Map
    && value.communityAnchorByName instanceof Map
    && value.edgeById instanceof Map
    && value.edgesByNode instanceof Map
    && Array.isArray(value.structuralEdges)
    && Array.isArray(value.ambientEdges);
}

function normalizeAnchorMap(value) {
  if (value instanceof Map) return new Map([...value].map(([community, id]) => [String(community), String(id)]));
  return new Map(Object.entries(value || {}).map(([community, id]) => [String(community), String(id)]));
}

function groupByCommunity(nodes) {
  const groups = new Map();
  for (const node of nodes) {
    const records = groups.get(node.community) ?? [];
    records.push(node);
    groups.set(node.community, records);
  }
  return new Map([...groups.entries()].sort(([left], [right]) => compareIds(left, right)));
}

function compareStructuralNodes(left, right, rankById, degreeById) {
  return normalizedRank(rankById.get(left.id)) - normalizedRank(rankById.get(right.id))
    || (Number(degreeById.get(right.id)) || 0) - (Number(degreeById.get(left.id)) || 0)
    || compareIds(left.id, right.id);
}

function normalizedRank(value) {
  return Number.isFinite(Number(value)) ? Number(value) : Number.POSITIVE_INFINITY;
}

function normalizeIdSet(values) {
  const result = new Set();
  const iterable = values instanceof Set ? values : (Array.isArray(values) ? values : [values]);
  for (const value of iterable) {
    const id = stableEndpoint(value);
    if (id) result.add(id);
  }
  return result;
}

function stableNodeId(node) {
  return stableEndpoint(node?.id);
}

function stableEndpoint(value) {
  const id = String(value ?? '').trim();
  return id ? id : '';
}

function stableCommunity(node) {
  return String(node?.community ?? node?.communityId ?? 'Unassigned').trim() || 'Unassigned';
}

function projectedPointFor(projectedNodes, id) {
  const point = projectedNodes instanceof Map ? projectedNodes.get(id) : projectedNodes?.[id];
  if (!point || !Number.isFinite(Number(point.x)) || !Number.isFinite(Number(point.y))) return null;
  return point;
}

function labelRect(candidate) {
  const point = candidate.point;
  const width = clamp(finiteNumber(candidate.labelWidth, point.labelWidth ?? 96), 24, 240);
  const height = clamp(finiteNumber(candidate.labelHeight, point.labelHeight ?? 16), 12, 48);
  return {
    x: finiteNumber(point.x) + finiteNumber(candidate.offsetX, 8),
    y: finiteNumber(point.y) + finiteNumber(candidate.offsetY, -height - 5),
    width,
    height
  };
}

function normalizeRects(rects) {
  return (rects || []).map((rect) => ({
    x: finiteNumber(rect?.x),
    y: finiteNumber(rect?.y),
    width: Math.max(0, finiteNumber(rect?.width)),
    height: Math.max(0, finiteNumber(rect?.height))
  })).filter((rect) => rect.width && rect.height);
}

function normalizeRect(rect) {
  if (!rect) return null;
  const normalized = {
    x: finiteNumber(rect.x),
    y: finiteNumber(rect.y),
    width: Math.max(0, finiteNumber(rect.width)),
    height: Math.max(0, finiteNumber(rect.height))
  };
  return normalized.width && normalized.height ? normalized : null;
}

function rectIsWithinBounds(rect, bounds) {
  return rect.x >= bounds.x
    && rect.y >= bounds.y
    && rect.x + rect.width <= bounds.x + bounds.width
    && rect.y + rect.height <= bounds.y + bounds.height;
}

function overlapArea(left, right) {
  const width = Math.max(0, Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x));
  const height = Math.max(0, Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y));
  return width * height;
}

function defaultLabelBudget(level, hasActive) {
  if (hasActive) return 14;
  if (level === DETAIL_LEVELS.OVERVIEW) return 8;
  if (level === DETAIL_LEVELS.BALANCED) return 12;
  return 16;
}

function validDetailReason(value) {
  return Object.values(DETAIL_REASONS).includes(value);
}

function stableValue(value) {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableValue(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

function hashString(value) {
  let hash = 2166136261;
  const text = String(value ?? '');
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function stableUnit(value) {
  return hashString(value) / 0xffffffff;
}

function compareIds(left, right) {
  return String(left).localeCompare(String(right));
}

function finiteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
