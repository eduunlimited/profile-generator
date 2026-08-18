import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AppNav } from "./components/AppNav";

import { EpgsAppIcon, EpgsLogo } from "./components/EpgsBrand";

import { CreditCardsPanel } from "./components/CreditCardsPanel";

import { CredentialsPanel } from "./components/CredentialsPanel";

import { ConfirmDeleteModal } from "./components/ConfirmDeleteModal";

import { DevModeBanner } from "./components/DevModeBanner";

import { ExportModal } from "./components/ExportModal";

import { GenerateModal } from "./components/GenerateModal";

import { AssignCardsModal } from "./components/AssignCardsModal";

import { MassDistributeModal } from "./components/MassDistributeModal";

import { RejigModal } from "./components/RejigModal";

import { JigPresetsPanel } from "./components/JigPresetsPanel";

import { MasterProfileModal } from "./components/MasterProfileModal";

import { ProfilesPanel } from "./components/ProfilesPanel";

import { MailPanel } from "./components/MailPanel";

import { LicenseGate, useAppUpdateChecks } from "./components/LicenseGate";

import { BrowserSessionsPanel } from "./modules/browserSessions";

import { useAppData } from "./hooks/useAppData";

import { useConfirmDelete } from "./hooks/useConfirmDelete";

import { formatLinkedProfileNames } from "./lib/profileNameUtils";

import { profilesMatchingCredential } from "./lib/linkCredentialsByEmail";

import { profilesMatchingCard } from "./lib/creditCardUtils";

import type { AppTab, MasterProfile } from "./lib/types";

const TAB_CONTEXT: Record<AppTab, { title: string; hint: string }> = {
  profiles: { title: "Jig Profiles", hint: "Master parents · generate · re-jig · export" },
  master: { title: "Master Profiles", hint: "Parent addresses · source of truth" },
  cards: { title: "Credit Cards", hint: "Pool · assign · categories" },
  credentials: { title: "Accounts", hint: "Credentials · site links" },
  mail: { title: "Mail", hint: "IMAP keys · last 500 messages" },
  jigs: { title: "Jig Presets", hint: "Name · address · export rules" },
  sessions: { title: "Browser Sessions", hint: "Account pool · Camoufox · cookies" },
};

import { createEmptyMasterProfile, masterProfileLabel } from "./lib/masterProfileUtils";

import "./App.css";



