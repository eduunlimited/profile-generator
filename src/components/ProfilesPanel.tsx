import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { profileSummaryHasAssignedCard } from "../lib/assignCards";
import {
  assertProfileCategoryUnlocked,
  categoriesWithProfiles,
  createUncategorizedProfileCategory,
  isProfileCategoryLocked,
  nextProfileCategorySortOrder,
  PROFILE_UNCATEGORIZED_CATEGORY_ID,
  profileCategoryId,
  reorderCategoryIds,
  sortProfileCategories,
} from "../lib/profileCategoryUtils";
import {
  applyProfileMassEditPatch,
  buildProfileMassEditDraft,
  emptyProfileMixedFields,
  emptyProfileTouchedFields,
  hasProfileMassEditChanges,
  type ProfileEditField,
  type ProfileMixedFields,
  type ProfileTouchedFields,
} from "../lib/profileMassEdit";
import { applyExcelListSelection } from "../lib/listSelection";
import {
  collectUsedProfileNamesFromSummaries,
  nextUniqueProfileName,
  uniqueCopiedProfileName,
} from "../lib/profileNameUtils";
import { useResizableTableColumns } from "../hooks/useResizableTableColumns";
import { ResizableTh, TableColGroup } from "./ResizableTable";
import {
  ensureProfileEditorFields,
  syncProfileCreditCardLink,
  updateProfileField,
} from "../lib/profileUtils";
import type {
  Credential,
  CreditCard,
  MasterProfile,
  Profile,
  ProfileCategory,
  ProfileSummary,
} from "../lib/types";
import {
  masterCategorySidebarId,
  masterProfileLabel,
  masterSidebarCategoryId,
  parseProfilesSidebarSelection,
} from "../lib/masterProfileUtils";
import {
  analyzeProfileOpportunities,
  filterProfilesByOpportunity,
  type ProfileOpportunityId,
} from "../lib/profileOpportunities";
import { useConfirmDelete } from "../hooks/useConfirmDelete";
import { BillingAddressCell } from "./BillingAddressCell";
import {
  resolveCategorySelection,
  type CategorySelection,
} from "./AccountCategorySelect";
import { AccountStatusDisplay } from "./AccountStatusDisplay";
import { CardProfileCell } from "./CardBrandIcon";
import { ConfirmDeleteModal } from "./ConfirmDeleteModal";
import { CreateCategoryModal } from "./CreateCategoryModal";
import { ImportProfilesModal } from "./ImportProfilesModal";
import { MoveProfilesModal } from "./MoveProfilesModal";
import { ProfileFormModal } from "./ProfileFormModal";
import { ProfileOpportunities } from "./ProfileOpportunities";
import { ProfilesToolbar } from "./ProfilesToolbar";
import { RenameableCategoryName } from "./RenameableCategoryName";
import { RowCheckbox } from "./ui";

const PROFILES_SIDEBAR_WIDTH_KEY = "profile-generator:profiles-sidebar-width";
const PROFILES_SIDEBAR_DEFAULT_WIDTH = 200;
const PROFILES_SIDEBAR_MIN_WIDTH = 140;
const PROFILES_SIDEBAR_MAX_WIDTH = 420;
const PROFILE_TABLE_COLUMNS = [
  "check",
  "index",
  "name",
  "billingName",
  "email",
  "phone",
  "address",
  "card",
  "accounts",
  "status",
  "notes",
] as const;
const PROFILE_TABLE_LOCKED_COLUMNS = ["check"] as const;

function clampSidebarWidth(width: number): number {
  return Math.min(PROFILES_SIDEBAR_MAX_WIDTH, Math.max(PROFILES_SIDEBAR_MIN_WIDTH, width));
}

function readSidebarWidth(): number {
  const stored = localStorage.getItem(PROFILES_SIDEBAR_WIDTH_KEY);
  if (!stored) {
    return PROFILES_SIDEBAR_DEFAULT_WIDTH;
  }
  const parsed = Number(stored);
  return Number.isFinite(parsed) ? clampSidebarWidth(parsed) : PROFILES_SIDEBAR_DEFAULT_WIDTH;
}

type ProfilesSelectedCategoryId = "all" | string;

interface ProfilesPanelProps {
  profiles: ProfileSummary[];
  categories: ProfileCategory[];
  masterProfiles: MasterProfile[];
  activeMasterId: string | null;
  onActiveMasterChange: (masterId: string | null) => void;
  onLoadProfile: (id: string) => Promise<Profile>;
  onSaveProfiles: (profiles: Profile[], undoLabel?: string) => Promise<void>;
  onImportProfiles: (profiles: Profile[]) => Promise<void>;
  onDeleteProfiles: (ids: string[]) => Promise<void>;
  onLastAction?: (label: string) => void;
  onSaveCategory: (category: ProfileCategory) => Promise<void>;
  onDeleteCategory: (id: string) => Promise<void>;
  onReorderCategories?: (orderedIds: string[]) => Promise<void>;
  onCreateMaster: () => void;
  createMasterDisabled?: boolean;
  onOpenMaster: (masterId: string) => void;
  onDeleteMaster: (masterId: string) => Promise<void>;
  onGenerate: (masterId: string, categoryId?: string) => void;
  onRejig: () => void;
  onAssignCards: () => void;
  onUnassignCards: (profileIds: string[]) => Promise<number>;
  onMassDistribute: () => void;
  onExport: () => void;
  creditCards: CreditCard[];
  credentials?: Credential[];
  onSelectedIdsChange?: (ids: string[]) => void;
}

