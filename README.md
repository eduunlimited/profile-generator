# Profile Generator

Local Windows desktop app for generating synthetic QA profiles with names, addresses, test credit cards, and logins.

## Features

- Generate single or bulk synthetic profiles
- Apply jig presets to transform names and addresses for edge-case testing
- Edit and save profiles locally in SQLite
- Export to JSON, JSON Lines, CSV, TSV, YAML, XML, plain text, or custom templates
- Copy individual fields to clipboard

## Prerequisites

- Node.js 20+
- Rust (via [rustup](https://rustup.rs/))
- Visual Studio Build Tools with C++ workload (Windows)

## Development

### Fast UI iteration (recommended while designing)

```powershell
cd C:\Users\edu_u\Projects\profile-generator
npm run dev:ui
```

Open **http://localhost:1420/** in your browser. Changes to React/CSS reload instantly via Vite HMR — no Rust compile, no app restart.

Data is stored in **localStorage** in this mode.

### Full desktop app (Tauri shell)

```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
npm run dev:app
```

Use this when you need the native window, SQLite storage, or file save dialogs.

## Build Windows executable

```powershell
npm run tauri build
```

The installer and `.exe` are written under `src-tauri/target/release/bundle/`.

## Notes

- All payment data uses Luhn-valid **test card numbers only**
- Data is stored locally under your app data directory
- Intended for QA and development testing only
