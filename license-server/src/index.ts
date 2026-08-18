import express from "express";
import { randomBytes } from "node:crypto";
import {
  activateLicense,
  createLicense,
  deactivateLicense,
  heartbeatLicense,
  listLicenses,
  revokeLicense,
} from "./db.js";
import { formatLicenseKey } from "./keys.js";

const app = express();
const port = Number(process.env.PORT ?? 8787);
const adminSecret = process.env.LICENSE_ADMIN_SECRET ?? "";

app.use(express.json());

function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!adminSecret) {
    res.status(503).json({ ok: false, message: "LICENSE_ADMIN_SECRET is not configured." });
    return;
  }
  const header = req.header("x-admin-secret");
  if (header !== adminSecret) {
    res.status(401).json({ ok: false, message: "Unauthorized." });
    return;
  }
  next();
}

function newSessionToken(): string {
  return randomBytes(32).toString("hex");
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "profile-generator-license-server" });
});

app.post("/activate", (req, res) => {
  const licenseKey = String(req.body?.licenseKey ?? req.body?.license_key ?? "").trim();
  const machineId = String(req.body?.machineId ?? req.body?.machine_id ?? "").trim();
  if (!licenseKey || !machineId) {
    res.status(400).json({ ok: false, status: "invalid", message: "Missing license key or machine id." });
    return;
  }

  const result = activateLicense({
    licenseKey,
    machineId,
    sessionToken: newSessionToken(),
  });

  if (!result.ok) {
    res.status(403).json({
      ok: false,
      status: result.status,
      message: result.message,
    });
    return;
  }

  res.json({
    ok: true,
    status: "active",
    message: "License activated.",
    sessionToken: result.row.active_session_token,
    licenseKey: result.row.license_key,
  });
});

app.post("/heartbeat", (req, res) => {
  const sessionToken = String(req.body?.sessionToken ?? req.body?.session_token ?? "").trim();
  const machineId = String(req.body?.machineId ?? req.body?.machine_id ?? "").trim();
  if (!sessionToken || !machineId) {
    res.status(400).json({ ok: false, status: "invalid", message: "Missing session token or machine id." });
    return;
  }

  const result = heartbeatLicense({ sessionToken, machineId });
  if (!result.ok) {
    res.status(403).json({
      ok: false,
      status: result.status,
      message: result.message,
    });
    return;
  }

  res.json({
    ok: true,
    status: "active",
    message: "License valid.",
    licenseKey: result.row.license_key,
  });
});

app.post("/deactivate", (req, res) => {
  const sessionToken = String(req.body?.sessionToken ?? req.body?.session_token ?? "").trim();
  const machineId = String(req.body?.machineId ?? req.body?.machine_id ?? "").trim();
  if (!sessionToken || !machineId) {
    res.status(400).json({ ok: false, message: "Missing session token or machine id." });
    return;
  }
  const result = deactivateLicense({ sessionToken, machineId });
  res.json(result);
});

app.post("/admin/keys", requireAdmin, (req, res) => {
  const count = Math.max(1, Math.min(50, Number(req.body?.count ?? 1)));
  const expiresAt = req.body?.expiresAt ?? req.body?.expires_at ?? null;
  const notes = req.body?.notes ?? null;
  const keys = Array.from({ length: count }, () =>
    createLicense({
      licenseKey: formatLicenseKey(),
      expiresAt,
      notes,
    }),
  );
  res.json({ ok: true, keys });
});

app.get("/admin/keys", requireAdmin, (_req, res) => {
  res.json({ ok: true, keys: listLicenses() });
});

app.post("/admin/revoke", requireAdmin, (req, res) => {
  const licenseKey = String(req.body?.licenseKey ?? req.body?.license_key ?? "").trim();
  if (!licenseKey) {
    res.status(400).json({ ok: false, message: "Missing license key." });
    return;
  }
  const row = revokeLicense(licenseKey);
  if (!row) {
    res.status(404).json({ ok: false, message: "License key not found." });
    return;
  }
  res.json({ ok: true, key: row });
});

app.listen(port, () => {
  console.log(`License server listening on http://127.0.0.1:${port}`);
});
