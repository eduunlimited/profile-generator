import packageJson from "../../package.json";

/** Full semver from package.json — bump patch/minor there on each release. */
export const APP_VERSION_SEMVER = packageJson.version;

/** UI label, e.g. 0.2.3 → v0.2.3 */
export const APP_VERSION = `v${APP_VERSION_SEMVER}`;
