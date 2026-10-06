'use strict';

const { getConfig } = require('../configStore');
const { fetchWatchers } = require('../jiraClient');

/**
 * GET /api/jira/watchers?issueKey=PROJ-123
 * Fetches watchers for a Jira ticket using configured Jira credentials.
 */
async function getWatchersRoute(req, res) {
  const issueKey = (req.query.issueKey || '').trim();

  if (!issueKey) {
    return res.status(400).json({ error: 'Missing required query parameter: issueKey' });
  }

  const config = getConfig();

  if (!config.jiraBaseUrl || !config.jiraEmail || !config.jiraApiToken) {
    return res.status(400).json({ error: 'Jira configuration (base URL, email, API token) is incomplete.' });
  }

  try {
    const watchers = await fetchWatchers(
      config.jiraBaseUrl,
      config.jiraEmail,
      config.jiraApiToken,
      issueKey
    );
    res.json({ issueKey, watchers });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { getWatchersRoute };
