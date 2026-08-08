(function makeBrainBarGraph2DRuntime(root, factory) {
  const api = factory(root);
  root.BrainBarGraph2DRuntime = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function buildBrainBarGraph2DRuntime(root) {
  'use strict';

  const GRAPHIFY_LENS = 'graphify';
  const OBSIDIAN_LENS = 'obsidian';
  const ALL_LENS = 'all';

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const idKey = (value) => String(value);
  const edgeSource = (edge) => edge?.from ?? edge?.source;
  const edgeTarget = (edge) => edge?.to ?? edge?.target;
  const asLabel = (value) => String(value || '').replace(/\s+/g, ' ').trim();
  const sourceFileForNode = (node) => node?._source_file || node?.source_file || '';

  function stableHash(value) {
    const input = String(value || '');
    let hash = 2166136261;
    for (let index = 0; index < input.length; index += 1) {
      hash ^= input.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function parseHexColor(value) {
    const color = String(value || '').trim();
    const match = color.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (!match) {
      return null;
    }

    const hex = match[1].length === 3
      ? match[1].split('').map((part) => part + part).join('')
      : match[1];

    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16)
    };
  }

  function atlasColor(value, alpha, mix = 0.28) {
    const rgb = parseHexColor(value);
    if (!rgb) {
      return value || `rgba(143, 162, 255, ${alpha})`;
    }

    const base = { r: 132, g: 150, b: 184 };
    const r = Math.round(rgb.r * (1 - mix) + base.r * mix);
    const g = Math.round(rgb.g * (1 - mix) + base.g * mix);
    const b = Math.round(rgb.b * (1 - mix) + base.b * mix);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  const workbenchStyle = {
    node: {
      primary: {
        background: 'rgba(220, 231, 255, 0.92)',
        border: 'rgba(255, 255, 255, 0.98)'
      },
      related: {
        background: 'rgba(141, 222, 214, 0.52)',
        border: 'rgba(210, 252, 248, 0.86)'
      }
    },
    edge: {
      primary: 'rgba(232, 241, 255, 0.88)',
      related: 'rgba(154, 211, 224, 0.54)'
    }
  };

  function organicEdgeSmooth(edge) {
    const hash = stableHash(`${edge?.id}:${edgeSource(edge)}:${edgeTarget(edge)}`);
    return {
      enabled: true,
      type: hash % 2 === 0 ? 'curvedCW' : 'curvedCCW',
      roundness: 0.035 + ((hash % 70) / 1000)
    };
  }

  function cleanRelationshipLabel(value) {
    const label = asLabel(value)
      .replace(/\s*\[[^\]]*EXTRACTED[^\]]*\]\s*/gi, ' ')
      .replace(/_/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!label || /^contains$/i.test(label)) {
      return '';
    }
    return label.length > 64 ? `${label.slice(0, 61)}...` : label;
  }

  function nodeTooltipLabel(node) {
    const label = asLabel(node?.label || node?.title || node?.id);
    return label.length > 72 ? `${label.slice(0, 69)}...` : label;
  }

  function normalizeLens(lens) {
    return lens === GRAPHIFY_LENS || lens === OBSIDIAN_LENS ? lens : ALL_LENS;
  }

  function rawEdges() {
    return typeof RAW_EDGES !== 'undefined' ? RAW_EDGES : root.RAW_EDGES;
  }

  function rawNodes() {
    return typeof RAW_NODES !== 'undefined' ? RAW_NODES : root.RAW_NODES;
  }

  function graphNetwork() {
    return typeof network !== 'undefined' ? network : root.network;
  }

  function graphNodesDS() {
    return typeof nodesDS !== 'undefined' ? nodesDS : root.nodesDS;
  }

  function graphEdgesDS() {
    return typeof edgesDS !== 'undefined' ? edgesDS : root.edgesDS;
  }

  function metadataForEdge(edge, state) {
    const index = Number(edge?.id);
    if (Number.isInteger(index)) {
      const graphLink = state?.graphLinks?.[index];
      if (graphLink) {
        return graphLink;
      }
      const edges = rawEdges();
      if (edges && edges[index]) {
        return edges[index];
      }
    }
    return edge || {};
  }

  function isObsidianEdge(edge, state) {
    const metadata = metadataForEdge(edge, state);
    const values = [
      metadata.context,
      metadata.relation,
      metadata.label,
      metadata.title,
      edge?.context,
      edge?.relation,
      edge?.label,
      edge?.title
    ]
      .filter(Boolean)
      .map((value) => String(value).toLowerCase());
    return values.some((value) => value === 'obsidian_wikilink' || value.includes('obsidian_wikilink'));
  }

  function nodeActionPayload(action, node) {
    return {
      action,
      nodeId: String(node?.id || ''),
      label: String(node?.label || ''),
      sourceFile: sourceFileForNode(node)
    };
  }

  function hiddenMap(items) {
    const map = new Map();
    (items || []).forEach((item) => {
      map.set(idKey(item.id), Boolean(item.hidden));
    });
    return map;
  }

  function computeLensDiff(options) {
    const selectedLens = normalizeLens(options?.lens);
    const originalNodes = options?.originalNodes || [];
    const originalEdges = options?.originalEdges || [];
    const currentNodes = options?.currentNodes || originalNodes;
    const currentEdges = options?.currentEdges || originalEdges;
    const state = { graphLinks: options?.graphLinks || [] };

    const filteredEdges = originalEdges.filter((edge) => {
      if (selectedLens === ALL_LENS) {
        return true;
      }
      const obsidian = isObsidianEdge(edge, state);
      return selectedLens === OBSIDIAN_LENS ? obsidian : !obsidian;
    });

    const visibleEdgeIds = new Set(filteredEdges.map((edge) => idKey(edge.id)));
    const visibleNodeIds = new Set();
    filteredEdges.forEach((edge) => {
      const source = edgeSource(edge);
      const target = edgeTarget(edge);
      if (source !== undefined && source !== null) {
        visibleNodeIds.add(idKey(source));
      }
      if (target !== undefined && target !== null) {
        visibleNodeIds.add(idKey(target));
      }
    });

    const currentEdgeHidden = hiddenMap(currentEdges);
    const currentNodeHidden = hiddenMap(currentNodes);
    const edgeUpdates = [];
    const nodeUpdates = [];

    originalEdges.forEach((edge) => {
      const desiredHidden = selectedLens !== ALL_LENS && !visibleEdgeIds.has(idKey(edge.id));
      if ((currentEdgeHidden.get(idKey(edge.id)) || false) !== desiredHidden) {
        edgeUpdates.push({ id: edge.id, hidden: desiredHidden });
      }
    });

    originalNodes.forEach((node) => {
      const desiredHidden = selectedLens !== ALL_LENS && !visibleNodeIds.has(idKey(node.id));
      if ((currentNodeHidden.get(idKey(node.id)) || false) !== desiredHidden) {
        nodeUpdates.push({ id: node.id, hidden: desiredHidden });
      }
    });

    let emptyMessage = '';
    if (selectedLens === OBSIDIAN_LENS && filteredEdges.length === 0) {
      emptyMessage = 'No wikilinks found';
    } else if (selectedLens === GRAPHIFY_LENS && filteredEdges.length === 0) {
      emptyMessage = 'No Graphify edges found';
    }

    return {
      lens: selectedLens,
      edgeUpdates,
      nodeUpdates,
      filteredEdgeCount: filteredEdges.length,
      visibleNodeIds: Array.from(visibleNodeIds),
      emptyMessage
    };
  }

  function relationForEdge(edge, state) {
    if (!edge) {
      return '';
    }
    const metadata = metadataForEdge(edge, state);
    return cleanRelationshipLabel(
      metadata?.relation ||
      metadata?.context ||
      metadata?.label ||
      metadata?.title ||
      edge?.relation ||
      edge?.context ||
      edge?.label ||
      edge?.title
    );
  }

  function edgeProvenance(edge, state) {
    if (!edge) {
      return 'Unknown';
    }
    if (isObsidianEdge(edge, state)) {
      return 'Wikilink';
    }
    const metadata = metadataForEdge(edge, state);
    const hasMetadata = [
      metadata.context,
      metadata.relation,
      metadata.label,
      metadata.title,
      edge.context,
      edge.relation,
      edge.label,
      edge.title
    ].some((value) => asLabel(value));
    return hasMetadata ? 'Graphify' : 'Unknown';
  }

  function nodeById(nodes, nodeId) {
    const key = idKey(nodeId);
    return (nodes || []).find((node) => idKey(node.id) === key) || null;
  }

  function nodeDisplayLabel(node, nodeId) {
    return asLabel(node?.label || node?.title || node?.name || nodeId || 'Unknown node');
  }

  function sourceFileForEdge(edge, nodes) {
    const sourceNode = nodeById(nodes, edgeSource(edge));
    const targetNode = nodeById(nodes, edgeTarget(edge));
    return sourceFileForNode(sourceNode) || sourceFileForNode(targetNode) || '';
  }

  function edgeInspectorDetails(edge, options = {}) {
    if (!edge) {
      return {
        available: false,
        message: 'Connection metadata unavailable'
      };
    }

    const state = { graphLinks: options.graphLinks || [] };
    const nodes = options.nodes || [];
    const sourceNode = nodeById(nodes, edgeSource(edge));
    const targetNode = nodeById(nodes, edgeTarget(edge));
    const relationship = relationForEdge(edge, state) || 'Connection';
    return {
      available: true,
      edgeId: idKey(edge.id),
      sourceId: idKey(edgeSource(edge)),
      targetId: idKey(edgeTarget(edge)),
      sourceLabel: nodeDisplayLabel(sourceNode, edgeSource(edge)),
      targetLabel: nodeDisplayLabel(targetNode, edgeTarget(edge)),
      relationship,
      provenance: edgeProvenance(edge, state),
      sourceFile: sourceFileForEdge(edge, nodes)
    };
  }

  function computeFocusDiff(options = {}) {
    const centerNodeId = idKey(options.centerNodeId);
    const depth = clamp(Number(options.depth) || 1, 1, 3);
    const originalNodes = options.originalNodes || [];
    const originalEdges = options.originalEdges || [];
    const currentNodes = options.currentNodes || originalNodes;
    const currentEdges = options.currentEdges || originalEdges;

    if (!centerNodeId) {
      return {
        centerNodeId: '',
        depth,
        visibleNodeIds: [],
        visibleEdgeIds: [],
        nodeUpdates: [],
        edgeUpdates: []
      };
    }

    const adjacency = new Map();
    originalEdges.forEach((edge) => {
      const source = idKey(edgeSource(edge));
      const target = idKey(edgeTarget(edge));
      if (!source || !target) {
        return;
      }
      if (!adjacency.has(source)) {
        adjacency.set(source, new Set());
      }
      if (!adjacency.has(target)) {
        adjacency.set(target, new Set());
      }
      adjacency.get(source).add(target);
      adjacency.get(target).add(source);
    });

    const visibleNodeIds = new Set([centerNodeId]);
    let frontier = new Set([centerNodeId]);
    for (let level = 0; level < depth; level += 1) {
      const next = new Set();
      frontier.forEach((nodeId) => {
        (adjacency.get(nodeId) || []).forEach((neighborId) => {
          if (!visibleNodeIds.has(neighborId)) {
            visibleNodeIds.add(neighborId);
            next.add(neighborId);
          }
        });
      });
      frontier = next;
    }

    const visibleEdgeIds = new Set();
    originalEdges.forEach((edge) => {
      const source = idKey(edgeSource(edge));
      const target = idKey(edgeTarget(edge));
      if (visibleNodeIds.has(source) && visibleNodeIds.has(target)) {
        visibleEdgeIds.add(idKey(edge.id));
      }
    });

    const currentNodeHidden = hiddenMap(currentNodes);
    const currentEdgeHidden = hiddenMap(currentEdges);
    const nodeUpdates = [];
    const edgeUpdates = [];

    originalNodes.forEach((node) => {
      const desiredHidden = !visibleNodeIds.has(idKey(node.id));
      if ((currentNodeHidden.get(idKey(node.id)) || false) !== desiredHidden) {
        nodeUpdates.push({ id: node.id, hidden: desiredHidden });
      }
    });

    originalEdges.forEach((edge) => {
      const desiredHidden = !visibleEdgeIds.has(idKey(edge.id));
      if ((currentEdgeHidden.get(idKey(edge.id)) || false) !== desiredHidden) {
        edgeUpdates.push({ id: edge.id, hidden: desiredHidden });
      }
    });

    return {
      centerNodeId,
      depth,
      visibleNodeIds: Array.from(visibleNodeIds),
      visibleEdgeIds: Array.from(visibleEdgeIds),
      nodeUpdates,
      edgeUpdates
    };
  }

  function computeGraphHealth(options = {}) {
    const nodes = options.nodes || [];
    const edges = options.edges || [];
    const graphLinks = options.graphLinks || [];
    const state = { graphLinks };
    const degree = new Map(nodes.map((node) => [idKey(node.id), 0]));
    const adjacency = new Map(nodes.map((node) => [idKey(node.id), new Set()]));
    let wikilinkCount = 0;
    let graphifyCount = 0;

    edges.forEach((edge) => {
      const source = idKey(edgeSource(edge));
      const target = idKey(edgeTarget(edge));
      if (!degree.has(source) || !degree.has(target)) {
        return;
      }
      degree.set(source, degree.get(source) + 1);
      degree.set(target, degree.get(target) + 1);
      adjacency.get(source).add(target);
      adjacency.get(target).add(source);
      if (isObsidianEdge(edge, state)) {
        wikilinkCount += 1;
      } else {
        graphifyCount += 1;
      }
    });

    const orphanNodes = nodes
      .filter((node) => (degree.get(idKey(node.id)) || 0) === 0)
      .map((node) => healthNode(node, 0));

    const averageDegree = nodes.length > 0
      ? Array.from(degree.values()).reduce((sum, value) => sum + value, 0) / nodes.length
      : 0;
    const hubThreshold = Math.max(8, Math.ceil(averageDegree * 3));
    const hubNodes = nodes
      .map((node) => healthNode(node, degree.get(idKey(node.id)) || 0))
      .filter((node) => node.degree >= hubThreshold)
      .sort((left, right) => right.degree - left.degree || left.label.localeCompare(right.label))
      .slice(0, 24);

    const visited = new Set();
    const components = [];
    nodes.forEach((node) => {
      const start = idKey(node.id);
      if (visited.has(start)) {
        return;
      }
      const queue = [start];
      const component = [];
      visited.add(start);
      while (queue.length > 0) {
        const current = queue.shift();
        component.push(current);
        (adjacency.get(current) || []).forEach((neighbor) => {
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            queue.push(neighbor);
          }
        });
      }
      components.push(component);
    });
    components.sort((left, right) => right.length - left.length);

    const staleCentralNodes = nodes
      .map((node) => ({ node, degree: degree.get(idKey(node.id)) || 0, modifiedAt: node.mtime || node.modified_at || node.modifiedAt }))
      .filter((item) => item.degree >= hubThreshold && item.modifiedAt)
      .sort((left, right) => String(left.modifiedAt).localeCompare(String(right.modifiedAt)))
      .slice(0, 12)
      .map((item) => ({ ...healthNode(item.node, item.degree), modifiedAt: item.modifiedAt }));

    return {
      counts: {
        nodes: nodes.length,
        edges: edges.length,
        graphifyEdges: graphifyCount,
        wikilinkEdges: wikilinkCount,
        components: components.length
      },
      orphanNodes: orphanNodes.slice(0, 40),
      hubNodes,
      isolatedComponents: components
        .filter((component, index) => index > 0 && component.length > 1)
        .slice(0, 12)
        .map((component) => ({ size: component.length, nodeIds: component.slice(0, 12) })),
      staleCentralNodes
    };
  }

  function healthNode(node, degree) {
    return {
      id: idKey(node.id),
      label: nodeDisplayLabel(node, node?.id),
      sourceFile: sourceFileForNode(node),
      degree
    };
  }

  function fileMetadataForNode(node) {
    const metadata = root.__brainBarNodeFileMetadata || {};
    const byNodeId = metadata.byNodeId || {};
    const bySourceFile = metadata.bySourceFile || {};
    const sourceFile = sourceFileForNode(node);
    return byNodeId[idKey(node?.id)] || (sourceFile ? bySourceFile[sourceFile] : null) || {};
  }

  function nodeTimestamp(node) {
    const fileMetadata = fileMetadataForNode(node);
    const explicit = node?.mtime || node?.modified_at || node?.modifiedAt || fileMetadata.mtime || fileMetadata.modifiedAt;
    if (explicit) {
      if (typeof explicit === 'number') {
        return explicit > 10000000000 ? explicit : explicit * 1000;
      }
      const parsed = Date.parse(explicit);
      return Number.isNaN(parsed) ? Number(explicit) || 0 : parsed;
    }

    const haystack = [
      node?.label,
      node?.title,
      node?.id,
      sourceFileForNode(node)
    ].map((value) => String(value || '')).join(' ');
    const dashed = haystack.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
    if (dashed) {
      return Date.parse(`${dashed[1]}-${dashed[2]}-${dashed[3]}T00:00:00Z`) || 0;
    }
    const compact = haystack.match(/\b(20\d{2})(\d{2})(\d{2})\b/);
    if (compact) {
      return Date.parse(`${compact[1]}-${compact[2]}-${compact[3]}T00:00:00Z`) || 0;
    }
    return 0;
  }

  function recentNodeIds(nodes, limit = 80) {
    return (nodes || [])
      .map((node) => ({ node, timestamp: nodeTimestamp(node) }))
      .filter((item) => item.timestamp > 0)
      .sort((left, right) => right.timestamp - left.timestamp || nodeDisplayLabel(left.node, left.node?.id).localeCompare(nodeDisplayLabel(right.node, right.node?.id)))
      .slice(0, limit)
      .map((item) => item.node.id);
  }

  function lowerText(value) {
    return asLabel(value).toLowerCase();
  }

  function visibleNodeIdSet(nodes) {
    return new Set((nodes || [])
      .filter((node) => !node.hidden)
      .map((node) => idKey(node.id)));
  }

  function parseSearchQuery(value) {
    const filters = [];
    const text = [];
    const supported = new Set(['type', 'tag', 'status', 'source', 'date', 'agent']);
    const tokens = String(value || '').match(/[^\s"]+:"[^"]*"|"[^"]*"|\S+/g) || [];
    tokens.forEach((token) => {
      const separator = token.indexOf(':');
      const name = separator > 0 ? lowerText(token.slice(0, separator)) : '';
      const rawValue = separator > 0 ? token.slice(separator + 1) : token;
      const normalizedValue = lowerText(rawValue.replace(/^"|"$/g, ''));
      if (supported.has(name) && normalizedValue) {
        filters.push({ name, value: normalizedValue });
      } else if (normalizedValue) {
        text.push(normalizedValue);
      }
    });
    return { text: text.join(' '), filters };
  }

  function matchesSearchFilter(node, filter) {
    const frontmatter = node?.frontmatter && typeof node.frontmatter === 'object' ? node.frontmatter : {};
    const values = {
      type: [node?.type, node?.kind, node?.category, frontmatter.type],
      tag: [node?.tags, node?.tag, frontmatter.tags],
      status: [node?.status, frontmatter.status],
      source: [sourceFileForNode(node), node?.source, node?.context],
      date: [node?.modified_at, node?.modifiedAt, node?.mtime, frontmatter.modified_at],
      agent: [node?.agent, node?.agent_id, node?.agentId, node?.__brainBarAgentActive ? 'true active' : 'false']
    };
    return (values[filter.name] || [])
      .flatMap((value) => Array.isArray(value) ? value : [value])
      .some((value) => lowerText(value).includes(filter.value));
  }

  function search2DNodes(options = {}) {
    const parsedQuery = parseSearchQuery(options.query);
    const query = parsedQuery.text;
    const nodes = options.nodes || [];
    const visibleIds = options.visibleNodeIds instanceof Set
      ? options.visibleNodeIds
      : new Set((options.visibleNodeIds || nodes.map((node) => node.id)).map(idKey));
    const limit = Math.max(1, Number(options.limit) || 20);
    if (!query && parsedQuery.filters.length === 0) {
      return [];
    }

    return nodes
      .map((node) => {
        const label = nodeDisplayLabel(node, node.id);
        const sourceFile = sourceFileForNode(node);
        const haystack = lowerText(`${label} ${sourceFile} ${node.id}`);
        const labelLower = lowerText(label);
        let score = query ? 0 : 320;
        if (labelLower === query) {
          score = 1000;
        } else if (labelLower.startsWith(query)) {
          score = 820;
        } else if (labelLower.includes(query)) {
          score = 640;
        } else if (lowerText(sourceFile).includes(query)) {
          score = 460;
        } else if (haystack.includes(query)) {
          score = 320;
        }
        return {
          id: node.id,
          label,
          sourceFile,
          score,
          hidden: !visibleIds.has(idKey(node.id)),
          matchesFilters: parsedQuery.filters.every((filter) => matchesSearchFilter(node, filter))
        };
      })
      .filter((item) => item.score > 0 && item.matchesFilters)
      .sort((left, right) => right.score - left.score || left.label.localeCompare(right.label) || idKey(left.id).localeCompare(idKey(right.id)))
      .slice(0, limit);
  }

  function degreeMap(nodes, edges) {
    const degree = new Map((nodes || []).map((node) => [idKey(node.id), 0]));
    (edges || []).forEach((edge) => {
      const source = idKey(edgeSource(edge));
      const target = idKey(edgeTarget(edge));
      if (degree.has(source)) {
        degree.set(source, degree.get(source) + 1);
      }
      if (degree.has(target)) {
        degree.set(target, degree.get(target) + 1);
      }
    });
    return degree;
  }

  function communityKey(node) {
    const raw = node?.community ?? node?._community ?? node?.community_id;
    return raw === undefined || raw === null || raw === '' ? '' : String(raw);
  }

  function communityLabel(node, key) {
    return asLabel(node?.community_name || node?._community_name || (key ? `Community ${key}` : 'Unknown community'));
  }

  function communitySummaries(options = {}) {
    const nodes = options.nodes || [];
    const edges = options.edges || [];
    const degree = options.degree || degreeMap(nodes, edges);
    const groups = new Map();
    nodes.forEach((node) => {
      const key = communityKey(node);
      if (!key) {
        return;
      }
      if (!groups.has(key)) {
        groups.set(key, {
          id: key,
          label: communityLabel(node, key),
          color: node.color?.background || node.color?.border || '#8fa2ff',
          nodeIds: [],
          topNotes: [],
          bridgeNotes: []
        });
      }
      groups.get(key).nodeIds.push(idKey(node.id));
    });

    const nodeByKey = new Map(nodes.map((node) => [idKey(node.id), node]));
    const crossCommunityByNode = new Map();
    edges.forEach((edge) => {
      const source = idKey(edgeSource(edge));
      const target = idKey(edgeTarget(edge));
      const sourceNode = nodeByKey.get(source);
      const targetNode = nodeByKey.get(target);
      const sourceCommunity = communityKey(sourceNode);
      const targetCommunity = communityKey(targetNode);
      if (!sourceCommunity || !targetCommunity || sourceCommunity === targetCommunity) {
        return;
      }
      crossCommunityByNode.set(source, (crossCommunityByNode.get(source) || 0) + 1);
      crossCommunityByNode.set(target, (crossCommunityByNode.get(target) || 0) + 1);
    });

    return Array.from(groups.values())
      .filter((group) => group.nodeIds.length > 0)
      .map((group) => {
        const notes = group.nodeIds
          .map((nodeId) => {
            const node = nodeByKey.get(nodeId);
            return {
              id: nodeId,
              label: nodeDisplayLabel(node, nodeId),
              sourceFile: sourceFileForNode(node),
              degree: degree.get(nodeId) || 0,
              bridgeScore: crossCommunityByNode.get(nodeId) || 0
            };
          })
          .sort((left, right) => right.degree - left.degree || left.label.localeCompare(right.label));
        return {
          ...group,
          count: group.nodeIds.length,
          topNotes: notes.slice(0, 8),
          bridgeNotes: notes
            .filter((note) => note.bridgeScore > 0)
            .sort((left, right) => right.bridgeScore - left.bridgeScore || right.degree - left.degree || left.label.localeCompare(right.label))
            .slice(0, 8)
        };
      })
      .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
  }

  function graphCheckSections(health, options = {}) {
    const nodes = options.nodes || [];
    const recentIds = recentNodeIds(nodes, 12);
    const recentNodes = recentIds.map((nodeId) => {
      const node = nodeById(nodes, nodeId);
      return healthNode(node || { id: nodeId, label: nodeId }, 0);
    });
    const potentialNoise = (health.isolatedComponents || [])
      .filter((component) => component.size <= 3)
      .slice(0, 8)
      .map((component, index) => ({
        id: `component-${index}`,
        label: `Small group ${index + 1}`,
        degree: component.size,
        nodeIds: component.nodeIds || []
      }));
    return [
      {
        id: 'orphans',
        title: 'Needs Links',
        summary: 'Notes with no visible graph connections.',
        items: health.orphanNodes || []
      },
      {
        id: 'hubs',
        title: 'Key Notes',
        summary: 'Highly connected notes that often act as indexes, dashboards, or protocols.',
        items: health.hubNodes || []
      },
      {
        id: 'components',
        title: 'Disconnected Groups',
        summary: 'Groups outside the main connected graph.',
        items: health.isolatedComponents || []
      },
      {
        id: 'recent',
        title: 'Recent Notes',
        summary: 'Recently changed or date-named notes in the current graph.',
        items: recentNodes
      },
      {
        id: 'noise',
        title: 'Potential Noise',
        summary: 'Tiny disconnected groups that may be intentional islands or cleanup candidates.',
        items: potentialNoise
      }
    ];
  }

  function bridgeActionPayload(action, node, extra = {}) {
    return {
      ...nodeActionPayload(action, node),
      communityId: extra.communityId ? String(extra.communityId) : '',
      targetNodeId: extra.targetNodeId ? String(extra.targetNodeId) : ''
    };
  }

  function workflowViewState(options = {}) {
    const nodes = options.nodes || [];
    const edges = options.edges || [];
    const graphLinks = options.graphLinks || [];
    const reviewQueueTargets = options.reviewQueueTargets || [];
    const health = options.health || computeGraphHealth({ nodes, edges, graphLinks });
    const reviewTargets = reviewQueueNodeTargetsFromNodes(nodes, reviewQueueTargets);
    const recent = recentNodeIds(nodes);
    const groups = communitySummaries({ nodes, edges });
    const agentEvents = root.__brainBarAgentActivitySnapshot?.events || [];
    const agentMappedCount = agentEvents.filter((event) => event && event.nodeId && !event.pending).length;
    return {
      global: { count: nodes.length, hidden: false, disabled: false },
      focus: { count: 0, hidden: false, disabled: false },
      orphans: { count: health.orphanNodes.length, hidden: false, disabled: false },
      hubs: { count: health.hubNodes.length, hidden: false, disabled: false },
      review: { count: reviewTargets.length, hidden: reviewTargets.length === 0, disabled: reviewTargets.length === 0 },
      agent: { count: agentMappedCount, hidden: false, disabled: agentMappedCount === 0 },
      recent: { count: recent.length, hidden: false, disabled: recent.length === 0 },
      groups: { count: groups.length, hidden: false, disabled: groups.length === 0 },
      wikilinks: { count: health.counts.wikilinkEdges, hidden: false, disabled: health.counts.wikilinkEdges === 0 },
      graphify: { count: health.counts.graphifyEdges, hidden: false, disabled: health.counts.graphifyEdges === 0 }
    };
  }

  // Workflow highlighting uses the core's mapped-node projection. It never derives
  // roles or maps a path to a node on its own.
  function workflowHighlightState(snapshot = {}, workflowSelectionID = '', visibleNodeIDs = []) {
    const selectedID = String(workflowSelectionID || '');
    const workflows = Array.isArray(snapshot.workflows) ? snapshot.workflows : [];
    const workflow = workflows.find((candidate) => String(candidate?.id || '') === selectedID);
    if (!workflow) {
      return { workflowID: '', nodeIds: [], pendingPaths: [] };
    }
    const visibleNodeIds = new Set((visibleNodeIDs || []).map(idKey));
    const mappedNodeIds = new Set((Array.isArray(workflow.nodeIds) ? workflow.nodeIds : [])
      .map(idKey)
      .filter((nodeId) => visibleNodeIds.has(nodeId)));
    const pendingPaths = (Array.isArray(workflow.pendingPaths) ? workflow.pendingPaths : [])
      .map(String);
    return {
      workflowID: String(workflow.id || ''),
      nodeIds: Array.from(mappedNodeIds).sort(),
      pendingPaths: Array.from(new Set(pendingPaths)).sort()
    };
  }

  function normalizeAgentActivitySnapshot(snapshot = {}) {
    const events = Array.isArray(snapshot.events) ? snapshot.events : [];
    return {
      ...snapshot,
      events: events.map((event) => ({
        id: String(event?.id || ''),
        version: Number(event?.version || 1),
        action: String(event?.action || 'activity').toLowerCase(),
        agent: String(event?.agent || 'agent'),
        path: String(event?.path || ''),
        timestamp: event?.timestamp || null,
        nodeId: event?.nodeId == null ? null : String(event.nodeId),
        label: event?.label == null ? null : String(event.label),
        sourceFile: event?.sourceFile == null ? null : String(event.sourceFile),
        pending: Boolean(event?.pending),
        sessionId: event?.sessionId == null ? null : String(event.sessionId),
        project: event?.project == null ? null : String(event.project),
        source: event?.source == null ? null : String(event.source),
        reason: event?.reason == null ? null : String(event.reason),
        status: event?.status == null ? null : String(event.status),
        workflowId: event?.workflowId == null ? null : String(event.workflowId),
        workflowTitle: event?.workflowTitle == null ? null : String(event.workflowTitle),
        pathRole: event?.pathRole == null ? null : String(event.pathRole)
      })),
      workflows: Array.isArray(snapshot.workflows) ? snapshot.workflows : [],
      pendingPaths: Array.isArray(snapshot.pendingPaths) ? snapshot.pendingPaths.map(String) : []
    };
  }

  function describeWorkflowView(view, count = 0) {
    const descriptions = {
      global: {
        activeName: 'global',
        title: '2D Workbench',
        body: 'The stable Graphify-powered map for inspection, checks, and precise graph operations.'
      },
      focus: {
        activeName: 'focus',
        title: 'Focus',
        body: 'A readable temporary subgraph around the selected note.',
        empty: 'Select a node first, then focus it.'
      },
      orphans: {
        activeName: 'orphans',
        title: 'Needs Links',
        body: 'Notes with no graph connections. These are candidates to link, merge, or leave intentionally isolated.',
        empty: 'No notes need links right now.'
      },
      hubs: {
        activeName: 'hubs',
        title: 'Key Notes',
        body: 'The most connected notes. They often act as indexes, protocols, dashboards, or central concepts.',
        empty: 'No key notes found.'
      },
      review: {
        activeName: 'review',
        title: 'Review',
        body: 'Review Queue items that point to a graph node. Items need source_file or node_id to appear here.',
        empty: 'No Review Queue items currently point to graph nodes.'
      },
      agent: {
        activeName: 'agent',
        title: 'Agent Activity',
        body: 'Recent local file and agent metadata events mapped onto this graph.',
        empty: 'No recent agent activity is mapped to visible graph nodes.'
      },
      recent: {
        activeName: 'recent',
        title: 'Recent Notes',
        body: 'Recently changed or date-named notes. Uses mtime when available, otherwise dates found in titles or paths.',
        empty: 'No recent-date metadata found in this graph.'
      },
      groups: {
        activeName: 'groups',
        title: 'Groups',
        body: 'Visible communities, their key notes, and bridge notes.',
        empty: 'No communities found in this graph.'
      },
      health: {
        activeName: 'health',
        title: 'Graph Check',
        body: 'A read-only check for notes that need links, key notes, disconnected groups, and stale key notes when timestamps exist.'
      },
      component: {
        activeName: 'component',
        title: 'Disconnected Group',
        body: 'A smaller connected group outside the main graph. These may be intentional islands or areas that need bridge links.',
        empty: 'This disconnected group has no visible nodes.'
      }
    };
    const fallback = descriptions.global;
    return {
      ...(descriptions[String(view || '').toLowerCase()] || fallback),
      count
    };
  }

  function reviewQueueNodeTargetsFromNodes(nodes, targets) {
    const nodeIds = new Set();
    const nodesBySource = new Map();
    (nodes || []).forEach((node) => {
      const source = sourceFileForNode(node);
      if (source) {
        nodesBySource.set(source, node.id);
      }
    });
    (targets || []).forEach((target) => {
      if (target.node_id) {
        nodeIds.add(String(target.node_id));
      }
      if (target.source_file && nodesBySource.has(target.source_file)) {
        nodeIds.add(String(nodesBySource.get(target.source_file)));
      }
    });
    return Array.from(nodeIds);
  }

  function ensurePremiumTooltip(document) {
    let tooltip = document.getElementById('brainbar-graph-tooltip');
    if (!tooltip) {
      tooltip = document.createElement('div');
      tooltip.id = 'brainbar-graph-tooltip';
      tooltip.hidden = true;
      document.body.appendChild(tooltip);
    }
    return tooltip;
  }

  function installBrowserRuntime() {
    if (!root.document) {
      return;
    }

    function ensureGraphLensState() {
      try {
        const nodesDataSet = graphNodesDS();
        const edgesDataSet = graphEdgesDS();
        if (!nodesDataSet || !edgesDataSet) {
          return null;
        }

        const state = root.__brainBarGraphLensState || {};
        const graphVersion = root.__brainBarGraphJSONVersion || 'missing';
        const nodeCount = nodesDataSet.get().length;
        const edgeCount = edgesDataSet.get().length;
        const snapshotVersion = `${graphVersion}:${nodeCount}:${edgeCount}`;

        if (state.snapshotVersion !== snapshotVersion) {
          state.originalNodes = nodesDataSet.get().map((node) => ({ ...node }));
          state.originalEdges = edgesDataSet.get().map((edge) => ({ ...edge }));
          state.snapshotVersion = snapshotVersion;
          state.themeAppliedVersion = '';
        }

        if (state.graphLinksVersion !== graphVersion) {
          const graph = root.__brainBarGraphJSON;
          state.graphLinks = graph ? (graph.links || graph.edges || []) : [];
          state.graphLinksVersion = graphVersion;
        }

        root.__brainBarGraphLensState = state;
        return state;
      } catch (error) {
        console.debug('BrainBar graph lens state skipped', error);
        return null;
      }
    }

    function movePremiumTooltip(event) {
      const tooltip = ensurePremiumTooltip(root.document);
      const x = event?.clientX ?? event?.pageX ?? 0;
      const y = event?.clientY ?? event?.pageY ?? 0;
      tooltip.style.left = `${x}px`;
      tooltip.style.top = `${Math.max(14, y - 38)}px`;
    }

    function isGraphPointerTarget(target) {
      if (!target || typeof target.closest !== 'function') {
        return false;
      }
      const graph = root.document.getElementById('graph');
      return Boolean(graph && (target === graph || graph.contains(target)));
    }

    function handlePremiumTooltipPointerMove(event) {
      if (!isGraphPointerTarget(event.target)) {
        hidePremiumTooltip();
        return;
      }
      movePremiumTooltip(event);
    }

    function showPremiumTooltip(eyebrow, label, event) {
      const cleanLabel = asLabel(label);
      if (!cleanLabel) {
        return;
      }
      const tooltip = ensurePremiumTooltip(root.document);
      tooltip.innerHTML = '<span class="eyebrow"></span><span class="label"></span>';
      tooltip.querySelector('.eyebrow').textContent = eyebrow;
      tooltip.querySelector('.label').textContent = cleanLabel;
      movePremiumTooltip(event);
      tooltip.hidden = false;
      root.requestAnimationFrame(() => tooltip.classList.add('visible'));
    }

    function hidePremiumTooltip() {
      const tooltip = ensurePremiumTooltip(root.document);
      tooltip.classList.remove('visible');
      root.clearTimeout(root.__brainBarTooltipHideTimer);
      root.__brainBarTooltipHideTimer = root.setTimeout(() => {
        if (!tooltip.classList.contains('visible')) {
          tooltip.hidden = true;
        }
      }, 140);
    }

    function sendNodeAction(action, node) {
      if (!node || !root.webkit?.messageHandlers?.brainBarNodeAction) {
        return;
      }
      root.webkit.messageHandlers.brainBarNodeAction.postMessage(nodeActionPayload(action, node));
    }

    function sendGraphBridgeAction(action, nodeOrPayload, extra = {}) {
      if (!root.webkit?.messageHandlers?.brainBarNodeAction) {
        return;
      }
      const payload = nodeOrPayload?.id !== undefined
        ? bridgeActionPayload(action, nodeOrPayload, extra)
        : {
          action,
          nodeId: String(nodeOrPayload?.nodeId || ''),
          label: String(nodeOrPayload?.label || ''),
          sourceFile: nodeOrPayload?.sourceFile || '',
          communityId: nodeOrPayload?.communityId ? String(nodeOrPayload.communityId) : '',
          targetNodeId: nodeOrPayload?.targetNodeId ? String(nodeOrPayload.targetNodeId) : ''
        };
      root.webkit.messageHandlers.brainBarNodeAction.postMessage(payload);
    }

    function currentVisibleNodeIds() {
      const nodesDataSet = graphNodesDS();
      return visibleNodeIdSet(nodesDataSet?.get() || []);
    }

    function ensureOpenNoteButton() {
      const info = root.document.getElementById('info-content');
      if (!info || info.dataset.brainBarOpenNote === 'installed') {
        return;
      }
      info.dataset.brainBarOpenNote = 'installed';
      info.addEventListener('click', (event) => {
        const button = event.target.closest('#brainbar-open-note');
        if (!button) {
          return;
        }
        event.preventDefault();
        const node = graphNodesDS()?.get(button.dataset.nodeId);
        sendNodeAction('openNode', node);
      });
    }

    function addOpenNoteButton(nodeId) {
      try {
        ensureOpenNoteButton();
        const node = graphNodesDS()?.get(nodeId);
        const sourceFile = sourceFileForNode(node);
        const info = root.document.getElementById('info-content');
        const existingButton = root.document.getElementById('brainbar-open-note');
        if (existingButton) {
          existingButton.dataset.nodeId = String(nodeId);
          addFocusControls(nodeId);
          renderEvidenceInspector2D({ nodeId });
          return;
        }
        if (!info || !sourceFile) {
          return;
        }
        const button = root.document.createElement('button');
        button.id = 'brainbar-open-note';
        button.type = 'button';
        button.dataset.nodeId = String(nodeId);
        button.textContent = 'Open Note';
        info.insertBefore(button, info.children[1] || null);
        addFocusControls(nodeId);
        renderEvidenceInspector2D({ nodeId });
      } catch (error) {
        console.debug('BrainBar open note button skipped', error);
      }
    }

    function nodeForRuntimeAction(nodeId) {
      const snapshot = currentGraphSnapshot();
      return graphNodesDS()?.get(nodeId) || nodeById(snapshot.nodes, nodeId) || { id: nodeId, label: nodeId };
    }

    function addNodeBridgeActions(nodeId) {
      const info = root.document.getElementById('info-content');
      const controls = root.document.getElementById('brainbar-focus-controls');
      if (!info || !controls || !nodeId || controls.dataset.bridgeActions === String(nodeId)) {
        return;
      }
      controls.querySelectorAll('button[data-bridge-action]').forEach((button) => button.remove());
      [
        ['revealIn3D', 'Reveal in 3D'],
        ['pathFromNodeIn3D', 'Path from here in 3D']
      ].forEach(([action, label]) => {
        const button = root.document.createElement('button');
        button.type = 'button';
        button.dataset.bridgeAction = action;
        button.textContent = label;
        button.addEventListener('click', (event) => {
          event.preventDefault();
          sendGraphBridgeAction(action, nodeForRuntimeAction(nodeId));
        });
        controls.appendChild(button);
      });
      controls.dataset.bridgeActions = String(nodeId);
    }

    function showEdgeInspector(edgeId) {
      try {
        const edge = graphEdgesDS()?.get(edgeId) || null;
        const snapshot = currentGraphSnapshot();
        const details = edgeInspectorDetails(edge, {
          nodes: snapshot.nodes,
          graphLinks: snapshot.state.graphLinks || []
        });
        const info = root.document.getElementById('info-content');
        if (!info) {
          return;
        }

        if (details.available) {
          applyTransientVisualStyle({
            primaryNodeId: details.sourceId,
            relatedNodeIds: [details.targetId],
            edgeIds: [details.edgeId]
          });
        }

        let panel = root.document.getElementById('brainbar-edge-inspector');
        if (!panel) {
          panel = root.document.createElement('div');
          panel.id = 'brainbar-edge-inspector';
        }
        panel.innerHTML = '';

        const eyebrow = root.document.createElement('div');
        eyebrow.className = 'edge-eyebrow';
        eyebrow.textContent = 'Connection';
        const title = root.document.createElement('strong');
        title.textContent = details.available
          ? `${details.sourceLabel} -> ${details.targetLabel}`
          : details.message;
        panel.append(eyebrow, title);

        if (details.available) {
          [
            ['Relationship', details.relationship],
            ['Source', details.provenance],
            ['File', details.sourceFile || 'Connection metadata unavailable']
          ].forEach(([label, value]) => {
            const row = root.document.createElement('div');
            row.className = 'edge-row';
            const key = root.document.createElement('span');
            key.textContent = label;
            const val = root.document.createElement('b');
            val.textContent = value;
            row.append(key, val);
            panel.appendChild(row);
          });

          if (details.sourceFile) {
            const actions = root.document.createElement('div');
            actions.className = 'edge-actions';
            const open = root.document.createElement('button');
            open.type = 'button';
            open.textContent = 'Open Source Note';
            open.addEventListener('click', () => {
              sendNodeAction('openNode', {
                id: details.sourceId,
                label: details.sourceLabel,
                source_file: details.sourceFile
              });
            });
            const copy = root.document.createElement('button');
            copy.type = 'button';
            copy.textContent = 'Copy Path';
            copy.addEventListener('click', () => {
              root.navigator?.clipboard?.writeText(details.sourceFile);
            });
            const reveal = root.document.createElement('button');
            reveal.type = 'button';
            reveal.textContent = 'Reveal source in 3D';
            reveal.addEventListener('click', () => {
              sendGraphBridgeAction('revealIn3D', {
                nodeId: details.sourceId,
                label: details.sourceLabel,
                sourceFile: details.sourceFile
              });
            });
            const path = root.document.createElement('button');
            path.type = 'button';
            path.textContent = 'Path in 3D';
            path.addEventListener('click', () => {
              sendGraphBridgeAction('pathFromNodeIn3D', {
                nodeId: details.sourceId,
                label: details.sourceLabel,
                sourceFile: details.sourceFile,
                targetNodeId: details.targetId
              });
            });
            actions.append(open, copy, reveal, path);
            panel.appendChild(actions);
          }
        }

        info.prepend(panel);
        renderEvidenceInspector2D({ edgeId, container: panel });
      } catch (error) {
        console.debug('BrainBar edge inspector skipped', error);
      }
    }

    function evidenceScalar2D(value) {
      return value === null || ['string', 'number', 'boolean'].includes(typeof value) ? value : '';
    }

    function evidenceEndpoint2D(value) {
      const candidate = value && typeof value === 'object'
        ? value.id ?? value.label ?? value.name
        : value;
      return evidenceScalar2D(candidate);
    }

    function graphEvidenceSnapshot() {
      const snapshot = currentGraphSnapshot();
      const evidence = root.BrainBarGraphEvidence;
      if (!evidence?.build) {
        return null;
      }
      const rawGraph = root.__brainBarGraphJSON;
      const sourceNodes = Array.isArray(rawGraph?.nodes)
        ? rawGraph.nodes
        : (Array.isArray(rawNodes()) ? rawNodes() : (snapshot.nodes || []));
      const sourceEdges = Array.isArray(rawGraph?.edges)
        ? rawGraph.edges
        : (Array.isArray(rawGraph?.links)
          ? rawGraph.links
          : (Array.isArray(rawEdges()) ? rawEdges() : (snapshot.edges || [])));
      const cache = root.__brainBarGraphEvidenceCache;
      if (cache?.nodes === sourceNodes && cache?.edges === sourceEdges) {
        return cache.report;
      }
      const now = Date.now();
      let report;
      try {
        // Keep the evidence input metadata-only. Besides enforcing the privacy
        // boundary, this avoids handing renderer-owned cyclic objects to the
        // shared, data-only rules engine.
        const graph = {
          nodes: sourceNodes.map((node) => ({
            id: evidenceScalar2D(node.id),
            label: evidenceScalar2D(node.label),
            title: evidenceScalar2D(node.title),
            source_file: evidenceScalar2D(node.source_file),
            _source_file: evidenceScalar2D(node._source_file),
            sourceFile: evidenceScalar2D(node.sourceFile),
            community: evidenceScalar2D(node.community),
            community_name: evidenceScalar2D(node.community_name),
            group: evidenceScalar2D(node.group),
            cluster: evidenceScalar2D(node.cluster),
            mtime: evidenceScalar2D(node.mtime),
            modified_at: evidenceScalar2D(node.modified_at),
            modifiedAt: evidenceScalar2D(node.modifiedAt),
            updated_at: evidenceScalar2D(node.updated_at),
            updatedAt: evidenceScalar2D(node.updatedAt),
            status: evidenceScalar2D(node.status),
            category: evidenceScalar2D(node.category),
            type: evidenceScalar2D(node.type)
          })),
          edges: sourceEdges.map((edge) => ({
            id: evidenceScalar2D(edge.id),
            from: evidenceEndpoint2D(edge.from),
            source: evidenceEndpoint2D(edge.source),
            to: evidenceEndpoint2D(edge.to),
            target: evidenceEndpoint2D(edge.target),
            relation: evidenceScalar2D(edge.relation),
            type: evidenceScalar2D(edge.type),
            context: evidenceScalar2D(edge.context),
            source_file: evidenceScalar2D(edge.source_file),
            _source_file: evidenceScalar2D(edge._source_file),
            sourceFile: evidenceScalar2D(edge.sourceFile)
          }))
        };
        report = evidence.build(graph, { now });
      } catch (error) {
        root.__brainBarGraphEvidenceError = String(error?.message || error);
        return null;
      }
      root.__brainBarGraphEvidenceCache = { nodes: sourceNodes, edges: sourceEdges, now, report };
      return report;
    }

    function evidenceValueText(value) {
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

    function proposalSubjectText(proposal) {
      const subject = proposal.subject || {};
      const summary = (values, label) => {
        const entries = values || [];
        const sample = entries.slice(0, 3).join(', ') || 'none';
        return `${label} (${entries.length}): ${sample}${entries.length > 3 ? ', …' : ''}`;
      };
      return `${summary(subject.nodeIds, 'Nodes')} · ${summary(subject.edgeIds, 'Edges')} · ${summary(subject.sourcePaths, 'Sources')}`;
    }

    function appendEvidenceRows(container, rows) {
      const list = root.document.createElement('div');
      list.className = 'brainbar-evidence-rows';
      rows.filter(([, value]) => value !== undefined && value !== null && String(value) !== '').forEach(([label, value]) => {
        const row = root.document.createElement('p');
        const labelElement = root.document.createElement('strong');
        labelElement.textContent = label;
        const valueElement = root.document.createElement('span');
        valueElement.textContent = String(value);
        row.append(labelElement, valueElement);
        list.appendChild(row);
      });
      container.appendChild(list);
    }

    function appendEvidenceLinkSection(container, title, links) {
      const section = root.document.createElement('section');
      section.className = 'brainbar-evidence-links';
      const heading = root.document.createElement('h4');
      heading.textContent = `${title} (${links.length})`;
      section.appendChild(heading);
      if (!links.length) {
        const empty = root.document.createElement('p');
        empty.className = 'empty';
        empty.textContent = 'None in the current graph.';
        section.appendChild(empty);
      } else {
        links.slice(0, 8).forEach((link) => {
          const row = root.document.createElement('p');
          row.textContent = `${link.sourceId || 'unknown'} → ${link.targetId || 'unknown'} · ${link.relation || link.context || 'link'} · ${link.provenance || 'Unknown'}`;
          section.appendChild(row);
        });
      }
      container.appendChild(section);
    }

    function appendEvidenceHealthSignals(container, report, nodeId, edgeId) {
      const signals = (report.proposals || []).filter((proposal) => (
        (proposal.subject?.nodeIds || []).map(String).includes(String(nodeId || '')) ||
        (proposal.subject?.edgeIds || []).map(String).includes(String(edgeId || ''))
      ));
      const section = root.document.createElement('section');
      section.className = 'brainbar-evidence-health';
      const heading = root.document.createElement('h4');
      heading.textContent = `Health signals (${signals.length})`;
      section.appendChild(heading);
      signals.slice(0, 4).forEach((proposal) => {
        const row = root.document.createElement('p');
        row.textContent = `${proposal.severity || 'info'} · ${evidenceValueText(proposal.evidence)}`;
        section.appendChild(row);
      });
      if (!signals.length) {
        const empty = root.document.createElement('p');
        empty.className = 'empty';
        empty.textContent = 'No deterministic signals for this item.';
        section.appendChild(empty);
      }
      container.appendChild(section);
    }

    function renderEvidenceInspector2D({ nodeId = '', edgeId = '', container = null } = {}) {
      const report = graphEvidenceSnapshot();
      if (!report) {
        return;
      }
      const host = container || root.document.getElementById('info-content');
      if (!host) {
        return;
      }
      host.querySelector('.brainbar-evidence-inspector')?.remove();
      const inspector = root.document.createElement('section');
      inspector.className = 'brainbar-evidence-inspector';
      const title = root.document.createElement('h3');
      title.textContent = 'Evidence';
      inspector.appendChild(title);
      if (nodeId) {
        const item = report.nodeEvidenceById?.[String(nodeId)];
        if (!item) return;
        appendEvidenceRows(inspector, [
          ['Community', item.community], ['Modified', item.mtime], ['Status', item.status], ['Category', item.category]
        ]);
        appendEvidenceLinkSection(inspector, 'Incoming links', item.incoming || []);
        appendEvidenceLinkSection(inspector, 'Outgoing links', item.outgoing || []);
        appendEvidenceHealthSignals(inspector, report, nodeId, '');
      } else if (edgeId) {
        const item = report.edgeEvidenceById?.[String(edgeId)];
        if (!item) return;
        appendEvidenceRows(inspector, [
          ['Relationship', item.relation], ['Context', item.context], ['Provenance', item.provenance], ['Source', item.sourceFile]
        ]);
        const source = report.nodeEvidenceById?.[String(item.sourceId)];
        const target = report.nodeEvidenceById?.[String(item.targetId)];
        appendEvidenceRows(inspector, [
          ['Source community', source?.community], ['Target community', target?.community], ['Source status', source?.status], ['Target status', target?.status]
        ]);
        appendEvidenceHealthSignals(inspector, report, '', edgeId);
      }
      host.appendChild(inspector);
    }

    function installNodeActionBridge() {
      const currentNetwork = graphNetwork();
      if (root.__brainBarNodeBridgeInstalled || !currentNetwork) {
        return;
      }
      root.__brainBarNodeBridgeInstalled = true;
      if (typeof showInfo === 'function' && !root.__brainBarShowInfoWrapped) {
        root.__brainBarShowInfoWrapped = true;
        const originalShowInfo = showInfo;
        showInfo = (nodeId) => {
          originalShowInfo(nodeId);
          addOpenNoteButton(nodeId);
        };
      }
      currentNetwork.on('doubleClick', (params) => {
        const nodeId = params.nodes?.[0];
        const nodesDataSet = graphNodesDS();
        if (!nodeId || !nodesDataSet) {
          return;
        }
        sendNodeAction('openNode', nodesDataSet.get(nodeId));
      });
    }

    function ensureLensEmptyState() {
      let overlay = root.document.getElementById('brainbar-lens-empty');
      if (!overlay) {
        overlay = root.document.createElement('div');
        overlay.id = 'brainbar-lens-empty';
        overlay.hidden = true;
        root.document.body.appendChild(overlay);
      }
      return overlay;
    }

    function setLensEmptyMessage(message) {
      const overlay = ensureLensEmptyState();
      overlay.textContent = message || '';
      overlay.hidden = !message;
    }

    function applyDataSetUpdates(nodeUpdates, edgeUpdates) {
      const nodesDataSet = graphNodesDS();
      const edgesDataSet = graphEdgesDS();
      if (edgeUpdates?.length > 0 && edgesDataSet) {
        edgesDataSet.update(edgeUpdates);
      }
      if (nodeUpdates?.length > 0 && nodesDataSet) {
        nodesDataSet.update(nodeUpdates);
      }
      graphNetwork()?.redraw();
    }

    function currentWorkflowHighlight() {
      const snapshot = root.__brainBarAgentActivitySnapshot || {};
      const graph = currentGraphSnapshot();
      return workflowHighlightState(snapshot, root.__brainBarWorkflowHighlightID, graph.currentNodes
        .filter((node) => !node.hidden)
        .map((node) => node.id));
    }

    function installWorkflowHighlightOverlay() {
      const currentNetwork = graphNetwork();
      if (!currentNetwork || root.__brainBarWorkflowHighlightOverlayNetwork === currentNetwork) {
        return;
      }
      root.__brainBarWorkflowHighlightOverlayNetwork = currentNetwork;
      currentNetwork.on('afterDrawing', (context) => {
        const highlight = currentWorkflowHighlight();
        if (!highlight.nodeIds.length) {
          return;
        }
        const positions = currentNetwork.getPositions(highlight.nodeIds);
        const visibleNodeIds = new Set(highlight.nodeIds.map(idKey));
        const snapshot = currentGraphSnapshot();
        context.save();
        snapshot.currentEdges.forEach((edge) => {
          if (edge.hidden || !visibleNodeIds.has(idKey(edgeSource(edge))) || !visibleNodeIds.has(idKey(edgeTarget(edge)))) {
            return;
          }
          const source = positions[edgeSource(edge)];
          const target = positions[edgeTarget(edge)];
          if (!source || !target) {
            return;
          }
          context.beginPath();
          context.moveTo(source.x, source.y);
          context.lineTo(target.x, target.y);
          context.strokeStyle = 'rgba(126, 231, 203, 0.82)';
          context.lineWidth = 2.2;
          context.shadowColor = 'rgba(126, 231, 203, 0.72)';
          context.shadowBlur = 10;
          context.stroke();
        });
        highlight.nodeIds.forEach((nodeId) => {
          const point = positions[nodeId];
          if (!point) {
            return;
          }
          context.beginPath();
          context.arc(point.x, point.y, 20, 0, Math.PI * 2);
          context.fillStyle = 'rgba(126, 231, 203, 0.13)';
          context.fill();
          context.beginPath();
          context.arc(point.x, point.y, 15, 0, Math.PI * 2);
          context.strokeStyle = 'rgba(154, 246, 219, 0.96)';
          context.lineWidth = 2;
          context.stroke();
        });
        context.restore();
      });
    }

    function clearTransientVisualStyle() {
      const restore = root.__brainBar2DVisualRestore;
      const nodesDataSet = graphNodesDS();
      const edgesDataSet = graphEdgesDS();
      if (!restore) {
        return;
      }
      if (nodesDataSet && restore.nodes?.length) {
        nodesDataSet.update(restore.nodes);
      }
      if (edgesDataSet && restore.edges?.length) {
        edgesDataSet.update(restore.edges);
      }
      root.__brainBar2DVisualRestore = null;
    }

    function dataSetItem(dataSet, itemId) {
      if (!dataSet || itemId === undefined || itemId === null) {
        return null;
      }
      return dataSet.get(itemId) || (String(Number(itemId)) === String(itemId) ? dataSet.get(Number(itemId)) : null);
    }

    function rememberVisualState(nodeIds, edgeIds) {
      const nodesDataSet = graphNodesDS();
      const edgesDataSet = graphEdgesDS();
      const nodeRestore = [];
      const edgeRestore = [];
      const seenNodes = new Set();
      const seenEdges = new Set();
      (nodeIds || []).forEach((nodeId) => {
        const id = idKey(nodeId);
        if (seenNodes.has(id)) {
          return;
        }
        const node = dataSetItem(nodesDataSet, nodeId);
        if (!node) {
          return;
        }
        seenNodes.add(id);
        nodeRestore.push({
          id: node.id,
          borderWidth: node.borderWidth,
          borderWidthSelected: node.borderWidthSelected,
          size: node.size,
          color: node.color,
          shadow: node.shadow,
          font: node.font,
          label: node.label
        });
      });
      (edgeIds || []).forEach((edgeId) => {
        const id = idKey(edgeId);
        if (seenEdges.has(id)) {
          return;
        }
        const edge = dataSetItem(edgesDataSet, edgeId);
        if (!edge) {
          return;
        }
        seenEdges.add(id);
        edgeRestore.push({
          id: edge.id,
          color: edge.color,
          width: edge.width,
          selectionWidth: edge.selectionWidth,
          hoverWidth: edge.hoverWidth,
          dashes: edge.dashes
        });
      });
      return { nodes: nodeRestore, edges: edgeRestore };
    }

    function applyTransientVisualStyle({ primaryNodeId, relatedNodeIds = [], edgeIds = [] } = {}) {
      const nodesDataSet = graphNodesDS();
      const edgesDataSet = graphEdgesDS();
      if (!nodesDataSet && !edgesDataSet) {
        return;
      }
      clearTransientVisualStyle();
      const primary = primaryNodeId ? idKey(primaryNodeId) : '';
      const related = Array.from(new Set((relatedNodeIds || []).map(idKey).filter((nodeId) => nodeId && nodeId !== primary))).slice(0, 18);
      const highlightedEdges = Array.from(new Set((edgeIds || []).map(idKey))).slice(0, 90);
      root.__brainBar2DVisualRestore = rememberVisualState([primary, ...related], highlightedEdges);

      const nodeUpdates = [];
      if (primary && dataSetItem(nodesDataSet, primary)) {
        const node = dataSetItem(nodesDataSet, primary);
        nodeUpdates.push({
          id: node.id,
          size: Math.max(Number(node.size) || 6, 12),
          borderWidth: 2.4,
          borderWidthSelected: 3,
          color: {
            ...(node.color || {}),
            background: workbenchStyle.node.primary.background,
            border: workbenchStyle.node.primary.border,
            highlight: {
              background: 'rgba(235, 242, 255, 0.98)',
              border: 'rgba(255, 255, 255, 1)'
            }
          },
          shadow: {
            enabled: true,
            color: 'rgba(160, 184, 255, 0.34)',
            size: 12,
            x: 0,
            y: 0
          },
          font: {
            ...(node.font || {}),
            color: 'rgba(248, 250, 255, 0.96)',
            size: 15,
            vadjust: -12
          }
        });
      }
      related.forEach((nodeId) => {
        const node = dataSetItem(nodesDataSet, nodeId);
        if (!node) {
          return;
        }
        nodeUpdates.push({
          id: node.id,
          size: Math.max(Number(node.size) || 4, 7),
          borderWidth: 1.55,
          color: {
            ...(node.color || {}),
            background: workbenchStyle.node.related.background,
            border: workbenchStyle.node.related.border
          },
          shadow: {
            enabled: true,
            color: 'rgba(119, 220, 210, 0.18)',
            size: 5,
            x: 0,
            y: 0
          }
        });
      });
      if (nodeUpdates.length) {
        nodesDataSet.update(nodeUpdates);
      }
      if (highlightedEdges.length && edgesDataSet) {
        edgesDataSet.update(highlightedEdges
          .map((edgeId) => dataSetItem(edgesDataSet, edgeId))
          .filter(Boolean)
          .map((edge) => ({
            id: edge.id,
            width: 1.55,
            selectionWidth: 2.4,
            hoverWidth: 2.2,
            color: {
              color: workbenchStyle.edge.related,
              highlight: workbenchStyle.edge.primary,
              hover: workbenchStyle.edge.primary
            }
          })));
      }
      graphNetwork()?.redraw();
    }

    function clearRuntimeFilter() {
      const state = ensureGraphLensState();
      const nodesDataSet = graphNodesDS();
      const edgesDataSet = graphEdgesDS();
      if (!state || !nodesDataSet || !edgesDataSet) {
        return;
      }
      root.__brainBarSearchRevealRestore = null;
      clearTransientVisualStyle();
      root.__brainBarFocusState = null;
      root.__brainBarFocusedCommunityId = null;
      root.__brainBarActiveGraphView = 'global';
      setLensEmptyMessage('');
      restoreFocusLayout();
      const resetAll = computeLensDiff({
        lens: root.__brainBarPendingGraphLens || ALL_LENS,
        originalNodes: state.originalNodes,
        originalEdges: state.originalEdges,
        graphLinks: state.graphLinks,
        currentNodes: nodesDataSet.get(),
        currentEdges: edgesDataSet.get()
      });
      applyDataSetUpdates(resetAll.nodeUpdates, resetAll.edgeUpdates);
      updateFocusStatus(null);
      updateWorkflowToolbarState();
    }

    function saveFocusLayoutIfNeeded(nodeIds) {
      if (root.__brainBarFocusLayoutRestore) {
        return;
      }
      const nodesDataSet = graphNodesDS();
      const currentNetwork = graphNetwork();
      if (!nodesDataSet || !currentNetwork) {
        return;
      }
      root.__brainBarFocusLayoutRestore = (nodeIds || [])
        .map((nodeId) => {
          const node = nodesDataSet.get(nodeId);
          const position = currentNetwork.getPosition ? currentNetwork.getPosition(nodeId) : null;
          return {
            id: nodeId,
            x: node?.x ?? position?.x,
            y: node?.y ?? position?.y,
            fixed: node?.fixed,
            label: node?.label,
            font: node?.font
          };
        })
        .filter((item) => item.id !== undefined && item.id !== null);
    }

    function visibleEdgesBetween(nodeIds, limit = 90) {
      const ids = new Set((nodeIds || []).map(idKey));
      if (ids.size === 0) {
        return [];
      }
      const snapshot = currentGraphSnapshot();
      const hiddenEdges = hiddenMap(snapshot.currentEdges);
      const matches = [];
      snapshot.edges.forEach((edge) => {
        if (matches.length >= limit) {
          return;
        }
        const source = idKey(edgeSource(edge));
        const target = idKey(edgeTarget(edge));
        if (ids.has(source) && ids.has(target) && !hiddenEdges.get(idKey(edge.id))) {
          matches.push(edge.id);
        }
      });
      return matches;
    }

    function restoreFocusLayout() {
      const restore = root.__brainBarFocusLayoutRestore;
      const nodesDataSet = graphNodesDS();
      if (!restore || !nodesDataSet) {
        root.__brainBarFocusLayoutRestore = null;
        return;
      }
      nodesDataSet.update(restore.map((item) => ({
        id: item.id,
        x: item.x,
        y: item.y,
        fixed: item.fixed,
        label: item.label,
        font: item.font
      })));
      root.__brainBarFocusLayoutRestore = null;
    }

    function applyFocusLayout(focus, originalNodes, originalEdges) {
      const nodesDataSet = graphNodesDS();
      if (!nodesDataSet || !focus?.centerNodeId || !focus.visibleNodeIds?.length) {
        return;
      }
      saveFocusLayoutIfNeeded(focus.visibleNodeIds);
      const centerId = idKey(focus.centerNodeId);
      const visible = new Set(focus.visibleNodeIds.map(idKey));
      const neighbors = [];
      originalEdges.forEach((edge) => {
        const source = idKey(edgeSource(edge));
        const target = idKey(edgeTarget(edge));
        if (source === centerId && visible.has(target)) {
          neighbors.push(target);
        } else if (target === centerId && visible.has(source)) {
          neighbors.push(source);
        }
      });
      const uniqueNeighbors = Array.from(new Set(neighbors));
      const otherIds = focus.visibleNodeIds.map(idKey).filter((nodeId) => nodeId !== centerId && !uniqueNeighbors.includes(nodeId));
      const ring = [...uniqueNeighbors, ...otherIds];
      const degree = degreeMap(originalNodes, originalEdges);
      const topLabels = new Set([centerId, ...ring
        .slice()
        .sort((left, right) => (degree.get(right) || 0) - (degree.get(left) || 0) || left.localeCompare(right))
        .slice(0, 12)]);
      const updates = [{ id: centerId, x: 0, y: 0, fixed: true, label: nodeDisplayLabel(nodeById(originalNodes, centerId), centerId) }];
      ring.forEach((nodeId, index) => {
        const angle = (Math.PI * 2 * index) / Math.max(1, ring.length);
        const radius = focus.depth <= 1 ? 360 : focus.depth === 2 ? 520 : 700;
        const node = nodeById(originalNodes, nodeId);
        updates.push({
          id: nodeId,
          x: Math.cos(angle) * radius,
          y: Math.sin(angle) * radius,
          fixed: true,
          label: topLabels.has(nodeId) ? nodeDisplayLabel(node, nodeId) : ''
        });
      });
      nodesDataSet.update(updates);
    }

    function applyFocus(centerNodeId, depth = 1) {
      const state = ensureGraphLensState();
      const nodesDataSet = graphNodesDS();
      const edgesDataSet = graphEdgesDS();
      if (!state || !nodesDataSet || !edgesDataSet || !centerNodeId) {
        return;
      }

      const focus = computeFocusDiff({
        centerNodeId,
        depth,
        originalNodes: state.originalNodes,
        originalEdges: state.originalEdges,
        currentNodes: nodesDataSet.get(),
        currentEdges: edgesDataSet.get()
      });
      root.__brainBarFocusState = focus;
      root.__brainBarActiveGraphView = 'focus';
      setLensEmptyMessage(focus.visibleNodeIds.length === 0 ? 'Focus node not found' : '');
      clearTransientVisualStyle();
      applyDataSetUpdates(focus.nodeUpdates, focus.edgeUpdates);
      applyFocusLayout(focus, state.originalNodes, state.originalEdges);
      applyTransientVisualStyle({
        primaryNodeId: centerNodeId,
        relatedNodeIds: focus.visibleNodeIds.filter((nodeId) => idKey(nodeId) !== idKey(centerNodeId)).slice(0, 18),
        edgeIds: focus.visibleEdgeIds.slice(0, 90)
      });
      updateWorkflowToolbarState();
      updateFocusStatus(focus);
      graphNetwork()?.selectNodes([centerNodeId]);
      graphNetwork()?.fit({
        nodes: focus.visibleNodeIds,
        animation: { duration: 280, easingFunction: 'easeInOutQuad' }
      });
    }

    function expandFocus() {
      const focus = root.__brainBarFocusState;
      if (!focus?.centerNodeId) {
        return;
      }
      applyFocus(focus.centerNodeId, clamp((focus.depth || 1) + 1, 1, 3));
    }

    function addFocusControls(nodeId) {
      const info = root.document.getElementById('info-content');
      if (!info || !nodeId) {
        return;
      }
      let controls = root.document.getElementById('brainbar-focus-controls');
      if (!controls) {
        controls = root.document.createElement('div');
        controls.id = 'brainbar-focus-controls';
        controls.innerHTML = `
          <div class="focus-status" hidden></div>
          <button type="button" data-action="focus" data-depth="1">Focus note</button>
          <button type="button" data-action="focus" data-depth="1">Depth 1</button>
          <button type="button" data-action="focus" data-depth="2">Depth 2</button>
          <button type="button" data-action="focus" data-depth="3">Depth 3</button>
          <button type="button" data-action="clear">Back to global</button>
        `;
        controls.addEventListener('click', (event) => {
          const button = event.target.closest('button[data-action]');
          if (!button) {
            return;
          }
          event.preventDefault();
          const selected = graphNetwork()?.getSelectedNodes?.()?.[0] || controls.dataset.nodeId;
          if (button.dataset.action === 'focus') {
            applyFocus(selected, Number(button.dataset.depth) || 1);
          } else {
            clearRuntimeFilter();
          }
        });
      }
      controls.dataset.nodeId = String(nodeId);
      if (!controls.parentElement) {
        const openButton = root.document.getElementById('brainbar-open-note');
        info.insertBefore(controls, openButton?.nextSibling || info.children[1] || null);
      }
      addNodeBridgeActions(nodeId);
      updateFocusStatus(root.__brainBarFocusState);
    }

    function updateFocusStatus(focus) {
      const controls = root.document.getElementById('brainbar-focus-controls');
      if (!controls) {
        return;
      }
      const status = controls.querySelector('.focus-status');
      if (!status) {
        return;
      }
      if (!focus?.centerNodeId) {
        status.hidden = true;
        controls.querySelectorAll('button[data-depth]').forEach((button) => { button.disabled = false; });
        return;
      }
      status.hidden = false;
      status.textContent = `Focused · depth ${focus.depth} · ${focus.visibleNodeIds.length} notes`;
      controls.querySelectorAll('button[data-depth]').forEach((button) => {
        button.disabled = Number(button.dataset.depth) === focus.depth;
      });
    }

    function currentGraphSnapshot() {
      const state = ensureGraphLensState() || {};
      const nodesDataSet = graphNodesDS();
      const edgesDataSet = graphEdgesDS();
      return {
        state,
        nodes: state.originalNodes || nodesDataSet?.get() || [],
        edges: state.originalEdges || edgesDataSet?.get() || [],
        currentNodes: nodesDataSet?.get() || [],
        currentEdges: edgesDataSet?.get() || []
      };
    }

    function visibleCurrentNodes() {
      return (graphNodesDS()?.get() || []).filter((node) => !node.hidden);
    }

    function topVisibleNeighbors(nodeId, limit = 12) {
      const key = idKey(nodeId);
      const snapshot = currentGraphSnapshot();
      const visibleIds = currentVisibleNodeIds();
      const degree = degreeMap(snapshot.nodes, snapshot.edges);
      const neighbors = new Map();
      snapshot.edges.forEach((edge) => {
        const source = idKey(edgeSource(edge));
        const target = idKey(edgeTarget(edge));
        if (source === key && visibleIds.has(target)) {
          neighbors.set(target, nodeById(snapshot.nodes, target));
        } else if (target === key && visibleIds.has(source)) {
          neighbors.set(source, nodeById(snapshot.nodes, source));
        }
      });
      return Array.from(neighbors.entries())
        .map(([id, node]) => ({ id, node, label: nodeDisplayLabel(node, id), degree: degree.get(id) || 0 }))
        .sort((left, right) => right.degree - left.degree || left.label.localeCompare(right.label))
        .slice(0, limit);
    }

    function hiddenSearchResultReason2D(node) {
      const snapshot = currentGraphSnapshot();
      const current = nodeById(snapshot.currentNodes, node.id);
      if (!current?.hidden) {
        return '';
      }
      const lens = normalizeLens(root.__brainBarPendingGraphLens || ALL_LENS);
      if (lens !== ALL_LENS) {
        const lensState = computeLensDiff({
          lens,
          originalNodes: snapshot.nodes,
          originalEdges: snapshot.edges,
          graphLinks: snapshot.state.graphLinks || [],
          currentNodes: snapshot.nodes,
          currentEdges: snapshot.edges
        });
        if (!new Set(lensState.visibleNodeIds.map(idKey)).has(idKey(node.id))) {
          return `Hidden by ${lens === OBSIDIAN_LENS ? 'Wikilinks' : 'Graphify'} Source Lens · reveal temporarily`;
        }
      }
      if (root.__brainBarFocusedCommunityId && String(node.community || '') !== String(root.__brainBarFocusedCommunityId)) {
        return `Hidden by community ${root.__brainBarFocusedCommunityId} · reveal temporarily`;
      }
      const activeView = String(root.__brainBarActiveGraphView || 'global');
      return `Hidden by ${activeView === 'global' ? 'the current graph view' : `${activeView} view`} · reveal temporarily`;
    }

    function restore2DSearchReveal() {
      const restore = root.__brainBarSearchRevealRestore;
      if (!restore) {
        return false;
      }
      root.__brainBarSearchRevealRestore = null;
      applyDataSetUpdates(restore.nodes, restore.edges);
      root.__brainBarActiveGraphView = restore.activeView;
      root.__brainBarFocusState = restore.focusState;
      root.__brainBarFocusedCommunityId = restore.communityID;
      graphNetwork()?.selectNodes(restore.selectedNodeIDs || []);
      updateWorkflowToolbarState();
      graphNetwork()?.redraw();
      return true;
    }

    function reveal2DSearchNode(nodeId) {
      const node = nodeForRuntimeAction(nodeId);
      if (!node?.id) {
        return;
      }
      restore2DSearchReveal();
      const snapshot = currentGraphSnapshot();
      root.__brainBarSearchRevealRestore = {
        nodes: snapshot.currentNodes.map((item) => ({ id: item.id, hidden: Boolean(item.hidden) })),
        edges: snapshot.currentEdges.map((item) => ({ id: item.id, hidden: Boolean(item.hidden) })),
        activeView: root.__brainBarActiveGraphView || 'global',
        focusState: root.__brainBarFocusState || null,
        communityID: root.__brainBarFocusedCommunityId || null,
        selectedNodeIDs: graphNetwork()?.getSelectedNodes?.() || []
      };
      applyDataSetUpdates([{ id: node.id, hidden: false }], []);
      root.__brainBarActiveGraphView = 'search';
      graphNetwork()?.selectNodes([node.id]);
      const neighbors = topVisibleNeighbors(node.id, 12).map((neighbor) => neighbor.id);
      applyTransientVisualStyle({
        primaryNodeId: node.id,
        relatedNodeIds: neighbors,
        edgeIds: visibleEdgesBetween([node.id, ...neighbors], 72)
      });
      graphNetwork()?.focus(node.id, {
        scale: 1.2,
        animation: { duration: 280, easingFunction: 'easeInOutQuad' }
      });
      addOpenNoteButton(node.id);
      showSearchRevealPanel(node);
      updateWorkflowToolbarState();
    }

    function showSearchRevealPanel(node) {
      const neighbors = topVisibleNeighbors(node.id, 12);
      const meta = {
        activeName: 'search',
        title: 'Revealed from search',
        body: `${nodeDisplayLabel(node, node.id)} · ${neighbors.length} visible neighbors.`,
        count: neighbors.length,
        empty: 'No visible neighbors in the current lens or community filter.',
        showAllLabel: 'Return to filters',
        onShowAll: restore2DSearchReveal,
        onClose: restore2DSearchReveal
      };
      showWorkflowViewPanel(meta, [node.id, ...neighbors.map((neighbor) => neighbor.id)]);
    }

    function installSearchReveal2D() {
      const search = root.document.getElementById('search');
      if (!search || search.dataset.brainBarSearchReveal === 'installed') {
        return;
      }
      search.dataset.brainBarSearchReveal = 'installed';
      const results = root.document.createElement('div');
      results.id = 'brainbar-search-results';
      results.hidden = true;
      search.insertAdjacentElement('afterend', results);

      const renderResults = () => {
        const query = search.value || '';
        const matches = search2DNodes({
          query,
          nodes: currentGraphSnapshot().nodes,
          visibleNodeIds: currentVisibleNodeIds(),
          limit: 20
        });
        results.innerHTML = '';
        results.hidden = query.trim().length === 0 || matches.length === 0;
        matches.forEach((match) => {
          const button = root.document.createElement('button');
          button.type = 'button';
          button.className = 'brainbar-search-result';
          button.dataset.nodeId = String(match.id);
          const title = root.document.createElement('span');
          title.textContent = match.label;
          const path = root.document.createElement('small');
          const node = nodeById(currentGraphSnapshot().nodes, match.id);
          path.textContent = hiddenSearchResultReason2D(node) || match.sourceFile || 'Visible in the current graph';
          button.append(title, path);
          results.appendChild(button);
        });
      };

      search.addEventListener('input', renderResults, { passive: true });
      results.addEventListener('click', (event) => {
        const button = event.target.closest('button[data-node-id]');
        if (!button) {
          return;
        }
        event.preventDefault();
        results.hidden = true;
        reveal2DSearchNode(button.dataset.nodeId);
      });
    }

    function applyNodeSetView(viewName, nodeIds) {
      const viewMeta = describeWorkflowView(viewName, nodeIds?.length || 0);
      const snapshot = currentGraphSnapshot();
      restoreFocusLayout();
      const visibleNodeIds = new Set((nodeIds || []).map(idKey));
      const visibleEdgeIds = new Set();
      snapshot.edges.forEach((edge) => {
        if (visibleNodeIds.has(idKey(edgeSource(edge))) && visibleNodeIds.has(idKey(edgeTarget(edge)))) {
          visibleEdgeIds.add(idKey(edge.id));
        }
      });

      const nodeHidden = hiddenMap(snapshot.currentNodes);
      const edgeHidden = hiddenMap(snapshot.currentEdges);
      const nodeUpdates = snapshot.nodes.map((node) => ({ id: node.id, hidden: !visibleNodeIds.has(idKey(node.id)) }))
        .filter((update) => (nodeHidden.get(idKey(update.id)) || false) !== update.hidden);
      const edgeUpdates = snapshot.edges.map((edge) => ({ id: edge.id, hidden: !visibleEdgeIds.has(idKey(edge.id)) }))
        .filter((update) => (edgeHidden.get(idKey(update.id)) || false) !== update.hidden);

      root.__brainBarFocusState = null;
      root.__brainBarActiveGraphView = viewMeta.activeName;
      setLensEmptyMessage(visibleNodeIds.size === 0 ? viewMeta.empty : '');
      applyDataSetUpdates(nodeUpdates, edgeUpdates);
      updateWorkflowToolbarState();
      showWorkflowViewPanel(viewMeta, Array.from(visibleNodeIds));
      if (visibleNodeIds.size === 1) {
        const nodeId = Array.from(visibleNodeIds)[0];
        graphNetwork()?.selectNodes([nodeId]);
        graphNetwork()?.focus(nodeId, {
          scale: 1.35,
          animation: { duration: 280, easingFunction: 'easeInOutQuad' }
        });
      } else if (visibleNodeIds.size > 1) {
        graphNetwork()?.fit({
          nodes: Array.from(visibleNodeIds),
          animation: { duration: 260, easingFunction: 'easeInOutQuad' }
        });
      }
    }

    function applyBuiltInView(viewName) {
      const view = String(viewName || 'global').toLowerCase();
      const snapshot = currentGraphSnapshot();
      const health = computeGraphHealth({
        nodes: snapshot.nodes,
        edges: snapshot.edges,
        graphLinks: snapshot.state.graphLinks || []
      });

      if (view === 'global') {
        clearRuntimeFilter();
        hideWorkflowViewPanel();
      } else if (view === 'orphans') {
        applyNodeSetView('orphans', health.orphanNodes.map((node) => node.id));
      } else if (view === 'hubs') {
        applyNodeSetView('hubs', health.hubNodes.map((node) => node.id));
      } else if (view === 'review') {
        const targets = reviewQueueNodeTargets(snapshot.nodes, root.__brainBarReviewQueueTargets || []);
        applyNodeSetView('review', targets);
      } else if (view === 'agent') {
        const events = root.__brainBarAgentActivitySnapshot?.events || [];
        const nodeIds = Array.from(new Set(events
          .filter((event) => event && event.nodeId && !event.pending)
          .map((event) => String(event.nodeId))
          .filter((nodeId) => nodeById(snapshot.nodes, nodeId))
        )).slice(0, 40);
        applyNodeSetView('agent', nodeIds);
      } else if (view === 'recent') {
        applyNodeSetView('recent', recentNodeIds(snapshot.nodes));
      } else if (view === 'focus') {
        const selected = graphNetwork()?.getSelectedNodes?.()?.[0];
        if (selected) {
          applyFocus(selected, 1);
        } else {
          showWorkflowViewPanel(describeWorkflowView('focus', 0), []);
        }
      } else if (view === 'groups') {
        showGroupsPanel(communitySummaries({ nodes: snapshot.nodes, edges: snapshot.edges }));
      } else if (view === 'health') {
        showGraphHealthPanel(health);
      }
    }

    function reviewQueueNodeTargets(nodes, targets) {
      return reviewQueueNodeTargetsFromNodes(nodes, targets);
    }

    function ensureWorkflowToolbar() {
      let toolbar = root.document.getElementById('brainbar-workflow-toolbar');
      if (toolbar) {
        return toolbar;
      }
      toolbar = root.document.createElement('div');
      toolbar.id = 'brainbar-workflow-toolbar';
      const title = root.document.createElement('div');
      title.className = 'toolbar-title';
      title.textContent = '2D Workbench';
      toolbar.appendChild(title);
      const views = root.document.createElement('div');
      views.className = 'toolbar-group toolbar-views';
      [
        ['global', 'Global'],
        ['focus', 'Focus'],
        ['recent', 'Recent Notes'],
        ['orphans', 'Needs Links'],
        ['hubs', 'Key Notes'],
        ['agent', 'Agent Activity'],
        ['groups', 'Groups'],
        ['health', 'Graph Check']
      ].forEach(([view, label]) => {
        const button = root.document.createElement('button');
        button.type = 'button';
        button.dataset.view = view;
        button.dataset.label = label;
        button.title = describeWorkflowView(view).body;
        button.textContent = label;
        views.appendChild(button);
      });
      const lens = root.document.createElement('div');
      lens.className = 'toolbar-group source-lens';
      const lensLabel = root.document.createElement('span');
      lensLabel.textContent = 'Source Lens';
      lens.appendChild(lensLabel);
      [
        [ALL_LENS, 'All'],
        [OBSIDIAN_LENS, 'Wikilinks'],
        [GRAPHIFY_LENS, 'Graphify']
      ].forEach(([value, label]) => {
        const button = root.document.createElement('button');
        button.type = 'button';
        button.dataset.lens = value;
        button.dataset.label = label;
        button.textContent = label;
        lens.appendChild(button);
      });
      toolbar.append(views, lens);
      toolbar.addEventListener('click', (event) => {
        const button = event.target.closest('button[data-view]');
        const lensButton = event.target.closest('button[data-lens]');
        if (lensButton) {
          event.preventDefault();
          root.brainBarApplyGraphLens(lensButton.dataset.lens);
          return;
        }
        if (!button) {
          return;
        }
        event.preventDefault();
        applyBuiltInView(button.dataset.view);
      });
      root.document.body.appendChild(toolbar);
      updateWorkflowToolbarState();
      return toolbar;
    }

    function updateWorkflowToolbarState() {
      const toolbar = root.document.getElementById('brainbar-workflow-toolbar');
      if (!toolbar) {
        return;
      }
      const snapshot = currentGraphSnapshot();
      const health = computeGraphHealth({
        nodes: snapshot.nodes,
        edges: snapshot.edges,
        graphLinks: snapshot.state.graphLinks || []
      });
      const viewState = workflowViewState({
        nodes: snapshot.nodes,
        edges: snapshot.edges,
        graphLinks: snapshot.state.graphLinks || [],
        reviewQueueTargets: root.__brainBarReviewQueueTargets || [],
        health
      });
      const active = String(root.__brainBarActiveGraphView || 'global').toLowerCase();
      toolbar.querySelectorAll('button[data-view]').forEach((button) => {
        const view = String(button.dataset.view || '').toLowerCase();
        const selected = active === view || (active === 'global' && view === 'global');
        const state = viewState[view] || { count: 0, hidden: false, disabled: false };
        const label = button.dataset.label || button.textContent || '';
        button.textContent = state.count > 0 && ['orphans', 'hubs', 'review', 'recent', 'agent'].includes(view)
          ? `${label} ${state.count}`
          : label;
        if (view === 'focus') {
          button.title = graphNetwork()?.getSelectedNodes?.()?.[0]
            ? 'Focus the selected note in a temporary 2D subgraph.'
            : 'Select a node first to focus it.';
        } else if (state.disabled) {
          button.title = describeWorkflowView(view).empty || 'No items available for this view.';
        }
        button.hidden = Boolean(state.hidden);
        button.disabled = Boolean(state.disabled) || (view === 'focus' && !graphNetwork()?.getSelectedNodes?.()?.[0]);
        button.classList.toggle('selected', selected);
      });
      const activeLens = normalizeLens(root.__brainBarPendingGraphLens || ALL_LENS);
      toolbar.querySelectorAll('button[data-lens]').forEach((button) => {
        button.classList.toggle('selected', normalizeLens(button.dataset.lens) === activeLens);
      });
    }

    function hideWorkflowViewPanel() {
      const panel = root.document.getElementById('brainbar-workflow-panel');
      if (panel) {
        panel.hidden = true;
      }
    }

    function pathsForNodeIds(nodeIds) {
      const snapshot = currentGraphSnapshot();
      return (nodeIds || [])
        .map((nodeId) => nodeById(snapshot.nodes, nodeId))
        .map(sourceFileForNode)
        .filter(Boolean);
    }

    function showWorkflowViewPanel(meta, nodeIds) {
      let panel = root.document.getElementById('brainbar-workflow-panel');
      if (!panel) {
        panel = root.document.createElement('div');
        panel.id = 'brainbar-workflow-panel';
        root.document.body.appendChild(panel);
      }
      panel.innerHTML = '';

      const close = root.document.createElement('button');
      close.type = 'button';
      close.className = 'close';
      close.textContent = 'Close';
      close.addEventListener('click', () => {
        meta.onClose?.();
        panel.hidden = true;
      });
      const title = root.document.createElement('h2');
      title.textContent = meta.title;
      const body = root.document.createElement('p');
      body.textContent = `${meta.body} ${meta.count} shown.`;
      panel.append(close, title, body);

      const actions = root.document.createElement('div');
      actions.className = 'workflow-actions';
      const focusFirst = root.document.createElement('button');
      focusFirst.type = 'button';
      focusFirst.textContent = 'Focus first';
      focusFirst.disabled = nodeIds.length === 0;
      focusFirst.addEventListener('click', () => {
        if (nodeIds[0]) {
          applyFocus(nodeIds[0], 1);
          panel.hidden = true;
        }
      });
      const showAll = root.document.createElement('button');
      showAll.type = 'button';
      showAll.textContent = meta.showAllLabel || 'Show all';
      showAll.addEventListener('click', () => {
        if (typeof meta.onShowAll === 'function') {
          meta.onShowAll();
        } else {
          clearRuntimeFilter();
        }
        panel.hidden = true;
      });
      actions.append(focusFirst, showAll);
      if (nodeIds[0]) {
        const firstNode = nodeForRuntimeAction(nodeIds[0]);
        const reveal = root.document.createElement('button');
        reveal.type = 'button';
        reveal.textContent = 'Reveal in 3D';
        reveal.addEventListener('click', () => sendGraphBridgeAction('revealIn3D', firstNode));
        const pathFrom = root.document.createElement('button');
        pathFrom.type = 'button';
        pathFrom.textContent = 'Path from here in 3D';
        pathFrom.addEventListener('click', () => sendGraphBridgeAction('pathFromNodeIn3D', firstNode));
        actions.append(reveal, pathFrom);
      }
      const paths = pathsForNodeIds(nodeIds);
      if (paths.length > 0) {
        const copyPaths = root.document.createElement('button');
        copyPaths.type = 'button';
        copyPaths.textContent = 'Copy paths';
        copyPaths.addEventListener('click', () => {
          root.navigator?.clipboard?.writeText(paths.join('\n'));
        });
        actions.appendChild(copyPaths);
      }
      panel.appendChild(actions);

      if (!nodeIds.length) {
        const empty = root.document.createElement('p');
        empty.className = 'empty';
        empty.textContent = meta.empty || 'No nodes match this view.';
        panel.appendChild(empty);
      } else {
        const snapshot = currentGraphSnapshot();
        const nodesDataSet = graphNodesDS();
        nodeIds.slice(0, 10).forEach((nodeId) => {
          const node = nodesDataSet?.get(nodeId) || nodeById(snapshot.nodes, nodeId);
          const row = root.document.createElement('button');
          row.type = 'button';
          row.className = 'health-row';
          row.textContent = nodeDisplayLabel(node, nodeId);
          row.addEventListener('click', () => {
            graphNetwork()?.selectNodes([nodeId]);
            graphNetwork()?.focus(nodeId, {
              scale: 1.15,
              animation: { duration: 220, easingFunction: 'easeInOutQuad' }
            });
          });
          panel.appendChild(row);
        });
      }

      panel.hidden = false;
    }

    function showGroupsPanel(groups) {
      let panel = root.document.getElementById('brainbar-workflow-panel');
      if (!panel) {
        panel = root.document.createElement('div');
        panel.id = 'brainbar-workflow-panel';
        root.document.body.appendChild(panel);
      }
      panel.innerHTML = '';
      const close = root.document.createElement('button');
      close.type = 'button';
      close.className = 'close';
      close.textContent = 'Close';
      close.addEventListener('click', () => { panel.hidden = true; });
      const title = root.document.createElement('h2');
      title.textContent = 'Groups';
      const body = root.document.createElement('p');
      body.textContent = 'Visible communities ranked by size. Open a group to inspect top notes and bridge notes.';
      panel.append(close, title, body);
      if (!groups.length) {
        const empty = root.document.createElement('p');
        empty.className = 'empty';
        empty.textContent = 'No communities found in this graph.';
        panel.appendChild(empty);
      }
      groups.slice(0, 12).forEach((group) => {
        const row = root.document.createElement('button');
        row.type = 'button';
        row.className = 'health-row group-row';
        row.textContent = `${group.label} · ${group.count}`;
        row.addEventListener('click', () => showCommunityDetail(group));
        panel.appendChild(row);
      });
      panel.hidden = false;
      root.__brainBarActiveGraphView = 'groups';
      updateWorkflowToolbarState();
    }

    function showCommunityDetail(group) {
      let panel = root.document.getElementById('brainbar-workflow-panel');
      if (!panel) {
        panel = root.document.createElement('div');
        panel.id = 'brainbar-workflow-panel';
        root.document.body.appendChild(panel);
      }
      panel.innerHTML = '';
      const close = root.document.createElement('button');
      close.type = 'button';
      close.className = 'close';
      close.textContent = 'Close';
      close.addEventListener('click', () => { panel.hidden = true; });
      const title = root.document.createElement('h2');
      title.textContent = group.label;
      const body = root.document.createElement('p');
      body.textContent = `${group.count} notes. Top notes are central inside the group; bridge notes connect this group to other areas.`;
      panel.append(close, title, body);

      const actions = root.document.createElement('div');
      actions.className = 'workflow-actions';
      const focus = root.document.createElement('button');
      focus.type = 'button';
      focus.textContent = 'Focus community';
      focus.addEventListener('click', () => {
        root.__brainBarFocusedCommunityId = String(group.id || group.label || '');
        applyNodeSetView('groups', group.nodeIds);
        panel.hidden = true;
      });
      const reveal = root.document.createElement('button');
      reveal.type = 'button';
      reveal.textContent = 'Reveal in 3D';
      reveal.addEventListener('click', () => {
        sendGraphBridgeAction('showCommunityIn3D', {
          communityId: group.id,
          label: group.label
        });
      });
      actions.append(focus, reveal);
      const paths = group.nodeIds
        .map((nodeId) => sourceFileForNode(nodeForRuntimeAction(nodeId)))
        .filter(Boolean);
      if (paths.length > 0) {
        const copy = root.document.createElement('button');
        copy.type = 'button';
        copy.textContent = 'Copy paths';
        copy.addEventListener('click', () => root.navigator?.clipboard?.writeText(paths.join('\n')));
        actions.appendChild(copy);
      }
      panel.appendChild(actions);

      appendCommunityNotes(panel, 'Top notes', group.topNotes, 'No top notes found.');
      appendCommunityNotes(panel, 'Bridge notes', group.bridgeNotes, 'No bridge notes found for this group.');
      panel.hidden = false;
    }

    function appendCommunityNotes(panel, title, notes, emptyText) {
      const section = root.document.createElement('section');
      const heading = root.document.createElement('h3');
      heading.textContent = `${title} (${notes.length})`;
      section.appendChild(heading);
      if (!notes.length) {
        const empty = root.document.createElement('p');
        empty.className = 'empty';
        empty.textContent = emptyText;
        section.appendChild(empty);
      }
      notes.slice(0, 8).forEach((note) => {
        const row = root.document.createElement('button');
        row.type = 'button';
        row.className = 'health-row';
        row.textContent = note.bridgeScore
          ? `${note.label} · ${note.bridgeScore} bridges`
          : `${note.label} · degree ${note.degree}`;
        row.addEventListener('click', () => {
          graphNetwork()?.selectNodes([note.id]);
          graphNetwork()?.focus(note.id, {
            scale: 1.14,
            animation: { duration: 220, easingFunction: 'easeInOutQuad' }
          });
          addOpenNoteButton(note.id);
        });
        section.appendChild(row);
      });
      panel.appendChild(section);
    }

    function showGraphHealthPanel(health) {
      let panel = root.document.getElementById('brainbar-health-panel');
      if (!panel) {
        panel = root.document.createElement('div');
        panel.id = 'brainbar-health-panel';
        root.document.body.appendChild(panel);
      }
      panel.innerHTML = '';
      const close = root.document.createElement('button');
      close.type = 'button';
      close.className = 'close';
      close.textContent = 'Close';
      close.addEventListener('click', () => {
        panel.hidden = true;
      });
      const title = root.document.createElement('h2');
      title.textContent = 'Graph Check';
      const summary = root.document.createElement('p');
      summary.textContent = `Read-only check: ${health.counts.nodes} notes, ${health.counts.edges} links, ${health.counts.components} connected groups.`;
      panel.append(close, title, summary);
      appendEvidenceGraphCheck(panel);
      graphCheckSections(health, { nodes: currentGraphSnapshot().nodes }).forEach((section) => {
        appendGraphCheckSection(panel, section);
      });
      panel.hidden = false;
    }

    function appendEvidenceGraphCheck(panel) {
      try {
        const report = graphEvidenceSnapshot();
        if (!report) {
          return;
        }
      const rules = root.document.createElement('section');
      rules.className = 'brainbar-evidence-health';
      const heading = root.document.createElement('h3');
      heading.textContent = 'Deterministic proposals';
      const version = root.document.createElement('p');
      version.textContent = `Evidence schema ${report.schemaVersion} · rules ${report.rulesVersion}. Read-only; review caveats before acting.`;
      rules.append(heading, version);
      (report.caveats || []).forEach((caveat) => {
        const item = root.document.createElement('p');
        item.className = 'brainbar-evidence-caveat';
        item.textContent = caveat;
        rules.appendChild(item);
      });
      const proposals = report.proposals || [];
      const visibleProposals = proposals.slice(0, 100);
      if (proposals.length > visibleProposals.length) {
        const count = root.document.createElement('p');
        count.className = 'brainbar-evidence-caveat';
        count.textContent = `Showing ${visibleProposals.length} of ${proposals.length} proposals.`;
        rules.appendChild(count);
      }
      if (!proposals.length) {
        const empty = root.document.createElement('p');
        empty.className = 'empty';
        empty.textContent = 'No deterministic proposals.';
        rules.appendChild(empty);
      }
      visibleProposals.forEach((proposal) => {
        const item = root.document.createElement('article');
        item.className = 'brainbar-evidence-proposal';
        const title = root.document.createElement('strong');
        title.textContent = `${proposal.severity || 'info'} · ${proposal.category || proposal.rule?.id || 'proposal'}`;
        const evidence = root.document.createElement('p');
        evidence.textContent = evidenceValueText(proposal.evidence);
        const threshold = root.document.createElement('p');
        threshold.textContent = `Rule ${proposal.rule?.id || 'unknown'} v${proposal.rule?.version || report.rulesVersion} · threshold: ${evidenceValueText(proposal.threshold?.rule)}`;
        const caveat = root.document.createElement('p');
        caveat.className = 'brainbar-evidence-caveat';
        caveat.textContent = `Caveat: ${evidenceValueText(proposal.threshold?.caveat)}`;
        const subject = root.document.createElement('p');
        subject.textContent = proposalSubjectText(proposal);
        const preview = root.document.createElement('pre');
        preview.textContent = proposal.preview?.text || '';
        const copy = root.document.createElement('button');
        copy.type = 'button';
        copy.textContent = 'Copy instruction';
        copy.disabled = !proposal.preview?.text;
        copy.addEventListener('click', () => {
          root.navigator?.clipboard?.writeText(proposal.preview.text);
        });
        item.append(title, evidence, threshold, caveat, subject, preview, copy);
        rules.appendChild(item);
      });
        panel.appendChild(rules);
      } catch (error) {
        root.__brainBarGraphEvidenceError = String(error?.message || error);
      }
    }

    function graphCheckItemNodeIds(section, item) {
      if (item?.nodeIds) {
        return item.nodeIds;
      }
      if (item?.id && !String(item.id).startsWith('component-')) {
        return [item.id];
      }
      return [];
    }

    function appendGraphCheckSection(panel, section) {
      const wrapper = root.document.createElement('section');
      wrapper.className = 'graph-check-section';
      const heading = root.document.createElement('h3');
      heading.textContent = `${section.title} (${section.items.length})`;
      const summary = root.document.createElement('p');
      summary.textContent = section.summary;
      wrapper.append(heading, summary);

      const firstNodeIds = graphCheckItemNodeIds(section, section.items[0]);
      const actions = root.document.createElement('div');
      actions.className = 'workflow-actions compact';
      const show = root.document.createElement('button');
      show.type = 'button';
      show.textContent = 'Show in graph';
      show.disabled = firstNodeIds.length === 0;
      show.addEventListener('click', () => {
        applyNodeSetView(section.id, section.items.flatMap((item) => graphCheckItemNodeIds(section, item)));
        panel.hidden = true;
      });
      const reveal = root.document.createElement('button');
      reveal.type = 'button';
      reveal.textContent = 'Reveal in 3D';
      reveal.disabled = firstNodeIds.length === 0;
      reveal.addEventListener('click', () => {
        if (firstNodeIds[0]) {
          sendGraphBridgeAction('revealIn3D', nodeForRuntimeAction(firstNodeIds[0]));
        }
      });
      actions.append(show, reveal);
      const paths = section.items
        .flatMap((item) => graphCheckItemNodeIds(section, item))
        .map((nodeId) => sourceFileForNode(nodeForRuntimeAction(nodeId)))
        .filter(Boolean);
      if (paths.length > 0) {
        const copy = root.document.createElement('button');
        copy.type = 'button';
        copy.textContent = 'Copy paths';
        copy.addEventListener('click', () => root.navigator?.clipboard?.writeText(paths.join('\n')));
        actions.appendChild(copy);
      }
      wrapper.appendChild(actions);

      if (section.items.length === 0) {
        const empty = root.document.createElement('p');
        empty.className = 'empty';
        empty.textContent = 'Nothing to review here.';
        wrapper.appendChild(empty);
      }
      section.items.slice(0, 5).forEach((item, index) => {
        const row = root.document.createElement('button');
        row.type = 'button';
        row.className = 'health-row';
        const label = item.label || `Group ${index + 1}`;
        const suffix = item.degree ? ` · ${item.degree}` : (item.size ? ` · ${item.size} notes` : '');
        row.textContent = `${label}${suffix}`;
        row.addEventListener('click', () => {
          const ids = graphCheckItemNodeIds(section, item);
          if (ids.length === 1) {
            graphNetwork()?.selectNodes([ids[0]]);
            graphNetwork()?.focus(ids[0], {
              scale: 1.14,
              animation: { duration: 220, easingFunction: 'easeInOutQuad' }
            });
          } else if (ids.length > 1) {
            applyNodeSetView(section.id, ids);
            panel.hidden = true;
          }
        });
        wrapper.appendChild(row);
      });
      panel.appendChild(wrapper);
    }

    function appendGraphCheckActions(panel, health) {
      const actions = root.document.createElement('div');
      actions.className = 'workflow-actions';
      const focusFirst = root.document.createElement('button');
      focusFirst.type = 'button';
      focusFirst.textContent = 'Focus first issue';
      const firstNode = health.orphanNodes[0] || health.hubNodes[0] || health.staleCentralNodes[0];
      focusFirst.disabled = !firstNode;
      focusFirst.addEventListener('click', () => {
        if (firstNode?.id) {
          applyFocus(firstNode.id, 1);
          panel.hidden = true;
        }
      });
      const showAll = root.document.createElement('button');
      showAll.type = 'button';
      showAll.textContent = 'Show all';
      showAll.addEventListener('click', () => {
        clearRuntimeFilter();
        panel.hidden = true;
      });
      actions.append(focusFirst, showAll);
      const paths = [...health.orphanNodes, ...health.hubNodes, ...health.staleCentralNodes]
        .map((node) => node.sourceFile)
        .filter(Boolean);
      if (paths.length > 0) {
        const copy = root.document.createElement('button');
        copy.type = 'button';
        copy.textContent = 'Copy paths';
        copy.addEventListener('click', () => {
          root.navigator?.clipboard?.writeText(paths.join('\n'));
        });
        actions.appendChild(copy);
      }
      panel.appendChild(actions);
    }

    function appendHealthList(panel, title, nodes, emptyText = 'Nothing to review') {
      const section = root.document.createElement('section');
      const heading = root.document.createElement('h3');
      heading.textContent = `${title} (${nodes.length})`;
      section.appendChild(heading);
      if (nodes.length === 0) {
        const empty = root.document.createElement('p');
        empty.className = 'empty';
        empty.textContent = emptyText;
        section.appendChild(empty);
      } else {
        nodes.slice(0, 8).forEach((node) => {
          const row = root.document.createElement('button');
          row.type = 'button';
          row.className = 'health-row';
          row.textContent = `${node.label}${node.degree ? ` · degree ${node.degree}` : ''}`;
          row.addEventListener('click', () => {
            applyFocus(node.id, 1);
            panel.hidden = true;
          });
          section.appendChild(row);
        });
      }
      panel.appendChild(section);
    }

    function appendComponentList(panel, title, components) {
      const section = root.document.createElement('section');
      const heading = root.document.createElement('h3');
      heading.textContent = `${title} (${components.length})`;
      section.appendChild(heading);
      if (components.length === 0) {
        const empty = root.document.createElement('p');
        empty.className = 'empty';
        empty.textContent = 'All connected groups beyond the main graph are tiny or absent.';
        section.appendChild(empty);
      } else {
        components.slice(0, 8).forEach((component, index) => {
          const row = root.document.createElement('button');
          row.type = 'button';
          row.className = 'health-row';
          row.textContent = `Group ${index + 1} · ${component.size} notes`;
          row.addEventListener('click', () => {
            applyNodeSetView('component', component.nodeIds || []);
            panel.hidden = true;
          });
          section.appendChild(row);
        });
      }
      panel.appendChild(section);
    }

    function rebuildEmptyCommunityLegend() {
      try {
        const legend = root.document.getElementById('legend');
        if (!legend || legend.querySelector('.legend-item')) {
          return;
        }

        const nodesDataSet = graphNodesDS();
        const nodes = Array.isArray(rawNodes())
          ? rawNodes()
          : (nodesDataSet ? nodesDataSet.get() : []);
        if (!Array.isArray(nodes) || nodes.length === 0) {
          return;
        }

        const communities = new Map();
        nodes.forEach((node) => {
          const cid = node.community ?? node._community ?? node.community_id;
          if (cid === undefined || cid === null || cid === '') {
            return;
          }
          const key = String(cid);
          const existing = communities.get(key) || {
            cid,
            label: node.community_name || node._community_name || `Community ${key}`,
            color: node.color?.background || node.color?.border || '#8fa2ff',
            count: 0
          };
          existing.count += 1;
          communities.set(key, existing);
        });

        if (communities.size === 0) {
          return;
        }

        const updateFallbackSelectAll = () => {
          const checkbox = root.document.getElementById('select-all-cb');
          if (!checkbox) {
            return;
          }
          const boxes = Array.from(root.document.querySelectorAll('.legend-cb'));
          const checked = boxes.filter((box) => box.checked).length;
          checkbox.checked = checked === boxes.length;
          checkbox.indeterminate = checked > 0 && checked < boxes.length;
        };

        const setCommunityVisible = (community, visible, item) => {
          item.classList.toggle('dimmed', !visible);
          const dataSet = graphNodesDS();
          if (dataSet) {
            const updates = nodes
              .filter((node) => String(node.community ?? node._community ?? node.community_id) === String(community.cid))
              .map((node) => ({ id: node.id, hidden: !visible }));
            dataSet.update(updates);
          }
          updateFallbackSelectAll();
          const currentNetwork = graphNetwork();
          if (currentNetwork) {
            currentNetwork.redraw();
          }
        };

        const sortedCommunities = Array.from(communities.values())
          .sort((a, b) => b.count - a.count || String(a.label).localeCompare(String(b.label)));

        sortedCommunities.forEach((community) => {
          const item = root.document.createElement('div');
          item.className = 'legend-item';

          const checkbox = root.document.createElement('input');
          checkbox.type = 'checkbox';
          checkbox.className = 'legend-cb';
          checkbox.checked = true;
          checkbox.addEventListener('change', (event) => {
            event.stopPropagation();
            setCommunityVisible(community, checkbox.checked, item);
          });

          const dot = root.document.createElement('div');
          dot.className = 'legend-dot';
          dot.style.background = community.color;

          const label = root.document.createElement('span');
          label.className = 'legend-label';
          label.textContent = community.label;

          const count = root.document.createElement('span');
          count.className = 'legend-count';
          count.textContent = String(community.count);

          item.append(checkbox, dot, label, count);
          item.addEventListener('click', (event) => {
            if (event.target === checkbox) {
              return;
            }
            checkbox.checked = !checkbox.checked;
            checkbox.dispatchEvent(new Event('change'));
          });
          legend.appendChild(item);
        });

        const selectAll = root.document.getElementById('select-all-cb');
        if (selectAll && !selectAll.dataset.brainBarFallbackInstalled) {
          selectAll.dataset.brainBarFallbackInstalled = 'true';
          selectAll.addEventListener('change', () => {
            const visible = selectAll.checked;
            root.document.querySelectorAll('.legend-cb').forEach((checkbox) => {
              checkbox.checked = visible;
            });
            sortedCommunities.forEach((community) => {
              const item = Array.from(root.document.querySelectorAll('.legend-item'))
                .find((candidate) => candidate.querySelector('.legend-label')?.textContent === community.label);
              if (item) {
                setCommunityVisible(community, visible, item);
              }
            });
          });
        }

        updateFallbackSelectAll();
      } catch (error) {
        console.debug('BrainBar community legend fallback skipped', error);
      }
    }

    function enhanceCommunityLegend() {
      try {
        const legend = root.document.getElementById('legend');
        if (!legend) {
          return;
        }
        const snapshot = currentGraphSnapshot();
        const groups = communitySummaries({ nodes: snapshot.nodes, edges: snapshot.edges });
        const groupByLabel = new Map(groups.map((group) => [group.label, group]));
        const items = Array.from(legend.querySelectorAll('.legend-item'));
        if (!items.length) {
          return;
        }

        let controls = root.document.getElementById('brainbar-community-controls');
        if (!controls) {
          controls = root.document.createElement('div');
          controls.id = 'brainbar-community-controls';
          const search = root.document.createElement('input');
          search.type = 'search';
          search.placeholder = 'Search groups...';
          search.id = 'brainbar-community-search';
          const toggle = root.document.createElement('button');
          toggle.type = 'button';
          toggle.id = 'brainbar-community-toggle';
          toggle.textContent = 'Show more';
          controls.append(search, toggle);
          legend.parentElement?.insertBefore(controls, legend);
          search.addEventListener('input', () => updateCommunityLegendVisibility());
          toggle.addEventListener('click', () => {
            root.__brainBarShowAllCommunities2D = !root.__brainBarShowAllCommunities2D;
            updateCommunityLegendVisibility();
          });
        }

        items.forEach((item) => {
          const labelElement = item.querySelector('.legend-label') || item.querySelector('span:not(.legend-count)') || item;
          const countElement = item.querySelector('.legend-count');
          const label = asLabel(labelElement?.textContent);
          const count = Number(asLabel(countElement?.textContent)) || 0;
          const group = groupByLabel.get(label) || groups.find((candidate) => candidate.count === count && candidate.label === label);
          item.dataset.brainBarCommunityCount = String(group?.count ?? count);
          item.dataset.brainBarCommunityId = group?.id || item.dataset.brainBarCommunityId || '';
          item.dataset.brainBarCommunityLabel = group?.label || label;
          item.hidden = count <= 0;
          if (!item.dataset.brainBarDetailInstalled) {
            item.dataset.brainBarDetailInstalled = 'true';
            labelElement.style.cursor = 'pointer';
            labelElement.addEventListener('click', (event) => {
              event.preventDefault();
              event.stopPropagation();
              const currentGroup = communitySummaries({ nodes: currentGraphSnapshot().nodes, edges: currentGraphSnapshot().edges })
                .find((candidate) => candidate.id === item.dataset.brainBarCommunityId || candidate.label === item.dataset.brainBarCommunityLabel);
              if (currentGroup) {
                showCommunityDetail(currentGroup);
              }
            });
          }
        });
        updateCommunityLegendVisibility();
      } catch (error) {
        console.debug('BrainBar community legend enhancement skipped', error);
      }
    }

    function updateCommunityLegendVisibility() {
      const legend = root.document.getElementById('legend');
      const controls = root.document.getElementById('brainbar-community-controls');
      if (!legend || !controls) {
        return;
      }
      const query = lowerText(root.document.getElementById('brainbar-community-search')?.value || '');
      const showAll = Boolean(root.__brainBarShowAllCommunities2D);
      const toggle = root.document.getElementById('brainbar-community-toggle');
      const items = Array.from(legend.querySelectorAll('.legend-item'))
        .filter((item) => Number(item.dataset.brainBarCommunityCount || 0) > 0)
        .sort((left, right) => Number(right.dataset.brainBarCommunityCount || 0) - Number(left.dataset.brainBarCommunityCount || 0)
          || String(left.dataset.brainBarCommunityLabel || '').localeCompare(String(right.dataset.brainBarCommunityLabel || '')));
      let shown = 0;
      items.forEach((item) => {
        const matches = !query || lowerText(item.dataset.brainBarCommunityLabel).includes(query);
        const withinLimit = showAll || shown < 12 || query;
        item.hidden = !matches || !withinLimit;
        if (matches) {
          shown += 1;
        }
      });
      Array.from(legend.querySelectorAll('.legend-item'))
        .filter((item) => Number(item.dataset.brainBarCommunityCount || 0) <= 0)
        .forEach((item) => { item.hidden = true; });
      if (toggle) {
        toggle.hidden = query || items.length <= 12;
        toggle.textContent = showAll ? 'Show less' : `Show more (${items.length - 12})`;
      }
    }

    function installPremium2DInteraction() {
      const currentNetwork = graphNetwork();
      if (root.__brainBarPremium2DInteractionInstalled || !currentNetwork) {
        return;
      }
      root.__brainBarPremium2DInteractionInstalled = true;

      root.document.addEventListener('mousemove', handlePremiumTooltipPointerMove, { passive: true });
      root.document.getElementById('graph')?.addEventListener('mouseleave', hidePremiumTooltip, { passive: true });

      currentNetwork.on('hoverNode', (params) => {
        const node = graphNodesDS()?.get(params.node) || null;
        showPremiumTooltip('Node', nodeTooltipLabel(node), params.event?.srcEvent || params.event);
      });

      currentNetwork.on('blurNode', hidePremiumTooltip);

      currentNetwork.on('hoverEdge', (params) => {
        const edge = graphEdgesDS()?.get(params.edge) || null;
        const relation = relationForEdge(edge, ensureGraphLensState());
        if (relation) {
          showPremiumTooltip('Relationship', relation, params.event?.srcEvent || params.event);
        }
      });

      currentNetwork.on('blurEdge', hidePremiumTooltip);
      currentNetwork.on('selectNode', (params) => {
        hidePremiumTooltip();
        const selectedNodeId = params.nodes?.[0];
        if (selectedNodeId) {
          addOpenNoteButton(selectedNodeId);
        }
        updateWorkflowToolbarState();
      });
      currentNetwork.on('selectEdge', (params) => {
        hidePremiumTooltip();
        const selectedEdgeId = params.edges?.[0];
        if (selectedEdgeId !== undefined && selectedEdgeId !== null) {
          showEdgeInspector(selectedEdgeId);
        }
      });
      currentNetwork.on('deselectNode', () => {
        hidePremiumTooltip();
        updateWorkflowToolbarState();
      });
      currentNetwork.on('dragStart', hidePremiumTooltip);
      currentNetwork.on('zoom', hidePremiumTooltip);
    }

    function applyNetworkTheme() {
      try {
        const currentNetwork = graphNetwork();
        const nodesDataSet = graphNodesDS();
        const edgesDataSet = graphEdgesDS();

        if (currentNetwork) {
          currentNetwork.setOptions({
            interaction: {
              hover: true,
              hoverConnectedEdges: true,
              selectConnectedEdges: true,
              tooltipDelay: 120
            },
            nodes: {
              shape: 'dot',
              borderWidth: 0.75,
              borderWidthSelected: 1.9,
              shadow: {
                enabled: true,
                color: 'rgba(126, 154, 255, 0.10)',
                size: 2,
                x: 0,
                y: 0
              },
              scaling: {
                min: 2.8,
                max: 9.5,
                label: { enabled: false }
              },
              font: {
                face: '-apple-system, BlinkMacSystemFont, SF Pro Text, Inter, Segoe UI, sans-serif',
                color: 'rgba(244, 246, 255, 0.82)',
                strokeWidth: 0
              }
            },
            edges: {
              color: {
                color: 'rgba(112, 130, 162, 0.20)',
                highlight: 'rgba(230, 238, 255, 0.82)',
                hover: 'rgba(196, 218, 240, 0.66)'
              },
              width: 0.62,
              selectionWidth: 1.55,
              hoverWidth: 1.25,
              smooth: {
                enabled: true,
                type: 'continuous',
                roundness: 0.12
              },
              arrows: {
                to: { enabled: false }
              }
            }
          });
        }

        const state = ensureGraphLensState();
        if (!state || !nodesDataSet || !edgesDataSet || state.themeAppliedVersion === state.snapshotVersion) {
          return;
        }

        const degreeByNode = new Map();
        edgesDataSet.get().forEach((edge) => {
          const source = edgeSource(edge);
          const target = edgeTarget(edge);
          if (source !== undefined && source !== null) {
            degreeByNode.set(idKey(source), (degreeByNode.get(idKey(source)) || 0) + 1);
          }
          if (target !== undefined && target !== null) {
            degreeByNode.set(idKey(target), (degreeByNode.get(idKey(target)) || 0) + 1);
          }
        });

        const themedNodes = nodesDataSet.get().map((node) => {
          const color = node.color || {};
          const base = node._brainBarBaseColor || color.background || color.border || '#8fa2ff';
          const degree = degreeByNode.get(idKey(node.id)) || Number(node.value) || 1;
          const isLeaf = degree <= 1;
          const isSmall = degree <= 3;
          const size = isLeaf
            ? 2.8
            : clamp(3.0 + Math.sqrt(degree) * 0.62, 3.7, 8.2);
          return {
            id: node.id,
            title: '',
            _brainBarBaseColor: base,
            borderWidth: isLeaf ? 0.45 : clamp(0.66 + Math.log1p(degree) * 0.07, 0.72, 1.28),
            borderWidthSelected: 2.15,
            size,
            color: {
              background: isLeaf ? atlasColor(base, 0.12, 0.58) : atlasColor(base, isSmall ? 0.17 : 0.24, 0.44),
              border: atlasColor(base, isLeaf ? 0.36 : 0.62, isLeaf ? 0.60 : 0.38),
              hover: {
                background: atlasColor(base, 0.78, 0.18),
                border: 'rgba(238, 244, 255, 0.88)'
              },
              highlight: {
                background: atlasColor(base, 0.86, 0.14),
                border: 'rgba(248, 250, 255, 0.94)'
              }
            },
            shadow: {
              enabled: degree > 22,
              color: 'rgba(126, 154, 255, 0.09)',
              size: clamp(Math.sqrt(degree) * 0.56, 1.5, 4),
              x: 0,
              y: 0
            },
            font: {
              ...(node.font || {}),
              face: '-apple-system, BlinkMacSystemFont, SF Pro Text, Inter, Segoe UI, sans-serif',
              color: 'rgba(244, 246, 255, 0.82)',
              strokeWidth: 0
            }
          };
        });
        nodesDataSet.update(themedNodes);

        const themedEdges = edgesDataSet.get().map((edge) => {
          const baseWidth = Math.max(0.34, Math.min(edge._brainBarBaseWidth || edge.width || 0.54, 0.72));
          const smooth = organicEdgeSmooth(edge);
          return {
            id: edge.id,
            title: '',
            _brainBarBaseWidth: baseWidth,
            color: {
              color: 'rgba(112, 132, 166, 0.20)',
              highlight: 'rgba(232, 241, 255, 0.86)',
              hover: 'rgba(196, 222, 238, 0.72)'
            },
            width: baseWidth,
            selectionWidth: 1.75,
            hoverWidth: 1.45,
            smooth,
            arrows: { to: { enabled: false } }
          };
        });
        edgesDataSet.update(themedEdges);
        state.themeAppliedVersion = state.snapshotVersion;

        if (currentNetwork) {
          currentNetwork.redraw();
        }
      } catch (error) {
        console.debug('BrainBar graph theme skipped', error);
      }
    }

    function graphSessionSnapshot2D() {
      const pending = root.__brainBarPendingSessionState || {};
      const focus = root.__brainBarFocusState;
      const network = graphNetwork();
      const selectedNodeId = network?.getSelectedNodes?.()?.[0];
      const activeMode = String(root.__brainBarActiveGraphView || 'global');
      return {
        schemaVersion: 1,
        graphVersion: pending.graphVersion || null,
        selectedNodeID: network
          ? (selectedNodeId != null ? String(selectedNodeId) : (activeMode === 'global' ? null : (pending.selectedNodeID || null)))
          : (pending.selectedNodeID || null),
        sourceLens: normalizeLens(root.__brainBarPendingGraphLens || pending.sourceLens || ALL_LENS),
        focusDepth: focus?.centerNodeId
          ? Number(focus.depth || 1)
          : (activeMode === 'global' ? null : (pending.focusDepth || null)),
        path: pending.path || null,
        communityID: root.__brainBarFocusedCommunityId || pending.communityID || null,
        searchQuery: String(root.document.getElementById('search')?.value || pending.searchQuery || ''),
        cameraState: pending.cameraState || null
      };
    }

    function emitGraphSessionState2D() {
      const snapshot = graphSessionSnapshot2D();
      root.__brainBarPendingSessionState = snapshot;
      root.webkit?.messageHandlers?.brainBarGraphSession?.postMessage(snapshot);
    }

    function scheduleGraphSessionState2D() {
      root.clearTimeout(root.__brainBarGraphSessionTimer);
      root.__brainBarGraphSessionTimer = root.setTimeout(emitGraphSessionState2D, 0);
    }

    function installGraphSessionBridge2D() {
      if (root.__brainBarGraphSessionBridgeInstalled) {
        return;
      }
      root.__brainBarGraphSessionBridgeInstalled = true;
      root.document.addEventListener('click', scheduleGraphSessionState2D);
      root.document.addEventListener('input', scheduleGraphSessionState2D);
      root.document.addEventListener('change', scheduleGraphSessionState2D);
      graphNetwork()?.on?.('selectNode', scheduleGraphSessionState2D);
      graphNetwork()?.on?.('deselectNode', scheduleGraphSessionState2D);
    }

    root.brainBarApplyGraphSessionState = (value) => {
      const session = value && typeof value === 'object' && Number(value.schemaVersion) === 1
        ? { ...value, schemaVersion: 1 }
        : null;
      if (!session) {
        return false;
      }
      root.__brainBarPendingSessionState = session;
      const search = root.document.getElementById('search');
      if (search && search.value !== String(session.searchQuery || '')) {
        search.value = String(session.searchQuery || '');
        search.dispatchEvent(new Event('input', { bubbles: true }));
      }
      const snapshot = currentGraphSnapshot();
      if (session.communityID) {
        const group = communitySummaries({ nodes: snapshot.nodes, edges: snapshot.edges })
          .find((candidate) => String(candidate.id) === String(session.communityID)
            || String(candidate.label) === String(session.communityID));
        if (group) {
          root.__brainBarFocusedCommunityId = String(group.id || group.label || '');
          applyNodeSetView('groups', group.nodeIds);
        }
      } else if (session.selectedNodeID && session.focusDepth) {
        applyFocus(session.selectedNodeID, Number(session.focusDepth));
      } else if (session.selectedNodeID && nodeForRuntimeAction(session.selectedNodeID)) {
        graphNetwork()?.selectNodes([session.selectedNodeID]);
        addOpenNoteButton(session.selectedNodeID);
      }
      scheduleGraphSessionState2D();
      return true;
    };

    root.brainBarGraphSessionSnapshot = graphSessionSnapshot2D;

    root.brainBarApplyGraphLens = (lens) => {
      applyNetworkTheme();
      rebuildEmptyCommunityLegend();
      enhanceCommunityLegend();
      ensureWorkflowToolbar();
      installSearchReveal2D();
      installNodeActionBridge();
      installPremium2DInteraction();
      ensureOpenNoteButton();
      installGraphSessionBridge2D();

      const state = ensureGraphLensState();
      if (!state) {
        return;
      }

      const selectedLens = normalizeLens(lens || root.__brainBarPendingGraphLens || ALL_LENS);
      root.__brainBarSearchRevealRestore = null;
      root.__brainBarPendingGraphLens = selectedLens;
      const nodesDataSet = graphNodesDS();
      const edgesDataSet = graphEdgesDS();
      if (!nodesDataSet || !edgesDataSet) {
        return;
      }

      const diff = computeLensDiff({
        lens: selectedLens,
        originalNodes: state.originalNodes,
        originalEdges: state.originalEdges,
        graphLinks: state.graphLinks,
        currentNodes: nodesDataSet.get(),
        currentEdges: edgesDataSet.get()
      });

      if (diff.edgeUpdates.length > 0) {
        edgesDataSet.update(diff.edgeUpdates);
      }
      if (diff.nodeUpdates.length > 0) {
        nodesDataSet.update(diff.nodeUpdates);
      }
      setLensEmptyMessage(diff.emptyMessage);

      const currentNetwork = graphNetwork();
      if (currentNetwork) {
        currentNetwork.redraw();
      }
      const search = root.document.getElementById('search');
      search?.dispatchEvent(new Event('input', { bubbles: true }));
      updateWorkflowToolbarState();
      scheduleGraphSessionState2D();
    };

    root.brainBarRendererDiagnostics2D = () => {
      const snapshot = currentGraphSnapshot();
      // Non-hidden DataSet items are the set submitted to vis-network for painting.
      const submittedNodes = snapshot.currentNodes.filter((node) => !node.hidden);
      const submittedEdges = snapshot.currentEdges.filter((edge) => !edge.hidden);
      const selectedNodes = graphNetwork()?.getSelectedNodes?.() || [];
      const searchResults = root.document.querySelectorAll('#brainbar-search-results .brainbar-search-result');
      const workflowHighlight = currentWorkflowHighlight();
      return {
        activeMode: String(root.__brainBarActiveGraphView || 'global'),
        lens: normalizeLens(root.__brainBarPendingGraphLens || ALL_LENS),
        queryableNodes: snapshot.nodes.length,
        queryableEdges: snapshot.edges.length,
        visibleNodes: submittedNodes.length,
        visibleEdges: submittedEdges.length,
        paintedNodes: submittedNodes.length,
        paintedEdges: submittedEdges.length,
        paintedCountsSettled: true,
        selectedNodeCount: selectedNodes.length,
        searchResultCount: searchResults.length,
        networkAvailable: Boolean(graphNetwork())
        , workflowHighlightNodeCount: workflowHighlight.nodeIds.length
        , workflowHighlightPendingPathCount: workflowHighlight.pendingPaths.length
      };
    };

    root.brainBarApplyReviewQueueTargets = (targets) => {
      root.__brainBarReviewQueueTargets = Array.isArray(targets) ? targets : [];
      updateWorkflowToolbarState();
      if (String(root.__brainBarActiveGraphView || '').toLowerCase() === 'review') {
        applyBuiltInView('review');
      }
    };

    root.brainBarApplyAgentActivity2D = (snapshot) => {
      root.__brainBarAgentActivitySnapshot = normalizeAgentActivitySnapshot(snapshot);
      updateWorkflowToolbarState();
      if (String(root.__brainBarActiveGraphView || '').toLowerCase() === 'agent') {
        applyBuiltInView('agent');
      }
      graphNetwork()?.redraw();
    };

    root.brainBarApplyWorkflowHighlight2D = (workflowID) => {
      root.__brainBarWorkflowHighlightID = String(workflowID || '');
      installWorkflowHighlightOverlay();
      graphNetwork()?.redraw();
    };

    root.brainBarShowGraphHealth = () => {
      applyBuiltInView('health');
    };

    function applyBrainBarGraphRuntime() {
      applyNetworkTheme();
      rebuildEmptyCommunityLegend();
      enhanceCommunityLegend();
      ensureWorkflowToolbar();
      installSearchReveal2D();
      installNodeActionBridge();
      installPremium2DInteraction();
      ensureOpenNoteButton();
      installGraphSessionBridge2D();
      installWorkflowHighlightOverlay();
      const currentNetwork = graphNetwork();
      const selectedNodeId = currentNetwork ? currentNetwork.getSelectedNodes()?.[0] : null;
      if (selectedNodeId) {
        addOpenNoteButton(selectedNodeId);
      }
      root.brainBarApplyGraphLens(root.__brainBarPendingGraphLens || ALL_LENS);
    }

    if (!root.__brainBarGraph2DRuntimeInstalled) {
      root.__brainBarGraph2DRuntimeInstalled = true;
      root.requestAnimationFrame(applyBrainBarGraphRuntime);
      root.setTimeout(applyBrainBarGraphRuntime, 350);
    } else {
      applyBrainBarGraphRuntime();
    }
  }

  const api = {
    allLens: ALL_LENS,
    graphifyLens: GRAPHIFY_LENS,
    obsidianLens: OBSIDIAN_LENS,
    cleanRelationshipLabel,
    computeFocusDiff,
    computeGraphHealth,
    computeLensDiff,
    bridgeActionPayload,
    communitySummaries,
    describeWorkflowView,
    edgeInspectorDetails,
    edgeProvenance,
    edgeSource,
    edgeTarget,
    fileMetadataForNode,
    isObsidianEdge,
    metadataForEdge,
    nodeActionPayload,
    nodeTimestamp,
    nodeTooltipLabel,
    normalizeLens,
    recentNodeIds,
    graphCheckSections,
    search2DNodes,
    visibleNodeIdSet,
    workflowViewState,
    workflowHighlightState,
    normalizeAgentActivitySnapshot,
    sourceFileForNode
  };

  installBrowserRuntime();
  return api;
});
