import { useEffect, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowLeft, Building2, KeyRound } from 'lucide-react';
import { Button, Field, Input } from '../../components/ui';
import { toApiError } from '../../lib/api';
import { useAuth, type Portal } from '../../lib/auth';
import { AuthShell } from './AuthShell';

/**
 * Sign in for both portals. Steps: credentials -> (MFA code, with first-time enrolment for
 * platform staff) -> (choose an organisation when the user belongs to several) -> in.
 */
export function LoginPage({ portal = 'app' }: { portal?: Portal }) {
  const { status, session, pending, login, verifyMfa, selectTenant, cancelPending } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: { pathname: string } } | null)?.from?.pathname;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const home = portal === 'admin' ? '/admin' : '/';

  useEffect(() => {
    setError(null);
  }, [pending?.kind]);

  if (status === 'authenticated' && session) {
    const target = session.tokenType === 'platform' ? '/admin' : '/';
    return <Navigate to={from && from !== '/login' && from !== '/admin/login' ? from : target} replace />;
  }

  const run = async (fn: () => Promise<unknown>, done?: () => void) => {
    setBusy(true);
    setError(null);
    try {
      const result = await fn();
      if (result === 'done') navigate(from ?? home, { replace: true });
      done?.();
    } catch (err) {
      const e = toApiError(err);
      setError(e.message);
      if (e.code === 'PLATFORM_ONLY') toast('Platform accounts sign in on the admin portal', { icon: '!' });
    } finally {
      setBusy(false);
    }
  };

  if (pending?.kind === 'mfa') {
    return (
      <AuthShell variant={portal === 'admin' ? 'admin' : 'app'} title={pending.enrolmentRequired ? 'Set up two-factor authentication' : 'Two-factor authentication'} subtitle={pending.enrolmentRequired ? 'Scan the setup link in your authenticator app, then enter the 6-digit code.' : 'Enter the 6-digit code from your authenticator app.'}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => verifyMfa(code.trim()));
          }}
          noValidate
          className="space-y-4"
        >
          {pending.enrolmentRequired && pending.otpauthUrl && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
              <p className="text-slate-600 mb-1">Open this link on the device that runs your authenticator, or copy the secret from it:</p>
              <a href={pending.otpauthUrl} className="font-mono break-all text-brand-700 hover:underline">{pending.otpauthUrl}</a>
            </div>
          )}
          <Field label="Authentication code" required htmlFor="mfa-code" error={error ?? undefined}>
            <Input id="mfa-code" autoFocus inputMode="numeric" sanitize="digits" maxLength={8} value={code} onChange={(e) => setCode(e.target.value)} className="font-mono tracking-widest text-center text-lg" error={Boolean(error)} />
          </Field>
          <Button type="submit" className="w-full" loading={busy} icon={KeyRound} disabled={code.trim().length < 6}>
            Verify
          </Button>
          <button type="button" onClick={cancelPending} className="w-full text-sm text-slate-500 hover:text-slate-800 inline-flex items-center justify-center gap-1">
            <ArrowLeft className="w-4 h-4" /> Back to sign in
          </button>
        </form>
      </AuthShell>
    );
  }

  if (pending?.kind === 'select') {
    return (
      <AuthShell title="Choose an organisation" subtitle="Your account belongs to more than one organisation.">
        <div className="space-y-2">
          {pending.tenants.map((t) => (
            <button key={t.id} type="button" disabled={busy} onClick={() => void run(() => selectTenant(t.id).then(() => 'done' as const))} className="w-full flex items-center gap-3 rounded-xl border border-slate-200 px-4 py-3 text-left hover:border-brand-400 hover:bg-brand-50/40 transition disabled:opacity-50">
              <span className="w-9 h-9 rounded-lg bg-slate-100 text-slate-500 flex items-center justify-center shrink-0">
                <Building2 className="w-4 h-4" />
              </span>
              <span className="min-w-0">
                <span className="block font-medium text-slate-900 truncate">{t.name}</span>
                {t.roleKeys.length > 0 && <span className="block text-xs text-slate-500">{t.roleKeys.join(', ')}</span>}
              </span>
            </button>
          ))}
          {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
          <button type="button" onClick={cancelPending} className="w-full text-sm text-slate-500 hover:text-slate-800 inline-flex items-center justify-center gap-1 pt-2">
            <ArrowLeft className="w-4 h-4" /> Back to sign in
          </button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      variant={portal === 'admin' ? 'admin' : 'app'}
      title={portal === 'admin' ? 'Platform sign in' : 'Sign in'}
      subtitle={portal === 'admin' ? 'Rentfoxxy platform staff only.' : 'Welcome back. Sign in to your organisation.'}
      footer={
        portal === 'admin' ? (
          <Link to="/login" className="hover:text-slate-800">Not platform staff? Sign in to your organisation</Link>
        ) : (
          <span>
            New supplier? <Link to="/apply" className="text-brand-700 hover:underline">Apply for an account</Link>
            <span className="mx-2 text-slate-300">|</span>
            <Link to="/admin/login" className="hover:text-slate-800">Platform console</Link>
          </span>
        )
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => login(email.trim(), password, portal));
        }}
        noValidate
        className="space-y-4"
      >
        <Field label="Email" required htmlFor="email">
          <Input id="email" type="email" autoComplete="email" autoFocus sanitize="email" value={email} onChange={(e) => setEmail(e.target.value)} error={Boolean(error)} />
        </Field>
        <Field label="Password" required htmlFor="password" error={error ?? undefined}>
          <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} error={Boolean(error)} />
        </Field>
        <div className="flex items-center justify-between">
          <Link to="/forgot-password" className="text-sm text-brand-700 hover:underline">Forgot password?</Link>
        </div>
        <Button type="submit" className="w-full" loading={busy} disabled={!email || !password}>
          Sign in
        </Button>
      </form>
    </AuthShell>
  );
}
