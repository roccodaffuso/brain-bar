const DEFAULT_MIN_DISTANCE = 13;
const EPSILON = 1e-9;
const GOLDEN_ANGLE = 2.399963229728653;
const COMMUNITY_PADDING = 110;

// Increment whenever the deterministic world-coordinate algorithm changes.
export const graph3dLayoutSchemaVersion = 4;

export function computeDeterministicGraphLayout({ nodes, edges } = {}) {
  const layoutNodes = normalizeLayoutNodes(nodes);
  const layoutEdges = normalizeLayoutEdges(edges, layoutNodes);
  const degreeMap = buildDegreeMap(layoutEdges);
  const communities = buildCommunities(layoutNodes, degreeMap);
  const communityIndexById = new Map(communities.flatMap((community, communityIndex) => (
    community.nodes.map((node) => [node.id, communityIndex])
  )));
  const supergraph = buildCommunitySupergraph(layoutEdges, communityIndexById, communities.length);
  layoutCommunityCenters(communities, supergraph, layoutNodes.length);
  const positions = initializeLocalPositions(communities, degreeMap);
  relaxLocalLayouts({ communities, internalEdges: supergraph.internalEdges, positions });
  const nodesByCommunity = new Map(communities.map((community) => [community.id, community.nodes]));
  separateLocalNodesByGrid({ nodesByCommunity, positions, minDistance: DEFAULT_MIN_DISTANCE });
  normalizeLocalCommunityBounds(communities, positions);
  separateLocalNodesByGrid({ nodesByCommunity, positions, minDistance: DEFAULT_MIN_DISTANCE });

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

  const metadata = buildLayoutMetadata({ layoutNodes, communities, positions, degreeMap, communityIndexById });
  const layout = { nodeIds, positions: packedPositions, ...metadata };
  if (!validateDeterministicGraphLayout(layout, nodeIds.length)) {
    throw new Error('Invalid graph layout result');
  }
  return layout;
}

// This validation deliberately accepts only structural values. The worker never returns labels,
// paths, note text, or graph payload fragments in its supplemental layout metadata.
export function validateDeterministicGraphLayout(layout, nodeCount) {
  if (!Number.isSafeInteger(nodeCount) || nodeCount < 0 || !Array.isArray(layout?.nodeIds)
    || layout.nodeIds.length !== nodeCount
    || !(layout.positions instanceof Float64Array) || layout.positions.length !== nodeCount * 3
    || !(layout.communityIndexByNode instanceof Uint32Array) || layout.communityIndexByNode.length !== nodeCount
    || !(layout.structuralRanks instanceof Uint32Array) || layout.structuralRanks.length !== nodeCount
    || !Number.isSafeInteger(layout.communityCount) || layout.communityCount < 0
    || !(layout.communityCenters instanceof Float64Array) || layout.communityCenters.length !== layout.communityCount * 3
    || !(layout.communityBounds instanceof Float64Array) || layout.communityBounds.length !== layout.communityCount * 6) {
    return false;
  }
  if (![...layout.positions, ...layout.communityCenters, ...layout.communityBounds].every(Number.isFinite)) {
    return false;
  }
  for (let index = 0; index < nodeCount; index += 1) {
    if (!layout.nodeIds[index] || layout.communityIndexByNode[index] >= layout.communityCount
      || layout.structuralRanks[index] >= nodeCount) {
      return false;
    }
  }
  for (let index = 0; index < layout.communityCount; index += 1) {
    const offset = index * 6;
    if (layout.communityBounds[offset] > layout.communityBounds[offset + 1]
      || layout.communityBounds[offset + 2] > layout.communityBounds[offset + 3]
      || layout.communityBounds[offset + 4] > layout.communityBounds[offset + 5]) {
      return false;
    }
  }
  return true;
}

