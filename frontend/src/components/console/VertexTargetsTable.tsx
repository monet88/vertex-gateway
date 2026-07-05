import { useState } from 'react';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import type { VertexTargetRow } from '../../data/mockData';

export interface VertexTargetsTableProps {
  readonly rows: readonly VertexTargetRow[];
}

export function VertexTargetsTable({ rows }: VertexTargetsTableProps) {
  const [sortKey, setSortKey] = useState<keyof VertexTargetRow>('label');
  const [direction, setDirection] = useState<'asc' | 'desc'>('asc');

  const getHealthColor = (health: string) => {
    if (health === 'ready') return 'bg-emerald-500 hover:bg-emerald-600';
    if (health === 'degraded') return 'bg-amber-500 hover:bg-amber-600 text-amber-950';
    if (health === 'failed') return 'bg-red-500 hover:bg-red-600';
    return 'bg-gray-500 hover:bg-gray-600';
  };

  const nextDirection = direction === 'asc' ? 'desc' : 'asc';
  
  const handleSort = (key: keyof VertexTargetRow) => {
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

  const columns: Array<{ key: keyof VertexTargetRow; label: string }> = [
    { key: 'label', label: 'Label' },
    { key: 'project', label: 'Project' },
    { key: 'location', label: 'Location' },
    { key: 'authType', label: 'Auth Type' },
    { key: 'apiKeyMode', label: 'Mode' },
    { key: 'health', label: 'Health' },
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
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell colSpan={6} className="h-24 text-center">
                No targets configured.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
