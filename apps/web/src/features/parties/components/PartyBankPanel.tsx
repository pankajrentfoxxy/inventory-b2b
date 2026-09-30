import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Eye, EyeOff, Landmark, Star } from 'lucide-react';
import { BANK_ACCOUNT_TYPE_LABELS, type BankAccountType } from '@b2b/shared';
import { Badge, Button, EmptyState } from '../../../components/ui';
import { toApiError } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { partyApi } from '../api';
import { PARTY_META, type PartyBankAccount, type PartyType } from '../types';

const REVEAL_MS = 30_000;

function BankRow({ type, partyId, account }: { type: PartyType; partyId: string; account: PartyBankAccount }) {
  const { hasPermission } = useAuth();
  const canReveal = hasPermission(PARTY_META[type].manage);
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
      // Auto-mask again so the number does not linger on screen; the reveal itself is audited.
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
        <span className="text-xs text-slate-500">{BANK_ACCOUNT_TYPE_LABELS[account.accountType as BankAccountType] ?? account.accountType}</span>
      </div>
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 mt-1.5 text-sm">
        <div>
          <dt className="text-xs text-slate-500">Account holder</dt>
          <dd className="text-slate-800">{account.accountHolderName}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Account number</dt>
          <dd className="flex items-center gap-2">
            <span className="font-mono tabular text-slate-800">{revealed ?? account.accountNumberMasked}</span>
            {canReveal && (
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
export function PartyBankPanel({ type, partyId, accounts }: { type: PartyType; partyId: string; accounts: PartyBankAccount[] }) {
  if (accounts.length === 0) return <EmptyState icon={Landmark} title="No bank accounts" hint={`Add a bank account from the Edit screen to record payments for this ${PARTY_META[type].singular.toLowerCase()}.`} className="py-8" />;
  return (
    <ul className="divide-y divide-slate-100">
      {accounts.map((a) => (
        <BankRow key={a.id} type={type} partyId={partyId} account={a} />
      ))}
    </ul>
  );
}
