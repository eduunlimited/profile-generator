import { useMemo, useState } from "react";
import { filterAssignablePoolEmails } from "../lib/emailPoolUtils";
import {
  confirmReplaceExistingEmails,
  countCompletableBatchEmailAssignments,
  listAvailablePoolEmailsForProfiles,
  listDisplayEmailsForBatchAssign,
  pickEmailsForMassAssign,
  validateEmailAssignments,
} from "../lib/assignEmails";
import {
  buildProfileAssignCategories,
  resolveAssignProfileIds,
} from "../lib/profileAssignTree";
import { sortProfilesByName } from "../lib/profileNameUtils";
import type { AssignEmailsOptions, EmailCategory, MasterProfile, PoolEmail, ProfileSummary } from "../lib/types";
import { EmailAssignTree } from "./EmailAssignTree";
import { ProfileAssignTree } from "./ProfileAssignTree";

interface AssignEmailsPanelProps {
  emails: PoolEmail[];
  emailCategories: EmailCategory[];
  profiles: ProfileSummary[];
  masterProfiles: MasterProfile[];
  lockedProfileIds?: string[];
  lockedEmailIds?: string[];
  onAssign: (options: AssignEmailsOptions) => Promise<number>;
  onSuccess?: (count: number) => void;
}

export function AssignEmailsPanel({
  emails,
  emailCategories,
  profiles,
  masterProfiles,
  lockedProfileIds,
  lockedEmailIds,
  onAssign,
  onSuccess,
}: AssignEmailsPanelProps) {
  const assignableEmails = useMemo(() => filterAssignablePoolEmails(emails), [emails]);
  const profilesBatchMode = Boolean(lockedProfileIds?.length) && !lockedEmailIds?.length;
  const emailsBulkMode = Boolean(lockedEmailIds?.length);
  const profileLimit = lockedProfileIds?.length ?? 0;
  const lockedIds = lockedEmailIds ?? [];

  const [selectedEmailId, setSelectedEmailId] = useState("");
  const [selectedEmailIds, setSelectedEmailIds] = useState<string[]>([]);
  const [selectedProfileIds, setSelectedProfileIds] = useState<string[]>(lockedProfileIds ?? []);
  const [selectedParentCategoryIds, setSelectedParentCategoryIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const categories = useMemo(
    () => buildProfileAssignCategories(profiles, masterProfiles),
    [profiles, masterProfiles],
  );

  const resolvedProfileIds = useMemo(() => {
    if (profilesBatchMode && lockedProfileIds) {
      return lockedProfileIds;
    }
    if (emailsBulkMode) {
      return resolveAssignProfileIds(
        categories,
        selectedProfileIds,
        selectedParentCategoryIds,
        lockedIds.length,
      );
    }
    return lockedProfileIds ?? selectedProfileIds;
  }, [
    profilesBatchMode,
    lockedProfileIds,
    emailsBulkMode,
    categories,
    selectedProfileIds,
    selectedParentCategoryIds,
    lockedIds.length,
  ]);

  const profileIds = profilesBatchMode ? (lockedProfileIds ?? []) : resolvedProfileIds;
  const emailId = emailsBulkMode ? undefined : selectedEmailId;

  const lockedProfiles = useMemo(() => {
    if (!lockedProfileIds?.length) return [];
    const profileMap = new Map(profiles.map((profile) => [profile.id, profile]));
    return lockedProfileIds
      .map((id) => profileMap.get(id))
      .filter((profile): profile is ProfileSummary => Boolean(profile));
  }, [lockedProfileIds, profiles]);

  const targetProfiles = useMemo(() => {
    const profileMap = new Map(profiles.map((profile) => [profile.id, profile]));
    return profileIds
      .map((id) => profileMap.get(id))
      .filter((profile): profile is ProfileSummary => Boolean(profile));
  }, [profileIds, profiles]);

  const batchTargetProfiles = profilesBatchMode ? lockedProfiles : targetProfiles;

  const availableEmails = useMemo(() => {
    if (profilesBatchMode) {
      return listDisplayEmailsForBatchAssign(
        assignableEmails,
        batchTargetProfiles,
        profiles,
        selectedEmailIds,
      );
    }
    if (targetProfiles.length === 0) {
      return assignableEmails;
    }
    return listAvailablePoolEmailsForProfiles(assignableEmails, targetProfiles, profiles);
  }, [
    profilesBatchMode,
    assignableEmails,
    batchTargetProfiles,
    targetProfiles,
    profiles,
    selectedEmailIds,
  ]);

  const completableBatchCount = useMemo(() => {
    if (!profilesBatchMode || batchTargetProfiles.length === 0) {
      return 0;
    }
    return countCompletableBatchEmailAssignments(batchTargetProfiles, assignableEmails, profiles);
  }, [profilesBatchMode, batchTargetProfiles, assignableEmails, profiles]);

  const sortedProfiles = useMemo(() => sortProfilesByName(profiles), [profiles]);

  const toggleProfile = (id: string) => {
    if (lockedProfileIds || emailsBulkMode) return;
    setSelectedProfileIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  };

  const emailsReady = profilesBatchMode
    ? selectedEmailIds.length === profileLimit && profileLimit > 0
    : emailsBulkMode
      ? lockedIds.length === 1
        ? resolvedProfileIds.length > 0
        : resolvedProfileIds.length === lockedIds.length
      : Boolean(emailId);

  const autoFillEmails = () => {
    const targets = profilesBatchMode ? lockedProfiles : targetProfiles;
    setSelectedEmailIds(pickEmailsForMassAssign(targets, assignableEmails, profiles));
  };

  const runEmailsBulkAssign = async () => {
    if (resolvedProfileIds.length === 0) {
      setStatus("Select at least one profile or parent category.");
      return;
    }
    const blockedEmails = lockedIds.filter((id) => !assignableEmails.some((email) => email.id === id));
    if (blockedEmails.length > 0) {
      setStatus("One or more selected emails are marked Not good and cannot be assigned.");
      return;
    }
    if (lockedIds.length > 1 && resolvedProfileIds.length !== lockedIds.length) {
      setStatus(
        `Select exactly ${lockedIds.length} profile${lockedIds.length === 1 ? "" : "s"} for ${lockedIds.length} emails.`,
      );
      return;
    }

    const profileMap = new Map(profiles.map((profile) => [profile.id, profile]));
    const bulkTargets = resolvedProfileIds
      .map((id) => profileMap.get(id))
      .filter((profile): profile is ProfileSummary => Boolean(profile));

    if (!confirmReplaceExistingEmails(bulkTargets, emails)) {
      return;
    }

    setBusy(true);
    setStatus(null);
    try {
      const updated =
        lockedIds.length === 1
          ? await onAssign({ profileIds: resolvedProfileIds, emailId: lockedIds[0] })
          : await onAssign({ profileIds: resolvedProfileIds, emailIds: lockedIds });
      setStatus(`Assigned email${lockedIds.length === 1 ? "" : "s"} to ${updated} profile(s).`);
      onSuccess?.(updated);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Assignment failed.");
    } finally {
      setBusy(false);
    }
  };

  const run = async () => {
    if (emailsBulkMode) {
      await runEmailsBulkAssign();
      return;
    }

    if (profileIds.length === 0) {
      setStatus("Select at least one profile.");
      return;
    }

    if (!confirmReplaceExistingEmails(targetProfiles, emails)) {
      return;
    }

    if (profilesBatchMode) {
      if (selectedEmailIds.length !== profileLimit) {
        setStatus(`Select ${profileLimit} email${profileLimit === 1 ? "" : "s"} (one per profile).`);
        return;
      }

      const batchProfileIds = lockedProfileIds ?? profileIds;
      const validationError = validateEmailAssignments(
        batchProfileIds,
        selectedEmailIds,
        assignableEmails,
        profiles,
      );
      if (validationError) {
        setStatus(validationError);
        return;
      }

      setBusy(true);
      setStatus(null);
      try {
        const updated = await onAssign({
          profileIds: lockedProfileIds ?? profileIds,
          emailIds: selectedEmailIds,
        });
        setStatus(`Assigned ${updated} email${updated === 1 ? "" : "s"} to ${updated} profile(s).`);
        onSuccess?.(updated);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Assignment failed.");
      } finally {
        setBusy(false);
      }
      return;
    }

    if (!emailId) {
      setStatus("Select one email.");
      return;
    }

    const validationError = validateEmailAssignments(
      profileIds,
      profileIds.map(() => emailId),
      assignableEmails,
      profiles,
    );
    if (validationError) {
      setStatus(validationError);
      return;
    }

    setBusy(true);
    setStatus(null);
    try {
      const updated = await onAssign({ profileIds, emailId });
      setStatus(`Assigned email to ${updated} profile(s).`);
      onSuccess?.(updated);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Assignment failed.");
    } finally {
      setBusy(false);
    }
  };

  const runMassAssign = async () => {
    if (profileIds.length === 0) {
      setStatus("Select at least one profile.");
      return;
    }
    if (availableEmails.length < profileLimit) {
      setStatus(
        `Need ${profileLimit} assignable emails — only ${completableBatchCount} can be assigned in order.`,
      );
      return;
    }
    if (!confirmReplaceExistingEmails(targetProfiles, emails)) {
      return;
    }

    const emailIds = pickEmailsForMassAssign(lockedProfiles, assignableEmails, profiles);
    setSelectedEmailIds(emailIds);
    setBusy(true);
    setStatus(null);
    try {
      const updated = await onAssign({
        profileIds: lockedProfileIds ?? profileIds,
        emailIds,
      });
      setStatus(`Mass assigned ${updated} email${updated === 1 ? "" : "s"} to ${updated} profile(s).`);
      onSuccess?.(updated);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Assignment failed.");
    } finally {
      setBusy(false);
    }
  };

  const assignButtonLabelCount = emailsBulkMode ? resolvedProfileIds.length : profileIds.length;

  return (
    <section className="card assign-panel">
      <div className="assign-panel-body">
        {emailsBulkMode ? (
          <>
            <p className="muted assign-panel-intro">
              Assigning <strong>{lockedIds.length}</strong> email{lockedIds.length === 1 ? "" : "s"}. One email
              per profile, matched in selection order. Select a parent to assign to the first{" "}
              {lockedIds.length || "N"} profile{lockedIds.length === 1 ? "" : "s"} under it, or pick individual
              profiles below.
            </p>
            <h3 className="subsection-title">Profiles</h3>
            <ProfileAssignTree
              profiles={profiles}
              masterProfiles={masterProfiles}
              credentialCount={lockedIds.length}
              selectedProfileIds={selectedProfileIds}
              selectedParentCategoryIds={selectedParentCategoryIds}
              onSelectedProfileIdsChange={setSelectedProfileIds}
              onSelectedParentCategoryIdsChange={setSelectedParentCategoryIds}
            />
          </>
        ) : profilesBatchMode ? (
          <>
            <p className="muted assign-panel-intro">
              Select one email per profile in list order. Each pick applies to the next profile; only emails
              valid for that slot are shown. Emails cannot be repeated in the same category, but can be reused
              on profiles in other categories. Emails marked “Assign only to 1 profile” cannot be reused
              anywhere.
            </p>
            <p className="muted">
              Assigning to <strong>{profileLimit}</strong> profile{profileLimit === 1 ? "" : "s"}:
            </p>
            <ol className="assign-profile-order-list">
              {lockedProfiles.map((profile) => (
                <li key={profile.id}>
                  {profile.name || "Unnamed"} · {profile.email || "No email"}
                </li>
              ))}
            </ol>

            <div className="assign-cards-header">
              <h3 className="subsection-title">
                {selectedEmailIds.length < profileLimit
                  ? `Choose email for profile ${selectedEmailIds.length + 1}`
                  : "Selected emails"}
              </h3>
              <span className={`assign-selection-count${emailsReady ? " assign-selection-count-ready" : ""}`}>
                {selectedEmailIds.length}/{profileLimit} emails selected
              </span>
            </div>

            {completableBatchCount === 0 ? (
              <p className="muted">
                No assignable emails in the pool for these profiles. Add emails on the Emails tab.
              </p>
            ) : completableBatchCount < profileLimit ? (
              <p className="muted status-inline">
                Only {completableBatchCount} email{completableBatchCount === 1 ? "" : "s"} can be assigned in
                order — need {profileLimit}.
              </p>
            ) : null}

            {availableEmails.length > 0 ? (
              <EmailAssignTree
                emails={availableEmails}
                categories={emailCategories}
                selectionMode="multiple"
                selectedEmailIds={selectedEmailIds}
                selectionLimit={profileLimit}
                onSelectedEmailIdsChange={setSelectedEmailIds}
              />
            ) : null}
          </>
        ) : (
          <>
            <p className="muted assign-panel-intro">
              Pick one email from the pool. Each selected profile gets exactly that email (replacing any
              previous email).
            </p>

            {lockedProfileIds ? (
              <p className="muted">
                Assigning to <strong>{lockedProfileIds.length}</strong> selected profile
                {lockedProfileIds.length === 1 ? "" : "s"}.
              </p>
            ) : (
              <>
                <h3 className="subsection-title">Profiles</h3>
                {sortedProfiles.length === 0 ? (
                  <p className="muted">No profiles available.</p>
                ) : (
                  <div className="assign-option-list assign-profile-grid">
                    {sortedProfiles.map((profile) => (
                      <label key={profile.id} className="assign-option-row">
                        <input
                          type="checkbox"
                          checked={selectedProfileIds.includes(profile.id)}
                          onChange={() => toggleProfile(profile.id)}
                        />
                        <span className="assign-option-label">
                          {profile.name || "Unnamed"} · {profile.email || "No email"}
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </>
            )}

            <h3 className="subsection-title">Email (pick one)</h3>
            {assignableEmails.length === 0 ? (
              <p className="muted">
                No Good-status emails in pool. Add emails or mark existing emails as Good on the Emails tab.
              </p>
            ) : (
              <EmailAssignTree
                emails={assignableEmails}
                categories={emailCategories}
                selectionMode="single"
                selectedEmailId={selectedEmailId}
                onSelectedEmailIdChange={setSelectedEmailId}
              />
            )}
          </>
        )}
      </div>

      <div className="assign-panel-footer">
        <div className="button-row compact">
          {profilesBatchMode ? (
            <button
              type="button"
              className="btn-secondary"
              disabled={busy || profileLimit === 0 || completableBatchCount < profileLimit}
              onClick={() => void runMassAssign()}
            >
              Mass assign ({profileLimit})
            </button>
          ) : null}
          {profilesBatchMode ? (
            <button
              type="button"
              className="btn-secondary"
              disabled={busy || profileLimit === 0 || availableEmails.length === 0}
              onClick={autoFillEmails}
            >
              Auto-fill emails
            </button>
          ) : null}
          <button
            type="button"
            className="btn-primary"
            disabled={busy || assignButtonLabelCount === 0 || !emailsReady}
            onClick={() => void run()}
          >
            Assign to {assignButtonLabelCount} profile{assignButtonLabelCount === 1 ? "" : "s"}
          </button>
        </div>
        {status ? <p className="status-inline">{status}</p> : null}
      </div>
    </section>
  );
}
