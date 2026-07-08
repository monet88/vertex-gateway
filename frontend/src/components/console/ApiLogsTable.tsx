import type { ApiLogRow, LogStatus, RouteFamily } from '@/data/mockData';
import { useLogTable } from '@/hooks/useLogTable';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export interface ApiLogsTableProps {
  readonly rows: readonly ApiLogRow[];
}

const routeFamilies: Array<RouteFamily | 'all'> = ['all', 'gemini', 'openai'];
const statuses: Array<LogStatus | 'all'> = ['all', '2xx', '4xx', '5xx'];
const sortableColumns = ['time', 'routeFamily', 'model', 'latencyMs', 'status'] as const;

export function ApiLogsTable({ rows }: ApiLogsTableProps) {
  const { filters, setFilters, sort, setSort, visibleRows } = useLogTable(rows);

  const nextDirection = sort.direction === 'asc' ? 'desc' : 'asc';

  return (
    <section className="operator-panel overflow-hidden">
      <div className="grid gap-3 border-b border-border p-4 md:grid-cols-5">
        <Select
          value={filters.routeFamily}
          onValueChange={(value) => setFilters((current) => ({ ...current, routeFamily: value as RouteFamily | 'all' }))}
        >
          <SelectTrigger aria-label="Lọc route family"><SelectValue /></SelectTrigger>
          <SelectContent>{routeFamilies.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent>
        </Select>
        <Select
          value={filters.status}
          onValueChange={(value) => setFilters((current) => ({ ...current, status: value as LogStatus | 'all' }))}
        >
          <SelectTrigger aria-label="Lọc status"><SelectValue /></SelectTrigger>
          <SelectContent>{statuses.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent>
        </Select>
        <Input
          aria-label="Lọc model"
          value={filters.model}
          onChange={(event) => setFilters((current) => ({ ...current, model: event.target.value }))}
          placeholder="gemini"
        />
        <Input aria-label="Khoảng thời gian" value="1 giờ qua" disabled />
        <Input aria-label="Search logs" value="" placeholder="request id, key alias" disabled />
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
            <TableHead>target</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {visibleRows.map((row) => (
            <TableRow key={row.id}>
              <TableCell className="font-mono tabular-nums">{row.time}</TableCell>
              <TableCell>{row.routeFamily}</TableCell>
              <TableCell className="font-mono tabular-nums">{row.model}</TableCell>
              <TableCell className="font-mono tabular-nums">{row.latencyMs}ms</TableCell>
              <TableCell className="font-mono tabular-nums"><Badge variant={row.status === '2xx' ? 'default' : 'destructive'}>{row.status}</Badge></TableCell>
              <TableCell>{row.operation}</TableCell>
              <TableCell className="font-mono tabular-nums">{row.gatewayKey}</TableCell>
              <TableCell className="font-mono tabular-nums">{row.upstreamTarget}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  );
}
