import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export interface ServiceAccountTargetDraft {
  readonly label: string;
  readonly project: string;
  readonly location: string;
  readonly credential: Record<string, unknown>;
}

export interface ServiceAccountTargetDialogProps {
  readonly onCreate: (target: ServiceAccountTargetDraft) => void | Promise<void>;
  readonly disabled?: boolean;
}

export function ServiceAccountTargetDialog({ onCreate, disabled }: ServiceAccountTargetDialogProps) {
  const [draft, setDraft] = useState({ label: '', project: '', location: 'global', credentialJson: '' });
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function patch(update: Partial<typeof draft>) {
    setDraft((current) => ({ ...current, ...update }));
  }

  function handleOpenChange(nextOpen: boolean) {
    if (pending && !nextOpen) return;
    if (!nextOpen) {
      setDraft({ label: '', project: '', location: 'global', credentialJson: '' });
    }
    setError(null);
    setOpen(nextOpen);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const credential = JSON.parse(draft.credentialJson) as unknown;
      if (!credential || typeof credential !== 'object' || Array.isArray(credential)) {
        throw new Error('Service account JSON phải là object.');
      }
      await onCreate({
        label: draft.label.trim() || 'Service account target',
        project: draft.project.trim(),
        location: draft.location.trim(),
        credential: credential as Record<string, unknown>,
      });
      setDraft({ label: '', project: '', location: 'global', credentialJson: '' });
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import service account');
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild><Button variant="secondary" disabled={disabled}>Import account JSON</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import Service Account JSON</DialogTitle>
          <DialogDescription>Credential upstream dùng cho Gateway đến Google. Không hiển thị cho client.</DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={submit}>
          <div className="grid gap-2">
            <Label htmlFor="sa-target-label">Tên target</Label>
            <Input id="sa-target-label" value={draft.label} onChange={(event) => patch({ label: event.target.value })} placeholder="Global primary" disabled={pending} />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="sa-target-project">Project ID</Label>
              <Input id="sa-target-project" value={draft.project} onChange={(event) => patch({ project: event.target.value })} required disabled={pending} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="sa-target-location">Location</Label>
              <Input id="sa-target-location" value={draft.location} onChange={(event) => patch({ location: event.target.value })} required disabled={pending} />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="sa-target-json">Service Account JSON</Label>
            <textarea
              id="sa-target-json"
              className="min-h-44 rounded-md border border-input bg-transparent px-3 py-2 font-mono text-sm shadow-sm outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              value={draft.credentialJson}
              onChange={(event) => patch({ credentialJson: event.target.value })}
              disabled={pending}
              required
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={pending}>{pending ? 'Đang import...' : 'Import account'}</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
