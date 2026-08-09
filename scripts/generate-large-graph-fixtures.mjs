import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const manifestURL = new URL('../BrainBarTests/Fixtures/large-graph-fixtures.json', import.meta.url);
const relations = ['related_to', 'supports', 'references'];

function createRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return (value ^ (value >>> 14)) >>> 0;
  };
}

function padWidth(count) {
  return Math.max(1, String(Math.max(0, count - 1)).length);
}

function padded(value, width) {
  return String(value).padStart(width, '0');
}

export async function loadFixtureManifest() {
  const source = await readFile(manifestURL, 'utf8');
  return JSON.parse(source);
}

export function generateFixture(definition) {
  const { name, node_count: nodeCount, edge_count: edgeCount, community_count: communityCount, seed } = definition;
  if (!Number.isInteger(nodeCount) || nodeCount < 1 || !Number.isInteger(edgeCount) || edgeCount < 0 || !Number.isInteger(communityCount) || communityCount < 1 || !Number.isInteger(seed)) {
    throw new Error(`Invalid fixture definition for ${name}`);
  }
  if (communityCount > nodeCount || edgeCount > nodeCount * (nodeCount - 1)) {
    throw new Error(`Cannot build exact counts for ${name}`);
  }

  const nodeWidth = padWidth(nodeCount);
  const edgeWidth = padWidth(edgeCount);
  const communityOffset = seed % communityCount;
  const nodes = new Array(nodeCount);
  const edges = new Array(edgeCount);
  const random = createRandom(seed);

  for (let index = 0; index < nodeCount; index += 1) {
    const nodeID = `${name}-node-${padded(index, nodeWidth)}`;
    const communityIndex = ((index + communityOffset) % communityCount) + 1;
    nodes[index] = {
      id: nodeID,
      label: `Fixture ${name} node ${index}`,
      community: `Community ${communityIndex}`,
      source_file: `fixtures/${name}/${nodeID}.md`
    };
  }

  for (let index = 0; index < edgeCount; index += 1) {
    const fromIndex = index % nodeCount;
    const offset = 1 + Math.floor(index / nodeCount);
    const toIndex = (fromIndex + offset) % nodeCount;
    edges[index] = {
      id: `${name}-edge-${padded(index, edgeWidth)}`,
      from: nodes[fromIndex].id,
      to: nodes[toIndex].id,
      relation: relations[random() % relations.length]
    };
  }

  return { nodes, edges };
}

export function fixtureDigest(fixture) {
  return createHash('sha256').update(JSON.stringify(fixture)).digest('hex');
}

export async function writeFixture(definition, outputDirectory) {
  const fixture = generateFixture(definition);
  const outputPath = join(outputDirectory, `${definition.name}.json`);
  await writeFile(outputPath, JSON.stringify(fixture));
  return { fixture, outputPath };
}

function parseArguments(argumentsList) {
  let selectedCase;
  let outputDirectory;
  let all = false;

  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === '--case') {
      selectedCase = argumentsList[index + 1];
      index += 1;
    } else if (argument === '--all') {
      all = true;
    } else if (argument === '--output-dir') {
      outputDirectory = argumentsList[index + 1];
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  if ((!selectedCase && !all) || (selectedCase && all) || !outputDirectory) {
    throw new Error('Usage: node scripts/generate-large-graph-fixtures.mjs (--case <name> | --all) --output-dir <directory>');
  }
  return { selectedCase, outputDirectory };
}

async function main() {
  const { selectedCase, outputDirectory } = parseArguments(process.argv.slice(2));
  const manifest = await loadFixtureManifest();
  const definitions = selectedCase
    ? manifest.fixtures.filter((fixture) => fixture.name === selectedCase)
    : manifest.fixtures;
  if (definitions.length === 0) {
    throw new Error(`Unknown fixture case: ${selectedCase}`);
  }

  await mkdir(outputDirectory, { recursive: true });
  for (const definition of definitions) {
    const { fixture, outputPath } = await writeFixture(definition, outputDirectory);
    console.log(`${definition.name}: ${fixture.nodes.length} nodes, ${fixture.edges.length} edges, ${fixtureDigest(fixture)} -> ${outputPath}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
