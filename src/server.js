'use strict';

const express = require('express');
const path = require('path');
const { getConfigRoute, saveConfigRoute } = require('./routes/config');
const { runNow } = require('./routes/run');
const { getWatchersRoute } = require('./routes/jira');
const scheduler = require('./scheduler');

const app = express();
const PORT = process.env.PORT || 3000;

// ---------------------------------------------------------------------------
// Resolve GUI directory — works both in source and pkg binary contexts
// ---------------------------------------------------------------------------
function guiDir() {
  if (process.pkg) {
    // Assets are embedded in the pkg snapshot filesystem under the original path
    return path.join(path.dirname(process.execPath), 'gui');
  }
  return path.join(__dirname, '..', 'gui');
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
app.use(express.json());
app.use(express.static(guiDir()));

// ---------------------------------------------------------------------------
// API routes
// ---------------------------------------------------------------------------
app.get('/api/config', getConfigRoute);
app.post('/api/config', saveConfigRoute);
app.post('/api/run', runNow);
app.get('/api/jira/watchers', getWatchersRoute);

// Fallback: serve index.html for any non-API route (SPA support)
app.get('*', (req, res) => {
  res.sendFile(path.join(guiDir(), 'index.html'));
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`\n🚀 Figma → Jira Notifier running at http://localhost:${PORT}\n`);
  scheduler.start();
});

module.exports = app;
