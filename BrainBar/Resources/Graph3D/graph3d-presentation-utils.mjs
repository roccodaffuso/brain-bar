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
  [DETAIL_LEVELS.OVERVIEW]: { nodeLimit: 1200, edgeLimit: 1800, hubsPerCommunity: 2 },
  [DETAIL_LEVELS.BALANCED]: { nodeLimit: 5000, edgeLimit: 7500, hubsPerCommunity: 8 },
  [DETAIL_LEVELS.FULL]: { nodeLimit: Infinity, edgeLimit: Infinity, hubsPerCommunity: Infinity }
});

/**
 * The adaptive default is intentionally independent of viewport and sidebar
 * width. Those are camera concerns and must not affect stable painted identity.
 */
export function adaptiveDetailLevel(nodeCount = 0) {
  return Number(nodeCount) <= 2500 ? DETAIL_LEVELS.BALANCED : DETAIL_LEVELS.OVERVIEW;
}

export function normalizeDetailLevel(value, fallback = DETAIL_LEVELS.BALANCED) {
  const normalized = String(value || '').toLowerCase();
  return Object.values(DETAIL_LEVELS).includes(normalized) ? normalized : fallback;
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
  let next = normalizeDetailLevel(previousAutoDetailLevel, adaptiveDetailLevel(nodeCount));
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
 * for greater importance (a Map/object or a Uint32Array aligned to `nodes`),
 * anchors map a community identity to a node identity.
 * When absent the same result is deterministically derived from this graph.
 */
export function buildPresentationPlan({
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
  communityAnchors,
  healthAttentionNodeIds = [],
  projectedNodes,
  safeRegions = [],
  retainedLabelIds = [],
  labelBudget,
  reduceMotion = false
} = {}) {
  const graph = normalizePresentationGraph(nodes, edges);
  const automatic = resolveZoomDetailLevel({
    nodeCount: graph.nodes.length,
    zoom,
    previousAutoDetailLevel,
    userDetailLevel: userDetailLevel || detailLevel,
    performanceDegrade
  });
  const level = normalizeDetailLevel(detailLevel, automatic.detailLevel);
  const resolvedReason = validDetailReason(detailReason)
    ? detailReason
    : (detailLevel && !userDetailLevel ? DETAIL_REASONS.USER : automatic.detailReason);
  const rankById = normalizeRankMap(structuralRanks, graph.nodes);
  const degreeById = buildDegreeMap(graph.nodes, graph.edges);
  const promotions = collectInteractionPromotion(interaction, graph.edges);
  normalizeIdSet(healthAttentionNodeIds).forEach((id) => promotions.nodeIds.add(id));
  const communityAnchorByName = resolveCommunityAnchors(graph, degreeById, rankById, communityAnchors);
  const nodeTiers = classifyNodeTiers({
    nodes: graph.nodes,
    degreeById,
    rankById,
    communityAnchorByName,
    promotedNodeIds: promotions.nodeIds,
    healthAttentionNodeIds
  });
  const nodeSelection = selectPaintedNodes({
    graph,
    level,
    degreeById,
    rankById,
    communityAnchorByName,
    promotions,
    healthAttentionNodeIds
  });
  const edgeSelection = selectPaintedEdges({
    graph,
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
  retainedLabelIds = [],
  budget = 0,
  maxOverlapArea = 0
} = {}) {
  const retained = normalizeIdSet(retainedLabelIds);
  const limit = Math.max(0, Math.floor(finiteNumber(budget, 0)));
  const reserved = normalizeRects(safeRegions);
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
    const rect = labelRect(candidate);
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

function selectPaintedNodes({ graph, level, degreeById, rankById, communityAnchorByName, promotions, healthAttentionNodeIds }) {
  const budget = DETAIL_BUDGETS[level] ?? DETAIL_BUDGETS[DETAIL_LEVELS.BALANCED];
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const selected = new Set();
  const add = (id) => {
    if (nodeById.has(id)) selected.add(id);
  };
  promotions.nodeIds.forEach(add);
  communityAnchorByName.forEach(add);
  if (level === DETAIL_LEVELS.FULL) {
    graph.nodes.forEach((node) => add(node.id));
    return { nodeIds: [...selected].sort(compareIds), nodeIdSet: selected };
  }

  const byCommunity = groupByCommunity(graph.nodes);
  const target = Math.max(selected.size, budget.nodeLimit);
  // Structural hubs, bridge endpoints, and Recent context are added before
  // representative samples, exactly in the product priority order.
  for (const records of byCommunity.values()) {
    records
      .slice()
      .sort((left, right) => compareStructuralNodes(left, right, rankById, degreeById))
      .slice(0, budget.hubsPerCommunity)
      .forEach((node) => add(node.id));
  }
  bridgeEndpointIds(graph.edges, graph.nodes).forEach(add);
  normalizeIdSet(healthAttentionNodeIds).forEach(add);
  normalizeIdSet(promotions.recentNodeIds).forEach(add);

  const representatives = representativeRounds(byCommunity, rankById, degreeById);
  for (const id of representatives) {
    if (selected.size >= target) break;
    add(id);
  }
  return { nodeIds: [...selected].sort(compareIds), nodeIdSet: selected };
}

function selectPaintedEdges({ graph, level, nodeIds, promotionEdgeIds, interaction, degreeById, rankById }) {
  const budget = DETAIL_BUDGETS[level] ?? DETAIL_BUDGETS[DETAIL_LEVELS.BALANCED];
  const nodeIdSet = nodeIds instanceof Set ? nodeIds : new Set(nodeIds || []);
  const communityByNodeId = new Map(graph.nodes.map((node) => [node.id, node.community]));
  const activeEdgeIds = normalizeIdSet(promotionEdgeIds);
  const ordered = prioritizeEdges({ edges: graph.edges, interaction, degreeById, rankById, communityByNodeId });
  const selected = new Set();
  for (const candidate of ordered) {
    const { edge, edgeId, priority } = candidate;
    const active = activeEdgeIds.has(edgeId) || priority < 6;
    const endpointsPainted = nodeIdSet.has(edge.source) && nodeIdSet.has(edge.target);
    if (!active && !endpointsPainted) continue;
    if (level === DETAIL_LEVELS.OVERVIEW && priority > 6) continue;
    if (selected.size >= budget.edgeLimit && !active) continue;
    selected.add(edgeId);
  }
  if (level === DETAIL_LEVELS.FULL) graph.edges.forEach((edge) => selected.add(edge.id));
  return { edgeIds: [...selected].sort(compareIds), edgeIdSet: selected };
}

function collectInteractionPromotion(interaction, edges) {
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
  for (const edge of edges) {
    if (edgeIds.has(edge.id)) {
      nodeIds.add(edge.source);
      nodeIds.add(edge.target);
    }
  }
  return { nodeIds, edgeIds, recentNodeIds: normalizeIdSet(interaction?.recentNodeIds) };
}

function resolveCommunityAnchors(graph, degreeById, rankById, suppliedAnchors) {
  const supplied = normalizeAnchorMap(suppliedAnchors);
  const anchors = new Map();
  for (const [community, records] of groupByCommunity(graph.nodes)) {
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
  for (let round = 0; queues.some((queue) => queue.ids.length); round += 1) {
    for (const queue of queues) {
      const id = queue.ids.shift();
      if (id) result.push(id);
    }
  }
  return result;
}

function bridgeEndpointIds(edges, nodes) {
  const communityById = new Map(nodes.map((node) => [node.id, node.community]));
  const ids = new Set();
  for (const edge of edges) {
    if (communityById.get(edge.source) !== communityById.get(edge.target)) {
      ids.add(edge.source);
      ids.add(edge.target);
    }
  }
  return [...ids].sort(compareIds);
}

function buildDegreeMap(nodes, edges) {
  const degrees = new Map(nodes.map((node) => [node.id, 0]));
  for (const edge of edges) {
    degrees.set(edge.source, (degrees.get(edge.source) ?? 0) + 1);
    degrees.set(edge.target, (degrees.get(edge.target) ?? 0) + 1);
  }
  return degrees;
}

function normalizeRankMap(value, nodes) {
  const typedRanks = ArrayBuffer.isView(value) ? value : (value instanceof ArrayBuffer ? new Uint32Array(value) : null);
  if (typedRanks) {
    return new Map(nodes.map((node, index) => [node.id, normalizedRank(typedRanks[index])]));
  }
  const raw = value instanceof Map ? value : new Map(Object.entries(value || {}));
  const ranks = new Map();
  for (const node of nodes) {
    const rank = raw.get(node.id);
    if (Number.isFinite(Number(rank))) ranks.set(node.id, Number(rank));
  }
  return ranks;
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
