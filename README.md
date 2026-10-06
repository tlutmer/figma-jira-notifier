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
