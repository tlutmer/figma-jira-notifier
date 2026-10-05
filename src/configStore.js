'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Resolve the directory where runtime files (config.json, snapshots/) live.
 * When running as a pkg binary, process.pkg is truthy and we place files
 * next to the executable so they persist across binary upgrades.
 * When running from source we use the project root (one level above src/).
 */
function runtimeDir() {
  if (process.pkg) {
    return path.dirname(process.execPath);
  }
  return path.join(__dirname, '..');
}

const CONFIG_PATH = path.join(runtimeDir(), 'config.json');

const DEFAULTS = {
  schedule: '0 8 * * *',
  figmaToken: '',
  jiraBaseUrl: '',
  jiraEmail: '',
  jiraApiToken: '',
  projects: []
};

/**
 * Returns the current config, creating config.json with defaults if absent.
 * @returns {object}
 */
function getConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULTS, null, 2), 'utf8');
    return { ...DEFAULTS };
  }
  const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
  return JSON.parse(raw);
}

/**
 * Writes a full config object to disk.
 * @param {object} data
 */
function saveConfig(data) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2), 'utf8');
}

module.exports = { getConfig, saveConfig, runtimeDir };
