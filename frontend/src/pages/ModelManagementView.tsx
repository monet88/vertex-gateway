import { useCallback, useEffect, useState } from 'react';
import { ModelCatalogEditor } from '@/components/console/ModelCatalogEditor';
import { AdminError, TableSkeleton } from '@/components/console/AdminState';
import { StitchPageHeader } from '@/components/stitch/StitchPageHeader';
import { fetchModelCatalog, saveModelCatalog } from '@/lib/admin-dashboard-api';
import type { ProviderModelCatalog } from '@/types/admin';

const PROVIDERS = ['gemini', 'openai'] as const;
const EMPTY_CATALOG: ProviderModelCatalog = { aliases: {}, allowlist: [], disabled: [] };

interface ModelManagementViewProps {
  readonly token: string;
}

export function ModelManagementView({ token }: ModelManagementViewProps) {
  const [catalogs, setCatalogs] = useState<Record<string, ProviderModelCatalog>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const results = await Promise.all(
        PROVIDERS.map(async (provider) => {
          const catalog = await fetchModelCatalog({ token }, provider);
          return [provider, catalog] as const;
        }),
      );
      setCatalogs(Object.fromEntries(results));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load catalogs');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  const handleSave = useCallback(
    async (provider: string, catalog: ProviderModelCatalog) => {
      const saved = await saveModelCatalog({ token }, provider, catalog);
      setCatalogs((current) => ({ ...current, [provider]: saved }));
    },
    [token],
  );

  return (
    <div className="space-y-8">
      <StitchPageHeader
        title="Model Management"
        description="Edit routing policy: default model, aliases, allowlist, and disabled models per provider."
      />

      {error && <AdminError message={error} onRetry={load} />}

      {loading ? (
        <TableSkeleton rows={4} columns={2} />
      ) : error ? null : (
        <div className="grid gap-4 xl:grid-cols-2">
          {PROVIDERS.map((provider) => (
            <ModelCatalogEditor
              key={provider}
              provider={provider}
              catalog={catalogs[provider] ?? EMPTY_CATALOG}
              onSave={(catalog) => handleSave(provider, catalog)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
