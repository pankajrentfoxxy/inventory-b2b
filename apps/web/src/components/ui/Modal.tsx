import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X, AlertTriangle } from 'lucide-react';
import { Button } from './Button';
import { cn } from '../../lib/utils';

export function Modal({ open, onClose, title, description, children, footer, size = 'md' }: { open: boolean; onClose: () => void; title: ReactNode; description?: ReactNode; children?: ReactNode; footer?: ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;
  const width = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' }[size];

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[1px]" onClick={onClose} />
      <div className={cn('relative w-full bg-white rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[92vh] flex flex-col', width)}>
        <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-slate-100">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-slate-900">{title}</h2>
            {description && <p className="text-xs text-slate-500 mt-0.5">{description}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-700 rounded-md p-1">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="px-5 py-4 overflow-y-auto">{children}</div>
        {footer && <div className="px-5 py-3 border-t border-slate-100 bg-slate-50/60 rounded-b-2xl flex items-center justify-end gap-2">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmDialog({ open, onClose, onConfirm, title, message, confirmLabel = 'Confirm', tone = 'danger', loading }: { open: boolean; onClose: () => void; onConfirm: () => void; title: string; message: ReactNode; confirmLabel?: string; tone?: 'danger' | 'primary'; loading?: boolean }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex gap-3">
        <span className={cn('shrink-0 w-9 h-9 rounded-full flex items-center justify-center', tone === 'danger' ? 'bg-red-50 text-red-600' : 'bg-brand-50 text-brand-600')}>
          <AlertTriangle className="w-5 h-5" />
        </span>
        <div className="text-sm text-slate-600 pt-1.5">{message}</div>
      </div>
    </Modal>
  );
}
