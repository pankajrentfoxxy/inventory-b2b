# Rentfoxxy B2B Inventory Platform - Business Rules

Version 1.1 - 30 September 2026 (laptop configurations and laptop QC)

The platform is a **multi-tenant laptop inventory system**. Every item bought, received, inspected
and stocked is a laptop configuration identified by eight specifications. The end-to-end flow is:

```
Laptop specification masters -> Laptop configuration (SKU) -> Purchase order -> Goods receipt (GRN)
  -> QC ticket (created automatically) -> QC per laptop -> PASS: Available inventory
                                                        -> FAIL: Rejected (never available)
                                                        -> HOLD: stays in QC hold until resolved
```

This document describes what the platform does and the business rules it enforces, in the order a
business would meet them: onboarding, people and access, master data, suppliers and customers,
stock, purchasing, quality control, and the controls that run across everything. It is written for
business owners and operations teams; no technical background is needed.

Rules marked **enforced by the system** cannot be bypassed from the screens. Where a rule can be
tuned per organisation, the setting is named.

---

## 1. Who uses the platform

| Role group | Who | What they can do |
|---|---|---|
| Platform team (Rentfoxxy) | Platform administrators, reviewers, support | Review supplier applications, approve and activate organisations, suspend or deactivate them, manage platform staff, read the platform-wide audit trail. They never see an organisation's business data. |
| Organisation members | The owner and the staff of each supplier organisation | Run the business: masters, suppliers, customers, stock, purchasing, quality control. What each member sees and does is decided by their roles and, where relevant, their warehouse scope. |

Every organisation's data is fully separated. A member of one organisation can never see, search
or reference another organisation's records, and the system answers "not found" rather than
confirming that such a record exists. **Enforced by the system.**

---

## 2. Onboarding an organisation

### 2.1 Two ways in

1. **Public application.** A prospective supplier fills in the application form (legal name, display
   name, GSTIN and PAN if registered, registered address, owner name, e-mail and phone). When a
   valid GSTIN is entered, the legal name, trade name, PAN and registered address are fetched from the
   GST portal and filled in automatically; the applicant reviews and can edit them. The applicant
   receives an acknowledgement; the platform team reviews it.
2. **Created by the platform team.** Platform staff can create an organisation directly from the
   console, for example after an offline agreement.

### 2.2 Organisation lifecycle

| Status | Meaning | Who moves it on |
|---|---|---|
| Pending | Application received, under review | Platform reviewer approves (with a note) or rejects (reason required) |
| Approved | Accepted; not yet open for use | Platform administrator activates |
| Active | Open for business; the owner's invitation is sent on activation | Platform administrator may suspend (reason required) |
| Suspended | Members cannot sign in; data is preserved | Platform administrator reactivates (reason) or deactivates |
| Deactivated | Closed permanently; data retained for audit | Final |
| Rejected | Application declined; the applicant is told the reason | Final |

Rules, all **enforced by the system**:

- **Four-eyes approval.** The person who created or submitted an application cannot be the one
  who approves it.
- **Typed confirmation for deactivation.** Deactivating an organisation requires a reason and the
  organisation's code typed back as confirmation.
- **Every transition is recorded** with who did it, when, and the reason or note.
- **Platform staff must use two-factor authentication** (an authenticator app). Enrolment happens on
  first sign-in.
- **A suspended organisation is locked out immediately**, including sessions that were already
  signed in.

### 2.3 The owner

On activation the owner named in the application receives an e-mail invitation. Accepting it sets
their password and makes them the organisation's first member with the **Owner** role. Invitations
expire after 72 hours and can be re-sent from the console while the organisation is active.

---

## 3. Sign-in and sessions

- Sign-in is by e-mail and password. Repeated failures lock the account for a cooling-off period.
- Platform staff must also enter a two-factor code.
- A person who belongs to several organisations chooses which one to work in after signing in and
  can switch from the top bar at any time. Permissions are re-evaluated for the chosen organisation.
