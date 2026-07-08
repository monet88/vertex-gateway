import { Eye, EyeOff, LockKeyhole, LogIn, ShieldCheck } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface AdminLoginScreenProps {
  readonly username: string;
  readonly password: string;
  readonly authError: string | null;
  readonly authLoading: boolean;
  readonly rememberSession: boolean;
  readonly onUsernameChange: (username: string) => void;
  readonly onPasswordChange: (password: string) => void;
  readonly onRememberSessionChange: (rememberSession: boolean) => void;
  readonly onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

export function AdminLoginScreen({
  username,
  password,
  authError,
  authLoading,
  rememberSession,
  onUsernameChange,
  onPasswordChange,
  onRememberSessionChange,
  onSubmit,
}: AdminLoginScreenProps) {
  const [showPassword, setShowPassword] = useState(false);

  return (
    <main className="min-h-dvh bg-background text-foreground">
      <div className="mx-auto grid min-h-dvh w-full max-w-5xl grid-cols-1 content-center gap-5 px-4 py-8 md:grid-cols-[0.9fr_1.1fr] md:px-6">
        <aside className="operator-panel hidden min-h-[28rem] flex-col justify-between p-6 md:flex">
          <div>
            <div className="mb-8 inline-flex items-center gap-2 rounded-lg border border-border bg-[var(--console-surface-highest)] px-3 py-2 font-mono text-xs uppercase tracking-widest text-[var(--operator-teal)]">
              <ShieldCheck className="h-4 w-4" aria-hidden /> Admin Gate
            </div>
            <p className="text-4xl font-semibold tracking-tight text-foreground">Vertex Gateway</p>
            <p className="mt-3 max-w-sm text-sm leading-6 text-muted-foreground">
              Operator console for gateway keys, upstream Agent Platform credentials, routing policy, and runtime health.
            </p>
          </div>

          <div className="grid gap-3 border-t border-border pt-5 text-sm text-muted-foreground">
            <div className="flex items-center justify-between gap-4">
              <span>Gateway API keys</span>
              <span className="font-mono text-[var(--operator-teal)]">client to gateway</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span>Agent Platform credentials</span>
              <span className="font-mono text-[var(--operator-teal)]">gateway to Google</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span>Session storage</span>
              <span className="font-mono text-[var(--warning-amber)]">operator controlled</span>
            </div>
          </div>
        </aside>

        <section className="operator-panel w-full p-5 md:p-6" aria-labelledby="admin-login-heading">
          <div className="mb-6">
            <p className="font-mono text-xs uppercase tracking-widest text-[var(--operator-teal)]">Vertex Gateway Admin</p>
            <h1 id="admin-login-heading" className="mt-3 text-2xl font-semibold tracking-tight text-foreground">Sign in</h1>
            <p className="mt-2 text-sm text-muted-foreground">Enter admin credentials to continue.</p>
          </div>

          <form className="grid gap-4" onSubmit={onSubmit}>
            <div className="grid gap-2">
              <Label htmlFor="admin-login-username" className="text-sm font-medium text-foreground">Admin Username</Label>
              <Input
                id="admin-login-username"
                value={username}
                onChange={(event) => onUsernameChange(event.target.value)}
                className="h-11 rounded-lg border-border bg-[var(--console-input)] font-mono text-foreground shadow-none focus-visible:ring-[var(--operator-teal)]"
                autoComplete="username"
                disabled={authLoading}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="admin-login-password" className="text-sm font-medium text-foreground">Admin Password</Label>
              <div className="relative">
                <LockKeyhole className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <Input
                  id="admin-login-password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(event) => onPasswordChange(event.target.value)}
                  className="h-11 rounded-lg border-border bg-[var(--console-input)] pl-10 pr-14 font-mono text-foreground shadow-none focus-visible:ring-[var(--operator-teal)]"
                  autoComplete="current-password"
                  disabled={authLoading}
                  autoFocus
                />
                <button
                  type="button"
                  className="absolute right-0 top-1/2 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-r-lg text-muted-foreground transition-colors hover:bg-[var(--console-surface-high)] hover:text-[var(--operator-teal)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--operator-teal)]"
                  onClick={() => setShowPassword((current) => !current)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  disabled={authLoading}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
                </button>
              </div>
            </div>

            <label className="flex items-center gap-3 text-sm text-muted-foreground">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-border bg-[var(--console-input)] accent-[var(--operator-teal)]"
                checked={rememberSession}
                onChange={(event) => onRememberSessionChange(event.target.checked)}
                disabled={authLoading}
              />
              Remember session
            </label>

            <Button type="submit" className="h-11 w-full rounded-lg bg-[var(--operator-teal)] text-sm font-semibold text-[#003731] hover:bg-[var(--operator-teal)]/90 active:scale-[0.98]" disabled={authLoading}>
              <LogIn className="mr-2 h-4 w-4" aria-hidden />
              {authLoading ? 'Signing in...' : 'Login'}
            </Button>
          </form>

          {authError && (
            <p className="mt-4 rounded-lg border border-[var(--failure-red)]/40 bg-[var(--failure-red)]/10 px-3 py-2 text-sm text-[var(--failure-red)]" role="alert">{authError}</p>
          )}
        </section>
      </div>
    </main>
  );
}