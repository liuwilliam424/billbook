# Billbook

a local-first markdown journal for writing every day

## What It Is

Billbook is a macOS Electron journaling app with an Apple Notes-inspired layout.
Each entry is stored as a real Markdown file in a folder you choose outside the repo.

## Features

- two-pane notes layout
- manual save flow
- warning on close with unsaved changes
- external file change detection
- Markdown-backed entries with simple frontmatter
- entries grouped by year, month, and Monday-based week

## Journal Storage

Billbook stores journal entries outside this repo.
When you open the app, choose any folder you want to use as your journal vault.

Each entry is saved as a Markdown file with a name like:

```text
2026-04-18-a1b2c3d4.md
```

## Local Development

```bash
cd /path/to/billbook
npm install
npm start
```

## Build A Real macOS App

```bash
cd /path/to/billbook
npm install
npm run build:mac
```

This creates:

```text
dist/mac-arm64/Billbook.app
```

## Install Into Applications

After building:

```bash
npm run install:mac
```

That copies the app into:

```text
~/Applications/Billbook.app
```

and asks Spotlight to index it.

## Full Setup On Another Mac

```bash
git clone https://github.com/liuwilliam424/billbook.git
cd billbook
npm install
npm run setup:mac
```

After that, open `Billbook` from `~/Applications` or search for it in Spotlight.

## Notes

- this project currently builds a local `.app` bundle for macOS
- it is ad-hoc signed, not notarized
- the default Electron icon is still in use for now
