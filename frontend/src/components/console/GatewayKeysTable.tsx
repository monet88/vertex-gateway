import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useSortableTable } from '@/hooks/useSortableTable';
import type { GatewayKeyRow } from '@/data/mockData';

export interface GatewayKeysTableProps {
  readonly rows: readonly GatewayKeyRow[];
  readonly onRevoke?: (id: string) => Promise<void>;
  readonly mutable?: boolean;
}

const columns: Array<{ key: keyof GatewayKeyRow; label: string }> = [
  { key: 'label', label: 'Label' },
  { key: 'preview', label: 'Preview' },
  { key: 'status', label: 'Status' },
  { key: 'createdAt', label: 'Created At' },
];

const getStatusColor = (status: string) => {
  if (status === 'active') return 'bg-emerald-500 hover:bg-emerald-600';
  if (status === 'revoked') return 'bg-red-500 hover:bg-red-600';
  return 'bg-gray-500 hover:bg-gray-600';
};

export function GatewayKeysTable({ rows, onRevoke, mutable }: GatewayKeysTableProps) {
  const { sortKey, direction, handleSort, ariaSort, sortedRows } = useSortableTable(rows, 'createdAt', 'desc');
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const showActions = mutable && onRevoke;

  async function handleRevoke(id: string) {
    setRevokingId(id);
    try {
      await onRevoke?.(id);
    } finally {
      setRevokingId(null);
    }
  }

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
            sortedRows.map((key) => (
              <TableRow key={key.id}>
                <TableCell className="font-medium">{key.label}</TableCell>
                <TableCell className="font-mono">{key.preview}</TableCell>
                <TableCell>
                  <Badge className={getStatusColor(key.status)}>{key.status}</Badge>
                </TableCell>
                <TableCell>{key.createdAt}</TableCell>
                {showActions && (
                  <TableCell>
                    {key.status === 'active' && (
                      <Button variant="destructive" size="sm" disabled={revokingId === key.id} onClick={() => handleRevoke(key.id)}>
                        {revokingId === key.id ? 'Đang revoke…' : 'Revoke'}
                      </Button>
                    )}
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
