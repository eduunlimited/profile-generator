import { useCallback, useEffect, useRef, useState } from "react";
import {
  deleteCredential,
  deleteCreditCard,
  deleteAccountCategory,
  reorderAccountCategories,
  deleteCardCategory,
  listCardCategories,
  reorderCardCategories,
  deleteEmailCategory,
  listEmailCategories,
  reorderEmailCategories,
  listPoolEmails,
  savePoolEmail,
  deletePoolEmail,
  importPoolEmails,
  replaceAllPoolEmails,
  saveEmailCategory,
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
  getGeocodioSettings,
} from "../lib/api";
import {
  clearStaleAddressCheck,
  errorAddressCheck,
  profileNeedsAddressVerify,
  progressAddressCheck,
} from "../lib/addressCheck";
import {
  formatAddressVerifySummary,
  REJIG_UNTIL_PASS_ATTEMPTS,
  verifyProfileAddresses,
} from "../lib/runAddressVerification";
import { assignCardsToProfiles, unassignCardsFromProfiles, validateCardAssignments } from "../lib/assignCards";
import { assignEmailsToProfiles, unassignEmailsFromProfiles, validateEmailAssignments } from "../lib/assignEmails";
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
  emailLinkChanged,
  syncAllProfileCreditCardLinks,
  syncAllProfileEmailLinks,
} from "../lib/profileUtils";
import { masterProfileLabel, sortMasterProfiles } from "../lib/masterProfileUtils";
import { resolveAddressJigFromGenerateOptions, type ResolvedAddressJig } from "../lib/jigPresetUtils";
import { sortAccountCategories } from "../lib/accountCategoryUtils";
import { sortCardCategories } from "../lib/cardCategoryUtils";
import { sortEmailCategories } from "../lib/emailCategoryUtils";
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
  EmailCategory,
  ExportTemplate,
  GenerateFromMasterOptions,
  GenerateOptions,
  JigPreset,
  Locale,
  MasterProfile,
  PoolEmail,
  Profile,
  ProfileCategory,
  ProfileSummary,
  RejigProfilesOptions,
  RejigProfilesResult,
  AssignCardsOptions,
  AssignEmailsOptions,
  MassDistributeOptions,
  MassDistributeResult,
} from "../lib/types";
import { initLocalDataStore } from "../lib/localDataStore";

interface AppUndoSnapshot {
  label: string;
  profiles: Profile[];
  creditCards: CreditCard[];
  poolEmails: PoolEmail[];
  credentials: Credential[];
  masterProfiles: MasterProfile[];
}

