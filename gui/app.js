/* ============================================================
   Figma → Jira Notifier — GUI application logic
   ============================================================ */

'use strict';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let config = {};
let lastRunResults = null;
let lastRunTime = null;

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------
async function apiGet(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  return res.json();
}

async function apiPost(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `POST ${path} failed: ${res.status}`);
  return data;
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------
/**
 * Extracts the Figma file key and a human-readable name from a Figma URL
 * or returns the raw value unchanged if it doesn't look like a URL.
 *
 * Handles formats:
 *   https://www.figma.com/design/<key>/<name-slug>?...
 *   https://www.figma.com/file/<key>/<name-slug>?...
 *
 * @param {string} input
 * @returns {{ fileKey: string, displayName: string }}
 */
function parseFigmaInput(input) {
  const trimmed = input.trim();
  const match = trimmed.match(/figma\.com\/(?:design|file)\/([A-Za-z0-9]+)(?:\/([^?#]*))?/);
  if (!match) return { fileKey: trimmed, figmaUrl: '', displayName: '' };
  const fileKey = match[1];
  const displayName = match[2]
    ? decodeURIComponent(match[2]).replace(/-/g, ' ').trim()
    : '';
  // Normalise to a clean URL (drop query params)
  const figmaUrl = `https://www.figma.com/design/${fileKey}/${match[2] || ''}`.replace(/\/$/, '');
  return { fileKey, figmaUrl: trimmed.startsWith('http') ? trimmed.split('?')[0] : figmaUrl, displayName };
}

/**
 * Extracts the Jira issue key from a full Jira URL or returns the raw value
 * if it's already just a key like "PROJ-123".
 *
 * Handles:
 *   https://your-org.atlassian.net/browse/PROJ-123
 *   https://your-org.atlassian.net/browse/PROJ-123?...
 *
 * @param {string} input
 * @returns {{ issueKey: string }}
 */
function parseJiraInput(input) {
  const trimmed = input.trim();
  const match = trimmed.match(/\/browse\/([A-Z][A-Z0-9_]+-\d+)/);
  if (match) return { issueKey: match[1] };
  return { issueKey: trimmed };
}

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

/**
 * Very basic cron "next run" estimator — shows the schedule string
 * and a human hint rather than a full parser.
 */
function describeSchedule(cron) {
  if (!cron) return '—';
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return cron;
  const [min, hour, dom, , dow] = parts;
  if (dom === '*' && dow === '*') return `Daily at ${hour.padStart(2,'0')}:${min.padStart(2,'0')}`;
  return cron;
}

function showAlert(elId, type, message) {
  const el = document.getElementById(elId);
  el.className = `alert alert-${type} show`;
  el.textContent = message;
  setTimeout(() => { el.className = 'alert'; }, 4000);
}

// ---------------------------------------------------------------------------
// Load & render config
// ---------------------------------------------------------------------------
async function loadConfig() {
  config = await apiGet('/api/config');
  renderSettings();
  renderProjects();
  updateStatusBar();
}

function renderSettings() {
  // Populate form fields — skip secret fields (server returns '***')
  document.getElementById('jiraBaseUrl').value = config.jiraBaseUrl || '';
  document.getElementById('jiraEmail').value = config.jiraEmail || '';
  document.getElementById('schedule').value = config.schedule || '0 8 * * *';
  // Password fields: show placeholder text if stored, empty otherwise
  document.getElementById('figmaToken').placeholder = config.figmaToken === '***' ? '(stored — leave blank to keep)' : 'figd_…';
  document.getElementById('figmaToken').value = '';
  document.getElementById('jiraApiToken').placeholder = config.jiraApiToken === '***' ? '(stored — leave blank to keep)' : 'Your Jira API token';
  document.getElementById('jiraApiToken').value = '';
}

function updateStatusBar() {
  document.getElementById('lastRun').textContent = lastRunTime ? formatDate(lastRunTime) : '—';
  document.getElementById('scheduleDisplay').textContent = config.schedule || '—';
  document.getElementById('nextRun').textContent = describeSchedule(config.schedule);
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const targetTabId = btn.getAttribute('data-tab');
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));

    btn.classList.add('active');
    const targetPane = document.getElementById(targetTabId);
    if (targetPane) targetPane.classList.add('active');
  });
});

