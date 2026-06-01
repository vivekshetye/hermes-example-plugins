# kanban-artifacts

Dashboard plugin for browsing and previewing output files from Hermes Kanban task workspaces.

## What it does

Adds a **Kanban Artifacts** tab to the Hermes dashboard (positioned after the built-in Kanban tab). Users can:

- Browse boards and tasks from the Kanban system
- Explore artifact files in each task's workspace (`~/.hermes/kanban/workspaces/`)
- Preview text, code, markdown, images, and other common file types inline
- Download raw files with streaming support (50 MB cap)

## Security

- All API routes require a valid session token (`X-Hermes-Session-Token` or `Authorization: Bearer`)
- Path traversal is blocked — only `~/.hermes/kanban/workspaces/` and `~/.hermes/kanban/boards/` are accessible
- Files larger than 50 MB cannot be served via `/raw`
- SQL injection is prevented with parameterized queries
- Markdown content is HTML-escaped before rendering to prevent XSS

## File structure

```
kanban-artifacts/dashboard/
  manifest.json    — Dashboard plugin manifest (tab, icon, entry point, API file)
  plugin_api.py    — FastAPI backend (list boards/tasks/files, serve raw files)
  index.js         — React frontend source
  dist/
    index.js       — Built frontend bundle
    style.css      — Styles
```

## Installing

Copy the `kanban-artifacts/` directory to:

```
~/.hermes/plugins/kanban-artifacts/dashboard/
```

The plugin is auto-discovered by the Hermes dashboard on next startup.

## Reference

- [Hermes Plugin Proposal #8994](https://github.com/NousResearch/hermes-agent/issues/8994)
- Tracking issue: [Proposal: kanban-artifacts #32473](https://github.com/NousResearch/hermes-agent/issues/32473)