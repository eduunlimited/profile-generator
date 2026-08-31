import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import {
  categoriesWithEmails,
  createUncategorizedEmailCategory,
  EMAIL_UNCATEGORIZED_CATEGORY_ID,
  nextEmailCategorySortOrder,
  reorderEmailCategoryIds,
  sortEmailCategories,
} from "../lib/emailCategoryUtils";
import {
  filterDuplicateEmailImports,
  formatEmailImportSkipMessage,
  parseBulkEmailLines,
} from "../lib/emailImport";
import {
  applyEmailMassEditPatch,
  buildEmailMassEditDraft,
  emptyEmailMixedFields,
  emptyEmailTouchedFields,
  hasEmailMassEditChanges,
  type EmailMixedFields,
  type EmailEditField,
  type EmailTouchedFields,
} from "../lib/emailMassEdit";
import { applyExcelListSelection } from "../lib/listSelection";
import type { EmailCategory, PoolEmail } from "../lib/types";
import { useConfirmDelete } from "../hooks/useConfirmDelete";
import { useResizableTableColumns } from "../hooks/useResizableTableColumns";
import {
  resolveCategorySelection,
  type CategorySelection,
} from "./AccountCategorySelect";
import { EmailFormModal } from "./EmailFormModal";
import { ConfirmDeleteModal } from "./ConfirmDeleteModal";
import { AccountStatusDisplay } from "./AccountStatusDisplay";
import { CreateCategoryModal } from "./CreateCategoryModal";
import { MoveEmailsModal } from "./MoveEmailsModal";
import { RenameableCategoryName } from "./RenameableCategoryName";
import { ResizableTh, TableColGroup } from "./ResizableTable";
import { RowCheckbox } from "./ui";

const EMAILS_SIDEBAR_WIDTH_KEY = "profile-generator:emails-sidebar-width";
const EMAILS_SIDEBAR_DEFAULT_WIDTH = 200;
const EMAILS_SIDEBAR_MIN_WIDTH = 140;
const EMAILS_SIDEBAR_MAX_WIDTH = 420;
const EMAIL_TABLE_COLUMNS = ["check", "index", "email", "status", "assignment", "profile", "notes"] as const;
const EMAIL_TABLE_LOCKED_COLUMNS = ["check"] as const;

function clampSidebarWidth(width: number): number {
  return Math.min(EMAILS_SIDEBAR_MAX_WIDTH, Math.max(EMAILS_SIDEBAR_MIN_WIDTH, width));
}

function readSidebarWidth(): number {
  const stored = localStorage.getItem(EMAILS_SIDEBAR_WIDTH_KEY);
  if (!stored) {
    return EMAILS_SIDEBAR_DEFAULT_WIDTH;
  }
  const parsed = Number(stored);
  return Number.isFinite(parsed) ? clampSidebarWidth(parsed) : EMAILS_SIDEBAR_DEFAULT_WIDTH;
}

interface EmailsPanelProps {
  emails: PoolEmail[];
  categories: EmailCategory[];
  profileLabelForEmail?: (emailId: string) => string;
  onSave: (email: PoolEmail) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onImport: (emails: PoolEmail[]) => Promise<void>;
  onSaveCategory: (category: EmailCategory) => Promise<void>;
  onDeleteCategory: (id: string) => Promise<void>;
  onReorderCategories?: (orderedIds: string[]) => Promise<void>;
  onAssignSelected?: (emailIds: string[]) => void;
}

