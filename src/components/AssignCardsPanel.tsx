import { useMemo, useState } from "react";
import { filterAssignablePoolCards } from "../lib/creditCardUtils";
import {
  confirmReplaceExistingCards,
  countCompletableBatchAssignments,
  listAvailableCreditCardsForProfiles,
  listDisplayCardsForBatchAssign,
  pickCardsForMassAssign,
  validateCardAssignments,
} from "../lib/assignCards";
import {
  buildProfileAssignCategories,
  resolveAssignProfileIds,
} from "../lib/profileAssignTree";
import { sortProfilesByName } from "../lib/profileNameUtils";
import type { AssignCardsOptions, CardCategory, CreditCard, MasterProfile, ProfileSummary } from "../lib/types";
import { CardAssignTree } from "./CardAssignTree";
import { ProfileAssignTree } from "./ProfileAssignTree";

interface AssignCardsPanelProps {
  cards: CreditCard[];
  cardCategories: CardCategory[];
  profiles: ProfileSummary[];
  masterProfiles: MasterProfile[];
  lockedProfileIds?: string[];
  lockedCreditCardIds?: string[];
  onAssign: (options: AssignCardsOptions) => Promise<number>;
  onSuccess?: (count: number) => void;
}

export function AssignCardsPanel({
  cards,
  cardCategories,
  profiles,
  masterProfiles,
  lockedProfileIds,
  lockedCreditCardIds,
  onAssign,
  onSuccess,
}: AssignCardsPanelProps) {
  const assignableCards = useMemo(() => filterAssignablePoolCards(cards), [cards]);
  const profilesBatchMode = Boolean(lockedProfileIds?.length) && !lockedCreditCardIds?.length;
  const cardsBulkMode = Boolean(lockedCreditCardIds?.length);
  const profileLimit = lockedProfileIds?.length ?? 0;
  const lockedCardIds = lockedCreditCardIds ?? [];

  const [selectedCreditCardId, setSelectedCreditCardId] = useState("");
  const [selectedCreditCardIds, setSelectedCreditCardIds] = useState<string[]>([]);
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
    if (cardsBulkMode) {
      return resolveAssignProfileIds(
        categories,
        selectedProfileIds,
        selectedParentCategoryIds,
        lockedCardIds.length,
      );
    }
    return lockedProfileIds ?? selectedProfileIds;
  }, [
    profilesBatchMode,
    lockedProfileIds,
    cardsBulkMode,
    categories,
    selectedProfileIds,
    selectedParentCategoryIds,
    lockedCardIds.length,
  ]);

  const profileIds = profilesBatchMode ? (lockedProfileIds ?? []) : resolvedProfileIds;
  const creditCardId = cardsBulkMode ? undefined : selectedCreditCardId;

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

  const availableCards = useMemo(() => {
    if (profilesBatchMode) {
      return listDisplayCardsForBatchAssign(
        assignableCards,
        batchTargetProfiles,
        profiles,
        selectedCreditCardIds,
      );
    }
    if (targetProfiles.length === 0) {
      return assignableCards;
    }
    return listAvailableCreditCardsForProfiles(assignableCards, targetProfiles, profiles);
  }, [
    profilesBatchMode,
    assignableCards,
    batchTargetProfiles,
    targetProfiles,
    profiles,
    selectedCreditCardIds,
  ]);

  const completableBatchCount = useMemo(() => {
    if (!profilesBatchMode || batchTargetProfiles.length === 0) {
      return 0;
    }
    return countCompletableBatchAssignments(batchTargetProfiles, assignableCards, profiles);
  }, [profilesBatchMode, batchTargetProfiles, assignableCards, profiles]);

  const sortedProfiles = useMemo(() => sortProfilesByName(profiles), [profiles]);

  const toggleProfile = (id: string) => {
    if (lockedProfileIds || cardsBulkMode) return;
    setSelectedProfileIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  };

  const cardsReady = profilesBatchMode
    ? selectedCreditCardIds.length === profileLimit && profileLimit > 0
    : cardsBulkMode
      ? lockedCardIds.length === 1
        ? resolvedProfileIds.length > 0
        : resolvedProfileIds.length === lockedCardIds.length
      : Boolean(creditCardId);

  const autoFillCards = () => {
    const targets = profilesBatchMode ? lockedProfiles : targetProfiles;
    setSelectedCreditCardIds(pickCardsForMassAssign(targets, assignableCards, profiles));
  };

  const runCardsBulkAssign = async () => {
    if (resolvedProfileIds.length === 0) {
      setStatus("Select at least one profile or parent category.");
      return;
    }
    const blockedCards = lockedCardIds.filter(
      (id) => !assignableCards.some((card) => card.id === id),
    );
    if (blockedCards.length > 0) {
      setStatus("One or more selected cards are marked Not good and cannot be assigned.");
      return;
    }
    if (lockedCardIds.length > 1 && resolvedProfileIds.length !== lockedCardIds.length) {
      setStatus(
        `Select exactly ${lockedCardIds.length} profile${lockedCardIds.length === 1 ? "" : "s"} for ${lockedCardIds.length} cards.`,
      );
      return;
    }

    const profileMap = new Map(profiles.map((profile) => [profile.id, profile]));
    const bulkTargets = resolvedProfileIds
      .map((id) => profileMap.get(id))
      .filter((profile): profile is ProfileSummary => Boolean(profile));

    if (!confirmReplaceExistingCards(bulkTargets, cards)) {
      return;
    }

    setBusy(true);
    setStatus(null);
    try {
      const updated =
        lockedCardIds.length === 1
          ? await onAssign({ profileIds: resolvedProfileIds, creditCardId: lockedCardIds[0] })
          : await onAssign({ profileIds: resolvedProfileIds, creditCardIds: lockedCardIds });
      setStatus(`Assigned card${lockedCardIds.length === 1 ? "" : "s"} to ${updated} profile(s).`);
      onSuccess?.(updated);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Assignment failed.");
    } finally {
      setBusy(false);
    }
  };

  const run = async () => {
    if (cardsBulkMode) {
      await runCardsBulkAssign();
      return;
    }

    if (profileIds.length === 0) {
      setStatus("Select at least one profile.");
      return;
    }

    if (!confirmReplaceExistingCards(targetProfiles, cards)) {
      return;
    }

    if (profilesBatchMode) {
      if (selectedCreditCardIds.length !== profileLimit) {
        setStatus(`Select ${profileLimit} card${profileLimit === 1 ? "" : "s"} (one per profile).`);
        return;
      }

      const batchProfileIds = lockedProfileIds ?? profileIds;
      const validationError = validateCardAssignments(
        batchProfileIds,
        selectedCreditCardIds,
        assignableCards,
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
          creditCardIds: selectedCreditCardIds,
        });
        setStatus(`Assigned ${updated} card${updated === 1 ? "" : "s"} to ${updated} profile(s).`);
        onSuccess?.(updated);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Assignment failed.");
      } finally {
        setBusy(false);
      }
      return;
    }

    if (!creditCardId) {
      setStatus("Select one card.");
      return;
    }

    const validationError = validateCardAssignments(
      profileIds,
      profileIds.map(() => creditCardId),
      assignableCards,
      profiles,
    );
    if (validationError) {
      setStatus(validationError);
      return;
    }

    setBusy(true);
    setStatus(null);
    try {
      const updated = await onAssign({ profileIds, creditCardId });
      setStatus(`Assigned card to ${updated} profile(s).`);
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
    if (availableCards.length < profileLimit) {
      setStatus(`Need ${profileLimit} assignable cards — only ${completableBatchCount} can be assigned in order.`);
      return;
    }
    if (!confirmReplaceExistingCards(targetProfiles, cards)) {
      return;
    }

    const cardIds = pickCardsForMassAssign(lockedProfiles, assignableCards, profiles);
    setSelectedCreditCardIds(cardIds);
    setBusy(true);
    setStatus(null);
    try {
      const updated = await onAssign({
        profileIds: lockedProfileIds ?? profileIds,
        creditCardIds: cardIds,
      });
      setStatus(`Mass assigned ${updated} card${updated === 1 ? "" : "s"} to ${updated} profile(s).`);
      onSuccess?.(updated);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Assignment failed.");
    } finally {
      setBusy(false);
    }
  };

  const assignButtonLabelCount = cardsBulkMode ? resolvedProfileIds.length : profileIds.length;

  return (
    <section className="card assign-panel">
      <div className="assign-panel-body">
      {cardsBulkMode ? (
        <>
          <p className="muted assign-panel-intro">
            Assigning <strong>{lockedCardIds.length}</strong> card{lockedCardIds.length === 1 ? "" : "s"}. One card
            per profile, matched in selection order. Select a parent to assign to the first{" "}
            {lockedCardIds.length || "N"} profile{lockedCardIds.length === 1 ? "" : "s"} under it, or pick
            individual profiles below.
          </p>
          <h3 className="subsection-title">Profiles</h3>
          <ProfileAssignTree
            profiles={profiles}
            masterProfiles={masterProfiles}
            credentialCount={lockedCardIds.length}
            selectedProfileIds={selectedProfileIds}
            selectedParentCategoryIds={selectedParentCategoryIds}
            onSelectedProfileIdsChange={setSelectedProfileIds}
            onSelectedParentCategoryIdsChange={setSelectedParentCategoryIds}
          />
        </>
      ) : profilesBatchMode ? (
        <>
          <p className="muted assign-panel-intro">
            Select one card per profile in list order. Each pick applies to the next profile; only cards
            valid for that slot are shown. Profiles without an account site can only use cards not assigned
            anywhere else; named sites (Target, Walmart) share account-group cards one per site.
          </p>
          <p className="muted">
            Assigning to <strong>{profileLimit}</strong> profile{profileLimit === 1 ? "" : "s"}:
          </p>
          <ol className="assign-profile-order-list">
            {lockedProfiles.map((profile) => (
              <li key={profile.id}>
                {profile.name || "Unnamed"} · {profile.creditCardLabel || "No card"}
              </li>
            ))}
          </ol>

          <div className="assign-cards-header">
            <h3 className="subsection-title">
              {selectedCreditCardIds.length < profileLimit
                ? `Choose card for profile ${selectedCreditCardIds.length + 1}`
                : "Selected cards"}
            </h3>
            <span className={`assign-selection-count${cardsReady ? " assign-selection-count-ready" : ""}`}>
              {selectedCreditCardIds.length}/{profileLimit} cards selected
            </span>
          </div>

          {completableBatchCount === 0 ? (
            <p className="muted">No assignable cards in the pool for these profiles. Add cards on the Cards tab.</p>
          ) : completableBatchCount < profileLimit ? (
            <p className="muted status-inline">
              Only {completableBatchCount} card{completableBatchCount === 1 ? "" : "s"} can be assigned in order —
              need {profileLimit}.
            </p>
          ) : null}

          {availableCards.length > 0 ? (
            <CardAssignTree
              cards={availableCards}
              categories={cardCategories}
              selectionMode="multiple"
              selectedCardIds={selectedCreditCardIds}
              selectionLimit={profileLimit}
              onSelectedCardIdsChange={setSelectedCreditCardIds}
            />
          ) : null}
        </>
      ) : (
        <>
          <p className="muted assign-panel-intro">
            Pick one card from the pool. Each selected profile gets exactly that card (replacing any previous card).
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
                        {profile.name || "Unnamed"} · {profile.creditCardLabel || "No card"}
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </>
          )}

          <h3 className="subsection-title">Card (pick one)</h3>
          {assignableCards.length === 0 ? (
            <p className="muted">No Good-status cards in pool. Add cards or mark existing cards as Good on the Cards tab.</p>
          ) : (
            <CardAssignTree
              cards={assignableCards}
              categories={cardCategories}
              selectionMode="single"
              selectedCardId={selectedCreditCardId}
              onSelectedCardIdChange={setSelectedCreditCardId}
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
            disabled={busy || profileLimit === 0 || availableCards.length === 0}
            onClick={autoFillCards}
          >
            Auto-fill cards
          </button>
        ) : null}
        <button
          type="button"
          className="btn-primary"
          disabled={busy || assignButtonLabelCount === 0 || !cardsReady}
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