function buildCommunities(nodes, degreeMap) {
  const grouped = new Map();
  nodes.forEach((node) => {
    const group = grouped.get(node.community) ?? [];
    group.push(node);
    grouped.set(node.community, group);
  });
  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([id, communityNodes]) => {
      const count = communityNodes.length;
      // The minimum distance is enforced in world space. This scale leaves enough area for
      // dense communities before the bounded grid pass has to make corrective moves.
      const radius = clamp(54 + Math.sqrt(count) * 28, 90, 3400);
      return {
        id,
        nodes: [...communityNodes].sort((left, right) => left.id.localeCompare(right.id)),
        radius,
        // A graph is not spatial if its local Y extent is a token fraction of
        // its X/Z footprint. This is deliberately a thick ellipsoid rather
        // than a flat disc; the Perspective camera can therefore reveal real
        // parallax while preserving deterministic local ordering.
        depthRadius: clamp(radius * 2.78, 260, 9400),
        weight: count,
        degree: communityNodes.reduce((total, node) => total + (degreeMap.get(node.id) ?? 0), 0),
        center: { x: 0, y: 0, z: 0 }
      };
    });
}

function buildCommunitySupergraph(edges, communityIndexById, communityCount) {
  const macroWeights = new Map();
  const internalEdges = new Map();
  edges.forEach((edge) => {
    const sourceIndex = communityIndexById.get(edge.source);
    const targetIndex = communityIndexById.get(edge.target);
    if (!Number.isInteger(sourceIndex) || !Number.isInteger(targetIndex)) {
      throw new Error('Invalid graph layout input');
    }
    if (sourceIndex === targetIndex) {
      const list = internalEdges.get(sourceIndex) ?? [];
      list.push(edge);
      internalEdges.set(sourceIndex, list);
      return;
    }
    const left = Math.min(sourceIndex, targetIndex);
    const right = Math.max(sourceIndex, targetIndex);
    const key = `${left}:${right}`;
    macroWeights.set(key, (macroWeights.get(key) ?? 0) + 1);
  });
  const macroEdges = [...macroWeights.entries()]
    .map(([key, weight]) => {
      const [source, target] = key.split(':').map(Number);
      return { source, target, weight };
    })
    .sort((left, right) => left.source - right.source || left.target - right.target);
  return { macroEdges, internalEdges, components: connectedCommunityComponents(communityCount, macroEdges) };
}

function connectedCommunityComponents(communityCount, macroEdges) {
  const parents = Array.from({ length: communityCount }, (_, index) => index);
  const find = (index) => {
    let cursor = index;
    while (parents[cursor] !== cursor) {
      parents[cursor] = parents[parents[cursor]];
      cursor = parents[cursor];
    }
    return cursor;
  };
  const join = (left, right) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) {
      parents[rightRoot] = leftRoot;
    }
  };
  macroEdges.forEach((edge) => join(edge.source, edge.target));
  const grouped = new Map();
  for (let index = 0; index < communityCount; index += 1) {
    const root = find(index);
    const component = grouped.get(root) ?? [];
    component.push(index);
    grouped.set(root, component);
  }
  return [...grouped.values()].map((members) => members.sort((left, right) => left - right));
}

function layoutCommunityCenters(communities, supergraph, nodeCount) {
  const components = supergraph.components
    .map((members) => ({
      members,
      weight: members.reduce((total, index) => total + communities[index].weight, 0),
      key: communities[members[0]]?.id ?? ''
    }))
    .sort((left, right) => right.weight - left.weight || left.key.localeCompare(right.key));
  const primary = components.shift();
  if (!primary) {
    return;
  }
  placeComponent(primary.members, { x: 0, y: 0, z: 0 }, communities, supergraph.macroEdges);
  // Disconnected components are packed as peers around the primary mass. The
  // earlier cursor accumulated every preceding footprint, so a tiny component
  // could be pushed thousands of world units away and dominate the camera fit.
  // This deterministic spiral deliberately has no cumulative distance term;
  // the global volume separation below makes the compact starting arrangement
  // non-overlapping without creating a blank satellite orbit.
  const primaryFootprint = componentFootprint(primary.members, communities);
  const baseDistance = Math.max(primaryFootprint * 0.32, Math.sqrt(Math.max(nodeCount, 1)) * 18);
  components.forEach((component, index) => {
    const footprint = componentFootprint(component.members, communities);
    const angle = GOLDEN_ANGLE * (index + 1) + (hashString(component.key) % 1000) / 1000;
    const distance = baseDistance + Math.sqrt(index + 1) * Math.max(footprint * 0.42, 72);
    placeComponent(component.members, {
      x: Math.cos(angle) * distance,
      y: ((hashString(component.key) % 9) - 4) * Math.min(120, footprint * 0.16),
      z: Math.sin(angle) * distance
    }, communities, supergraph.macroEdges);
  });
  const allMembers = communities.map((_, index) => index);
  for (let pass = 0; pass < 18; pass += 1) {
    separateCommunityVolumes(allMembers, communities);
  }
  recenterComponent(allMembers, { x: 0, y: 0, z: 0 }, communities);
}

