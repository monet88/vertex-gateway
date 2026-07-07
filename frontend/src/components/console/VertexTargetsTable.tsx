import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useSortableTable } from '@/hooks/useSortableTable';
import type { VertexTargetRow } from '@/types/admin';
import type { VertexTargetPatchPayload } from '@/lib/admin-dashboard-api';

export interface VertexTargetsTableProps {
  readonly rows: readonly VertexTargetRow[];
  readonly onTest?: (id: string) => Promise<void>;
  readonly onDelete?: (id: string) => Promise<void>;
  readonly onUpdate?: (id: string, patch: VertexTargetPatchPayload) => Promise<void>;
}

const columns: Array<{ key: keyof VertexTargetRow; label: string }> = [
  { key: 'label', label: 'Label' },
  { key: 'project', label: 'Project' },
  { key: 'location', label: 'Location' },
  { key: 'authType', label: 'Auth Type' },
  { key: 'apiKeyMode', label: 'Mode' },
  { key: 'health', label: 'Health' },
];

const getHealthColor = (health: string) => {
  if (health === 'ready') return 'bg-emerald-500 hover:bg-emerald-600';
  if (health === 'degraded') return 'bg-amber-500 hover:bg-amber-600 text-amber-950';
  if (health === 'failed') return 'bg-red-500 hover:bg-red-600';
  if (health === 'disabled') return 'bg-slate-500 hover:bg-slate-600';
  return 'bg-gray-500 hover:bg-gray-600';
};

const hasActions = (props: VertexTargetsTableProps) => Boolean(props.onTest || props.onDelete || props.onUpdate);

export function VertexTargetsTable(props: VertexTargetsTableProps) {
  const { rows, onTest, onDelete, onUpdate } = props;
  const { sortKey, direction, handleSort, ariaSort, sortedRows } = useSortableTable(rows, 'label', 'asc');
  const showActions = hasActions(props);

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((col) => (
              <TableHead key={col.key} aria-sort={ariaSort(col.key)}>
                <Button
                  variant="ghost"
                  size="sm"
                  className="px-0 text-muted-foreground hover:text-foreground"
                  onClick={() => handleSort(col.key)}
                >
                  {col.label} {sortKey === col.key ? (direction === 'asc' ? '↑' : '↓') : ''}
                </Button>
              </TableHead>
            ))}
            {showActions && <TableHead>Actions</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortedRows.length > 0 ? (
            sortedRows.map((target) => (
              <TableRow key={target.id}>
                <TableCell className="font-medium">{target.label}</TableCell>
                <TableCell>{target.project}</TableCell>
                <TableCell>{target.location}</TableCell>
                <TableCell>{target.authType}</TableCell>
                <TableCell>{target.apiKeyMode}</TableCell>
                <TableCell>
                  <Badge className={getHealthColor(target.health)}>{target.health}</Badge>
                </TableCell>
                {showActions && (
                  <TableCell>
                    <div className="flex gap-1">
                      {onTest && <Button variant="ghost" size="sm" onClick={() => onTest(target.id)}>Test</Button>}
                      {onUpdate && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onUpdate(target.id, { enabled: !target.enabled })}
                        >
                          {target.enabled ? 'Disable' : 'Enable'}
                        </Button>
                      )}
                      {onDelete && (
                        <Button variant="ghost" size="sm" className="text-destructive" onClick={() => onDelete(target.id)}>
                          Delete
                        </Button>
                      )}
                    </div>
                  </TableCell>
                )}
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell colSpan={showActions ? 7 : 6} className="h-24 text-center">
                No targets configured.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
