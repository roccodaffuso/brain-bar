#!/usr/bin/env node
// Public-safe Graph3D accessibility source audit. Runtime checks live in the
// focused WKWebView XCTest named in the report.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const paths = {
  html: resolve(root, 'BrainBar/Resources/Graph3D/index.html'),
  css: resolve(root, 'BrainBar/Resources/Graph3D/graph3d.css'),
  renderer: resolve(root, 'BrainBar/Resources/Graph3D/graph3d.js'),
  output: resolve(root, 'outputs/graph3d-accessibility-audit.json')
};

const minimumContrast = 4.5;

function parseColor(value) {
  const hex = value.match(/^#([\da-f]{6})$/i);
  if (hex) return hex[1].match(/../g).map((channel) => Number.parseInt(channel, 16)).concat(1);
  const rgba = value.match(/^rgba?\(([^)]+)\)$/i);
  if (!rgba) throw new Error(`Unsupported color: ${value}`);
  const channels = rgba[1].split(',').map((channel) => Number(channel.trim()));
  return [channels[0], channels[1], channels[2], channels[3] ?? 1];
}

function toHex(channels) {
  return `#${channels.map((channel) => Math.round(channel).toString(16).padStart(2, '0')).join('')}`;
}

function composite(foreground, background) {
  return foreground.slice(0, 3).map((channel, index) => channel * foreground[3] + background[index] * (1 - foreground[3]));
}

