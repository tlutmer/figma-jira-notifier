# Figma → Jira Notifier — Plan

## Overview

Build a standalone cross-platform service (`figma-jira-notifier`) that:

1. Periodically diffs a set of Figma files against the last saved snapshot
2. Posts a structured, emoji-formatted changelog comment to a linked Jira ticket, @mentioning configured frontend developers
3. Provides a local browser-based GUI (served by a bundled Express server) to manage the project config and trigger manual runs
4. Ships as a single self-contained binary for macOS, Windows, and Fedora Linux — no Node.js or `npm install` required on the target machine

### Technology Stack

- **Runtime:** Node.js (bundled via `@yao-pkg/pkg`)
- **Server:** Express.js — serves the GUI and exposes a REST API for config and manual runs
- **Scheduler:** `node-cron` — runs inside the Express process
- **Config storage:** `config.json` — flat file, read/written by the server
- **Snapshot storage:** `snapshots/` directory — one JSON file per Figma file key, updated after each successful diff run
- **Figma API:** REST v1 (`/v1/files/:key`, `/v1/files/:key/versions`)
- **Jira API:** REST v3 (`POST /rest/api/3/issue/:key/comment`) with Atlassian Document Format (ADF) comment body
- **GUI:** Vanilla HTML/CSS/JS single-page app bundled as static assets inside the Express server

### Repo Structure

```
figma-jira-notifier/
├── src/
│   ├── server.js          # Express app entry point, mounts all routes
│   ├── scheduler.js       # node-cron setup, calls diff runner on schedule
│   ├── diffRunner.js      # Orchestrates: fetch Figma → diff → post to Jira
│   ├── figmaClient.js     # Figma REST API calls
│   ├── jiraClient.js      # Jira REST API calls + ADF comment builder
│   ├── differ.js          # Node tree diff logic (added/updated/removed)
│   ├── snapshotStore.js   # Read/write snapshot JSON files
│   ├── configStore.js     # Read/write config.json
│   └── routes/
│       ├── config.js      # GET/POST /api/config
│       └── run.js         # POST /api/run
├── gui/
│   ├── index.html         # Single-page GUI
│   ├── app.js             # GUI logic (fetch API calls to Express)
│   └── style.css          # Minimal styling
├── snapshots/             # Auto-created at runtime, gitignored
├── config.json            # Auto-created on first launch, gitignored
├── package.json
└── README.md
```

### Config Schema (`config.json`)

```json
{
  "schedule": "0 8 * * *",
  "figmaToken": "...",
  "jiraBaseUrl": "https://your-org.atlassian.net",
  "jiraEmail": "...",
  "jiraApiToken": "...",
  "projects": [
    {
      "id": "uuid-v4",
      "figmaFileKey": "C03gFAqd4DfgSLN06KrUIt",
      "figmaFileName": "My Design File",
      "jiraIssueKey": "PROJ-123",
      "mentionedUsers": [
        { "displayName": "Alice Dev", "jiraAccountId": "abc123" }
      ]
    }
  ]
}
```

---

## Sub-Tasks

---

### Sub-Task 1 — Repo Scaffold & Package Config

**Intent:** Create the repo skeleton, `package.json` with all dependencies declared, and the `pkg` build configuration targeting macOS, Windows x64, and Fedora (Linux x64).

**Expected Outcomes:**
- `package.json` exists with all runtime dependencies (`express`, `node-cron`, `axios`, `uuid`) and dev dependencies (`@yao-pkg/pkg`)
- `pkg` targets defined for `node18-macos-x64`, `node18-win-x64`, `node18-linux-x64`
- `.gitignore` excludes `node_modules/`, `dist/`, `config.json`, `snapshots/`
- `README.md` with setup and build instructions
- Running `npm run build` produces three binaries in `dist/`

**Todo List:**
1. Create `figma-jira-notifier/` directory
2. Write `package.json` with dependencies, scripts (`start`, `build`), and `pkg` config block
3. Write `.gitignore`
4. Write `README.md` with instructions for first-time setup, running locally, and building binaries

**Relevant Context:**
- `@yao-pkg/pkg` is the actively maintained fork of Vercel's `pkg`; it supports Node 18 and produces self-contained binaries
- The `pkg` `assets` field must explicitly include the `gui/` static files and any JSON assets so they are embedded in the binary
- `__dirname` path resolution must use `path.dirname(process.execPath)` when running as a pkg binary (the executable path, not the source path)