// ---------------------------------------------------------------------------
// Project list rendering (Tabs: Connected & Recent Changes / Activity)
// ---------------------------------------------------------------------------
function renderProjects() {
  const connectedEl = document.getElementById('connectedList');
  const changesEl = document.getElementById('changesList');
  const connectedCountEl = document.getElementById('connectedCount');
  const connectedCountBadgeEl = document.getElementById('connectedCountBadge');
  const changesCountEl = document.getElementById('changesCount');
  const changesCountBadgeEl = document.getElementById('changesCountBadge');

  const projects = config.projects || [];
  if (connectedCountEl) connectedCountEl.textContent = projects.length;
  if (connectedCountBadgeEl) connectedCountBadgeEl.textContent = `${projects.length} configured`;

  // 1. Render Connected Projects list
  if (projects.length === 0) {
    connectedEl.innerHTML = '<div class="empty-state">No connected projects configured yet. Add one to get started.</div>';
    changesEl.innerHTML = '<div class="empty-state">No monitored projects.</div>';
    if (changesCountEl) changesCountEl.textContent = '0';
    if (changesCountBadgeEl) changesCountBadgeEl.textContent = '0';
    return;
  }

  connectedEl.innerHTML = '';
  for (const project of projects) {
    const mentions = (project.mentionedUsers || []).map(u => (typeof u === 'string' ? u : (u.email || u.displayName || u.jiraAccountId))).join(', ') || 'None';
    const card = document.createElement('div');
    card.className = 'project-card';
    card.innerHTML = `
      <div class="project-card-info">
        <div class="name">📐 ${escHtml(project.figmaFileName || project.figmaFileKey)}</div>
        <div class="meta">Figma: <code>${escHtml(project.figmaFileKey)}</code> → Jira: <strong>${escHtml(project.jiraIssueKey)}</strong></div>
        <div class="mentions">👥 ${escHtml(mentions)}</div>
      </div>
      <div class="project-card-actions">
        <button class="btn-secondary" onclick="openEditModal('${project.id}')">Edit</button>
        <button class="btn-danger" onclick="deleteProject('${project.id}')">✕</button>
      </div>
    `;
    connectedEl.appendChild(card);
  }

  // 2. Render Recent Changes / Status tab
  renderChangesColumn();
}

function renderChangesColumn() {
  const changesEl = document.getElementById('changesList');
  const changesCountEl = document.getElementById('changesCount');
  const changesCountBadgeEl = document.getElementById('changesCountBadge');
  const projects = config.projects || [];

  if (!lastRunResults || lastRunResults.length === 0) {
    if (changesCountEl) changesCountEl.textContent = projects.length;
    if (changesCountBadgeEl) changesCountBadgeEl.textContent = `${projects.length} pending`;
    changesEl.innerHTML = projects.map(p => `
      <div class="project-card">
        <div class="project-card-info">
          <div class="name">${escHtml(p.figmaFileName || p.figmaFileKey)}</div>
          <div class="meta">Jira: <strong>${escHtml(p.jiraIssueKey)}</strong></div>
          <span class="change-status no-changes">💤 Ready — pending next diff run</span>
        </div>
      </div>
    `).join('');
    return;
  }

  const icons = { posted: '✅', no_changes: '💤', first_run: '🔖', error: '❌' };
  const badgeClasses = { posted: 'has-changes', no_changes: 'no-changes', first_run: 'baseline', error: 'has-changes' };
  const labels = {
    posted: r => `${r.changesCount} change${r.changesCount !== 1 ? 's' : ''} detected & posted to Jira`,
    no_changes: () => 'No changes detected (synced)',
    first_run: () => 'Baseline snapshot established',
    error: r => `Error: ${r.error || 'Failed'}`
  };

  const activeChanges = lastRunResults.filter(r => r.status === 'posted').length;
  if (changesCountEl) changesCountEl.textContent = activeChanges;
  if (changesCountBadgeEl) changesCountBadgeEl.textContent = `${activeChanges} changed / ${lastRunResults.length} total`;

  changesEl.innerHTML = lastRunResults.map(r => `
    <div class="project-card">
      <div class="project-card-info">
        <div class="name">${icons[r.status] || '•'} ${escHtml(r.figmaFileName || r.projectId)}</div>
        <span class="change-status ${badgeClasses[r.status] || 'no-changes'}">${escHtml((labels[r.status] || (() => r.status))(r))}</span>
      </div>
    </div>
  `).join('');
}

