import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useSortableTable } from '@/hooks/useSortableTable';
import type { VertexTargetRow } from '@/types/admin';
import type { VertexTargetPatchPayload } from '@/lib/admin-dashboard-api';
import { VertexTargetDialog, type VertexTargetDraft } from './VertexTargetDialog';

export interface VertexTargetsTableProps {
  readonly rows: readonly VertexTargetRow[];
  readonly onTest?: (id: string) => Promise<void>;
  readonly onDelete?: (id: string) => Promise<void>;
  readonly onUpdate?: (id: string, patch: VertexTargetPatchPayload) => Promise<void>;
  readonly pendingIds?: ReadonlySet<string>;
  readonly testResults?: ReadonlyMap<string, VertexTargetTestResult>;
}

export interface VertexTargetTestResult {
  readonly status: 'success' | 'error';
  readonly message: string;
  readonly testedAt: string;
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
  if (health === 'ready') return 'border border-[var(--healthy-green)]/30 bg-[var(--healthy-green)]/15 text-[var(--healthy-green)] hover:bg-[var(--healthy-green)]/15';
  if (health === 'degraded') return 'border border-[var(--warning-amber)]/30 bg-[var(--warning-amber)]/15 text-[var(--warning-amber)] hover:bg-[var(--warning-amber)]/15';
  if (health === 'failed') return 'border border-[var(--failure-red)]/30 bg-[var(--failure-red)]/15 text-[var(--failure-red)] hover:bg-[var(--failure-red)]/15';
  if (health === 'disabled') return 'border border-border bg-secondary text-secondary-foreground hover:bg-secondary';
  return 'border border-border bg-muted text-muted-foreground hover:bg-muted';
};

const hasActions = (props: VertexTargetsTableProps) => Boolean(props.onTest || props.onDelete || props.onUpdate);

const toEditDraft = (target: VertexTargetRow): VertexTargetDraft => ({
  label: target.label,
  project: target.project,
  location: target.location,
  apiKey: '',
  apiKeyMode: target.apiKeyMode,
});

const toPatchPayload = (draft: VertexTargetDraft): VertexTargetPatchPayload => ({
  label: draft.label,
  project: draft.project,
  location: draft.location,
  apiKeyMode: draft.apiKeyMode,
  ...(draft.apiKey.trim() ? { apiKey: draft.apiKey.trim() } : {}),
});

export function VertexTargetsTable(props: VertexTargetsTableProps) {
  const { rows, onTest, onDelete, onUpdate, pendingIds, testResults } = props;
  const { sortKey, direction, handleSort, ariaSort, sortedRows } = useSortableTable(rows, 'label', 'asc');
  const showActions = hasActions(props);

  return (
    <div className="operator-panel-compact overflow-hidden">
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
            sortedRows.map((target) => {
              const isPending = pendingIds?.has(target.id) ?? false;
              const testResult = testResults?.get(target.id);

              return (
                <TableRow key={target.id}>
                  <TableCell className="font-medium">{target.label}</TableCell>
                  <TableCell className="font-mono text-sm text-[var(--operator-teal)]">{target.project}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{target.location}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{target.authType}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{target.apiKeyMode}</TableCell>
                  <TableCell>
                    <Badge className={getHealthColor(target.health)}>{target.health}</Badge>
                    {isPending && (
                      <div className="mt-1 text-xs text-muted-foreground" role="status" aria-live="polite">
                        Testing upstream...
                      </div>
                    )}
                    {testResult && !isPending && (
                      <div
                        className={testResult.status === 'success' ? 'mt-1 text-xs text-emerald-700' : 'mt-1 text-xs text-destructive'}
                        role="status"
                        aria-live="polite"
                      >
                        {testResult.message} · {testResult.testedAt}
                      </div>
                    )}
                  </TableCell>
                  {showActions && (
                    <TableCell>
                      <div className="flex flex-wrap justify-end gap-1">
                        {onTest && (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={isPending}
                            onClick={() => onTest(target.id)}
                          >
                            {isPending ? 'Testing...' : 'Test'}
                          </Button>
                        )}
                        {onUpdate && (
                          <>
                            {target.hasApiKey && (
                              <VertexTargetDialog
                                mode="edit"
                                triggerLabel="Edit"
                                initialDraft={toEditDraft(target)}
                                disabled={isPending}
                                onCreate={(draft) => onUpdate(target.id, toPatchPayload(draft))}
                              />
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={isPending}
                              onClick={() => onUpdate(target.id, { enabled: !target.enabled })}
                            >
                              {target.enabled ? 'Disable' : 'Enable'}
                            </Button>
                          </>
                        )}
                        {onDelete && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive"
                            disabled={isPending}
                            onClick={() => onDelete(target.id)}
                          >
                            Delete
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              );
            })
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
