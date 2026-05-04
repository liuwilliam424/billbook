# Electron Layer

This folder is the desktop/native side of Billbook.

If you are new to Electron, think of this directory as the part that knows how to be a real app on macOS:

- create windows
- show native folder pickers
- detect app close events
- watch the journal directory on disk
- read and write files

The renderer should not do any of those things directly.

## Files

- `main.js`
  The Electron main process. This is the app supervisor.
- `preload.js`
  The safe bridge that exposes a small API to the renderer.
- `lib/settings-store.js`
  Reads and writes Billbook settings.
- `lib/journal-store.js`
  Handles Markdown parsing, file layout, and save logic.
- `lib/finance-service.js`
  Owns the SimpleFIN integration and generates one-time finance snapshots for new entries.
- `lib/oura-service.js`
  Owns the Oura OAuth flow and generates one-time sleep snapshots for new entries.
- `lib/secure-store.js`
  Stores sensitive local credentials outside the journal files.

## The Electron Mental Model

Billbook uses the standard Electron split:

1. `main process`
   Runs Node.js with full desktop access.
2. `preload`
   Runs before the renderer and exposes a carefully limited API.
3. `renderer`
   Runs the UI and should behave like a normal frontend.

That means the renderer does not import `fs`, `dialog`, or `BrowserWindow`.
Instead, it asks the preload bridge for what it needs.

## What `main.js` Owns

`main.js` should own anything that is truly desktop-specific:

- creating and focusing the app window
- the single-instance lock
- warning before close when there are unsaved changes
- folder chooser dialogs
- IPC handlers
- file watching for external journal changes

It should not contain the actual Markdown serialization logic in detail.
That work belongs in `lib/journal-store.js`.

## What `preload.js` Owns

`preload.js` exists so the renderer can call a tiny, intentional API:

- `settings.get`
- `settings.chooseJournalDirectory`
- `journal.listEntries`
- `journal.readEntry`
- `journal.saveEntry`
- `finance.getStatus`
- `finance.connectFromFile`
- `finance.listAccounts`
- `finance.saveConfig`
- `finance.buildEntrySection`
- `oura.getStatus`
- `oura.saveClientCredentials`
- `oura.connect`
- `oura.buildEntrySection`
- `app.setDirty`
- `app.closeAfterSave`
- `app.onSaveBeforeClose`
- `events.onDirectoryChanged`

In Billbook, the preload file exposes that API as `window.journalApp`.

## Why The Preload Bridge Matters

Without preload, the renderer would either:

- need direct Node access, which is less safe, or
- know too much about Electron internals

The preload bridge keeps the UI code cleaner and easier to replace later.

## Storage Modules

`lib/journal-store.js` is deliberately not a UI file.
It should stay focused on:

- Markdown frontmatter parsing
- parsing and serializing the seven journal sections
- entry file naming
- week-based folder layout
- safe file writes
- entry listing and reading

`lib/settings-store.js` should stay tiny and boring:

- load settings
- save settings
- cache settings in memory

## When To Add Code Here

Add code in `electron/` if the feature needs:

- native app/window behavior
- filesystem access
- an OS dialog
- background watching of local files
- new IPC channels

If the feature is just UI state, rendering, or interaction logic, it probably belongs in `src/app/` instead.

## Adding A New Native Capability

When Billbook needs a new desktop feature, the preferred path is:

1. implement it in `main.js` or `lib/*`
2. expose it through `preload.js`
3. wrap it in `src/app/journal-gateway.js`
4. consume it from the renderer controller

That keeps the Electron boundary narrow and predictable.
