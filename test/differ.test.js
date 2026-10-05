'use strict';

const { diffTrees, flattenTree } = require('../src/differ');
const treeBefore = require('./fixtures/tree-before.json');
const treeAfter  = require('./fixtures/tree-after.json');

// ---------------------------------------------------------------------------
// flattenTree
// ---------------------------------------------------------------------------
describe('flattenTree', () => {
  test('returns a Map', () => {
    const result = flattenTree(treeBefore);
    expect(result).toBeInstanceOf(Map);
  });

  test('skips DOCUMENT and CANVAS wrapper nodes', () => {
    const result = flattenTree(treeBefore);
    for (const [, { node }] of result) {
      expect(node.type).not.toBe('DOCUMENT');
      expect(node.type).not.toBe('CANVAS');
    }
  });

  test('assigns the correct page name to leaf nodes', () => {
    const result = flattenTree(treeBefore);
    // Node 8:11 lives under the "Final" page
    expect(result.get('8:11').pageName).toBe('Final');
  });

  test('includes frames, instances and text nodes', () => {
    const result = flattenTree(treeBefore);
    const types = new Set([...result.values()].map(v => v.node.type));
    expect(types.has('FRAME')).toBe(true);
    expect(types.has('INSTANCE')).toBe(true);
    expect(types.has('TEXT')).toBe(true);
  });

  test('empty tree returns empty map', () => {
    const emptyDoc = { id: '0:0', type: 'DOCUMENT', name: 'Document', children: [] };
    expect(flattenTree(emptyDoc).size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// diffTrees — structural counts
// ---------------------------------------------------------------------------
describe('diffTrees — structural counts', () => {
  let result;

  beforeAll(() => {
    result = diffTrees(treeBefore, treeAfter);
  });

  test('returns added, removed, updated arrays and pages', () => {
    expect(result).toHaveProperty('added');
    expect(result).toHaveProperty('removed');
    expect(result).toHaveProperty('updated');
    expect(result).toHaveProperty('totalChanges');
    expect(result).toHaveProperty('pages');
    expect(Array.isArray(result.added)).toBe(true);
    expect(Array.isArray(result.removed)).toBe(true);
    expect(Array.isArray(result.updated)).toBe(true);
    expect(Array.isArray(result.pages)).toBe(true);
  });

  test('totalChanges equals sum of added + removed + updated', () => {
    const { added, removed, updated, totalChanges } = result;
    expect(totalChanges).toBe(added.length + removed.length + updated.length);
  });

  test('pages array contains only non-empty strings', () => {
    for (const page of result.pages) {
      expect(typeof page).toBe('string');
      expect(page.length).toBeGreaterThan(0);
    }
  });

  test('detects the "Final" page as changed', () => {
    expect(result.pages).toContain('Final');
  });
});

// ---------------------------------------------------------------------------
// diffTrees — added nodes
// ---------------------------------------------------------------------------
describe('diffTrees — added nodes', () => {
  let result;

  beforeAll(() => {
    result = diffTrees(treeBefore, treeAfter);
  });

  test('detects nodes present in after but not before as added', () => {
    // IDs 7:30, 7:31, 7:32, 7:33 are new in tree-after
    const addedIds = result.added.map(n => n.id);
    expect(addedIds).toContain('7:30');
    expect(addedIds).toContain('7:31');
    expect(addedIds).toContain('7:32');
    expect(addedIds).toContain('7:33');
  });

  test('added entries include id, name, type, pageName', () => {
    for (const entry of result.added) {
      expect(entry).toHaveProperty('id');
      expect(entry).toHaveProperty('name');
      expect(entry).toHaveProperty('type');
      expect(entry).toHaveProperty('pageName');
    }
  });

  test('added entries do not appear in removed', () => {
    const addedIds = new Set(result.added.map(n => n.id));
    for (const r of result.removed) {
      expect(addedIds.has(r.id)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// diffTrees — removed nodes
// ---------------------------------------------------------------------------
describe('diffTrees — removed nodes', () => {
  let result;

  beforeAll(() => {
    result = diffTrees(treeBefore, treeAfter);
  });

  test('detects nodes in before but not after as removed', () => {
    // IDs 7:23, 7:24, 7:25, 7:26 are gone in tree-after
    const removedIds = result.removed.map(n => n.id);
    expect(removedIds).toContain('7:23');
    expect(removedIds).toContain('7:24');
    expect(removedIds).toContain('7:25');
    expect(removedIds).toContain('7:26');
  });

  test('the Tag content frames (9:14, 9:15, 9:16) are removed', () => {
    const removedIds = result.removed.map(n => n.id);
    expect(removedIds).toContain('9:14');
    expect(removedIds).toContain('9:15');
    expect(removedIds).toContain('9:16');
  });

  test('removed entries include id, name, type, pageName', () => {
    for (const entry of result.removed) {
      expect(entry).toHaveProperty('id');
      expect(entry).toHaveProperty('name');
      expect(entry).toHaveProperty('type');
      expect(entry).toHaveProperty('pageName');
    }
  });
});

// ---------------------------------------------------------------------------
// diffTrees — updated nodes
// ---------------------------------------------------------------------------
describe('diffTrees — updated nodes', () => {
  let result;

  beforeAll(() => {
    result = diffTrees(treeBefore, treeAfter);
  });

  test('detects fill colour change on UI shell nodes (7:27, 7:28)', () => {
    const updated = result.updated;
    const shellNodes = updated.filter(n => n.id === '7:27' || n.id === '7:28');
    expect(shellNodes.length).toBe(2);
    for (const node of shellNodes) {
      const hasFillChange = node.changes.some(c => c.includes('fill colour changed'));
      expect(hasFillChange).toBe(true);
    }
  });

  test('detects style reference removed on UI shell nodes (7:27, 7:28)', () => {
    const updated = result.updated;
    const shellNodes = updated.filter(n => n.id === '7:27' || n.id === '7:28');
    for (const node of shellNodes) {
      // fill colour changed; style reference removed — combined message
      const hasStyleRemoved = node.changes.some(c =>
        c.includes('style reference removed') || c.includes('fill colour changed')
      );
      expect(hasStyleRemoved).toBe(true);
    }
  });

  test('detects text change on Label nodes in Flow with story (Low)', () => {
    const textUpdates = result.updated.filter(n => n.type === 'TEXT');
    expect(textUpdates.length).toBeGreaterThan(0);
    for (const node of textUpdates) {
      const hasTextChange = node.changes.some(c => c.includes('text updated'));
      expect(hasTextChange).toBe(true);
    }
  });

  test('detects Tag - Read-only fill change in Flow with story (Medium)', () => {
    const tagUpdates = result.updated.filter(n => n.name === 'Tag - Read-only');
    expect(tagUpdates.length).toBe(3);
    for (const node of tagUpdates) {
      const hasFill = node.changes.some(c => c.includes('fill colour changed'));
      expect(hasFill).toBe(true);
    }
  });

  test('updated entries include id, name, type, pageName, changes array', () => {
    for (const entry of result.updated) {
      expect(entry).toHaveProperty('id');
      expect(entry).toHaveProperty('name');
      expect(entry).toHaveProperty('type');
      expect(entry).toHaveProperty('pageName');
      expect(Array.isArray(entry.changes)).toBe(true);
      expect(entry.changes.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// diffTrees — first run (null old tree)
// ---------------------------------------------------------------------------
describe('diffTrees — first run', () => {
  test('treats all nodes as added when oldTree is null', () => {
    const result = diffTrees(null, treeAfter);
    expect(result.removed.length).toBe(0);
    expect(result.updated.length).toBe(0);
    expect(result.added.length).toBeGreaterThan(0);
    expect(result.totalChanges).toBe(result.added.length);
  });
});

// ---------------------------------------------------------------------------
// diffTrees — identical trees
// ---------------------------------------------------------------------------
describe('diffTrees — no changes', () => {
  test('returns zero totalChanges when both trees are identical', () => {
    const result = diffTrees(treeBefore, treeBefore);
    expect(result.totalChanges).toBe(0);
    expect(result.added.length).toBe(0);
    expect(result.removed.length).toBe(0);
    expect(result.updated.length).toBe(0);
  });
});
