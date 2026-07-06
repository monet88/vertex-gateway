import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export interface SecretInputProps {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly placeholder?: string;
  readonly disabled?: boolean;
}

export function SecretInput({ id, label, value, onChange, placeholder, disabled = false }: SecretInputProps) {
  const [revealed, setRevealed] = useState(false);

  async function copyValue() {
    if (!value) return;
    if (!navigator.clipboard) return;
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
          disabled={disabled}
        />
        <Button type="button" variant="secondary" onClick={() => setRevealed((current) => !current)} disabled={disabled}>
          {revealed ? 'Ẩn' : 'Hiện'}
        </Button>
        <Button type="button" variant="secondary" onClick={copyValue} disabled={!value || disabled}>
          Copy
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">Secret được mask mặc định. Chỉ hiện khi operator chủ động bấm.</p>
    </div>
  );
}
