# Phase 10 — Payments (svc-payment)

> Prerequisite: Phase 9 COMPLETE. Payment owns money movements and their allocation to documents. It never touches inventory, and never edits an invoice — billing updates outstanding balances by consuming allocation events.

---

## 10.1 Goal & scope
- Customer receipts (receivables) and supplier payments (payables)
- Modes: bank transfer (NEFT/RTGS/IMPS/UPI), cheque (with clearing lifecycle), cash, online gateway (Razorpay adapter first), adjustments (credit note / debit note set-off)
- Partial, full, advance (unallocated) payments; allocation across multiple documents; unallocation/reallocation
- Refunds (customer) and supplier refunds
- Gateway: payment links, order creation, **signed webhooks**, idempotent capture
- Bank reconciliation: statement import (CSV/MT940), auto-match rules, manual match
- Payment audit; customer/supplier statements; ageing data for reports
- Credit-limit enforcement hook for sales (turns Phase 6 warn into block, per setting)

Out of scope: payouts automation to suppliers via bank APIs (adapter later), escrow (design hook only — `PaymentProvider` interface supports it), accounting GL.

---

## 10.2 Step 1 — Understand
- [ ] Current collection practice: advance vs credit terms; typical instruments
- [ ] Gateway accounts per tenant (each tenant brings its own keys) vs platform-collected — **default: each tenant's own gateway credentials**; platform never holds tenant money
- [ ] Bank statement formats available

---

## 10.3 Step 2 — Business flow

```text
Receivable:
  Invoice ISSUED ─▶ (payment link | manual entry) ─▶ Payment RECORDED ──allocate──▶ Allocation(s)
       │                                                  │                        └▶ billing: amount_settled ↑ → PARTIALLY_PAID / PAID
       │                                                  └─ remainder = unallocated advance (usable later)
  Cheque:   RECEIVED ─deposit─▶ DEPOSITED ─clear─▶ CLEARED (allocations become effective)
                                          └─bounce─▶ BOUNCED (allocations reversed; bounce charge optional)
  Gateway:  CREATED (order) ─webhook captured─▶ CAPTURED ─▶ SETTLED (from settlement report)
                                └─webhook failed─▶ FAILED
  Refund:   credit note / advance ─▶ REFUND_INITIATED ─▶ REFUNDED | FAILED

Payable:
  Supplier bill POSTED ─▶ Supplier payment RECORDED (bank/cheque) ─allocate─▶ bill amount_settled ↑
  Debit note ISSUED ─▶ set-off allocation against bills

Reconciliation:
  Bank statement import ─▶ lines UNMATCHED ─auto-rules/ manual─▶ MATCHED to payment(s) ─▶ payment RECONCILED
```

### Payment state machine
| From | Command | To | Permission |
|---|---|---|---|
| — | record | RECORDED (bank/cash) / RECEIVED (cheque) / CREATED (gateway) | payment.create |
| RECEIVED | deposit | DEPOSITED | payment.create |
| DEPOSITED | clear / bounce | CLEARED / BOUNCED | payment.reconcile |
| CREATED | (webhook) | CAPTURED / FAILED | system |
| RECORDED/CLEARED/CAPTURED | void | VOIDED | payment.void (reason; reverses allocations) |
| any settled | reconcile | RECONCILED (flag) | payment.reconcile |

### Allocation rules
- `SUM(allocations of a payment) ≤ payment.amount` (net of refunds)
- `SUM(allocations to a document) ≤ document.grand_total` — enforced by billing on the event **and** pre-checked by payment via `GET /internal/v1/outstanding`; a rejected allocation (race) is reversed by a compensating event
- Cheque allocations are *pending* until CLEARED (document shows "payment in clearing")
- Allocations are immutable; changes = reversal + new allocation (full audit)

---

## 10.4 Step 3 — Architecture
| Concern | Owner |
|---|---|
| Payments, allocations, refunds, gateway orders, webhook log, bank statements, matches | svc-payment |
| Document outstanding | svc-billing (consumes allocation events; publishes `billing.allocation.rejected` if it would overpay) |
| Provider integration | `PaymentProvider` adapters: `RazorpayProvider`, `ManualBankProvider`, `ChequeProvider`, future `EscrowProvider` |
| Tenant provider credentials | secrets manager, referenced by `provider_accounts.secret_ref` |

Webhook handling:
```text
POST /webhooks/payments/{provider}/{tenantAccountId}
  1. verify HMAC signature with that tenant account's webhook secret — reject 401 otherwise
  2. INSERT gateway_webhook_events (provider, external_event_id) ON CONFLICT DO NOTHING → duplicate → 200
  3. in same tx: transition payment; outbox payment.payment.captured.v1
  4. respond 200 fast (< 2 s); heavy work async
  Never trust amounts from the browser redirect; only the verified webhook / provider fetch API is authoritative.
```