function AppContent() {

  const {

    profiles,

    jigPresets,

    exportTemplates,

    masterProfiles,

    creditCards,

    cardCategories,

    profileCategories,

    credentials,

    accountCategories,

    loading,

    error,

    createProfilesFromMaster,

    rejigProfilesFromMaster,

    assignCards,

    unassignCards,

    massDistributeProfiles,

    loadProfile,

    saveProfilesBatch,
    importProfiles,

    updateMasterProfile,

    removeMasterProfile,

    removeProfiles,

    canUndoLastAction,

    lastActionLabel,

    recordLastAction,

    updateLastActionLabel,

    undoLastAction,

    upsertCreditCard,

    removeCreditCard,

    importCards,

    upsertCardCategory,

    removeCardCategory,

    reorderCardCategoryOrder,

    upsertProfileCategory,

    removeProfileCategory,

    reorderProfileCategoryOrder,

    upsertCredential,

    removeCredential,

    importCreds,

    upsertAccountCategory,

    removeAccountCategory,

    reorderAccountCategoryOrder,

    upsertJigPreset,

    upsertExportTemplate,

  } = useAppData();



  const [activeTab, setActiveTab] = useState<AppTab>("profiles");

  const [selectedProfileIds, setSelectedProfileIds] = useState<string[]>([]);

  const [showMasterEditor, setShowMasterEditor] = useState(false);

  const [showGenerateModal, setShowGenerateModal] = useState(false);

  const [showRejigModal, setShowRejigModal] = useState(false);

  const [showAssignCardsModal, setShowAssignCardsModal] = useState(false);

  const [assignLockedProfileIds, setAssignLockedProfileIds] = useState<string[] | undefined>();

  const [assignLockedCreditCardIds, setAssignLockedCreditCardIds] = useState<string[] | undefined>();

  const [activeMasterId, setActiveMasterId] = useState<string | null>(null);

  const [editingMasterId, setEditingMasterId] = useState<string | null>(null);

  const [generateMasterId, setGenerateMasterId] = useState<string | null>(null);

  const [isCreatingMaster, setIsCreatingMaster] = useState(false);

  const createMasterLockRef = useRef(false);

  const [masterDraft, setMasterDraft] = useState<MasterProfile | null>(null);

  const [showMassDistributeModal, setShowMassDistributeModal] = useState(false);

  const [showExportModal, setShowExportModal] = useState(false);

  const {
    pending: undoConfirm,
    busy: undoConfirmBusy,
    askConfirm: askUndoConfirm,
    closeConfirm: closeUndoConfirm,
    acceptConfirm: acceptUndoConfirm,
  } = useConfirmDelete();



  useEffect(() => {

    if (masterProfiles.length === 0) {

      setActiveMasterId(null);

      return;

    }

    setActiveMasterId((current) =>

      current && masterProfiles.some((master) => master.id === current) ? current : masterProfiles[0].id,

    );

  }, [masterProfiles]);



  const activeMaster = useMemo(

    () => masterProfiles.find((master) => master.id === activeMasterId) ?? masterProfiles[0] ?? null,

    [masterProfiles, activeMasterId],

  );



  const editingMaster = useMemo(

    () =>

      masterProfiles.find((master) => master.id === editingMasterId) ??

      activeMaster ??

      null,

    [masterProfiles, editingMasterId, activeMaster],

  );



  useEffect(() => {

    if (!showMasterEditor && editingMaster) {

      setMasterDraft(editingMaster);

    }

  }, [editingMaster, showMasterEditor]);



  const openMasterEditor = (masterId: string) => {

    const master = masterProfiles.find((item) => item.id === masterId);

    if (!master) return;

    createMasterLockRef.current = false;

    setIsCreatingMaster(false);

    setEditingMasterId(masterId);

    setActiveMasterId(masterId);

    setShowMasterEditor(true);

    setMasterDraft(master);

  };



  const closeMasterEditor = () => {

    setShowMasterEditor(false);

    createMasterLockRef.current = false;

    if (isCreatingMaster) {

      setIsCreatingMaster(false);

      setMasterDraft(null);

      setEditingMasterId(null);

    }

  };



  const handleCreateMaster = () => {

    if (createMasterLockRef.current || (showMasterEditor && isCreatingMaster)) {

      return;

    }

    createMasterLockRef.current = true;

    const master = createEmptyMasterProfile();

    setIsCreatingMaster(true);

    setEditingMasterId(null);

    setMasterDraft(master);

    setShowMasterEditor(true);

  };



  const handleSaveMaster = async (master: MasterProfile) => {

    const isNew = isCreatingMaster;

    await updateMasterProfile(master);

    if (isNew) {

      setIsCreatingMaster(false);

      createMasterLockRef.current = false;

      setActiveMasterId(master.id);

      setShowMasterEditor(false);

      setMasterDraft(null);

      setEditingMasterId(null);

      return;

    }

    setMasterDraft(master);

  };



  const handleDeleteMaster = async (id: string) => {
    await removeMasterProfile(id);
    createMasterLockRef.current = false;
    setIsCreatingMaster(false);
    if (editingMasterId === id) {
      setShowMasterEditor(false);
      setEditingMasterId(null);
      setMasterDraft(null);
    }
    if (activeMasterId === id) {
      setActiveMasterId(null);
    }
  };

  const [generateCategoryId, setGenerateCategoryId] = useState<string | null>(null);

  const openGenerateModal = (masterId: string, categoryId?: string) => {

    setGenerateMasterId(masterId);

    setGenerateCategoryId(categoryId ?? null);

    setActiveMasterId(masterId);

    setShowGenerateModal(true);

  };



  const profileLabelForCredential = (credentialId: string) => {
    const credential = credentials.find((item) => item.id === credentialId);
    if (!credential) return "—";
    return formatLinkedProfileNames(
      profilesMatchingCredential(credential, profiles).map((profile) => profile.name),
    );
  };



  const profileLabelForCard = (cardId: string) => {
    const card = creditCards.find((item) => item.id === cardId);
    if (!card) return "—";
    return formatLinkedProfileNames(profilesMatchingCard(card, profiles).map((profile) => profile.name));
  };



  const exportIds = selectedProfileIds.length > 0 ? selectedProfileIds : profiles.map((profile) => profile.id);



  const rejigIds = selectedProfileIds;



  const distributeProfileIds = useMemo(() => {

    if (rejigIds.length === 0) return [];

    const selectedSet = new Set(rejigIds);

    return profiles.filter((profile) => selectedSet.has(profile.id)).map((profile) => profile.id);

  }, [profiles, rejigIds]);



  const openAssignCardsFromProfiles = () => {

    setAssignLockedProfileIds(distributeProfileIds.length > 0 ? distributeProfileIds : rejigIds);

    setAssignLockedCreditCardIds(undefined);

    setShowAssignCardsModal(true);

  };



  const openAssignCardsFromCardsTab = (creditCardIds: string[]) => {

    setAssignLockedProfileIds(undefined);

    setAssignLockedCreditCardIds(creditCardIds);

    setShowAssignCardsModal(true);

  };

  const handleUndoLast = () => {
    if (!canUndoLastAction || !lastActionLabel) {
      return;
    }
    askUndoConfirm({
      title: "Undo last action",
      message: `Undo "${lastActionLabel}"? The app will restore profiles, cards, accounts, and masters to how they were before that action.`,
      confirmLabel: "Undo last",
      onConfirm: async () => {
        await undoLastAction();
      },
    });
  };



  const closeAssignCardsModal = () => {

    setShowAssignCardsModal(false);

    setAssignLockedProfileIds(undefined);

    setAssignLockedCreditCardIds(undefined);

  };



  const handleSelectedProfileIdsChange = useCallback((ids: string[]) => {

    setSelectedProfileIds(ids);

  }, []);



  return (

    <div className="app-root">

      <AppNav activeTab={activeTab} onTabChange={setActiveTab} />



      <div className="app-body">

        <div className="app-content">

          <header className="app-titlebar">

            <div className="app-titlebar-brand">

              <EpgsAppIcon size={38} className="app-titlebar-icon" />

              <div className="app-titlebar-copy">

                <EpgsLogo showVersion />

                <p className="app-titlebar-context">

                  <span className="app-titlebar-context-module">{TAB_CONTEXT[activeTab].title}</span>

                  <span className="app-titlebar-context-sep" aria-hidden="true">

                    ·

                  </span>

                  <span className="app-titlebar-context-hint">{TAB_CONTEXT[activeTab].hint}</span>

                </p>

              </div>

            </div>

            <div className="app-titlebar-status">

              {loading ? <span className="status-pill">Loading</span> : null}

              {error ? <span className="status-pill error">{error}</span> : null}

              {lastActionLabel ? (
                <span className="app-titlebar-last-action" title={lastActionLabel}>
                  Last: {lastActionLabel}
                </span>
              ) : null}

              <button
                type="button"
                className="btn-secondary btn-compact app-titlebar-undo"
                disabled={!canUndoLastAction}
                title={
                  canUndoLastAction && lastActionLabel
                    ? `Undo: ${lastActionLabel}`
                    : "Nothing to undo"
                }
                onClick={handleUndoLast}
              >
                Undo last
              </button>

            </div>

          </header>



          {activeTab === "profiles" ? (

            <div className="profiles-panel">

              <ProfilesPanel

                profiles={profiles}

                categories={profileCategories}

                masterProfiles={masterProfiles}

                activeMasterId={activeMasterId}

                onActiveMasterChange={setActiveMasterId}

                onLoadProfile={loadProfile}

                onSaveProfiles={saveProfilesBatch}

                onImportProfiles={importProfiles}

                onDeleteProfiles={removeProfiles}

                onSaveCategory={upsertProfileCategory}

                onDeleteCategory={removeProfileCategory}

                onReorderCategories={reorderProfileCategoryOrder}

                onSelectedIdsChange={handleSelectedProfileIdsChange}

                onCreateMaster={handleCreateMaster}

                createMasterDisabled={showMasterEditor && isCreatingMaster}

                onOpenMaster={openMasterEditor}

                onDeleteMaster={handleDeleteMaster}

                onGenerate={openGenerateModal}

                onRejig={() => setShowRejigModal(true)}

                onAssignCards={openAssignCardsFromProfiles}

                onUnassignCards={unassignCards}

                onLastAction={updateLastActionLabel}

                onMassDistribute={() => setShowMassDistributeModal(true)}

                onExport={() => setShowExportModal(true)}

                creditCards={creditCards}

                credentials={credentials}

              />

              <GenerateModal

                open={showGenerateModal}

                masterProfiles={masterProfiles}

                initialMasterId={generateMasterId ?? activeMasterId}

                initialCategoryId={generateCategoryId}

                profileCategories={profileCategories}

                jigPresets={jigPresets}

                creditCards={creditCards}

                onSaveCategory={upsertProfileCategory}

                onClose={() => setShowGenerateModal(false)}

                onGenerate={createProfilesFromMaster}

                onSuccess={(count, masterId) => {

                  const master = masterProfiles.find((item) => item.id === masterId);

                  updateLastActionLabel(

                    `Created ${count} jig profile(s) under ${master ? masterProfileLabel(master) : "master"}.`,

                  );

                  setShowGenerateModal(false);

                }}

              />

              <RejigModal

                open={showRejigModal}

                profileIds={rejigIds}

                profiles={profiles}

                masterProfiles={masterProfiles}

                jigPresets={jigPresets}

                onClose={() => setShowRejigModal(false)}

                onRejig={rejigProfilesFromMaster}

                onSuccess={(result) => {

                  if (result.failedCount > 0) {

                    updateLastActionLabel(

                      `Re-jigged ${result.updatedCount} profile(s). ${result.failedCount} could not get a street line 1 under the 3-per-category limit.`,

                    );

                  } else {

                    updateLastActionLabel(`Re-jigged ${result.updatedCount} profile(s).`);

                  }

                  setShowRejigModal(false);

                }}

              />

            </div>

          ) : null}



          {activeTab === "cards" ? (

            <div className="cards-panel">

              <CreditCardsPanel

                cards={creditCards}

                categories={cardCategories}

                profileLabelForCard={profileLabelForCard}

                onSave={upsertCreditCard}

                onDelete={removeCreditCard}

                onImport={importCards}

                onSaveCategory={upsertCardCategory}

                onDeleteCategory={removeCardCategory}

                onReorderCategories={reorderCardCategoryOrder}

                onAssignSelected={openAssignCardsFromCardsTab}

              />

            </div>

          ) : null}



          {activeTab === "credentials" ? (

            <div className="accounts-panel">

              <CredentialsPanel

                credentials={credentials}

                categories={accountCategories}

                profileLabelForCredential={profileLabelForCredential}

                onSave={upsertCredential}

                onDelete={removeCredential}

                onImport={importCreds}

                onSaveCategory={upsertAccountCategory}

                onDeleteCategory={removeAccountCategory}

                onReorderCategories={reorderAccountCategoryOrder}

              />

            </div>

          ) : null}



          {activeTab === "mail" ? (

            <div className="accounts-panel">

              <MailPanel profiles={profiles} />

            </div>

          ) : null}



          {activeTab === "sessions" ? (

            <BrowserSessionsPanel credentials={credentials} profiles={profiles} />

          ) : null}



          {activeTab === "jigs" ? (

            <div className="panel-scroll">

              <JigPresetsPanel presets={jigPresets} onSave={upsertJigPreset} />

            </div>

          ) : null}



          <ExportModal
            open={showExportModal}
            selectedProfileIds={exportIds}
            exportTemplates={exportTemplates}
            masterProfiles={masterProfiles}
            profileCategories={profileCategories}
            onClose={() => setShowExportModal(false)}
            onSaveTemplate={upsertExportTemplate}
            onLastAction={recordLastAction}
          />



          <AssignCardsModal

            open={showAssignCardsModal}

            cards={creditCards}

            cardCategories={cardCategories}

            profiles={profiles}

            masterProfiles={masterProfiles}

            lockedProfileIds={assignLockedProfileIds}

            lockedCreditCardIds={assignLockedCreditCardIds}

            onClose={closeAssignCardsModal}

            onAssign={assignCards}

            onSuccess={(count) => {

              updateLastActionLabel(`Assigned cards to ${count} profile(s).`);

              closeAssignCardsModal();

            }}

          />



          <MassDistributeModal

            open={showMassDistributeModal}

            profileIds={distributeProfileIds}

            onClose={() => setShowMassDistributeModal(false)}

            onDistribute={massDistributeProfiles}

            onSuccess={(result) => {

              updateLastActionLabel(result.message);

              setShowMassDistributeModal(false);

            }}

          />



          <MasterProfileModal
            open={showMasterEditor && Boolean(masterDraft)}
            isNew={isCreatingMaster}
            master={masterDraft!}
            childCount={
              editingMasterId
                ? profiles.filter((profile) => profile.masterProfileId === editingMasterId).length
                : 0
            }
            onChange={setMasterDraft}
            onSave={handleSaveMaster}
            onDelete={
              editingMasterId && !isCreatingMaster
                ? async () => {
                    await handleDeleteMaster(editingMasterId);
                  }
                : undefined
            }
            onClose={closeMasterEditor}
          />



          <DevModeBanner />

          <ConfirmDeleteModal
            open={Boolean(undoConfirm)}
            title={undoConfirm?.title ?? "Undo last action"}
            message={undoConfirm?.message ?? ""}
            confirmLabel={undoConfirm?.confirmLabel ?? "Undo last"}
            busy={undoConfirmBusy}
            onClose={closeUndoConfirm}
            onConfirm={acceptUndoConfirm}
          />

        </div>

      </div>

    </div>

  );

}



function App() {
  useAppUpdateChecks();
  return (
    <LicenseGate>
      <AppContent />
    </LicenseGate>
  );
}

export default App;


