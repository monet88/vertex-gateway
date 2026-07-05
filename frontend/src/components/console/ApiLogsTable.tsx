import type { ApiLogRow, LogStatus, RouteFamily } from '../../data/mockData';
import { useLogTable } from '../../hooks/useLogTable';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';

export interface ApiLogsTableProps {
  readonly rows: readonly ApiLogRow[];
}

const routeFamilies: Array<RouteFamily | 'all'> = ['all', 'gemini', 'openai', 'vertex', 'vtx', 'custom'];
const statuses: Array<LogStatus | 'all'> = ['all', '2xx', '4xx', '5xx'];

export function ApiLogsTable({ rows }: ApiLogsTableProps) {
  const { filters, setFilters, sort, setSort, visibleRows } = useLogTable(rows);

  const nextDirection = sort.direction === 'asc' ? 'desc' : 'asc';

  return (
    <section className="rounded-xl border border-border bg-card shadow-2xl shadow-black/10">
      <div className="flex flex-col gap-4 border-b border-border p-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">API call logs</h2>
          <p className="mt-1 text-sm text-muted-foreground">Bảng log đã mask key, lọc theo route family, status và model.</p>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
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
        </div>
      </div>
      <div className="overflow-x-auto">
        <Table id="api-log-table">
          <TableHeader>
            <TableRow>
              {(['time', 'routeFamily', 'model', 'latencyMs', 'status'] as const).map((key) => (
                <TableHead key={key}>
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
                <TableCell className="tabular-data">{row.time}</TableCell>
                <TableCell>{row.routeFamily}</TableCell>
                <TableCell className="tabular-data">{row.model}</TableCell>
                <TableCell className="tabular-data">{row.latencyMs}ms</TableCell>
                <TableCell><Badge variant={row.status === '2xx' ? 'default' : 'destructive'}>{row.status}</Badge></TableCell>
                <TableCell>{row.operation}</TableCell>
                <TableCell className="tabular-data">{row.gatewayKey}</TableCell>
                <TableCell>{row.upstreamTarget}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
