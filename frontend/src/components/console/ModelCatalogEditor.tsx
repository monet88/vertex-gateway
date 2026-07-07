import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AdminError } from '@/components/console/AdminState';
import type { ProviderModelCatalog } from '@/types/admin';

interface ModelCatalogEditorProps {
  readonly catalog: ProviderModelCatalog;
  readonly onSave: (catalog: ProviderModelCatalog) => Promise<void>;
  readonly provider: string;
}

export function ModelCatalogEditor({ catalog, onSave, provider }: ModelCatalogEditorProps) {
  const [defaultModel, setDefaultModel] = useState(catalog.defaultModel ?? '');
  const [aliasesJson, setAliasesJson] = useState(JSON.stringify(catalog.aliases, null, 2));
  const [allowlistCsv, setAllowlistCsv] = useState((catalog.allowlist ?? []).join(', '));
  const [disabledCsv, setDisabledCsv] = useState((catalog.disabled ?? []).join(', '));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      let aliases: Record<string, string>;
      try {
        aliases = JSON.parse(aliasesJson);
      } catch {
        throw new Error('Invalid aliases JSON');
      }
      const updated: ProviderModelCatalog = {
        defaultModel: defaultModel || undefined,
        aliases,
        allowlist: allowlistCsv.split(',').map((s) => s.trim()).filter(Boolean),
        disabled: disabledCsv.split(',').map((s) => s.trim()).filter(Boolean),
      };
      await onSave(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [defaultModel, aliasesJson, allowlistCsv, disabledCsv, onSave]);

  return (
    <div className="space-y-4 rounded-md border border-border bg-card p-4">
      <h3 className="text-lg font-semibold tracking-tight">{provider} catalog</h3>
      {error && <AdminError message={error} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label>Default model</Label>
          <Input value={defaultModel} onChange={(e) => setDefaultModel(e.target.value)} placeholder="e.g. gemini-3.5-flash" />
        </div>
        <div>
          <Label>Allowlist (comma-separated)</Label>
          <Input value={allowlistCsv} onChange={(e) => setAllowlistCsv(e.target.value)} placeholder="model-a, model-b" />
        </div>
        <div>
          <Label>Disabled (comma-separated)</Label>
          <Input value={disabledCsv} onChange={(e) => setDisabledCsv(e.target.value)} placeholder="model-x, model-y" />
        </div>
        <div className="sm:col-span-2">
          <Label>Aliases (JSON)</Label>
          <textarea
            className="mt-1.5 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background"
            rows={4}
            value={aliasesJson}
            onChange={(e) => setAliasesJson(e.target.value)}
          />
        </div>
      </div>
      <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save Catalog'}</Button>
    </div>
  );
}
