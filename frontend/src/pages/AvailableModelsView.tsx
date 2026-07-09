import { useCallback, useEffect, useMemo, useState } from 'react';
import { AdminError, TableSkeleton } from '@/components/console/AdminState';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { StitchPageHeader } from '@/components/stitch/StitchPageHeader';
import { StitchPanel } from '@/components/stitch/StitchPanel';
import { fetchModelCatalog, type AdminProviderModelCatalog } from '@/lib/admin-dashboard-api';
import { buildAvailableModelRows } from '@/pages/available-models-data';

const PROVIDERS = ['gemini', 'openai'] as const;

interface AvailableModelsViewProps {
  readonly token: string;
}

export function AvailableModelsView({ token }: AvailableModelsViewProps) {
  const [catalogs, setCatalogs] = useState<Record<string, AdminProviderModelCatalog>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const settled = await Promise.allSettled(
        PROVIDERS.map(async (provider) => [provider, await fetchModelCatalog({ token }, provider)] as const),
      );
      const next: Record<string, AdminProviderModelCatalog> = {};
      const errors: string[] = [];
      for (const r of settled) {
        if (r.status === 'fulfilled') {
          const [provider, catalog] = r.value;
          next[provider] = catalog;
        } else {
          const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
          errors.push(msg);
        }
      }
      setCatalogs(next);
      const loadError = errors.length === 0
        ? null
        : `${Object.keys(next).length === 0 ? 'Failed to load catalog' : 'Partial load'}: ${errors.join('; ')}`;
      if (loadError) {
        setError(loadError);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load catalog');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  const rows = useMemo(
    () => PROVIDERS.flatMap((provider) => buildAvailableModelRows(provider, catalogs[provider] ?? { aliases: {}, allowlist: [], disabled: [] })),
    [catalogs],
  );

  return (
    <div className="space-y-8">
      <StitchPageHeader
        title="Available Models"
        description="Read-only inventory of the current model catalog."
      />

      {error && <AdminError message={error} onRetry={load} />}

      <StitchPanel title="Model catalog">
        {loading ? (
          <TableSkeleton rows={5} columns={5} />
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Provider</TableHead>
                  <TableHead>Model</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Default</TableHead>
                  <TableHead>Aliases</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length > 0 ? (
                  rows.map((row) => (
                    <TableRow key={`${row.provider}:${row.model}`}>
                      <TableCell className="font-medium">{row.provider}</TableCell>
                      <TableCell className="font-mono text-sm">{row.model}</TableCell>
                      <TableCell>
                        <Badge variant={row.status === 'allowed' ? 'default' : 'destructive'}>{row.status}</Badge>
                      </TableCell>
                      <TableCell>{row.isDefault ? 'Yes' : '-'}</TableCell>
                      <TableCell className="text-muted-foreground">{row.aliases.join(', ') || '-'}</TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={5} className="h-24 text-center">No catalog rules configured.</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </StitchPanel>
    </div>
  );
}
