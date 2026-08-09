#!/usr/bin/env node
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const { computeDeterministicGraphLayout, separateLocalNodesByGrid } = await import(pathToFileURL(join(
  root,
  'BrainBar/Resources/Graph3D/graph3d-layout-utils.mjs'
)));

const MIN_DISTANCE = 13;
const WARMUP_RUNS = 2;
const MEASURED_RUNS = 9;
const FULL_LAYOUT_WARMUP_RUNS = 1;
const FULL_LAYOUT_MEASURED_RUNS = 5;
const LEGACY_COMPARISON_GUARD = 2_500_000;
const cases = [
  { label: '1k', nodes: 1_000, edges: 2_370, communities: 10, seed: 0x1a2b3c4d },
  { label: '10k', nodes: 10_000, edges: 23_760, communities: 50, seed: 0x2b3c4d5e },
  { label: 'real shape', nodes: 12_547, edges: 29_868, communities: 64, seed: 0x3c4d5e6f },
  { label: '25k stress', nodes: 25_000, edges: 59_400, communities: 100, seed: 0x4d5e6f70 }
];

console.log('Graph3D local-node separation benchmark');
console.log(`Node ${process.version} · ${process.platform} ${process.arch} · ${os.cpus().length} logical CPUs · ${(os.totalmem() / 1024 ** 3).toFixed(1)} GiB RAM`);
console.log(`Protocol: ${WARMUP_RUNS} warmups + ${MEASURED_RUNS} measured runs per implementation and case; fixed seeds. Legacy runs stop at the ${LEGACY_COMPARISON_GUARD.toLocaleString()} candidate-comparison guard and are reported as over-budget rather than estimated; spatial still completes all ${MEASURED_RUNS} measurements.`);
console.log('Workload: local separation uses sparse 28-unit grids with deterministic near-pair injections. The community-island table below measures the complete Worker layout on deterministic graph fixtures using 1 warmup + 5 measured runs, separately so the 25k gate remains practical on developer hardware.');

const rows = cases.map((definition) => benchmarkCase(definition));

console.log('');
console.log('| Case | Legacy p50 / p95 / CV | Spatial p50 / p95 / CV | p50 speedup | Correctness |');
console.log('| --- | --- | --- | ---: | --- |');
rows.forEach((row) => {
  console.log(`| ${row.label} (${row.nodes.toLocaleString()} nodes, ${row.edges.toLocaleString()} edges, ${row.communities} communities) | ${formatStats(row.legacy)} | ${formatStats(row.spatial)} | ${row.speedup ? `${row.speedup.toFixed(2)}x` : 'over-budget'} | ${row.correctness} |`);
});

const layoutRows = cases.filter(({ label }) => label !== '10k').map(benchmarkCommunityLayoutCase);
console.log('');
console.log('| Community-island layout | p50 / p95 / CV | M1 layout budget | Correctness |');
console.log('| --- | --- | ---: | --- |');
layoutRows.forEach((row) => {
  console.log(`| ${row.label} (${row.nodes.toLocaleString()} nodes, ${row.edges.toLocaleString()} edges) | ${formatStats(row.stats)} | ${row.budget.toLocaleString()} ms | ${row.correct ? 'pass' : 'FAIL'} |`);
  if (!row.correct || row.stats.p95 > row.budget) {
    process.exitCode = 1;
  }
});

function benchmarkCase(definition) {
  const input = createInput(definition);
  const legacy = measure(input, separateLocalNodesLegacyReference, { maxComparisons: LEGACY_COMPARISON_GUARD });
  const spatial = measure(input, separateLocalNodesByGrid);
  return {
    ...definition,
    legacy: legacy.stats,
    spatial: spatial.stats,
    speedup: legacy.overBudget ? null : legacy.stats.p50 / spatial.stats.p50,
    correctness: spatial.correct ? (legacy.overBudget ? 'spatial pass; legacy over-budget' : (legacy.correct ? 'pass' : 'FAIL')) : 'FAIL'
  };
}

