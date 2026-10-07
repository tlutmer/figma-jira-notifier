'use strict';

const { getConfig } = require('./configStore');
const { fetchFileTree, fetchComments, postCommentToFigma } = require('./figmaClient');
const { getSnapshot, saveSnapshot } = require('./snapshotStore');
const { diffTrees } = require('./differ');
const { buildCommentAdfList, postComment } = require('./jiraClient');

/**
 * Extracts the document tree from a snapshot data structure.
 * Supports legacy format (document tree at root) and new format ({ document, knownCommentIds, knownResolvedCommentIds }).
 * @param {object|null} snapshot
 * @returns {object|null}
 */
function extractDocTree(snapshot) {
  if (!snapshot) return null;
  if (snapshot.document && snapshot.document.id) {
    return snapshot.document;
  }
  return snapshot;
}

/**
 * Extracts known comment IDs array from a snapshot data structure.
 * @param {object|null} snapshot
 * @returns {string[]}
 */
function extractKnownCommentIds(snapshot) {
  if (!snapshot) return [];
  if (Array.isArray(snapshot.knownCommentIds)) {
    return snapshot.knownCommentIds;
  }
  if (Array.isArray(snapshot._knownCommentIds)) {
    return snapshot._knownCommentIds;
  }
  return [];
}

/**
 * Extracts known resolved comment IDs array from a snapshot data structure.
 * @param {object|null} snapshot
 * @returns {string[]}
 */
function extractKnownResolvedCommentIds(snapshot) {
  if (!snapshot) return [];
  if (Array.isArray(snapshot.knownResolvedCommentIds)) {
    return snapshot.knownResolvedCommentIds;
  }
  return [];
}

/**
 * Runs the full diff pipeline for a single project config entry.
 *
 * Steps:
 *  1. Fetch current Figma document tree and (if syncComments is enabled) comments
 *  2. Load previous snapshot
 *  3. Diff trees and find new, completed, and open comments
 *  4. If changes exist, build ADF comment and post to Jira
 *  5. Save new snapshot (only after successful Jira post)
 *
 * @param {object} project   A single entry from config.projects
 * @param {object} config    The full config object (for tokens/credentials)
 * @returns {Promise<{projectId: string, status: 'posted'|'no_changes'|'first_run', changesCount: number, error?: string}>}
 */
async function runProject(project, config) {
  const { id: projectId, figmaFileKey, figmaUrl = '', figmaFileName, jiraIssueKey, mentionedUsers = [], syncComments = true } = project;

  try {
    console.log(`[Runner] Starting project "${figmaFileName}" (${figmaFileKey}) → ${jiraIssueKey}`);

    const [currentTree, currentComments] = await Promise.all([
      fetchFileTree(figmaFileKey, config.figmaToken),
      syncComments
        ? fetchComments(figmaFileKey, config.figmaToken).catch(err => {
            console.warn(`[Runner] Failed to fetch comments for "${figmaFileName}": ${err.message}`);
            return [];
          })
        : Promise.resolve([])
    ]);

    const previousSnapshot = getSnapshot(figmaFileKey);

    if (!previousSnapshot) {
      // First run — save baseline, nothing to diff yet
      const baselineSnapshot = {
        document: currentTree,
        knownCommentIds: currentComments.map(c => c.id).filter(Boolean),
        knownResolvedCommentIds: currentComments.filter(c => Boolean(c.resolved_at)).map(c => c.id).filter(Boolean),
        _savedAt: new Date().toISOString()
      };
      saveSnapshot(figmaFileKey, baselineSnapshot);
      console.log(`[Runner] First run for "${figmaFileName}" — baseline snapshot saved (${currentComments.length} comments recorded). No comment posted.`);
      return { projectId, figmaFileName, status: 'first_run', changesCount: 0 };
    }

    const previousDoc = extractDocTree(previousSnapshot);
    const knownCommentIds = new Set(extractKnownCommentIds(previousSnapshot));
    const knownResolvedCommentIds = new Set(extractKnownResolvedCommentIds(previousSnapshot));

    let commentsDiff = { newComments: [], resolvedComments: [], openComments: [] };

    if (syncComments) {
      // 1. New comments: IDs not seen in previous snapshot
      const newComments = currentComments.filter(c => c && c.id && !knownCommentIds.has(c.id));

      // 2. Completed comments: Was open before, now has resolved_at
      const resolvedComments = currentComments.filter(c =>
        c && c.id && c.resolved_at && !knownResolvedCommentIds.has(c.id) && knownCommentIds.has(c.id)
      );

      // 3. Open comments: Currently unresolved comments on the file
      const openComments = currentComments.filter(c => c && c.id && !c.resolved_at);

      commentsDiff = { newComments, resolvedComments, openComments };
    }

    const diffResult = diffTrees(previousDoc, currentTree, commentsDiff);

    if (diffResult.totalChanges === 0) {
      console.log(`[Runner] No changes detected for "${figmaFileName}" — skipping Jira comment.`);
      return { projectId, figmaFileName, status: 'no_changes', changesCount: 0 };
    }

    const runAt = new Date().toISOString();
    const snapshotDate = previousSnapshot._savedAt || null;

    const adfList = buildCommentAdfList(
      diffResult,
      figmaFileName,
      figmaUrl,
      runAt,
      mentionedUsers,
      snapshotDate
    );

    await postComment(
      config.jiraBaseUrl,
      config.jiraEmail,
      config.jiraApiToken,
      jiraIssueKey,
      adfList
    );

    // Post frame-pinned changelog comments back to Figma for each updated screen
    try {
      await syncChangesToFigma(figmaFileKey, config.figmaToken, diffResult, runAt, jiraIssueKey);
    } catch (figmaErr) {
      console.warn(`[Runner] Note: Could not post changelog comments directly to Figma: ${figmaErr.message}`);
    }

    // Save updated snapshot
    const allCommentIds = Array.from(new Set([
      ...Array.from(knownCommentIds),
      ...currentComments.map(c => c.id).filter(Boolean)
    ]));

    const allResolvedCommentIds = Array.from(new Set([
      ...Array.from(knownResolvedCommentIds),
      ...currentComments.filter(c => Boolean(c.resolved_at)).map(c => c.id).filter(Boolean)
    ]));

    const newSnapshot = {
      document: currentTree,
      knownCommentIds: allCommentIds,
      knownResolvedCommentIds: allResolvedCommentIds,
      _savedAt: runAt
    };
    saveSnapshot(figmaFileKey, newSnapshot);

    const commentsSummary = syncComments
      ? `(${commentsDiff.newComments.length} new, ${commentsDiff.resolvedComments.length} resolved comments)`
      : '(comments disabled)';
    console.log(`[Runner] Posted ${diffResult.totalChanges} changes ${commentsSummary} for "${figmaFileName}" to ${jiraIssueKey}.`);
    return { projectId, figmaFileName, status: 'posted', changesCount: diffResult.totalChanges };

  } catch (err) {
    console.error(`[Runner] Error processing "${figmaFileName}": ${err.message}`);
    return { projectId, figmaFileName, status: 'error', changesCount: 0, error: err.message };
  }
}

