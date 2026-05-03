# AGENTS.md

This file is for future coding agents working in this repository.

## Project

This repo is `billbook`, a local-first Electron journaling app for macOS.

Important high-level facts:

- The app code lives in this repo.
- Journal data does not live in this repo.
- The source of truth for journal entries is Markdown files in a user-selected folder outside the repo.
- The installed app the user actually opens is usually:
  - `~/Applications/Billbook.app`

## Architecture

Billbook is split into three layers:

1. `electron/`
   Native desktop layer. Owns windows, dialogs, file watching, and filesystem access.
2. `electron/preload.js`
   Safe bridge that exposes a narrow API to the renderer as `window.journalApp`.
3. `src/`
   Renderer/frontend layer.

Current renderer separation rules:

- `src/app/journal-gateway.js`
  The only frontend module that should know the raw preload API shape.
- `src/app/app-controller.js`
  Workflow and state coordination.
- `src/app/render.js`, `src/app/sidebar.js`, `src/app/dom.js`
  DOM and presentation logic.
- `src/app/entry-tree.js`, `src/app/view-state.js`, `src/app/utils.js`
  Pure or mostly pure data logic.

If a new feature touches Electron, dialogs, Finder, filesystem access, or app windows, it belongs in `electron/` first and should then be exposed through preload and the journal gateway.

## Build And Install Workflow

This repo has an important local-app workflow:

- `npm start`
  Runs the app in development.
- `npm run build:mac`
  Builds the `.app` bundle into `dist/mac-arm64/Billbook.app`
- `npm run install:mac`
  Installs the built app into `~/Applications/Billbook.app`
- `npm run setup:mac`
  Build + install in one command

## Rebuild Policy

Future agents should assume the user cares about the installed app, not just the source tree.

So:

- After any runtime behavior change, UI change, Electron change, preload change, CSS change, renderer change, or packaging-related change, run:
  - `npm run setup:mac`
- After that, prefer a quick sanity check that the installed app launches.

You can usually skip rebuilding only when the change is clearly non-runtime, for example:

- docs only
- `AGENTS.md` only
- README-only architecture notes

If you skip rebuilding, say that explicitly in the final response.

## Verification Expectations

For code changes, prefer this pattern:

1. Run fast syntax or import checks where reasonable.
2. Run `npm run setup:mac` unless the change is docs-only.
3. If practical, confirm the installed app launches.

Common checks:

- `node --check electron/main.js`
- `node --input-type=module --eval "await import('file:///.../src/app/app-controller.js')"`

## Git And Push Norms

This repo is used for frequent daily commits.

When making a real repo change:

- make the change cleanly
- verify it
- commit it with a meaningful message
- push it unless the user asks not to

Remote:

- `origin` -> `https://github.com/liuwilliam424/billbook.git`

## UI Direction

The user prefers:

- plain, utilitarian, editorial-feeling design
- not flashy SaaS styling
- not overly modern-minimal tech-brand aesthetics
- clean hierarchy, strong typography, quiet colors

When in doubt:

- prefer sober over clever
- prefer desk-tool over startup-app
- prefer restrained over decorative

## Journal Model

Key product rules:

- One entry = one Markdown file
- Filename format is `YYYY-MM-DD-randomslug.md`
- Entry metadata is stored in frontmatter
- Weeks start on Monday
- UI grouping is `year -> month -> week`
- Week grouping can cross calendar month/year boundaries by design
- Missing journal folders should not be silently recreated on startup

## Persistence

App settings are stored by Electron in:

- `~/Library/Application Support/Billbook/settings.json`

That file currently stores the selected `journalDirectory`.

Unsaved drafts are not durable unless explicitly implemented later.

## Finder / Local Integration

The folder name in the sidebar opens the selected journal folder in Finder.
If this behavior changes, keep the Electron/preload/gateway boundary clean rather than calling native behavior directly from renderer code.
