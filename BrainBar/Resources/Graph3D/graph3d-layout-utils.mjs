const DEFAULT_MIN_DISTANCE = 13;
const EPSILON = 1e-9;

export function computeDeterministicGraphLayout({ nodes, edges } = {}) {
  const layoutNodes = normalizeLayoutNodes(nodes);
  const layoutEdges = normalizeLayoutEdges(edges, layoutNodes);
  const positions = new Map();
  const nodesByCommunity = new Map();
  const degreeMap = buildDegreeMap(layoutEdges);
  const sortedNodes = [...layoutNodes].sort((left, right) => {
    const communityOrder = left.community.localeCompare(right.community);
    return communityOrder !== 0 ? communityOrder : left.label.localeCompare(right.label);
  });
  const nodeCount = Math.max(sortedNodes.length, 1);
  const outerRadius = clamp(Math.sqrt(nodeCount) * 14.2, 240, 780);

  layoutNodes.forEach((node) => {
    const communityNodes = nodesByCommunity.get(node.community) ?? [];
    communityNodes.push(node);
    nodesByCommunity.set(node.community, communityNodes);
  });

  sortedNodes.forEach((node, index) => {
    const seed = hashString(`${node.id}:${node.community}`);
    const degree = degreeMap.get(node.id) ?? 0;
    const angle = index * 2.399963229728653 + (seed % 628) / 100;
    const baseDistance = Math.sqrt((index + 0.5) / nodeCount) * outerRadius;
    const hubPull = clamp(Math.log1p(degree) / 7, 0, 0.55);
    const distanceJitter = (((seed % 1000) / 1000) - 0.5) * 34;
    const distance = clamp((baseDistance * (1 - hubPull * 0.42)) + distanceJitter, 24, outerRadius);
    const depth = depthForNode(node, index, degreeMap);
    positions.set(node.id, {
      x: Math.cos(angle) * distance,
      y: depth,
      z: Math.sin(angle) * distance
    });
  });

  relaxLayout({ nodes: layoutNodes, edges: layoutEdges, nodesByCommunity, positions });
  expandDepthForSideViews({ nodes: layoutNodes, positions });

  const nodeIds = layoutNodes.map((node) => node.id);
  const packedPositions = new Float64Array(nodeIds.length * 3);
  nodeIds.forEach((id, index) => {
    const position = positions.get(id);
    if (!isFinitePosition(position)) {
      throw new Error('Invalid graph layout result');
    }
    packedPositions[index * 3] = position.x;
    packedPositions[index * 3 + 1] = position.y;
    packedPositions[index * 3 + 2] = position.z;
  });
  return { nodeIds, positions: packedPositions };
}

export function separateLocalNodesByGrid({
  nodesByCommunity,
  positions,
  minDistance = DEFAULT_MIN_DISTANCE,
  maxPasses
} = {}) {
  if (!(nodesByCommunity instanceof Map) || !(positions instanceof Map) || minDistance <= 0) {
    return { comparisons: 0, corrections: 0, passes: 0, converged: false, fallbackUsed: false };
  }

  let comparisons = 0;
  let corrections = 0;
  let passes = 0;
  let converged = true;
  let fallbackUsed = false;

  nodesByCommunity.forEach((nodes) => {
    if (!Array.isArray(nodes) || nodes.length < 2) {
      return;
    }

    const records = nodes
      .map((node) => ({ id: String(node?.id ?? ''), position: positions.get(node?.id) }))
      .filter(({ id, position }) => id && isFinitePosition(position));
    if (records.length !== nodes.length) {
      converged = false;
      return;
    }
    if (records.length < 2) {
      return;
    }

    const passLimit = maxPasses ?? Math.min(256, Math.max(32, Math.ceil(Math.log2(records.length + 1)) * 32));
    let settled = false;
    for (let pass = 0; pass < passLimit; pass += 1) {
      let grid = buildGrid(records, minDistance);
      if (spreadCoincidentNodes(grid, minDistance)) {
        grid = buildGrid(records, minDistance);
      }
      let moved = false;
      passes += 1;

      records.forEach((record, index) => {
        const cellX = cellCoordinate(record.position.x, minDistance);
        const cellZ = cellCoordinate(record.position.z, minDistance);
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          for (let offsetZ = -1; offsetZ <= 1; offsetZ += 1) {
            const candidates = grid.get(cellKey(cellX + offsetX, cellZ + offsetZ));
            if (!candidates) {
              continue;
            }
            candidates.forEach((candidate) => {
              if (candidate.index >= index) {
                return;
              }
              comparisons += 1;
              if (separatePair(record, candidate.record, minDistance)) {
                corrections += 1;
                moved = true;
              }
            });
          }
        }
      });

      if (!moved) {
        settled = true;
        break;
      }
    }
    if (!settled) {
      arrangeCommunityOnLattice(records, minDistance);
      fallbackUsed = true;
      if (!hasMinimumSeparation(records, minDistance)) {
        converged = false;
      }
    }
  });

  return { comparisons, corrections, passes, converged, fallbackUsed };
}

