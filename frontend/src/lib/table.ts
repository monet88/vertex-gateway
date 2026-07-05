import type { ApiLogRow, LogStatus, RouteFamily } from '../data/mockData';

export type LogSortKey = 'time' | 'latencyMs' | 'status' | 'routeFamily' | 'model';
export type SortDirection = 'asc' | 'desc';

export interface LogTableFilters {
  readonly routeFamily: RouteFamily | 'all';
  readonly status: LogStatus | 'all';
  readonly model: string;
}

export interface LogTableSort {
  readonly key: LogSortKey;
  readonly direction: SortDirection;
}

const compareText = (left: string, right: string): number => left.localeCompare(right);

export function filterLogs(rows: readonly ApiLogRow[], filters: LogTableFilters): ApiLogRow[] {
  const model = filters.model.trim().toLowerCase();
  return rows.filter((row) => {
    const routeMatches = filters.routeFamily === 'all' || row.routeFamily === filters.routeFamily;
    const statusMatches = filters.status === 'all' || row.status === filters.status;
    const modelMatches = model.length === 0 || row.model.toLowerCase().includes(model);
    return routeMatches && statusMatches && modelMatches;
  });
}

export function sortLogs(rows: readonly ApiLogRow[], sort: LogTableSort): ApiLogRow[] {
  const multiplier = sort.direction === 'asc' ? 1 : -1;
  return [...rows].sort((left, right) => {
    if (sort.key === 'latencyMs') return (left.latencyMs - right.latencyMs) * multiplier;
    return compareText(String(left[sort.key]), String(right[sort.key])) * multiplier;
  });
}

export function getVisibleLogs(
  rows: readonly ApiLogRow[],
  filters: LogTableFilters,
  sort: LogTableSort,
): ApiLogRow[] {
  return sortLogs(filterLogs(rows, filters), sort);
}