function componentFootprint(members, communities) {
  const squaredRadii = members.reduce((total, index) => total + communities[index].radius ** 2, 0);
  return Math.max(communities[members[0]]?.radius ?? 72, Math.sqrt(squaredRadii) * 2.25 + COMMUNITY_PADDING);
}

function placeComponent(members, offset, communities, macroEdges) {
  const componentSet = new Set(members);
  const footprint = componentFootprint(members, communities);
  members.forEach((communityIndex, localIndex) => {
    const community = communities[communityIndex];
    if (members.length === 1) {
      community.center = { ...offset };
      return;
    }
    const angle = GOLDEN_ANGLE * localIndex + (hashString(community.id) % 1000) / 1000;
    const distance = Math.sqrt((localIndex + 0.5) / members.length) * footprint * 0.72;
    community.center = {
      x: offset.x + Math.cos(angle) * distance,
      y: offset.y + (((hashString(community.id) % 1000) / 1000) - 0.5) * community.depthRadius * 0.45,
      z: offset.z + Math.sin(angle) * distance
    };
  });
  const componentEdges = macroEdges.filter((edge) => componentSet.has(edge.source) && componentSet.has(edge.target));
  const iterations = clamp(Math.ceil(Math.log2(members.length + 1)) * 3, 4, 18);
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    componentEdges.forEach((edge) => {
      const source = communities[edge.source];
      const target = communities[edge.target];
      const dx = target.center.x - source.center.x;
      const dz = target.center.z - source.center.z;
      const distance = Math.max(Math.hypot(dx, dz), EPSILON);
      const desired = source.radius + target.radius + COMMUNITY_PADDING - clamp(Math.log1p(edge.weight) * 18, 0, 96);
      const force = clamp((distance - desired) * 0.009, -14, 14);
      const moveX = (dx / distance) * force;
      const moveZ = (dz / distance) * force;
      source.center.x += moveX;
      source.center.z += moveZ;
      target.center.x -= moveX;
      target.center.z -= moveZ;
    });
    separateCommunityVolumes(members, communities);
    recenterComponent(members, offset, communities);
  }
  separateCommunityVolumes(members, communities);
  recenterComponent(members, offset, communities);
}

function recenterComponent(members, offset, communities) {
  const totalWeight = members.reduce((total, index) => total + communities[index].weight, 0);
  const center = members.reduce((result, index) => {
    const community = communities[index];
    const weight = community.weight / totalWeight;
    return { x: result.x + community.center.x * weight, y: result.y + community.center.y * weight, z: result.z + community.center.z * weight };
  }, { x: 0, y: 0, z: 0 });
  const shiftX = offset.x - center.x;
  const shiftY = offset.y - center.y;
  const shiftZ = offset.z - center.z;
  members.forEach((index) => {
    const community = communities[index];
    community.center.x += shiftX;
    community.center.y += shiftY;
    community.center.z += shiftZ;
  });
}

