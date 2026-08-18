import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import {
  buildCardCategoryNameMap,
  CARD_UNCATEGORIZED_CATEGORY_ID,
  cardCategoryId,
  categoriesWithCards,
  createUncategorizedCardCategory,
  nextCardCategorySortOrder,
  reorderCategoryIds,
  sortCardCategories,
} from "../lib/cardCategoryUtils";
import {
  applyCardMassEditPatch,
  buildCardMassEditDraft,
  emptyCardMixedFields,
  emptyCardTouchedFields,
  hasCardMassEditChanges,
  type CardEditField,
  type CardMixedFields,
  type CardTouchedFields,
} from "../lib/cardMassEdit";
import { parseCardNumberDigits, formatCardNumberDisplay, maskCardNumberDisplay, normalizeCardExpiryString } from "../lib/creditCardUtils";
import {
  buildImportedCreditCards,
  ensureImportCategories,
  filterDuplicateCardImports,
  formatCardImportSkipMessage,
  getCardCsvImportLayout,
  guessCardImportColumnMapping,
  normalizeImportedCreditCard,
  parseCardImportCsv,
  parseCardImportJson,
  readCsvImportFile,
  type CardImportColumnMapping,
  type CardImportFormat,
} from "../lib/cardImport";
import { applyExcelListSelection } from "../lib/listSelection";
import type { CardCategory, CreditCard } from "../lib/types";
import { useConfirmDelete } from "../hooks/useConfirmDelete";
import { useResizableTableColumns } from "../hooks/useResizableTableColumns";
import {
  resolveCategorySelection,
  type CategorySelection,
} from "./AccountCategorySelect";
import { AccountStatusDisplay } from "./AccountStatusDisplay";
import { CardBrandIcon } from "./CardBrandIcon";
import { CardFormModal, emptyCard } from "./CardFormModal";
import { ConfirmDeleteModal } from "./ConfirmDeleteModal";
import { CreateCategoryModal } from "./CreateCategoryModal";
import { MoveCardsModal } from "./MoveCardsModal";
import { RenameableCategoryName } from "./RenameableCategoryName";
import { ResizableTh, TableColGroup } from "./ResizableTable";
import { RowCheckbox } from "./ui";

const CARDS_SIDEBAR_WIDTH_KEY = "profile-generator:cards-sidebar-width";
const CARDS_SIDEBAR_DEFAULT_WIDTH = 200;
const CARDS_SIDEBAR_MIN_WIDTH = 140;
const CARDS_SIDEBAR_MAX_WIDTH = 420;
const CARD_TABLE_COLUMNS = [
  "check",
  "index",
  "brand",
  "name",
  "category",
  "number",
  "cvv",
  "exp",
  "status",
  "profiles",
  "notes",
] as const;
const CARD_TABLE_LOCKED_COLUMNS = ["check"] as const;

function clampSidebarWidth(width: number): number {
  return Math.min(CARDS_SIDEBAR_MAX_WIDTH, Math.max(CARDS_SIDEBAR_MIN_WIDTH, width));
}

function readSidebarWidth(): number {
  const stored = localStorage.getItem(CARDS_SIDEBAR_WIDTH_KEY);
  if (!stored) {
    return CARDS_SIDEBAR_DEFAULT_WIDTH;
  }
  const parsed = Number(stored);
  return Number.isFinite(parsed) ? clampSidebarWidth(parsed) : CARDS_SIDEBAR_DEFAULT_WIDTH;
}

interface CreditCardsPanelProps {
  cards: CreditCard[];
  categories: CardCategory[];
  profileLabelForCard?: (cardId: string) => string;
  onSave: (card: CreditCard) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onImport: (cards: CreditCard[]) => Promise<void>;
  onSaveCategory: (category: CardCategory) => Promise<void>;
  onDeleteCategory: (id: string) => Promise<void>;
  onReorderCategories?: (orderedIds: string[]) => Promise<void>;
  onAssignSelected?: (cardIds: string[]) => void;
}

