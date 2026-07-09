import { useMemo, useState } from 'react';
import type { ApiLogRow } from '@/types/admin';
import { getVisibleLogs, type LogTableFilters, type LogTableSort } from '@/lib/table';

const initialFilters: LogTableFilters = {
  routeFamily: 'all',
  status: 'all',
  model: '',
  method: 'all',
  search: '',
};

const initialSort: LogTableSort = {
  key: 'time',
  direction: 'desc',
};

export function useLogTable(rows: readonly ApiLogRow[]) {
  const [filters, setFilters] = useState<LogTableFilters>(initialFilters);
  const [sort, setSort] = useState<LogTableSort>(initialSort);
  const visibleRows = useMemo(() => getVisibleLogs(rows, filters, sort), [filters, rows, sort]);

  return {
    filters,
    setFilters,
    sort,
    setSort,
    visibleRows,
  };
}