function benchmarkCommunityLayoutCase(definition) {
  const graph = createGraphInput(definition);
  for (let index = 0; index < FULL_LAYOUT_WARMUP_RUNS; index += 1) {
    computeDeterministicGraphLayout(graph);
  }
  const durations = [];
  let correct = true;
  for (let index = 0; index < FULL_LAYOUT_MEASURED_RUNS; index += 1) {
    const startedAt = performance.now();
    const layout = computeDeterministicGraphLayout(graph);
    durations.push(performance.now() - startedAt);
    correct &&= layout.nodeIds.length === graph.nodes.length
      && layout.positions.length === graph.nodes.length * 3
      && layout.communityCount === definition.communities
      && [...layout.positions].every(Number.isFinite);
  }
  return {
    ...definition,
    stats: summarize(durations),
    budget: definition.label === '25k stress' ? 3_000 : 1_000,
    correct
  };
}

function createGraphInput({ nodes: nodeCount, edges: edgeCount, communities: communityCount, seed }) {
  const random = createRandom(seed);
  const nodes = Array.from({ length: nodeCount }, (_, index) => ({
    id: `node-${index}`,
    label: `Node ${index}`,
    community: `community-${Math.floor(index * communityCount / nodeCount)}`
  }));
  const boundaries = Array.from({ length: communityCount }, (_, index) => ({
    start: Math.floor(index * nodeCount / communityCount),
    end: Math.floor((index + 1) * nodeCount / communityCount)
  }));
  const edges = Array.from({ length: edgeCount }, (_, index) => {
    const sourceIndex = index % nodeCount;
    const sourceCommunity = Math.floor(sourceIndex * communityCount / nodeCount);
    const boundary = boundaries[sourceCommunity];
    const targetIndex = index % 5 === 0
      ? Math.floor(random() * nodeCount)
      : boundary.start + ((sourceIndex - boundary.start + 1 + Math.floor(random() * Math.max(boundary.end - boundary.start - 1, 1))) % Math.max(boundary.end - boundary.start, 1));
    return { source: nodes[sourceIndex].id, target: nodes[targetIndex === sourceIndex ? (targetIndex + 1) % nodeCount : targetIndex].id };
  });
  return { nodes, edges };
}

function measure(input, implementation, { maxComparisons } = {}) {
  for (let index = 0; index < WARMUP_RUNS; index += 1) {
    const result = implementation(cloneInput(input), { maxComparisons });
    if (result?.overBudget) {
      return { stats: null, correct: false, overBudget: true };
    }
  }

  const durations = [];
  let correct = true;
  for (let index = 0; index < MEASURED_RUNS; index += 1) {
    const runInput = cloneInput(input);
    const startedAt = performance.now();
    const result = implementation(runInput, { maxComparisons });
    const duration = performance.now() - startedAt;
    if (result?.overBudget) {
      return { stats: null, correct: false, overBudget: true };
    }
    durations.push(duration);
    correct &&= hasValidSeparatedPositions(runInput);
  }
  return { stats: summarize(durations), correct, overBudget: false };
}

function createInput({ nodes: nodeCount, communities: communityCount, seed }) {
  const random = createRandom(seed);
  const nodesByCommunity = new Map();
  let nodeIndex = 0;
  for (let communityIndex = 0; communityIndex < communityCount; communityIndex += 1) {
    const remainingNodes = nodeCount - nodeIndex;
    const remainingCommunities = communityCount - communityIndex;
    const count = Math.ceil(remainingNodes / remainingCommunities);
    const nodes = [];
    for (let localIndex = 0; localIndex < count; localIndex += 1) {
      const id = `c${communityIndex}-n${localIndex}`;
      nodes.push({ id });
      nodeIndex += 1;
    }
    nodesByCommunity.set(`community-${communityIndex}`, nodes);
  }

  const positions = new Map();
  nodesByCommunity.forEach((nodes) => {
    const columns = Math.ceil(Math.sqrt(nodes.length));
    nodes.forEach((node, localIndex) => {
      const x = (localIndex % columns) * 28 + (random() - 0.5) * 2;
      const z = Math.floor(localIndex / columns) * 28 + (random() - 0.5) * 2;
      positions.set(node.id, { x, y: (random() - 0.5) * 120, z });
      if (localIndex > 0 && localIndex % 89 === 0) {
        const previous = positions.get(nodes[localIndex - 1].id);
        positions.set(node.id, { x: previous.x + 4, y: (random() - 0.5) * 120, z: previous.z + 1 });
      }
    });
  });
  return { nodesByCommunity, positions };
}

