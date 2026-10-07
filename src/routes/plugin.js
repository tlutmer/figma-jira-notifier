'use strict';

const { getConfig } = require('../configStore');
const { getSnapshot } = require('../snapshotStore');
const { diffTrees } = require('../differ');
const { extractDocTree } = require('../diffRunner');

// In-memory cache of last diff results per project
let latestProjectChanges = new Map();

/**
 * Stores the latest run changelog for plugin retrieval.
 */
function recordRunChanges(projectId, figmaFileKey, jiraIssueKey, diffResult, runAt) {
  const dateFormatted = new Date(runAt).toISOString().split('T')[0];
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
    if (item.action === 'Updated' && item.changes) {
      for (const change of item.changes) {
        screenMap.get(key).items.push(`${item.name || item.type}: ${change}`);
      }
    } else {
      screenMap.get(key).items.push(`${item.action}: ${item.name || item.type}`);
    }
  }

  latestProjectChanges.set(projectId, {
    projectId,
    figmaFileKey,
    jiraIssueKey,
    runDate: dateFormatted,
    screenChanges: Array.from(screenMap.values())
  });
}

/**
 * Route handler for Figma plugin to fetch the latest changes per project.
 */
function getPluginChanges(req, res) {
  const fileKeyQuery = req.query.fileKey;
  if (fileKeyQuery) {
    const entry = Array.from(latestProjectChanges.values()).find(p => p.figmaFileKey === fileKeyQuery);
    return res.json(entry || { projects: [] });
  }

  res.json({
    projects: Array.from(latestProjectChanges.values())
  });
}

module.exports = { getPluginChanges, recordRunChanges };
