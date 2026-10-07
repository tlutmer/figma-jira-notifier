'use strict';

/**
 * Node types worth tracking in the diff.
 * DOCUMENT and CANVAS are structural wrappers — skip them.
 */
const TRACKED_TYPES = new Set([
  'FRAME', 'GROUP', 'COMPONENT', 'COMPONENT_SET',
  'INSTANCE', 'TEXT', 'RECTANGLE', 'ELLIPSE',
  'VECTOR', 'BOOLEAN_OPERATION', 'SECTION'
]);

/**
 * Recursively flattens a Figma document tree into a Map keyed by node id.
 * Each entry carries the node, its containing page name, and the nearest
 * FRAME or SECTION ancestor name (used as the "screen" label in output).
 *
 * @param {object} node        Current Figma node
 * @param {string} pageName    Name of the top-level CANVAS ancestor
 * @param {string} frameName   Name of the nearest FRAME/SECTION ancestor
 * @param {Map}    result      Accumulator map
 * @returns {Map<string, {node: object, pageName: string, frameName: string}>}
 */
function flattenTree(node, pageName = '', frameName = '', result = new Map()) {
  const currentPage  = node.type === 'CANVAS' ? node.name : pageName;
  // Treat top-level FRAMEs and SECTIONs directly under a page as the "screen"
  const currentFrame = (node.type === 'FRAME' || node.type === 'SECTION') && pageName !== ''
    ? node.name
    : frameName;

  if (TRACKED_TYPES.has(node.type)) {
    result.set(node.id, { node, pageName: currentPage, frameName: currentFrame });
  }

  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      flattenTree(child, currentPage, currentFrame, result);
    }
  }

  return result;
}

/**
 * Compares two fill arrays and returns true if they differ meaningfully.
 * @param {Array} a
 * @param {Array} b
 * @returns {boolean}
 */
function fillsChanged(a, b) {
  return JSON.stringify(a) !== JSON.stringify(b);
}

/**
 * Compares two style reference objects and returns true if they differ.
 * @param {object} a
 * @param {object} b
 * @returns {boolean}
 */
function stylesChanged(a, b) {
  return JSON.stringify(a) !== JSON.stringify(b);
}

/**
 * Produces a human-readable array of change descriptions for a node
 * that exists in both old and new trees.
 *
 * @param {object} oldNode
 * @param {object} newNode
 * @returns {string[]}  Empty array means no meaningful change detected.
 */
function describeChanges(oldNode, newNode) {
  const changes = [];

  // Text content
  if (oldNode.characters !== newNode.characters) {
    changes.push(`text updated: ${oldNode.characters || '(empty)'} → ${newNode.characters || '(empty)'}`);
  }

  // Name
  if (oldNode.name !== newNode.name) {
    changes.push(`renamed: "${oldNode.name}" → "${newNode.name}"`);
  }

  // Visibility
  if (oldNode.visible !== newNode.visible) {
    const state = newNode.visible === false ? 'hidden' : 'made visible';
    changes.push(`layer ${state}`);
  }

  // Fill colour
  if (fillsChanged(oldNode.fills, newNode.fills)) {
    const hadStyle = oldNode.styles && oldNode.styles.fill;
    const hasStyle = newNode.styles && newNode.styles.fill;
    if (hadStyle && !hasStyle) {
      changes.push('fill colour changed; style reference removed');
    } else {
      changes.push('fill colour changed');
    }
  }

  // Style references (excluding fill already handled above)
  if (stylesChanged(oldNode.styles, newNode.styles)) {
    const hadFillStyle = oldNode.styles && oldNode.styles.fill;
    const hasFillStyle = newNode.styles && newNode.styles.fill;
    // Only report if this is about non-fill styles, or fill style changed independently
    if (!fillsChanged(oldNode.fills, newNode.fills)) {
      if (hadFillStyle && !hasFillStyle) {
        changes.push('style reference removed');
      } else if (!hadFillStyle && hasFillStyle) {
        changes.push('style reference added');
      } else if (JSON.stringify(oldNode.styles) !== JSON.stringify(newNode.styles)) {
        changes.push('style reference changed');
      }
    }
  }

  return changes;
}

/**
 * Diffs two Figma document trees and comments, returning a structured changelog.
 *
 * @param {object|null} oldTree  Previous snapshot's document node (null = first run)
 * @param {object}      newTree  Current document node from Figma API
 * @param {object|Array} [commentsDiff={}] Object with { newComments, resolvedComments, openComments } or Array of comments
 * @returns {{
 *   added: Array,
 *   removed: Array,
 *   updated: Array,
 *   commentsDiff: { newComments: Array, resolvedComments: Array, openComments: Array },
 *   commentsCount: number,
 *   totalChanges: number,
 *   pages: string[]
 * }}
 */
function diffTrees(oldTree, newTree, commentsDiff = {}) {
  const newMap = flattenTree(newTree);
  const oldMap = oldTree ? flattenTree(oldTree) : new Map();

  const added = [];
  const removed = [];
  const updated = [];
  const pageSet = new Set();

  // Find added and updated nodes
  for (const [id, { node: newNode, pageName, frameName }] of newMap) {
    if (!oldMap.has(id)) {
      added.push({ id, name: newNode.name, type: newNode.type, pageName, frameName });
      pageSet.add(pageName);
    } else {
      const { node: oldNode } = oldMap.get(id);
      const changes = describeChanges(oldNode, newNode);
      if (changes.length > 0) {
        updated.push({ id, name: newNode.name, type: newNode.type, pageName, frameName, changes });
        pageSet.add(pageName);
      }
    }
  }

  // Find removed nodes
  for (const [id, { node: oldNode, pageName, frameName }] of oldMap) {
    if (!newMap.has(id)) {
      removed.push({ id, name: oldNode.name, type: oldNode.type, pageName, frameName });
      pageSet.add(pageName);
    }
  }

  let formattedCommentsDiff = { newComments: [], resolvedComments: [], openComments: [] };
  if (Array.isArray(commentsDiff)) {
    formattedCommentsDiff.newComments = commentsDiff;
  } else if (commentsDiff && typeof commentsDiff === 'object') {
    formattedCommentsDiff = {
      newComments: Array.isArray(commentsDiff.newComments) ? commentsDiff.newComments : [],
      resolvedComments: Array.isArray(commentsDiff.resolvedComments) ? commentsDiff.resolvedComments : [],
      openComments: Array.isArray(commentsDiff.openComments) ? commentsDiff.openComments : []
    };
  }

  // Count new comments and newly resolved comments towards changes
  const commentsCount = formattedCommentsDiff.newComments.length + formattedCommentsDiff.resolvedComments.length;
  const totalChanges = added.length + removed.length + updated.length + commentsCount;

  return {
    added,
    removed,
    updated,
    commentsDiff: formattedCommentsDiff,
    // Keep backwards-compatible comments array pointing to newComments
    comments: formattedCommentsDiff.newComments,
    commentsCount,
    totalChanges,
    pages: [...pageSet].filter(Boolean)
  };
}

module.exports = { diffTrees, flattenTree };
