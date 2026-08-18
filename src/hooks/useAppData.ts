import { useCallback, useEffect, useRef, useState } from "react";
import {
  deleteCredential,
  deleteCreditCard,
  deleteAccountCategory,
  reorderAccountCategories,
  deleteCardCategory,
  listCardCategories,
  reorderCardCategories,
  deleteProfileCategory,
  listProfileCategories,
  reorderProfileCategories,
  saveCardCategory,
  saveProfileCategory,
  deleteProfile,
  listMasterProfiles,
  getProfile,
  importCredentials,
  importCreditCards,
  listAccountCategories,
  listCredentials,
  listCreditCards,
  listExportTemplates,
  listJigPresets,
  listProfiles,
  loadAllProfiles,
  replaceAllProfiles,
  replaceAllCreditCards,
  replaceAllCredentials,
  replaceAllMasterProfiles,
  saveCredential,
  saveCreditCard,
  saveAccountCategory,
  saveExportTemplate,
  saveJigPreset,
  saveMasterProfile,
  deleteMasterProfile,
  saveProfile,
  saveProfiles,
  seedDefaults,
} from "../lib/api";
import { assignCardsToProfiles, unassignCardsFromProfiles, validateCardAssignments } from "../lib/assignCards";
import {
  credentialLinksChanged,
  syncAllProfileCredentialLinks,
  syncProfileCredentialLinks,
} from "../lib/linkCredentialsByEmail";
import { massDistributeToProfiles, massDistributeSummary } from "../lib/massDistribute";
import { generateProfilesFromMaster } from "../lib/generateFromMaster";
import { generateProfile, generateProfiles } from "../lib/generator";
import {
  createBlankProfile as buildBlankProfile,
  creditCardLinkChanged,
  syncAllProfileCreditCardLinks,
} from "../lib/profileUtils";
import { masterProfileLabel, sortMasterProfiles } from "../lib/masterProfileUtils";
import { resolveAddressJigFromGenerateOptions } from "../lib/jigPresetUtils";
import { sortAccountCategories } from "../lib/accountCategoryUtils";
import { sortCardCategories } from "../lib/cardCategoryUtils";
import {
  assertProfileCategoryUnlocked,
  assertProfilesUnlocked,
  PROFILE_UNCATEGORIZED_CATEGORY_ID,
  sortProfileCategories,
} from "../lib/profileCategoryUtils";
import { BUILTIN_EXPORT_TEMPLATES, BUILTIN_JIG_PRESETS, getJigPresetById, registerJigPreset } from "../lib/presets";
import { rejigProfiles } from "../lib/rejigProfiles";
import type {
  AccountCategory,
  CardCategory,
  Credential,
  CreditCard,
  ExportTemplate,
  GenerateFromMasterOptions,
  GenerateOptions,
  JigPreset,
  Locale,
  MasterProfile,
  Profile,
  ProfileCategory,
  ProfileSummary,
  RejigProfilesOptions,
  RejigProfilesResult,
  AssignCardsOptions,
  MassDistributeOptions,
  MassDistributeResult,
} from "../lib/types";
import { initLocalDataStore } from "../lib/localDataStore";

interface AppUndoSnapshot {
  label: string;
  profiles: Profile[];
  creditCards: CreditCard[];
  credentials: Credential[];
  masterProfiles: MasterProfile[];
}