function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ---------------------------------------------------------------------------
// Settings form
// ---------------------------------------------------------------------------
function openSettingsModal() {
  document.getElementById('settingsAlert').className = 'alert';
  document.getElementById('settingsModal').classList.add('open');
}

function closeSettingsModal() {
  document.getElementById('settingsModal').classList.remove('open');
}

document.getElementById('btnOpenSettings').addEventListener('click', openSettingsModal);
document.getElementById('settingsModalClose').addEventListener('click', closeSettingsModal);
document.getElementById('settingsModalCancel').addEventListener('click', closeSettingsModal);
document.getElementById('settingsModal').addEventListener('click', e => {
  if (e.target === document.getElementById('settingsModal')) closeSettingsModal();
});

document.getElementById('btnSaveSettings').addEventListener('click', async () => {
  const payload = {
    jiraBaseUrl: document.getElementById('jiraBaseUrl').value.trim(),
    jiraEmail: document.getElementById('jiraEmail').value.trim(),
    schedule: document.getElementById('schedule').value.trim() || '0 8 * * *'
  };

  const figmaToken = document.getElementById('figmaToken').value;
  const jiraApiToken = document.getElementById('jiraApiToken').value;

  // Only send secret fields if the user actually typed something
  if (figmaToken) payload.figmaToken = figmaToken;
  if (jiraApiToken) payload.jiraApiToken = jiraApiToken;

  // Preserve existing projects
  payload.projects = config.projects || [];

  try {
    await apiPost('/api/config', payload);
    showAlert('settingsAlert', 'success', 'Settings saved.');
    setTimeout(() => {
      closeSettingsModal();
    }, 1000);
    await loadConfig();
  } catch (err) {
    showAlert('settingsAlert', 'error', err.message);
  }
});

document.getElementById('settingsForm').addEventListener('submit', async e => {
  e.preventDefault();
  document.getElementById('btnSaveSettings').click();
});

// ---------------------------------------------------------------------------
// Run Now
// ---------------------------------------------------------------------------
document.getElementById('btnRunNow').addEventListener('click', async () => {
  const btn = document.getElementById('btnRunNow');
  btn.disabled = true;
  btn.classList.add('running');
  btn.textContent = '⏳ Running…';

  const resultsEl = document.getElementById('runResults');
  resultsEl.style.display = 'none';
  resultsEl.innerHTML = '';

  try {
    const data = await apiPost('/api/run', {});
    lastRunTime = new Date().toISOString();
    lastRunResults = data.results || [];
    renderRunResults(lastRunResults);
    renderProjects();
    updateStatusBar();
  } catch (err) {
    resultsEl.style.display = 'flex';
    resultsEl.innerHTML = `<div class="result-row error"><span class="result-icon">❌</span><span>${escHtml(err.message)}</span></div>`;
  } finally {
    btn.disabled = false;
    btn.classList.remove('running');
    btn.textContent = '▶ Run Now';
  }
});

