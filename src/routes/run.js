'use strict';

const { runAllProjects } = require('../diffRunner');

/**
 * POST /api/run
 * Triggers an immediate diff run across all configured projects.
 * Returns a results array — one entry per project.
 */
async function runNow(req, res) {
  try {
    const results = await runAllProjects();
    res.json({ ok: true, results });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
}

module.exports = { runNow };
