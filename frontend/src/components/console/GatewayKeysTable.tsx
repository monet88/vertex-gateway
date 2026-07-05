import { useState } from 'react';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import type { GatewayKeyRow } from '../../data/mockData';

export interface GatewayKeysTableProps {
  readonly rows: readonly GatewayKeyRow[];
}

export function GatewayKeysTable({ rows }: GatewayKeysTableProps) {
  const [sortKey, setSortKey] = useState<keyof GatewayKeyRow>('createdAt');
  const [direction, setDirection] = useState<'asc' | 'desc'>('desc');

  const getStatusColor = (status: string) => {
    if (status === 'active') return 'bg-emerald-500 hover:bg-emerald-600';
    if (status === 'revoked') return 'bg-red-500 hover:bg-red-600';
    return 'bg-gray-500 hover:bg-gray-600';
  };

  const nextDirection = direction === 'asc' ? 'desc' : 'asc';
  
  const handleSort = (key: keyof GatewayKeyRow) => {
    if (sortKey === key) {
      setDirection(nextDirection);
    } else {
      setSortKey(key);
      setDirection('asc');
    }
  };

  const sortedRows = [...rows].sort((a, b) => {
    const valA = String(a[sortKey]);
    const valB = String(b[sortKey]);
    return direction === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
  });

  const columns: Array<{ key: keyof GatewayKeyRow; label: string }> = [
    { key: 'label', label: 'Label' },
    { key: 'preview', label: 'Preview' },
    { key: 'status', label: 'Status' },
    { key: 'createdAt', label: 'Created At' },
  ];

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((col) => (
              <TableHead key={col.key}>
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
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell colSpan={4} className="h-24 text-center">
                No keys found.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
