export function sourceFileForNode(node) {
  return String(node?.sourceFile || node?.source_file || node?._source_file || node?.file || '');
}

export function searchGraphNodes({ query = '', nodes = [], limit = 20 } = {}) {
  const parsedQuery = parseGraphSearchQuery(query);
  if (!parsedQuery.text && parsedQuery.filters.length === 0) {
    return [];
  }

  const maximum = Math.max(0, Math.floor(Number(limit) || 0));
  if (!maximum) return [];
  const matches = [];
  for (const node of nodes || []) {
    const id = String(node?.id ?? '');
    const label = String(node?.label || node?.title || id || 'Untitled');
    const sourceFile = sourceFileForNode(node);
    const score = scoreSearchMatch({ query: parsedQuery.text, id, label, sourceFile });
    if (!id || score === null && parsedQuery.text || !parsedQuery.filters.every((filter) => matchesGraphSearchFilter(node, filter))) continue;
    const candidate = { node, id, label, sourceFile, score: score ?? 80, matchesFilters: true };
    let insertion = matches.length;
    while (insertion > 0 && compareSearchResults(candidate, matches[insertion - 1]) < 0) insertion -= 1;
    if (insertion < maximum) matches.splice(insertion, 0, candidate);
    if (matches.length > maximum) matches.pop();
  }
  return matches;
}

function compareSearchResults(left, right) {
  return left.score - right.score || left.label.localeCompare(right.label) || left.id.localeCompare(right.id);
}

export function parseGraphSearchQuery(value) {
  const filters = [];
  const text = [];
  const supportedFilters = new Set(['type', 'tag', 'status', 'source', 'date', 'agent']);
  const tokens = String(value || '').match(/[^\s"]+:"[^"]*"|"[^"]*"|\S+/g) || [];
  tokens.forEach((token) => {
    const separator = token.indexOf(':');
    const name = separator > 0 ? normalizeSearchText(token.slice(0, separator)) : '';
    const rawValue = separator > 0 ? token.slice(separator + 1) : token;
    const normalizedValue = normalizeSearchText(rawValue.replace(/^"|"$/g, ''));
    if (supportedFilters.has(name) && normalizedValue) {
      filters.push({ name, value: normalizedValue });
    } else if (normalizedValue) {
      text.push(normalizedValue);
    }
  });
  return { text: text.join(' '), filters };
}

export function matchesGraphSearchFilter(node, filter) {
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
    .some((value) => normalizeSearchText(value).includes(filter.value));
}

export function scoreSearchMatch({ query = '', id = '', label = '', sourceFile = '' } = {}) {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) {
    return null;
  }

  const normalizedLabel = normalizeSearchText(label);
  const normalizedSource = normalizeSearchText(sourceFile);
  const normalizedId = normalizeSearchText(id);
  const haystack = [normalizedLabel, normalizedSource, normalizedId].filter(Boolean).join(' ');

  if (normalizedLabel === normalizedQuery) {
    return 0;
  }
  if (normalizedLabel.startsWith(normalizedQuery)) {
    return 10;
  }
  if (normalizedLabel.split(' ').some((token) => token.startsWith(normalizedQuery))) {
    return 20;
  }
  if (normalizedLabel.includes(normalizedQuery)) {
    return 30;
  }
  if (normalizedSource.includes(normalizedQuery)) {
    return 45;
  }
  if (normalizedId.includes(normalizedQuery)) {
    return 55;
  }

  const queryTokens = normalizedQuery.split(' ').filter(Boolean);
  if (queryTokens.length > 1 && queryTokens.every((token) => haystack.includes(token))) {
    return 70;
  }

  return null;
}

export function normalizeSearchText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[_/-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
