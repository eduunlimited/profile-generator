import { countProfilesToCreateForFullCardUse, profileSummaryHasPoolCard } from "./assignCards";
import { normalizeUsPhone } from "./phoneUtils";
import { PROFILE_UNCATEGORIZED_CATEGORY_ID } from "./profileCategoryUtils";
import type { CreditCard, ProfileSummary } from "./types";

export type ProfileOpportunityId =
  | "duplicate-address"
  | "duplicate-billing-name"
  | "duplicate-billing-phone"
  | "duplicate-billing-email"
  | "no-card"
  | "unused-cards";

export interface ProfileOpportunity {
  id: ProfileOpportunityId;
  label: string;
  count: number;
  profileIds: string[];
}

function profileCategoryId(profile: ProfileSummary): string {
  return profile.categoryId?.trim() || PROFILE_UNCATEGORIZED_CATEGORY_ID;
}

/** Case-insensitive, whitespace-collapsed, Unicode-normalized field comparison. */
function normalizeComparable(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .normalize("NFKC");
}

function addressDuplicateKey(profile: ProfileSummary): string {
  return normalizeComparable(profile.billingAddressLine1 ?? "");
}

function billingNameDuplicateKey(profile: ProfileSummary): string {
  return normalizeComparable(profile.billingFullName ?? "");
}

function billingEmailDuplicateKey(profile: ProfileSummary): string {
  return normalizeComparable(profile.billingEmail ?? "");
}

function billingPhoneDuplicateKey(profile: ProfileSummary): string {
  const digits = normalizeUsPhone(profile.billingPhone ?? "");
  if (digits.length < 10) return "";
  return digits;
}

function duplicateProfileIdsInCategories(
  profiles: ProfileSummary[],
  valueForProfile: (profile: ProfileSummary) => string,
  minCount = 2,
): string[] {
  const byCategory = new Map<string, ProfileSummary[]>();
  for (const profile of profiles) {
    const categoryId = profileCategoryId(profile);
    const bucket = byCategory.get(categoryId) ?? [];
    bucket.push(profile);
    byCategory.set(categoryId, bucket);
  }

  const duplicateIds = new Set<string>();
  for (const categoryProfiles of byCategory.values()) {
    const buckets = new Map<string, string[]>();
    for (const profile of categoryProfiles) {
      const key = valueForProfile(profile);
      if (!key) continue;
      const ids = buckets.get(key) ?? [];
      ids.push(profile.id);
      buckets.set(key, ids);
    }
    for (const ids of buckets.values()) {
      if (ids.length < minCount) continue;
      ids.forEach((id) => duplicateIds.add(id));
    }
  }

  return [...duplicateIds];
}

export function analyzeProfileOpportunities(
  scopeProfiles: ProfileSummary[],
  allProfiles: ProfileSummary[],
  creditCards: CreditCard[],
): ProfileOpportunity[] {
  const opportunities: ProfileOpportunity[] = [];

  const duplicateAddressIds = duplicateProfileIdsInCategories(scopeProfiles, addressDuplicateKey, 4);
  if (duplicateAddressIds.length > 0) {
    opportunities.push({
      id: "duplicate-address",
      label: "Address line 1 used more than 3 times",
      count: duplicateAddressIds.length,
      profileIds: duplicateAddressIds,
    });
  }

  const duplicateBillingNameIds = duplicateProfileIdsInCategories(
    scopeProfiles,
    billingNameDuplicateKey,
  );
  if (duplicateBillingNameIds.length > 0) {
    opportunities.push({
      id: "duplicate-billing-name",
      label: "Duplicate billing name",
      count: duplicateBillingNameIds.length,
      profileIds: duplicateBillingNameIds,
    });
  }

  const duplicateBillingPhoneIds = duplicateProfileIdsInCategories(
    scopeProfiles,
    billingPhoneDuplicateKey,
  );
  if (duplicateBillingPhoneIds.length > 0) {
    opportunities.push({
      id: "duplicate-billing-phone",
      label: "Duplicate billing phone",
      count: duplicateBillingPhoneIds.length,
      profileIds: duplicateBillingPhoneIds,
    });
  }

  const duplicateBillingEmailIds = duplicateProfileIdsInCategories(
    scopeProfiles,
    billingEmailDuplicateKey,
  );
  if (duplicateBillingEmailIds.length > 0) {
    opportunities.push({
      id: "duplicate-billing-email",
      label: "Duplicate billing email",
      count: duplicateBillingEmailIds.length,
      profileIds: duplicateBillingEmailIds,
    });
  }

  const profilesNeedingCards = scopeProfiles.filter(
    (profile) => !profileSummaryHasPoolCard(profile, creditCards),
  );
  const noCardIds = profilesNeedingCards.map((profile) => profile.id);
  if (noCardIds.length > 0) {
    opportunities.push({
      id: "no-card",
      label: "No card profile",
      count: noCardIds.length,
      profileIds: noCardIds,
    });
  }

  const profilesToCreate = countProfilesToCreateForFullCardUse(
    scopeProfiles,
    creditCards,
    allProfiles,
  );
  if (profilesToCreate > 0) {
    opportunities.push({
      id: "unused-cards",
      label: `Create ${profilesToCreate} more profile${profilesToCreate === 1 ? "" : "s"} to use all cards`,
      count: profilesToCreate,
      profileIds: noCardIds.length > 0 ? noCardIds : scopeProfiles.map((profile) => profile.id),
    });
  }

  return opportunities;
}

export function filterProfilesByOpportunity(
  profiles: ProfileSummary[],
  opportunities: ProfileOpportunity[],
  opportunityId: ProfileOpportunityId | null,
): ProfileSummary[] {
  if (!opportunityId) return profiles;
  const opportunity = opportunities.find((item) => item.id === opportunityId);
  if (!opportunity) return profiles;
  const allowed = new Set(opportunity.profileIds);
  return profiles.filter((profile) => allowed.has(profile.id));
}
