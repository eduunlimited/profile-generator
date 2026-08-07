export type ListSelectionModifiers = {
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
};

function rangeIds(orderedIds: string[], anchorIndex: number, index: number): string[] {
  const start = Math.min(anchorIndex, index);
  const end = Math.max(anchorIndex, index);
  return orderedIds.slice(start, end + 1);
}

/** Excel-like list selection: click, Shift+range, Ctrl/Cmd+toggle, Ctrl/Cmd+Shift+add range. */
export function applyExcelListSelection(
  current: string[],
  anchorIndex: number | null,
  index: number,
  id: string,
  orderedIds: string[],
  modifiers: ListSelectionModifiers,
): { selectedIds: string[]; anchorIndex: number | null } {
  const ctrl = modifiers.ctrlKey || modifiers.metaKey;

  if (modifiers.shiftKey && ctrl) {
    if (anchorIndex === null) {
      return { selectedIds: [id], anchorIndex: index };
    }
    const range = rangeIds(orderedIds, anchorIndex, index);
    return { selectedIds: [...new Set([...current, ...range])], anchorIndex };
  }

  if (modifiers.shiftKey) {
    if (anchorIndex === null) {
      return { selectedIds: [id], anchorIndex: index };
    }
    return { selectedIds: rangeIds(orderedIds, anchorIndex, index), anchorIndex };
  }

  if (ctrl) {
    const selectedIds = current.includes(id)
      ? current.filter((item) => item !== id)
      : [...current, id];
    return { selectedIds, anchorIndex };
  }

  if (current.includes(id)) {
    const selectedIds = current.filter((item) => item !== id);
    return { selectedIds, anchorIndex: selectedIds.length > 0 ? index : null };
  }

  return { selectedIds: [id], anchorIndex: index };
}