export function useAppData() {
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [jigPresets, setJigPresets] = useState<JigPreset[]>([]);
  const [exportTemplates, setExportTemplates] = useState<ExportTemplate[]>([]);
  const [masterProfiles, setMasterProfiles] = useState<MasterProfile[]>([]);
  const [creditCards, setCreditCards] = useState<CreditCard[]>([]);
  const [poolEmails, setPoolEmails] = useState<PoolEmail[]>([]);
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [accountCategories, setAccountCategories] = useState<AccountCategory[]>([]);
  const [cardCategories, setCardCategories] = useState<CardCategory[]>([]);
  const [emailCategories, setEmailCategories] = useState<EmailCategory[]>([]);
  const [profileCategories, setProfileCategories] = useState<ProfileCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const undoRef = useRef<AppUndoSnapshot | null>(null);
  const [canUndoLastAction, setCanUndoLastAction] = useState(false);
  const [lastActionLabel, setLastActionLabel] = useState<string | null>(null);
  const [geocodioConfigured, setGeocodioConfigured] = useState(false);
  const [addressVerifyBusy, setAddressVerifyBusy] = useState(false);
  const [addressJobKind, setAddressJobKind] = useState<"idle" | "verify" | "rejig">("idle");
  const [addressJobStatus, setAddressJobStatus] = useState<string | null>(null);
  const [addressJobTone, setAddressJobTone] = useState<"info" | "error" | "success">("info");
  const verifyChainRef = useRef(Promise.resolve());
  const verifyBusyCountRef = useRef(0);

  const captureAppUndo = useCallback(async (label: string) => {
    const [profiles, creditCards, poolEmails, credentials, masterProfiles] = await Promise.all([
      loadAllProfiles(),
      listCreditCards(),
      listPoolEmails(),
      listCredentials(),
      listMasterProfiles(),
    ]);
    undoRef.current = {
      label,
      profiles: structuredClone(profiles),
      creditCards: structuredClone(creditCards),
      poolEmails: structuredClone(poolEmails),
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

  const announceAddressJob = useCallback(
    (text: string, tone: "info" | "error" | "success" = "info") => {
      setAddressJobStatus(text);
      setAddressJobTone(tone);
      updateLastActionLabel(text);
    },
    [updateLastActionLabel],
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await initLocalDataStore();
      await seedDefaults(BUILTIN_JIG_PRESETS, BUILTIN_EXPORT_TEMPLATES);
      const [initialProfiles, creds, initialCards, initialEmails] = await Promise.all([
        listProfiles(),
        listCredentials(),
        listCreditCards(),
        listPoolEmails(),
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
        if (initialEmails.length > 0) {
          linked = syncAllProfileEmailLinks(linked, initialEmails);
        }
        const toSave = linked.filter(
          (profile, index) =>
            credentialLinksChanged(fullProfiles[index], profile) ||
            creditCardLinkChanged(fullProfiles[index], profile) ||
            emailLinkChanged(fullProfiles[index], profile),
        );
        if (toSave.length > 0) {
          await saveProfiles(toSave);
        }
      }
      const [
        profileRows,
        jigRows,
        templateRows,
        masters,
        cards,
        emails,
        credentials,
        categories,
        cardCats,
        emailCats,
        profileCats,
      ] = await Promise.all([
        listProfiles(),
        listJigPresets(),
        listExportTemplates(),
        listMasterProfiles(),
        listCreditCards(),
        listPoolEmails(),
        listCredentials(),
        listAccountCategories(),
        listCardCategories(),
        listEmailCategories(),
        listProfileCategories(),
      ]);
      setProfiles(profileRows);
      setJigPresets(jigRows as JigPreset[]);
      jigRows.forEach((preset: JigPreset) => registerJigPreset(preset));
      setExportTemplates(templateRows as ExportTemplate[]);
      setMasterProfiles(sortMasterProfiles(masters));
      setCreditCards(cards);
      setPoolEmails(emails);
      setCredentials(credentials);
      setAccountCategories(categories);
      setCardCategories(cardCats);
      setEmailCategories(emailCats);
      setProfileCategories(profileCats);
      const geocodio = await getGeocodioSettings();
      setGeocodioConfigured(Boolean(geocodio.apiKey.trim()));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load app data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const refreshProfileSummaries = useCallback(async () => {
    setProfiles(await listProfiles());
  }, []);

  const enqueueAddressVerify = useCallback(
    (
      ids: string[],
      options?: { force?: boolean; requireKey?: boolean; announce?: boolean },
    ) => {
      const uniqueIds = [...new Set(ids.filter(Boolean))];
      if (uniqueIds.length === 0) return Promise.resolve();

      const run = async () => {
        verifyBusyCountRef.current += 1;
        setAddressJobKind("verify");
        setAddressVerifyBusy(true);
        if (options?.announce !== false) {
          announceAddressJob("Checking selected addresses…");
        }
        try {
          const summary = await verifyProfileAddresses(uniqueIds, {
            force: options?.force,
            requireKey: options?.requireKey,
            onProgress: refreshProfileSummaries,
          });
          await refreshProfileSummaries();
          if (options?.announce !== false && summary.checked > 0) {
            announceAddressJob(formatAddressVerifySummary(summary), "success");
          }
        } catch (error) {
          if (options?.requireKey === false) return;
          const message = error instanceof Error ? error.message : "Address verify failed.";
          announceAddressJob(message, "error");
          throw error;
        } finally {
          verifyBusyCountRef.current -= 1;
          if (verifyBusyCountRef.current <= 0) {
            verifyBusyCountRef.current = 0;
            setAddressVerifyBusy(false);
            setAddressJobKind("idle");
          }
        }
      };

      const next = verifyChainRef.current.then(run, run);
      verifyChainRef.current = next.then(
        () => undefined,
        () => undefined,
      );
      return next;
    },
    [announceAddressJob, refreshProfileSummaries],
  );

  const verifyAddresses = useCallback(
    async (ids: string[], options?: { force?: boolean }) => {
      await enqueueAddressVerify(ids, {
        force: options?.force ?? true,
        requireKey: true,
        announce: true,
      });
    },
    [enqueueAddressVerify],
  );

  const continueRejigUntilPass = useCallback(
    async (ids: string[], addressJig: ResolvedAddressJig): Promise<string> => {
      const stampWorking = async (profiles: Profile[], displayLabel: string, message: string) => {
        if (profiles.length === 0) return;
        await saveProfiles(
          profiles.map((profile) => ({
            ...profile,
            addressCheck: progressAddressCheck(profile, displayLabel, message),
          })),
        );
        await refreshProfileSummaries();
      };

      const run = async (): Promise<string> => {
        verifyBusyCountRef.current += 1;
        setAddressJobKind("rejig");
        setAddressVerifyBusy(true);
        let remaining: Profile[] = [];
        try {
          const loaded = (
            await Promise.all(ids.map((id) => getProfile(id).catch(() => null)))
          ).filter((profile): profile is Profile => Boolean(profile));
          remaining = loaded;
          if (remaining.length === 0) {
            throw new Error("Selected profiles could not be loaded.");
          }

          const startingCount = remaining.length;
          const masterMap = new Map(masterProfiles.map((master) => [master.id, master]));

          announceAddressJob(`Checking ${startingCount} address(es), attempt 1 of ${REJIG_UNTIL_PASS_ATTEMPTS}…`);
          await stampWorking(
            remaining,
            "Checking",
            `Checking address, attempt 1 of ${REJIG_UNTIL_PASS_ATTEMPTS}…`,
          );
          await verifyProfileAddresses(
            remaining.map((profile) => profile.id),
            { force: true, requireKey: true, onProgress: refreshProfileSummaries },
          );
          await refreshProfileSummaries();
          remaining = (
            await Promise.all(remaining.map((profile) => getProfile(profile.id)))
          ).filter((profile) => profile.addressCheck?.status !== "pass");

          for (let attempt = 1; attempt < REJIG_UNTIL_PASS_ATTEMPTS && remaining.length > 0; attempt += 1) {
            const attemptLabel = `attempt ${attempt + 1} of ${REJIG_UNTIL_PASS_ATTEMPTS}`;
            announceAddressJob(`Re-jigging ${remaining.length} address(es), ${attemptLabel}…`);
            const allProfiles = await loadAllProfiles();
            const current = remaining
              .map((profile) => allProfiles.find((item) => item.id === profile.id))
              .filter((profile): profile is Profile => Boolean(profile));
            await stampWorking(current, "Re-jigging", `Re-jigging address, ${attemptLabel}…`);

            const updated: Profile[] = [];
            const failedIds: string[] = [];
            const groups = new Map<string, Profile[]>();
            for (const profile of current) {
              const key = profile.masterProfileId ?? "";
              const bucket = groups.get(key) ?? [];
              bucket.push(profile);
              groups.set(key, bucket);
            }

            for (const group of groups.values()) {
              const master = masterMap.get(group[0].masterProfileId ?? "");
              if (!master) continue;
              const result = await rejigProfiles(master, group, allProfiles, null, addressJig, {});
              updated.push(...result.updated);
              failedIds.push(...result.failedIds);
              for (const next of result.updated) {
                const index = allProfiles.findIndex((profile) => profile.id === next.id);
                if (index >= 0) allProfiles[index] = next;
              }
            }

            if (failedIds.length > 0) {
              const failed = current.filter((profile) => failedIds.includes(profile.id));
              await saveProfiles(
                failed.map((profile) => ({
                  ...profile,
                  addressCheck: errorAddressCheck(profile, "Could not produce a unique jigged address."),
                })),
              );
            }

            if (updated.length > 0) {
              const creds = await listCredentials();
              await saveProfiles(
                syncAllProfileCredentialLinks(updated, creds).map((profile) => ({
                  ...profile,
                  addressCheck: progressAddressCheck(profile, "Checking", `Checking address, ${attemptLabel}…`),
                })),
              );
              await refreshProfileSummaries();
            }

            announceAddressJob(`Checking ${remaining.length} address(es), ${attemptLabel}…`);
            await verifyProfileAddresses(
              remaining.map((profile) => profile.id),
              { force: true, requireKey: true, onProgress: refreshProfileSummaries },
            );
            await refreshProfileSummaries();
            remaining = (
              await Promise.all(remaining.map((profile) => getProfile(profile.id)))
            ).filter((profile) => profile.addressCheck?.status !== "pass");
          }

          const still = remaining.length;
          const passed = startingCount - still;
          const message =
            still === 0
              ? `All ${passed} profile(s) reached Pass.`
              : `${passed} Pass, ${still} still Fail/Warn after ${REJIG_UNTIL_PASS_ATTEMPTS} re-jig attempts.`;
          announceAddressJob(message, still === 0 ? "success" : "error");
          return message;
        } catch (error) {
          const message = error instanceof Error ? error.message : "Re-jig until pass failed.";
          announceAddressJob(message, "error");
          if (remaining.length > 0) {
            try {
              const latest = (
                await Promise.all(remaining.map((profile) => getProfile(profile.id).catch(() => null)))
              ).filter((profile): profile is Profile => Boolean(profile));
              await saveProfiles(
                latest
                  .filter((profile) => profile.addressCheck?.status === "queued")
                  .map((profile) => ({
                    ...profile,
                    addressCheck: errorAddressCheck(profile, message),
                  })),
              );
              await refreshProfileSummaries();
            } catch {
              // Keep the toolbar error even if the stamp fails.
            }
          }
          throw error;
        } finally {
          verifyBusyCountRef.current -= 1;
          if (verifyBusyCountRef.current <= 0) {
            verifyBusyCountRef.current = 0;
            setAddressVerifyBusy(false);
            setAddressJobKind("idle");
          }
          await refreshProfileSummaries();
        }
      };

      const next = verifyChainRef.current.then(run, run);
      verifyChainRef.current = next.then(
        () => undefined,
        () => undefined,
      );
      return next;
    },
    [announceAddressJob, masterProfiles, refreshProfileSummaries],
  );

  const markGeocodioConfigured = useCallback((configured: boolean) => {
    setGeocodioConfigured(configured);
  }, []);

  const undoLastAction = useCallback(async () => {
    const snapshot = undoRef.current;
    if (!snapshot) {
      throw new Error("Nothing to undo.");
    }
    await replaceAllProfiles(snapshot.profiles);
    await replaceAllCreditCards(snapshot.creditCards);
    await replaceAllPoolEmails(snapshot.poolEmails);
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
      void enqueueAddressVerify([profile.id], { requireKey: false });
      return profile;
    },
    [captureAppUndo, enqueueAddressVerify, refresh],
  );

  const createProfiles = useCallback(
    async (options: GenerateOptions) => {
      await captureAppUndo("Generate profiles");
      const generated = generateProfiles(options);
      const creds = await listCredentials();
      await saveProfiles(syncAllProfileCredentialLinks(generated, creds));
      await refresh();
      void enqueueAddressVerify(
        generated.map((profile) => profile.id),
        { requireKey: false },
      );
      return generated;
    },
    [captureAppUndo, enqueueAddressVerify, refresh],
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
        profiles,
        poolEmails,
      );
      const linked = syncAllProfileCredentialLinks(generated, credentials);
      await saveProfiles(linked);
      await refresh();
      void enqueueAddressVerify(
        linked.map((profile) => profile.id),
        { requireKey: false },
      );
      return linked.length;
    },
    [captureAppUndo, creditCards, credentials, enqueueAddressVerify, jigPresets, masterProfiles, poolEmails, profileCategories, profiles, refresh],
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
      if (options.untilPass) {
        const settings = await getGeocodioSettings();
        if (!settings.apiKey.trim()) {
          throw new Error("Set a Geocodio API key first (Address API).");
        }
        if (addressJig.rules.length === 0) {
          throw new Error("Select at least one address jig to re-jig until pass.");
        }
      }

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
        await captureAppUndo(options.untilPass ? "Re-jig until pass" : "Re-jig profiles");
        await saveProfiles(syncAllProfileCredentialLinks(updated, creds));
        await refresh();
        if (options.untilPass) {
          const message = await continueRejigUntilPass(
            updated.map((profile) => profile.id),
            addressJig,
          );
          return {
            updatedCount: updated.length,
            failedCount: failedIds.length,
            message,
          };
        }
        void enqueueAddressVerify(
          updated.map((profile) => profile.id),
          { requireKey: false },
        );
      }

      if (updated.length === 0 && failedIds.length > 0) {
        throw new Error("Could not find unique jigs for the selected profiles. Try different presets.");
      }

      return {
        updatedCount: updated.length,
        failedCount: failedIds.length,
      };
    },
    [
      captureAppUndo,
      continueRejigUntilPass,
      enqueueAddressVerify,
      jigPresets,
      masterProfiles,
      profileCategories,
      profiles,
      refresh,
    ],
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

  const assignEmails = useCallback(
    async (options: AssignEmailsOptions): Promise<number> => {
      if (options.profileIds.length === 0) {
        throw new Error("Select at least one profile.");
      }

      const isBatch = Boolean(options.emailIds?.length);
      if (!isBatch && !options.emailId) {
        throw new Error("Select at least one email.");
      }
      if (isBatch && options.emailIds!.length !== options.profileIds.length) {
        throw new Error("Select one email per profile.");
      }

      const allProfiles = await Promise.all(profiles.map((summary) => getProfile(summary.id)));
      const profileMap = new Map(allProfiles.map((profile) => [profile.id, profile]));
      const profilesToUpdate = options.profileIds
        .map((id) => profileMap.get(id))
        .filter((profile): profile is Profile => Boolean(profile));

      if (profilesToUpdate.length === 0) {
        throw new Error("Selected profiles could not be loaded.");
      }
      assertProfilesUnlocked(profileCategories, profilesToUpdate, "assign emails in it");

      const assignmentEmailIds = isBatch
        ? options.emailIds!
        : options.profileIds.map(() => options.emailId!);
      const validationError = validateEmailAssignments(
        options.profileIds,
        assignmentEmailIds,
        poolEmails,
        allProfiles,
      );
      if (validationError) {
        throw new Error(validationError);
      }

      const updated = assignEmailsToProfiles(profilesToUpdate, allProfiles, poolEmails, options);
      if (updated.length === 0) {
        throw new Error("No profiles were updated.");
      }

      await captureAppUndo("Assign emails");
      await saveProfiles(updated);
      await refresh();
      return profilesToUpdate.length;
    },
    [captureAppUndo, poolEmails, profileCategories, profiles, refresh],
  );

  const unassignEmails = useCallback(
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
      assertProfilesUnlocked(profileCategories, profilesToUpdate, "unassign emails in it");

      const updated = unassignEmailsFromProfiles(profilesToUpdate);
      if (updated.length === 0) {
        throw new Error("Selected profiles have no emails assigned.");
      }

      await captureAppUndo("Unassign emails");
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
      const result = massDistributeToProfiles(
        profilesInOrder,
        options.lines,
        options,
        creditCards,
        creds,
        poolEmails,
      );

      if (result.updated.length === 0) {
        throw new Error("Nothing was distributed.");
      }

      await captureAppUndo("Mass distribute");
      for (const credential of result.updatedCredentials) {
        await saveCredential(credential);
      }

      const refreshedCreds = await listCredentials();
      const prepared = result.updated.map(clearStaleAddressCheck);
      await saveProfiles(syncAllProfileCredentialLinks(prepared, refreshedCreds));
      await refresh();
      void enqueueAddressVerify(
        prepared.filter((profile) => profileNeedsAddressVerify(profile)).map((profile) => profile.id),
        { requireKey: false },
      );

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
    [captureAppUndo, creditCards, enqueueAddressVerify, poolEmails, profileCategories, profiles, refresh],
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
      const linked = clearStaleAddressCheck(syncProfileCredentialLinks(profile, creds));
      await saveProfile({ ...linked, updatedAt: new Date().toISOString() });
      await refresh();
      if (profileNeedsAddressVerify(linked)) {
        void enqueueAddressVerify([linked.id], { requireKey: false });
      }
    },
    [captureAppUndo, enqueueAddressVerify, profileCategories, profiles, refresh],
  );

  const saveProfilesBatch = useCallback(
    async (
      profilesToSave: Profile[],
      undoLabel = "Update profiles",
      options?: { skipAddressVerify?: boolean },
    ) => {
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
      const prepared = profilesToSave.map((profile) =>
        clearStaleAddressCheck({
          ...syncProfileCredentialLinks(profile, creds),
          updatedAt: now,
        }),
      );
      await saveProfiles(prepared);
      await refresh();
      if (!options?.skipAddressVerify) {
        void enqueueAddressVerify(
          prepared.filter((profile) => profileNeedsAddressVerify(profile)).map((profile) => profile.id),
          { requireKey: false },
        );
      }
    },
    [captureAppUndo, enqueueAddressVerify, profileCategories, profiles, refresh],
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

  const upsertPoolEmail = useCallback(
    async (email: PoolEmail) => {
      await captureAppUndo("Save pool email");
      await savePoolEmail(email);
      await refresh();
    },
    [captureAppUndo, refresh],
  );

  const removePoolEmail = useCallback(
    async (id: string) => {
      await captureAppUndo("Delete pool email");
      await deletePoolEmail(id);
      await refresh();
    },
    [captureAppUndo, refresh],
  );

  const importEmails = useCallback(
    async (emails: PoolEmail[]) => {
      await captureAppUndo("Import emails");
      await importPoolEmails(emails);
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

  const upsertEmailCategory = useCallback(async (category: EmailCategory) => {
    await saveEmailCategory(category);
    setEmailCategories((current) =>
      sortEmailCategories([...current.filter((item) => item.id !== category.id), category]),
    );
  }, []);

  const removeEmailCategory = useCallback(async (id: string) => {
    await deleteEmailCategory(id);
    const categories = await listEmailCategories();
    setEmailCategories(categories);
  }, []);

  const reorderEmailCategoryOrder = useCallback(async (orderedIds: string[]) => {
    await reorderEmailCategories(orderedIds);
    const categories = await listEmailCategories();
    setEmailCategories(categories);
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
    poolEmails,
    credentials,
    accountCategories,
    cardCategories,
    emailCategories,
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
    assignEmails,
    unassignEmails,
    massDistributeProfiles,
    createBlankProfile,
    removeProfile,
    removeProfiles,
    loadProfile,
    updateProfile,
    saveProfilesBatch,
    importProfiles,
    verifyAddresses,
    addressVerifyBusy,
    addressJobKind,
    addressJobStatus,
    addressJobTone,
    geocodioConfigured,
    markGeocodioConfigured,
    updateMasterProfile,
    removeMasterProfile,
    upsertCreditCard,
    removeCreditCard,
    importCards,
    upsertPoolEmail,
    removePoolEmail,
    importEmails,
    upsertCredential,
    removeCredential,
    importCreds,
    upsertAccountCategory,
    removeAccountCategory,
    reorderAccountCategoryOrder,
    upsertCardCategory,
    removeCardCategory,
    reorderCardCategoryOrder,
    upsertEmailCategory,
    removeEmailCategory,
    reorderEmailCategoryOrder,
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
