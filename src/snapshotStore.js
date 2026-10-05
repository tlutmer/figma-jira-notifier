'use strict';

const fs = require('fs');
const path = require('path');
const { runtimeDir } = require('./configStore');

/**
 * Directory where per-file snapshots are stored.
 * Created on first use if absent.
 */
function snapshotsDir() {
  const dir = path.join(runtimeDir(), 'snapshots');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Returns the previously saved Figma document tree for a given file key,
 * or null if no snapshot exists yet.
 * @param {string} fileKey
 * @returns {object|null}
 */
function getSnapshot(fileKey) {
  const filePath = path.join(snapshotsDir(), `${fileKey}.json`);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

/**
 * Saves the current Figma document tree as the new snapshot for a file key.
 * @param {string} fileKey
 * @param {object} tree  The `document` node from the Figma API response
 */
function saveSnapshot(fileKey, tree) {
  const filePath = path.join(snapshotsDir(), `${fileKey}.json`);
  fs.writeFileSync(filePath, JSON.stringify(tree), 'utf8');
}

module.exports = { getSnapshot, saveSnapshot };
