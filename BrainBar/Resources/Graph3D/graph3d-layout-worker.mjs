import {
  computeDeterministicGraphLayout,
  graph3dLayoutSchemaVersion,
  validateDeterministicGraphLayout
} from './graph3d-layout-utils.mjs';

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
    if (!validateDeterministicGraphLayout(layout, data.nodes?.length)) {
      throw new Error('Invalid graph layout result');
    }
    const workerComputeMs = performance.now() - startedAt;
    self.postMessage({
      type: 'result',
      ...context,
      layoutSchemaVersion: graph3dLayoutSchemaVersion,
      nodeIds: layout.nodeIds,
      positions: layout.positions.buffer,
      communityCount: layout.communityCount,
      communityIndexByNode: layout.communityIndexByNode.buffer,
      communityCenters: layout.communityCenters.buffer,
      communityBounds: layout.communityBounds.buffer,
      structuralRanks: layout.structuralRanks.buffer,
      workerComputeMs
    }, [
      layout.positions.buffer,
      layout.communityIndexByNode.buffer,
      layout.communityCenters.buffer,
      layout.communityBounds.buffer,
      layout.structuralRanks.buffer
    ]);
    self.close();
  } catch (_) {
    self.postMessage({ type: 'failed', ...context });
  }
};
