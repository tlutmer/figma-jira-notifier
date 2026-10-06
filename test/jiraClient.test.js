'use strict';

const { buildCommentAdf, fetchWatchers } = require('../src/jiraClient');
const axios = require('axios');
jest.mock('axios');
const treeBefore = require('./fixtures/tree-before.json');
const treeAfter  = require('./fixtures/tree-after.json');
const { diffTrees } = require('../src/differ');

// ---------------------------------------------------------------------------
// Shared fixture data
// ---------------------------------------------------------------------------
const FIGMA_FILE_KEY = 'C03gFAqd4DfgSLN06KrUIt';
const FIGMA_URL      = 'https://www.figma.com/design/C03gFAqd4DfgSLN06KrUIt';
const RUN_AT        = '2026-08-26T17:03:10Z';
const SNAPSHOT_DATE = '2026-07-30T15:22:19Z';

const MENTIONED_USERS = [
  { displayName: 'Alice Dev',   jiraAccountId: 'accountid:alice' },
  { displayName: 'Bob Frontend', jiraAccountId: 'accountid:bob' }
];

const diffResult  = diffTrees(treeBefore, treeAfter);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Recursively collects all ADF nodes of a given type from a document.
 */
function collectNodes(node, type, acc = []) {
  if (!node) return acc;
  if (node.type === type) acc.push(node);
  if (Array.isArray(node.content)) {
    for (const child of node.content) collectNodes(child, type, acc);
  }
  return acc;
}

/**
 * Extracts all plain text strings from a document's text nodes.
 */
function extractText(doc) {
  return collectNodes(doc, 'text').map(n => n.text).join(' ');
}

