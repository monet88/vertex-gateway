import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '../../components/ui/dialog';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';

export interface GatewayKeyDialogProps {
  readonly onCreate: (label: string) => void;
}

export function GatewayKeyDialog({ onCreate }: GatewayKeyDialogProps) {
  const [label, setLabel] = useState('');
  const [open, setOpen] = useState(false);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onCreate(label.trim() || 'Managed key');
    setLabel('');
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button>Tạo gateway key</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Tạo gateway key</DialogTitle>
          <DialogDescription>Gateway key dùng cho Client đến Gateway. Đây không phải Google Cloud API key.</DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={submit}>
          <div className="grid gap-2">
            <Label htmlFor="gateway-key-label">Tên key</Label>
            <Input id="gateway-key-label" value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Mobile app" />
          </div>
          <Button type="submit">Tạo key</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