function separateCommunityVolumes(members, communities) {
  if (members.length < 2) {
    return;
  }
  const records = members.map((index) => ({ index, community: communities[index] }));
  const medianRadius = [...records].map(({ community }) => community.radius).sort((left, right) => left - right)[Math.floor(records.length / 2)];
  const cellSize = Math.max(160, medianRadius * 2 + COMMUNITY_PADDING);
  const maxRadius = Math.max(...records.map(({ community }) => community.radius));
  for (let pass = 0; pass < 10; pass += 1) {
    const grid = new Map();
    records.forEach((record, recordIndex) => {
      const x = cellCoordinate(record.community.center.x, cellSize);
      const z = cellCoordinate(record.community.center.z, cellSize);
      const bucket = grid.get(cellKey(x, z)) ?? [];
      bucket.push({ record, recordIndex });
      grid.set(cellKey(x, z), bucket);
    });
    let moved = false;
    records.forEach((record, recordIndex) => {
      const community = record.community;
      const range = Math.ceil((community.radius + maxRadius + COMMUNITY_PADDING) / cellSize);
      const cellX = cellCoordinate(community.center.x, cellSize);
      const cellZ = cellCoordinate(community.center.z, cellSize);
      for (let offsetX = -range; offsetX <= range; offsetX += 1) {
        for (let offsetZ = -range; offsetZ <= range; offsetZ += 1) {
          const candidates = grid.get(cellKey(cellX + offsetX, cellZ + offsetZ));
          candidates?.forEach((candidate) => {
            if (candidate.recordIndex >= recordIndex) {
              return;
            }
            const other = candidate.record.community;
            const dx = community.center.x - other.center.x;
            const dy = community.center.y - other.center.y;
            const dz = community.center.z - other.center.z;
            const distance = Math.hypot(dx, dy, dz);
            const minimum = community.radius + other.radius + COMMUNITY_PADDING;
            if (distance >= minimum - EPSILON) {
              return;
            }
            const direction = distance > EPSILON
              ? { x: dx / distance, y: dy / distance, z: dz / distance }
              : fallbackDirection3D(community.id, other.id);
            const push = (minimum - distance) / 2;
            community.center.x += direction.x * push;
            community.center.y += direction.y * push;
            community.center.z += direction.z * push;
            other.center.x -= direction.x * push;
            other.center.y -= direction.y * push;
            other.center.z -= direction.z * push;
            moved = true;
          });
        }
      }
    });
    if (!moved) {
      return;
    }
  }
}

function initializeLocalPositions(communities, degreeMap) {
  const positions = new Map();
  communities.forEach((community) => {
    const orderedNodes = [...community.nodes].sort((left, right) => {
      const degreeOrder = (degreeMap.get(right.id) ?? 0) - (degreeMap.get(left.id) ?? 0);
      return degreeOrder || left.id.localeCompare(right.id);
    });
    orderedNodes.forEach((node, index) => {
      const seed = hashString(`${node.id}:${community.id}`);
      const distance = (0.10 + Math.sqrt((index + 0.5) / orderedNodes.length) * 0.66) * community.radius;
      const angle = GOLDEN_ANGLE * index + (seed % 628) / 100;
      positions.set(node.id, {
        x: community.center.x + Math.cos(angle) * distance,
        y: community.center.y + ((((seed >>> 9) % 1000) / 1000) - 0.5) * community.depthRadius * 1.18,
        z: community.center.z + Math.sin(angle) * distance
      });
    });
  });
  return positions;
}

function relaxLocalLayouts({ communities, internalEdges, positions }) {
  const communityIndexById = new Map(communities.flatMap((community, index) => community.nodes.map((node) => [node.id, index])));
  const totalInternalEdges = [...internalEdges.values()].reduce((total, edges) => total + edges.length, 0);
  const iterations = clamp(Math.ceil(Math.log2(totalInternalEdges + 2)) * 2, 6, 16);
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    internalEdges.forEach((edges, communityIndex) => {
      const community = communities[communityIndex];
      const desired = clamp(community.radius * 0.30, 42, 180);
      edges.forEach((edge) => {
        const source = positions.get(edge.source);
        const target = positions.get(edge.target);
        if (!source || !target || communityIndexById.get(edge.source) !== communityIndex || communityIndexById.get(edge.target) !== communityIndex) {
          throw new Error('Invalid graph layout input');
        }
        const dx = target.x - source.x;
        const dz = target.z - source.z;
        const distance = Math.max(Math.hypot(dx, dz), EPSILON);
        const force = clamp((distance - desired) * 0.012, -3.2, 3.2);
        const moveX = (dx / distance) * force;
        const moveZ = (dz / distance) * force;
        source.x += moveX;
        source.z += moveZ;
        target.x -= moveX;
        target.z -= moveZ;
      });
    });
    if (iteration % 4 === 3) {
      separateLocalNodesByGrid({
        nodesByCommunity: new Map(communities.map((community) => [community.id, community.nodes])),
        positions,
        minDistance: DEFAULT_MIN_DISTANCE
      });
    }
  }
}