function buildGrid(records, cellSize) {
  const grid = new Map();
  records.forEach((record, index) => {
    const key = cellKey(cellCoordinate(record.position.x, cellSize), cellCoordinate(record.position.z, cellSize));
    const bucket = grid.get(key) ?? [];
    bucket.push({ index, record });
    grid.set(key, bucket);
  });
  return grid;
}

function spreadCoincidentNodes(grid, minDistance) {
  let spread = false;
  grid.forEach((bucket) => {
    if (bucket.length < 2) {
      return;
    }
    const coincident = new Map();
    bucket.forEach(({ record }) => {
      const key = `${record.position.x},${record.position.z}`;
      const group = coincident.get(key) ?? [];
      group.push(record);
      coincident.set(key, group);
    });
    coincident.forEach((group) => {
      if (group.length < 2) {
        return;
      }
      const origin = { x: group[0].position.x, z: group[0].position.z };
      const columns = Math.ceil(Math.sqrt(group.length));
      const offset = (columns - 1) / 2;
      group.forEach((record, index) => {
        record.position.x = origin.x + ((index % columns) - offset) * minDistance;
        record.position.z = origin.z + (Math.floor(index / columns) - offset) * minDistance;
      });
      spread = true;
    });
  });
  return spread;
}

function arrangeCommunityOnLattice(records, minDistance) {
  let centerX = 0;
  let centerZ = 0;
  records.forEach(({ position }, index) => {
    centerX += (position.x - centerX) / (index + 1);
    centerZ += (position.z - centerZ) / (index + 1);
  });
  const columns = Math.ceil(Math.sqrt(records.length));
  const offset = (columns - 1) / 2;
  const spacing = minDistance + 0.001;
  records.forEach((record, index) => {
    record.position.x = centerX + ((index % columns) - offset) * spacing;
    record.position.z = centerZ + (Math.floor(index / columns) - offset) * spacing;
  });
}

function hasMinimumSeparation(records, minDistance) {
  const grid = buildGrid(records, minDistance);
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!isFinitePosition(record.position)) {
      return false;
    }
    const cellX = cellCoordinate(record.position.x, minDistance);
    const cellZ = cellCoordinate(record.position.z, minDistance);
    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      for (let offsetZ = -1; offsetZ <= 1; offsetZ += 1) {
        const candidates = grid.get(cellKey(cellX + offsetX, cellZ + offsetZ));
        if (candidates?.some((candidate) => (
          candidate.index < index
          && Math.hypot(candidate.record.position.x - record.position.x, candidate.record.position.z - record.position.z) < minDistance - EPSILON
        ))) {
          return false;
        }
      }
    }
  }
  return true;
}

function separatePair(left, right, minDistance) {
  const dx = right.position.x - left.position.x;
  const dz = right.position.z - left.position.z;
  const distance = Math.hypot(dx, dz);
  if (distance >= minDistance - EPSILON) {
    return false;
  }

  const direction = distance > EPSILON ? { x: dx / distance, z: dz / distance } : fallbackDirection(left.id, right.id);
  const push = (minDistance - distance) / 2;
  left.position.x -= direction.x * push;
  left.position.z -= direction.z * push;
  right.position.x += direction.x * push;
  right.position.z += direction.z * push;
  return true;
}

function fallbackDirection(leftId, rightId) {
  const hash = hashString(`${leftId}\u0000${rightId}`);
  const angle = (hash / 0xffffffff) * Math.PI * 2;
  return { x: Math.cos(angle), z: Math.sin(angle) };
}


function cellCoordinate(value, cellSize) {
  return Math.floor(value / cellSize);
}

function cellKey(x, z) {
  return `${x},${z}`;
}

function isFinitePosition(position) {
  return Number.isFinite(position?.x) && Number.isFinite(position?.y) && Number.isFinite(position?.z);
}

