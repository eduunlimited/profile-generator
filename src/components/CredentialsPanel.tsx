import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import {
  categoriesWithAccounts,
  createUncategorizedCategory,
  nextCategorySortOrder,
  reorderCategoryIds,
  sortAccountCategories,
  UNCATEGORIZED_CATEGORY_ID,
} from "../lib/accountCategoryUtils";
import {
  filterDuplicateAccountImports,
  formatAccountImportSkipMessage,
  parseBulkCredentialLines,
} from "../lib/bulkCredentialImport";
import {
  applyMassEditPatch,
  buildMassEditDraft,
  emptyMixedFields,
  emptyTouchedFields,
  hasMassEditChanges,
  type CredentialMixedFields,
  type CredentialEditField,
  type CredentialTouchedFields,
} from "../lib/credentialMassEdit";
import { applyExcelListSelection } from "../lib/listSelection";
import { ACCOUNT_SITES, DEFAULT_ACCOUNT_SITE } from "../lib/profileEmailUtils";
import type { AccountCategory, Credential } from "../lib/types";
import { useConfirmDelete } from "../hooks/useConfirmDelete";
import { useResizableTableColumns } from "../hooks/useResizableTableColumns";
import {
  resolveCategorySelection,
  type CategorySelection,
} from "./AccountCategorySelect";
import { AccountFormModal } from "./AccountFormModal";
import { ConfirmDeleteModal } from "./ConfirmDeleteModal";
import { AccountStatusDisplay } from "./AccountStatusDisplay";
import { CreateCategoryModal } from "./CreateCategoryModal";
import { MoveAccountsModal } from "./MoveAccountsModal";
import { RenameableCategoryName } from "./RenameableCategoryName";
import { ResizableTh, TableColGroup } from "./ResizableTable";
import { RowCheckbox } from "./ui";

const ACCOUNTS_SIDEBAR_WIDTH_KEY = "profile-generator:accounts-sidebar-width";
const ACCOUNTS_SIDEBAR_DEFAULT_WIDTH = 200;
const ACCOUNTS_SIDEBAR_MIN_WIDTH = 140;
const ACCOUNTS_SIDEBAR_MAX_WIDTH = 420;
const ACCOUNT_TABLE_COLUMNS = ["check", "index", "site", "username", "status", "profile", "notes"] as const;
const ACCOUNT_TABLE_LOCKED_COLUMNS = ["check"] as const;

function clampSidebarWidth(width: number): number {
  return Math.min(ACCOUNTS_SIDEBAR_MAX_WIDTH, Math.max(ACCOUNTS_SIDEBAR_MIN_WIDTH, width));
}

function readSidebarWidth(): number {
  const stored = localStorage.getItem(ACCOUNTS_SIDEBAR_WIDTH_KEY);
  if (!stored) {
    return ACCOUNTS_SIDEBAR_DEFAULT_WIDTH;
  }
  const parsed = Number(stored);
  return Number.isFinite(parsed) ? clampSidebarWidth(parsed) : ACCOUNTS_SIDEBAR_DEFAULT_WIDTH;
}

interface CredentialsPanelProps {
  credentials: Credential[];
  categories: AccountCategory[];
  profileLabelForCredential?: (credentialId: string) => string;
  onSave: (credential: Credential) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onImport: (credentials: Credential[]) => Promise<void>;
  onSaveCategory: (category: AccountCategory) => Promise<void>;
  onDeleteCategory: (id: string) => Promise<void>;
  onReorderCategories?: (orderedIds: string[]) => Promise<void>;
}

