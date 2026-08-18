import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

export type LicenseStatus = "active" | "revoked" | "expired";

export interface LicenseRow {
  license_key: string;
  status: LicenseStatus;
  expires_at: string | null;
  active_machine_id: string | null;
  active_session_token: string | null;
  last_heartbeat_at: string | null;
  created_at: string;
  notes: string | null;
}

const dataDir = process.env.LICENSE_DATA_DIR ?? path.join(process.cwd(), "data");
const dbPath = path.join(dataDir, "licenses.sqlite");

fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS licenses (
    license_key TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'active',
    expires_at TEXT,
    active_machine_id TEXT,
    active_session_token TEXT,
    last_heartbeat_at TEXT,
    created_at TEXT NOT NULL,
    notes TEXT
  );
`);

function nowIso(): string {
  return new Date().toISOString();
}

function isExpired(row: LicenseRow): boolean {
  if (!row.expires_at) {
    return false;
  }
  return new Date(row.expires_at).getTime() <= Date.now();
}

export function getLicense(licenseKey: string): LicenseRow | undefined {
  return db.prepare("SELECT * FROM licenses WHERE license_key = ?").get(licenseKey) as
    | LicenseRow
    | undefined;
}

export function listLicenses(): LicenseRow[] {
  return db.prepare("SELECT * FROM licenses ORDER BY created_at DESC").all() as LicenseRow[];
}

export function createLicense(input: {
  licenseKey: string;
  expiresAt?: string | null;
  notes?: string | null;
}): LicenseRow {
  const row: LicenseRow = {
    license_key: input.licenseKey,
    status: "active",
    expires_at: input.expiresAt ?? null,
    active_machine_id: null,
    active_session_token: null,
    last_heartbeat_at: null,
    created_at: nowIso(),
    notes: input.notes ?? null,
  };
  db.prepare(
    `INSERT INTO licenses (
      license_key, status, expires_at, active_machine_id, active_session_token,
      last_heartbeat_at, created_at, notes
    ) VALUES (
      @license_key, @status, @expires_at, @active_machine_id, @active_session_token,
      @last_heartbeat_at, @created_at, @notes
    )`,
  ).run(row);
  return row;
}

export function revokeLicense(licenseKey: string): LicenseRow | undefined {
  const existing = getLicense(licenseKey);
  if (!existing) {
    return undefined;
  }
  db.prepare(
    `UPDATE licenses
     SET status = 'revoked', active_machine_id = NULL, active_session_token = NULL
     WHERE license_key = ?`,
  ).run(licenseKey);
  return getLicense(licenseKey);
}

export function activateLicense(input: {
  licenseKey: string;
  machineId: string;
  sessionToken: string;
}): { ok: true; row: LicenseRow } | { ok: false; status: string; message: string } {
  const row = getLicense(input.licenseKey);
  if (!row) {
    return { ok: false, status: "invalid", message: "License key not found." };
  }
  if (row.status === "revoked") {
    return { ok: false, status: "revoked", message: "This license key has been revoked." };
  }
  if (isExpired(row)) {
    db.prepare("UPDATE licenses SET status = 'expired' WHERE license_key = ?").run(input.licenseKey);
    return { ok: false, status: "expired", message: "This license key has expired." };
  }

  db.prepare(
    `UPDATE licenses
     SET status = 'active',
         active_machine_id = ?,
         active_session_token = ?,
         last_heartbeat_at = ?
     WHERE license_key = ?`,
  ).run(input.machineId, input.sessionToken, nowIso(), input.licenseKey);

  const updated = getLicense(input.licenseKey);
  if (!updated) {
    return { ok: false, status: "invalid", message: "License key not found." };
  }
  return { ok: true, row: updated };
}

export function heartbeatLicense(input: {
  sessionToken: string;
  machineId: string;
}): { ok: true; row: LicenseRow } | { ok: false; status: string; message: string } {
  const row = db
    .prepare("SELECT * FROM licenses WHERE active_session_token = ?")
    .get(input.sessionToken) as LicenseRow | undefined;

  if (!row) {
    return { ok: false, status: "invalid", message: "Session not found." };
  }
  if (row.status === "revoked") {
    return { ok: false, status: "revoked", message: "This license key has been revoked." };
  }
  if (isExpired(row)) {
    db.prepare("UPDATE licenses SET status = 'expired' WHERE license_key = ?").run(row.license_key);
    return { ok: false, status: "expired", message: "This license key has expired." };
  }
  if (row.active_machine_id !== input.machineId || row.active_session_token !== input.sessionToken) {
    return {
      ok: false,
      status: "superseded",
      message: "License in use on another device.",
    };
  }

  db.prepare("UPDATE licenses SET last_heartbeat_at = ? WHERE license_key = ?").run(
    nowIso(),
    row.license_key,
  );

  const updated = getLicense(row.license_key);
  if (!updated) {
    return { ok: false, status: "invalid", message: "Session not found." };
  }
  return { ok: true, row: updated };
}

export function deactivateLicense(input: {
  sessionToken: string;
  machineId: string;
}): { ok: boolean; message: string } {
  const row = db
    .prepare("SELECT * FROM licenses WHERE active_session_token = ?")
    .get(input.sessionToken) as LicenseRow | undefined;
  if (!row || row.active_machine_id !== input.machineId) {
    return { ok: false, message: "Session not found." };
  }
  db.prepare(
    `UPDATE licenses
     SET active_machine_id = NULL, active_session_token = NULL
     WHERE license_key = ?`,
  ).run(row.license_key);
  return { ok: true, message: "License deactivated." };
}