function renderRunResults(results) {
  const el = document.getElementById('runResults');
  if (!results || results.length === 0) {
    el.style.display = 'flex';
    el.innerHTML = '<div class="result-row no_changes"><span class="result-icon">ℹ️</span><span>No projects configured.</span></div>';
    return;
  }

  const icons = { posted: '✅', no_changes: '💤', first_run: '🔖', error: '❌' };
  const labels = {
    posted: r => `${r.changesCount} change${r.changesCount !== 1 ? 's' : ''} posted to Jira`,
    no_changes: () => 'No changes detected',
    first_run: () => 'First run — baseline saved',
    error: r => r.error || 'Unknown error'
  };

  el.innerHTML = results.map(r => `
    <div class="result-row ${r.status}">
      <span class="result-icon">${icons[r.status] || '•'}</span>
      <div>
        <strong>${escHtml(r.figmaFileName || r.projectId)}</strong>
        <div class="result-detail">${escHtml((labels[r.status] || (() => r.status))(r))}</div>
      </div>
    </div>
  `).join('');
  el.style.display = 'flex';
}

// ---------------------------------------------------------------------------
// Project modal
// ---------------------------------------------------------------------------
let editingProjectId = null;

function openAddModal() {
  editingProjectId = null;
  document.getElementById('modalTitle').textContent = 'Add project';
  document.getElementById('modalProjectId').value = uuid();
  document.getElementById('modalFileKey').value = '';
  document.getElementById('modalFileName').value = '';
  document.getElementById('modalJiraKey').value = '';
  renderMentionRows([]);
  document.getElementById('modalAlert').className = 'alert';
  document.getElementById('projectModal').classList.add('open');
}

function openEditModal(projectId) {
  const project = (config.projects || []).find(p => p.id === projectId);
  if (!project) return;
  editingProjectId = projectId;
  document.getElementById('modalTitle').textContent = 'Edit project';
  document.getElementById('modalProjectId').value = project.id;
  document.getElementById('modalFileKey').value = project.figmaUrl || project.figmaFileKey || '';
  document.getElementById('modalFileName').value = project.figmaFileName || '';
  document.getElementById('modalJiraKey').value = project.jiraIssueKey || '';
  renderMentionRows(project.mentionedUsers || []);
  document.getElementById('modalAlert').className = 'alert';
  document.getElementById('projectModal').classList.add('open');
}

function closeModal() {
  document.getElementById('projectModal').classList.remove('open');
}

// Auto-extract key and display name whenever the Figma URL field changes
document.getElementById('modalFileKey').addEventListener('input', () => {
  const raw = document.getElementById('modalFileKey').value;
  const { displayName } = parseFigmaInput(raw);
  if (raw.includes('figma.com') && displayName) {
    document.getElementById('modalFileName').value = displayName;
  }
});

document.getElementById('btnAddProject').addEventListener('click', openAddModal);
document.getElementById('modalClose').addEventListener('click', closeModal);
document.getElementById('modalCancel').addEventListener('click', closeModal);

document.getElementById('projectModal').addEventListener('click', e => {
  if (e.target === document.getElementById('projectModal')) closeModal();
});

// ---- Mention rows ----

function renderMentionRows(users) {
  const container = document.getElementById('mentionRows');
  container.innerHTML = '';
  if (!users || users.length === 0) {
    addMentionRow(container);
  } else {
    for (const u of users) {
      const email = typeof u === 'string' ? u : (u.email || u.displayName || u.jiraAccountId || '');
      addMentionRow(container, email);
    }
  }
}

function addMentionRow(container, email = '') {
  const row = document.createElement('div');
  row.className = 'mention-row';
  row.innerHTML = `
    <input type="email" placeholder="developer@example.com" value="${escHtml(email)}" class="mention-email" />
    <button type="button" class="btn-danger" title="Remove">✕</button>
  `;
  row.querySelector('button').addEventListener('click', () => row.remove());
  container.appendChild(row);
}

document.getElementById('btnAddMention').addEventListener('click', () => {
  addMentionRow(document.getElementById('mentionRows'));
});