**Status:** `[x] done`

---

### Sub-Task 2 — Config Store & Snapshot Store

**Intent:** Implement the two persistence modules that all other modules depend on — `configStore.js` (reads/writes `config.json`) and `snapshotStore.js` (reads/writes per-file snapshot JSONs in `snapshots/`).

**Expected Outcomes:**
- `configStore.js` exposes `getConfig()` and `saveConfig(data)` — creates `config.json` with defaults if it does not exist
- `snapshotStore.js` exposes `getSnapshot(fileKey)` and `saveSnapshot(fileKey, tree)` — creates `snapshots/` dir if missing
- Both modules resolve paths correctly whether running as source (`node src/server.js`) or as a compiled binary
- Unit-testable with no external I/O dependencies beyond `fs`

**Todo List:**
1. Implement `src/configStore.js` with `getConfig` / `saveConfig`
2. Implement `src/snapshotStore.js` with `getSnapshot` / `saveSnapshot`
3. Add path-resolution logic that handles both `process.pkg` (binary) and normal Node.js execution contexts

**Relevant Context:**
- When packaged by `pkg`, `__dirname` refers to the virtual filesystem inside the binary; writable runtime files (`config.json`, `snapshots/`) must be placed relative to `path.dirname(process.execPath)` instead
- Default config should include an empty `projects` array and a sensible default cron schedule (`"0 8 * * *"`)

**Status:** `[x] done`

---

### Sub-Task 3 — Figma API Client

**Intent:** Implement `figmaClient.js` — a thin wrapper around the Figma REST API that fetches the current full document tree for a given file key.

**Expected Outcomes:**
- `fetchFileTree(fileKey, token)` returns the full `document` node object from the Figma API response
- `fetchVersions(fileKey, token)` returns the version history array (used for display in changelog metadata)
- Errors (bad token, 404, rate limit) are thrown with descriptive messages so the diff runner can surface them cleanly
- No hardcoded tokens — token is always passed as a parameter sourced from config

**Todo List:**
1. Implement `src/figmaClient.js` with `fetchFileTree` and `fetchVersions` using `axios`
2. Set `X-Figma-Token` header from the passed token
3. Add basic error handling — rethrow with context (file key + HTTP status)

**Relevant Context:**
- Figma REST API base URL: `https://api.figma.com`
- `GET /v1/files/:key` — returns `{ document, components, styles, ... }`; only `document` is needed for diffing
- `GET /v1/files/:key/versions` — returns `{ versions: [...] }`
- Figma rate limits: ~100 requests/min per token — not a concern for a small config with a few files

**Status:** `[x] done`

---

### Sub-Task 4 — Differ (Node Tree Diff Logic)

**Intent:** Implement `differ.js` — the core diff engine that compares two Figma document trees (previous snapshot vs. current) and produces a structured changelog object.

**Expected Outcomes:**
- `diffTrees(oldTree, newTree)` returns a structured object:
  ```json
  {
    "added": [...],
    "removed": [...],
    "updated": [...],
    "totalChanges": 18,
    "pages": ["Final"]
  }
  ```
- Each entry includes: node `id`, `name`, `type`, parent page name, and (for updates) a `changes` array describing what changed (text, fill, style ref)
- Nodes are matched by `id`; a node present in new but not old = added; present in old but not new = removed; present in both with differing properties = updated
- The diff is scoped to meaningful properties: `name`, `characters` (text), `fills`, `styles`, `visible`

**Todo List:**
1. Implement recursive tree flattener: `flattenTree(node, pageName)` → `Map<id, {node, pageName}>`
2. Implement `diffTrees(oldTree, newTree)` using two flattened maps
3. Implement property-level diff for updated nodes (text change, fill change, style ref removed/added)
4. Group results by page name for the comment formatter

**Relevant Context:**
- Figma document structure: `document.children` = pages; each page has `.children` = frames; frames contain nested nodes
- Node `id` is stable within a file across versions (unless a component is detached and re-added)
- Only diff nodes of meaningful types: `FRAME`, `COMPONENT`, `INSTANCE`, `TEXT`, `RECTANGLE`, `GROUP` — skip `DOCUMENT` and `CANVAS` wrapper nodes
- The "false added+removed" problem for re-created nodes is a known limitation; document it in README rather than trying to solve it heuristically in v1

