import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { apiLogs } from '../data/mockData';

export function ApiLogsTable() {
  const [filter, setFilter] = useState('');
  const [family, setFamily] = useState<string>('all');

  const filteredLogs = apiLogs.filter(log => {
    const matchesFilter = log.operation.toLowerCase().includes(filter.toLowerCase()) || 
                          log.model.toLowerCase().includes(filter.toLowerCase()) ||
                          log.upstreamTarget.toLowerCase().includes(filter.toLowerCase());
    const matchesFamily = family === 'all' || log.routeFamily === family;
    return matchesFilter && matchesFamily;
  });

  const getStatusColor = (status: string) => {
    if (status === '2xx') return 'bg-emerald-500 hover:bg-emerald-600';
    if (status === '4xx') return 'bg-amber-500 hover:bg-amber-600 text-amber-950';
    if (status === '5xx') return 'bg-red-500 hover:bg-red-600';
    return 'bg-gray-500 hover:bg-gray-600';
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center space-x-2">
        <Input 
          placeholder="Filter logs..." 
          value={filter} 
          onChange={(e) => setFilter(e.target.value)} 
          className="max-w-sm"
        />
        <Select value={family} onValueChange={setFamily}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Family" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Families</SelectItem>
            <SelectItem value="gemini">Gemini</SelectItem>
            <SelectItem value="openai">OpenAI</SelectItem>
            <SelectItem value="vertex">Vertex</SelectItem>
            <SelectItem value="vtx">VTX</SelectItem>
            <SelectItem value="custom">Custom</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Time</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Family</TableHead>
              <TableHead>Operation</TableHead>
              <TableHead>Model</TableHead>
              <TableHead>Target</TableHead>
              <TableHead className="text-right">Latency</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredLogs.length > 0 ? (
              filteredLogs.map((log) => (
                <TableRow key={log.id}>
                  <TableCell className="font-medium">{log.time}</TableCell>
                  <TableCell>
                    <Badge className={getStatusColor(log.status)}>{log.status}</Badge>
                  </TableCell>
                  <TableCell>{log.routeFamily}</TableCell>
                  <TableCell>{log.operation}</TableCell>
                  <TableCell>{log.model}</TableCell>
                  <TableCell>{log.upstreamTarget}</TableCell>
                  <TableCell className="text-right">{log.latencyMs}ms</TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center">
                  No results.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
