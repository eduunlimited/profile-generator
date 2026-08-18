# Profile Generator license server

Small HTTP API for online license activation with floating single-device slots.

## Setup

```powershell
cd license-server
npm install
$env:LICENSE_ADMIN_SECRET = "change-me"
$env:PORT = "8787"
npm run dev
```

Deploy this service to Railway, Render, Fly.io, or a VPS. Set:

- `LICENSE_ADMIN_SECRET` — required for admin routes
- `LICENSE_DATA_DIR` — optional SQLite directory (defaults to `./data`)
- `PORT` — listen port

Point release builds at your server:

```powershell
$env:LICENSE_API_URL = "https://your-license-server.example.com"
npm run build:release
```

## Admin CLI

```powershell
cd license-server
$env:LICENSE_ADMIN_SECRET = "change-me"
npm run admin -- create 3
npm run admin -- list
npm run admin -- revoke EPGS-XXXX-XXXX-XXXX
```

## HTTP API

| Route | Auth | Purpose |
|---|---|---|
| `POST /activate` | Public | Activate a license key for this machine |
| `POST /heartbeat` | Session token | Hourly validation |
| `POST /deactivate` | Session token | Free the floating slot |
| `POST /admin/keys` | `x-admin-secret` | Generate keys |
| `GET /admin/keys` | `x-admin-secret` | List keys |
| `POST /admin/revoke` | `x-admin-secret` | Revoke a key |
