import { useMemo, useState } from 'react';

export type SortDirection = 'asc' | 'desc';

export type AriaSort = 'ascending' | 'descending' | 'none';

/**
 * Compares two cell values in their natural order:
 * - numbers are compared numerically (so 2 < 10),
 * - Date values are compared chronologically,
 * - booleans are compared with false < true,
 * - everything else falls back to locale-aware string comparison.
 * Null/undefined always sort to the end.
 */
function compareValues(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;

  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b);

  return String(a).localeCompare(String(b));
}

export function useSortableTable<T>(
  rows: readonly T[],
  initialKey: keyof T,
  initialDirection: SortDirection = 'asc',
) {
  const [sortKey, setSortKey] = useState<keyof T>(initialKey);
  const [direction, setDirection] = useState<SortDirection>(initialDirection);

  function handleSort(key: keyof T) {
    if (sortKey === key) {
      setDirection((current) => (current === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setDirection('asc');
    }
  }

  function ariaSort(key: keyof T): AriaSort {
    if (sortKey !== key) return 'none';
    return direction === 'asc' ? 'ascending' : 'descending';
  }

  const sortedRows = useMemo(() => {
    return [...rows].sort((a, b) => {
      const result = compareValues(a[sortKey], b[sortKey]);
      return direction === 'asc' ? result : -result;
    });
  }, [rows, sortKey, direction]);

  return { sortKey, direction, handleSort, ariaSort, sortedRows };
}
