import { useCallback, useEffect, useState } from 'react';
import { AdminError, TableSkeleton } from '@/components/console/AdminState';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useAdminToken } from '@/hooks/useAdminToken';
import { fetchModelCatalog } from '@/lib/admin-dashboard-api';
import type { ProviderModelCatalog } from '@/types/admin';

export function AvailableModelsView() {
  const { token } = useAdminToken();
  const [catalog, setCatalog] = useState<ProviderModelCatalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchModelCatalog({ token });
      setCatalog(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load catalog');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  const allModels = catalog
    ? [
        ...(catalog.allowlist ?? []).map((model) => ({ model, status: 'allowed' as const })),
        ...(catalog.disabled ?? []).map((model) => ({ model, status: 'disabled' as const })),
      ]
    : [];

  return (
    <div className="space-y-8">
      <section className="rounded-xl border border-border bg-card p-4">
        <h1 className="text-2xl font-semibold tracking-tight">Available Models</h1>
        <p className="mt-1 text-sm text-muted-foreground">Read-only inventory of the current model catalog.</p>
        {catalog?.defaultModel && (
          <p className="mt-2 text-sm">Default: <code className="rounded bg-secondary px-1.5 py-0.5">{catalog.defaultModel}</code></p>
        )}
      </section>

      {error && <AdminError message={error} onRetry={load} />}

      {loading ? (
        <TableSkeleton rows={5} columns={3} />
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Model</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Alias</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {allModels.length > 0 ? (
                allModels.map(({ model, status }) => (
                  <TableRow key={model}>
                    <TableCell className="font-medium">{model}</TableCell>
                    <TableCell>
                      <Badge variant={status === 'allowed' ? 'default' : 'destructive'}>{status}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {Object.entries(catalog?.aliases ?? {})
                        .filter(([, target]) => target === model)
                        .map(([alias]) => alias)
                        .join(', ') || '—'}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={3} className="h-24 text-center">No models in catalog.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