- Sessions are kept alive silently while the browser is open; a page reload does not sign the user
  out. Signing out ends the session everywhere the same token was used.
- "Forgot password" sends a one-hour reset link. Old passwords remain valid until the reset is
  completed.
- **Permissions take effect immediately.** When a member's roles or warehouse scope change, or a
  role's permissions are edited, every affected member's next request is re-checked against the
  new permissions. Suspended or removed members are cut off at once. **Enforced by the system.**

---

## 4. People, roles and permissions

### 4.1 Roles

Each organisation starts with a set of **system roles** that cannot be edited or deleted:

| Role | Intended for |
|---|---|
| Owner | The business owner; full access; the only role that can hand over ownership |
| Admin | Full access except ownership transfer: members, roles, masters, settings |
| Purchase Manager | Runs the purchasing cycle: suppliers, purchase orders (including approval and issuing), goods receipts; reads stock, QC and masters |
| Purchase Executive | Creates and edits purchase orders and receives goods; cannot approve, issue or cancel |
| Inventory Manager | Owns stock: adjustments and their approval, opening stock, bin moves, warehouses and bins, transfers; reads receipts and QC |
| QC Manager | Inspects and decides QC lots, maintains checklists; reads receipts and stock |
| Sales Manager | Customers and sales orders, stock reservations (sales arrive in a later phase) |
| Dispatch Manager | Packing, dispatch and delivery (arrives in a later phase) |
| Finance | Bills, payments and reports (arrive in a later phase); reads purchasing, sales, suppliers and customers |
| Viewer | Read-only across the organisation |

Administrators can also create **custom roles**, either from scratch or by cloning an existing one,
and choose their permissions from the permission catalogue. Permissions are grouped by module
(masters, parties, inventory, purchasing, QC, members and roles, settings, audit). Sensitive
permissions (approvals, bank-detail reveal, role management) are marked as such in the catalogue.

### 4.2 Anti-escalation rules (enforced by the system)

1. **You can only grant what you hold.** A member cannot give a role, or add a permission to a
   role, that includes permissions they do not have themselves.
2. **Only downwards.** Roles have a rank. A member can only assign roles ranked below their own.
   Owners may manage other owners.
3. **The last owner is protected.** The last active owner cannot be removed, suspended or
   demoted. Ownership must be transferred first.
4. **Platform permissions never enter an organisation.** Platform-team permissions cannot be added
   to an organisation role.
5. **No self-service.** A member cannot change their own roles or scope.

### 4.3 Members and invitations

- New members are invited by e-mail with their roles and, optionally, a warehouse scope. Invitations
  expire in 72 hours and can be re-sent or revoked. Accepting one creates the member's account.
- Members can be **suspended** (temporarily blocked, reason required), **reactivated**, or
  **removed** (reason required). Removed members' history stays in the audit trail.
- **Warehouse scope.** A member can be limited to specific warehouses. A scoped member sees stock,
  receipts and QC lots only for those warehouses and cannot receive goods or move stock elsewhere.
  Unscoped members see all warehouses. **Enforced by the system**, not only hidden on screen.

---

## 5. Master data

Master data is set up once per organisation and referenced everywhere else. Defaults are seeded when
the organisation is activated (standard units, GST slabs, a first warehouse, common payment terms,
document numbering, and common laptop specification values).

### 5.1 Laptop specification masters

A laptop is described by exactly eight specifications. Each one is chosen from its own master list,
so values are consistent everywhere and never typed free-hand on a document.

| Master | Examples | Notes |
|---|---|---|
| Brand | Dell, HP, Lenovo | Seeded with common brands |
| Model | Latitude 5440, ProBook 440 G8 | **Belongs to a brand**; the same model name may exist under two brands |
| Generation | 11th Gen, 13th Gen | Seeded 8th to 14th Gen |
| Processor | Intel Core i5-1345U | Added by the organisation |
| RAM | 8 GB, 16 GB | Seeded 4 to 64 GB |
| SSD | 256 GB, 512 GB, 1 TB | Seeded 128 GB to 2 TB |
| Graphics / GPU | Intel Iris Xe, NVIDIA RTX A500 | Added by the organisation |
| Screen size | 14", 15.6" | Seeded 13.3" to 16" |

