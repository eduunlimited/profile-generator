import { applyEmailFromPool, clearProfileEmailAssignment } from "./profileUtils";
import { emailsMatch, isAssignablePoolEmail } from "./emailPoolUtils";
import { resolveProfileEmail } from "./profileEmailUtils";
import { profileCategoryId } from "./profileCategoryUtils";
import type { AssignEmailsOptions, PoolEmail, Profile, ProfileSummary } from "./types";

export function profileSummaryHasPoolEmail(
  profile: Pick<ProfileSummary, "emailPoolId" | "email">,
  emails: PoolEmail[],
): boolean {
  if (profile.emailPoolId) {
    return true;
  }
  const address = profile.email ?? "";
  if (address && emails.some((email) => emailsMatch(email.email, address))) {
    return true;
  }
  return false;
}

/** True when the profile has pool-linked or standalone email data (for unassign / display). */
export function profileSummaryHasAssignedEmail(
  profile: Pick<ProfileSummary, "emailPoolId" | "email">,
): boolean {
  return Boolean(profile.emailPoolId || profile.email?.trim());
}

type EmailAssignableProfile = {
  id: string;
  name: string;
  emailPoolId?: string;
  email?: string;
  categoryId?: string;
};

export type { EmailAssignableProfile };

export function toEmailAssignableProfile(profile: ProfileSummary | Profile): EmailAssignableProfile {
  if ("logins" in profile) {
    return {
      id: profile.id,
      name: profile.profileName?.trim() || profile.name.full || "Unnamed",
      emailPoolId: profile.emailPoolId,
      email: resolveProfileEmail(profile),
      categoryId: profileCategoryId(profile),
    };
  }
  return {
    id: profile.id,
    name: profile.name || "Unnamed",
    emailPoolId: profile.emailPoolId,
    email: profile.email,
    categoryId: profileCategoryId(profile),
  };
}

export function toEmailAssignableProfiles(
  profiles: (ProfileSummary | Profile)[],
): EmailAssignableProfile[] {
  return profiles.map(toEmailAssignableProfile);
}

export function emailUsesSingleProfileScope(email: Pick<PoolEmail, "assignmentScope">): boolean {
  return email.assignmentScope === "single_profile";
}

function assignmentConflicts(
  email: Pick<PoolEmail, "assignmentScope">,
  holder: { id: string; categoryId?: string },
  incoming: { id: string; categoryId?: string },
): boolean {
  if (holder.id === incoming.id) {
    return false;
  }
  if (emailUsesSingleProfileScope(email)) {
    return true;
  }
  return profileCategoryId(holder) === profileCategoryId(incoming);
}

