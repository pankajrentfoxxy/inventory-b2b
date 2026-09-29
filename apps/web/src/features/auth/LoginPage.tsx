import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useForm, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Boxes } from 'lucide-react';
import { loginSchema } from '@b2b/shared';
import { Button, Field, Input } from '../../components/ui';
import { toApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth';

type LoginValues = { email: string; password: string };

export function LoginPage() {
  const { status, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [serverError, setServerError] = useState<string | null>(null);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<LoginValues>({ resolver: zodResolver(loginSchema) as unknown as Resolver<LoginValues> });

  if (status === 'authenticated') return <Navigate to="/purchases/purchase-orders" replace />;

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      await login(values.email, values.password);
      const from = (location.state as { from?: { pathname: string } } | null)?.from?.pathname;
      navigate(from ?? '/purchases/purchase-orders', { replace: true });
    } catch (err) {
      setServerError(toApiError(err).message);
    }
  });

  return (
    <AuthShell title="Sign in" subtitle="Use your organization account.">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {serverError && <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2" role="alert">{serverError}</div>}
        <Field label="Email" htmlFor="email" error={errors.email?.message}>
          <Input id="email" type="email" sanitize="email" maxLength={254} autoComplete="email" autoFocus error={Boolean(errors.email)} {...register('email')} />
        </Field>
        <Field label="Password" htmlFor="password" error={errors.password?.message}>
          <Input id="password" type="password" autoComplete="current-password" error={Boolean(errors.password)} {...register('password')} />
        </Field>
        <Button type="submit" className="w-full" size="lg" loading={isSubmitting}>
          Sign in
        </Button>
        <p className="text-center text-sm text-slate-500">
          New here?{' '}
          <Link to="/register" className="text-brand-700 font-medium hover:underline">
            Create an organization
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}

export function AuthShell({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10 bg-slate-50">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2 justify-center mb-6">
          <span className="w-9 h-9 rounded-lg bg-brand-600 text-white flex items-center justify-center">
            <Boxes className="w-5 h-5" />
          </span>
          <span className="text-lg font-semibold text-slate-900">B2B Inventory</span>
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl shadow-card p-6">
          <h1 className="text-lg font-semibold text-slate-900">{title}</h1>
          {subtitle && <p className="text-sm text-slate-500 mt-0.5 mb-5">{subtitle}</p>}
          {children}
        </div>
      </div>
    </div>
  );
}