Rules, all **enforced by the system**: a value is unique within its master (ignoring letter case;
models per brand); each value has a short **code** used to build SKUs (for example I5 for "Intel
Core i5-1345U"; derived from the name when not given); values can be deactivated but not deleted,
and inactive values cannot be used on new configurations.

### 5.2 Laptop configurations (SKUs)

A laptop configuration is one purchasable variant: one value from each of the eight masters.

| Rule | Detail |
|---|---|
| All eight specifications | A configuration must have exactly one Brand, Model, Generation, Processor, RAM, SSD, Graphics and Screen size. The model must belong to the chosen brand. |
| Generated SKU | The system builds the SKU from Brand-Model-Processor-RAM-SSD codes, for example **DELL-LAT5440-I5-16-512**. If that SKU is taken (two configurations that differ only in generation, graphics or screen) it adds -2, -3 and so on. A SKU can also be entered manually; it must be unique ignoring letter case. |
| No duplicate configurations | Two configurations with the same eight specifications cannot exist. The system shows the existing SKU before saving. |
| Name | Defaults to Brand + Model (for example "Dell Latitude 5440"); can be changed. |
| Always tracked | Every laptop is tracked in stock, **serialised** (one serial number per physical laptop) and **requires QC** on receipt. |
| Tax | GST 18% by default; HSN and tax can be changed. The rate is copied onto documents when they are created. |
| Lifecycle | Draft -> Active -> Inactive -> Archived. Only active configurations can be bought or received. |
| Specifications are fixed | Specifications can be edited only while the configuration is a draft. Once active they are locked; a different variant is a new configuration. Prices, tax, HSN and name stay editable. |
| Deletion | Only drafts that no document references can be deleted; otherwise archive. |
| Snapshots | Purchase orders, goods receipts, QC tickets and stock copy the SKU and the eight specifications at the time they are created, so later master changes never alter them. |

### 5.3 Warehouses, locations and bins

- Any number of warehouses; exactly **one default** warehouse at a time.
- Each warehouse has a GST state code taken from its address; this decides whether a purchase is
  intra-state (CGST + SGST) or inter-state (IGST).
- Warehouses contain locations, which contain bins. Bins are optional: stock can be held "unbinned".
- Warehouses and bins can be deactivated; inactive ones cannot receive stock.

### 5.4 Other masters

Units of measure; GST tax rates (standard slabs plus cess, with effective dates); HSN/SAC codes with
a default tax rate; condition grades (used by QC); warranty policies; payment terms; custom fields
(extra attributes on documents and parties). There is no generic product category hierarchy: the
catalogue is laptops only.

### 5.5 Document numbering

Each document type (purchase order, goods receipt, adjustment, QC lot, and so on) has a numbering
format such as `PO/{FY}/0001`, supporting the financial year and calendar year placeholders. Numbers
are issued by the system at the moment a document is created and are never re-used or reissued, even
when two users create documents at the same instant. **Enforced by the system.**

---

## 6. Suppliers and customers

Suppliers and customers are "parties" with the same structure: basic details, addresses (one
default billing and one default shipping), contacts (one primary), and bank accounts.

| Rule | Detail |
|---|---|
| Codes | Generated by the system on creation. |
| GST validation | GSTIN format and checksum are validated; the PAN embedded in the GSTIN must match the party's PAN; the state code in the GSTIN must match the default billing address; GST-registered treatments require a GSTIN. |
| Duplicate GSTIN | The same GSTIN cannot be used twice for the same party type. |
| Bank accounts | Account numbers are stored encrypted; screens show only the last four digits. A member with the manage permission can reveal a number for 30 seconds; every reveal is recorded in the audit trail (without the number itself). |
| Status | Active or Inactive, plus **Blocked** (reason required). A blocked or inactive supplier cannot be placed on a new purchase order, and an existing draft order for them cannot be submitted. |
| Deletion | A party referenced by any document cannot be deleted; it can only be made inactive or blocked. |
| Snapshots | Documents copy the supplier's name, GSTIN, state and address at the moment the document is created. Later edits to the supplier never change past documents. |

---

## 7. Stock

### 7.1 How stock is kept

Stock is kept as a **double-entry ledger**: every movement is a posting that takes quantity out of
one place and puts the same quantity into another, so the ledger always balances to zero. The
"places" are:

| Bucket | Meaning |
|---|---|
| QC hold | Received, awaiting inspection; not available for sale |
| Available | Passed inspection (or no inspection required); can be reserved or sold |
| Reserved | Committed to a sales order (sales arrive in a later phase) |
| Rejected | Failed inspection; not sellable; awaiting return to the supplier |
| In transit | Moving between warehouses (transfers arrive in a later phase) |
| Delivered | With a customer |
| External supplier / external customer | The other side of receipts and deliveries |

Rules, all **enforced by the system**:

- **Stock never goes negative** in any warehouse, bin or bucket.
- **Every posting names its source document** (goods receipt, QC decision, adjustment, opening
  stock, bin move). Postings are append-only: nothing in the ledger is ever edited or deleted.
- **Each document posts once.** If a receipt or QC decision is re-sent, the ledger recognises it and
  does not double-count.
- **Allowed movements are fixed.** For example stock cannot go from Rejected to Available without a
  new QC decision, and goods cannot become Available without passing through QC hold unless the
  product does not require QC.
- **Every laptop is tracked by serial number.** Each serial number is unique per configuration within
  the organisation, follows the configuration's serial pattern if one is set, and is fully
  traceable: current stock bucket -> QC ticket and result -> goods receipt -> purchase order ->
  supplier -> laptop SKU -> the eight specifications.
- **Stock is kept per laptop SKU** and shows the specifications with the quantities in QC hold,
  Available and Rejected.
- **Valuation** is weighted average cost per product, updated on every inbound posting.

### 7.2 Opening stock

Opening stock can be entered manually (a guided form) or imported in bulk (paste rows of SKU,
warehouse, quantity, unit cost and serials). It is allowed **only before the product has any
movement in that warehouse**; after that, use an adjustment. Each import row is accepted or rejected
individually with a reason, and the rejected rows can be downloaded to fix and re-import.

### 7.3 Adjustments

Adjustments correct counted differences, damage, write-offs and similar.

| Rule | Detail |
|---|---|
| Reason code and notes | Required on every adjustment. |
| Draft first | Adjustments are saved as drafts and submitted explicitly. |
| Approval threshold | If the absolute value of the adjustment (quantity x average cost) exceeds the organisation's threshold (default 25,000), it waits for approval. Below the threshold it posts on submission. The threshold is set under Settings > Inventory. |
| Four eyes | The person who created or submitted an adjustment cannot approve it. |
| Availability check | Reductions cannot take a bucket below zero; the screen shows how much is available versus requested for the offending line. |
| Cancellation | Drafts and pending adjustments can be cancelled; posted adjustments cannot (post a reverse adjustment instead). |

### 7.4 Bin moves

Stock can be moved between bins inside one warehouse. A bin move never changes warehouse, bucket or
quantity on hand; it only relocates stock and is recorded in the ledger like any other posting.

### 7.5 Enquiries

- **Stock on hand** by product, warehouse, bin and bucket, with drill-down to the ledger.
- **Ledger** with a running balance for a chosen product, filterable by document type and date.
- **Serial register** with full history per unit.
- **Reconciliation** (for approvers): the system compares the ledger against the balances, checks
  that every posting sums to zero, and that serial counts match balances. A healthy organisation
  shows an empty report.

---

## 8. Purchasing

### 8.1 Purchase order lifecycle

| Status | Meaning | Next steps |
|---|---|---|
| Draft | Being prepared; fully editable | Submit, or delete |
| Pending approval | Submitted; waiting for an approver | Approve (optional comment) or reject (reason required, returns to Draft) |
| Approved | Approved but not yet sent to the supplier | Issue, or cancel |
| Issued | Sent to the supplier; goods may be received | Receive goods, revise, short-close, cancel (only if nothing has been received) |
| Partially received | Some quantity received | Receive more, revise, short-close |
| Received | Every line fully received (within tolerance) | Closes automatically when QC completes, or close manually |
| Closed | Complete | Final |
| Cancelled | Withdrawn before any receipt | Final |

Rules, all **enforced by the system**:

- **Lines select a laptop SKU.** Each line picks an existing laptop configuration; its eight
  specifications are shown automatically and are never typed on the order. **A purchase order never
  changes stock**: inventory only moves when goods are received and then pass QC.
- **What a line records.** Quantity (whole laptops), rate (the purchase price per laptop), monthly
  rental amount (per laptop per month) and tenure (in months) are all required. The rental amount
  and tenure are commercial terms of the order; they are not part of the order's purchase total.
- **One line per configuration.** The same laptop configuration cannot appear on two lines of an
  order; increase the quantity on its line instead.
- **Supplier and SKU checks.** Only active suppliers and active laptop configurations of the
  organisation itself can be on an order (generic products cannot); the supplier is re-checked when
  the order is submitted.
- **Prices, tax and totals are fixed at order time.** Each line records the product name, HSN/SAC,
  unit and GST rate as they were when the line was saved. Later master changes never alter an
  order. Totals (taxable value, CGST/SGST or IGST, rounding, grand total) are calculated by the
  system; the screen only previews them.
- **Intra-state or inter-state** is decided by the supplier's GST state versus the receiving
  warehouse's state.
- **Four eyes.** The submitter cannot approve their own order (setting: *Approver must differ*,
  default on). Administrators (the owner and anyone who can manage settings) are exempt; their
  self-approval is marked as such in the audit trail.
- **Approval limit.** An approver can only approve orders up to their organisation's approval limit;
  administrators are exempt (setting: *Approval limit*).
- **Revisions.** An issued or partially received order can be revised with a reason. Every
  revision is numbered and kept, and the order goes back through approval. Lines that already have
  receipts cannot change product or price, and their quantity cannot drop below what was received.
- **Short-close** cancels the remaining quantity on an order the supplier will not fulfil.
- **Cancellation** is only possible while nothing has been received.
- **Attachments** (supplier quotations, e-mails) can be added to an order.
- **Concurrent edits are detected.** If two people edit the same draft, the second save is refused
  and the screen reloads the latest version.

### 8.2 Goods receipts (GRN)

| Rule | Detail |
|---|---|
| Against an order | Goods are received only against an issued or partially received purchase order, into a warehouse the receiver is allowed to use. |
| Receivable quantity | Received quantity cannot exceed ordered minus cancelled, plus the over-receipt tolerance percentage (setting: *Over-receipt tolerance*, default 0 %). This holds even when two people receive the same order at the same time. |
| Serialised items | Quantity must be a whole number and exactly one serial per unit must be captured. Duplicates within the receipt, duplicates already in stock, pattern mismatches and missing IMEIs are rejected before anything is saved. |
| No double receipt | A receipt submitted twice (network retry, double click) is recorded once. |
| Supplier documents | Supplier invoice number and date, delivery note and vehicle number can be recorded. |
| Posting | On receipt the goods move from External supplier to **QC hold** and QC lots are created for each line (products not requiring QC pass automatically). If the stock posting is refused (for example a serial turned out to exist), the receipt shows **Posting failed** with the reason; the serials can be corrected and posting retried without re-entering the receipt. |
| Order status | Receiving updates the order's received quantities and status (partially received or received). |

### 8.3 Cancelling a receipt

- A receipt in **QC pending** can be cancelled with a reason. The system asks QC to release the
  lots; if any lot already has inspection results or a decision, the cancellation is refused and the
  receipt returns to QC pending with the reason shown. Otherwise the lots are cancelled, the stock is
  returned to External supplier, and the order's received quantities are restored.
- Draft and posting-failed receipts can be cancelled directly.
- A receipt whose QC is complete cannot be cancelled; the goods must be returned to the supplier
  (supplier returns arrive in a later phase).

### 8.4 Purchasing settings

| Setting | Default | Effect |
|---|---|---|
| Approver must differ | On | Four-eyes rule on purchase order approval |
| Approval limit | None | Maximum order value a non-administrator may approve |
| Close requires QC | On | An order closes only when every receipt's QC is complete |
| Over-receipt tolerance % | 0 | Extra quantity accepted above the ordered quantity |

---

## 9. Quality control

### 9.1 Lots

A QC lot (the **QC ticket**) is created automatically for every goods-receipt line as soon as the
receipt is posted, and appears in the QC queue. It records the GRN, the laptop SKU, the expected
eight specifications, the quantity and the serial numbers received. Laptops are always inspected in
**serial mode**: each physical laptop gets its own result.

| Status | Meaning |
|---|---|
| Open | Waiting for an inspector |
| In inspection | Started; results being recorded |
| Decided | Outcome recorded; stock is being moved |
| Closed | Stock moved: passed units to Available, failed units to Rejected |
| Cancelled | Released because the receipt was cancelled before inspection |

### 9.2 Laptop inspection

For every serial number the inspector records:

| Check | What is recorded |
|---|---|
| Specifications | Each of the eight specifications is marked **Match** or **Mismatch** against the configuration that was ordered. A mismatch requires the actual value found (for example RAM: 8 GB instead of 16 GB). |
| Powers on | Yes or No. |
| Missing parts | Charger, battery, RAM, SSD, keyboard keys, back panel, screws, other. |
| Asset tag | Optional internal tag (for example TTSPL6047). |
| Condition grade | From the condition grade master (New, A+, A, B, C, Scrap). |
| Result | **PASS**, **FAIL** or **HOLD**, with remarks. |

Rules, all **enforced by the system**:

- **PASS only when the laptop is exactly what was ordered.** All eight specifications must match, the
  laptop must power on and no part may be missing.
- **FAIL records why.** A specification mismatch, no power or missing parts are recorded as defect
  codes automatically (SPEC_MISMATCH, NO_POWER, MISSING_PARTS). A failure for another reason (for
  example a cracked screen) needs a defect code chosen by the inspector.
- **HOLD needs a reason** and keeps the laptop in QC hold. It is not available and not rejected.
- **A ticket cannot be decided while any laptop is on hold or not yet inspected.** Held laptops must
  be passed or failed first.
- **Only passed laptops become Available inventory.** Example: 10 received, 9 pass, 1 fails: Available
  9, Rejected 1. The failed laptop can never be reserved or sold.

### 9.3 General QC rules (enforced by the system)

- **Checklists.** Each product can have a checklist (pass/fail, numeric with a range, text or photo
  items). Items can be marked **critical**: a failed critical item forces the unit or lot to fail.
- **Failures need a reason.** A failed unit or quantity must carry at least one defect code; a
  condition grade can be recorded per unit.
- **Serial mode completeness.** Every serial in the lot must have a saved result before the lot can
  be decided. "Pass remaining" fills in the untouched serials.
- **Quantity mode arithmetic.** Passed plus failed must equal the lot quantity.
- **Separation of duties.** Recording results needs the inspect permission; deciding and reopening
  need the approve permission.
- **Decide once.** A lot cannot be decided twice. A decision can be **reopened** only until the stock
  has been moved.
- **Consequences.** Passed goods become Available and sellable. Failed goods become Rejected and
  cannot be sold or reserved. When every lot of a receipt is closed the receipt is QC complete, and
  when every receipt of an order is QC complete the order closes automatically.

---

## 10. Controls that apply everywhere

| Control | What it means for the business |
|---|---|
| Complete audit trail | Every create, change, status transition, approval, rejection, suspension, reveal and deletion is recorded with who, when, what changed and why. Organisations see their own trail under Settings > Audit; the platform team sees the platform trail. Audit records are never edited or deleted. |
| No sensitive data in the trail | Bank account numbers, passwords and tokens never appear in audit records. |
| Nothing is hard-deleted | Business records are made inactive, archived, cancelled or blocked; history is preserved. |
| Documents are immutable | Names, prices, tax rates, addresses and GST details are copied onto documents at creation; master changes never rewrite history. Corrections happen through new documents (revisions, adjustments, reversals). |
| Numbers are unique | Document numbers are issued by the system and never duplicated, even under concurrent use. |
| Double-submission is safe | Creating documents, approving, receiving and deciding are protected so that a retry or double click never applies twice. |
| Concurrent edit detection | Two people editing the same record cannot silently overwrite each other. |
| Warehouse scope | Scoped members are limited to their warehouses in every screen and every action. |
| Reasons and confirmations | Rejections, blocks, suspensions, cancellations and removals require a reason; destructive platform actions require a typed confirmation. |
| Screens follow permissions, the server enforces them | Buttons and menus hide what a member cannot do, and every request is checked again on the server. |

---

## 11. What is next

The following capabilities are planned in later phases and are shown as "coming soon" in the
application: sales orders and reservations, dispatch and delivery, stock transfers between
warehouses, supplier returns, purchase bills and payments, GST invoicing, and reports. The rules in
this document (double-entry stock, snapshots on documents, approvals, audit) already provide the
foundation they will build on.

---

## Appendix A - Status glossary

| Area | Statuses |
|---|---|
| Organisation | Pending, Approved, Active, Suspended, Deactivated, Rejected |
| Member | Invited, Active, Suspended, Removed |
| Laptop configuration | Draft, Active, Inactive, Archived |
| Party | Active, Inactive, Blocked |
| Purchase order | Draft, Pending approval, Approved, Issued, Partially received, Received, Closed, Cancelled |
| Goods receipt | Draft, Received, QC pending, QC completed, Posting failed, Cancellation pending, Cancelled |
| QC ticket (lot) | Open, In inspection, Decided, Closed, Cancelled |
| Laptop QC result | Pass, Fail, Hold |
| Adjustment | Draft, Pending approval, Posted, Cancelled |

## Appendix B - Who can do what (system roles)

| Action | Owner | Admin | Purchase Mgr | Purchase Exec | Inventory Mgr | QC Mgr | Sales Mgr | Dispatch Mgr | Finance | Viewer |
|---|---|---|---|---|---|---|---|---|---|---|
| Manage members and roles | yes | yes | - | - | - | - | - | - | - | - |
| Maintain products and other masters | yes | yes | - | - | - | - | - | - | - | - |
| Maintain warehouses and bins | yes | yes | - | - | yes | - | - | - | - | - |
| Maintain suppliers | yes | yes | yes | - | - | - | - | - | - | - |
| Maintain customers | yes | yes | - | - | - | - | yes | - | - | - |
| Create and edit purchase orders | yes | yes | yes | yes | - | - | - | - | - | - |
| Approve, issue, revise, cancel orders | yes | yes | yes | - | - | - | - | - | - | - |
| Receive goods | yes | yes | yes | yes | - | - | - | - | - | - |
| Cancel goods receipts | yes | yes | yes | - | - | - | - | - | - | - |
| Stock adjustments, opening stock, bin moves | yes | yes | - | - | yes | - | - | - | - | - |
| Approve adjustments | yes | yes | - | - | yes | - | - | - | - | - |
| Record QC results and decide lots | yes | yes | - | - | - | yes | - | - | - | - |
| View purchasing | yes | yes | yes | yes | yes (receipts) | yes (receipts) | - | - | yes | yes |
| View stock | yes | yes | yes | - | yes | yes | yes | yes | - | yes |
| View QC | yes | yes | yes | - | yes | yes | - | - | - | yes |
| View audit trail | yes | yes | - | - | - | - | - | - | - | yes |

Custom roles can combine permissions differently, subject to the anti-escalation rules in
section 4.2. Appendix B reflects the default system roles; the exact permission sets are visible
under Settings > Roles.
