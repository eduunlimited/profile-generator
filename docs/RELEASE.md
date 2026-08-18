# Release / distribution

## Build the shareable Windows installer

```powershell
cd C:\Users\edu_u\Projects\profile-generator
npm ci

# Point release builds at your hosted license server
$env:LICENSE_API_URL = "https://your-license-server.example.com"

# Optional: Tauri updater signing (generate once with `npx tauri signer generate`)
# $env:TAURI_SIGNING_PRIVATE_KEY = Get-Content "$env:USERPROFILE\.tauri\profile-generator.key" -Raw

npm run build:release
```

Output:

- `src-tauri/target/release/bundle/nsis/Profile Generator_*_x64-setup.exe` — share this installer
- Updater artifacts (`*.sig`, zip bundles) when signing is configured

The release build bundles:

- Profile Generator UI + Rust backend
- Camoufox launcher scripts
- Portable Python + Camoufox browser under `resources/python-win/`

Recipients only need the installer. Proxies are still user-provided.

## License server

See [`license-server/README.md`](license-server/README.md). Generate keys with the admin CLI, then distribute codes to users. The desktop app validates online every hour and on startup.

Development skips licensing unless you set:

```powershell
$env:EPGS_REQUIRE_LICENSE = "1"
$env:LICENSE_API_URL = "http://127.0.0.1:8787"
npm run dev:app
```

## OTA updates

Release tags like `v0.2.8` trigger [`.github/workflows/release.yml`](.github/workflows/release.yml), which uploads:

- NSIS installer + signatures
- `latest.json` for the Tauri updater

Installed apps check for updates on startup and every hour.

Configure GitHub repository variables/secrets:

- `LICENSE_API_URL` (repository variable)
- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (if used)

Update `plugins.updater.pubkey` in [`src-tauri/tauri.conf.json`](src-tauri/tauri.conf.json) with the public key from `npx tauri signer generate`.

## Smoke test checklist

On a clean Windows VM without Python installed:

1. Install from `Profile Generator_*_setup.exe`
2. Activate with a license key from the license server
3. Generate/import profiles
4. Configure proxy pool, test proxy, open Browser Session
5. Close and reopen session to confirm cookies persist
6. Publish a newer tag and confirm the in-app update prompt appears