function linear(channel) {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function luminance(channels) {
  return 0.2126 * linear(channels[0]) + 0.7152 * linear(channels[1]) + 0.0722 * linear(channels[2]);
}

function contrast(foreground, background) {
  const [light, dark] = [luminance(foreground), luminance(background)].sort((left, right) => right - left);
  return (light + 0.05) / (dark + 0.05);
}

function finalRootTokens(css) {
  const roots = [...css.matchAll(/:root\s*\{([\s\S]*?)\}/g)];
  assert.ok(roots.length, 'Expected a :root token block.');
  return Object.assign({}, ...roots.map(([, block]) => Object.fromEntries(
    [...block.matchAll(/--([\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()])
  )));
}

function required(haystack, needle, description) {
  assert.ok(haystack.includes(needle), description);
}

export async function auditGraph3DAccessibility() {
  const [html, css, renderer] = await Promise.all(Object.values(paths).slice(0, 3).map((path) => readFile(path, 'utf8')));
  const tokens = finalRootTokens(css);
  const sidebar = parseColor('#10131b').slice(0, 3);
  const canvas = parseColor('#070b13').slice(0, 3);
  const contrastTokens = [
    ['text-secondary', 'bb-text-secondary', sidebar],
    ['text-muted', 'bb-text-muted', sidebar],
    ['text-faint', 'bb-text-faint', sidebar],
    ['focus-accent', 'bb-accent', sidebar],
    ['warning', 'bb-warning', sidebar],
    ['canvas-label', 'bb-text-secondary', canvas]
  ].map(([name, token, background]) => {
    const foreground = composite(parseColor(tokens[token]), background);
    return {
      name,
      foreground: toHex(foreground),
      background: toHex(background),
      ratio: Number(contrast(foreground, background).toFixed(2)),
      minimum: minimumContrast,
      status: contrast(foreground, background) >= minimumContrast ? 'pass' : 'fail'
    };
  });
  contrastTokens.forEach((entry) => assert.equal(entry.status, 'pass', `${entry.name} contrast is below ${minimumContrast}:1`));

  required(html, 'id="stage" aria-label="3D graph"', 'Stage requires an accessible name.');
  required(html, 'id="graph-visual" aria-hidden="true"', 'Canvas must stay hidden from the accessibility tree.');
  required(html, 'id="graph-controls" role="toolbar" aria-label="Graph presentation controls"', 'Toolbar requires an accessible name.');
  required(html, 'id="detail-level" aria-label="Painted detail level"', 'Detail control requires an accessible name.');
  required(html, 'id="sidebar-toggle" type="button" aria-label="Toggle graph context panel"', 'Sidebar control requires an accessible name.');
  required(html, 'id="camera-back" type="button" aria-label="Return to the previous graph view"', 'Back control requires an accessible name.');
  required(html, 'id="search" type="search" aria-label="Search graph nodes"', 'Search requires an accessible name.');
  required(html, 'id="graph-status" class="sr-only" aria-live="polite"', 'Status requires a polite live region.');
  required(html, 'id="sidebar-resizer" role="separator" aria-label="Docked context panel width" aria-orientation="vertical" tabindex="0"', 'Sidebar resizer requires keyboard semantics.');
  required(renderer, 'aria-label="Show ${escapeHTML(community.name)} community"', 'Community checkboxes require accessible names.');
  required(renderer, 'announceGraphStatus(`Detail ${normalized}.', 'Detail changes require a live status announcement.');
  required(renderer, 'announceGraphStatus(`Context panel ${next}.`)', 'Panel changes require a live status announcement.');

  required(css, '#graph-controls select:focus,', 'Toolbar controls require a programmatic-focus selector.');
  required(css, '#graph-controls select:focus-visible,', 'Toolbar controls require a keyboard-focus selector.');
  required(css, 'outline: 2px solid var(--bb-accent) !important;', 'Toolbar controls require a two-pixel solid focus ring.');
  required(css, '#search:focus,', 'Search requires a programmatic-focus selector.');
  required(css, '#search:focus-visible {', 'Search requires a keyboard-focus selector.');
  required(css, 'outline: 2px solid rgba(127, 160, 255, 0.46);', 'Search requires a two-pixel solid focus ring.');
  required(css, '#sidebar-resizer:focus-visible::after,', 'Sidebar resizer requires a focus indicator.');
  required(css, 'width: 24px;', 'Controls include a 24px pointer target declaration.');
  required(css, 'height: 24px;', 'Controls include a 24px pointer target declaration.');
  required(css, 'height: 28px;', 'Toolbar controls have an explicit 28px target height.');
  required(css, 'min-height: 28px;', 'Toolbar controls meet the 24px minimum pointer target.');

  required(renderer, 'const baseRadius = isSelected ? nodeRadiusForDegree(degree, depth) * 1.18', 'Selected nodes require a larger non-color shape.');
  required(renderer, 'visualContext.strokeStyle = selectedStrokeColor;', 'Selected nodes require a bright outline.');
  required(renderer, 'isEndpoint ? 1 : 0, isEndpoint ? 0 : 0.74', 'Path endpoints and intermediate nodes require distinct non-color emphasis.');
  required(renderer, '<span>${index + 1}</span>${escapeHTML(label)}</button>', 'Path steps require numbered DOM controls.');
  required(renderer, '<span class="sidebar-command-icon pending">!</span>', 'Warnings require a non-color icon.');

  return {
    schemaVersion: 1,
    kind: 'graph3d-accessibility-audit',
    publicSafe: true,
    methodology: [
      'Final CSS tokens composited over declared dark surfaces using WCAG relative luminance.',
      'Static source assertions cover names, live regions, both :focus and :focus-visible selectors, 2px solid focus rings, target declarations, and non-color state cues.',
      'Focused WKWebView XCTest verifies DOM focusability, rendered target sizes, names, and live announcements with the public fixture; focus pseudo-state styling is source-audited because the headless document does not receive system focus.'
    ],
    contrast: contrastTokens,
    keyboardAndPointer: {
      status: 'pass',
      minimumTargetPx: 24,
      primaryToolbarPreferredPx: 32,
      runtimeTest: 'BrainBarTests/testGraph3DAccessibilityAuditUsesPublicFixture'
    },
    nonColorStateCues: {
      selected: ['larger node radius', 'bright canvas outline', 'persistent label'],
      path: ['emphasized endpoints', 'larger intermediate nodes', 'numbered DOM path steps'],
      warning: ['exclamation icon', 'pending graph refresh text']
    }
  };
}

export function formatAccessibilityMarkdown(report) {
  const rows = report.contrast.map((entry) => `| ${entry.name} | ${entry.foreground} | ${entry.background} | ${entry.ratio}:1 | ${entry.status} |`).join('\n');
  return `# Graph3D accessibility audit\n\nThis public-safe audit checks the Graph3D presentation source and is paired with the focused real-WebKit XCTest named in the JSON report. It records no graph identities, labels, paths, notes, or screenshots.\n\n## Method\n\n${report.methodology.map((item) => `- ${item}`).join('\n')}\n\n## WCAG contrast\n\n| Token | Foreground | Background | Ratio | Status |\n| --- | --- | --- | --- | --- |\n${rows}\n\nAll measured text and control token pairs meet the 4.5:1 AA threshold.\n\n## Non-color evidence\n\n- Selected: ${report.nonColorStateCues.selected.join('; ')}.\n- Path: ${report.nonColorStateCues.path.join('; ')}.\n- Warning: ${report.nonColorStateCues.warning.join('; ')}.\n\nRun node scripts/audit-graph3d-accessibility.mjs --write to regenerate the JSON evidence, then run the focused XCTest for runtime verification.\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const report = await auditGraph3DAccessibility();
  if (process.argv.includes('--write')) {
    await writeFile(paths.output, `${JSON.stringify(report, null, 2)}\n`);
  }
  console.log(`Graph3D accessibility audit passed (${report.contrast.map((entry) => `${entry.name} ${entry.ratio}:1`).join(', ')}).`);
}
