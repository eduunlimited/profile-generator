import { useEffect, useMemo, useState } from "react";
import { formatCardNumberDisplay } from "../lib/creditCardUtils";
import {
  confirmReplaceExistingCards,
  listUnassignedCreditCards,
  pickCardsForMassAssign,
} from "../lib/assignCards";
import {
  buildProfileAssignCategories,
  resolveAssignProfileIds,
} from "../lib/profileAssignTree";
import type { AssignCardsOptions, CreditCard, MasterProfile, ProfileSummary } from "../lib/types";
import { CardBrandIcon } from "./CardBrandIcon";
import { ProfileAssignTree } from "./ProfileAssignTree";

interface AssignCardsPanelProps {
  cards: CreditCard[];
  profiles: ProfileSummary[];
  masterProfiles: MasterProfile[];
  lockedProfileIds?: string[];
  lockedCreditCardIds?: string[];
  onAssign: (options: AssignCardsOptions) => Promise<number>;
  onSuccess?: (count: number) => void;
}

export function AssignCardsPanel({
  cards,
  profiles,
  masterProfiles,
  lockedProfileIds,
  lockedCreditCardIds,
  onAssign,
  onSuccess,
}: AssignCardsPanelProps) {
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

  const availableCards = useMemo(
    () => (profilesBatchMode ? listUnassignedCreditCards(cards, profiles) : cards),
    [profilesBatchMode, cards, profiles],
  );

  const targetProfiles = useMemo(() => {
    const profileMap = new Map(profiles.map((profile) => [profile.id, profile]));
    return profileIds
      .map((id) => profileMap.get(id))
      .filter((profile): profile is ProfileSummary => Boolean(profile));
  }, [profileIds, profiles]);

  useEffect(() => {
    if (!profilesBatchMode || profileLimit === 0) return;
    setSelectedCreditCardIds(pickCardsForMassAssign(profileLimit, cards, profiles));
  }, [profilesBatchMode, profileLimit, cards, profiles]);

  const sortedProfiles = useMemo(
    () => [...profiles].sort((a, b) => a.name.localeCompare(b.name)),
    [profiles],
  );

  const toggleProfile = (id: string) => {
    if (lockedProfileIds || cardsBulkMode) return;
    setSelectedProfileIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  };

  const toggleBatchCard = (id: string) => {
    setSelectedCreditCardIds((current) => {
      if (current.includes(id)) {
        return current.filter((item) => item !== id);
      }
      if (current.length >= profileLimit) {
        return current;
      }
      return [...current, id];
    });
  };

  const cardsReady = profilesBatchMode
    ? selectedCreditCardIds.length === profileLimit && profileLimit > 0
    : cardsBulkMode
      ? lockedCardIds.length === 1
        ? resolvedProfileIds.length > 0
        : resolvedProfileIds.length === lockedCardIds.length
      : Boolean(creditCardId);

  const autoFillCards = () => {
    setSelectedCreditCardIds(pickCardsForMassAssign(profileLimit, cards, profiles));
  };

  const runCardsBulkAssign = async () => {
    if (resolvedProfileIds.length === 0) {
      setStatus("Select at least one profile or parent category.");
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

    if (!confirmReplaceExistingCards(bulkTargets)) {
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

    if (!confirmReplaceExistingCards(targetProfiles)) {
      return;
    }

    if (profilesBatchMode) {
      if (selectedCreditCardIds.length !== profileLimit) {
        setStatus(`Select ${profileLimit} card${profileLimit === 1 ? "" : "s"} (one per profile).`);
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
      setStatus(`Need ${profileLimit} unassigned cards — only ${availableCards.length} available.`);
      return;
    }
    if (!confirmReplaceExistingCards(targetProfiles)) {
      return;
    }

    const cardIds = pickCardsForMassAssign(profileLimit, cards, profiles);
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
            One unassigned card per profile, matched in table order. Cards are auto-filled from the pool — adjust
            checkboxes or use Mass assign.
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
            <h3 className="subsection-title">Available cards</h3>
            <span className={`assign-selection-count${cardsReady ? " assign-selection-count-ready" : ""}`}>
              {selectedCreditCardIds.length}/{profileLimit} cards selected
            </span>
          </div>

          {availableCards.length === 0 ? (
            <p className="muted">No unassigned cards in the pool. Add cards on the Cards tab.</p>
          ) : availableCards.length < profileLimit ? (
            <p className="muted status-inline">
              Only {availableCards.length} unassigned card{availableCards.length === 1 ? "" : "s"} available — need{" "}
              {profileLimit}.
            </p>
          ) : null}

          {availableCards.length > 0 ? (
            <div className="assign-option-list card-pool-list-compact">
              {availableCards.map((card) => {
                const selectedIndex = selectedCreditCardIds.indexOf(card.id);
                const isSelected = selectedIndex >= 0;
                const atLimit = selectedCreditCardIds.length >= profileLimit;
                return (
                  <label
                    key={card.id}
                    className={`assign-option-row card-pool-row${isSelected ? " card-pool-row-editing" : ""}${!isSelected && atLimit ? " assign-option-row-disabled" : ""}`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      disabled={!isSelected && atLimit}
                      onChange={() => toggleBatchCard(card.id)}
                    />
                    <span className="assign-option-content">
                      {isSelected ? (
                        <span className="assign-card-order">{selectedIndex + 1}</span>
                      ) : (
                        <span className="card-pool-col-brand">
                          <CardBrandIcon brand={card.brand} size="sm" />
                        </span>
                      )}
                      <span className="assign-option-label">
                        {card.profileName}
                        <span className="muted card-pool-number">
                          {" "}
                          · {formatCardNumberDisplay(card.number, card.brand) || "—"}
                        </span>
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
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
          {cards.length === 0 ? (
            <p className="muted">No cards in pool yet. Add some on the Cards tab.</p>
          ) : (
            <div className="assign-option-list">
              {cards.map((card) => (
                <label key={card.id} className="assign-option-row">
                  <input
                    type="radio"
                    name="assign-card"
                    checked={selectedCreditCardId === card.id}
                    onChange={() => setSelectedCreditCardId(card.id)}
                  />
                  <span className="assign-option-content">
                    <CardBrandIcon brand={card.brand} size="sm" />
                    <span className="assign-option-label">
                      {card.profileName}
                      <span className="muted card-pool-number">
                        {" "}
                        · {formatCardNumberDisplay(card.number, card.brand) || "—"}
                      </span>
                    </span>
                  </span>
                </label>
              ))}
            </div>
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
            disabled={busy || profileLimit === 0 || availableCards.length < profileLimit}
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