function normalizeLayoutNodes(nodes) {
  if (!Array.isArray(nodes)) {
    throw new Error('Invalid graph layout input');
  }
  const nodeIds = new Set();
  return nodes.map((node) => {
    const id = typeof node?.id === 'string' ? node.id : '';
    const label = typeof node?.label === 'string' ? node.label : '';
    const community = typeof node?.community === 'string' ? node.community : '';
    if (!id || !label || !community || nodeIds.has(id)) {
      throw new Error('Invalid graph layout input');
    }
    nodeIds.add(id);
    return { id, label, community };
  });
}

function normalizeLayoutEdges(edges, nodes) {
  if (!Array.isArray(edges)) {
    throw new Error('Invalid graph layout input');
  }
  const nodeIds = new Set(nodes.map((node) => node.id));
  return edges.map((edge) => {
    const source = typeof edge?.source === 'string' ? edge.source : '';
    const target = typeof edge?.target === 'string' ? edge.target : '';
    if (!source || !target || !nodeIds.has(source) || !nodeIds.has(target)) {
      throw new Error('Invalid graph layout input');
    }
    return { source, target };
  });
}

function buildDegreeMap(edges) {
  const degreeMap = new Map();
  edges.forEach((edge) => {
    degreeMap.set(edge.source, (degreeMap.get(edge.source) ?? 0) + 1);
    degreeMap.set(edge.target, (degreeMap.get(edge.target) ?? 0) + 1);
  });
  return degreeMap;
}

function depthForNode(node, localIndex, degreeMap) {
  const seed = hashString(`${node.id}:${node.community}`);
  const degree = degreeMap.get(node.id) ?? 0;
  const hubLift = Math.min(260, Math.log1p(degree) * 38);
  const communityBand = ((hashString(node.community) % 29) - 14) * 24;
  const organicLayer = (((seed % 1000) / 1000) - 0.5) * 520;
  const localWave = Math.sin((localIndex + 1) * 1.618 + (seed % 97)) * 150;
  return clamp(communityBand + organicLayer + localWave + hubLift - 126, -980, 1120);
}

function relaxLayout({ nodes, edges, nodesByCommunity, positions }) {
  const visibleIds = new Set(nodes.map((node) => node.id));
  const iterations = Math.min(30, Math.max(12, Math.floor(edges.length / 60)));
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    edges.forEach((edge) => {
      if (!visibleIds.has(edge.source) || !visibleIds.has(edge.target)) {
        return;
      }
      const source = positions.get(edge.source);
      const target = positions.get(edge.target);
      const dx = target.x - source.x;
      const dz = target.z - source.z;
      const length = Math.max(Math.hypot(dx, dz), 0.001);
      const force = (length - 68) * 0.003;
      const ox = (dx / length) * force;
      const oz = (dz / length) * force;
      source.x += ox;
      source.z += oz;
      target.x -= ox;
      target.z -= oz;
    });
    if (iteration % 5 === 0) {
      separateLocalNodesByGrid({ nodesByCommunity, positions, minDistance: DEFAULT_MIN_DISTANCE });
    }
  }
  separateLocalNodesByGrid({ nodesByCommunity, positions, minDistance: DEFAULT_MIN_DISTANCE });
}

function expandDepthForSideViews({ nodes, positions }) {
  if (!nodes.length || !positions.size) {
    return;
  }
  const bounds = nodes.reduce((result, node) => {
    const position = positions.get(node.id);
    return {
      minX: Math.min(result.minX, position.x),
      maxX: Math.max(result.maxX, position.x),
      minY: Math.min(result.minY, position.y),
      maxY: Math.max(result.maxY, position.y),
      minZ: Math.min(result.minZ, position.z),
      maxZ: Math.max(result.maxZ, position.z)
    };
  }, { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity });
  const width = Math.max(bounds.maxX - bounds.minX, 120);
  const depth = Math.max(bounds.maxZ - bounds.minZ, 120);
  const currentY = Math.max(bounds.maxY - bounds.minY, 1);
  const planarSpan = Math.max(width, depth);
  const targetY = clamp(planarSpan * 1.02, 920, 1900);
  if (currentY >= targetY * 0.9) {
    return;
  }
  const centerY = (bounds.minY + bounds.maxY) / 2;
  const scale = targetY / currentY;
  positions.forEach((position) => {
    position.y = centerY + (position.y - centerY) * scale;
  });
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
