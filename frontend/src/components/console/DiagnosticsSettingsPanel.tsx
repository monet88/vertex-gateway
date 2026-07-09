import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { clearApiLogs } from '@/lib/admin-dashboard-api';
import type { useDiagnostics } from '@/hooks/useDiagnostics';

interface DiagnosticsSettingsPanelProps {
  readonly diagnostics: ReturnType<typeof useDiagnostics>;
  readonly token: string;
}

function SwitchRow({
  id,
  label,
  description,
  checked,
  disabled,
  onCheckedChange,
}: {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly checked: boolean;
  readonly disabled: boolean;
  readonly onCheckedChange: (next: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-border bg-[var(--console-surface-low)] p-3">
      <div className="space-y-1">
        <Label htmlFor={id} className="text-sm font-medium text-foreground">{label}</Label>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onCheckedChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--operator-teal)] disabled:cursor-not-allowed disabled:opacity-50 ${
          checked ? 'border-[var(--operator-teal)] bg-[var(--operator-teal)]' : 'border-border bg-[var(--console-surface-highest)]'
        }`}
      >
        <span
          aria-hidden
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-background shadow transition-transform ${
            checked ? 'left-5' : 'left-0.5'
          }`}
        />
      </button>
    </div>
  );
}

export function DiagnosticsSettingsPanel({ diagnostics, token }: DiagnosticsSettingsPanelProps) {
  const [clearing, setClearing] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);
  const writable = diagnostics.data?.writable === true;
  const showNotWritable = diagnostics.data?.writable === false;
  const disabled = !writable || diagnostics.loading || diagnostics.updating;
  const debugMode = diagnostics.data?.debugMode === true;
  const logToFile = diagnostics.data?.logToFile === true;
  const gateEnabled = diagnostics.data?.gateEnabled === true;
  const entryCount = diagnostics.data?.entryCount ?? 0;
  const canClearRetained = writable && Boolean(token) && (entryCount > 0 || !gateEnabled);

  const handleClearRetained = async () => {
    if (!window.confirm('Xóa toàn bộ log trong bộ nhớ và file log hiện tại?')) return;
    setClearing(true);
    setClearError(null);
    try {
      await clearApiLogs({ token });
      await diagnostics.refetch();
    } catch (err) {
      setClearError(err instanceof Error ? err.message : 'Failed to clear logs');
    } finally {
      setClearing(false);
    }
  };

  return (
    <section className="operator-panel space-y-4 p-4">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Logging &amp; Diagnostics</h2>
        <p className="text-sm text-muted-foreground">
          Bật cả Debug Mode và Log to File để ghi và xem Nhật ký API.
        </p>
      </div>
      {showNotWritable && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
          Cần admin file-store (ghi được) để dùng diagnostics.
        </p>
      )}
      {diagnostics.error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {diagnostics.error}
        </p>
      )}
      {clearError && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {clearError}
        </p>
      )}
      <SwitchRow
        id="debug-mode"
        label="Debug Mode"
        description="Bật chế độ chẩn đoán cho operator console."
        checked={debugMode}
        disabled={disabled}
        onCheckedChange={(next) => {
          void diagnostics.setFlags({ debugMode: next }).catch(() => {});
        }}
      />
      <SwitchRow
        id="log-to-file"
        label="Log to File"
        description="Ghi metadata API call ra memory ring và file JSONL."
        checked={logToFile}
        disabled={disabled}
        onCheckedChange={(next) => {
          void diagnostics.setFlags({ logToFile: next }).catch(() => {});
        }}
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-mono text-xs text-muted-foreground">
          Gate: {gateEnabled ? 'ON' : 'OFF'}
          {typeof diagnostics.data?.entryCount === 'number'
            ? ` · entries ${diagnostics.data.entryCount}/${diagnostics.data.ringSize}`
            : ''}
        </p>
        {canClearRetained ? (
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={clearing || diagnostics.loading || diagnostics.updating}
            onClick={() => {
              void handleClearRetained();
            }}
          >
            {clearing ? 'Đang xóa...' : 'Xóa log đã lưu'}
          </Button>
        ) : null}
      </div>
    </section>
  );
}