---

## 10.5 Step 4 — Database (`payment_db`)
```sql
CREATE TABLE provider_accounts (id uuid PRIMARY KEY, tenant_id uuid NOT NULL,
  provider text NOT NULL, display_name text NOT NULL, secret_ref text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE', UNIQUE (tenant_id, provider, display_name));

CREATE TABLE payments (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, number text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('INBOUND','OUTBOUND')),
  party_id uuid NOT NULL, party_snapshot jsonb NOT NULL,
  mode text NOT NULL CHECK (mode IN ('BANK_TRANSFER','UPI','CHEQUE','CASH','GATEWAY','ADJUSTMENT')),
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  currency char(3) NOT NULL DEFAULT 'INR',
  payment_date date NOT NULL,
  reference_no text,                          -- UTR / cheque no / gateway payment id
  cheque_details jsonb,                       -- bank, branch, date
  provider_account_id uuid REFERENCES provider_accounts(id),
  external_order_id text, external_payment_id text,
  status text NOT NULL CHECK (status IN ('CREATED','RECORDED','RECEIVED','DEPOSITED','CLEARED','CAPTURED',
          'SETTLED','FAILED','BOUNCED','VOIDED')),
  reconciled boolean NOT NULL DEFAULT false,
  allocated_amount numeric(18,2) NOT NULL DEFAULT 0,
  refunded_amount numeric(18,2) NOT NULL DEFAULT 0,
  created_by uuid, version int NOT NULL DEFAULT 0,
  UNIQUE (tenant_id, number),
  CHECK (allocated_amount + refunded_amount <= amount)
);
CREATE UNIQUE INDEX pay_ext_uq ON payments (tenant_id, provider_account_id, external_payment_id)
  WHERE external_payment_id IS NOT NULL;
CREATE UNIQUE INDEX pay_ref_uq ON payments (tenant_id, party_id, mode, reference_no)
  WHERE reference_no IS NOT NULL AND status NOT IN ('VOIDED','FAILED');   -- same UTR/cheque twice blocked

CREATE TABLE allocations (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL,
  payment_id uuid NOT NULL REFERENCES payments(id),
  document_type text NOT NULL, document_id uuid NOT NULL, document_number text NOT NULL,
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  status text NOT NULL CHECK (status IN ('PENDING','EFFECTIVE','REVERSED','REJECTED')),
  reversal_of uuid REFERENCES allocations(id), reason text,
  created_by uuid, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX alloc_doc ON allocations (tenant_id, document_type, document_id);

CREATE TABLE refunds (id uuid PRIMARY KEY, tenant_id uuid NOT NULL, payment_id uuid REFERENCES payments(id),
  credit_note_id uuid, amount numeric(18,2) NOT NULL CHECK (amount > 0),
  status text NOT NULL CHECK (status IN ('INITIATED','REFUNDED','FAILED')),
  external_refund_id text, reason text NOT NULL, created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE gateway_webhook_events (id uuid PRIMARY KEY, tenant_id uuid NOT NULL,
  provider text NOT NULL, external_event_id text NOT NULL, event_type text NOT NULL,
  payload jsonb NOT NULL, signature_valid boolean NOT NULL, processed_at timestamptz,
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, external_event_id));

CREATE TABLE bank_accounts (id uuid PRIMARY KEY, tenant_id uuid NOT NULL, name text NOT NULL,
  account_last4 char(4) NOT NULL, ifsc text, status text NOT NULL DEFAULT 'ACTIVE');
-- full account numbers are NOT stored in the app DB; last 4 + IFSC only

CREATE TABLE bank_statement_lines (id uuid PRIMARY KEY, tenant_id uuid NOT NULL,
  bank_account_id uuid NOT NULL REFERENCES bank_accounts(id), import_batch_id uuid NOT NULL,
  txn_date date NOT NULL, value_date date, description text, reference text,
  debit numeric(18,2), credit numeric(18,2), balance numeric(18,2),
  line_hash char(64) NOT NULL,                  -- dedupe re-imports
  match_status text NOT NULL DEFAULT 'UNMATCHED' CHECK (match_status IN ('UNMATCHED','MATCHED','IGNORED')),
  UNIQUE (tenant_id, bank_account_id, line_hash));

CREATE TABLE reconciliation_matches (id uuid PRIMARY KEY, tenant_id uuid NOT NULL,
  statement_line_id uuid NOT NULL REFERENCES bank_statement_lines(id), payment_id uuid NOT NULL REFERENCES payments(id),
  amount numeric(18,2) NOT NULL, matched_by text NOT NULL CHECK (matched_by IN ('AUTO','USER')), user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now());
```