**Status:** `[x] done`

---

### Sub-Task 5 — Jira API Client & ADF Comment Builder

**Intent:** Implement `jiraClient.js` — posts a structured ADF comment to a Jira issue, and contains the ADF builder that converts the diff result into the formatted comment shown in the requirements.

**Expected Outcomes:**
- `postComment(jiraBaseUrl, email, apiToken, issueKey, commentAdf)` posts to Jira and returns success/failure
- `buildCommentAdf(diffResult, figmaFileKey, runAt, mentionedUsers)` returns a valid ADF document object matching the required format:
  - Header line with emoji, total change count, file key, run timestamp
  - Warning block if no version was found on the target date
  - Summary line per page
  - Added / Updated / Removed sections with bulleted details
  - @mention nodes for each configured frontend developer
- Jira `accountId` is used for mentions (not display name)

**Todo List:**
1. Implement `src/jiraClient.js` with `postComment`
2. Implement `buildCommentAdf` — construct the ADF JSON document node-by-node
3. Add @mention ADF nodes at the top of the comment (after the header) for each user in `mentionedUsers`
4. Add error handling — rethrow with Jira issue key + HTTP status context

**Relevant Context:**
- Jira Cloud REST API: `POST /rest/api/3/issue/{issueKey}/comment` with `Content-Type: application/json` and Basic Auth (`email:apiToken` base64)
- ADF mention node format: `{ "type": "mention", "attrs": { "id": "<accountId>", "text": "@DisplayName" } }`
- ADF paragraph, bulletList, listItem, text, strong node types are sufficient for this comment format
- The example comment in the requirements is the authoritative reference for layout

**Status:** `[x] done`

---

### Sub-Task 6 — Diff Runner & Scheduler

**Intent:** Implement `diffRunner.js` (the orchestration layer that ties Figma fetch → diff → snapshot update → Jira post together for all configured projects) and `scheduler.js` (which wires `node-cron` to the runner on the configured schedule).

**Expected Outcomes:**
- `runAllProjects(config)` iterates over `config.projects`, runs the full pipeline for each, and returns a results array (success/error per project)
- If a project's diff produces zero changes, no Jira comment is posted (silent skip)
- The snapshot is only updated after a successful Jira post, so a failed post retries on the next run
- `scheduler.js` reads the schedule from config on startup and reschedules if config changes (for future GUI schedule edits)
- Console logs show run start, per-project status, and run end

**Todo List:**
1. Implement `src/diffRunner.js` with `runAllProjects(config)`
2. Add per-project try/catch so one failing project does not abort others
3. Implement `src/scheduler.js` — starts `node-cron` task using `config.schedule`, exposes `reschedule(newCron)` for future use
4. Wire scheduler startup into `server.js`

**Relevant Context:**
- Import order in `diffRunner.js`: `configStore` → `figmaClient` → `snapshotStore` → `differ` → `jiraClient`
- Zero-change runs should log "No changes detected for [project name] — skipping Jira comment"
- `node-cron` syntax is standard Unix cron; default `"0 8 * * *"` = 8 AM daily

**Status:** `[x] done`

---

### Sub-Task 7 — Express Server & API Routes

**Intent:** Implement `server.js` and the two API route files so the GUI has a stable REST interface for reading/writing config and triggering manual runs.

**Expected Outcomes:**
- `GET /api/config` — returns the current `config.json` contents (redacts `figmaToken` and `jiraApiToken` values to `"***"` in response for security)
- `POST /api/config` — accepts and saves a full config object; validates required top-level fields before writing
- `POST /api/run` — triggers `runAllProjects` immediately, returns results array as JSON
- `GET /` — serves `gui/index.html`
- Static files under `/gui` are served from the embedded `gui/` directory
- Server listens on port `3000` by default (configurable via `PORT` env var)

**Todo List:**
1. Implement `src/server.js` — set up Express, mount static middleware for `gui/`, mount API routes, start listening
2. Implement `src/routes/config.js` — `GET` and `POST /api/config`
3. Implement `src/routes/run.js` — `POST /api/run`
4. Add token redaction in the GET config response
5. Log server start URL to console (`http://localhost:3000`)