function cloneInput({ nodesByCommunity, positions }) {
  return {
    nodesByCommunity,
    positions: new Map([...positions].map(([id, position]) => [id, { ...position }]))
  };
}

// Benchmark-only reference path representing the prior O(n²) candidate enumeration.
// It shares the current strict correction and convergence rules so correctness is comparable.
function separateLocalNodesLegacyReference({ nodesByCommunity, positions }, { maxComparisons } = {}) {
  let comparisons = 0;
  for (const nodes of nodesByCommunity.values()) {
    const passLimit = Math.min(256, Math.max(32, Math.ceil(Math.log2(nodes.length + 1)) * 32));
    for (let pass = 0; pass < passLimit; pass += 1) {
      let moved = false;
      for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
        const left = positions.get(nodes[leftIndex].id);
        for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
          comparisons += 1;
          if (maxComparisons && comparisons > maxComparisons) {
            return { comparisons, overBudget: true };
          }
          const right = positions.get(nodes[rightIndex].id);
          if (separateReferencePair(left, right, nodes[leftIndex].id, nodes[rightIndex].id)) {
            moved = true;
          }
        }
      }
      if (!moved) {
        break;
      }
    }
  }
  return { comparisons, overBudget: Boolean(maxComparisons && comparisons > maxComparisons) };
}

function separateReferencePair(left, right, leftId, rightId) {
  const dx = right.x - left.x;
  const dz = right.z - left.z;
  const distance = Math.hypot(dx, dz);
  if (distance >= MIN_DISTANCE - 1e-9) {
    return false;
  }
  const direction = distance > 1e-9 ? { x: dx / distance, z: dz / distance } : fallbackDirection(leftId, rightId);
  const push = (MIN_DISTANCE - distance) / 2;
  left.x -= direction.x * push;
  left.z -= direction.z * push;
  right.x += direction.x * push;
  right.z += direction.z * push;
  return true;
}

function hasValidSeparatedPositions({ nodesByCommunity, positions }) {
  for (const nodes of nodesByCommunity.values()) {
    for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
      const left = positions.get(nodes[leftIndex].id);
      if (!Number.isFinite(left?.x) || !Number.isFinite(left?.y) || !Number.isFinite(left?.z)) {
        return false;
      }
      for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
        const right = positions.get(nodes[rightIndex].id);
        if (!Number.isFinite(right?.x) || !Number.isFinite(right?.y) || !Number.isFinite(right?.z)
          || Math.hypot(right.x - left.x, right.z - left.z) < MIN_DISTANCE - 1e-6) {
          return false;
        }
      }
    }
  }
  return true;
}

function summarize(samples) {
  const sorted = [...samples].sort((left, right) => left - right);
  const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length;
  const variance = samples.reduce((sum, value) => sum + (value - mean) ** 2, 0) / samples.length;
  return {
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    cv: (Math.sqrt(variance) / mean) * 100
  };
}

function percentile(sorted, percentileValue) {
  const index = (sorted.length - 1) * percentileValue;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function formatStats(stats) {
  if (!stats) {
    return `over-budget (> ${LEGACY_COMPARISON_GUARD.toLocaleString()} comparisons)`;
  }
  const { p50, p95, cv } = stats;
  return `${p50.toFixed(2)} / ${p95.toFixed(2)} ms / ${cv.toFixed(1)}%`;
}

function createRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    return (value >>> 0) / 0x100000000;
  };
}

function fallbackDirection(leftId, rightId) {
  const hash = hashString(`${leftId}\u0000${rightId}`);
  const angle = (hash / 0xffffffff) * Math.PI * 2;
  return { x: Math.cos(angle), z: Math.sin(angle) };
}

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
