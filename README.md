# Figma → Jira Notifier

A cross-platform tool that monitors Figma files for design changes and posts structured changelog comments to linked Jira tickets, @mentioning your frontend development team.

## Configuration GUI

**[https://tlutmer.github.io/figma-jira-notifier/](https://tlutmer.github.io/figma-jira-notifier/)**

The hosted GUI is the full interactive configuration interface. Use it to:

- Add, edit, and remove Figma → Jira project mappings
- Configure your Figma personal access token, Jira base URL, email, and API token
- Set the cron schedule for automated diff runs
- Paste a full Figma URL (file key is extracted automatically) and a full Jira ticket URL or bare key
- Configure @mention recipients per project

All configuration is persisted in your browser's `localStorage` and survives page refreshes — no account or server required.

## Features

- 🌐 Hosted GUI — configure from any browser, no install needed
- 🔄 Scheduled (cron) or on-demand diff runs
- 📐 Structured ADF changelog comments posted to Jira
- 👥 @mentions configured frontend developers on each notification
- 📦 Single self-contained binary — no Node.js or npm required on target machines

## Running (from source)

```bash
npm install
npm start
```

## Building Binaries

```bash
npm install
npm run build
```

Produces four binaries in `dist/`:

| File | Platform |
|---|---|
| `figma-jira-notifier-macos` | macOS Intel (x64) |
| `figma-jira-notifier-macos-arm64` | macOS Apple Silicon |
| `figma-jira-notifier-win.exe` | Windows x64 |
| `figma-jira-notifier-linux` | Fedora / Linux x64 |

## Running a Binary

### macOS / Linux

```bash
chmod +x ./figma-jira-notifier-macos   # or -linux
./figma-jira-notifier-macos
```

### Windows

Double-click `figma-jira-notifier-win.exe` or run from a terminal:

```cmd
figma-jira-notifier-win.exe
```

## Scheduling

The tool runs the diff on the schedule configured in the GUI (default: `0 8 * * *` = 8 AM daily). The scheduler starts automatically when the binary is running. To keep it running continuously, register it as a system service:

### macOS — launchd

Create `~/Library/LaunchAgents/com.figma-jira-notifier.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.figma-jira-notifier</string>
  <key>ProgramArguments</key>
  <array>
    <string>/path/to/figma-jira-notifier-macos</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
</dict>
</plist>
```

```bash
launchctl load ~/Library/LaunchAgents/com.figma-jira-notifier.plist
```

### Fedora — systemd

Create `/etc/systemd/system/figma-jira-notifier.service`:

```ini
[Unit]
Description=Figma Jira Notifier
After=network.target

[Service]
ExecStart=/path/to/figma-jira-notifier-linux
Restart=always
User=youruser

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now figma-jira-notifier
```

### Windows — Task Scheduler

1. Open **Task Scheduler** → **Create Basic Task**
2. Set trigger: **At system startup**
3. Action: **Start a program** → select `figma-jira-notifier-win.exe`
4. Check **Run whether user is logged on or not**

## Deployment

The hosted GUI is deployed automatically via `.github/workflows/pages.yml` on every push to `main`.

## Known Limitations

- If a Figma node is detached and re-created, it receives a new ID and will appear as "removed + added" rather than "updated". This is a Figma API limitation.
- If the binary is down across multiple scheduled runs, the next run will produce a single large diff covering all missed changes.
- Configuration is stored in your browser's `localStorage` — it will not sync across devices automatically.
