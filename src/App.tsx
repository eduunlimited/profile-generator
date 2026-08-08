import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AppNav } from "./components/AppNav";

import { CreditCardsPanel } from "./components/CreditCardsPanel";

import { CredentialsPanel } from "./components/CredentialsPanel";

import { DevModeBanner } from "./components/DevModeBanner";

import { ExportModal } from "./components/ExportModal";

import { GenerateModal } from "./components/GenerateModal";

import { AssignCardsModal } from "./components/AssignCardsModal";

import { MassDistributeModal } from "./components/MassDistributeModal";

import { RejigModal } from "./components/RejigModal";

import { JigPresetsPanel } from "./components/JigPresetsPanel";

import { MasterProfileModal } from "./components/MasterProfileModal";

import { ProfilesPanel } from "./components/ProfilesPanel";

import { useAppData } from "./hooks/useAppData";

import { formatLinkedProfileNames } from "./lib/profileNameUtils";

import { profilesMatchingCredential } from "./lib/linkCredentialsByEmail";

import { profilesMatchingCard } from "./lib/creditCardUtils";

import type { AppTab, MasterProfile } from "./lib/types";

import { createEmptyMasterProfile, masterProfileLabel } from "./lib/masterProfileUtils";

import "./App.css";



function App() {

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

    massDistributeProfiles,

    loadProfile,

    saveProfilesBatch,
    importProfiles,

    updateMasterProfile,

    removeMasterProfile,

    removeProfile,

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

  const [generateStatus, setGenerateStatus] = useState<string | null>(null);

  const [rejigStatus, setRejigStatus] = useState<string | null>(null);

  const [assignCardsStatus, setAssignCardsStatus] = useState<string | null>(null);

  const [showMassDistributeModal, setShowMassDistributeModal] = useState(false);

  const [showExportModal, setShowExportModal] = useState(false);

  const [massDistributeStatus, setMassDistributeStatus] = useState<string | null>(null);



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

  const openGenerateModal = (masterId: string) => {

    setGenerateMasterId(masterId);

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

            <div>

              <h1>Profile Generator</h1>

              <span className="app-titlebar-sub">

                Master parent · jig child profiles · cards · export

              </span>

            </div>

            {loading ? <span className="status-pill">Loading</span> : null}

            {error ? <span className="status-pill error">{error}</span> : null}

            {generateStatus ? <span className="status-pill">{generateStatus}</span> : null}

            {rejigStatus ? <span className="status-pill">{rejigStatus}</span> : null}

            {assignCardsStatus ? <span className="status-pill">{assignCardsStatus}</span> : null}

            {massDistributeStatus ? <span className="status-pill">{massDistributeStatus}</span> : null}

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

                onDelete={removeProfile}

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

                onMassDistribute={() => setShowMassDistributeModal(true)}

                onExport={() => setShowExportModal(true)}

                creditCards={creditCards}

                credentials={credentials}

              />

              <GenerateModal

                open={showGenerateModal}

                masterProfiles={masterProfiles}

                initialMasterId={generateMasterId ?? activeMasterId}

                profileCategories={profileCategories}

                jigPresets={jigPresets}

                creditCards={creditCards}

                onSaveCategory={upsertProfileCategory}

                onClose={() => setShowGenerateModal(false)}

                onGenerate={createProfilesFromMaster}

                onSuccess={(count, masterId) => {

                  const master = masterProfiles.find((item) => item.id === masterId);

                  setGenerateStatus(

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

                    setRejigStatus(

                      `Re-jigged ${result.updatedCount} profile(s). ${result.failedCount} could not get a unique street line 1.`,

                    );

                  } else {

                    setRejigStatus(`Re-jigged ${result.updatedCount} profile(s).`);

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



          {activeTab === "jigs" ? (

            <div className="panel-scroll">

              <JigPresetsPanel presets={jigPresets} onSave={upsertJigPreset} />

            </div>

          ) : null}



          <ExportModal
            open={showExportModal}
            selectedProfileIds={exportIds}
            exportTemplates={exportTemplates}
            onClose={() => setShowExportModal(false)}
            onSaveTemplate={upsertExportTemplate}
          />



          <AssignCardsModal

            open={showAssignCardsModal}

            cards={creditCards}

            profiles={profiles}

            masterProfiles={masterProfiles}

            lockedProfileIds={assignLockedProfileIds}

            lockedCreditCardIds={assignLockedCreditCardIds}

            onClose={closeAssignCardsModal}

            onAssign={assignCards}

            onSuccess={(count) => {

              setAssignCardsStatus(`Assigned cards to ${count} profile(s).`);

              closeAssignCardsModal();

            }}

          />



          <MassDistributeModal

            open={showMassDistributeModal}

            profileIds={distributeProfileIds}

            onClose={() => setShowMassDistributeModal(false)}

            onDistribute={massDistributeProfiles}

            onSuccess={(result) => {

              setMassDistributeStatus(result.message);

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

        </div>

      </div>

    </div>

  );

}



export default App;


