import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { MailCheck } from 'lucide-react';
import { Button, EmptyState, Field, Input } from '../../components/ui';
import { api, toApiError } from '../../lib/api';
import { AuthShell } from './AuthShell';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await api.post('/v1/auth/password/forgot', { email: email.trim() });
      setSent(true);
    } catch (err) {
      toast.error(toApiError(err).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthShell title="Reset your password" subtitle="We will e-mail you a link to choose a new password." footer={<Link to="/login" className="hover:text-slate-800">Back to sign in</Link>}>
      {sent ? (
        <EmptyState icon={MailCheck} title="Check your inbox" hint={`If an account exists for ${email.trim()}, a reset link is on its way. It expires in one hour.`} />
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); void submit(); }} noValidate className="space-y-4">
          <Field label="Email" required htmlFor="email">
            <Input id="email" type="email" autoFocus sanitize="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Button type="submit" className="w-full" loading={busy} disabled={!email}>Send reset link</Button>
        </form>
      )}
    </AuthShell>
  );
}

function PasswordFields({ password, confirm, onPassword, onConfirm, error }: { password: string; confirm: string; onPassword: (v: string) => void; onConfirm: (v: string) => void; error?: string | null }) {
  const mismatch = confirm.length > 0 && confirm !== password;
  return (
    <>
      <Field label="New password" required htmlFor="password" hint="At least 8 characters" error={error ?? undefined}>
        <Input id="password" type="password" autoComplete="new-password" value={password} onChange={(e) => onPassword(e.target.value)} error={Boolean(error)} />
      </Field>
      <Field label="Confirm password" required htmlFor="confirm" error={mismatch ? 'Passwords do not match' : undefined}>
        <Input id="confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => onConfirm(e.target.value)} error={mismatch} />
      </Field>
    </>
  );
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post('/v1/auth/password/reset', { token, password });
      toast.success('Password updated. Sign in with your new password.');
      navigate('/login', { replace: true });
    } catch (err) {
      const e = toApiError(err);
      setError(e.fieldErrors.password ?? e.message);
    } finally {
      setBusy(false);
    }
  };
  if (!token) return <AuthShell title="Invalid link" subtitle="This reset link is missing its token. Request a new one." footer={<Link to="/forgot-password" className="text-brand-700 hover:underline">Request a new link</Link>}><div /></AuthShell>;
  return (
    <AuthShell title="Choose a new password">
      <form onSubmit={(e) => { e.preventDefault(); void submit(); }} noValidate className="space-y-4">
        <PasswordFields password={password} confirm={confirm} onPassword={setPassword} onConfirm={setConfirm} error={error} />
        <Button type="submit" className="w-full" loading={busy} disabled={password.length < 8 || confirm !== password}>Set password</Button>
      </form>
    </AuthShell>
  );
}

/**
 * Invitation acceptance. Owner invitations (from tenant activation) are accepted at svc-auth; member
 * invitations (from svc-iam) at svc-iam. The e-mail link carries `kind` so both land here.
 */
export function AcceptInvitationPage({ defaultKind }: { defaultKind: 'owner' | 'member' }) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') ?? '';
  const kindParam = params.get('kind');
  const kind = kindParam === 'member' || kindParam === 'owner' ? kindParam : defaultKind;
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post(kind === 'member' ? '/v1/iam/invitations/accept' : '/v1/auth/invitations/accept', { token, password, fullName: fullName.trim() || undefined });
      toast.success('Welcome aboard. Sign in to continue.');
      navigate('/login', { replace: true });
    } catch (err) {
      const e = toApiError(err);
      setFieldErrors(e.fieldErrors);
      setError(e.details.length ? null : e.message);
    } finally {
      setBusy(false);
    }
  };
  if (!token) return <AuthShell title="Invalid invitation" subtitle="This invitation link is missing its token. Ask the person who invited you to send it again."><div /></AuthShell>;
  return (
    <AuthShell title="Accept your invitation" subtitle="Set your name and a password to activate your account.">
      <form onSubmit={(e) => { e.preventDefault(); void submit(); }} noValidate className="space-y-4">
        <Field label="Your name" htmlFor="name" error={fieldErrors.fullName}>
          <Input id="name" autoFocus sanitize="name" value={fullName} onChange={(e) => setFullName(e.target.value)} error={Boolean(fieldErrors.fullName)} />
        </Field>
        <PasswordFields password={password} confirm={confirm} onPassword={setPassword} onConfirm={setConfirm} error={fieldErrors.password ?? error} />
        <Button type="submit" className="w-full" loading={busy} disabled={password.length < 8 || confirm !== password}>Activate account</Button>
      </form>
    </AuthShell>
  );
}
