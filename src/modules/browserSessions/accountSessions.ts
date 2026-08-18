import { profilesMatchingCredential } from "../../lib/linkCredentialsByEmail";
import { formatLinkedProfileNames } from "../../lib/profileNameUtils";
import type { Credential, ProfileSummary } from "../../lib/types";

export interface AccountSessionContext {
  credential: Credential;
  linkedProfiles: ProfileSummary[];
  timezoneHint?: string;
}

export function buildAccountSessionContext(
  credential: Credential,
  profiles: ProfileSummary[],
): AccountSessionContext {
  const linkedProfiles = profilesMatchingCredential(credential, profiles);
  return {
    credential,
    linkedProfiles,
    timezoneHint: linkedProfiles[0]?.state,
  };
}

export function formatLinkedProfilesForAccount(
  credential: Credential,
  profiles: ProfileSummary[],
): string {
  const linked = profilesMatchingCredential(credential, profiles);
  if (linked.length === 0) {
    return "—";
  }
  return formatLinkedProfileNames(linked.map((profile) => profile.name));
}

export function buildAccountSessionLabel(credential: Credential): string {
  const site = credential.site.trim() || "account";
  const user = credential.username.trim().split("@")[0] || credential.username.trim() || "user";
  return `${site}-${user}`.slice(0, 48);
}
