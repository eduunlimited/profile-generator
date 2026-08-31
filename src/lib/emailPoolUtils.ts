import type { AccountReviewStatus, CardAssignmentScope, PoolEmail, Profile, ProfileSummary } from "./types";
import { EMAIL_UNCATEGORIZED_CATEGORY_ID } from "./emailCategoryUtils";
import { resolveProfileEmail } from "./profileEmailUtils";

export type StoredPoolEmail = {
  id: string;
  email: string;
  categoryId?: string;
  accountStatus?: AccountReviewStatus;
  assignmentScope?: CardAssignmentScope;
  notes?: string;
  createdAt: string;
};

export function emailsMatch(left: string, right: string): boolean {
  const a = left.trim().toLowerCase();
  const b = right.trim().toLowerCase();
  return a.length > 0 && a === b;
}

export function normalizePoolEmailAddress(value: string): string {
  return value.trim();
}

function normalizeReviewStatus(value: unknown): AccountReviewStatus {
  return value === "not_good" ? "not_good" : "good";
}

function normalizeAssignmentScope(value: unknown): CardAssignmentScope {
  return value === "single_profile" ? "single_profile" : "account_group";
}

/** Pool emails marked "Not good" cannot be assigned to profiles. */
export function isAssignablePoolEmail(email: Pick<PoolEmail, "accountStatus">): boolean {
  return email.accountStatus !== "not_good";
}

export function filterAssignablePoolEmails(emails: PoolEmail[]): PoolEmail[] {
  return emails.filter(isAssignablePoolEmail);
}

export function normalizePoolEmail(email: StoredPoolEmail): PoolEmail {
  return {
    id: email.id,
    email: normalizePoolEmailAddress(email.email),
    categoryId: email.categoryId?.trim() || EMAIL_UNCATEGORIZED_CATEGORY_ID,
    accountStatus: normalizeReviewStatus(email.accountStatus),
    assignmentScope: normalizeAssignmentScope(email.assignmentScope),
    notes: email.notes?.trim() ?? "",
    createdAt: email.createdAt,
  };
}

export function findPoolEmailByAddress(address: string, emails: PoolEmail[]): PoolEmail | undefined {
  const trimmed = address.trim();
  if (!trimmed) return undefined;
  return emails.find((item) => emailsMatch(item.email, trimmed));
}

export function profilesMatchingEmail(email: PoolEmail, profiles: ProfileSummary[]): ProfileSummary[] {
  return profiles.filter((profile) => {
    if (profile.emailPoolId === email.id) {
      return true;
    }
    if (profile.email && emailsMatch(profile.email, email.email)) {
      return true;
    }
    return false;
  });
}

export function profileHasPoolEmail(
  profile: Pick<Profile, "emailPoolId" | "email" | "logins">,
): boolean {
  if (profile.emailPoolId) {
    return true;
  }
  return resolveProfileEmail(profile as Profile).trim().length > 0;
}

export function profileSummaryHasAssignedEmail(
  profile: Pick<ProfileSummary, "emailPoolId" | "email">,
): boolean {
  return Boolean(profile.emailPoolId || profile.email?.trim());
}
