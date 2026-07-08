import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useSortableTable } from '@/hooks/useSortableTable';
import type { GatewayKeyRow } from '@/types/admin';

export interface GatewayKeysTableProps {
  readonly rows: readonly GatewayKeyRow[];
  readonly onRevoke?: (id: string) => Promise<void>;
  readonly onDelete?: (id: string) => Promise<void>;
  readonly mutable?: boolean;
}

const columns: Array<{ key: keyof GatewayKeyRow; label: string }> = [
  { key: 'label', label: 'Label' },
  { key: 'preview', label: 'Preview' },
  { key: 'status', label: 'Status' },
  { key: 'createdAt', label: 'Created At' },
];

const getStatusColor = (status: string) => {
  if (status === 'active') return 'border border-[var(--healthy-green)]/30 bg-[var(--healthy-green)]/15 text-[var(--healthy-green)]';
  if (status === 'revoked') return 'border border-[var(--failure-red)]/30 bg-[var(--failure-red)]/15 text-[var(--failure-red)]';
  return 'border border-border bg-secondary text-secondary-foreground';
};

const copyPreview = async (preview: string): Promise<void> => {
  if (!navigator.clipboard) throw new Error('Clipboard unavailable');
  await navigator.clipboard.writeText(preview);
};

export function GatewayKeysTable({ rows, onRevoke, onDelete, mutable }: GatewayKeysTableProps) {
  const { sortKey, direction, handleSort, ariaSort, sortedRows } = useSortableTable(rows, 'createdAt', 'desc');
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copyFailedId, setCopyFailedId] = useState<string | null>(null);
  const showActions = Boolean(onRevoke || onDelete || rows.length > 0);

  async function handleRevoke(id: string) {
    setRevokingId(id);
    try {
      await onRevoke?.(id);
    } finally {
      setRevokingId(null);
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      await onDelete?.(id);
    } finally {
      setDeletingId(null);
    }
  }

  async function handleCopy(key: GatewayKeyRow) {
    try {
      await copyPreview(key.preview);
      setCopyFailedId(null);
      setCopiedId(key.id);
      window.setTimeout(() => setCopiedId((current) => (current === key.id ? null : current)), 1600);
    } catch {
      setCopiedId(null);
      setCopyFailedId(key.id);
      window.setTimeout(() => setCopyFailedId((current) => (current === key.id ? null : current)), 2000);
    }
  }

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
            sortedRows.map((key) => (
              <TableRow key={key.id}>
                <TableCell className="font-medium">{key.label}</TableCell>
                <TableCell className="font-mono text-sm text-[var(--operator-teal)]">{key.preview}</TableCell>
                <TableCell>
                  <Badge className={getStatusColor(key.status)}>{key.status}</Badge>
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">{key.createdAt}</TableCell>
                {showActions && (
                  <TableCell>
                    <div className="flex flex-wrap justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => { void handleCopy(key); }}>
                        {copyFailedId === key.id ? 'Copy failed' : copiedId === key.id ? 'Copied' : 'Copy'}
                      </Button>
                      {mutable && onRevoke && key.status === 'active' && (
                        <Button variant="ghost" size="sm" className="text-destructive" disabled={revokingId === key.id || deletingId === key.id} onClick={() => handleRevoke(key.id)}>
                          {revokingId === key.id ? 'Đang revoke…' : 'Revoke'}
                        </Button>
                      )}
                      {mutable && onDelete && (
                        <Button variant="ghost" size="sm" className="text-destructive" disabled={deletingId === key.id || revokingId === key.id} onClick={() => handleDelete(key.id)}>
                          {deletingId === key.id ? 'Đang xóa…' : 'Delete'}
                        </Button>
                      )}
                    </div>
                  </TableCell>
                )}
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell colSpan={showActions ? 5 : 4} className="h-24 text-center">
                No keys found.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
