import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { vertexTargets } from '../data/mockData';

export function VertexTargetsTable() {
  const getHealthColor = (health: string) => {
    if (health === 'ready') return 'bg-emerald-500 hover:bg-emerald-600';
    if (health === 'degraded') return 'bg-amber-500 hover:bg-amber-600 text-amber-950';
    if (health === 'failed') return 'bg-red-500 hover:bg-red-600';
    return 'bg-gray-500 hover:bg-gray-600';
  };

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Label</TableHead>
            <TableHead>Project</TableHead>
            <TableHead>Location</TableHead>
            <TableHead>Auth Type</TableHead>
            <TableHead>Mode</TableHead>
            <TableHead>Health</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {vertexTargets.length > 0 ? (
            vertexTargets.map((target) => (
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
