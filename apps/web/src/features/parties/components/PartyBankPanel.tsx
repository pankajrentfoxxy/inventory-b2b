import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Eye, EyeOff, Landmark, Star, Trash2 } from 'lucide-react';
import { BANK_ACCOUNT_TYPE_LABELS } from '@b2b/shared';
import { Badge, Button, EmptyState, IconButton } from '../../../components/ui';
import { toApiError } from '../../../lib/api';
import { partyApi } from '../api';
import type { PartyBankAccount, PartyType } from '../types';

const REVEAL_MS = 30_000;

function BankRow({ type, partyId, account, canManage, onRemove }: { type: PartyType; partyId: string; account: PartyBankAccount; canManage: boolean; onRemove?: (a: PartyBankAccount) => void }) {
  const [revealed, setRevealed] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const toggle = async () => {
    if (revealed) {
      setRevealed(null);
      if (timer.current) clearTimeout(timer.current);
      return;
    }
    setLoading(true);
    try {
      const res = await partyApi(type).revealBankAccount(partyId, account.id);
      setRevealed(res.accountNumber);
      // Auto-mask so the number does not linger on screen; the reveal itself is audited server-side.
      timer.current = setTimeout(() => setRevealed(null), REVEAL_MS);
    } catch (err) {
      toast.error(toApiError(err).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <li className="py-3">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-medium text-slate-900">{account.bankName}</span>
        {account.isPrimary && (
          <Badge tone="blue">
            <Star className="w-3 h-3" /> Primary
          </Badge>
        )}
        <span className="text-xs text-slate-500">{BANK_ACCOUNT_TYPE_LABELS[account.accountType] ?? account.accountType}</span>
        {canManage && onRemove && <IconButton icon={Trash2} label="Remove bank account" size="sm" className="ml-auto" onClick={() => onRemove(account)} />}
      </div>
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 mt-1.5 text-sm">
        <div>
          <dt className="text-xs text-slate-500">Account holder</dt>
          <dd className="text-slate-800">{account.accountHolder}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Account number</dt>
          <dd className="flex items-center gap-2">
            <span className="font-mono tabular text-slate-800">{revealed ?? account.accountNumber}</span>
            {canManage && (
              <Button size="xs" variant="ghost" icon={revealed ? EyeOff : Eye} loading={loading} onClick={() => void toggle()}>
                {revealed ? 'Hide' : 'Reveal'}
              </Button>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">IFSC</dt>
          <dd className="font-mono tabular text-slate-800">{account.ifsc}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Branch</dt>
          <dd className="text-slate-800">{account.branch ?? <span className="text-slate-400">-</span>}</dd>
        </div>
      </dl>
    </li>
  );
}

/** Masked bank accounts; "Reveal" (manage permission) fetches the full number and re-masks after 30 s. */
export function PartyBankPanel({ type, partyId, accounts, canManage, onRemove, onAdd }: { type: PartyType; partyId: string; accounts: PartyBankAccount[]; canManage: boolean; onRemove?: (a: PartyBankAccount) => void; onAdd?: () => void }) {
  if (accounts.length === 0) return <EmptyState icon={Landmark} title="No bank accounts" hint="Bank accounts are needed to record payments. Account numbers are encrypted at rest." className="py-8" action={canManage && onAdd ? <Button size="sm" variant="secondary" onClick={onAdd}>Add bank account</Button> : undefined} />;
  return (
    <ul className="divide-y divide-slate-100">
      {accounts.map((a) => (
        <BankRow key={a.id} type={type} partyId={partyId} account={a} canManage={canManage} onRemove={onRemove} />
      ))}
    </ul>
  );
}
