import { useCallback, useEffect, useState } from "react";
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
import { assignCardsToProfiles } from "../lib/assignCards";
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
import { PROFILE_UNCATEGORIZED_CATEGORY_ID, sortProfileCategories } from "../lib/profileCategoryUtils";
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

  const createProfile = useCallback(
    async (options: Partial<GenerateOptions> = {}) => {
      const profile = generateProfile(options);
      const creds = await listCredentials();
      await saveProfile(syncProfileCredentialLinks(profile, creds));
      await refresh();
      return profile;
    },
    [refresh],
  );

  const createProfiles = useCallback(
    async (options: GenerateOptions) => {
      const generated = generateProfiles(options);
      const creds = await listCredentials();
      await saveProfiles(syncAllProfileCredentialLinks(generated, creds));
      await refresh();
      return generated;
    },
    [refresh],
  );

  const createProfilesFromMaster = useCallback(
    async (masterId: string, options: GenerateFromMasterOptions) => {
      const master = masterProfiles.find((item) => item.id === masterId);
      if (!master) {
        throw new Error("Master profile not found.");
      }
      if (!options.categoryId?.trim()) {
        throw new Error("Select a category.");
      }

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
      const existingChildCount = profiles.filter((profile) => profile.masterProfileId === masterId).length;
      const generated = await generateProfilesFromMaster(
        master,
        options,
        namePreset,
        addressJig,
        creditCards,
        existingInCategory,
        existingChildCount,
      );
      const linked = syncAllProfileCredentialLinks(generated, credentials);
      await saveProfiles(linked);
      await refresh();
      return linked.length;
    },
    [creditCards, credentials, jigPresets, masterProfiles, profiles, refresh],
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
    [jigPresets, masterProfiles, profiles, refresh],
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

      const updated = assignCardsToProfiles(profilesToUpdate, allProfiles, creditCards, options);
      if (updated.length === 0) {
        throw new Error("No profiles were updated.");
      }

      await saveProfiles(updated);
      await refresh();
      return profilesToUpdate.length;
    },
    [creditCards, profiles, refresh],
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

      const creds = await listCredentials();
      const result = massDistributeToProfiles(profilesInOrder, options.lines, options, creditCards, creds);

      if (result.updated.length === 0) {
        throw new Error("Nothing was distributed.");
      }

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
    [creditCards, profiles, refresh],
  );

  const createBlankProfile = useCallback(async () => {
    const profile = buildBlankProfile();
    const creds = await listCredentials();
    await saveProfile(syncProfileCredentialLinks(profile, creds));
    await refresh();
    return profile;
  }, [refresh]);

  const removeProfile = useCallback(
    async (id: string) => {
      await deleteProfile(id);
      await refresh();
    },
    [refresh],
  );

  const loadProfile = useCallback(async (id: string) => getProfile(id), []);

  const updateProfile = useCallback(
    async (profile: Profile) => {
      const creds = await listCredentials();
      const linked = syncProfileCredentialLinks(profile, creds);
      await saveProfile({ ...linked, updatedAt: new Date().toISOString() });
      await refresh();
    },
    [refresh],
  );

  const saveProfilesBatch = useCallback(
    async (profilesToSave: Profile[]) => {
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
    [refresh],
  );

  const importProfiles = useCallback(
    async (profilesToImport: Profile[]) => {
      await saveProfilesBatch(profilesToImport);
    },
    [saveProfilesBatch],
  );

  const updateMasterProfile = useCallback(async (master: MasterProfile) => {
    await saveMasterProfile(master);
    setMasterProfiles((current) =>
      sortMasterProfiles([...current.filter((item) => item.id !== master.id), master]),
    );
  }, []);

  const removeMasterProfile = useCallback(
    async (id: string) => {
      const childCount = profiles.filter((profile) => profile.masterProfileId === id).length;
      if (childCount > 0) {
        throw new Error("Delete or reassign jig profiles before deleting this master.");
      }
      await deleteMasterProfile(id);
      await refresh();
    },
    [profiles, refresh],
  );

  const upsertCreditCard = useCallback(
    async (card: CreditCard) => {
      await saveCreditCard(card);
      await refresh();
    },
    [refresh],
  );

  const removeCreditCard = useCallback(
    async (id: string) => {
      await deleteCreditCard(id);
      await refresh();
    },
    [refresh],
  );

  const importCards = useCallback(
    async (cards: CreditCard[]) => {
      await importCreditCards(cards);
      await refresh();
    },
    [refresh],
  );

  const upsertCredential = useCallback(
    async (credential: Credential) => {
      await saveCredential(credential);
      await refresh();
    },
    [refresh],
  );

  const removeCredential = useCallback(
    async (id: string) => {
      await deleteCredential(id);
      await refresh();
    },
    [refresh],
  );

  const importCreds = useCallback(
    async (items: Credential[]) => {
      await importCredentials(items);
      await refresh();
    },
    [refresh],
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
      await saveJigPreset(preset);
      registerJigPreset(preset);
      await refresh();
    },
    [refresh],
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
    massDistributeProfiles,
    createBlankProfile,
    removeProfile,
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
