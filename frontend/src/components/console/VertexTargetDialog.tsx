import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SecretInput } from './SecretInput';

export interface VertexTargetDraft {
  readonly label: string;
  readonly project: string;
  readonly location: string;
  readonly apiKey: string;
}

export interface VertexTargetDialogProps {
  readonly onCreate: (target: VertexTargetDraft) => void;
}

export function VertexTargetDialog({ onCreate }: VertexTargetDialogProps) {
  const [draft, setDraft] = useState<VertexTargetDraft>({ label: '', project: '', location: 'global', apiKey: '' });
  const [open, setOpen] = useState(false);

  function patch(update: Partial<VertexTargetDraft>) {
    setDraft((current) => ({ ...current, ...update }));
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onCreate({ ...draft, label: draft.label.trim() || 'Vertex target' });
    setDraft({ label: '', project: '', location: 'global', apiKey: '' });
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button>Thêm target</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Thêm Vertex target</DialogTitle>
          <DialogDescription>Upstream credential dùng cho Gateway đến Google. Không hiển thị cho client.</DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={submit}>
          <div className="grid gap-2">
            <Label htmlFor="target-label">Tên target</Label>
            <Input id="target-label" value={draft.label} onChange={(event) => patch({ label: event.target.value })} placeholder="Global primary" />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="target-project">Project ID</Label>
              <Input id="target-project" value={draft.project} onChange={(event) => patch({ project: event.target.value })} required />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="target-location">Location</Label>
              <Input id="target-location" value={draft.location} onChange={(event) => patch({ location: event.target.value })} required />
            </div>
          </div>
          <SecretInput id="target-api-key" label="Google Cloud API key" value={draft.apiKey} onChange={(apiKey) => patch({ apiKey })} />
          <Button type="submit">Thêm target</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
