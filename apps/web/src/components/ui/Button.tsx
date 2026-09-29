import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { Loader2, type LucideIcon } from 'lucide-react';
import { cn } from '../../lib/utils';

const VARIANTS = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800 shadow-sm border border-transparent',
  secondary: 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 active:bg-slate-100',
  ghost: 'bg-transparent text-slate-600 hover:bg-slate-100 active:bg-slate-200 border border-transparent',
  danger: 'bg-red-600 text-white hover:bg-red-700 active:bg-red-800 shadow-sm border border-transparent',
  dangerOutline: 'bg-white text-red-600 border border-red-300 hover:bg-red-50',
  subtle: 'bg-brand-50 text-brand-700 hover:bg-brand-100 border border-transparent',
} as const;

const SIZES = {
  xs: 'text-xs px-2 h-7 gap-1 rounded-md',
  sm: 'text-xs px-3 h-8 gap-1.5 rounded-lg',
  md: 'text-sm px-4 h-9 gap-2 rounded-lg',
  lg: 'text-sm px-5 h-11 gap-2 rounded-xl',
} as const;

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof VARIANTS;
  size?: keyof typeof SIZES;
  icon?: LucideIcon;
  iconRight?: LucideIcon;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', icon: Icon, iconRight: IconRight, loading, disabled, className, children, type, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center font-medium whitespace-nowrap transition-colors select-none',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    >
      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : Icon ? <Icon className="w-4 h-4 shrink-0" /> : null}
      {children}
      {IconRight && !loading ? <IconRight className="w-4 h-4 shrink-0" /> : null}
    </button>
  );
});

export function IconButton({
  icon: Icon,
  label,
  className,
  size = 'md',
  ...props
}: Omit<ButtonProps, 'children' | 'icon'> & { icon: LucideIcon; label: string }) {
  const dims = size === 'xs' ? 'h-7 w-7' : size === 'sm' ? 'h-8 w-8' : 'h-9 w-9';
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed',
        dims,
        className,
      )}
      {...props}
    >
      <Icon className="w-4 h-4" />
    </button>
  );
}