// ---------------------------------------------------------------------------
// Document structure
// ---------------------------------------------------------------------------
describe('buildCommentAdf — document structure', () => {
  let adf;

  beforeAll(() => {
    adf = buildCommentAdf(diffResult, FIGMA_FILE_KEY, FIGMA_URL, RUN_AT, MENTIONED_USERS, SNAPSHOT_DATE);
  });

  test('returns an object with version, type: doc, and content array', () => {
    expect(adf).toMatchObject({ version: 1, type: 'doc' });
    expect(Array.isArray(adf.content)).toBe(true);
    expect(adf.content.length).toBeGreaterThan(0);
  });

  test('all top-level content nodes have a type property', () => {
    for (const node of adf.content) {
      expect(node).toHaveProperty('type');
    }
  });

  test('contains at least one rule (horizontal divider)', () => {
    const rules = collectNodes(adf, 'rule');
    expect(rules.length).toBeGreaterThan(0);
  });

  test('contains bold paragraph labels for Added, Updated, or Removed entries', () => {
    // In the new format these are bold text nodes inside paragraphs/bulletList items,
    // not heading nodes.
    const allText = extractText(adf);
    // At least one of the change type labels must appear given the fixture has changes
    const hasAny = ['Added', 'Updated', 'Removed'].some(label => allText.includes(label));
    expect(hasAny).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Header metadata
// ---------------------------------------------------------------------------
describe('buildCommentAdf — header metadata', () => {
  let adf;

  beforeAll(() => {
    adf = buildCommentAdf(diffResult, FIGMA_FILE_KEY, FIGMA_URL, RUN_AT, MENTIONED_USERS, SNAPSHOT_DATE);
  });

  test('includes the Figma file key in the output', () => {
    expect(extractText(adf)).toContain(FIGMA_FILE_KEY);
  });

  test('includes a clickable Figma URL link node', () => {
    function collectLinks(node, acc = []) {
      if (node.marks && node.marks.some(m => m.type === 'link')) acc.push(node);
      if (Array.isArray(node.content)) node.content.forEach(c => collectLinks(c, acc));
      return acc;
    }
    const links = collectLinks(adf);
    expect(links.length).toBeGreaterThan(0);
    expect(links[0].marks[0].attrs.href).toContain(FIGMA_FILE_KEY);
  });

  test('does NOT include the run timestamp (removed from output)', () => {
    // Timestamps were intentionally removed from the Jira comment format.
    expect(extractText(adf)).not.toContain(RUN_AT);
  });

  test('does NOT include the snapshot date (removed from output)', () => {
    expect(extractText(adf)).not.toContain(SNAPSHOT_DATE);
  });

  test('includes the total change count in the output', () => {
    expect(extractText(adf)).toContain(String(diffResult.totalChanges));
  });

  test('includes the page name "Final" in the output', () => {
    expect(extractText(adf)).toContain('Final');
  });
});

// ---------------------------------------------------------------------------
// @mention nodes
// ---------------------------------------------------------------------------
describe('buildCommentAdf — @mention nodes', () => {
  let adf;

  beforeAll(() => {
    adf = buildCommentAdf(diffResult, FIGMA_FILE_KEY, FIGMA_URL, RUN_AT, MENTIONED_USERS, SNAPSHOT_DATE);
  });

  test('includes a mention node for each configured user', () => {
    const mentions = collectNodes(adf, 'mention');
    expect(mentions.length).toBe(MENTIONED_USERS.length);
  });

  test('mention nodes carry the correct accountId', () => {
    const mentions = collectNodes(adf, 'mention');
    const ids = mentions.map(m => m.attrs.id);
    expect(ids).toContain('accountid:alice');
    expect(ids).toContain('accountid:bob');
  });

  test('mention nodes carry the display name prefixed with @', () => {
    const mentions = collectNodes(adf, 'mention');
    const texts = mentions.map(m => m.attrs.text);
    expect(texts).toContain('@Alice Dev');
    expect(texts).toContain('@Bob Frontend');
  });
});

// ---------------------------------------------------------------------------
// No mentions configured
// ---------------------------------------------------------------------------
describe('buildCommentAdf — no mentions', () => {
  test('does not emit mention nodes when mentionedUsers is empty', () => {
    const adf = buildCommentAdf(diffResult, FIGMA_FILE_KEY, FIGMA_URL, RUN_AT, [], SNAPSHOT_DATE);
    const mentions = collectNodes(adf, 'mention');
    expect(mentions.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// First run (no snapshot date)
// ---------------------------------------------------------------------------
describe('buildCommentAdf — first run', () => {
  test('includes first-run warning when snapshotDate is null', () => {
    const emptyDiff = { added: [], removed: [], updated: [], totalChanges: 0, pages: [] };
    const adf = buildCommentAdf(emptyDiff, FIGMA_FILE_KEY, FIGMA_URL, RUN_AT, [], null);
    expect(extractText(adf)).toMatch(/first run|No previous snapshot/i);
  });

  test('does not include Added/Updated/Removed headings when diff is empty', () => {
    const emptyDiff = { added: [], removed: [], updated: [], totalChanges: 0, pages: [] };
    const adf = buildCommentAdf(emptyDiff, FIGMA_FILE_KEY, FIGMA_URL, RUN_AT, [], null);
    const headings = collectNodes(adf, 'heading');
    const headingTexts = headings.flatMap(h => collectNodes(h, 'text').map(t => t.text)).join(' ');
    expect(headingTexts).not.toContain('Added');
    expect(headingTexts).not.toContain('Updated');
    expect(headingTexts).not.toContain('Removed');
  });
});

// ---------------------------------------------------------------------------
// Per-screen (frame) breakdown
// ---------------------------------------------------------------------------
describe('buildCommentAdf — screen breakdown', () => {
  test('output contains "Screen:" labels for frames in the fixture', () => {
    const adf = buildCommentAdf(diffResult, FIGMA_FILE_KEY, FIGMA_URL, RUN_AT, [], SNAPSHOT_DATE);
    // The fixture diff includes nodes with frameName set — expect at least one Screen: label
    const allText = extractText(adf);
    expect(allText).toContain('Screen:');
  });

  test('page headings appear in the output', () => {
    const adf = buildCommentAdf(diffResult, FIGMA_FILE_KEY, FIGMA_URL, RUN_AT, [], SNAPSHOT_DATE);
    const headings = collectNodes(adf, 'heading');
    expect(headings.length).toBeGreaterThan(0);
  });

  test('no old-format summary phrases appear in output', () => {
    const adf = buildCommentAdf(diffResult, FIGMA_FILE_KEY, FIGMA_URL, RUN_AT, [], SNAPSHOT_DATE);
    const allText = extractText(adf);
    expect(allText).not.toContain('elements added');
    expect(allText).not.toContain('layers updated');
    expect(allText).not.toContain('elements removed');
  });
});

// ---------------------------------------------------------------------------
// ADF node validity — no invalid node types
// ---------------------------------------------------------------------------
describe('buildCommentAdf — ADF node validity', () => {
  const VALID_TYPES = new Set([
    'doc', 'paragraph', 'text', 'heading', 'bulletList',
    'listItem', 'mention', 'rule', 'hardBreak'
  ]);

  test('fetchWatchers parses Jira watchers list correctly', async () => {
    axios.get.mockResolvedValueOnce({
      data: {
        watchers: [
          { accountId: 'acc1', displayName: 'Jane Dev', emailAddress: 'jane@ibm.com' },
          { accountId: 'acc2', displayName: 'Bob Tester', emailAddress: '' }
        ]
      }
    });

    const watchers = await fetchWatchers('https://example.atlassian.net', 'user@ibm.com', 'token', 'PROJ-123');
    expect(watchers.length).toBe(2);
    expect(watchers[0]).toEqual({ accountId: 'acc1', displayName: 'Jane Dev', email: 'jane@ibm.com' });
    expect(watchers[1].displayName).toBe('Bob Tester');
  });

  test('all nodes use valid ADF types', () => {
    const adf = buildCommentAdf(diffResult, FIGMA_FILE_KEY, FIGMA_URL, RUN_AT, MENTIONED_USERS, SNAPSHOT_DATE);
    const invalid = [];

    function walk(node) {
      if (node.type && !VALID_TYPES.has(node.type)) invalid.push(node.type);
      if (Array.isArray(node.content)) node.content.forEach(walk);
    }
    walk(adf);

    expect(invalid).toEqual([]);
  });

  test('text nodes all have a string text property', () => {
    const adf = buildCommentAdf(diffResult, FIGMA_FILE_KEY, FIGMA_URL, RUN_AT, MENTIONED_USERS, SNAPSHOT_DATE);
    const textNodes = collectNodes(adf, 'text');
    for (const node of textNodes) {
      expect(typeof node.text).toBe('string');
    }
  });
});