export function EmailsPanel({
  emails,
  categories,
  profileLabelForEmail,
  onSave,
  onDelete,
  onImport,
  onSaveCategory,
  onDeleteCategory,
  onReorderCategories,
  onAssignSelected,
}: EmailsPanelProps) {
  const [draft, setDraft] = useState<PoolEmail>(() => emptyPoolEmail());
  const [importText, setImportText] = useState("");
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
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [emailModalSection, setEmailModalSection] = useState<"add" | "import">("add");
  const [editTargetIds, setEditTargetIds] = useState<string[]>([]);
  const [mixedFields, setMixedFields] = useState<EmailMixedFields>(() => emptyEmailMixedFields());
  const [touchedFields, setTouchedFields] = useState<EmailTouchedFields>(() => emptyEmailTouchedFields());
  const anchorIndexRef = useRef<number | null>(null);

  const isEditing = editTargetIds.length > 0;
  const isMassEditing = editTargetIds.length > 1;

  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const category of categories) {
      counts.set(category.id, 0);
    }
    for (const email of emails) {
      const categoryId = email.categoryId || EMAIL_UNCATEGORIZED_CATEGORY_ID;
      counts.set(categoryId, (counts.get(categoryId) ?? 0) + 1);
    }
    return counts;
  }, [categories, emails]);

  const activeCategories = useMemo(
    () => categoriesWithEmails(categories, emails),
    [categories, emails],
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
      options = sortEmailCategories([...options, draftCategory]);
    }
    if (!options.some((category) => category.id === EMAIL_UNCATEGORIZED_CATEGORY_ID)) {
      options = sortEmailCategories([createUncategorizedEmailCategory(), ...options]);
    }
    return options;
  }, [activeCategories, categories, draft.categoryId, draftCategorySelection]);

  const importCategories = useMemo(() => {
    let options = [...categories];
    if (!options.some((category) => category.id === EMAIL_UNCATEGORIZED_CATEGORY_ID)) {
      options = sortEmailCategories([createUncategorizedEmailCategory(), ...options]);
    }
    return sortEmailCategories(options);
  }, [categories]);

  const visibleEmails = useMemo(() => {
    if (selectedCategoryId === "all") return emails;
    return emails.filter(
      (email) => (email.categoryId || EMAIL_UNCATEGORIZED_CATEGORY_ID) === selectedCategoryId,
    );
  }, [emails, selectedCategoryId]);

  const emailTableColumns = useResizableTableColumns({
    columnIds: EMAIL_TABLE_COLUMNS,
    lockedIds: EMAIL_TABLE_LOCKED_COLUMNS,
    storageKey: "emails",
    fitKey: visibleEmails
      .map((email) =>
        [
          email.id,
          email.email,
          email.accountStatus,
          email.assignmentScope,
          email.notes,
          profileLabelForEmail?.(email.id) ?? "",
        ].join("\t"),
      )
      .join("\n"),
  });

  const orderedIds = visibleEmails.map((email) => email.id);
  const allSelected =
    visibleEmails.length > 0 && visibleEmails.every((email) => selectedIds.includes(email.id));

  useEffect(() => {
    setSelectedIds((current) => current.filter((id) => orderedIds.includes(id)));
  }, [orderedIds]);

  useEffect(() => {
    if (selectedCategoryId === "all") return;
    const categoryStillExists =
      selectedCategoryId === EMAIL_UNCATEGORIZED_CATEGORY_ID ||
      categories.some((category) => category.id === selectedCategoryId);
    if (categoryStillExists) return;
    setSelectedCategoryId("all");
  }, [categories, selectedCategoryId]);

  useEffect(() => {
    if (selectedCategoryId !== "all") {
      setImportCategorySelection(existingCategorySelection(selectedCategoryId));
    }
  }, [selectedCategoryId]);

  useEffect(() => {
    localStorage.setItem(EMAILS_SIDEBAR_WIDTH_KEY, String(sidebarWidth));
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
    setMixedFields(emptyEmailMixedFields());
    setTouchedFields(emptyEmailTouchedFields());
    startNew();
    setEmailModalSection("add");
    setShowEmailModal(true);
  };

  const openImportModal = () => {
    setEditTargetIds([]);
    setMixedFields(emptyEmailMixedFields());
    setTouchedFields(emptyEmailTouchedFields());
    setStatus(null);
    setEmailModalSection("import");
    setShowEmailModal(true);
  };

  const closeEmailModal = () => {
    setShowEmailModal(false);
    setEditTargetIds([]);
    setMixedFields(emptyEmailMixedFields());
    setTouchedFields(emptyEmailTouchedFields());
    setStatus(null);
  };

  const touchField = (field: EmailEditField) => {
    setTouchedFields((current) => ({ ...current, [field]: true }));
  };

  const startNew = () => {
    setEditTargetIds([]);
    setMixedFields(emptyEmailMixedFields());
    setTouchedFields(emptyEmailTouchedFields());
    const categoryId = selectedCategoryId === "all" ? undefined : selectedCategoryId;
    setDraft(emptyPoolEmail(categoryId));
    setDraftCategorySelection(existingCategorySelection(categoryId));
    setStatus(null);
  };

  const createCategory = async (name: string): Promise<EmailCategory> => {
    const category: EmailCategory = {
      id: crypto.randomUUID(),
      name: name.trim(),
      createdAt: new Date().toISOString(),
      sortOrder: nextEmailCategorySortOrder(categories),
    };
    await onSaveCategory(category);
    return category;
  };

  const renameCategory = async (categoryId: string, nextName: string) => {
    const category =
      categories.find((item) => item.id === categoryId) ??
      (categoryId === EMAIL_UNCATEGORIZED_CATEGORY_ID ? createUncategorizedEmailCategory() : undefined);
    if (!category) return;
    await onSaveCategory({ ...category, name: nextName });
  };

  const save = async () => {
    if (isMassEditing) {
      if (!hasEmailMassEditChanges(touchedFields)) {
        setStatus("Change at least one field to update selected emails.");
        return;
      }
      if (touchedFields.email && !draft.email.trim()) {
        setStatus("Email is required.");
        return;
      }
      if (touchedFields.email && !draft.email.includes("@")) {
        setStatus("Enter a valid email address.");
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
        const existing = emails.find((email) => email.id === id);
        if (!existing) continue;
        await onSave(applyEmailMassEditPatch(existing, draft, categoryId, touchedFields));
      }

      closeEmailModal();
      return;
    }

    if (!draft.email.trim()) {
      setStatus("Email is required.");
      return;
    }
    if (!draft.email.includes("@")) {
      setStatus("Enter a valid email address.");
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
      email: draft.email.trim(),
      categoryId,
      accountStatus: draft.accountStatus,
      assignmentScope: draft.assignmentScope ?? "account_group",
      notes: draft.notes.trim(),
    });
    setDraft(emptyPoolEmail(categoryId));
    setDraftCategorySelection(existingCategorySelection(categoryId));
    closeEmailModal();
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

  const loadDraft = (email: PoolEmail) => {
    setDraft({ ...email });
    setDraftCategorySelection(existingCategorySelection(email.categoryId));
    setMixedFields(emptyEmailMixedFields());
    setTouchedFields(emptyEmailTouchedFields());
  };

  const handleEditSelected = () => {
    if (selectedIds.length === 0) return;

    if (selectedIds.length === 1) {
      const email = emails.find((item) => item.id === selectedIds[0]);
      if (!email) return;
      setEditTargetIds([email.id]);
      loadDraft(email);
    } else {
      const { draft: massDraft, mixedFields: mixed } = buildEmailMassEditDraft(emails, selectedIds);
      setEditTargetIds([...selectedIds]);
      setDraft(massDraft);
      setMixedFields(mixed);
      setTouchedFields(emptyEmailTouchedFields());
      setDraftCategorySelection(existingCategorySelection(massDraft.categoryId));
    }

    setEmailModalSection("add");
    setShowEmailModal(true);
  };

  const handleDeleteSelected = () => {
    if (selectedIds.length === 0) return;
    const count = selectedIds.length;
    const ids = [...selectedIds];
    askConfirm({
      title: count === 1 ? "Delete email" : "Delete emails",
      message: `Delete ${count} email${count === 1 ? "" : "s"}? This cannot be undone.`,
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
      const existing = emails.find((email) => email.id === id);
      if (!existing) continue;
      await onSave({ ...existing, categoryId });
    }
    setSelectedIds([]);
  };

  const handleDeleteCategory = () => {
    if (!selectedCategory || !canDeleteSelectedCategory) return;
    deleteCategoryById(selectedCategory.id);
  };

  const handleCategoryReorder = async (draggedId: string, targetId: string) => {
    if (!onReorderCategories || draggedId === targetId) {
      return;
    }

    const orderedIds = reorderEmailCategoryIds(
      activeCategories.map((category) => category.id),
      draggedId,
      targetId,
    );
    await onReorderCategories(orderedIds);
  };

  const parseImport = async () => {
    const { lines, errors } = parseBulkEmailLines(importText);
    if (lines.length === 0 && errors.length === 0) {
      setStatus("Paste at least one email address.");
      return;
    }
    if (lines.length === 0) {
      setStatus(formatEmailImportSkipMessage(0, [], errors.length) || errors[0]);
      return;
    }

    let categoryId: string;
    try {
      categoryId = await resolveCategorySelection(importCategorySelection, createCategory);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Category is required.");
      return;
    }

    const { lines: uniqueLines, skipped } = filterDuplicateEmailImports(lines, emails);
    if (uniqueLines.length === 0) {
      setStatus(formatEmailImportSkipMessage(0, skipped, errors.length));
      return;
    }

    const now = new Date().toISOString();
    const imported: PoolEmail[] = uniqueLines.map(({ email }) => ({
      id: crypto.randomUUID(),
      email,
      categoryId,
      accountStatus: "good",
      assignmentScope: "account_group",
      notes: "",
      createdAt: now,
    }));

    await onImport(imported);
    setStatus(formatEmailImportSkipMessage(imported.length, skipped, errors.length));
    setImportText("");
    setImportCategorySelection(existingCategorySelection(categoryId));
    setShowEmailModal(false);
  };

  const poolTitle = selectedCategoryId === "all" ? "All emails" : selectedCategory?.name ?? "Category";

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
              <span className="accounts-category-count">{emails.length}</span>
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
                <h2>Email pool</h2>
                <p className="muted">{poolTitle}</p>
              </div>
            </div>

            <div className="accounts-table-toolbar">
              <div className="button-row compact accounts-toolbar-actions">
                <button type="button" className="btn-secondary btn-compact" onClick={openAddModal}>
                  Add email
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
                {onAssignSelected ? (
                  <button
                    type="button"
                    className="btn-secondary btn-compact card-assign-btn"
                    disabled={selectedIds.length === 0}
                    onClick={() => onAssignSelected(selectedIds)}
                  >
                    Assign to profiles
                  </button>
                ) : null}
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
                  ref={emailTableColumns.tableRef}
                  className={`profiles-table accounts-table ${emailTableColumns.tableClassName}`.trim()}
                >
                  <TableColGroup columns={emailTableColumns} />
                  <thead>
                    <tr>
                      <ResizableTh columns={emailTableColumns} id="check" className="col-check">
                        <RowCheckbox
                          checked={allSelected}
                          aria-label="Select all emails"
                          onClick={() => {
                            setSelectedIds(allSelected ? [] : [...orderedIds]);
                            anchorIndexRef.current = null;
                          }}
                        />
                      </ResizableTh>
                      <ResizableTh columns={emailTableColumns} id="index" className="col-index">
                        #
                      </ResizableTh>
                      <ResizableTh columns={emailTableColumns} id="email">
                        Email
                      </ResizableTh>
                      <ResizableTh columns={emailTableColumns} id="status">
                        Status
                      </ResizableTh>
                      <ResizableTh columns={emailTableColumns} id="assignment">
                        Assignment
                      </ResizableTh>
                      <ResizableTh columns={emailTableColumns} id="profile">
                        Profile
                      </ResizableTh>
                      <ResizableTh columns={emailTableColumns} id="notes">
                        Notes
                      </ResizableTh>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleEmails.length === 0 ? (
                      <tr>
                        <td colSpan={EMAIL_TABLE_COLUMNS.length} className="table-empty">
                          {selectedCategory && canDeleteSelectedCategory
                            ? "No emails in this category. You can delete it using the toolbar."
                            : "No emails in this category."}
                        </td>
                      </tr>
                    ) : (
                      visibleEmails.map((email, index) => {
                        const selected = selectedIds.includes(email.id);
                        return (
                          <tr
                            key={email.id}
                            className={selected ? "row-selected" : undefined}
                            onClick={(event) => handleRowClick(event, email.id, index)}
                          >
                            <td className="col-check">
                              <RowCheckbox
                                checked={selected}
                                aria-label={`Select email ${email.email}`}
                                onClick={(event) => applySelection(event, email.id, index)}
                              />
                            </td>
                            <td className="col-index">{index + 1}</td>
                            <td title={email.email}>{email.email || "—"}</td>
                            <td className="col-status">
                              <AccountStatusDisplay status={email.accountStatus} />
                            </td>
                            <td>
                              {email.assignmentScope === "single_profile" ? "1 profile" : "Per category"}
                            </td>
                            <td className="col-profile" title={profileLabelForEmail?.(email.id) ?? ""}>
                              {profileLabelForEmail?.(email.id) ?? "—"}
                            </td>
                            <td className="col-notes" title={email.notes}>
                              {email.notes || "—"}
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

      <EmailFormModal
        open={showEmailModal}
        title={
          isMassEditing
            ? `Edit ${editTargetIds.length} emails`
            : isEditing
              ? "Edit email"
              : emailModalSection === "import"
                ? "Import emails"
                : "Add email"
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
        importText={importText}
        canDeleteDraftCategory={canDeleteDraftCategory && !isMassEditing}
        status={status}
        onClose={closeEmailModal}
        onDraftChange={setDraft}
        onDraftCategorySelectionChange={setDraftCategorySelection}
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
        initialSection={emailModalSection}
      />

      <CreateCategoryModal
        open={showCreateCategory}
        onClose={() => setShowCreateCategory(false)}
        onSave={handleCreateCategory}
      />

      <MoveEmailsModal
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
    categoryId: categoryId ?? EMAIL_UNCATEGORIZED_CATEGORY_ID,
  };
}

function emptyPoolEmail(categoryId?: string): PoolEmail {
  return {
    id: crypto.randomUUID(),
    email: "",
    categoryId: categoryId ?? EMAIL_UNCATEGORIZED_CATEGORY_ID,
    accountStatus: "good",
    assignmentScope: "account_group",
    notes: "",
    createdAt: new Date().toISOString(),
  };
}
