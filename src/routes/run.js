'use strict';

const { runAllProjects, runProject } = require('../diffRunner');
const { getConfig } = require('../configStore');

/**
 * POST /api/run
 * Triggers an immediate diff run across all configured projects (or a single project if projectId is provided).
 * Returns a results array — one entry per project.
 */
async function runNow(req, res) {
  try {
    const { projectId } = req.body || {};
    if (projectId) {
      const config = getConfig();
      const project = (config.projects || []).find(p => p.id === projectId);
      if (!project) {
        return res.status(404).json({ ok: false, error: `Project not found with ID "${projectId}"` });
      }
      const result = await runProject(project, config);
      return res.json({ ok: true, results: [result] });
    }

    const results = await runAllProjects();
    res.json({ ok: true, results });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
}

module.exports = { runNow };
