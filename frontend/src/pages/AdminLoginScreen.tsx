import { Eye, LockKeyhole, LogIn } from 'lucide-react';
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
    <main className="min-h-dvh bg-[#f7f7f7] text-[#0b0b0b]">
      <div className="mx-auto flex min-h-dvh w-full max-w-[28rem] flex-col justify-center px-6 py-12">
        <section className="w-full" aria-labelledby="admin-login-heading">
          <div className="mb-8 text-center">
            <h1 id="admin-login-heading" className="text-3xl font-bold tracking-tight">Sign in</h1>
            <p className="mt-2 text-base text-[#666]">Enter admin password to continue</p>
          </div>

          <form className="grid gap-5" onSubmit={onSubmit}>
            <div className="grid gap-2">
              <Label htmlFor="admin-login-username" className="text-sm font-medium text-[#1d1d1d]">Admin Username</Label>
              <Input
                id="admin-login-username"
                value={username}
                onChange={(event) => onUsernameChange(event.target.value)}
                className="h-12 rounded-md border-[#dedede] bg-white text-[#111] shadow-none focus-visible:ring-[#111]"
                autoComplete="username"
                disabled={authLoading}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="admin-login-password" className="text-sm font-medium text-[#1d1d1d]">Admin Password</Label>
              <div className="relative">
                <LockKeyhole className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[#5f5f5f]" aria-hidden />
                <Input
                  id="admin-login-password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(event) => onPasswordChange(event.target.value)}
                  className="h-12 rounded-md border-[#dedede] bg-white pl-12 pr-12 text-[#111] shadow-none focus-visible:ring-[#111]"
                  autoComplete="current-password"
                  disabled={authLoading}
                  autoFocus
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-[#5f5f5f] transition-colors hover:bg-[#efefef] hover:text-[#111]"
                  onClick={() => setShowPassword((current) => !current)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  disabled={authLoading}
                >
                  <Eye className="h-5 w-5" aria-hidden />
                </button>
              </div>
            </div>

            <label className="flex items-center gap-3 text-sm text-[#5c5c5c]">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-[#222] accent-black"
                checked={rememberSession}
                onChange={(event) => onRememberSessionChange(event.target.checked)}
                disabled={authLoading}
              />
              Remember session
            </label>

            <Button type="submit" className="h-12 w-full rounded-md bg-black text-base font-semibold text-white hover:bg-[#191919]" disabled={authLoading}>
              <LogIn className="mr-2 h-5 w-5" aria-hidden />
              {authLoading ? 'Signing in...' : 'Login'}
            </Button>
          </form>

          {authError && (
            <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{authError}</p>
          )}
        </section>

        <div className="pointer-events-none absolute bottom-[18%] right-[20%] text-4xl text-black/5" aria-hidden>••</div>
      </div>
    </main>
  );
}