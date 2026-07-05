import { useMemo, useState } from 'react';

export type SortDirection = 'asc' | 'desc';

export type AriaSort = 'ascending' | 'descending' | 'none';

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
      const valA = String(a[sortKey] ?? '');
      const valB = String(b[sortKey] ?? '');
      return direction === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
    });
  }, [rows, sortKey, direction]);

  return { sortKey, direction, handleSort, ariaSort, sortedRows };
}
