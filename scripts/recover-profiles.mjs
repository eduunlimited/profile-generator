import fs from "fs";

const ldbPath =
  process.env.LDB_PATH ??
  "C:/Users/edu_u/AppData/Roaming/Cursor/Partitions/cursor-browser/Local Storage/leveldb/000024.ldb";

const raw = fs.readFileSync(ldbPath);
const text = raw.toString("utf8");
const profiles = {};

let idx = 0;
while (idx < text.length) {
  const marker = text.indexOf('"profileName"', idx);
  if (marker < 0) break;

  let start = marker;
  while (start > 0 && text[start] !== "{") start -= 1;

  let depth = 0;
  let end = start;
  for (let i = start; i < text.length; i += 1) {
    if (text[i] === "{") depth += 1;
    if (text[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }

  try {
    const obj = JSON.parse(text.slice(start, end));
    if (obj.id && obj.profileName) {
      profiles[obj.id] = obj;
    }
  } catch {
    // skip corrupt fragments
  }

  idx = marker + 13;
}

const outPath = new URL("../restore-payload.json", import.meta.url);
fs.writeFileSync(outPath, JSON.stringify({ profiles }, null, 2));
console.log(`extracted ${Object.keys(profiles).length} profiles`);
for (const profile of Object.values(profiles)) {
  console.log(`- ${profile.profileName}`);
}