export function CredentialsPanel({
  credentials,
  categories,
  profileLabelForCredential,
  onSave,
  onDelete,
  onImport,
  onSaveCategory,
  onDeleteCategory,
  onReorderCategories,
}: CredentialsPanelProps) {
  const [draft, setDraft] = useState<Credential>(() => emptyCredential());
  const [importText, setImportText] = useState("");
  const [importSite, setImportSite] = useState<string>(DEFAULT_ACCOUNT_SITE);
  const [draftCategorySelection, setDraftCategorySelection] = useState<CategorySelection>(() =>
    existingCategorySelection(),
  );
  const [importCategorySelection, setImportCategorySelection] = useState<CategorySelection>(() =>
    existingCategorySelection(),
  );
  const [status, setStatus] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>("all");
  const [categorySearch, setCategorySearch] = useState("");
  const [showCreateCategory, setShowCreateCategory] = useState(false);
  const { pending: deleteConfirm, busy: deleteConfirmBusy, askConfirm, closeConfirm, acceptConfirm } =
    useConfirmDelete();
  const [showMoveModal, setShowMoveModal] = useState(false);
  const [moveCategorySelection, setMoveCategorySelection] = useState<CategorySelection>(() =>
    existingCategorySelection(),
  );
  const [draggingCategoryId, setDraggingCategoryId] = useState<string | null>(null);
  const [dragOverCategoryId, setDragOverCategoryId] = useState<string | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(readSidebarWidth);
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [accountModalSection, setAccountModalSection] = useState<"add" | "import">("add");
  const [editTargetIds, setEditTargetIds] = useState<string[]>([]);
  const [mixedFields, setMixedFields] = useState<CredentialMixedFields>(() => emptyMixedFields());
  const [touchedFields, setTouchedFields] = useState<CredentialTouchedFields>(() => emptyTouchedFields());
  const anchorIndexRef = useRef<number | null>(null);

  const isEditing = editTargetIds.length > 0;
  const isMassEditing = editTargetIds.length > 1;

  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const category of categories) {
      counts.set(category.id, 0);
    }
    for (const credential of credentials) {
      const categoryId = credential.categoryId || UNCATEGORIZED_CATEGORY_ID;
      counts.set(categoryId, (counts.get(categoryId) ?? 0) + 1);
    }
    return counts;
  }, [categories, credentials]);

  const activeCategories = useMemo(
    () => categoriesWithAccounts(categories, credentials),
    [categories, credentials],
  );

  const filteredCategories = useMemo(() => {
    const query = categorySearch.trim().toLowerCase();
    if (!query) return activeCategories;
    return activeCategories.filter((category) => category.name.toLowerCase().includes(query));
  }, [activeCategories, categorySearch]);

  const canReorderCategories = Boolean(onReorderCategories) && categorySearch.trim().length === 0;

  const formCategories = useMemo(() => {
    let options = [...activeCategories];
    const selectedDraftCategoryId =
      draftCategorySelection.kind === "existing" ? draftCategorySelection.categoryId : draft.categoryId;
    const draftCategory = categories.find((category) => category.id === selectedDraftCategoryId);
    if (draftCategory && !options.some((category) => category.id === draftCategory.id)) {
      options = sortAccountCategories([...options, draftCategory]);
    }
    if (!options.some((category) => category.id === UNCATEGORIZED_CATEGORY_ID)) {
      options = sortAccountCategories([createUncategorizedCategory(), ...options]);
    }
    return options;
  }, [activeCategories, categories, draft.categoryId, draftCategorySelection]);

  const importCategories = useMemo(() => {
    let options = [...categories];
    if (!options.some((category) => category.id === UNCATEGORIZED_CATEGORY_ID)) {
      options = sortAccountCategories([createUncategorizedCategory(), ...options]);
    }
    return sortAccountCategories(options);
  }, [categories]);

  const customSitesFromPool = useMemo(() => {
    const builtins = new Set<string>(ACCOUNT_SITES);
    return [
      ...new Set(
        credentials.map((credential) => credential.site.trim()).filter((site) => site && !builtins.has(site)),
      ),
    ];
  }, [credentials]);

  const visibleCredentials = useMemo(() => {
    if (selectedCategoryId === "all") return credentials;
    return credentials.filter(
      (credential) => (credential.categoryId || UNCATEGORIZED_CATEGORY_ID) === selectedCategoryId,
    );
  }, [credentials, selectedCategoryId]);

  const accountTableColumns = useResizableTableColumns({
    columnIds: ACCOUNT_TABLE_COLUMNS,
    lockedIds: ACCOUNT_TABLE_LOCKED_COLUMNS,
    storageKey: "accounts",
    fitKey: visibleCredentials
      .map((credential) =>
        [
          credential.id,
          credential.site,
          credential.username,
          credential.accountStatus,
          credential.notes,
          profileLabelForCredential?.(credential.id) ?? "",
        ].join("\t"),
      )
      .join("\n"),
  });

  const orderedIds = visibleCredentials.map((credential) => credential.id);
  const allSelected =
    visibleCredentials.length > 0 && visibleCredentials.every((credential) => selectedIds.includes(credential.id));

  useEffect(() => {
    setSelectedIds((current) => current.filter((id) => orderedIds.includes(id)));
  }, [orderedIds]);

  useEffect(() => {
    if (selectedCategoryId === "all") return;
    if ((categoryCounts.get(selectedCategoryId) ?? 0) === 0) {
      setSelectedCategoryId("all");
    }
  }, [selectedCategoryId, categoryCounts]);

  useEffect(() => {
    if (selectedCategoryId !== "all") {
      setImportCategorySelection(existingCategorySelection(selectedCategoryId));
    }
  }, [selectedCategoryId]);

  useEffect(() => {
    localStorage.setItem(ACCOUNTS_SIDEBAR_WIDTH_KEY, String(sidebarWidth));
  }, [sidebarWidth]);

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

  const openAddModal = () => {
    setEditTargetIds([]);
    setMixedFields(emptyMixedFields());
    setTouchedFields(emptyTouchedFields());
    startNew();
    setAccountModalSection("add");
    setShowAccountModal(true);
  };

  const openImportModal = () => {
    setEditTargetIds([]);
    setMixedFields(emptyMixedFields());
    setTouchedFields(emptyTouchedFields());
    setStatus(null);
    setAccountModalSection("import");
    setShowAccountModal(true);
  };

  const closeAccountModal = () => {
    setShowAccountModal(false);
    setEditTargetIds([]);
    setMixedFields(emptyMixedFields());
    setTouchedFields(emptyTouchedFields());
    setStatus(null);
  };

  const touchField = (field: CredentialEditField) => {
    setTouchedFields((current) => ({ ...current, [field]: true }));
  };

  const startNew = () => {
    setEditTargetIds([]);
    setMixedFields(emptyMixedFields());
    setTouchedFields(emptyTouchedFields());
    const categoryId = selectedCategoryId === "all" ? undefined : selectedCategoryId;
    setDraft(emptyCredential(categoryId));
    setDraftCategorySelection(existingCategorySelection(categoryId));
    setStatus(null);
  };

  const createCategory = async (name: string): Promise<AccountCategory> => {
    const category: AccountCategory = {
      id: crypto.randomUUID(),
      name: name.trim(),
      createdAt: new Date().toISOString(),
      sortOrder: nextCategorySortOrder(categories),
    };
    await onSaveCategory(category);
    return category;
  };

  const renameCategory = async (categoryId: string, nextName: string) => {
    const category =
      categories.find((item) => item.id === categoryId) ??
      (categoryId === UNCATEGORIZED_CATEGORY_ID ? createUncategorizedCategory() : undefined);
    if (!category) return;
    await onSaveCategory({ ...category, name: nextName });
  };

  const save = async () => {
    if (isMassEditing) {
      if (!hasMassEditChanges(touchedFields)) {
        setStatus("Change at least one field to update selected accounts.");
        return;
      }
      if (touchedFields.site && !draft.site.trim()) {
        setStatus("Site is required.");
        return;
      }
      if (touchedFields.username && !draft.username.trim()) {
        setStatus("Username is required.");
        return;
      }
      if (touchedFields.password && !draft.password) {
        setStatus("Password is required.");
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

      for (const id of editTargetIds) {
        const existing = credentials.find((credential) => credential.id === id);
        if (!existing) continue;
        await onSave(applyMassEditPatch(existing, draft, categoryId, touchedFields));
      }

      closeAccountModal();
      return;
    }

    const site = draft.site.trim();
    if (!site) {
      setStatus("Site is required.");
      return;
    }
    if (!draft.username.trim()) {
      setStatus("Username is required.");
      return;
    }
    if (!draft.password.trim()) {
      setStatus("Password is required.");
      return;
    }

    let categoryId: string;
    try {
      categoryId = await resolveCategorySelection(draftCategorySelection, createCategory);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Category is required.");
      return;
    }

    await onSave({
      ...draft,
      site,
      username: draft.username.trim(),
      password: draft.password,
      categoryId,
      accountStatus: draft.accountStatus,
      notes: draft.notes.trim(),
    });
    setDraft(emptyCredential(categoryId));
    setDraftCategorySelection(existingCategorySelection(categoryId));
    closeAccountModal();
  };

  const handleCreateCategory = async (name: string) => {
    const category = await createCategory(name);
    setSelectedCategoryId(category.id);
    setDraft((current) => ({ ...current, categoryId: category.id }));
    setDraftCategorySelection(existingCategorySelection(category.id));
    setImportCategorySelection(existingCategorySelection(category.id));
  };

  const selectedCategory =
    selectedCategoryId === "all"
      ? null
      : activeCategories.find((category) => category.id === selectedCategoryId) ??
        categories.find((category) => category.id === selectedCategoryId) ??
        null;
  const selectedCategoryCount = selectedCategory ? (categoryCounts.get(selectedCategory.id) ?? 0) : 0;
  const canDeleteSelectedCategory = selectedCategory !== null && selectedCategoryCount === 0;
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
        if (selectedCategoryId === categoryId) {
          setSelectedCategoryId("all");
        }
        if (draftCategorySelection.kind === "existing" && draftCategorySelection.categoryId === categoryId) {
          setDraftCategorySelection(existingCategorySelection());
        }
        if (importCategorySelection.kind === "existing" && importCategorySelection.categoryId === categoryId) {
          setImportCategorySelection(existingCategorySelection());
        }
      },
    });
  };

  const loadDraft = (credential: Credential) => {
    setDraft({ ...credential });
    setDraftCategorySelection(existingCategorySelection(credential.categoryId));
    setMixedFields(emptyMixedFields());
    setTouchedFields(emptyTouchedFields());
  };

  const handleEditSelected = () => {
    if (selectedIds.length === 0) return;

    if (selectedIds.length === 1) {
      const credential = credentials.find((item) => item.id === selectedIds[0]);
      if (!credential) return;
      setEditTargetIds([credential.id]);
      loadDraft(credential);
    } else {
      const { draft: massDraft, mixedFields: mixed } = buildMassEditDraft(credentials, selectedIds);
      setEditTargetIds([...selectedIds]);
      setDraft(massDraft);
      setMixedFields(mixed);
      setTouchedFields(emptyTouchedFields());
      setDraftCategorySelection(existingCategorySelection(massDraft.categoryId));
    }

    setAccountModalSection("add");
    setShowAccountModal(true);
  };

  const handleDeleteSelected = () => {
    if (selectedIds.length === 0) return;
    const count = selectedIds.length;
    const ids = [...selectedIds];
    askConfirm({
      title: count === 1 ? "Delete account" : "Delete accounts",
      message: `Delete ${count} account${count === 1 ? "" : "s"}? This cannot be undone.`,
      onConfirm: async () => {
        for (const id of ids) {
          await onDelete(id);
        }
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

  const handleMoveSelected = async () => {
    if (selectedIds.length === 0) return;

    let categoryId: string;
    try {
      categoryId = await resolveCategorySelection(moveCategorySelection, createCategory);
    } catch (error) {
      throw error instanceof Error ? error : new Error("Category is required.");
    }

    for (const id of selectedIds) {
      const existing = credentials.find((credential) => credential.id === id);
      if (!existing) continue;
      if ((existing.categoryId || UNCATEGORIZED_CATEGORY_ID) === categoryId) continue;
      await onSave({ ...existing, categoryId });
    }

    setSelectedIds([]);
    anchorIndexRef.current = null;
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

    const orderedIds = reorderCategoryIds(
      activeCategories.map((category) => category.id),
      draggedId,
      targetId,
    );
    await onReorderCategories(orderedIds);
  };

  const parseImport = async () => {
    const site = importSite.trim();
    if (!site) {
      setStatus("Site is required for bulk import.");
      return;
    }

    const { lines, errors } = parseBulkCredentialLines(importText);
    if (lines.length === 0) {
      setStatus(errors[0] ?? "Paste at least one username:password line.");
      return;
    }
    if (errors.length > 0) {
      setStatus(errors[0]);
      return;
    }

    let categoryId: string;
    try {
      categoryId = await resolveCategorySelection(importCategorySelection, createCategory);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Category is required.");
      return;
    }

    const { lines: uniqueLines, skipped } = filterDuplicateAccountImports(site, lines, credentials);
    if (uniqueLines.length === 0) {
      setStatus(formatAccountImportSkipMessage(site, 0, skipped));
      return;
    }

    const now = new Date().toISOString();
    const imported: Credential[] = uniqueLines.map(({ username, password }) => ({
      id: crypto.randomUUID(),
      site,
      username,
      password,
      categoryId,
      accountStatus: "good",
      notes: "",
      createdAt: now,
    }));

    await onImport(imported);
    setStatus(formatAccountImportSkipMessage(site, imported.length, skipped));
    setImportText("");
    setImportCategorySelection(existingCategorySelection(categoryId));
    setShowAccountModal(false);
  };

  const poolTitle =
    selectedCategoryId === "all" ? "All accounts" : selectedCategory?.name ?? "Category";

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
              <span className="accounts-category-count">{credentials.length}</span>
            </button>
          </div>
          <ul className="accounts-category-list">
            {filteredCategories.map((category) => (
              <li
                key={category.id}
                className={`accounts-category-row${draggingCategoryId === category.id ? " dragging" : ""}${dragOverCategoryId === category.id ? " drag-over" : ""}`}
                onDragOver={(event) => {
                  if (!canReorderCategories || !draggingCategoryId || draggingCategoryId === category.id) {
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
                  const draggedId = event.dataTransfer.getData("text/category-id") || draggingCategoryId;
                  setDragOverCategoryId(null);
                  setDraggingCategoryId(null);
                  if (!draggedId) return;
                  void handleCategoryReorder(draggedId, category.id);
                }}
              >
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
                  className={`accounts-category-item${selectedCategoryId === category.id ? " active" : ""}`}
                  onClick={() => setSelectedCategoryId(category.id)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    setSelectedCategoryId(category.id);
                  }}
                >
                  <RenameableCategoryName
                    name={category.name}
                    onRename={(nextName) => renameCategory(category.id, nextName)}
                  />
                  <span className="accounts-category-count">{categoryCounts.get(category.id) ?? 0}</span>
                </div>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="btn-secondary accounts-create-category-btn"
            onClick={() => setShowCreateCategory(true)}
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
                <h2>Account pool</h2>
                <p className="muted">{poolTitle}</p>
              </div>
            </div>

            <div className="accounts-table-toolbar">
              <div className="button-row compact accounts-toolbar-actions">
                <button type="button" className="btn-secondary btn-compact" onClick={openAddModal}>
                  Add account
                </button>
                <button
                  type="button"
                  className="btn-secondary btn-compact"
                  disabled={selectedIds.length === 0}
                  onClick={handleEditSelected}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="btn-secondary btn-compact"
                  disabled={selectedIds.length === 0}
                  onClick={openMoveModal}
                >
                  Move
                </button>
                <button
                  type="button"
                  className="btn-secondary btn-compact ghost-button danger"
                  disabled={selectedIds.length === 0}
                  onClick={() => void handleDeleteSelected()}
                >
                  Delete
                </button>
                <button type="button" className="btn-secondary btn-compact" onClick={openImportModal}>
                  Import
                </button>
                {canDeleteSelectedCategory ? (
                  <button
                    type="button"
                    className="btn-secondary btn-compact ghost-button danger"
                    onClick={() => void handleDeleteCategory()}
                  >
                    Delete category
                  </button>
                ) : null}
              </div>
            </div>

            <div className="accounts-table-wrap">
              <div className="table-scroll">
                <table
                  ref={accountTableColumns.tableRef}
                  className={`profiles-table accounts-table ${accountTableColumns.tableClassName}`.trim()}
                >
                  <TableColGroup columns={accountTableColumns} />
                  <thead>
                    <tr>
                      <ResizableTh columns={accountTableColumns} id="check" className="col-check">
                        <RowCheckbox
                          checked={allSelected}
                          aria-label="Select all accounts"
                          onClick={() => {
                            setSelectedIds(allSelected ? [] : [...orderedIds]);
                            anchorIndexRef.current = null;
                          }}
                        />
                      </ResizableTh>
                      <ResizableTh columns={accountTableColumns} id="index" className="col-index">
                        #
                      </ResizableTh>
                      <ResizableTh columns={accountTableColumns} id="site">
                        Site
                      </ResizableTh>
                      <ResizableTh columns={accountTableColumns} id="username">
                        Username
                      </ResizableTh>
                      <ResizableTh columns={accountTableColumns} id="status">
                        Status
                      </ResizableTh>
                      <ResizableTh columns={accountTableColumns} id="profile">
                        Profile
                      </ResizableTh>
                      <ResizableTh columns={accountTableColumns} id="notes">
                        Notes
                      </ResizableTh>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleCredentials.length === 0 ? (
                      <tr>
                        <td colSpan={ACCOUNT_TABLE_COLUMNS.length} className="table-empty">
                          {selectedCategory && canDeleteSelectedCategory
                            ? "No accounts in this category. You can delete it using the toolbar."
                            : "No accounts in this category."}
                        </td>
                      </tr>
                    ) : (
                      visibleCredentials.map((credential, index) => {
                        const selected = selectedIds.includes(credential.id);
                        return (
                          <tr
                            key={credential.id}
                            className={selected ? "row-selected" : undefined}
                            onClick={(event) => handleRowClick(event, credential.id, index)}
                          >
                            <td className="col-check">
                              <RowCheckbox
                                checked={selected}
                                aria-label={`Select account ${credential.username || credential.site}`}
                                onClick={(event) => applySelection(event, credential.id, index)}
                              />
                            </td>
                            <td className="col-index">{index + 1}</td>
                            <td>{credential.site}</td>
                            <td className="col-username" title={credential.username}>
                              {credential.username || "—"}
                            </td>
                            <td className="col-status">
                              <AccountStatusDisplay status={credential.accountStatus} />
                            </td>
                            <td className="col-profile" title={profileLabelForCredential?.(credential.id) ?? ""}>
                              {profileLabelForCredential?.(credential.id) ?? "—"}
                            </td>
                            <td className="col-notes" title={credential.notes}>
                              {credential.notes || "—"}
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

      <AccountFormModal
        open={showAccountModal}
        title={
          isMassEditing
            ? `Edit ${editTargetIds.length} accounts`
            : isEditing
              ? "Edit account"
              : accountModalSection === "import"
                ? "Import accounts"
                : "Add account"
        }
        draft={draft}
        isEditing={isEditing}
        isMassEditing={isMassEditing}
        massEditCount={editTargetIds.length}
        mixedFields={mixedFields}
        touchedFields={touchedFields}
        formCategories={formCategories}
        importCategories={importCategories}
        draftCategorySelection={draftCategorySelection}
        importCategorySelection={importCategorySelection}
        importSite={importSite}
        importText={importText}
        customSitesFromPool={customSitesFromPool}
        canDeleteDraftCategory={canDeleteDraftCategory && !isMassEditing}
        status={status}
        onClose={closeAccountModal}
        onDraftChange={setDraft}
        onDraftCategorySelectionChange={setDraftCategorySelection}
        onImportSiteChange={setImportSite}
        onImportCategorySelectionChange={setImportCategorySelection}
        onImportTextChange={setImportText}
        onFieldTouch={touchField}
        onSave={() => void save()}
        onImport={() => void parseImport()}
        onStartNew={startNew}
        onDeleteDraftCategory={() =>
          void deleteCategoryById(
            draftCategorySelection.kind === "existing" ? draftCategorySelection.categoryId : "",
          )
        }
        initialSection={accountModalSection}
      />

      <CreateCategoryModal
        open={showCreateCategory}
        onClose={() => setShowCreateCategory(false)}
        onSave={handleCreateCategory}
      />

      <MoveAccountsModal
        open={showMoveModal}
        selectedCount={selectedIds.length}
        categories={importCategories}
        selection={moveCategorySelection}
        onSelectionChange={setMoveCategorySelection}
        onClose={closeMoveModal}
        onMove={handleMoveSelected}
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
    </>
  );
}

function existingCategorySelection(categoryId?: string): CategorySelection {
  return {
    kind: "existing",
    categoryId: categoryId ?? UNCATEGORIZED_CATEGORY_ID,
  };
}

function emptyCredential(categoryId?: string): Credential {
  return {
    id: crypto.randomUUID(),
    site: DEFAULT_ACCOUNT_SITE,
    username: "",
    password: "",
    categoryId: categoryId ?? UNCATEGORIZED_CATEGORY_ID,
    accountStatus: "good",
    notes: "",
    createdAt: new Date().toISOString(),
  };
}
