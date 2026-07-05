import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';

export interface SecretInputProps {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly placeholder?: string;
}

export function SecretInput({ id, label, value, onChange, placeholder }: SecretInputProps) {
  const [revealed, setRevealed] = useState(false);

  async function copyValue() {
    if (!value) return;
    await navigator.clipboard.writeText(value);
  }

  return (
    <div className="grid gap-2">
      <label htmlFor={id} className="text-sm font-medium">{label}</label>
      <div className="flex gap-2">
        <Input
          id={id}
          type={revealed ? 'text' : 'password'}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          autoComplete="off"
        />
        <Button type="button" variant="secondary" onClick={() => setRevealed((current) => !current)}>
          {revealed ? 'Ẩn' : 'Hiện'}
        </Button>
        <Button type="button" variant="secondary" onClick={copyValue} disabled={!value}>
          Copy
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">Secret được mask mặc định. Chỉ hiện khi operator chủ động bấm.</p>
    </div>
  );
}
