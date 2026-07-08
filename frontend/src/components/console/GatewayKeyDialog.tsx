import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export interface GatewayKeyDialogProps {
  readonly onCreate: (label: string) => Promise<string>;
  readonly disabled?: boolean;
}

export function GatewayKeyDialog({ onCreate, disabled }: GatewayKeyDialogProps) {
  const [label, setLabel] = useState('');
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const result = await onCreate(label.trim() || 'Managed key');
      setSecret(result);
      setLabel('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create key');
    } finally {
      setPending(false);
    }
  }

  function handleClose(nextOpen: boolean) {
    if (!nextOpen && pending) return;
    if (!nextOpen) {
      setSecret(null);
      setError(null);
      setLabel('');
    }
    setOpen(nextOpen);
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogTrigger asChild><Button disabled={disabled}>Tạo gateway key</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Tạo gateway key</DialogTitle>
          <DialogDescription>Gateway key dùng cho Client đến Gateway. Đây không phải Google Cloud API key.</DialogDescription>
        </DialogHeader>
        {secret ? (
          <div className="grid gap-3">
            <p className="text-sm text-emerald-500 font-medium">Key đã tạo thành công. Copy ngay — secret sẽ không hiển thị lại.</p>
            <code className="select-all rounded bg-muted p-3 text-sm font-mono break-all">{secret}</code>
            <Button onClick={() => handleClose(false)}>Đóng</Button>
          </div>
        ) : (
          <form className="grid gap-4" onSubmit={submit}>
            <div className="grid gap-2">
              <Label htmlFor="gateway-key-label">Tên key</Label>
              <Input id="gateway-key-label" value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Mobile app" disabled={pending} />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" disabled={pending}>{pending ? 'Đang tạo…' : 'Tạo key'}</Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
