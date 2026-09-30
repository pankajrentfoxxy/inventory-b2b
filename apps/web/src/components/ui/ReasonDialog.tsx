import { useEffect, useState, type ReactNode } from 'react';
import { Button } from './Button';
import { Field, Input, Textarea } from './Form';
import { Modal } from './Modal';

/**
 * Confirmation that collects a reason (and optionally a confirmation code) before a state change:
 * reject, cancel, suspend, block, short-close... Reason is required by default because every
 * such transition is audited with it.
 */
export function ReasonDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirm',
  tone = 'danger',
  loading,
  reasonRequired = true,
  reasonLabel = 'Reason',
  confirmCode,
  error,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (input: { reason: string; confirmCode?: string }) => void;
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  tone?: 'danger' | 'primary';
  loading?: boolean;
  reasonRequired?: boolean;
  reasonLabel?: string;
  /** When set, the user must type this exact text to enable the button. */
  confirmCode?: string;
  error?: string | null;
}) {
  const [reason, setReason] = useState('');
  const [code, setCode] = useState('');
  useEffect(() => {
    if (open) {
      setReason('');
      setCode('');
    }
  }, [open]);
  const reasonOk = !reasonRequired || reason.trim().length >= 3;
  const codeOk = !confirmCode || code.trim() === confirmCode;
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
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} onClick={() => onConfirm({ reason: reason.trim(), confirmCode: confirmCode ? code.trim() : undefined })} loading={loading} disabled={!reasonOk || !codeOk}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {message && <div className="text-sm text-slate-600">{message}</div>}
        <Field label={reasonLabel} required={reasonRequired} error={error ?? undefined}>
          <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder={reasonRequired ? 'At least 3 characters; recorded in the audit trail' : 'Optional'} autoFocus />
        </Field>
        {confirmCode && (
          <Field label={`Type ${confirmCode} to confirm`} required>
            <Input value={code} onChange={(e) => setCode(e.target.value)} className="font-mono" />
          </Field>
        )}
      </div>
    </Modal>
  );
}