Allocation concurrency: allocating locks the payment row `FOR UPDATE`, checks `allocated_amount + new ≤ amount`, inserts allocation, updates `allocated_amount` — one transaction. Billing's side check covers the document total.

---

## 10.6 Step 5 — API (`/api/v1/payments`)
| Endpoint | Permission |
|---|---|
| `GET /`, `GET /{id}` | payment.view |
| `POST /` (record; optional `allocations[]`) — Idempotency-Key mandatory | payment.create |
| `POST /{id}/allocate` `{allocations[]}` / `POST /allocations/{id}/reverse` | payment.create |
| `POST /{id}/deposit|clear|bounce|void` | payment.create / payment.reconcile / payment.void |
| `POST /links` `{invoiceIds[], amount?}` → gateway payment link | payment.create |
| `POST /{id}/refunds` / `POST /credit-notes/{id}/refund` | payment.refund |
| `GET /parties/{id}/statement?from=&to=` / `GET /parties/{id}/unallocated` | payment.view |
| `POST /bank-statements/import` (async) / `GET /bank-statements/lines?status=` / `POST /bank-statements/lines/{id}/match` | payment.reconcile |
| `POST /webhooks/payments/{provider}/{accountId}` | signature |
| `GET /internal/v1/parties/{id}/exposure` (outstanding + open SO value) | sales credit check |

Error codes: `PAY_OVER_ALLOCATION`, `PAY_DOC_OVERPAID`, `PAY_DUPLICATE_REFERENCE`, `PAY_INVALID_TRANSITION`, `PAY_WEBHOOK_SIGNATURE_INVALID`, `PAY_REFUND_EXCEEDS_AVAILABLE`, `PAY_PROVIDER_ERROR` (retryable).

---

## 10.7 Step 6 — Events
| Event | Consumers |
|---|---|
| `payment.payment.recorded|captured|cleared|bounced|voided.v1` | notification (receipts to customer), reporting, audit |
| `payment.allocation.created|reversed.v1` `{allocationId, documentType, documentId, amount, effective}` | **billing** (amount_settled; idempotent by allocationId), reporting |
| `billing.allocation.rejected.v1` | payment (mark REJECTED, release amount, alert) |
| `payment.refund.completed.v1` | billing (CN refunded flag), returns (RMA closed), notification |
| consumes `billing.invoice.issued`, `billing.supplier_bill.posted`, `billing.credit_note.issued` | payment keeps a local outstanding cache for UI suggestions |

---

## 10.8 Step 7 — Frontend
- **Receive payment:** pick customer → shows open invoices oldest first with balance → enter amount/mode/reference → auto-allocate FIFO (editable) → save; unallocated remainder shown as advance.
- **Pay supplier:** mirror flow for bills; debit-note set-off.
- **Cheques:** register with status board (Received → Deposited → Cleared/Bounced).
- **Payment links:** from invoice detail "Send payment link" (SMS/email via notification).
- **Reconciliation:** statement import, split view (statement lines ↔ suggested payments), confidence score, bulk accept.
- **Party statement:** ledger view with opening balance, invoices, payments, CN/DN, running balance; PDF.

---

## 10.9 Step 8 — Implementation order
1. Schema, record/allocate/void with billing event integration
2. Cheque lifecycle; bounce reversal
3. Razorpay adapter (sandbox): orders, links, signed webhooks, refunds, settlement fetch
4. Bank statement import + auto-match rules (amount + reference/UTR + date window)
5. Credit-limit hook for sales
6. Frontend

## 10.10 Step 9 — Tests
- Partial & full payment → invoice status PARTIALLY_PAID/PAID; allocation to 3 invoices in one payment
- Over-allocation (concurrent) → exactly one succeeds; document overpay via race → billing rejects → payment reverses
- Webhook: invalid signature 401; replay 5× → one capture; out-of-order events (captured before created) handled
- Duplicate UTR / cheque no. → 422
- Cheque bounce reverses allocations and reopens invoices
- Refund ≤ available; refund via gateway idempotent
- Reconciliation re-import dedupes; auto-match precision on fixture statements
- Tenant isolation incl. webhook routed to wrong tenant account id → rejected
- Void requires permission & reason; audit captures old/new

## 10.11 Step 10 — Verification
- [ ] `SUM(effective allocations per document)` = billing `amount_settled` for every document (reconciliation job)
- [ ] Party statement closing balance = billing outstanding − unallocated advances
- [ ] Payment audit complete

## 10.12 Exit gate
- [ ] Collection, partial/full payment, allocation, status, reconciliation, audit all verified
- [ ] Sales credit-limit enforcement behaves per tenant setting
- [ ] **Approval recorded to start Phase 11**
