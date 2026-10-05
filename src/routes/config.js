'use strict';

const { getConfig, saveConfig } = require('../configStore');
const { reschedule } = require('../scheduler');

/**
 * GET /api/config
 * Returns current config with sensitive token fields redacted.
 */
function getConfigRoute(req, res) {
  const config = getConfig();

  // Deep clone then redact secrets so they never leave the server unmasked
  const safe = JSON.parse(JSON.stringify(config));
  if (safe.figmaToken) safe.figmaToken = '***';
  if (safe.jiraApiToken) safe.jiraApiToken = '***';

  res.json(safe);
}

/**
 * POST /api/config
 * Accepts a full config object. Masked placeholder values ('***') are
 * stripped so existing stored secrets are not overwritten.
 */
function saveConfigRoute(req, res) {
  const incoming = req.body;

  if (!incoming || typeof incoming !== 'object') {
    return res.status(400).json({ error: 'Invalid config payload' });
  }

  const current = getConfig();

  // Merge: if the user did not change a secret field (still '***'), keep the stored value
  const merged = { ...current, ...incoming };
  if (incoming.figmaToken === '***') merged.figmaToken = current.figmaToken;
  if (incoming.jiraApiToken === '***') merged.jiraApiToken = current.jiraApiToken;

  saveConfig(merged);

  // If the schedule changed, update the cron task
  if (incoming.schedule && incoming.schedule !== current.schedule) {
    try {
      reschedule(merged.schedule);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

  res.json({ ok: true });
}

module.exports = { getConfigRoute, saveConfigRoute };
