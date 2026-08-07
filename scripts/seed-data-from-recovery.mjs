import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.join(root, "data");
const recoveryPath = path.join(root, ".recovery", "restore-payload.json");

function writeJson(name, value) {
  fs.mkdirSync(dataDir, { recursive: true });
  const target = path.join(dataDir, name);
  if (fs.existsSync(target) && Object.keys(JSON.parse(fs.readFileSync(target, "utf8"))).length > 0) {
    console.log(`Skipped ${name} (already has data)`);
    return;
  }
  fs.writeFileSync(target, JSON.stringify(value, null, 2), "utf8");
  console.log(`Wrote ${name}`);
}

if (!fs.existsSync(recoveryPath)) {
  console.log("No recovery payload found; skipping seed.");
  process.exit(0);
}

const payload = JSON.parse(fs.readFileSync(recoveryPath, "utf8"));
writeJson("profiles.json", payload.profiles ?? {});
writeJson("master-profiles.json", payload.masters ?? {});
writeJson("profile-categories.json", payload.cats ?? {});