export function ProfilesPanel({
  profiles,
  categories,
  masterProfiles,
  activeMasterId,
  onActiveMasterChange,
  onLoadProfile,
  onSaveProfiles,
  onImportProfiles,
  onDeleteProfiles,
  onLastAction,
  onSaveCategory,
  onDeleteCategory,
  onReorderCategories,
  onCreateMaster,
  createMasterDisabled = false,
  onOpenMaster,
  onDeleteMaster,
  onGenerate,
  onRejig,
  onAssignCards,
  onUnassignCards,
  onMassDistribute,
  onExport,
  creditCards,
  credentials = [],
  onSelectedIdsChange,
}: ProfilesPanelProps) {
  const [profileDraft, setProfileDraft] = useState<Profile | null>(null);
  const [draftCategorySelection, setDraftCategorySelection] = useState<CategorySelection>(() =>
    existingCategorySelection(),
  );
  const [status, setStatus] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<ProfilesSelectedCategoryId>("all");
  const [categorySearch, setCategorySearch] = useState("");
  const [tableQuery, setTableQuery] = useState("");
  const [activeOpportunityId, setActiveOpportunityId] = useState<ProfileOpportunityId | null>(null);
  const [showCreateCategory, setShowCreateCategory] = useState(false);
  const { pending: deleteConfirm, busy: deleteConfirmBusy, askConfirm, closeConfirm, acceptConfirm } =
    useConfirmDelete();
  const [showMoveModal, setShowMoveModal] = useState(false);
  const [showCopyModal, setShowCopyModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [moveCategorySelection, setMoveCategorySelection] = useState<CategorySelection>(() =>
    existingCategorySelection(),
  );
  const [copyCategorySelection, setCopyCategorySelection] = useState<CategorySelection>(() =>
    existingCategorySelection(),
  );
  const [draggingCategoryId, setDraggingCategoryId] = useState<string | null>(null);
  const [dragOverCategoryId, setDragOverCategoryId] = useState<string | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(readSidebarWidth);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [editTargetIds, setEditTargetIds] = useState<string[]>([]);
  const [mixedFields, setMixedFields] = useState<ProfileMixedFields>(() => emptyProfileMixedFields());
  const [touchedFields, setTouchedFields] = useState<ProfileTouchedFields>(() => emptyProfileTouchedFields());
  const anchorIndexRef = useRef<number | null>(null);

  const isEditing = editTargetIds.length > 0;
  const isMassEditing = editTargetIds.length > 1;

  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const category of categories) {
      counts.set(category.id, 0);
    }
    for (const profile of profiles) {
      const categoryId = profileCategoryId(profile);
      counts.set(categoryId, (counts.get(categoryId) ?? 0) + 1);
    }
    return counts;
  }, [categories, profiles]);

  const activeCategories = useMemo(
    () => categoriesWithProfiles(categories, profiles),
    [categories, profiles],
  );

  const canReorderCategories = Boolean(onReorderCategories) && categorySearch.trim().length === 0;

  const formCategories = useMemo(() => {
    let options = [...activeCategories];
    const selectedDraftCategoryId =
      draftCategorySelection.kind === "existing"
        ? draftCategorySelection.categoryId
        : (profileDraft?.categoryId ?? PROFILE_UNCATEGORIZED_CATEGORY_ID);
    const draftCategory = categories.find((category) => category.id === selectedDraftCategoryId);
    if (draftCategory && !options.some((category) => category.id === draftCategory.id)) {
      options = sortProfileCategories([...options, draftCategory]);
    }
    if (!options.some((category) => category.id === PROFILE_UNCATEGORIZED_CATEGORY_ID)) {
      options = sortProfileCategories([createUncategorizedProfileCategory(), ...options]);
    }
    return options;
  }, [activeCategories, categories, draftCategorySelection, profileDraft?.categoryId]);

  const moveCategories = useMemo(() => {
    let options = [...categories];
    if (!options.some((category) => category.id === PROFILE_UNCATEGORIZED_CATEGORY_ID)) {
      options = sortProfileCategories([createUncategorizedProfileCategory(), ...options]);
    }
    return sortProfileCategories(options);
  }, [categories]);

  const masterChildCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const master of masterProfiles) {
      counts.set(
        master.id,
        profiles.filter((profile) => profile.masterProfileId === master.id).length,
      );
    }
    return counts;
  }, [masterProfiles, profiles]);

  const sidebarSelection = parseProfilesSidebarSelection(selectedCategoryId);
  const selectedMasterId = sidebarSelection.masterId;
  const selectedProfileCategoryId = sidebarSelection.profileCategoryId;
  const showProfileOpportunities = Boolean(selectedMasterId && selectedProfileCategoryId);

  const masterCategoryCounts = useMemo(() => {
    const countsByMaster = new Map<string, Map<string, number>>();
    for (const master of masterProfiles) {
      countsByMaster.set(master.id, new Map<string, number>());
    }
    for (const profile of profiles) {
      if (!profile.masterProfileId) continue;
      const masterCounts = countsByMaster.get(profile.masterProfileId);
      if (!masterCounts) continue;
      const categoryId = profileCategoryId(profile);
      masterCounts.set(categoryId, (masterCounts.get(categoryId) ?? 0) + 1);
    }
    return countsByMaster;
  }, [masterProfiles, profiles]);

  const categoriesForMaster = useCallback(
    (masterId: string) => {
      const counts = masterCategoryCounts.get(masterId);
      if (!counts || counts.size === 0) return [];
      const query = categorySearch.trim().toLowerCase();
      return activeCategories.filter((category) => {
        if ((counts.get(category.id) ?? 0) === 0) return false;
        if (!query) return true;
        return category.name.toLowerCase().includes(query);
      });
    },
    [activeCategories, categorySearch, masterCategoryCounts],
  );

  const filteredMasters = useMemo(() => {
    const query = categorySearch.trim().toLowerCase();
    if (!query) return masterProfiles;
    return masterProfiles.filter((master) => {
      if (masterProfileLabel(master).toLowerCase().includes(query)) return true;
      return categoriesForMaster(master.id).length > 0;
    });
  }, [categoriesForMaster, categorySearch, masterProfiles]);

  const visibleProfiles = useMemo(() => {
    if (selectedCategoryId === "all") return profiles;
    if (selectedMasterId) {
      const masterProfilesOnly = profiles.filter((profile) => profile.masterProfileId === selectedMasterId);
      if (!selectedProfileCategoryId) return masterProfilesOnly;
      return masterProfilesOnly.filter(
        (profile) => profileCategoryId(profile) === selectedProfileCategoryId,
      );
    }
    if (selectedProfileCategoryId) {
      return profiles.filter(
        (profile) => profileCategoryId(profile) === selectedProfileCategoryId,
      );
    }
    return profiles;
  }, [profiles, selectedCategoryId, selectedMasterId, selectedProfileCategoryId]);

  const profileOpportunities = useMemo(
    () =>
      showProfileOpportunities
        ? analyzeProfileOpportunities(visibleProfiles, profiles, creditCards)
        : [],
    [showProfileOpportunities, visibleProfiles, profiles, creditCards],
  );

  const opportunityFilteredProfiles = useMemo(() => {
    if (!showProfileOpportunities) return visibleProfiles;
    return filterProfilesByOpportunity(visibleProfiles, profileOpportunities, activeOpportunityId);
  }, [showProfileOpportunities, visibleProfiles, profileOpportunities, activeOpportunityId]);

  const searchFilteredProfiles = useMemo(() => {
    const query = tableQuery.trim().toLowerCase();
    if (!query) return opportunityFilteredProfiles;
    return opportunityFilteredProfiles.filter((profile) => {
      const haystack = [
        profile.name,
        profile.billingFullName,
        profile.billingEmail,
        profile.billingPhone,
        profile.billingAddressLine1,
        profile.billingAddressLine2,
        profile.billingAddressLine3,
        profile.creditCardLabel,
        profile.cardNumberMasked,
        profile.accounts,
        profile.notes,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [opportunityFilteredProfiles, tableQuery]);

  const profileTableColumns = useResizableTableColumns({
    columnIds: PROFILE_TABLE_COLUMNS,
    lockedIds: PROFILE_TABLE_LOCKED_COLUMNS,
    storageKey: "profiles",
    fitKey: searchFilteredProfiles
      .map((profile) =>
        [
          profile.id,
          profile.name,
          profile.billingFullName,
          profile.billingEmail,
          profile.billingPhone,
          profile.billingAddressLine1,
          profile.billingAddressLine2,
          profile.billingAddressLine3,
          profile.creditCardLabel,
          profile.cardNumberMasked,
          profile.accounts,
          profile.notes,
        ].join("\t"),
      )
      .join("\n"),
  });

  const orderedIds = searchFilteredProfiles.map((profile) => profile.id);
  const selectedProfilesWithCards = useMemo(
    () => profiles.filter((profile) => selectedIds.includes(profile.id) && profileSummaryHasAssignedCard(profile)),
    [profiles, selectedIds],
  );
  const canUnassignCards = selectedProfilesWithCards.length > 0;
  const selectedProfilesLocked = profiles.some(
    (profile) => selectedIds.includes(profile.id) && isProfileCategoryLocked(categories, profile.categoryId),
  );
  const viewingCategoryLocked = isProfileCategoryLocked(categories, selectedProfileCategoryId ?? undefined);
  const allSelected =
    searchFilteredProfiles.length > 0 &&
    searchFilteredProfiles.every((profile) => selectedIds.includes(profile.id));

  useEffect(() => {
    setSelectedIds((current) => current.filter((id) => orderedIds.includes(id)));
  }, [orderedIds]);

  useEffect(() => {
    setActiveOpportunityId(null);
  }, [selectedCategoryId]);

  useEffect(() => {
    if (!showProfileOpportunities) {
      setActiveOpportunityId(null);
    }
  }, [showProfileOpportunities]);

  useEffect(() => {
    if (!activeOpportunityId) return;
    if (!profileOpportunities.some((item) => item.id === activeOpportunityId)) {
      setActiveOpportunityId(null);
    }
  }, [activeOpportunityId, profileOpportunities]);

  useEffect(() => {
    if (selectedCategoryId === "all") return;
    if (selectedMasterId) {
      if (selectedProfileCategoryId) {
        const counts = masterCategoryCounts.get(selectedMasterId);
        if ((counts?.get(selectedProfileCategoryId) ?? 0) === 0) {
          setSelectedCategoryId(masterSidebarCategoryId(selectedMasterId));
        }
      }
      return;
    }
    if (selectedProfileCategoryId && (categoryCounts.get(selectedProfileCategoryId) ?? 0) === 0) {
      setSelectedCategoryId("all");
    }
  }, [categoryCounts, masterCategoryCounts, selectedCategoryId, selectedMasterId, selectedProfileCategoryId]);

  useEffect(() => {
    if (!selectedMasterId) return;
    if (!masterProfiles.some((master) => master.id === selectedMasterId)) {
      setSelectedCategoryId("all");
      onActiveMasterChange(null);
    }
  }, [masterProfiles, onActiveMasterChange, selectedMasterId]);

  useEffect(() => {
    if (!activeMasterId) return;
    if (!masterProfiles.some((master) => master.id === activeMasterId)) return;
    const currentMasterId = parseProfilesSidebarSelection(selectedCategoryId).masterId;
    if (currentMasterId === activeMasterId) return;
    setSelectedCategoryId(masterSidebarCategoryId(activeMasterId));
  }, [activeMasterId, masterProfiles, selectedCategoryId]);

  useEffect(() => {
    localStorage.setItem(PROFILES_SIDEBAR_WIDTH_KEY, String(sidebarWidth));
  }, [sidebarWidth]);

  useEffect(() => {
    onSelectedIdsChange?.(selectedIds);
  }, [selectedIds, onSelectedIdsChange]);

  const startSidebarResize = (event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sidebarWidth;

    const handleMouseMove = (moveEvent: globalThis.MouseEvent) => {
      setSidebarWidth(clampSidebarWidth(startWidth + (moveEvent.clientX - startX)));
    };

    const handleMouseUp = () => {
      document.body.classList.remove("accounts-resizing");
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };

    document.body.classList.add("accounts-resizing");
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  const applySelection = (
    event: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean },
    id: string,
    index: number,
  ) => {
    setSelectedIds((current) => {
      const result = applyExcelListSelection(
        current,
        anchorIndexRef.current,
        index,
        id,
        orderedIds,
        event,
      );
      anchorIndexRef.current = result.anchorIndex;
      return result.selectedIds;
    });
  };

  const handleRowClick = (event: MouseEvent<HTMLTableRowElement>, id: string, index: number) => {
    if ((event.target as HTMLElement).closest(".row-checkbox")) return;
    applySelection(event, id, index);
  };

  const closeProfileModal = () => {
    setShowProfileModal(false);
    setEditTargetIds([]);
    setProfileDraft(null);
    setMixedFields(emptyProfileMixedFields());
    setTouchedFields(emptyProfileTouchedFields());
    setStatus(null);
  };

  const touchField = (field: ProfileEditField) => {
    setTouchedFields((current) => ({ ...current, [field]: true }));
  };

  const createCategory = async (name: string): Promise<ProfileCategory> => {
    const category: ProfileCategory = {
      id: crypto.randomUUID(),
      name: name.trim(),
      createdAt: new Date().toISOString(),
      sortOrder: nextProfileCategorySortOrder(categories),
    };
    await onSaveCategory(category);
    return category;
  };

  const toggleCategoryLock = async (category: ProfileCategory) => {
    await onSaveCategory({ ...category, locked: !category.locked });
  };

  const renameCategory = async (categoryId: string, nextName: string) => {
    const category =
      categories.find((item) => item.id === categoryId) ??
      (categoryId === PROFILE_UNCATEGORIZED_CATEGORY_ID ? createUncategorizedProfileCategory() : undefined);
    if (!category) return;
    await onSaveCategory({ ...category, name: nextName });
  };

  const handleEditSelected = async () => {
    if (selectedIds.length === 0) return;
    const selected = profiles.filter((profile) => selectedIds.includes(profile.id));
    const locked = selected.find((profile) => isProfileCategoryLocked(categories, profile.categoryId));
    if (locked) {
      setStatus("Unlock the category before editing these profiles.");
      return;
    }
    setStatus(null);

    if (selectedIds.length === 1) {
      const loaded = ensureProfileEditorFields(
        syncProfileCreditCardLink(await onLoadProfile(selectedIds[0]), creditCards),
      );
      setEditTargetIds([loaded.id]);
      setProfileDraft(loaded);
      setMixedFields(emptyProfileMixedFields());
      setTouchedFields(emptyProfileTouchedFields());
      setDraftCategorySelection(existingCategorySelection(loaded.categoryId));
    } else {
      const loaded = await Promise.all(selectedIds.map((id) => onLoadProfile(id)));
      const { draft, mixedFields: mixed } = buildProfileMassEditDraft(loaded, selectedIds);
      setEditTargetIds([...selectedIds]);
      setProfileDraft(draft);
      setMixedFields(mixed);
      setTouchedFields(emptyProfileTouchedFields());
      setDraftCategorySelection(existingCategorySelection(draft.categoryId));
    }

    setShowProfileModal(true);
  };

  const save = async () => {
    if (isMassEditing) {
      if (!profileDraft) {
        setStatus("Profiles could not be loaded.");
        return;
      }
      if (!hasProfileMassEditChanges(touchedFields)) {
        setStatus("Change at least one field to update selected profiles.");
        return;
      }
      if (touchedFields.profileName && !profileDraft.profileName?.trim()) {
        setStatus("Profile name is required.");
        return;
      }

      let categoryId: string | null = null;
      if (touchedFields.categoryId) {
        try {
          categoryId = await resolveCategorySelection(draftCategorySelection, createCategory);
        } catch (error) {
          setStatus(error instanceof Error ? error.message : "Category is required.");
          return;
        }
      }

      const loaded = await Promise.all(editTargetIds.map((id) => onLoadProfile(id)));
      const sequentialNames =
        touchedFields.profileName && editTargetIds.length > 1
          ? collectUsedProfileNamesFromSummaries(profiles, editTargetIds)
          : null;
      const nameBase = profileDraft.profileName?.trim() ?? "";
      const patched = loaded.map((profile) => {
        const next = applyProfileMassEditPatch(profile, profileDraft, categoryId, touchedFields, creditCards);
        if (!sequentialNames) return next;
        return updateProfileField(next, "profileName", nextUniqueProfileName(nameBase, sequentialNames));
      });
      await onSaveProfiles(
        patched,
        editTargetIds.length > 1 ? "Edit profiles" : "Save profile",
      );
      closeProfileModal();
      return;
    }

    if (!profileDraft) {
      setStatus("Profile could not be loaded.");
      return;
    }

    if (!profileDraft.profileName?.trim()) {
      setStatus("Profile name is required.");
      return;
    }

    let categoryId: string;
    try {
      categoryId = await resolveCategorySelection(draftCategorySelection, createCategory);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Category is required.");
      return;
    }

    const updated = ensureProfileEditorFields(
      syncProfileCreditCardLink({ ...profileDraft, categoryId }, creditCards),
    );
    await onSaveProfiles([updated], "Save profile");
    closeProfileModal();
  };

  const selectedCategory =
    selectedProfileCategoryId
      ? activeCategories.find((category) => category.id === selectedProfileCategoryId) ??
        categories.find((category) => category.id === selectedProfileCategoryId) ??
        null
      : null;
  const canDeleteSelectedCategory =
    selectedCategory !== null && (categoryCounts.get(selectedCategory.id) ?? 0) === 0;
  const canDeleteDraftCategory =
    draftCategorySelection.kind === "existing" &&
    (categoryCounts.get(draftCategorySelection.categoryId) ?? 0) === 0 &&
    categories.some((category) => category.id === draftCategorySelection.categoryId);

  const deleteCategoryById = (categoryId: string) => {
    const category = categories.find((item) => item.id === categoryId);
    if (!category || (categoryCounts.get(categoryId) ?? 0) > 0) {
      return;
    }
    askConfirm({
      title: "Delete category",
      message: `Delete "${category.name}"? This cannot be undone.`,
      onConfirm: async () => {
        await onDeleteCategory(categoryId);
        const { masterId, profileCategoryId } = parseProfilesSidebarSelection(selectedCategoryId);
        if (profileCategoryId === categoryId) {
          setSelectedCategoryId(masterId ? masterSidebarCategoryId(masterId) : "all");
        }
        if (draftCategorySelection.kind === "existing" && draftCategorySelection.categoryId === categoryId) {
          setDraftCategorySelection(existingCategorySelection());
        }
        if (moveCategorySelection.kind === "existing" && moveCategorySelection.categoryId === categoryId) {
          setMoveCategorySelection(existingCategorySelection());
        }
      },
    });
  };

  const handleCreateCategory = async (name: string) => {
    const category = await createCategory(name);
    if (selectedMasterId) {
      setSelectedCategoryId(masterCategorySidebarId(selectedMasterId, category.id));
      onActiveMasterChange(selectedMasterId);
    } else {
      setSelectedCategoryId(category.id);
    }
    setDraftCategorySelection(existingCategorySelection(category.id));
    setMoveCategorySelection(existingCategorySelection(category.id));
  };

  const handleDeleteSelected = () => {
    if (selectedIds.length === 0) return;
    const count = selectedIds.length;
    const ids = [...selectedIds];
    askConfirm({
      title: count === 1 ? "Delete profile" : "Delete profiles",
      message: `Delete ${count} profile${count === 1 ? "" : "s"}? This cannot be undone.`,
      onConfirm: async () => {
        await onDeleteProfiles(ids);
        setSelectedIds([]);
        anchorIndexRef.current = null;
      },
    });
  };

  const openMoveModal = () => {
    if (selectedIds.length === 0) return;
    setMoveCategorySelection(existingCategorySelection());
    setShowMoveModal(true);
  };

  const closeMoveModal = () => {
    setShowMoveModal(false);
  };

  const openCopyModal = () => {
    if (selectedIds.length === 0) return;
    setCopyCategorySelection(existingCategorySelection());
    setShowCopyModal(true);
  };

  const closeCopyModal = () => {
    setShowCopyModal(false);
  };

  const handleMoveSelected = async () => {
    if (selectedIds.length === 0) return;

    let categoryId: string;
    try {
      categoryId = await resolveCategorySelection(moveCategorySelection, createCategory);
      assertProfileCategoryUnlocked(categories, categoryId, "move profiles into it");
    } catch (error) {
      throw error instanceof Error ? error : new Error("Category is required.");
    }

    const loaded = await Promise.all(selectedIds.map((id) => onLoadProfile(id)));
    for (const profile of loaded) {
      assertProfileCategoryUnlocked(categories, profile.categoryId, "move profiles out of it");
    }
    const updated = loaded
      .filter((profile) => profileCategoryId(profile) !== categoryId)
      .map((profile) => ({ ...profile, categoryId }));

    if (updated.length > 0) {
      await onSaveProfiles(updated, "Move profiles");
    }

    setSelectedIds([]);
    anchorIndexRef.current = null;
  };

  const handleCopySelected = async () => {
    if (selectedIds.length === 0) return;

    let categoryId: string;
    try {
      categoryId = await resolveCategorySelection(copyCategorySelection, createCategory);
      assertProfileCategoryUnlocked(categories, categoryId, "copy profiles into it");
    } catch (error) {
      throw error instanceof Error ? error : new Error("Category is required.");
    }

    const loaded = await Promise.all(selectedIds.map((id) => onLoadProfile(id)));
    const usedNames = new Set(
      profiles
        .filter((profile) => profileCategoryId(profile) === categoryId)
        .map((profile) => profile.name.trim().toLowerCase())
        .filter(Boolean),
    );
    const now = new Date().toISOString();
    const copies = loaded.map((profile) => {
      const sourceName = profile.profileName?.trim() || profile.name.full.trim() || "Profile";
      return {
        ...profile,
        id: crypto.randomUUID(),
        categoryId,
        profileName: uniqueCopiedProfileName(sourceName, usedNames),
        createdAt: now,
        updatedAt: now,
      };
    });

    if (copies.length > 0) {
      await onSaveProfiles(copies, "Copy profiles");
    }

    const message = `Copied ${copies.length} profile${copies.length === 1 ? "" : "s"} to the selected category.`;
    onLastAction?.(message);
    setStatus(message);
  };

  const handleUnassignCards = () => {
    const withCards = selectedProfilesWithCards;
    if (withCards.length === 0) {
      return;
    }
    const count = withCards.length;
    askConfirm({
      title: "Unassign cards",
      message:
        count === 1
          ? `Unassign the card from "${withCards[0].name}"? Payment details on the profile will be cleared.`
          : `Unassign cards from ${count} profile${count === 1 ? "" : "s"}? Payment details on those profiles will be cleared.`,
      confirmLabel: "Unassign",
      onConfirm: async () => {
        try {
          const updated = await onUnassignCards(withCards.map((profile) => profile.id));
          const message = `Unassigned cards from ${updated} profile${updated === 1 ? "" : "s"}.`;
          onLastAction?.(message);
          setStatus(message);
        } catch (error) {
          setStatus(error instanceof Error ? error.message : "Could not unassign cards.");
        }
      },
    });
  };

  const handleDeleteCategory = () => {
    if (!selectedCategory || !canDeleteSelectedCategory) {
      return;
    }
    deleteCategoryById(selectedCategory.id);
  };

  const handleCategoryReorder = async (draggedId: string, targetId: string) => {
    if (!onReorderCategories || draggedId === targetId) {
      return;
    }

    const nextOrder = reorderCategoryIds(
      activeCategories.map((category) => category.id),
      draggedId,
      targetId,
    );
    await onReorderCategories(nextOrder);
  };

  const toolbarMasterId = selectedMasterId ?? activeMasterId ?? masterProfiles[0]?.id ?? null;

  const handleCreateMasterClick = () => {
    if (createMasterDisabled) return;
    onCreateMaster();
  };

  const handleToolbarEdit = () => {
    if (selectedIds.length > 0) {
      void handleEditSelected();
      return;
    }
    if (selectedMasterId) {
      onOpenMaster(selectedMasterId);
    }
  };

  const handleToolbarMove = () => {
    if (selectedIds.length > 0) {
      if (selectedProfilesLocked) {
        setStatus("Unlock the category before moving these profiles.");
        return;
      }
      openMoveModal();
      return;
    }
    if (!selectedMasterId) return;
    const masterJigs = profiles.filter((profile) => profile.masterProfileId === selectedMasterId);
    if (masterJigs.some((profile) => isProfileCategoryLocked(categories, profile.categoryId))) {
      setStatus("Unlock locked categories before moving these profiles.");
      return;
    }
    const masterJigIds = masterJigs.map((profile) => profile.id);
    if (masterJigIds.length === 0) return;
    setSelectedIds(masterJigIds);
    setShowMoveModal(true);
  };

  const handleToolbarDelete = () => {
    if (selectedIds.length > 0) {
      handleDeleteSelected();
      return;
    }
    if (!selectedMasterId || (masterChildCounts.get(selectedMasterId) ?? 0) > 0) {
      return;
    }
    const master = masterProfiles.find((item) => item.id === selectedMasterId);
    if (!master) return;
    askConfirm({
      title: "Delete master profile",
      message: `Delete "${masterProfileLabel(master)}"? This cannot be undone.`,
      onConfirm: async () => {
        await onDeleteMaster(selectedMasterId);
        setSelectedCategoryId("all");
      },
    });
  };

  const canDeleteSelectedMaster =
    Boolean(selectedMasterId) && (masterChildCounts.get(selectedMasterId!) ?? 0) === 0;

  const poolTitle =
    selectedCategoryId === "all"
      ? "All jig profiles"
      : selectedMasterId
        ? (() => {
            const master = masterProfiles.find((item) => item.id === selectedMasterId);
            const count = masterChildCounts.get(selectedMasterId) ?? 0;
            if (selectedCategory) {
              const categoryCount = masterCategoryCounts.get(selectedMasterId)?.get(selectedCategory.id) ?? 0;
              return master
                ? `${masterProfileLabel(master)} · ${selectedCategory.name}${selectedCategory.locked ? " · Locked" : ""} · ${categoryCount} jig(s)`
                : selectedCategory.name;
            }
            return master
              ? `${masterProfileLabel(master)} · Master · ${count} jig(s)`
              : "Master profiles";
          })()
        : (selectedCategory?.name ?? "Category");

  const tableColumnCount = PROFILE_TABLE_COLUMNS.length;

  return (
    <>
      <div className="accounts-layout">
        <aside className="accounts-sidebar card" style={{ width: sidebarWidth }}>
          <input
            className="accounts-category-search"
            placeholder="Find Categories"
            value={categorySearch}
            onChange={(event) => setCategorySearch(event.target.value)}
          />
          <div className="accounts-category-all-row">
            <button
              type="button"
              className={`accounts-category-item${selectedCategoryId === "all" ? " active" : ""}`}
              onClick={() => setSelectedCategoryId("all")}
            >
              <span>All</span>
              <span className="accounts-category-count">{profiles.length}</span>
            </button>
          </div>
          {masterProfiles.length > 0 ? (
            <ul className="accounts-category-list accounts-master-list">
              {filteredMasters.map((master) => {
                const masterSelectionId = masterSidebarCategoryId(master.id);
                const childCount = masterChildCounts.get(master.id) ?? 0;
                const masterCategories = categoriesForMaster(master.id);
                const masterActive =
                  selectedCategoryId === masterSelectionId ||
                  (selectedMasterId === master.id && Boolean(selectedProfileCategoryId));
                return (
                  <li key={master.id} className="accounts-master-group">
                    <button
                      type="button"
                      className={`accounts-category-item${selectedCategoryId === masterSelectionId ? " active" : ""}${masterActive && selectedCategoryId !== masterSelectionId ? " active-parent" : ""}`}
                      onClick={() => {
                        setSelectedCategoryId(masterSelectionId);
                        onActiveMasterChange(master.id);
                      }}
                    >
                      <span className="accounts-category-name">{masterProfileLabel(master)}</span>
                      <span className="accounts-category-count">Master · {childCount} jig(s)</span>
                    </button>
                    {masterCategories.length > 0 ? (
                      <ul className="accounts-master-nested">
                        {masterCategories.map((category) => {
                          const categorySelectionId = masterCategorySidebarId(master.id, category.id);
                          const nestedCount = masterCategoryCounts.get(master.id)?.get(category.id) ?? 0;
                          return (
                            <li
                              key={`${master.id}-${category.id}`}
                              className={`accounts-category-row accounts-master-category-row${draggingCategoryId === category.id ? " dragging" : ""}${dragOverCategoryId === category.id ? " drag-over" : ""}`}
                              onDragOver={(event) => {
                                if (
                                  !canReorderCategories ||
                                  !draggingCategoryId ||
                                  draggingCategoryId === category.id
                                ) {
                                  return;
                                }
                                event.preventDefault();
                                event.dataTransfer.dropEffect = "move";
                                setDragOverCategoryId(category.id);
                              }}
                              onDragLeave={() => {
                                if (dragOverCategoryId === category.id) {
                                  setDragOverCategoryId(null);
                                }
                              }}
                              onDrop={(event) => {
                                event.preventDefault();
                                const draggedId =
                                  event.dataTransfer.getData("text/category-id") || draggingCategoryId;
                                setDragOverCategoryId(null);
                                setDraggingCategoryId(null);
                                if (!draggedId) return;
                                void handleCategoryReorder(draggedId, category.id);
                              }}
                            >
                              <button
                                type="button"
                                className={`accounts-category-lock${category.locked ? " is-locked" : ""}`}
                                aria-label={category.locked ? `Unlock ${category.name}` : `Lock ${category.name}`}
                                title={category.locked ? "Unlock category" : "Lock category"}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void toggleCategoryLock(category);
                                }}
                              >
                                {category.locked ? "🔒" : "🔓"}
                              </button>
                              {canReorderCategories ? (
                                <button
                                  type="button"
                                  className="accounts-category-drag"
                                  draggable
                                  aria-label={`Reorder ${category.name}`}
                                  title="Drag to reorder"
                                  onDragStart={(event) => {
                                    event.dataTransfer.setData("text/category-id", category.id);
                                    event.dataTransfer.effectAllowed = "move";
                                    setDraggingCategoryId(category.id);
                                  }}
                                  onDragEnd={() => {
                                    setDraggingCategoryId(null);
                                    setDragOverCategoryId(null);
                                  }}
                                  onClick={(event) => event.stopPropagation()}
                                >
                                  ⋮⋮
                                </button>
                              ) : null}
                              <div
                                role="button"
                                tabIndex={0}
                                className={`accounts-category-item accounts-category-item-nested${selectedCategoryId === categorySelectionId ? " active" : ""}${category.locked ? " is-locked" : ""}`}
                                onClick={() => {
                                  setSelectedCategoryId(categorySelectionId);
                                  onActiveMasterChange(master.id);
                                }}
                                onKeyDown={(event) => {
                                  if (event.key !== "Enter" && event.key !== " ") return;
                                  event.preventDefault();
                                  setSelectedCategoryId(categorySelectionId);
                                  onActiveMasterChange(master.id);
                                }}
                              >
                                <RenameableCategoryName
                                  name={category.name}
                                  onRename={(nextName) => renameCategory(category.id, nextName)}
                                />
                                <span className="accounts-category-count">{nestedCount}</span>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : null}
          <button
            type="button"
            className="btn-secondary accounts-create-category-btn"
            onClick={() => handleCreateMasterClick()}
            disabled={createMasterDisabled}
          >
            Create Master
          </button>
          <button
            type="button"
            className="btn-secondary accounts-create-category-btn"
            onClick={() => setShowCreateCategory(true)}
            disabled={masterProfiles.length === 0}
            title={masterProfiles.length === 0 ? "Create a master profile first" : undefined}
          >
            Create Category
          </button>
        </aside>

        <div
          className="accounts-sidebar-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize categories panel"
          onMouseDown={startSidebarResize}
        />

        <div className="accounts-main">
          <section className="card accounts-pool-card">
            <div className="card-header card-header-tight">
              <div>
                <h2>Jig profiles</h2>
                <p className="muted">{poolTitle}</p>
              </div>
              {showProfileOpportunities ? (
                <ProfileOpportunities
                  opportunities={profileOpportunities}
                  activeOpportunityId={activeOpportunityId}
                  onSelect={setActiveOpportunityId}
                />
              ) : null}
            </div>

            <ProfilesToolbar
              selectedCount={selectedIds.length}
              selectedMasterId={selectedMasterId}
              canDeleteMaster={canDeleteSelectedMaster}
              selectedMasterJigCount={
                selectedMasterId ? (masterChildCounts.get(selectedMasterId) ?? 0) : 0
              }
              tableQuery={tableQuery}
              onTableQueryChange={setTableQuery}
              canDeleteSelectedCategory={canDeleteSelectedCategory}
              canUnassignCards={canUnassignCards}
              profileActionsLocked={selectedProfilesLocked}
              generateLocked={viewingCategoryLocked}
              createMasterDisabled={createMasterDisabled}
              onCreateMaster={handleCreateMasterClick}
              onGenerate={() => {
                if (toolbarMasterId) onGenerate(toolbarMasterId, selectedProfileCategoryId ?? undefined);
              }}
              onEdit={handleToolbarEdit}
              onMove={handleToolbarMove}
              onCopy={openCopyModal}
              onDelete={() => void handleToolbarDelete()}
              onRejig={onRejig}
              onAssignCards={onAssignCards}
              onUnassignCards={() => void handleUnassignCards()}
              onMassDistribute={onMassDistribute}
              onExport={onExport}
              onImport={() => setShowImportModal(true)}
              onDeleteCategory={() => void handleDeleteCategory()}
            />

            <div className="accounts-table-wrap">
              <div className="table-scroll">
                <table
                  ref={profileTableColumns.tableRef}
                  className={`profiles-table accounts-table ${profileTableColumns.tableClassName}`.trim()}
                >
                  <TableColGroup columns={profileTableColumns} />
                  <thead>
                    <tr>
                      <ResizableTh columns={profileTableColumns} id="check" className="col-check">
                        <RowCheckbox
                          checked={allSelected}
                          aria-label="Select all profiles"
                          onClick={() => {
                            setSelectedIds(allSelected ? [] : [...orderedIds]);
                            anchorIndexRef.current = null;
                          }}
                        />
                      </ResizableTh>
                      <ResizableTh columns={profileTableColumns} id="index" className="col-index">
                        #
                      </ResizableTh>
                      <ResizableTh columns={profileTableColumns} id="name">
                        Profile Name
                      </ResizableTh>
                      <ResizableTh columns={profileTableColumns} id="billingName">
                        Billing Full Name
                      </ResizableTh>
                      <ResizableTh columns={profileTableColumns} id="email">
                        Billing Email
                      </ResizableTh>
                      <ResizableTh columns={profileTableColumns} id="phone">
                        Phone
                      </ResizableTh>
                      <ResizableTh columns={profileTableColumns} id="address">
                        Billing Full Address
                      </ResizableTh>
                      <ResizableTh columns={profileTableColumns} id="card" className="col-card-profile">
                        Card Profile
                      </ResizableTh>
                      <ResizableTh columns={profileTableColumns} id="accounts">
                        Accounts
                      </ResizableTh>
                      <ResizableTh columns={profileTableColumns} id="status" className="col-status">
                        Status
                      </ResizableTh>
                      <ResizableTh columns={profileTableColumns} id="notes" className="col-notes">
                        Notes
                      </ResizableTh>
                    </tr>
                  </thead>
                  <tbody>
                    {searchFilteredProfiles.length === 0 ? (
                      <tr>
                        <td colSpan={tableColumnCount} className="table-empty">
                          {activeOpportunityId
                            ? "No jig profiles match this opportunity in the current view."
                            : selectedCategory && canDeleteSelectedCategory
                              ? "No jig profiles in this category. You can delete it using the toolbar."
                              : selectedMasterId
                                ? "No jig profiles for this master yet. Use Generate on the toolbar."
                                : "No jig profiles yet. Create a master, then use Generate on the toolbar."}
                        </td>
                      </tr>
                    ) : (
                      searchFilteredProfiles.map((profile, index) => {
                        const selected = selectedIds.includes(profile.id);
                        return (
                          <tr
                            key={profile.id}
                            className={selected ? "row-selected" : undefined}
                            onClick={(event) => handleRowClick(event, profile.id, index)}
                          >
                            <td className="col-check">
                              <RowCheckbox
                                checked={selected}
                                aria-label={`Select profile ${profile.name || index + 1}`}
                                onClick={(event) => applySelection(event, profile.id, index)}
                              />
                            </td>
                            <td className="col-index">{index + 1}</td>
                            <td>{profile.name || "—"}</td>
                            <td>{profile.billingFullName || "—"}</td>
                            <td className="col-email">{profile.billingEmail || "—"}</td>
                            <td className="col-phone">{profile.billingPhone || "—"}</td>
                            <td className="col-address">
                              <BillingAddressCell
                                line1={profile.billingAddressLine1}
                                line2={profile.billingAddressLine2}
                                line3={profile.billingAddressLine3}
                              />
                            </td>
                            <td className="col-card-profile">
                              <CardProfileCell
                                profileName={profile.creditCardLabel}
                                brand={profile.cardBrand}
                                lastFour={profile.cardNumberMasked || profile.paymentNumber}
                              />
                            </td>
                            <td>{profile.accounts || "—"}</td>
                            <td className="col-status">
                              <AccountStatusDisplay status={profile.accountStatus ?? "good"} />
                            </td>
                            <td className="col-notes" title={profile.notes}>
                              {profile.notes || "—"}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        </div>
      </div>

      <ProfileFormModal
        open={showProfileModal}
        title={isMassEditing ? `Edit ${editTargetIds.length} profiles` : "Edit profile"}
        profileDraft={profileDraft}
        isEditing={isEditing}
        isMassEditing={isMassEditing}
        massEditCount={editTargetIds.length}
        mixedFields={mixedFields}
        touchedFields={touchedFields}
        formCategories={formCategories}
        draftCategorySelection={draftCategorySelection}
        canDeleteDraftCategory={canDeleteDraftCategory && !isMassEditing}
        status={status}
        creditCards={creditCards}
        credentials={credentials}
        onClose={closeProfileModal}
        onProfileDraftChange={setProfileDraft}
        onDraftCategorySelectionChange={setDraftCategorySelection}
        onFieldTouch={touchField}
        onSave={() => void save()}
        onDeleteDraftCategory={() =>
          void deleteCategoryById(
            draftCategorySelection.kind === "existing" ? draftCategorySelection.categoryId : "",
          )
        }
      />

      <CreateCategoryModal
        open={showCreateCategory}
        onClose={() => setShowCreateCategory(false)}
        onSave={handleCreateCategory}
      />

      <MoveProfilesModal
        open={showMoveModal}
        selectedCount={selectedIds.length}
        categories={moveCategories}
        selection={moveCategorySelection}
        onSelectionChange={setMoveCategorySelection}
        onClose={closeMoveModal}
        onMove={handleMoveSelected}
      />

      <MoveProfilesModal
        open={showCopyModal}
        mode="copy"
        selectedCount={selectedIds.length}
        categories={moveCategories}
        selection={copyCategorySelection}
        onSelectionChange={setCopyCategorySelection}
        onClose={closeCopyModal}
        onMove={handleCopySelected}
      />

      <ConfirmDeleteModal
        open={deleteConfirm !== null}
        title={deleteConfirm?.title ?? "Confirm delete"}
        message={deleteConfirm?.message ?? ""}
        confirmLabel={deleteConfirm?.confirmLabel}
        busy={deleteConfirmBusy}
        onClose={closeConfirm}
        onConfirm={acceptConfirm}
      />

      <ImportProfilesModal
        open={showImportModal}
        masterProfiles={masterProfiles}
        profiles={profiles}
        categories={categories}
        credentials={credentials}
        initialMasterId={selectedMasterId}
        initialCategoryId={selectedProfileCategoryId}
        onSaveCategory={onSaveCategory}
        onClose={() => setShowImportModal(false)}
        onImport={onImportProfiles}
      />
    </>
  );
}

function existingCategorySelection(categoryId?: string): CategorySelection {
  return {
    kind: "existing",
    categoryId: categoryId ?? PROFILE_UNCATEGORIZED_CATEGORY_ID,
  };
}
