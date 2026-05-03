# Renderer Architecture

This folder is the frontend application that runs inside Billbook's Electron window.

The renderer is intentionally split into three kinds of modules:

1. `controller`
   Coordinates workflows and owns app state.
2. `pure logic`
   Computes derived values and transforms data without touching the DOM.
3. `presentation`
   Reads or writes DOM nodes and renders UI.

## File Roles

- `app-controller.js`
  The main workflow layer. It responds to user actions, coordinates loading and saving, and decides when to re-render.
- `journal-gateway.js`
  The renderer's adapter over `window.journalApp`. This is the only file in `src/app/` that should know the raw preload API shape.
- `state.js`
  Initial app state object.
- `view-state.js`
  Derived editor modes such as `no-folder`, `missing-folder`, `no-selection`, and `editor`.
- `entry-tree.js`
  Pure transformation from a flat entry array into the nested sidebar grouping structure.
- `utils.js`
  Shared pure helpers.
- `prompts.js`
  Defines the fixed daily prompt schema used by the editor and draft snapshots.
- `render.js`
  Top-level renderer for editor chrome and screen states.
- `sidebar.js`
  Sidebar DOM rendering.
- `dom.js`
  Centralizes DOM element lookups.

## The Main Separation Rule

When deciding where code should go, use this rule:

- if it changes app state or coordinates a workflow, it belongs in `app-controller.js`
- if it transforms plain data, it belongs in a pure helper module
- if it writes to the DOM, it belongs in a render module
- if it talks to Electron, it belongs in `journal-gateway.js`

That means `app-controller.js` should read more like "what the app does",
while `render.js` and `sidebar.js` should read more like "what the app looks like."

## Why `journal-gateway.js` Exists

Without the gateway, the controller would have to know this shape directly:

```js
window.journalApp.settings.get()
window.journalApp.journal.saveEntry(...)
window.journalApp.events.onDirectoryChanged(...)
```

That couples the UI logic tightly to Electron.

Instead, the controller now depends on a simpler interface:

```js
gateway.loadSettings()
gateway.saveEntry(entry)
gateway.onDirectoryChanged(callback)
```

This keeps the controller easier to read and easier to test conceptually.

## Current Frontend Data Flow

Typical renderer flow:

1. A user clicks a button or types in a field.
2. `app-controller.js` updates in-memory state.
3. The controller asks the gateway to talk to Electron when needed.
4. The controller calls `renderApp`, `renderChrome`, or `renderEditor`.
5. The render layer updates the DOM.

## What Counts As Pure Logic Here

These modules should stay DOM-free:

- `state.js`
- `view-state.js`
- `entry-tree.js`
- most of `utils.js`

That makes them the easiest files to understand and evolve.

## Where To Add New Features

Examples:

- Add a new native file operation:
  Start in `electron/`, then expose it through `journal-gateway.js`.
- Change the daily prompt structure:
  Update `prompts.js`, then adjust the journal store serialization and editor markup together.
- Add a new editor banner or visual state:
  Put rendering in `render.js`, with any derived mode logic in `view-state.js`.
- Add a new sidebar grouping rule:
  Put the transformation in `entry-tree.js`, then render it in `sidebar.js`.
- Add a new interaction flow:
  Put the orchestration in `app-controller.js`.

## Future Cleanup Direction

If Billbook grows a lot more, the next natural split would be:

- a dedicated draft/editing module
- a dedicated external-conflict module
- a dedicated dialog service

For now, the current structure is intentionally small enough to stay approachable.
