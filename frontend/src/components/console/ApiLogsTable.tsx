import type { ApiCallStatusClass, ApiLogRow, RouteFamily } from '@/types/admin';
import { useLogTable } from '@/hooks/useLogTable';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export interface ApiLogsTableProps {
  readonly rows: readonly ApiLogRow[];
  readonly standalone?: boolean;
  readonly emptyMessage?: string;
}

const routeFamilies: Array<RouteFamily | 'all'> = ['all', 'gemini', 'openai'];
const statuses: Array<ApiCallStatusClass | 'all'> = ['all', '1xx', '2xx', '3xx', '4xx', '5xx', 'other'];
const methods = ['all', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
const sortableColumns = ['time', 'routeFamily', 'model', 'latencyMs', 'status'] as const;

export function ApiLogsTable({
  rows,
  standalone = true,
  emptyMessage = 'Chưa có API call nào được ghi.',
}: ApiLogsTableProps) {
  const { filters, setFilters, sort, setSort, visibleRows } = useLogTable(rows);
  const showUpstreamTarget = rows.some((row) => {
    const value = row.upstreamTarget?.trim();
    return Boolean(value) && value !== '—';
  });
  const emptyColSpan = showUpstreamTarget ? 8 : 7;

  const nextDirection = sort.direction === 'asc' ? 'desc' : 'asc';
  const content = (
    <>
      <div className="grid gap-3 border-b border-border p-4 md:grid-cols-5">
        <Select
          value={String(filters.routeFamily)}
          onValueChange={(value) => setFilters((current) => ({ ...current, routeFamily: value }))}
        >
          <SelectTrigger aria-label="Lọc route family"><SelectValue /></SelectTrigger>
          <SelectContent>{routeFamilies.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent>
        </Select>
        <Select
          value={filters.status}
          onValueChange={(value) => setFilters((current) => ({ ...current, status: value as ApiCallStatusClass | 'all' }))}
        >
          <SelectTrigger aria-label="Lọc status"><SelectValue /></SelectTrigger>
          <SelectContent>{statuses.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent>
        </Select>
        <Select
          value={filters.method ?? 'all'}
          onValueChange={(value) => setFilters((current) => ({ ...current, method: value }))}
        >
          <SelectTrigger aria-label="Lọc method"><SelectValue /></SelectTrigger>
          <SelectContent>{methods.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent>
        </Select>
        <Input
          aria-label="Lọc model"
          value={filters.model}
          onChange={(event) => setFilters((current) => ({ ...current, model: event.target.value }))}
          placeholder="gemini"
        />
        <Input
          aria-label="Search logs"
          value={filters.search ?? ''}
          onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))}
          placeholder="request id, path, key"
        />
      </div>
      <Table id="api-log-table">
        <TableHeader>
          <TableRow>
            {sortableColumns.map((key) => (
              <TableHead
                key={key}
                aria-sort={sort.key === key ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
              >
                <Button
                  variant="ghost"
                  size="sm"
                  className="px-0 text-muted-foreground hover:text-foreground"
                  onClick={() => setSort({ key, direction: sort.key === key ? nextDirection : 'asc' })}
                >
                  {key} {sort.key === key ? (sort.direction === 'asc' ? '↑' : '↓') : ''}
                </Button>
              </TableHead>
            ))}
            <TableHead>operation</TableHead>
            <TableHead>gateway key</TableHead>
            {showUpstreamTarget ? <TableHead>target</TableHead> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {visibleRows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={emptyColSpan} className="py-8 text-center text-sm text-muted-foreground">
                {emptyMessage}
              </TableCell>
            </TableRow>
          ) : visibleRows.map((row) => (
            <TableRow key={row.id}>
              <TableCell className="font-mono tabular-nums">{row.time}</TableCell>
              <TableCell>{row.routeFamily}</TableCell>
              <TableCell className="font-mono tabular-nums">{row.model}</TableCell>
              <TableCell className="font-mono tabular-nums">{row.latencyMs}ms</TableCell>
              <TableCell className="font-mono tabular-nums"><Badge variant={row.status === '2xx' ? 'default' : 'destructive'}>{row.status}</Badge></TableCell>
              <TableCell>{row.operation}</TableCell>
              <TableCell className="font-mono tabular-nums">{row.gatewayKey}</TableCell>
              {showUpstreamTarget ? (
                <TableCell className="font-mono tabular-nums">{row.upstreamTarget}</TableCell>
              ) : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </>
  );

  if (!standalone) return <div className="overflow-hidden">{content}</div>;

  return <section className="operator-panel overflow-hidden">{content}</section>;
}