export function CreditCardsPanel({
  cards,
  categories,
  profileLabelForCard,
  onSave,
  onDelete,
  onImport,
  onSaveCategory,
  onDeleteCategory,
  onReorderCategories,
  onAssignSelected,
}: CreditCardsPanelProps) {
  const [draft, setDraft] = useState<CreditCard>(() => emptyCard());
  const [importText, setImportText] = useState("");
  const [importFormat, setImportFormat] = useState<CardImportFormat>("csv");
  const [importCsvText, setImportCsvText] = useState("");
  const [importCsvFileName, setImportCsvFileName] = useState("");
  const [importColumnMapping, setImportColumnMapping] = useState<CardImportColumnMapping>([]);
  const [draftCategorySelection, setDraftCategorySelection] = useState<CategorySelection>(() =>
    existingCategorySelection(),
  );
  const [importCategorySelection, setImportCategorySelection] = useState<CategorySelection>(() =>
    existingCategorySelection(),
  );
  const [status, setStatus] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [privacyOn, setPrivacyOn] = useState(true);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>("all");
  const [categorySearch, setCategorySearch] = useState("");
  const [cardSearch, setCardSearch] = useState("");
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
  const [showCardModal, setShowCardModal] = useState(false);
  const [cardModalSection, setCardModalSection] = useState<"add" | "import">("add");
  const [editTargetIds, setEditTargetIds] = useState<string[]>([]);
  const [mixedFields, setMixedFields] = useState<CardMixedFields>(() => emptyCardMixedFields());
  const [touchedFields, setTouchedFields] = useState<CardTouchedFields>(() => emptyCardTouchedFields());
  const anchorIndexRef = useRef<number | null>(null);

  const isEditing = editTargetIds.length > 0;
  const isMassEditing = editTargetIds.length > 1;

  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const category of categories) {
      counts.set(category.id, 0);
    }
    for (const card of cards) {
      const categoryId = cardCategoryId(card);
      counts.set(categoryId, (counts.get(categoryId) ?? 0) + 1);
    }
    return counts;
  }, [categories, cards]);

  const activeCategories = useMemo(
    () => categoriesWithCards(categories, cards),
    [categories, cards],
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
      options = sortCardCategories([...options, draftCategory]);
    }
    if (!options.some((category) => category.id === CARD_UNCATEGORIZED_CATEGORY_ID)) {
      options = sortCardCategories([createUncategorizedCardCategory(), ...options]);
    }
    return options;
  }, [activeCategories, categories, draft.categoryId, draftCategorySelection]);

  const importCategories = useMemo(() => {
    let options = [...categories];
    if (!options.some((category) => category.id === CARD_UNCATEGORIZED_CATEGORY_ID)) {
      options = sortCardCategories([createUncategorizedCardCategory(), ...options]);
    }
    return sortCardCategories(options);
  }, [categories]);

  const importCsvLayout = useMemo(() => {
    if (!importCsvText.trim()) {
      return null;
    }
    return getCardCsvImportLayout(importCsvText);
  }, [importCsvText]);

  const importCsvHeaders = importCsvLayout?.displayHeaders ?? null;

  useEffect(() => {
    if (!importCsvLayout) {
      setImportColumnMapping([]);
      return;
    }

    setImportColumnMapping((current) => {
      if (
        current.length === importCsvLayout.displayHeaders.length &&
        current.some((field) => field === "number")
      ) {
        return current;
      }
      return importCsvLayout.suggestedMapping;
    });
  }, [importCsvLayout]);

  const visibleCards = useMemo(() => {
    if (selectedCategoryId === "all") return cards;
    return cards.filter((card) => cardCategoryId(card) === selectedCategoryId);
  }, [cards, selectedCategoryId]);

  const categoryNameById = useMemo(
    () => buildCardCategoryNameMap(categories, cards),
    [categories, cards],
  );

  const searchFilteredCards = useMemo(() => {
    const query = cardSearch.trim().toLowerCase();
    if (!query) return visibleCards;
    return visibleCards.filter((card) => {
      const associatedProfiles = profileLabelForCard?.(card.id) ?? "";
      const categoryName = categoryNameById.get(cardCategoryId(card)) ?? "";
      const haystack = [
        card.profileName,
        card.number,
        formatCardNumberDisplay(card.number, card.brand),
        card.cvv,
        card.expiry,
        normalizeCardExpiryString(card.expiry),
        card.brand,
        card.notes,
        associatedProfiles,
        categoryName,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [visibleCards, cardSearch, profileLabelForCard, categoryNameById]);

  const cardTableColumns = useResizableTableColumns({
    columnIds: CARD_TABLE_COLUMNS,
    lockedIds: CARD_TABLE_LOCKED_COLUMNS,
    storageKey: "cards",
    fitKey: `${privacyOn}\n${searchFilteredCards
      .map((card) =>
        [
          card.id,
          card.profileName,
          card.brand,
          card.number,
          card.cvv,
          card.expiry,
          card.notes,
          card.accountStatus,
          profileLabelForCard?.(card.id) ?? "",
          categoryNameById.get(cardCategoryId(card)) ?? "",
        ].join("\t"),
      )
      .join("\n")}`,
  });

  const orderedIds = searchFilteredCards.map((card) => card.id);
  const allSelected =
    searchFilteredCards.length > 0 &&
    searchFilteredCards.every((card) => selectedIds.includes(card.id));

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
    localStorage.setItem(CARDS_SIDEBAR_WIDTH_KEY, String(sidebarWidth));
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

  const startNew = () => {
    setEditTargetIds([]);
    setMixedFields(emptyCardMixedFields());
    setTouchedFields(emptyCardTouchedFields());
    const categoryId = selectedCategoryId === "all" ? undefined : selectedCategoryId;
    setDraft(emptyCard(categoryId));
    setDraftCategorySelection(existingCategorySelection(categoryId));
    setStatus(null);
  };

  const openAddModal = () => {
    startNew();
    setCardModalSection("add");
    setShowCardModal(true);
  };

  const openImportModal = () => {
    setEditTargetIds([]);
    setMixedFields(emptyCardMixedFields());
    setTouchedFields(emptyCardTouchedFields());
    setStatus(null);
    setImportFormat("csv");
    setImportText("");
    setImportCsvText("");
    setImportCsvFileName("");
    setImportColumnMapping([]);
    setCardModalSection("import");
    setShowCardModal(true);
  };

  const closeCardModal = () => {
    setShowCardModal(false);
    setEditTargetIds([]);
    setMixedFields(emptyCardMixedFields());
    setTouchedFields(emptyCardTouchedFields());
    setStatus(null);
  };

  const touchField = (field: CardEditField) => {
    setTouchedFields((current) => ({ ...current, [field]: true }));
  };

  const createCategory = async (name: string): Promise<CardCategory> => {
    const category: CardCategory = {
      id: crypto.randomUUID(),
      name: name.trim(),
      createdAt: new Date().toISOString(),
      sortOrder: nextCardCategorySortOrder(categories),
    };
    await onSaveCategory(category);
    return category;
  };

  const renameCategory = async (categoryId: string, nextName: string) => {
    const category =
      categories.find((item) => item.id === categoryId) ??
      (categoryId === CARD_UNCATEGORIZED_CATEGORY_ID ? createUncategorizedCardCategory() : undefined);
    if (!category) return;
    await onSaveCategory({ ...category, name: nextName });
  };

  const save = async () => {
    if (isMassEditing) {
      if (!hasCardMassEditChanges(touchedFields)) {
        setStatus("Change at least one field to update selected cards.");
        return;
      }
      if (touchedFields.profileName && !draft.profileName.trim()) {
        setStatus("Card name is required.");
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
        const existing = cards.find((card) => card.id === id);
        if (!existing) continue;
        const patched = applyCardMassEditPatch(existing, draft, categoryId, touchedFields);
        await onSave({
          ...patched,
          profileName: patched.profileName.trim(),
          number: parseCardNumberDigits(patched.number),
          expiry: normalizeCardExpiryString(patched.expiry),
        });
      }

      closeCardModal();
      return;
    }

    if (!draft.profileName.trim()) {
      setStatus("Card name is required for each card.");
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
      profileName: draft.profileName.trim(),
      number: parseCardNumberDigits(draft.number),
      expiry: normalizeCardExpiryString(draft.expiry),
      notes: draft.notes.trim(),
      categoryId,
    });
    closeCardModal();
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

  const loadDraft = (card: CreditCard) => {
    setDraft({ ...card });
    setDraftCategorySelection(existingCategorySelection(card.categoryId));
    setMixedFields(emptyCardMixedFields());
    setTouchedFields(emptyCardTouchedFields());
  };

  const handleEditSelected = () => {
    if (selectedIds.length === 0) return;

    if (selectedIds.length === 1) {
      const card = cards.find((item) => item.id === selectedIds[0]);
      if (!card) return;
      setEditTargetIds([card.id]);
      loadDraft(card);
    } else {
      const { draft: massDraft, mixedFields: mixed } = buildCardMassEditDraft(cards, selectedIds);
      setEditTargetIds([...selectedIds]);
      setDraft(massDraft);
      setMixedFields(mixed);
      setTouchedFields(emptyCardTouchedFields());
      setDraftCategorySelection(existingCategorySelection(massDraft.categoryId));
    }

    setCardModalSection("add");
    setShowCardModal(true);
  };

  const handleDeleteSelected = () => {
    if (selectedIds.length === 0) return;
    const count = selectedIds.length;
    const ids = [...selectedIds];
    askConfirm({
      title: count === 1 ? "Delete card" : "Delete cards",
      message: `Delete ${count} card${count === 1 ? "" : "s"}? This cannot be undone.`,
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
      const existing = cards.find((card) => card.id === id);
      if (!existing) continue;
      if ((existing.categoryId || CARD_UNCATEGORIZED_CATEGORY_ID) === categoryId) continue;
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

    const nextOrder = reorderCategoryIds(
      activeCategories.map((category) => category.id),
      draggedId,
      targetId,
    );
    await onReorderCategories(nextOrder);
  };

  const handleCsvFileUpload = async (file: File | null) => {
    if (!file) return;

    const result = await readCsvImportFile(file);
    if ("error" in result) {
      setStatus(result.error);
      setImportCsvText("");
      setImportCsvFileName("");
      setImportColumnMapping([]);
      return;
    }

    setStatus(null);
    setImportCsvText(result.text);
    setImportCsvFileName(result.fileName);
    setImportColumnMapping(guessCardImportColumnMapping(result.headers));
  };

  const clearCsvImport = () => {
    setImportCsvText("");
    setImportCsvFileName("");
    setImportColumnMapping([]);
  };

  const handleImportCsvTextChange = (text: string) => {
    setStatus(null);
    setImportCsvText(text);
    if (text.trim()) {
      setImportCsvFileName("");
    }
  };

  const parseImport = async () => {
    try {
      let items;
      let errors: string[];

      if (importFormat === "json") {
        ({ items, errors } = parseCardImportJson(importText));
      } else {
        if (!importCsvText.trim()) {
          setStatus("Paste or upload CSV data to import.");
          return;
        }
        ({ items, errors } = parseCardImportCsv(importCsvText, importColumnMapping));
      }

      if (errors.length > 0) {
        setStatus(errors.join(" "));
        return;
      }
      if (items.length === 0) {
        setStatus("No cards found to import.");
        return;
      }

      const categoryMappedInCsv =
        importFormat === "csv" && importColumnMapping.includes("categoryId");

      let fallbackCategoryId: string;
      try {
        fallbackCategoryId = await resolveCategorySelection(importCategorySelection, createCategory);
      } catch (error) {
        if (categoryMappedInCsv) {
          fallbackCategoryId = CARD_UNCATEGORIZED_CATEGORY_ID;
        } else {
          setStatus(error instanceof Error ? error.message : "Category is required.");
          return;
        }
      }

      const categoryLookup = await ensureImportCategories(items, importCategories, createCategory);

      const { cards: importedCards, errors: buildErrors } = buildImportedCreditCards(
        items,
        categoryLookup,
        fallbackCategoryId,
      );
      if (buildErrors.length > 0) {
        setStatus(buildErrors.join(" "));
        return;
      }

      const imported = importedCards.map((card) => normalizeImportedCreditCard(card));
      const { cards: uniqueCards, skipped } = filterDuplicateCardImports(imported, cards);
      if (uniqueCards.length === 0) {
        setStatus(formatCardImportSkipMessage(0, skipped));
        return;
      }

      await onImport(uniqueCards);
      setStatus(formatCardImportSkipMessage(uniqueCards.length, skipped));
      setImportText("");
      clearCsvImport();
      setImportCategorySelection(existingCategorySelection(fallbackCategoryId));
      setShowCardModal(false);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Import failed.");
    }
  };

  const poolTitle =
    selectedCategoryId === "all" ? "All cards" : selectedCategory?.name ?? "Category";

  return (
    <>
      <div className="cards-layout">
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
              <span className="accounts-category-count">{cards.length}</span>
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
          <section className="card cards-pool-card">
            <div className="card-header card-header-tight">
              <div>
                <h2>Credit card pool</h2>
                <p className="muted">{poolTitle}</p>
              </div>
            </div>

            <div className="cards-table-toolbar">
              <div className="button-row compact cards-toolbar-actions">
                <button type="button" className="btn-secondary btn-compact" onClick={openAddModal}>
                  Add card
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
                <button
                  type="button"
                  className="btn-secondary btn-compact"
                  aria-pressed={privacyOn}
                  onClick={() => setPrivacyOn((current) => !current)}
                >
                  {privacyOn ? "Privacy ON" : "Privacy OFF"}
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
              <input
                className="table-search cards-table-search"
                placeholder="Search cards"
                value={cardSearch}
                onChange={(event) => setCardSearch(event.target.value)}
              />
            </div>

            <div className="cards-table-wrap">
              <div className="table-scroll">
                <table
                  ref={cardTableColumns.tableRef}
                  className={`profiles-table cards-table ${cardTableColumns.tableClassName}`.trim()}
                >
                  <TableColGroup columns={cardTableColumns} />
                  <thead>
                    <tr>
                      <ResizableTh columns={cardTableColumns} id="check" className="col-check">
                        <RowCheckbox
                          checked={allSelected}
                          aria-label="Select all cards"
                          onClick={() => {
                            setSelectedIds(allSelected ? [] : [...orderedIds]);
                            anchorIndexRef.current = null;
                          }}
                        />
                      </ResizableTh>
                      <ResizableTh columns={cardTableColumns} id="index" className="col-index">
                        #
                      </ResizableTh>
                      <ResizableTh columns={cardTableColumns} id="brand" className="col-brand">
                        Brand
                      </ResizableTh>
                      <ResizableTh columns={cardTableColumns} id="name">
                        Card name
                      </ResizableTh>
                      <ResizableTh columns={cardTableColumns} id="category" className="col-category">
                        Category
                      </ResizableTh>
                      <ResizableTh columns={cardTableColumns} id="number">
                        Number
                      </ResizableTh>
                      <ResizableTh columns={cardTableColumns} id="cvv">
                        CVV
                      </ResizableTh>
                      <ResizableTh columns={cardTableColumns} id="exp">
                        Exp
                      </ResizableTh>
                      <ResizableTh columns={cardTableColumns} id="status">
                        Status
                      </ResizableTh>
                      <ResizableTh columns={cardTableColumns} id="profiles">
                        Associated profile(s)
                      </ResizableTh>
                      <ResizableTh columns={cardTableColumns} id="notes">
                        Notes
                      </ResizableTh>
                    </tr>
                  </thead>
                  <tbody>
                    {searchFilteredCards.length === 0 ? (
                      <tr>
                        <td colSpan={CARD_TABLE_COLUMNS.length} className="table-empty">
                          {cardSearch.trim()
                            ? "No cards match your search."
                            : selectedCategory && canDeleteSelectedCategory
                              ? "No cards in this category. You can delete it using the toolbar."
                              : selectedCategoryId === "all"
                                ? "No cards yet. Use Add card or Import."
                                : "No cards in this category."}
                        </td>
                      </tr>
                    ) : (
                      searchFilteredCards.map((card, index) => {
                        const selected = selectedIds.includes(card.id);
                        const profileLabel = profileLabelForCard?.(card.id) ?? "—";
                        return (
                          <tr
                            key={card.id}
                            className={selected ? "row-selected" : undefined}
                            onClick={(event) => handleRowClick(event, card.id, index)}
                          >
                            <td className="col-check">
                              <RowCheckbox
                                checked={selected}
                                aria-label={`Select card ${card.profileName}`}
                                onClick={(event) => applySelection(event, card.id, index)}
                              />
                            </td>
                            <td className="col-index">{index + 1}</td>
                            <td className="col-brand">
                              <CardBrandIcon brand={card.brand} size="sm" />
                            </td>
                            <td className="col-profile-name" title={card.profileName}>
                              {card.profileName || "—"}
                            </td>
                            <td
                              className="col-category"
                              title={categoryNameById.get(cardCategoryId(card)) ?? "Uncategorized"}
                            >
                              {categoryNameById.get(cardCategoryId(card)) ?? "Uncategorized"}
                            </td>
                            <td
                              className="col-number card-pool-number"
                              title={privacyOn ? undefined : card.number}
                            >
                              {privacyOn
                                ? maskCardNumberDisplay(card.number, card.brand) || "—"
                                : formatCardNumberDisplay(card.number, card.brand) || "—"}
                            </td>
                            <td className="col-cvv" title={privacyOn ? undefined : card.cvv}>
                              {privacyOn ? (card.cvv ? "•••" : "—") : card.cvv || "—"}
                            </td>
                            <td className="col-expiry">{normalizeCardExpiryString(card.expiry) || "—"}</td>
                            <td className="col-status">
                              <AccountStatusDisplay status={card.accountStatus} />
                            </td>
                            <td className="col-profiles" title={profileLabel}>
                              {profileLabel}
                            </td>
                            <td className="col-notes" title={card.notes}>
                              {card.notes || "—"}
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

      <CardFormModal
        open={showCardModal}
        title={
          isMassEditing
            ? `Edit ${editTargetIds.length} cards`
            : isEditing
              ? "Edit card"
              : cardModalSection === "import"
                ? "Import cards"
                : "Add card"
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
        importFormat={importFormat}
        importText={importText}
        importCsvText={importCsvText}
        importCsvFileName={importCsvFileName}
        importCsvHeaders={importCsvHeaders}
        importColumnMapping={importColumnMapping}
        canDeleteDraftCategory={canDeleteDraftCategory && !isMassEditing}
        status={status}
        onClose={closeCardModal}
        onDraftChange={setDraft}
        onDraftCategorySelectionChange={setDraftCategorySelection}
        onImportCategorySelectionChange={setImportCategorySelection}
        onImportFormatChange={setImportFormat}
        onImportTextChange={setImportText}
        onImportCsvTextChange={handleImportCsvTextChange}
        onCsvFileUpload={(file) => void handleCsvFileUpload(file)}
        onClearCsvImport={clearCsvImport}
        onImportColumnMappingChange={setImportColumnMapping}
        onFieldTouch={touchField}
        onSave={() => void save()}
        onImport={() => void parseImport()}
        onStartNew={startNew}
        onDeleteDraftCategory={() =>
          void deleteCategoryById(
            draftCategorySelection.kind === "existing" ? draftCategorySelection.categoryId : "",
          )
        }
        initialSection={cardModalSection}
      />

      <CreateCategoryModal
        open={showCreateCategory}
        onClose={() => setShowCreateCategory(false)}
        onSave={handleCreateCategory}
      />

      <MoveCardsModal
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
    categoryId: categoryId ?? CARD_UNCATEGORIZED_CATEGORY_ID,
  };
}
