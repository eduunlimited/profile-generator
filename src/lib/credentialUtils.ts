import { ACCOUNT_SITES, DEFAULT_ACCOUNT_SITE } from "./profileEmailUtils";
import { UNCATEGORIZED_CATEGORY_ID } from "./accountCategoryUtils";
import type { AccountReviewStatus, Credential, ProfileLogin } from "./types";

export type StoredCredential = Credential & { email?: string; username?: string };

function normalizeAccountStatus(value: unknown): AccountReviewStatus {
  return value === "not_good" ? "not_good" : "good";
}

export function normalizeCredential(credential: StoredCredential): Credential {
  const rawSite = credential.site?.trim() || DEFAULT_ACCOUNT_SITE;
  const site = (ACCOUNT_SITES as readonly string[]).includes(rawSite) ? rawSite : rawSite;
  return {
    id: credential.id,
    site,
    username: credential.username?.trim() || credential.email?.trim() || "",
    password: credential.password ?? "",
    categoryId: credential.categoryId?.trim() || UNCATEGORIZED_CATEGORY_ID,
    accountStatus: normalizeAccountStatus(credential.accountStatus),
    notes: credential.notes?.trim() ?? "",
    createdAt: credential.createdAt,
  };
}

export function loginFromCredential(
  credential: Credential,
  profileEmail: string,
  existingId?: string,
): ProfileLogin {
  const email = profileEmail.trim();
  const username = credential.username.trim() || email;
  return {
    id: existingId ?? crypto.randomUUID(),
    label: credential.site,
    username,
    email,
    password: credential.password,
  };
}

export { ACCOUNT_SITES, DEFAULT_ACCOUNT_SITE };
