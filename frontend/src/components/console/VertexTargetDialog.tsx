import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SecretInput } from './SecretInput';
import type { VertexApiKeyMode } from '@/types/admin';

export interface VertexTargetDraft {
  readonly label: string;
  readonly project: string;
  readonly location: string;
  readonly apiKey: string;
  readonly apiKeyMode: VertexApiKeyMode;
}

export interface VertexTargetDialogProps {
  readonly onCreate: (target: VertexTargetDraft) => void | Promise<void>;
  readonly initialDraft?: VertexTargetDraft;
  readonly mode?: 'create' | 'edit';
  readonly triggerLabel?: string;
  readonly disabled?: boolean;
}

const emptyDraft: VertexTargetDraft = { label: '', project: '', location: 'global', apiKey: '', apiKeyMode: 'full' };

export function VertexTargetDialog({ onCreate, initialDraft, mode = 'create', triggerLabel, disabled }: VertexTargetDialogProps) {
  const [draft, setDraft] = useState<VertexTargetDraft>(initialDraft ?? emptyDraft);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function patch(update: Partial<VertexTargetDraft>) {
    setDraft((current) => ({ ...current, ...update }));
  }

  function handleOpenChange(nextOpen: boolean) {
    if (pending && !nextOpen) return;
    setError(null);
    if (nextOpen) setDraft(initialDraft ?? emptyDraft);
    setOpen(nextOpen);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await onCreate({ ...draft, label: draft.label.trim() || 'Agent Platform Apikey' });
      setDraft(initialDraft ?? emptyDraft);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create target');
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild><Button variant={mode === 'edit' ? 'ghost' : 'default'} size={mode === 'edit' ? 'sm' : 'default'} disabled={disabled}>{triggerLabel ?? (mode === 'edit' ? 'Edit' : 'Thêm apikey')}</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === 'edit' ? 'Edit Agent Platform Apikey' : 'Thêm Agent Platform Apikey'}</DialogTitle>
          <DialogDescription>Upstream credential dùng cho Gateway đến Google. Secret không hiển thị cho client.</DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={submit}>
          <div className="grid gap-2">
            <Label htmlFor="target-label">Tên target</Label>
            <Input id="target-label" value={draft.label} onChange={(event) => patch({ label: event.target.value })} placeholder="Global primary" disabled={pending} />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="target-project">Project ID</Label>
              <Input id="target-project" value={draft.project} onChange={(event) => patch({ project: event.target.value })} required disabled={pending} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="target-location">Location</Label>
              <Input id="target-location" value={draft.location} onChange={(event) => patch({ location: event.target.value })} required disabled={pending} />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="target-api-key-mode">Mode</Label>
            <Select value={draft.apiKeyMode} onValueChange={(apiKeyMode: VertexApiKeyMode) => patch({ apiKeyMode })} disabled={pending}>
              <SelectTrigger id="target-api-key-mode"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="full">full</SelectItem>
                <SelectItem value="express">express</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <SecretInput id="target-api-key" label="Agent Platform API key" value={draft.apiKey} onChange={(apiKey) => patch({ apiKey })} placeholder={mode === 'edit' ? 'Để trống nếu giữ nguyên key hiện tại' : undefined} disabled={pending} required={mode === 'create'} />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={pending}>{pending ? 'Đang lưu…' : (mode === 'edit' ? 'Lưu thay đổi' : 'Thêm apikey')}</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
