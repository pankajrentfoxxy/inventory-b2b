import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useForm, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { registerSchema } from '@b2b/shared';
import { Button, Field, Input } from '../../components/ui';
import { toApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { AuthShell } from './LoginPage';

type RegisterValues = { name: string; email: string; password: string; organizationName: string };

export function RegisterPage() {
  const { status, register: registerAccount } = useAuth();
  const navigate = useNavigate();
  const [serverError, setServerError] = useState<string | null>(null);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<RegisterValues>({ resolver: zodResolver(registerSchema) as unknown as Resolver<RegisterValues> });

  if (status === 'authenticated') return <Navigate to="/purchases/purchase-orders" replace />;

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      await registerAccount(values);
      navigate('/purchases/purchase-orders', { replace: true });
    } catch (err) {
      setServerError(toApiError(err).message);
    }
  });

  return (
    <AuthShell title="Create your organization" subtitle="You will be the owner with full access. Invite teammates from Settings.">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {serverError && <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2" role="alert">{serverError}</div>}
        <Field label="Organization name" required htmlFor="organizationName" error={errors.organizationName?.message}>
          <Input id="organizationName" autoFocus sanitize="singleLine" maxLength={150} error={Boolean(errors.organizationName)} {...register('organizationName')} />
        </Field>
        <Field label="Your name" required htmlFor="name" error={errors.name?.message}>
          <Input id="name" autoComplete="name" sanitize="name" maxLength={100} error={Boolean(errors.name)} {...register('name')} />
        </Field>
        <Field label="Email" required htmlFor="email" error={errors.email?.message}>
          <Input id="email" type="email" sanitize="email" maxLength={254} autoComplete="email" error={Boolean(errors.email)} {...register('email')} />
        </Field>
        <Field label="Password" required htmlFor="password" error={errors.password?.message} hint="At least 8 characters">
          <Input id="password" type="password" autoComplete="new-password" error={Boolean(errors.password)} {...register('password')} />
        </Field>
        <Button type="submit" className="w-full" size="lg" loading={isSubmitting}>
          Create organization
        </Button>
        <p className="text-center text-sm text-slate-500">
          Already have an account?{' '}
          <Link to="/login" className="text-brand-700 font-medium hover:underline">
            Sign in
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}
