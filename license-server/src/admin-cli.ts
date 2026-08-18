import { formatLicenseKey } from "./keys.js";
import { createLicense, listLicenses, revokeLicense } from "./db.js";

const command = process.argv[2];

function usage() {
  console.log(`Usage:
  npm run admin -- create [count]
  npm run admin -- list
  npm run admin -- revoke <license-key>`);
}

if (command === "create") {
  const count = Math.max(1, Number(process.argv[3] ?? 1));
  for (let index = 0; index < count; index += 1) {
    const row = createLicense({ licenseKey: formatLicenseKey() });
    console.log(row.license_key);
  }
  process.exit(0);
}

if (command === "list") {
  const keys = listLicenses();
  for (const row of keys) {
    console.log(
      [
        row.license_key,
        row.status,
        row.active_machine_id ? `machine=${row.active_machine_id.slice(0, 12)}…` : "idle",
        row.last_heartbeat_at ?? "never",
      ].join(" | "),
    );
  }
  process.exit(0);
}

if (command === "revoke") {
  const licenseKey = process.argv[3];
  if (!licenseKey) {
    usage();
    process.exit(1);
  }
  const row = revokeLicense(licenseKey);
  if (!row) {
    console.error("License key not found.");
    process.exit(1);
  }
  console.log(`Revoked ${row.license_key}`);
  process.exit(0);
}

usage();
process.exit(1);
