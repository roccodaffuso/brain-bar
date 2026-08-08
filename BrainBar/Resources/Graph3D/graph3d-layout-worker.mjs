import { computeDeterministicGraphLayout } from './graph3d-layout-utils.mjs';

self.postMessage({ type: 'ready' });

self.onmessage = ({ data }) => {
  if (data?.type !== 'layout') {
    return;
  }
  const startedAt = performance.now();
  const context = {
    epoch: data.epoch,
    graphGeneration: data.graphGeneration,
    lens: data.lens,
    visibleGraphRevision: data.visibleGraphRevision
  };
  try {
    const layout = computeDeterministicGraphLayout({ nodes: data.nodes, edges: data.edges });
    const workerComputeMs = performance.now() - startedAt;
    self.postMessage({
      type: 'result',
      ...context,
      nodeIds: layout.nodeIds,
      positions: layout.positions.buffer,
      workerComputeMs
    }, [layout.positions.buffer]);
    self.close();
  } catch (_) {
    self.postMessage({ type: 'failed', ...context });
  }
};