function normalizeLocalCommunityBounds(communities, positions) {
  communities.forEach((community) => {
    let maximumRatio = 0;
    community.nodes.forEach((node) => {
      const position = positions.get(node.id);
      maximumRatio = Math.max(maximumRatio,
        Math.abs(position.x - community.center.x) / community.radius,
        Math.abs(position.y - community.center.y) / community.depthRadius,
        Math.abs(position.z - community.center.z) / community.radius
      );
    });
    if (maximumRatio <= 0.90) {
      return;
    }
    const scale = 0.90 / maximumRatio;
    community.nodes.forEach((node) => {
      const position = positions.get(node.id);
      position.x = community.center.x + (position.x - community.center.x) * scale;
      position.y = community.center.y + (position.y - community.center.y) * scale;
      position.z = community.center.z + (position.z - community.center.z) * scale;
    });
  });
}

function buildLayoutMetadata({ layoutNodes, communities, positions, degreeMap, communityIndexById }) {
  const communityCount = communities.length;
  const communityIndexByNode = new Uint32Array(layoutNodes.length);
  const structuralRanks = new Uint32Array(layoutNodes.length);
  const rankById = new Map([...layoutNodes]
    .sort((left, right) => (degreeMap.get(right.id) ?? 0) - (degreeMap.get(left.id) ?? 0)
      || left.community.localeCompare(right.community) || left.id.localeCompare(right.id))
    .map((node, rank) => [node.id, rank]));
  layoutNodes.forEach((node, index) => {
    communityIndexByNode[index] = communityIndexById.get(node.id);
    structuralRanks[index] = rankById.get(node.id);
  });
  const communityCenters = new Float64Array(communityCount * 3);
  const communityBounds = new Float64Array(communityCount * 6);
  communities.forEach((community, index) => {
    communityCenters[index * 3] = community.center.x;
    communityCenters[index * 3 + 1] = community.center.y;
    communityCenters[index * 3 + 2] = community.center.z;
    const bounds = community.nodes.reduce((result, node) => {
      const position = positions.get(node.id);
      return {
        minX: Math.min(result.minX, position.x), maxX: Math.max(result.maxX, position.x),
        minY: Math.min(result.minY, position.y), maxY: Math.max(result.maxY, position.y),
        minZ: Math.min(result.minZ, position.z), maxZ: Math.max(result.maxZ, position.z)
      };
    }, { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity });
    const offset = index * 6;
    // Bounds cover both every painted member and the macro anchor used for framing.
    communityBounds[offset] = Math.min(bounds.minX, community.center.x);
    communityBounds[offset + 1] = Math.max(bounds.maxX, community.center.x);
    communityBounds[offset + 2] = Math.min(bounds.minY, community.center.y);
    communityBounds[offset + 3] = Math.max(bounds.maxY, community.center.y);
    communityBounds[offset + 4] = Math.min(bounds.minZ, community.center.z);
    communityBounds[offset + 5] = Math.max(bounds.maxZ, community.center.z);
  });
  return { communityCount, communityIndexByNode, communityCenters, communityBounds, structuralRanks };
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

function fallbackDirection3D(leftId, rightId) {
  const hash = hashString(`${leftId}\u0000${rightId}\u00003d`);
  const angle = (hash / 0xffffffff) * Math.PI * 2;
  const vertical = (((hash >>> 12) % 1000) / 1000 - 0.5) * 0.72;
  const horizontal = Math.sqrt(Math.max(1 - vertical * vertical, EPSILON));
  return { x: Math.cos(angle) * horizontal, y: vertical, z: Math.sin(angle) * horizontal };
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
  }).sort((left, right) => left.source.localeCompare(right.source) || left.target.localeCompare(right.target));
}

function buildDegreeMap(edges) {
  const degreeMap = new Map();
  edges.forEach((edge) => {
    degreeMap.set(edge.source, (degreeMap.get(edge.source) ?? 0) + 1);
    degreeMap.set(edge.target, (degreeMap.get(edge.target) ?? 0) + 1);
  });
  return degreeMap;
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
