import { useCallback, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";

const MIN_COLUMN_WIDTH = 28;
const STORAGE_PREFIX = "profile-generator:table-cols:";
const EMPTY_FLEX_IDS: readonly string[] = [];

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

function availableTableWidth(table: HTMLTableElement): number {
  const parent = table.parentElement;
  if (!parent) return 0;
  const style = getComputedStyle(parent);
  const padding = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
  return Math.max(0, Math.floor(parent.clientWidth - padding));
}

function applyBaseWidths(
  columnIds: readonly string[],
  measured: number[],
  manuals: Record<string, number>,
  maxWidths: Partial<Record<string, number>> | undefined,
): number[] {
  return columnIds.map((id, index) => {
    const manual = manuals[id];
    if (typeof manual === "number") return Math.max(MIN_COLUMN_WIDTH, Math.round(manual));
    const measuredWidth = measured[index] ?? MIN_COLUMN_WIDTH;
    const maxWidth = maxWidths?.[id];
    if (typeof maxWidth === "number") {
      return Math.max(MIN_COLUMN_WIDTH, Math.min(Math.round(measuredWidth), maxWidth));
    }
    return Math.max(MIN_COLUMN_WIDTH, measuredWidth);
  });
}

function distributeExtraWidth(
  widths: number[],
  columnIds: readonly string[],
  flexIds: readonly string[],
  manuals: Record<string, number>,
  available: number,
): number[] {
  if (available <= 0 || flexIds.length === 0) return widths;
  const sum = widths.reduce((total, width) => total + width, 0);
  const extra = available - sum;
  if (extra <= 0) return widths;
  const flexIndexes = flexIds
    .map((id) => columnIds.indexOf(id))
    .filter((index) => index >= 0);
  const autoFlex = flexIndexes.filter((index) => manuals[columnIds[index]] == null);
  const dest = (autoFlex.length > 0 ? autoFlex : [])[0];
  if (dest == null) return widths;
  const next = [...widths];
  next[dest] += extra;
  return next;
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
  flexIds?: readonly string[];
  maxWidths?: Partial<Record<string, number>>;
  storageKey: string;
  fitKey: string;
}): ResizableTableColumns {
  const { columnIds, storageKey, fitKey } = options;
  const flexIds = options.flexIds ?? EMPTY_FLEX_IDS;
  const maxWidths = options.maxWidths;
  const tableRef = useRef<HTMLTableElement>(null);
  const manualRef = useRef<Record<string, number>>({});
  const baseRef = useRef<number[] | null>(null);
  const [widths, setWidths] = useState<number[] | null>(null);
  const lockedIds = useMemo(() => new Set(options.lockedIds ?? []), [options.lockedIds]);
  const flexKey = flexIds.join("\0");
  const maxKey = maxWidths
    ? Object.entries(maxWidths)
        .map(([id, width]) => `${id}:${width}`)
        .join("\0")
    : "";

  useLayoutEffect(() => {
    manualRef.current = readManualWidths(storageKey);
  }, [storageKey]);

  useLayoutEffect(() => {
    const table = tableRef.current;
    if (!table) return;

    const measureBase = () => {
      table.classList.add("is-measuring");
      for (const col of Array.from(table.querySelectorAll("col"))) {
        col.style.width = "";
      }
      const measured = measureColumnWidths(table, columnIds.length);
      table.classList.remove("is-measuring");
      const base = applyBaseWidths(columnIds, measured, manualRef.current, maxWidths);
      baseRef.current = base;
      setWidths(distributeExtraWidth(base, columnIds, flexIds, manualRef.current, availableTableWidth(table)));
    };

    measureBase();
    const parent = table.parentElement;
    if (!parent || flexIds.length === 0) return undefined;
    const observer = new ResizeObserver(() => {
      const base = baseRef.current;
      if (!base) return;
      setWidths(distributeExtraWidth(base, columnIds, flexIds, manualRef.current, availableTableWidth(table)));
    });
    observer.observe(parent);
    return () => observer.disconnect();
  }, [columnIds, fitKey, flexKey, maxKey]);

  const resizeColumn = useCallback(
    (id: string, width: number) => {
      const index = columnIds.indexOf(id);
      if (index < 0 || lockedIds.has(id)) return;
      const nextWidth = Math.max(MIN_COLUMN_WIDTH, Math.round(width));
      manualRef.current[id] = nextWidth;
      const table = tableRef.current;
      setWidths((current) => {
        const next = current ? [...current] : columnIds.map(() => MIN_COLUMN_WIDTH);
        next[index] = nextWidth;
        const base = baseRef.current ? [...baseRef.current] : next;
        base[index] = nextWidth;
        baseRef.current = base;
        if (!table) return next;
        return distributeExtraWidth(base, columnIds, flexIds, manualRef.current, availableTableWidth(table));
      });
    },
    [columnIds, lockedIds, flexIds],
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
