(function makeBrainBarGraphEvidence(root, factory) {
  const api = factory();
  root.BrainBarGraphEvidence = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function buildBrainBarGraphEvidence() {
  'use strict';

  const SCHEMA_VERSION = 1;
  const RULES_VERSION = 1;
  const DAY_MS = 24 * 60 * 60 * 1000;
  const RULES = {
    orphan: 'orphan-node',
    isolated: 'isolated-component',
    stale: 'stale-hub',
    bridge: 'weak-bridge',
    unresolved: 'unresolved-explicit-edge'
  };

  const own = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);
  const scalarString = (value) => (
    typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
      ? String(value)
      : ''
  );
  const string = (value) => scalarString(value).trim();
  // Graph identities preserve every nonblank character; only whitespace-only IDs are absent.
  const exactID = (value) => {
    const raw = scalarString(value);
    return raw.trim() ? raw : '';
  };
  const endpointID = (value) => {
    const scalar = exactID(value);
    if (scalar) return scalar;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
    for (const key of ['id', 'label', 'name']) {
      if (own(value, key)) {
        const nested = exactID(value[key]);
        if (nested) return nested;
      }
    }
    return '';
  };
  const compare = (left, right) => String(left) < String(right) ? -1 : (String(left) > String(right) ? 1 : 0);
  const sorted = (values) => [...values].sort(compare);
  const uniqueSorted = (values) => sorted(new Set(values.filter(Boolean).map(String)));
  const first = (object, keys) => {
    for (const key of keys) {
      const value = string(object && object[key]);
      if (value) return value;
    }
    return '';
  };
  const stableObject = (value) => {
    if (Array.isArray(value)) return value.map(stableObject);
    if (!value || typeof value !== 'object') return value;
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = stableObject(value[key]);
      return result;
    }, {});
  };
  const stableJSON = (value) => JSON.stringify(stableObject(value));
  const endpoint = (edge, names) => {
    for (const name of names) {
      if (own(edge, name) && endpointID(edge[name])) return endpointID(edge[name]);
    }
    return '';
  };
  const explicitEndpoint = (edge, names) => names.some((name) => own(edge, name) && endpointID(edge[name]));
  const timestamp = (value) => {
    if (typeof value === 'number' && Number.isFinite(value)) return value < 1e11 ? value * 1000 : value;
    const numeric = Number(value);
    if (string(value) && Number.isFinite(numeric)) return numeric < 1e11 ? numeric * 1000 : numeric;
    const parsed = Date.parse(String(value));
    return Number.isFinite(parsed) ? parsed : null;
  };
  const provenance = (relation, context) => {
    const values = `${relation} ${context}`.toLowerCase();
    if (values.includes('wikilink')) return 'Wikilink';
    if (values.includes('graphify')) return 'Graphify';
    return 'Unknown';
  };

  function normalize(graph) {
    const rawNodes = Array.isArray(graph && graph.nodes) ? graph.nodes : [];
    const rawEdges = Array.isArray(graph && graph.edges) ? graph.edges : (Array.isArray(graph && graph.links) ? graph.links : []);
    const candidateNodes = rawNodes.map((raw) => {
      const id = exactID(raw && raw.id);
      if (!id) return null;
      const node = {
        id,
        label: first(raw, ['label', 'title']) || id,
        sourceFile: first(raw, ['source_file', '_source_file', 'sourceFile']),
        community: first(raw, ['community', 'community_name', 'group', 'cluster']),
        mtime: first(raw, ['mtime', 'modified_at', 'modifiedAt', 'updated_at', 'updatedAt']),
        status: first(raw, ['status']),
        category: first(raw, ['category', 'type'])
      };
      return { ...node, sortKey: stableJSON(node) };
    }).filter(Boolean);
    const nodeById = new Map();
    candidateNodes.sort((left, right) => compare(left.sortKey, right.sortKey)).forEach((candidate) => {
      if (!nodeById.has(candidate.id)) {
        const { sortKey, ...node } = candidate;
        nodeById.set(node.id, node);
      }
    });
    const edgeCandidates = rawEdges.map((raw) => {
      const sourceId = endpoint(raw, ['from', 'source']);
      const targetId = endpoint(raw, ['to', 'target']);
      const relation = first(raw, ['relation', 'type']);
      const context = first(raw, ['context']);
      const sourceFile = first(raw, ['source_file', '_source_file', 'sourceFile']);
      const explicitId = exactID(raw && raw.id);
      const identity = stableJSON({ sourceId, targetId, relation, context, sourceFile, explicitId });
      return {
        sourceId, targetId, relation, context, sourceFile,
        provenance: provenance(relation, context),
        explicitSource: explicitEndpoint(raw, ['from', 'source']),
        explicitTarget: explicitEndpoint(raw, ['to', 'target']),
        explicitId, identity
      };
    });
    edgeCandidates.sort((left, right) => compare(left.identity, right.identity));
    const reservedExplicitIDs = new Set(edgeCandidates.filter((edge) => edge.explicitId).map((edge) => edge.explicitId));
    const assignedIDs = new Set();
    let derivedOrdinal = 0;
    const edges = edgeCandidates.map((edge) => {
      if (!edge.explicitId) {
        let id;
        do {
          derivedOrdinal += 1;
          id = `edge:derived:${derivedOrdinal}`;
        } while (reservedExplicitIDs.has(id) || assignedIDs.has(id));
        assignedIDs.add(id);
        return { ...edge, id };
      }
      let id = edge.explicitId;
      let duplicateOrdinal = 1;
      while (assignedIDs.has(id)) {
        duplicateOrdinal += 1;
        id = `${edge.explicitId}#${duplicateOrdinal}`;
        while (reservedExplicitIDs.has(id) || assignedIDs.has(id)) {
          duplicateOrdinal += 1;
          id = `${edge.explicitId}#${duplicateOrdinal}`;
        }
      }
      assignedIDs.add(id);
      return { ...edge, id };
    }).sort((left, right) => compare(left.id, right.id));
    return { nodes: [...nodeById.values()].sort((left, right) => compare(left.id, right.id)), edges };
  }

  function evidenceFor(normalized) {
    const nodeEvidenceById = {};
    const edgeEvidenceById = {};
    normalized.nodes.forEach((node) => {
      nodeEvidenceById[node.id] = {
        id: node.id, label: node.label, sourceFile: node.sourceFile, community: node.community,
        mtime: node.mtime, status: node.status, category: node.category, incoming: [], outgoing: []
      };
    });
    normalized.edges.forEach((edge) => {
      const item = {
        id: edge.id, sourceId: edge.sourceId, targetId: edge.targetId, relation: edge.relation,
        context: edge.context, provenance: edge.provenance, sourceFile: edge.sourceFile
      };
      edgeEvidenceById[edge.id] = item;
      if (nodeEvidenceById[edge.sourceId]) nodeEvidenceById[edge.sourceId].outgoing.push(item);
      if (nodeEvidenceById[edge.targetId]) nodeEvidenceById[edge.targetId].incoming.push(item);
    });
    Object.values(nodeEvidenceById).forEach((node) => {
      node.incoming.sort((left, right) => compare(left.id, right.id));
      node.outgoing.sort((left, right) => compare(left.id, right.id));
    });
    return { nodeEvidenceById, edgeEvidenceById };
  }

  function topology(normalized) {
    const neighbors = new Map(normalized.nodes.map((node) => [node.id, new Set()]));
    const edgeIds = new Map(normalized.nodes.map((node) => [node.id, new Set()]));
    normalized.edges.forEach((edge) => {
      if (neighbors.has(edge.sourceId) && neighbors.has(edge.targetId) && edge.sourceId !== edge.targetId) {
        neighbors.get(edge.sourceId).add(edge.targetId);
        neighbors.get(edge.targetId).add(edge.sourceId);
        edgeIds.get(edge.sourceId).add(edge.id);
        edgeIds.get(edge.targetId).add(edge.id);
      }
    });
    const componentFor = () => {
      const components = [];
      const visited = new Set();
      [...neighbors.keys()].sort().forEach((start) => {
        if (visited.has(start)) return;
        const nodes = [];
        const pending = [start];
        visited.add(start);
        while (pending.length) {
          const current = pending.pop();
          nodes.push(current);
          [...neighbors.get(current)].sort().reverse().forEach((next) => {
            if (!visited.has(next)) { visited.add(next); pending.push(next); }
          });
        }
        components.push(nodes.sort());
      });
      return components.sort((left, right) => compare(left[0], right[0]));
    };
    const components = componentFor();
    const componentByNode = new Map();
    components.forEach((component) => component.forEach((id) => componentByNode.set(id, component)));
    const componentEdgeIds = new Map(components.map((component) => [component, []]));
    normalized.edges.forEach((edge) => {
      const sourceComponent = componentByNode.get(edge.sourceId);
      if (sourceComponent && sourceComponent === componentByNode.get(edge.targetId)) {
        componentEdgeIds.get(sourceComponent).push(edge.id);
      }
    });
    componentEdgeIds.forEach((edgeIDs) => edgeIDs.sort(compare));
    const discovery = new Map();
    const low = new Map();
    const parent = new Map();
    const subtreeSize = new Map();
    const separatingSizes = new Map();
    let clock = 0;
    [...neighbors.keys()].sort().forEach((root) => {
      if (discovery.has(root)) return;
      clock += 1;
      discovery.set(root, clock);
      low.set(root, clock);
      subtreeSize.set(root, 1);
      separatingSizes.set(root, []);
      const stack = [{ id: root, nextIndex: 0, childCount: 0, adjacent: [...neighbors.get(root)].sort() }];
      while (stack.length) {
        const frame = stack[stack.length - 1];
        if (frame.nextIndex < frame.adjacent.length) {
          const next = frame.adjacent[frame.nextIndex];
          frame.nextIndex += 1;
          if (!discovery.has(next)) {
            parent.set(next, frame.id);
            frame.childCount += 1;
            clock += 1;
            discovery.set(next, clock);
            low.set(next, clock);
            subtreeSize.set(next, 1);
            separatingSizes.set(next, []);
            stack.push({ id: next, nextIndex: 0, childCount: 0, adjacent: [...neighbors.get(next)].sort() });
          } else if (parent.get(frame.id) !== next) {
            low.set(frame.id, Math.min(low.get(frame.id), discovery.get(next)));
          }
          continue;
        }
        stack.pop();
        if (!parent.has(frame.id)) {
          if (frame.childCount < 2) separatingSizes.set(frame.id, []);
          continue;
        }
        const parentID = parent.get(frame.id);
        subtreeSize.set(parentID, subtreeSize.get(parentID) + subtreeSize.get(frame.id));
        low.set(parentID, Math.min(low.get(parentID), low.get(frame.id)));
        if (low.get(frame.id) >= discovery.get(parentID)) separatingSizes.get(parentID).push(subtreeSize.get(frame.id));
      }
    });
    const articulationImpact = new Map();
    [...neighbors.keys()].sort().forEach((id) => {
      const separated = separatingSizes.get(id) || [];
      if (!separated.length) return;
      const component = componentByNode.get(id) || [];
      const remainder = component.length - 1 - separated.reduce((sum, size) => sum + size, 0);
      const removalComponentSizes = [...separated, ...(remainder > 0 ? [remainder] : [])].sort((left, right) => left - right);
      if (removalComponentSizes.length > 1) articulationImpact.set(id, { component, removalComponentSizes });
    });
    return { neighbors, edgeIds, components, componentEdgeIds, articulationImpact };
  }

  function makeProposal(ruleId, severity, category, subject, evidence, threshold) {
    const cleanSubject = {
      nodeIds: uniqueSorted(subject.nodeIds || []), edgeIds: uniqueSorted(subject.edgeIds || []), sourcePaths: uniqueSorted(subject.sourcePaths || [])
    };
    return {
      id: '', rule: { id: ruleId, version: RULES_VERSION }, severity, category, subject: cleanSubject, evidence, threshold,
      preview: { kind: 'instruction', text: '' },
      _sortKey: stableJSON({ ruleId, cleanSubject })
    };
  }

  function boundedPreviewValues(values, label) {
    const sample = values.slice(0, 2).map((value) => {
      const display = String(value);
      return display.length > 48 ? `${display.slice(0, 45)}...` : display;
    });
    return `${label} (${values.length}): ${sample.join(', ') || 'none'}${values.length > sample.length ? ', …' : ''}`;
  }

  function finalizeProposals(proposals) {
    proposals.sort((left, right) => compare(left.rule.id, right.rule.id) || compare(left._sortKey, right._sortKey));
    const ordinalByRule = new Map();
    proposals.forEach((proposal) => {
      const ordinal = (ordinalByRule.get(proposal.rule.id) || 0) + 1;
      ordinalByRule.set(proposal.rule.id, ordinal);
      proposal.id = `guided-maintenance:v${RULES_VERSION}:${proposal.rule.id}:${ordinal}`;
      proposal.preview.text = `Review ${proposal.id}. ${boundedPreviewValues(proposal.subject.nodeIds, 'Nodes')}. ${boundedPreviewValues(proposal.subject.edgeIds, 'Edges')}. ${boundedPreviewValues(proposal.subject.sourcePaths, 'Sources')}. No writes.`;
      delete proposal._sortKey;
    });
    return proposals;
  }

  function build(graph, options = {}) {
    const normalized = normalize(graph);
    const evidence = evidenceFor(normalized);
    const map = topology(normalized);
    const proposals = [];
    const caveats = ['Health topology is undirected; node inspector connections preserve directed incoming and outgoing edges.', 'Proposals are advisory and contain metadata only; they never write files or include note body content.'];
    const degree = (id) => map.neighbors.get(id).size;
    const sourcePathsFor = (nodeIds, edgeIds) => uniqueSorted([
      ...(nodeIds || []).map((id) => evidence.nodeEvidenceById[id] && evidence.nodeEvidenceById[id].sourceFile),
      ...(edgeIds || []).map((id) => evidence.edgeEvidenceById[id] && evidence.edgeEvidenceById[id].sourceFile)
    ]);
    const averageDegree = normalized.nodes.length ? [...map.neighbors.keys()].reduce((sum, id) => sum + degree(id), 0) / normalized.nodes.length : 0;
    const hubThreshold = Math.max(8, Math.ceil(averageDegree * 3));
    normalized.nodes.filter((node) => degree(node.id) === 0).forEach((node) => proposals.push(makeProposal(
      RULES.orphan, 'warning', 'connectivity', { nodeIds: [node.id], sourcePaths: [node.sourceFile] },
      { degree: 0, connectionEdgeIds: [] }, { rule: 'degree = 0', caveat: 'A node can be intentionally standalone; inspect before changing links.' }
    )));
    const componentOrder = [...map.components].sort((left, right) => right.length - left.length || compare(left.join('\u0000'), right.join('\u0000')));
    const largest = componentOrder[0] || [];
    componentOrder.slice(1).filter((component) => component.length > 1).forEach((component) => {
      const edges = map.componentEdgeIds.get(component) || [];
      proposals.push(makeProposal(RULES.isolated, 'warning', 'connectivity', { nodeIds: component, edgeIds: edges, sourcePaths: sourcePathsFor(component, edges) },
        { componentNodeIds: component, componentSize: component.length, excludedLargestComponentSize: largest.length, excludedLargestComponentRepresentativeId: largest[0] || '' },
        { rule: 'component size > 1 and not deterministic largest component', caveat: 'Disconnected groups may be intentional; the largest component is selected by size then lexicographic node IDs.' }
      ));
    });
    const now = timestamp(options.now);
    const staleCandidates = normalized.nodes.filter((node) => degree(node.id) >= hubThreshold);
    if (now === null) caveats.push('Stale hub proposals unavailable: build requires an injected valid now timestamp.');
    else staleCandidates.forEach((node) => {
      const mtime = timestamp(node.mtime);
      if (mtime === null) { caveats.push(`Stale hub timestamp unavailable for node ${node.id}.`); return; }
      if (now - mtime > 90 * DAY_MS) proposals.push(makeProposal(RULES.stale, 'warning', 'freshness',
        { nodeIds: [node.id], edgeIds: [...map.edgeIds.get(node.id)], sourcePaths: sourcePathsFor([node.id], [...map.edgeIds.get(node.id)]) },
        { degree: degree(node.id), mtime: node.mtime, ageDays: Math.floor((now - mtime) / DAY_MS) },
        { rule: `degree >= max(8, ceil(avgDegree * 3)) = ${hubThreshold}; age > 90 days`, caveat: 'Timestamp is metadata and may not represent semantic freshness.' }
      ));
    });
    normalized.nodes.filter((node) => degree(node.id) >= 2).forEach((node) => {
      const impact = map.articulationImpact.get(node.id);
      if (impact) proposals.push(makeProposal(RULES.bridge, 'warning', 'resilience',
        { nodeIds: [node.id], edgeIds: [...map.edgeIds.get(node.id)], sourcePaths: sourcePathsFor([node.id], [...map.edgeIds.get(node.id)]) },
        { degree: degree(node.id), componentSize: impact.component.length, componentRepresentativeId: impact.component[0], removalComponentSizes: impact.removalComponentSizes },
        { rule: 'articulation point with degree >= 2', caveat: 'Topology ignores edge direction and parallel edges do not increase neighbor degree.' }
      ));
    });
    normalized.edges.forEach((edge) => {
      const missing = [];
      if (edge.explicitSource && !evidence.nodeEvidenceById[edge.sourceId]) missing.push(edge.sourceId);
      if (edge.explicitTarget && !evidence.nodeEvidenceById[edge.targetId]) missing.push(edge.targetId);
      if (missing.length) proposals.push(makeProposal(RULES.unresolved, 'warning', 'integrity',
        { nodeIds: missing, edgeIds: [edge.id], sourcePaths: [edge.sourceFile] },
        { sourceId: edge.sourceId, targetId: edge.targetId, missingEndpointIds: uniqueSorted(missing), provenance: edge.provenance },
        { rule: 'explicit nonempty edge endpoint absent from node IDs', caveat: 'Only explicit named endpoints are reported; no missing target is guessed.' }
      ));
    });
    finalizeProposals(proposals);
    const ruleResults = [
      { id: RULES.orphan, version: RULES_VERSION, status: 'available', threshold: 'degree = 0' },
      { id: RULES.isolated, version: RULES_VERSION, status: 'available', threshold: 'component size > 1 excluding deterministic largest component' },
      { id: RULES.stale, version: RULES_VERSION, status: now === null ? 'unavailable' : 'available', threshold: `degree >= ${hubThreshold}; age > 90 days` },
      { id: RULES.bridge, version: RULES_VERSION, status: 'available', threshold: 'articulation point; degree >= 2' },
      { id: RULES.unresolved, version: RULES_VERSION, status: 'available', threshold: 'explicit nonempty endpoint absent from node IDs' }
    ];
    return { schemaVersion: SCHEMA_VERSION, rulesVersion: RULES_VERSION, nodeEvidenceById: evidence.nodeEvidenceById, edgeEvidenceById: evidence.edgeEvidenceById, proposals, ruleResults, caveats: uniqueSorted(caveats) };
  }

  return { schemaVersion: SCHEMA_VERSION, rulesVersion: RULES_VERSION, build, node: (graph, id) => build(graph).nodeEvidenceById[String(id)] || null, edge: (graph, id) => build(graph).edgeEvidenceById[String(id)] || null, proposals: (graph, options) => build(graph, options).proposals };
});