export function profilesUsingEmail(
  email: PoolEmail,
  profiles: EmailAssignableProfile[],
): EmailAssignableProfile[] {
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

export function isEmailAvailableForProfile(
  email: PoolEmail,
  targetProfile: EmailAssignableProfile,
  allProfiles: EmailAssignableProfile[],
): boolean {
  if (!isAssignablePoolEmail(email)) {
    return false;
  }

  const otherAssignees = profilesUsingEmail(email, allProfiles).filter(
    (profile) => profile.id !== targetProfile.id,
  );

  if (otherAssignees.length === 0) {
    return true;
  }

  return !otherAssignees.some((profile) => assignmentConflicts(email, profile, targetProfile));
}

export function emailIdsUsedByProfiles(
  profiles: (ProfileSummary | Profile)[],
  emails: PoolEmail[],
): Set<string> {
  const used = new Set<string>();
  for (const profile of profiles) {
    if (!profileSummaryHasPoolEmail(profile, emails)) {
      continue;
    }
    if (profile.emailPoolId) {
      used.add(profile.emailPoolId);
      continue;
    }
    const address = "logins" in profile ? resolveProfileEmail(profile) : profile.email ?? "";
    const matched = emails.find((email) => emailsMatch(email.email, address));
    if (matched) {
      used.add(matched.id);
    }
  }
  return used;
}

/** Profiles still needed (beyond existing no-email slots) to assign every usable pool email in this category. */
export function countProfilesToCreateForFullEmailUse(
  scopeProfiles: ProfileSummary[],
  poolEmails: PoolEmail[],
  allProfiles: ProfileSummary[],
): number {
  if (scopeProfiles.length === 0 || poolEmails.length === 0) {
    return 0;
  }

  const usedInCategory = emailIdsUsedByProfiles(scopeProfiles, poolEmails);
  const profilesWithoutEmails = scopeProfiles.filter(
    (profile) => !profileSummaryHasPoolEmail(profile, poolEmails),
  );
  const referenceProfile =
    profilesWithoutEmails[0] ??
    ({
      ...scopeProfiles[0],
      emailPoolId: undefined,
      email: "",
    } satisfies ProfileSummary);

  const referenceTarget = toEmailAssignableProfile(referenceProfile);
  const allAssignable = toEmailAssignableProfiles(allProfiles);

  let totalCapacity = usedInCategory.size;
  for (const email of poolEmails) {
    if (!isAssignablePoolEmail(email)) {
      continue;
    }
    if (usedInCategory.has(email.id)) {
      continue;
    }
    if (isEmailAvailableForProfile(email, referenceTarget, allAssignable)) {
      totalCapacity += 1;
    }
  }

  return Math.max(0, totalCapacity - usedInCategory.size - profilesWithoutEmails.length);
}

export function listPoolEmailsAvailableForAnyProfile(
  emails: PoolEmail[],
  targetProfiles: (ProfileSummary | Profile)[],
  allProfiles: (ProfileSummary | Profile)[],
): PoolEmail[] {
  const targets = toEmailAssignableProfiles(targetProfiles);
  const all = toEmailAssignableProfiles(allProfiles);
  if (targets.length === 0) {
    return emails.filter(
      (email) => isAssignablePoolEmail(email) && profilesUsingEmail(email, all).length === 0,
    );
  }
  return emails.filter((email) =>
    targets.some((target) => isEmailAvailableForProfile(email, target, all)),
  );
}

export function listAvailablePoolEmailsForProfiles(
  emails: PoolEmail[],
  targetProfiles: (ProfileSummary | Profile)[],
  allProfiles: (ProfileSummary | Profile)[],
): PoolEmail[] {
  const targets = toEmailAssignableProfiles(targetProfiles);
  const all = toEmailAssignableProfiles(allProfiles);
  if (targets.length === 0) {
    return emails.filter(isAssignablePoolEmail);
  }
  return emails.filter((email) =>
    targets.every((target) => isEmailAvailableForProfile(email, target, all)),
  );
}

function applyBatchAssignmentToProfiles(
  allProfiles: EmailAssignableProfile[],
  assignments: Array<{ profileId: string; email: PoolEmail }>,
): EmailAssignableProfile[] {
  let simulated = allProfiles;
  for (const { profileId, email } of assignments) {
    simulated = simulated.map((profile) =>
      profile.id === profileId
        ? { ...profile, emailPoolId: email.id, email: email.email }
        : profile,
    );
  }
  return simulated;
}

/** Emails eligible for the next profile slot in an ordered batch assign. */
export function listAvailableEmailsForNextBatchSlot(
  emails: PoolEmail[],
  targetProfiles: (ProfileSummary | Profile)[],
  allProfiles: (ProfileSummary | Profile)[],
  selectedEmailIds: string[],
): PoolEmail[] {
  const targets = toEmailAssignableProfiles(targetProfiles);
  const nextIndex = selectedEmailIds.length;
  if (nextIndex >= targets.length) {
    return [];
  }

  const assignments: Array<{ profileId: string; email: PoolEmail }> = [];
  for (let index = 0; index < selectedEmailIds.length; index += 1) {
    const email = emails.find((item) => item.id === selectedEmailIds[index]);
    if (!email) {
      continue;
    }
    assignments.push({ profileId: targets[index].id, email });
  }

  const simulatedAll = applyBatchAssignmentToProfiles(
    toEmailAssignableProfiles(allProfiles),
    assignments,
  );
  const selectedSet = new Set(selectedEmailIds);
  const nextTarget = targets[nextIndex];

  return emails.filter(
    (email) => !selectedSet.has(email.id) && isEmailAvailableForProfile(email, nextTarget, simulatedAll),
  );
}

/** Selected emails plus the next valid choices for ordered batch assign (profile 1, then 2, …). */
export function listDisplayEmailsForBatchAssign(
  emails: PoolEmail[],
  targetProfiles: (ProfileSummary | Profile)[],
  allProfiles: (ProfileSummary | Profile)[],
  selectedEmailIds: string[],
): PoolEmail[] {
  const selectedEmails = selectedEmailIds
    .map((id) => emails.find((email) => email.id === id))
    .filter((email): email is PoolEmail => Boolean(email));

  if (selectedEmailIds.length >= targetProfiles.length) {
    return selectedEmails;
  }

  const nextSlot = listAvailableEmailsForNextBatchSlot(
    emails,
    targetProfiles,
    allProfiles,
    selectedEmailIds,
  );
  const visibleIds = new Set([
    ...selectedEmails.map((email) => email.id),
    ...nextSlot.map((email) => email.id),
  ]);
  return emails.filter((email) => visibleIds.has(email.id));
}

/** How many profiles in order can receive a distinct email from the pool. */
export function countCompletableBatchEmailAssignments(
  targetProfiles: (ProfileSummary | Profile)[],
  emails: PoolEmail[],
  allProfiles: (ProfileSummary | Profile)[],
): number {
  return pickEmailsForMassAssign(targetProfiles, emails, allProfiles).length;
}

/** Pick the first N available pool emails for mass assign (profile order). */
export function pickEmailsForMassAssign(
  targetProfiles: (ProfileSummary | Profile)[],
  emails: PoolEmail[],
  allProfiles: (ProfileSummary | Profile)[],
): string[] {
  const targets = toEmailAssignableProfiles(targetProfiles);
  let simulatedProfiles = toEmailAssignableProfiles(allProfiles);
  const picked: string[] = [];

  for (const target of targets) {
    const available = emails.filter((email) => {
      if (picked.includes(email.id)) {
        return false;
      }
      return isEmailAvailableForProfile(email, target, simulatedProfiles);
    });
    if (available.length === 0) {
      break;
    }
    const email = available[0];
    picked.push(email.id);
    simulatedProfiles = simulatedProfiles.map((profile) =>
      profile.id === target.id
        ? { ...profile, emailPoolId: email.id, email: email.email }
        : profile,
    );
  }

  return picked;
}

export function confirmReplaceExistingEmails(
  targetProfiles: ProfileSummary[],
  emails: PoolEmail[],
): boolean {
  const occupied = targetProfiles.filter((profile) => profileSummaryHasPoolEmail(profile, emails));
  if (occupied.length === 0) {
    return true;
  }

  const list = occupied
    .map((profile) => `• ${profile.name || "Unnamed"} (current: ${profile.email || "assigned email"})`)
    .join("\n");

  return window.confirm(
    `${occupied.length} profile(s) already have an email assigned:\n\n${list}\n\nReplace with new email(s)?`,
  );
}

export function validateEmailAssignments(
  profileIds: string[],
  emailIds: string[],
  emails: PoolEmail[],
  allProfiles: (ProfileSummary | Profile)[],
): string | null {
  const assignableProfiles = toEmailAssignableProfiles(allProfiles);
  const profileMap = new Map(assignableProfiles.map((profile) => [profile.id, profile]));
  let simulatedProfiles = assignableProfiles;

  for (let index = 0; index < profileIds.length; index += 1) {
    const profile = profileMap.get(profileIds[index]);
    const email = emails.find((item) => item.id === emailIds[index]);
    if (!profile || !email) {
      continue;
    }
    if (!isEmailAvailableForProfile(email, profile, simulatedProfiles)) {
      const scopeLabel = emailUsesSingleProfileScope(email)
        ? "another profile"
        : "another profile in the same category";
      return `"${email.email}" is not available for "${profile.name}" — already assigned to ${scopeLabel}.`;
    }
    simulatedProfiles = simulatedProfiles.map((item) =>
      item.id === profile.id ? { ...item, emailPoolId: email.id, email: email.email } : item,
    );
  }
  return null;
}

export function assignEmailsToProfiles(
  profilesToUpdate: Profile[],
  allProfiles: Profile[],
  emails: PoolEmail[],
  options: AssignEmailsOptions,
): Profile[] {
  if (profilesToUpdate.length === 0 || options.profileIds.length === 0) {
    return [];
  }

  const now = new Date().toISOString();
  const updatedById = new Map<string, Profile>();

  if (options.emailIds?.length) {
    if (
      options.emailIds.length !== options.profileIds.length ||
      new Set(options.emailIds).size !== options.emailIds.length
    ) {
      return [];
    }

    const assignmentByProfile = new Map(
      options.profileIds.map((profileId, index) => [profileId, options.emailIds![index]]),
    );
    const assignedEmailIds = new Set(options.emailIds);
    const profileMap = new Map(profilesToUpdate.map((profile) => [profile.id, profile]));

    for (const profile of allProfiles) {
      if (!profile.emailPoolId || !assignedEmailIds.has(profile.emailPoolId)) {
        continue;
      }
      const nextOwnerId = [...assignmentByProfile.entries()].find(
        ([, emailId]) => emailId === profile.emailPoolId,
      )?.[0];
      if (!nextOwnerId || nextOwnerId === profile.id) {
        continue;
      }
      const email = emails.find((item) => item.id === profile.emailPoolId);
      const nextOwner = profileMap.get(nextOwnerId) ?? allProfiles.find((item) => item.id === nextOwnerId);
      if (!email || !nextOwner || !assignmentConflicts(email, profile, nextOwner)) {
        continue;
      }
      updatedById.set(profile.id, {
        ...clearProfileEmailAssignment(profile),
        updatedAt: now,
      });
    }

    for (const profileId of options.profileIds) {
      const emailId = assignmentByProfile.get(profileId);
      if (!emailId) continue;
      const email = emails.find((item) => item.id === emailId);
      if (!email || !isAssignablePoolEmail(email)) continue;

      const profile = updatedById.get(profileId) ?? profileMap.get(profileId);
      if (!profile) continue;

      updatedById.set(profileId, {
        ...applyEmailFromPool(profile, emailId, emails),
        updatedAt: now,
      });
    }

    return [...updatedById.values()];
  }

  if (!options.emailId) {
    return [];
  }

  const email = emails.find((item) => item.id === options.emailId);
  if (!email || !isAssignablePoolEmail(email)) {
    return [];
  }

  const targetIds = new Set(options.profileIds);

  for (const profile of allProfiles) {
    if (profile.emailPoolId !== options.emailId || targetIds.has(profile.id)) {
      continue;
    }
    const conflicts = profilesToUpdate.some((target) => assignmentConflicts(email, profile, target));
    if (!conflicts) {
      continue;
    }
    updatedById.set(profile.id, {
      ...clearProfileEmailAssignment(profile),
      updatedAt: now,
    });
  }

  for (const profile of profilesToUpdate) {
    const cleared = updatedById.get(profile.id) ?? profile;
    updatedById.set(profile.id, applyEmailFromPool(cleared, options.emailId, emails));
    const next = updatedById.get(profile.id);
    if (next) {
      updatedById.set(profile.id, { ...next, updatedAt: now });
    }
  }

  return [...updatedById.values()];
}

export function unassignEmailsFromProfiles(profilesToUpdate: Profile[]): Profile[] {
  if (profilesToUpdate.length === 0) {
    return [];
  }

  const now = new Date().toISOString();
  return profilesToUpdate
    .filter((profile) => profile.emailPoolId || resolveProfileEmail(profile).trim())
    .map((profile) => ({
      ...clearProfileEmailAssignment(profile),
      updatedAt: now,
    }));
}