**Relevant Context:**
- When running as a `pkg` binary, static file paths for `express.static` must use `path.join(path.dirname(process.execPath), 'gui')` — but since `pkg` embeds assets in the virtual FS, use the `pkg` snapshot path instead (see Sub-Task 1 for asset embedding config)
- Keep middleware minimal — no auth needed since this is localhost-only

**Status:** `[x] done`

---

### Sub-Task 8 — Local Browser GUI

**Intent:** Build the single-page HTML/CSS/JS GUI that lets a programme manager manage projects (add/edit/remove), configure global settings (tokens, schedule), and trigger a manual run — all by calling the local Express API.

**Expected Outcomes:**
- **Global Settings panel:** Figma token, Jira base URL, Jira email, Jira API token, cron schedule — with a Save button
- **Projects panel:** list of configured projects, each showing Figma file name, Jira issue key, and linked developers; Add / Edit / Remove per project
- **Add/Edit Project modal:** fields for Figma file key, Jira issue key, display name + Jira account ID for each frontend dev (add multiple)
- **Run Now button:** calls `POST /api/run`, shows a results summary (per-project: success / no changes / error)
- **Status bar:** last run time, next scheduled run (derived from cron expression)
- Tokens are displayed masked; user must re-enter to change
- No external CSS framework — minimal, clean vanilla CSS

**Todo List:**
1. Write `gui/index.html` — full page structure with all panels and modal scaffold
2. Write `gui/app.js` — fetch wrappers for all API calls, render functions for project list, modal open/close/save, run-now handler, status display
3. Write `gui/style.css` — clean layout using CSS Grid/Flexbox, neutral colour palette, clear form styling

**Relevant Context:**
- The GUI talks exclusively to `http://localhost:3000/api/*` — no direct Figma or Jira API calls from the browser
- Token fields should use `type="password"` and only send their value if the user has typed in them (to avoid overwriting stored tokens with masked placeholder values)
- The `mentionedUsers` array per project is a list of `{ displayName, jiraAccountId }` objects — the GUI must support adding/removing rows in this list within the modal

**Status:** `[x] done`

---

### Sub-Task 9 — Cross-Platform Build & Distribution

**Intent:** Configure `@yao-pkg/pkg` to produce three self-contained binaries (`figma-jira-notifier-macos`, `figma-jira-notifier-win.exe`, `figma-jira-notifier-linux`) that include all source, dependencies, and GUI assets, requiring nothing pre-installed on the target machine.

**Expected Outcomes:**
- `npm run build` produces three binaries in `dist/`
- Each binary, when double-clicked or run from terminal, starts the Express server and opens the GUI URL in a message
- `gui/` static assets are correctly embedded and served from within the binary
- `config.json` and `snapshots/` are created at runtime next to the binary (not inside it), so user data persists across binary upgrades
- README documents how to install (copy binary), run (execute binary), and schedule (OS cron / Task Scheduler / systemd)

**Todo List:**
1. Add `pkg` config to `package.json`: `targets`, `assets` (gui files), `outputPath: "dist"`
2. Verify path resolution for embedded assets vs. writable runtime files (see Sub-Task 2 context)
3. Add `npm run build` script: `pkg . --out-path dist`
4. Test each binary target locally (or document test matrix)
5. Update `README.md` with per-OS run and scheduling instructions (macOS launchd, Windows Task Scheduler, Fedora systemd timer)

**Relevant Context:**
- `@yao-pkg/pkg` targets: `node18-macos-x64`, `node18-win-x64`, `node18-linux-x64`
- For Apple Silicon (arm64) add `node18-macos-arm64` as an optional fourth target
- GUI assets must be listed in `pkg.assets` as `"gui/**/*"` — otherwise they are not embedded
- The binary size will be ~50–80MB per platform (Node.js runtime + deps); this is expected and should be noted in the README

**Status:** `[x] done`

---

## Non-Goals (v1)

- No authentication on the local GUI (localhost-only, trusted environment)
- No retry queue for failed Jira posts (next scheduled run retries implicitly)
- No heuristic matching for re-created nodes (documented limitation)
- No Figma webhook support (cron only in v1)
- No multi-user / team deployment (single-machine tool)
