import { useCallback, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";

const MIN_COLUMN_WIDTH = 28;
const STORAGE_PREFIX = "profile-generator:table-cols:";

function readManualWidths(storageKey: string): Record<string, number> {
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${storageKey}`);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, number] => typeof entry[1] === "number" && entry[1] > 0),
    );
  } catch {
    return {};
  }
}

function writeManualWidths(storageKey: string, widths: Record<string, number>): void {
  localStorage.setItem(`${STORAGE_PREFIX}${storageKey}`, JSON.stringify(widths));
}

function measureColumnWidths(table: HTMLTableElement, columnCount: number): number[] {
  const widths = Array.from({ length: columnCount }, () => 0);
  for (const row of Array.from(table.rows)) {
    for (let index = 0; index < columnCount && index < row.cells.length; index += 1) {
      const cell = row.cells[index];
      if (cell.colSpan > 1) continue;
      widths[index] = Math.max(widths[index], Math.ceil(cell.scrollWidth) + 1);
    }
  }
  return widths.map((width) => Math.max(MIN_COLUMN_WIDTH, width));
}

export interface ResizableTableColumns {
  tableRef: RefObject<HTMLTableElement | null>;
  columnIds: readonly string[];
  widths: number[] | null;
  lockedIds: ReadonlySet<string>;
  tableClassName: string;
  resizeColumn: (id: string, width: number) => void;
  persist: () => void;
}

export function useResizableTableColumns(options: {
  columnIds: readonly string[];
  lockedIds?: readonly string[];
  storageKey: string;
  fitKey: string;
}): ResizableTableColumns {
  const { columnIds, storageKey, fitKey } = options;
  const tableRef = useRef<HTMLTableElement>(null);
  const manualRef = useRef<Record<string, number>>({});
  const [widths, setWidths] = useState<number[] | null>(null);
  const lockedIds = useMemo(() => new Set(options.lockedIds ?? []), [options.lockedIds]);

  useLayoutEffect(() => {
    manualRef.current = readManualWidths(storageKey);
  }, [storageKey]);

  useLayoutEffect(() => {
    const table = tableRef.current;
    if (!table) return;

    table.classList.add("is-measuring");
    for (const col of Array.from(table.querySelectorAll("col"))) {
      col.style.width = "";
    }
    const measured = measureColumnWidths(table, columnIds.length);
    table.classList.remove("is-measuring");

    setWidths(
      columnIds.map((id, index) => {
        const manual = manualRef.current[id];
        if (typeof manual === "number") return Math.max(MIN_COLUMN_WIDTH, Math.round(manual));
        return measured[index] ?? MIN_COLUMN_WIDTH;
      }),
    );
  }, [columnIds, fitKey]);

  const resizeColumn = useCallback(
    (id: string, width: number) => {
      const index = columnIds.indexOf(id);
      if (index < 0 || lockedIds.has(id)) return;
      const nextWidth = Math.max(MIN_COLUMN_WIDTH, Math.round(width));
      manualRef.current[id] = nextWidth;
      setWidths((current) => {
        const next = current ? [...current] : columnIds.map(() => MIN_COLUMN_WIDTH);
        next[index] = nextWidth;
        return next;
      });
    },
    [columnIds, lockedIds],
  );

  const persist = useCallback(() => {
    writeManualWidths(storageKey, manualRef.current);
  }, [storageKey]);

  return {
    tableRef,
    columnIds,
    widths,
    lockedIds,
    tableClassName: widths ? "is-sized" : "",
    resizeColumn,
    persist,
  };
}
