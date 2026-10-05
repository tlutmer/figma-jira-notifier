'use strict';

const { getConfig } = require('./configStore');
const { fetchFileTree } = require('./figmaClient');
const { getSnapshot, saveSnapshot } = require('./snapshotStore');
const { diffTrees } = require('./differ');
const { buildCommentAdf, postComment } = require('./jiraClient');

/**
 * Runs the full diff pipeline for a single project config entry.
 *
 * Steps:
 *  1. Fetch current Figma document tree
 *  2. Load previous snapshot
 *  3. Diff the two trees
 *  4. If changes exist, build ADF comment and post to Jira
 *  5. Save new snapshot (only after successful Jira post)
 *
 * @param {object} project   A single entry from config.projects
 * @param {object} config    The full config object (for tokens/credentials)
 * @returns {Promise<{projectId: string, status: 'posted'|'no_changes'|'first_run', changesCount: number, error?: string}>}
 */
async function runProject(project, config) {
  const { id: projectId, figmaFileKey, figmaUrl = '', figmaFileName, jiraIssueKey, mentionedUsers = [] } = project;

  try {
    console.log(`[Runner] Starting project "${figmaFileName}" (${figmaFileKey}) → ${jiraIssueKey}`);

    const currentTree = await fetchFileTree(figmaFileKey, config.figmaToken);
    const previousSnapshot = getSnapshot(figmaFileKey);

    if (!previousSnapshot) {
      // First run — save baseline, nothing to diff yet
      saveSnapshot(figmaFileKey, currentTree);
      console.log(`[Runner] First run for "${figmaFileName}" — baseline snapshot saved. No comment posted.`);
      return { projectId, figmaFileName, status: 'first_run', changesCount: 0 };
    }

    const diffResult = diffTrees(previousSnapshot, currentTree);

    if (diffResult.totalChanges === 0) {
      console.log(`[Runner] No changes detected for "${figmaFileName}" — skipping Jira comment.`);
      return { projectId, figmaFileName, status: 'no_changes', changesCount: 0 };
    }

    const runAt = new Date().toISOString();
    // Use the savedAt timestamp embedded in the snapshot if present, otherwise null
    const snapshotDate = previousSnapshot._savedAt || null;

    const adf = buildCommentAdf(
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
      adf
    );

    // Stamp the snapshot with save time before writing
    currentTree._savedAt = runAt;
    saveSnapshot(figmaFileKey, currentTree);

    console.log(`[Runner] Posted ${diffResult.totalChanges} changes for "${figmaFileName}" to ${jiraIssueKey}.`);
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

module.exports = { runAllProjects };
