import { resolveProfileEmail } from "./profileEmailUtils";
import { syncProfileCredentials } from "./profileUtils";
import type { Credential, Profile, ProfileSummary } from "./types";

export function normalizeEmailForMatch(email: string): string {
  return email.trim().toLowerCase();
}

/** Account pool email — stored on credential username. */
export function credentialLoginEmail(credential: Credential): string {
  return credential.username.trim();
}

export function profileEmailForMatch(profile: Profile | ProfileSummary): string {
  if ("logins" in profile) {
    return normalizeEmailForMatch(resolveProfileEmail(profile));
  }
  return normalizeEmailForMatch(profile.email ?? "");
}

export function profileAccountSite(profile: Profile | ProfileSummary): string {
  return profile.accountSite?.trim() ?? "";
}

function inferAccountSiteFromProfile(profile: Profile, credentials: Credential[]): string {
  if (profile.accountSite?.trim()) {
    return profile.accountSite.trim();
  }
  if (profile.credentialIds?.length === 1) {
    const credential = credentials.find((item) => item.id === profile.credentialIds![0]);
    if (credential) return credential.site;
  }
  if (profile.logins?.length === 1) {
    return profile.logins[0].label.trim();
  }
  return "";
}

export function matchingCredentialForProfile(
  profile: Profile,
  credentials: Credential[],
): Credential | null {
  const site = profile.accountSite?.trim();
  if (!site) return null;

  const profileEmail = profileEmailForMatch(profile);
  if (!profileEmail) return null;

  return (
    credentials.find(
      (credential) =>
        credential.site === site &&
        normalizeEmailForMatch(credentialLoginEmail(credential)) === profileEmail,
    ) ?? null
  );
}

export function profileMatchesCredential(
  profile: Profile | ProfileSummary,
  credential: Credential,
): boolean {
  const site = profileAccountSite(profile);
  if (!site || credential.site !== site) {
    return false;
  }
  const profileEmail = profileEmailForMatch(profile);
  const credEmail = normalizeEmailForMatch(credentialLoginEmail(credential));
  return profileEmail.length > 0 && credEmail.length > 0 && profileEmail === credEmail;
}

export function matchingCredentialIds(profile: Profile, credentials: Credential[]): string[] {
  const match = matchingCredentialForProfile(profile, credentials);
  return match ? [match.id] : [];
}

export function credentialLinksChanged(before: Profile, after: Profile): boolean {
  const beforeIds = [...(before.credentialIds ?? [])].sort().join(",");
  const afterIds = [...(after.credentialIds ?? [])].sort().join(",");
  return (
    beforeIds !== afterIds || profileAccountSite(before) !== profileAccountSite(after)
  );
}

function resolveAccountSite(profile: Profile, credentials: Credential[]): string {
  if (profile.accountSite !== undefined) {
    return profile.accountSite.trim();
  }
  return inferAccountSiteFromProfile(profile, credentials);
}

export function syncProfileCredentialLinks(profile: Profile, credentials: Credential[]): Profile {
  const accountSite = resolveAccountSite(profile, credentials);

  const base: Profile = accountSite ? { ...profile, accountSite } : { ...profile, accountSite: "" };

  if (!accountSite) {
    return {
      ...base,
      credentialIds: [],
    };
  }

  const match = matchingCredentialForProfile(base, credentials);
  const ids = match ? [match.id] : [];
  const synced = syncProfileCredentials(base, ids, credentials);

  return {
    ...synced,
    accountSite,
    logins: synced.logins.filter((login) => login.label === accountSite),
  };
}

export function syncAllProfileCredentialLinks(
  profiles: Profile[],
  credentials: Credential[],
): Profile[] {
  return profiles.map((profile) => syncProfileCredentialLinks(profile, credentials));
}

export function profilesMatchingCredential(
  credential: Credential,
  profiles: ProfileSummary[],
): ProfileSummary[] {
  return profiles.filter((profile) => profileMatchesCredential(profile, credential));
}