export function useAppData() {
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [jigPresets, setJigPresets] = useState<JigPreset[]>([]);
  const [exportTemplates, setExportTemplates] = useState<ExportTemplate[]>([]);
  const [masterProfiles, setMasterProfiles] = useState<MasterProfile[]>([]);
  const [creditCards, setCreditCards] = useState<CreditCard[]>([]);
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [accountCategories, setAccountCategories] = useState<AccountCategory[]>([]);
  const [cardCategories, setCardCategories] = useState<CardCategory[]>([]);
  const [profileCategories, setProfileCategories] = useState<ProfileCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const undoRef = useRef<AppUndoSnapshot | null>(null);
  const [canUndoLastAction, setCanUndoLastAction] = useState(false);
  const [lastActionLabel, setLastActionLabel] = useState<string | null>(null);

  const captureAppUndo = useCallback(async (label: string) => {
    const [profiles, creditCards, credentials, masterProfiles] = await Promise.all([
      loadAllProfiles(),
      listCreditCards(),
      listCredentials(),
      listMasterProfiles(),
    ]);
    undoRef.current = {
      label,
      profiles: structuredClone(profiles),
      creditCards: structuredClone(creditCards),
      credentials: structuredClone(credentials),
      masterProfiles: structuredClone(masterProfiles),
    };
    setCanUndoLastAction(true);
    setLastActionLabel(label);
  }, []);

  const recordLastAction = useCallback((label: string) => {
    undoRef.current = null;
    setCanUndoLastAction(false);
    setLastActionLabel(label);
  }, []);

  const updateLastActionLabel = useCallback((label: string) => {
    setLastActionLabel(label);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await initLocalDataStore();
      await seedDefaults(BUILTIN_JIG_PRESETS, BUILTIN_EXPORT_TEMPLATES);
      const [initialProfiles, creds, initialCards] = await Promise.all([
        listProfiles(),
        listCredentials(),
        listCreditCards(),
      ]);
      if (initialProfiles.length > 0) {
        const fullProfiles = await Promise.all(initialProfiles.map((summary) => getProfile(summary.id)));
        let linked = fullProfiles;
        if (creds.length > 0) {
          linked = syncAllProfileCredentialLinks(linked, creds);
        }
        if (initialCards.length > 0) {
          linked = syncAllProfileCreditCardLinks(linked, initialCards);
        }
        const toSave = linked.filter(
          (profile, index) =>
            credentialLinksChanged(fullProfiles[index], profile) ||
            creditCardLinkChanged(fullProfiles[index], profile),
        );
        if (toSave.length > 0) {
          await saveProfiles(toSave);
        }
      }
      const [profileRows, jigRows, templateRows, masters, cards, credentials, categories, cardCats, profileCats] =
        await Promise.all([
        listProfiles(),
        listJigPresets(),
        listExportTemplates(),
        listMasterProfiles(),
        listCreditCards(),
        listCredentials(),
        listAccountCategories(),
        listCardCategories(),
        listProfileCategories(),
      ]);
      setProfiles(profileRows);
      setJigPresets(jigRows as JigPreset[]);
      jigRows.forEach((preset: JigPreset) => registerJigPreset(preset));
      setExportTemplates(templateRows as ExportTemplate[]);
      setMasterProfiles(sortMasterProfiles(masters));
      setCreditCards(cards);
      setCredentials(credentials);
      setAccountCategories(categories);
      setCardCategories(cardCats);
      setProfileCategories(profileCats);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load app data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const undoLastAction = useCallback(async () => {
    const snapshot = undoRef.current;
    if (!snapshot) {
      throw new Error("Nothing to undo.");
    }
    await replaceAllProfiles(snapshot.profiles);
    await replaceAllCreditCards(snapshot.creditCards);
    await replaceAllCredentials(snapshot.credentials);
    await replaceAllMasterProfiles(snapshot.masterProfiles);
    const label = snapshot.label;
    undoRef.current = null;
    setCanUndoLastAction(false);
    setLastActionLabel(`Reverted: ${label}`);
    await refresh();
    return label;
  }, [refresh]);

  const createProfile = useCallback(
    async (options: Partial<GenerateOptions> = {}) => {
      await captureAppUndo("Generate profile");
      const profile = generateProfile(options);
      const creds = await listCredentials();
      await saveProfile(syncProfileCredentialLinks(profile, creds));
      await refresh();
      return profile;
    },
    [captureAppUndo, refresh],
  );

  const createProfiles = useCallback(
    async (options: GenerateOptions) => {
      await captureAppUndo("Generate profiles");
      const generated = generateProfiles(options);
      const creds = await listCredentials();
      await saveProfiles(syncAllProfileCredentialLinks(generated, creds));
      await refresh();
      return generated;
    },
    [captureAppUndo, refresh],
  );

  const createProfilesFromMaster = useCallback(
    async (masterId: string, options: GenerateFromMasterOptions) => {
      await captureAppUndo("Generate jig profiles");
      const master = masterProfiles.find((item) => item.id === masterId);
      if (!master) {
        throw new Error("Master profile not found.");
      }
      if (!options.categoryId?.trim()) {
        throw new Error("Select a category.");
      }
      assertProfileCategoryUnlocked(profileCategories, options.categoryId, "generate profiles into it");

      const namePreset = options.nameJigPresetId
        ? jigPresets.find((p) => p.id === options.nameJigPresetId) ?? getJigPresetById(options.nameJigPresetId) ?? null
        : null;
      const addressJig = resolveAddressJigFromGenerateOptions(options, jigPresets);
      const categoryId = options.categoryId.trim();
      const existingInCategory = await Promise.all(
        profiles
          .filter(
            (profile) => (profile.categoryId || PROFILE_UNCATEGORIZED_CATEGORY_ID) === categoryId,
          )
          .map((profile) => getProfile(profile.id)),
      );
      const generated = await generateProfilesFromMaster(
        master,
        options,
        namePreset,
        addressJig,
        creditCards,
        existingInCategory,
      );
      const linked = syncAllProfileCredentialLinks(generated, credentials);
      await saveProfiles(linked);
      await refresh();
      return linked.length;
    },
    [captureAppUndo, creditCards, credentials, jigPresets, masterProfiles, profileCategories, profiles, refresh],
  );

  const rejigProfilesFromMaster = useCallback(
    async (options: RejigProfilesOptions): Promise<RejigProfilesResult> => {
      if (options.profileIds.length === 0) {
        throw new Error("Select at least one profile to re-jig.");
      }

      const namePreset = options.nameJigPresetId
        ? jigPresets.find((p) => p.id === options.nameJigPresetId) ?? getJigPresetById(options.nameJigPresetId) ?? null
        : null;
      const addressJig = resolveAddressJigFromGenerateOptions(options, jigPresets);

      const allProfiles = await Promise.all(profiles.map((summary) => getProfile(summary.id)));
      const profilesToUpdate = allProfiles.filter((profile) => options.profileIds.includes(profile.id));

      if (profilesToUpdate.length === 0) {
        throw new Error("Selected profiles could not be loaded.");
      }
      assertProfilesUnlocked(profileCategories, profilesToUpdate, "re-jig profiles in it");

      const masterMap = new Map(masterProfiles.map((master) => [master.id, master]));
      const profilesMissingMaster = profilesToUpdate.filter(
        (profile) => !profile.masterProfileId || !masterMap.has(profile.masterProfileId),
      );
      if (profilesMissingMaster.length > 0) {
        throw new Error("Selected profiles must be linked to a master profile to re-jig.");
      }

      const profilesByMaster = new Map<string, Profile[]>();
      for (const profile of profilesToUpdate) {
        const masterId = profile.masterProfileId!;
        const bucket = profilesByMaster.get(masterId) ?? [];
        bucket.push(profile);
        profilesByMaster.set(masterId, bucket);
      }

      const updated: Profile[] = [];
      const failedIds: string[] = [];

      for (const [masterId, bucket] of profilesByMaster) {
        const master = masterMap.get(masterId)!;
        const result = await rejigProfiles(master, bucket, allProfiles, namePreset, addressJig, {
          nameMisspellScope: options.nameMisspellScope,
          phoneJigLastFour: options.phoneJigLastFour,
        });
        updated.push(...result.updated);
        failedIds.push(...result.failedIds);
      }

      if (updated.length > 0) {
        const creds = await listCredentials();
        await captureAppUndo("Re-jig profiles");
        await saveProfiles(syncAllProfileCredentialLinks(updated, creds));
        await refresh();
      }

      if (updated.length === 0 && failedIds.length > 0) {
        throw new Error("Could not find unique jigs for the selected profiles. Try different presets.");
      }

      return {
        updatedCount: updated.length,
        failedCount: failedIds.length,
      };
    },
    [captureAppUndo, jigPresets, masterProfiles, profileCategories, profiles, refresh],
  );

  const assignCards = useCallback(
    async (options: AssignCardsOptions): Promise<number> => {
      if (options.profileIds.length === 0) {
        throw new Error("Select at least one profile.");
      }

      const isBatch = Boolean(options.creditCardIds?.length);
      if (!isBatch && !options.creditCardId) {
        throw new Error("Select at least one card.");
      }
      if (isBatch && options.creditCardIds!.length !== options.profileIds.length) {
        throw new Error("Select one card per profile.");
      }

      const allProfiles = await Promise.all(profiles.map((summary) => getProfile(summary.id)));
      const profileMap = new Map(allProfiles.map((profile) => [profile.id, profile]));
      const profilesToUpdate = options.profileIds
        .map((id) => profileMap.get(id))
        .filter((profile): profile is Profile => Boolean(profile));

      if (profilesToUpdate.length === 0) {
        throw new Error("Selected profiles could not be loaded.");
      }
      assertProfilesUnlocked(profileCategories, profilesToUpdate, "assign cards in it");

      const assignmentCardIds = isBatch
        ? options.creditCardIds!
        : options.profileIds.map(() => options.creditCardId!);
      const validationError = validateCardAssignments(
        options.profileIds,
        assignmentCardIds,
        creditCards,
        allProfiles,
      );
      if (validationError) {
        throw new Error(validationError);
      }

      const updated = assignCardsToProfiles(profilesToUpdate, allProfiles, creditCards, options);
      if (updated.length === 0) {
        throw new Error("No profiles were updated.");
      }

      await captureAppUndo("Assign cards");
      await saveProfiles(updated);
      await refresh();
      return profilesToUpdate.length;
    },
    [captureAppUndo, creditCards, profileCategories, profiles, refresh],
  );

  const unassignCards = useCallback(
    async (profileIds: string[]): Promise<number> => {
      if (profileIds.length === 0) {
        throw new Error("Select at least one profile.");
      }

      const allProfiles = await Promise.all(profiles.map((summary) => getProfile(summary.id)));
      const profileMap = new Map(allProfiles.map((profile) => [profile.id, profile]));
      const profilesToUpdate = profileIds
        .map((id) => profileMap.get(id))
        .filter((profile): profile is Profile => Boolean(profile));

      if (profilesToUpdate.length === 0) {
        throw new Error("Selected profiles could not be loaded.");
      }
      assertProfilesUnlocked(profileCategories, profilesToUpdate, "unassign cards in it");

      const updated = unassignCardsFromProfiles(profilesToUpdate);
      if (updated.length === 0) {
        throw new Error("Selected profiles have no cards assigned.");
      }

      await captureAppUndo("Unassign cards");
      await saveProfiles(updated);
      await refresh();
      return updated.length;
    },
    [captureAppUndo, profileCategories, profiles, refresh],
  );

  const massDistributeProfiles = useCallback(
    async (options: MassDistributeOptions): Promise<MassDistributeResult> => {
      if (options.profileIds.length === 0) {
        throw new Error("Select at least one profile.");
      }
      if (options.lines.length === 0) {
        throw new Error("Paste at least one line.");
      }

      const profileMap = new Map(
        (await Promise.all(profiles.map((summary) => getProfile(summary.id)))).map((profile) => [
          profile.id,
          profile,
        ]),
      );
      const profilesInOrder = options.profileIds
        .map((id) => profileMap.get(id))
        .filter((profile): profile is Profile => Boolean(profile));

      if (profilesInOrder.length === 0) {
        throw new Error("Selected profiles could not be loaded.");
      }
      assertProfilesUnlocked(profileCategories, profilesInOrder, "mass-distribute into it");

      const creds = await listCredentials();
      const result = massDistributeToProfiles(profilesInOrder, options.lines, options, creditCards, creds);

      if (result.updated.length === 0) {
        throw new Error("Nothing was distributed.");
      }

      await captureAppUndo("Mass distribute");
      for (const credential of result.updatedCredentials) {
        await saveCredential(credential);
      }

      const refreshedCreds = await listCredentials();
      await saveProfiles(syncAllProfileCredentialLinks(result.updated, refreshedCreds));
      await refresh();

      return {
        appliedCount: result.appliedCount,
        skippedLines: result.skippedLines,
        skippedProfiles: result.skippedProfiles,
        message: massDistributeSummary({
          ...result,
          updatedCredentialCount: result.updatedCredentials.length,
        }),
      };
    },
    [captureAppUndo, creditCards, profileCategories, profiles, refresh],
  );

  const createBlankProfile = useCallback(async () => {
    await captureAppUndo("Create blank profile");
    const profile = buildBlankProfile();
    const creds = await listCredentials();
    await saveProfile(syncProfileCredentialLinks(profile, creds));
    await refresh();
    return profile;
  }, [captureAppUndo, refresh]);

  const removeProfiles = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0) {
        return;
      }
      const toDelete = profiles.filter((profile) => ids.includes(profile.id));
      assertProfilesUnlocked(profileCategories, toDelete, "delete profiles in it");
      await captureAppUndo(ids.length === 1 ? "Delete profile" : "Delete profiles");
      for (const id of ids) {
        await deleteProfile(id);
      }
      await refresh();
    },
    [captureAppUndo, profileCategories, profiles, refresh],
  );

  const removeProfile = useCallback(
    async (id: string) => {
      await removeProfiles([id]);
    },
    [removeProfiles],
  );

  const loadProfile = useCallback(async (id: string) => getProfile(id), []);

  const updateProfile = useCallback(
    async (profile: Profile) => {
      const existing = profiles.find((item) => item.id === profile.id);
      if (existing) {
        assertProfileCategoryUnlocked(profileCategories, existing.categoryId, "edit profiles in it");
      }
      assertProfileCategoryUnlocked(profileCategories, profile.categoryId, "save profiles into it");
      await captureAppUndo("Save profile");
      const creds = await listCredentials();
      const linked = syncProfileCredentialLinks(profile, creds);
      await saveProfile({ ...linked, updatedAt: new Date().toISOString() });
      await refresh();
    },
    [captureAppUndo, profileCategories, profiles, refresh],
  );

  const saveProfilesBatch = useCallback(
    async (profilesToSave: Profile[], undoLabel = "Update profiles") => {
      const existingById = new Map(profiles.map((profile) => [profile.id, profile]));
      for (const next of profilesToSave) {
        const existing = existingById.get(next.id);
        if (existing) {
          assertProfileCategoryUnlocked(profileCategories, existing.categoryId, "edit profiles in it");
        }
        assertProfileCategoryUnlocked(profileCategories, next.categoryId, "add or move profiles into it");
      }
      await captureAppUndo(undoLabel);
      const now = new Date().toISOString();
      const creds = await listCredentials();
      await saveProfiles(
        profilesToSave.map((profile) => ({
          ...syncProfileCredentialLinks(profile, creds),
          updatedAt: now,
        })),
      );
      await refresh();
    },
    [captureAppUndo, profileCategories, profiles, refresh],
  );

  const importProfiles = useCallback(
    async (profilesToImport: Profile[]) => {
      await saveProfilesBatch(profilesToImport, "Import profiles");
    },
    [saveProfilesBatch],
  );

  const updateMasterProfile = useCallback(async (master: MasterProfile) => {
    await captureAppUndo("Save master profile");
    await saveMasterProfile(master);
    setMasterProfiles((current) =>
      sortMasterProfiles([...current.filter((item) => item.id !== master.id), master]),
    );
    await refresh();
  }, [captureAppUndo, refresh]);

  const removeMasterProfile = useCallback(
    async (id: string) => {
      const childCount = profiles.filter((profile) => profile.masterProfileId === id).length;
      if (childCount > 0) {
        throw new Error("Delete or reassign jig profiles before deleting this master.");
      }
      await captureAppUndo("Delete master profile");
      await deleteMasterProfile(id);
      await refresh();
    },
    [captureAppUndo, profiles, refresh],
  );

  const upsertCreditCard = useCallback(
    async (card: CreditCard) => {
      await captureAppUndo("Save credit card");
      await saveCreditCard(card);
      await refresh();
    },
    [captureAppUndo, refresh],
  );

  const removeCreditCard = useCallback(
    async (id: string) => {
      await captureAppUndo("Delete credit card");
      await deleteCreditCard(id);
      await refresh();
    },
    [captureAppUndo, refresh],
  );

  const importCards = useCallback(
    async (cards: CreditCard[]) => {
      await captureAppUndo("Import credit cards");
      await importCreditCards(cards);
      await refresh();
    },
    [captureAppUndo, refresh],
  );

  const upsertCredential = useCallback(
    async (credential: Credential) => {
      await captureAppUndo("Save account");
      await saveCredential(credential);
      await refresh();
    },
    [captureAppUndo, refresh],
  );

  const removeCredential = useCallback(
    async (id: string) => {
      await captureAppUndo("Delete account");
      await deleteCredential(id);
      await refresh();
    },
    [captureAppUndo, refresh],
  );

  const importCreds = useCallback(
    async (items: Credential[]) => {
      await captureAppUndo("Import accounts");
      await importCredentials(items);
      await refresh();
    },
    [captureAppUndo, refresh],
  );

  const upsertAccountCategory = useCallback(
    async (category: AccountCategory) => {
      await saveAccountCategory(category);
      setAccountCategories((current) =>
        sortAccountCategories([...current.filter((item) => item.id !== category.id), category]),
      );
    },
    [],
  );

  const removeAccountCategory = useCallback(
    async (id: string) => {
      await deleteAccountCategory(id);
      const categories = await listAccountCategories();
      setAccountCategories(categories);
    },
    [],
  );

  const reorderAccountCategoryOrder = useCallback(async (orderedIds: string[]) => {
    await reorderAccountCategories(orderedIds);
    const categories = await listAccountCategories();
    setAccountCategories(categories);
  }, []);

  const upsertCardCategory = useCallback(async (category: CardCategory) => {
    await saveCardCategory(category);
    setCardCategories((current) =>
      sortCardCategories([...current.filter((item) => item.id !== category.id), category]),
    );
  }, []);

  const removeCardCategory = useCallback(async (id: string) => {
    await deleteCardCategory(id);
    const categories = await listCardCategories();
    setCardCategories(categories);
  }, []);

  const reorderCardCategoryOrder = useCallback(async (orderedIds: string[]) => {
    await reorderCardCategories(orderedIds);
    const categories = await listCardCategories();
    setCardCategories(categories);
  }, []);

  const upsertProfileCategory = useCallback(async (category: ProfileCategory) => {
    await saveProfileCategory(category);
    setProfileCategories((current) =>
      sortProfileCategories([...current.filter((item) => item.id !== category.id), category]),
    );
  }, []);

  const removeProfileCategory = useCallback(async (id: string) => {
    await deleteProfileCategory(id);
    const categories = await listProfileCategories();
    setProfileCategories(categories);
  }, []);

  const reorderProfileCategoryOrder = useCallback(async (orderedIds: string[]) => {
    await reorderProfileCategories(orderedIds);
    const categories = await listProfileCategories();
    setProfileCategories(categories);
  }, []);

  const upsertJigPreset = useCallback(
    async (preset: JigPreset) => {
      await captureAppUndo("Save jig preset");
      await saveJigPreset(preset);
      registerJigPreset(preset);
      await refresh();
    },
    [captureAppUndo, refresh],
  );

  const upsertExportTemplate = useCallback(
    async (template: ExportTemplate) => {
      await saveExportTemplate(template);
      await refresh();
    },
    [refresh],
  );

  return {
    profiles,
    jigPresets,
    exportTemplates,
    masterProfiles,
    masterProfileLabel: (master: MasterProfile) => masterProfileLabel(master),
    creditCards,
    credentials,
    accountCategories,
    cardCategories,
    profileCategories,
    loading,
    error,
    refresh,
    createProfile,
    createProfiles,
    createProfilesFromMaster,
    rejigProfilesFromMaster,
    assignCards,
    unassignCards,
    massDistributeProfiles,
    createBlankProfile,
    removeProfile,
    removeProfiles,
    loadProfile,
    updateProfile,
    saveProfilesBatch,
    importProfiles,
    updateMasterProfile,
    removeMasterProfile,
    upsertCreditCard,
    removeCreditCard,
    importCards,
    upsertCredential,
    removeCredential,
    importCreds,
    upsertAccountCategory,
    removeAccountCategory,
    reorderAccountCategoryOrder,
    upsertCardCategory,
    removeCardCategory,
    reorderCardCategoryOrder,
    upsertProfileCategory,
    removeProfileCategory,
    reorderProfileCategoryOrder,
    upsertJigPreset,
    upsertExportTemplate,
    canUndoLastAction,
    lastActionLabel,
    recordLastAction,
    updateLastActionLabel,
    undoLastAction,
  };
}

export function copyToClipboard(value: string) {
  return navigator.clipboard.writeText(value);
}

export const LOCALES: { value: Locale; label: string }[] = [
  { value: "en_US", label: "United States" },
  { value: "en_GB", label: "United Kingdom" },
  { value: "en_CA", label: "Canada" },
];
