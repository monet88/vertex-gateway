import type { ApiCallStatusClass, ApiLogRow, RouteFamily } from '@/types/admin';

export type LogStatus = ApiCallStatusClass;
export type LogSortKey = 'time' | 'latencyMs' | 'status' | 'routeFamily' | 'model';
export type SortDirection = 'asc' | 'desc';
export type StatusBadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline';

/** Map API status class to badge tone: only 4xx/5xx are failures. */
export function statusBadgeVariant(status: ApiCallStatusClass): StatusBadgeVariant {
  if (status === '2xx') return 'default';
  if (status === '4xx' || status === '5xx') return 'destructive';
  return 'secondary';
}

export interface LogTableFilters {
  readonly routeFamily: RouteFamily | 'all' | string;
  readonly status: LogStatus | 'all';
  readonly model: string;
  readonly method?: string | 'all';
  readonly search?: string;
}

export interface LogTableSort {
  readonly key: LogSortKey;
  readonly direction: SortDirection;
}

const compareText = (left: string, right: string): number => left.localeCompare(right);

export function filterLogs(rows: readonly ApiLogRow[], filters: LogTableFilters): ApiLogRow[] {
  const model = filters.model.trim().toLowerCase();
  const search = (filters.search ?? '').trim().toLowerCase();
  return rows.filter((row) => {
    const routeMatches = filters.routeFamily === 'all' || row.routeFamily === filters.routeFamily;
    const statusMatches = filters.status === 'all' || row.status === filters.status;
    const modelMatches = model.length === 0 || (row.model?.toLowerCase().includes(model) ?? false);
    const methodMatches = !filters.method || filters.method === 'all' || (row.method ?? '').toUpperCase() === filters.method.toUpperCase();
    const haystack = [
      row.model,
      row.gatewayKey,
      row.upstreamTarget,
      row.operation,
      row.path ?? '',
      row.requestId ?? '',
      row.method ?? '',
    ].join(' ').toLowerCase();
    const searchMatches = search.length === 0 || haystack.includes(search);
    return routeMatches && statusMatches && modelMatches && methodMatches && searchMatches;
  });
}

export function sortLogs(rows: readonly ApiLogRow[], sort: LogTableSort): ApiLogRow[] {
  const multiplier = sort.direction === 'asc' ? 1 : -1;
  return [...rows].sort((left, right) => {
    if (sort.key === 'latencyMs') return (left.latencyMs - right.latencyMs) * multiplier;
    if (sort.key === 'time') {
      return compareText(left.timestamp || left.time, right.timestamp || right.time) * multiplier;
    }
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