/**
 * Runs the diff pipeline for all configured projects.
 * A failure in one project does not abort the others.
 *
 * @returns {Promise<Array>} Results array — one entry per project
 */
/**
 * Groups diff items by frame/screen and posts pinned changelog comments back to Figma.
 * @param {string} fileKey
 * @param {string} token
 * @param {object} diffResult
 * @param {string} runAt ISO date string
 * @param {string} jiraIssueKey
 */
async function syncChangesToFigma(fileKey, token, diffResult, runAt, jiraIssueKey) {
  if (!token || !fileKey) return;
  const dateFormatted = new Date(runAt).toISOString().split('T')[0];

  // Group diff changes by frameId/frameName
  const screenMap = new Map();

  const allItems = [
    ...diffResult.added.map(n => ({ ...n, action: 'Added' })),
    ...diffResult.removed.map(n => ({ ...n, action: 'Removed' })),
    ...diffResult.updated.map(n => ({ ...n, action: 'Updated' }))
  ];

  for (const item of allItems) {
    if (!item.frameName) continue;
    const key = item.frameId || item.frameName;
    if (!screenMap.has(key)) {
      screenMap.set(key, { frameId: item.frameId, frameName: item.frameName, items: [] });
    }
    screenMap.get(key).items.push(item);
  }

  for (const [, screen] of screenMap) {
    const lines = [`[${dateFormatted}] Design Changelog (${jiraIssueKey}):`];
    for (const item of screen.items) {
      if (item.action === 'Updated' && item.changes) {
        for (const change of item.changes) {
          lines.push(`• ${item.name || item.type}: ${change}`);
        }
      } else {
        lines.push(`• ${item.action}: ${item.name || item.type}`);
      }
    }

    const message = lines.join('\n');
    const clientMeta = screen.frameId ? { node_id: screen.frameId, node_offset: { x: 0, y: 0 } } : null;

    try {
      await postCommentToFigma(fileKey, token, message, clientMeta);
    } catch (err) {
      console.warn(`[Runner] Failed to post comment on frame "${screen.frameName}": ${err.message}`);
    }
  }
}

async function runAllProjects() {
  const config = getConfig();

  if (!config.projects || config.projects.length === 0) {
    console.log('[Runner] No projects configured — nothing to do.');
    return [];
  }

  console.log(`[Runner] Run started at ${new Date().toISOString()} — ${config.projects.length} project(s)`);

  const results = [];
  for (const project of config.projects) {
    const result = await runProject(project, config);
    results.push(result);
  }

  console.log(`[Runner] Run complete. Results: ${JSON.stringify(results.map(r => ({ name: r.figmaFileName, status: r.status, changes: r.changesCount })))}`);
  return results;
}

module.exports = { runAllProjects, extractDocTree, extractKnownCommentIds, extractKnownResolvedCommentIds, syncChangesToFigma };
