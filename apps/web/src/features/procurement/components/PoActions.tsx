import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Ban, CheckCircle2, ChevronDown, FileEdit, Lock, PackageCheck, Pencil, Scissors, Send, XCircle } from 'lucide-react';
import { Button, Dropdown, ReasonDialog, type MenuItem } from '../../../components/ui';
import { toApiError } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { usePoCommand } from '../hooks';
import { PO_TRANSITIONS, type PoCommand, type PurchaseOrder } from '../types';
import { ReviseModal } from './ReviseModal';

type Dialog = 'approve' | 'reject' | 'cancel' | 'short-close' | 'close' | 'revise' | null;

const PERMISSION: Record<PoCommand, string> = {
  submit: 'purchase.create',
  approve: 'purchase.approve',
  reject: 'purchase.approve',
  issue: 'purchase.issue',
  revise: 'purchase.edit',
  cancel: 'purchase.cancel',
  'short-close': 'purchase.approve',
  close: 'purchase.edit',
};

const SUCCESS: Record<Exclude<PoCommand, 'revise'>, string> = {
  submit: 'submitted for approval',
  approve: 'approved',
  reject: 'rejected and returned to draft',
  issue: 'issued to the supplier',
  cancel: 'cancelled',
  'short-close': 'short-closed',
  close: 'closed',
};

/** Explains the business-rule codes the approval flow can return. */
function explain(code: string, message: string): string {
  switch (code) {
    case 'PO_SELF_APPROVAL':
      return `${message} Ask another approver to review this order.`;
    case 'PO_APPROVAL_LIMIT':
      return `${message} This order is above your approval limit.`;
    case 'PO_HAS_RECEIVES':
      return `${message}`;
    case 'PO_INVALID_TRANSITION':
      return `${message} Reload the page to see the current status.`;
    default:
      return message;
  }
}

/** Status- and permission-gated transition buttons for the PO detail header. */
export function PoActions({ po }: { po: PurchaseOrder }) {
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const command = usePoCommand();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);

  const can = (c: PoCommand) => (PO_TRANSITIONS[c] as readonly string[]).includes(po.status) && hasPermission(PERMISSION[c]);
  const canReceive = ['ISSUED', 'PARTIALLY_RECEIVED'].includes(po.status) && hasPermission('grn.create');
  const canEditDraft = po.status === 'DRAFT' && hasPermission(['purchase.edit', 'purchase.create']);

  const run = async (c: Exclude<PoCommand, 'revise'>, body?: { reason?: string; comment?: string }) => {
    setDialogError(null);
    try {
      const saved = await command.mutateAsync({ id: po.id, command: c, body });
      toast.success(`${saved.number} ${SUCCESS[c]}`);
      setDialog(null);
    } catch (err) {
      const e = toApiError(err);
      const reasonError = e.details.find((d) => d.path === 'reason')?.message ?? null;
      if (dialog && reasonError) setDialogError(reasonError);
      toast.error(explain(e.code, e.message));
    }
  };

  const secondary: MenuItem[] = [
    { key: 'edit', label: 'Edit draft', icon: Pencil, onSelect: () => navigate(`/purchases/orders/${po.id}/edit`), hidden: !canEditDraft },
    { key: 'revise', label: 'Revise order', icon: FileEdit, onSelect: () => setDialog('revise'), hidden: !can('revise') },
    { key: 'short-close', label: 'Short-close', icon: Scissors, onSelect: () => setDialog('short-close'), hidden: !can('short-close') },
    { key: 'close', label: 'Close order', icon: Lock, onSelect: () => setDialog('close'), hidden: !can('close') },
    { key: 'cancel', label: 'Cancel order', icon: Ban, tone: 'danger', onSelect: () => setDialog('cancel'), hidden: !can('cancel') },
  ];

  return (
    <>
      {can('submit') && (
        <Button icon={Send} loading={command.isPending} onClick={() => void run('submit')}>
          Submit for approval
        </Button>
      )}
      {can('reject') && (
        <Button variant="dangerOutline" icon={XCircle} onClick={() => setDialog('reject')} disabled={command.isPending}>
          Reject
        </Button>
      )}
      {can('approve') && (
        <Button icon={CheckCircle2} onClick={() => setDialog('approve')} disabled={command.isPending}>
          Approve
        </Button>
      )}
      {can('issue') && (
        <Button icon={Send} loading={command.isPending} onClick={() => void run('issue')}>
          Issue to supplier
        </Button>
      )}
      {canReceive && (
        <Button variant={po.status === 'ISSUED' ? 'primary' : 'secondary'} icon={PackageCheck} onClick={() => navigate(`/purchases/receipts/new?po=${po.id}`)}>
          Receive goods
        </Button>
      )}
      <Dropdown
        items={secondary}
        trigger={({ toggle }) => (
          <Button variant="secondary" iconRight={ChevronDown} onClick={toggle}>
            More
          </Button>
        )}
      />

      <ReasonDialog
        open={dialog === 'approve'}
        onClose={() => setDialog(null)}
        title={`Approve ${po.number}`}
        message="The order moves to Approved and can then be issued to the supplier."
        confirmLabel="Approve"
        tone="primary"
        reasonRequired={false}
        reasonLabel="Comment (optional)"
        loading={command.isPending}
        error={dialogError}
        onConfirm={({ reason }) => void run('approve', reason ? { comment: reason } : {})}
      />
      <ReasonDialog open={dialog === 'reject'} onClose={() => setDialog(null)} title={`Reject ${po.number}`} message="The order returns to Draft with your reason so the buyer can fix it." confirmLabel="Reject" loading={command.isPending} error={dialogError} onConfirm={({ reason }) => void run('reject', { reason })} />
      <ReasonDialog open={dialog === 'cancel'} onClose={() => setDialog(null)} title={`Cancel ${po.number}`} message="Cancelled orders cannot be reopened. Orders with live goods receipts cannot be cancelled; short-close them instead." confirmLabel="Cancel order" reasonRequired={false} loading={command.isPending} error={dialogError} onConfirm={({ reason }) => void run('cancel', reason ? { reason } : {})} />
      <ReasonDialog open={dialog === 'short-close'} onClose={() => setDialog(null)} title={`Short-close ${po.number}`} message="The quantities still open on every line are cancelled and the order is closed." confirmLabel="Short-close" loading={command.isPending} error={dialogError} onConfirm={({ reason }) => void run('short-close', { reason })} />
      <ReasonDialog open={dialog === 'close'} onClose={() => setDialog(null)} title={`Close ${po.number}`} message="Marks the fully received order as closed. If QC is required, every receipt must have completed QC." confirmLabel="Close order" tone="primary" reasonRequired={false} loading={command.isPending} error={dialogError} onConfirm={({ reason }) => void run('close', reason ? { reason } : {})} />
      <ReviseModal po={po} open={dialog === 'revise'} onClose={() => setDialog(null)} onRevised={() => undefined} />
    </>
  );
}
