import fs from "fs";

const payload = JSON.parse(
  fs.readFileSync(new URL("../.recovery/restore-payload.json", import.meta.url), "utf8"),
);

const script = `
(() => {
  const payload = ${JSON.stringify(payload)};
  if (payload.profiles) localStorage.setItem("profile-generator:profiles", JSON.stringify(payload.profiles));
  if (payload.masters) localStorage.setItem("profile-generator:master-profiles", JSON.stringify(payload.masters));
  if (payload.cats) localStorage.setItem("profile-generator:profile-categories", JSON.stringify(payload.cats));
  location.reload();
  return {
    profiles: Object.keys(JSON.parse(localStorage.getItem("profile-generator:profiles") || "{}")).length,
    masters: Object.keys(JSON.parse(localStorage.getItem("profile-generator:master-profiles") || "{}")).length,
  };
})()
`;

fs.writeFileSync(new URL("../.recovery/restore-browser.js", import.meta.url), script);
console.log("Wrote .recovery/restore-browser.js for browser console");
console.log(`Ready to restore ${Object.keys(payload.profiles ?? {}).length} profiles`);