// ---- Fetch watchers from Jira ----
document.getElementById('btnSyncWatchers').addEventListener('click', async () => {
  const rawJiraInput = document.getElementById('modalJiraKey').value.trim();
  const { issueKey } = parseJiraInput(rawJiraInput);

  if (!issueKey) {
    showAlert('modalAlert', 'error', 'Enter a Jira ticket URL or key first.');
    return;
  }

  const btn = document.getElementById('btnSyncWatchers');
  btn.disabled = true;
  btn.textContent = '⏳ Fetching…';

  try {
    const data = await apiGet(`/api/jira/watchers?issueKey=${encodeURIComponent(issueKey)}`);
    const watchers = data.watchers || [];
    if (watchers.length === 0) {
      showAlert('modalAlert', 'error', `No watchers found on ${issueKey}.`);
      return;
    }

    const container = document.getElementById('mentionRows');
    // Get existing emails to avoid duplicates
    const existing = new Set(
      [...container.querySelectorAll('.mention-email')].map(i => i.value.trim().toLowerCase()).filter(Boolean)
    );

    let addedCount = 0;
    for (const w of watchers) {
      const email = (w.email || w.displayName || w.accountId || '').trim();
      if (email && !existing.has(email.toLowerCase())) {
        // If container only has an empty row, clear it first
        if (container.children.length === 1 && !container.querySelector('.mention-email').value.trim()) {
          container.innerHTML = '';
        }
        addMentionRow(container, email);
        existing.add(email.toLowerCase());
        addedCount++;
      }
    }

    if (addedCount > 0) {
      showAlert('modalAlert', 'success', `Added ${addedCount} watcher(s) from ${issueKey}.`);
    } else {
      showAlert('modalAlert', 'success', `All watchers from ${issueKey} are already added.`);
    }
  } catch (err) {
    showAlert('modalAlert', 'error', `Failed to fetch watchers: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = '👥 Fetch watchers';
  }
});

// ---- Save project ----

document.getElementById('modalSave').addEventListener('click', async () => {
  const rawFigmaInput = document.getElementById('modalFileKey').value.trim();
  const { fileKey, figmaUrl } = parseFigmaInput(rawFigmaInput);
  const fileName = document.getElementById('modalFileName').value.trim();
  const rawJiraInput = document.getElementById('modalJiraKey').value.trim();
  const { issueKey: jiraKey } = parseJiraInput(rawJiraInput);

  if (!fileKey || !jiraKey) {
    showAlert('modalAlert', 'error', 'Figma URL and Jira ticket URL are required.');
    return;
  }

  const mentionRows = document.querySelectorAll('#mentionRows .mention-row');
  const mentionedUsers = [...mentionRows]
    .map(row => {
      const email = row.querySelector('.mention-email').value.trim();
      return email ? { email, displayName: email.split('@')[0], jiraAccountId: email } : null;
    })
    .filter(Boolean);

  const projectId = document.getElementById('modalProjectId').value;
  const newProject = {
    id: projectId,
    figmaFileKey: fileKey,
    figmaUrl: figmaUrl || '',
    figmaFileName: fileName || fileKey,
    jiraIssueKey: jiraKey,
    mentionedUsers
  };

  const projects = [...(config.projects || [])];
  const idx = projects.findIndex(p => p.id === projectId);
  if (idx >= 0) {
    projects[idx] = newProject;
  } else {
    projects.push(newProject);
  }

  const updatedConfig = { ...config, projects };
  // Re-apply masked placeholders so secrets are preserved
  if (!updatedConfig.figmaToken || updatedConfig.figmaToken === '***') updatedConfig.figmaToken = '***';
  if (!updatedConfig.jiraApiToken || updatedConfig.jiraApiToken === '***') updatedConfig.jiraApiToken = '***';

  try {
    await apiPost('/api/config', updatedConfig);
    await loadConfig();
    closeModal();
  } catch (err) {
    showAlert('modalAlert', 'error', err.message);
  }
});

// ---------------------------------------------------------------------------
// Delete project
// ---------------------------------------------------------------------------
async function deleteProject(projectId) {
  if (!confirm('Remove this project? Its Figma snapshot will remain on disk.')) return;
  const projects = (config.projects || []).filter(p => p.id !== projectId);
  const updatedConfig = { ...config, projects, figmaToken: '***', jiraApiToken: '***' };
  try {
    await apiPost('/api/config', updatedConfig);
    await loadConfig();
  } catch (err) {
    alert('Failed to remove project: ' + err.message);
  }
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
loadConfig().catch(err => console.error('Failed to load config:', err));
