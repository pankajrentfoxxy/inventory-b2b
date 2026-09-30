-- svc-procurement initial schema (phase-05 5.5) with RLS on every tenant table.

CREATE TABLE "purchase_orders" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "number" VARCHAR(40) NOT NULL, "revision" INTEGER NOT NULL DEFAULT 0,
  "supplier_id" UUID NOT NULL, "supplier_snapshot" JSONB NOT NULL, "ship_to_warehouse_id" UUID NOT NULL, "ship_to_snapshot" JSONB NOT NULL,
  "order_date" DATE NOT NULL, "expected_date" DATE, "payment_term_id" UUID, "currency" VARCHAR(3) NOT NULL DEFAULT 'INR',
  "discount_type" VARCHAR(10) NOT NULL DEFAULT 'PERCENT', "discount_value" DECIMAL(18,4) NOT NULL DEFAULT 0, "intra_state" BOOLEAN NOT NULL DEFAULT true,
  "subtotal" DECIMAL(18,2) NOT NULL DEFAULT 0, "discount_amount" DECIMAL(18,2) NOT NULL DEFAULT 0, "tax_total" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "tax_breakup" JSONB NOT NULL DEFAULT '[]', "total" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "status" VARCHAR(20) NOT NULL, "status_reason" VARCHAR(500), "notes" VARCHAR(1000), "terms" VARCHAR(2000),
  "created_by" UUID NOT NULL, "submitted_by" UUID, "submitted_at" TIMESTAMPTZ(6), "approved_by" UUID, "approved_at" TIMESTAMPTZ(6),
  "issued_at" TIMESTAMPTZ(6), "cancelled_at" TIMESTAMPTZ(6), "closed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, "version" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "purchase_orders_status_check" CHECK ("status" IN ('DRAFT','PENDING_APPROVAL','APPROVED','ISSUED','PARTIALLY_RECEIVED','RECEIVED','CLOSED','CANCELLED')),
  CONSTRAINT "purchase_orders_discount_type_check" CHECK ("discount_type" IN ('PERCENT','AMOUNT'))
);
CREATE UNIQUE INDEX "purchase_orders_tenant_id_number_key" ON "purchase_orders"("tenant_id", "number");
CREATE INDEX "purchase_orders_tenant_id_status_created_at_idx" ON "purchase_orders"("tenant_id", "status", "created_at");
CREATE INDEX "purchase_orders_tenant_id_supplier_id_idx" ON "purchase_orders"("tenant_id", "supplier_id");

CREATE TABLE "po_lines" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "po_id" UUID NOT NULL, "line_no" INTEGER NOT NULL,
  "item_id" UUID NOT NULL, "item_snapshot" JSONB NOT NULL,
  "ordered_qty" DECIMAL(18,3) NOT NULL, "received_qty" DECIMAL(18,3) NOT NULL DEFAULT 0, "cancelled_qty" DECIMAL(18,3) NOT NULL DEFAULT 0,
  "unit_price" DECIMAL(18,4) NOT NULL, "discount_pct" DECIMAL(5,2) NOT NULL DEFAULT 0, "tax_rate" DECIMAL(5,2) NOT NULL,
  "taxable_amount" DECIMAL(18,2) NOT NULL DEFAULT 0, "tax_amount" DECIMAL(18,2) NOT NULL DEFAULT 0, "line_total" DECIMAL(18,2) NOT NULL DEFAULT 0,
  CONSTRAINT "po_lines_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "po_lines_ordered_qty_check" CHECK ("ordered_qty" > 0),
  CONSTRAINT "po_lines_unit_price_check" CHECK ("unit_price" >= 0),
  CONSTRAINT "po_lines_received_check" CHECK ("received_qty" >= 0 AND "cancelled_qty" >= 0 AND "cancelled_qty" <= "ordered_qty"),
  CONSTRAINT "po_lines_po_id_fkey" FOREIGN KEY ("po_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "po_lines_po_id_line_no_key" ON "po_lines"("po_id", "line_no");
CREATE INDEX "po_lines_tenant_id_item_id_idx" ON "po_lines"("tenant_id", "item_id");

CREATE TABLE "po_revisions" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "po_id" UUID NOT NULL, "revision" INTEGER NOT NULL, "snapshot" JSONB NOT NULL,
  "reason" VARCHAR(500) NOT NULL, "created_by" UUID NOT NULL, "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "po_revisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "po_revisions_po_id_fkey" FOREIGN KEY ("po_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "po_revisions_po_id_revision_key" ON "po_revisions"("po_id", "revision");

CREATE TABLE "po_approvals" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "po_id" UUID NOT NULL, "revision" INTEGER NOT NULL, "decision" VARCHAR(10) NOT NULL,
  "actor_id" UUID NOT NULL, "comment" VARCHAR(500), "decided_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "po_approvals_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "po_approvals_decision_check" CHECK ("decision" IN ('APPROVED','REJECTED')),
  CONSTRAINT "po_approvals_po_id_fkey" FOREIGN KEY ("po_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE
);
CREATE INDEX "po_approvals_po_id_idx" ON "po_approvals"("po_id");

CREATE TABLE "grns" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "number" VARCHAR(40) NOT NULL, "po_id" UUID NOT NULL,
  "supplier_id" UUID NOT NULL, "supplier_snapshot" JSONB NOT NULL, "warehouse_id" UUID NOT NULL, "warehouse_snapshot" JSONB NOT NULL,
  "received_date" DATE NOT NULL, "supplier_invoice_no" VARCHAR(60), "supplier_invoice_date" DATE, "delivery_note_no" VARCHAR(60), "vehicle_no" VARCHAR(20),
  "status" VARCHAR(25) NOT NULL, "status_reason" VARCHAR(500), "remarks" VARCHAR(1000), "idempotency_key" UUID, "receipt_posting_id" UUID,
  "created_by" UUID NOT NULL, "received_at" TIMESTAMPTZ(6), "cancelled_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, "version" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "grns_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "grns_status_check" CHECK ("status" IN ('DRAFT','RECEIVED','QC_PENDING','QC_COMPLETED','POSTING_FAILED','CANCELLATION_PENDING','CANCELLED')),
  CONSTRAINT "grns_po_id_fkey" FOREIGN KEY ("po_id") REFERENCES "purchase_orders"("id")
);
CREATE UNIQUE INDEX "grns_tenant_id_number_key" ON "grns"("tenant_id", "number");
CREATE UNIQUE INDEX "grns_tenant_id_idempotency_key_key" ON "grns"("tenant_id", "idempotency_key");
CREATE INDEX "grns_tenant_id_status_created_at_idx" ON "grns"("tenant_id", "status", "created_at");
CREATE INDEX "grns_tenant_id_po_id_idx" ON "grns"("tenant_id", "po_id");

CREATE TABLE "grn_lines" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "grn_id" UUID NOT NULL, "po_line_id" UUID NOT NULL, "line_no" INTEGER NOT NULL,
  "item_id" UUID NOT NULL, "item_snapshot" JSONB NOT NULL, "qty" DECIMAL(18,3) NOT NULL, "unit_cost" DECIMAL(18,4) NOT NULL, "bin_id" UUID, "condition_note" VARCHAR(300),
  "qc_status" VARCHAR(10) NOT NULL DEFAULT 'PENDING', "qc_pass_qty" DECIMAL(18,3) NOT NULL DEFAULT 0, "qc_fail_qty" DECIMAL(18,3) NOT NULL DEFAULT 0, "lot_id" UUID,
  CONSTRAINT "grn_lines_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "grn_lines_qty_check" CHECK ("qty" > 0),
  CONSTRAINT "grn_lines_qc_status_check" CHECK ("qc_status" IN ('PENDING','DONE','REVERSED')),
  CONSTRAINT "grn_lines_grn_id_fkey" FOREIGN KEY ("grn_id") REFERENCES "grns"("id") ON DELETE CASCADE,
  CONSTRAINT "grn_lines_po_line_id_fkey" FOREIGN KEY ("po_line_id") REFERENCES "po_lines"("id")
);
CREATE UNIQUE INDEX "grn_lines_grn_id_line_no_key" ON "grn_lines"("grn_id", "line_no");
CREATE INDEX "grn_lines_po_line_id_idx" ON "grn_lines"("po_line_id");

-- Deliberately no tenant-wide unique on serials here: uniqueness is owned by svc-inventory (serial_units).
CREATE TABLE "grn_line_serials" (
  "tenant_id" UUID NOT NULL, "grn_line_id" UUID NOT NULL, "serial_no" VARCHAR(80) NOT NULL, "imei" VARCHAR(20),
  CONSTRAINT "grn_line_serials_pkey" PRIMARY KEY ("grn_line_id", "serial_no"),
  CONSTRAINT "grn_line_serials_grn_line_id_fkey" FOREIGN KEY ("grn_line_id") REFERENCES "grn_lines"("id") ON DELETE CASCADE
);

CREATE TABLE "document_attachments" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "entity_type" VARCHAR(20) NOT NULL, "entity_id" UUID NOT NULL, "object_key" VARCHAR(400) NOT NULL,
  "file_name" VARCHAR(255) NOT NULL, "content_type" VARCHAR(120) NOT NULL, "size_bytes" BIGINT NOT NULL, "uploaded_by" UUID NOT NULL,
  "uploaded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "document_attachments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "document_attachments_tenant_id_entity_type_entity_id_idx" ON "document_attachments"("tenant_id", "entity_type", "entity_id");

CREATE TABLE "procurement_settings" (
  "tenant_id" UUID NOT NULL, "approver_must_differ" BOOLEAN NOT NULL DEFAULT true, "approval_limit" DECIMAL(18,2), "close_requires_qc" BOOLEAN NOT NULL DEFAULT true,
  "over_receipt_tolerance_pct" DECIMAL(5,2) NOT NULL DEFAULT 0, "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "procurement_settings_pkey" PRIMARY KEY ("tenant_id")
);

CREATE TABLE "document_sequences" (
  "tenant_id" UUID NOT NULL, "doc_type" VARCHAR(10) NOT NULL, "fy" VARCHAR(10) NOT NULL, "last_no" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "document_sequences_pkey" PRIMARY KEY ("tenant_id", "doc_type", "fy")
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['purchase_orders','po_lines','po_revisions','po_approvals','grns','grn_lines','grn_line_serials','document_attachments','procurement_settings','document_sequences'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (current_setting('app.platform', true) = 'true' OR tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
      WITH CHECK (current_setting('app.platform', true) = 'true' OR tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)$p$, t);
  END LOOP;
END $$;

CREATE TABLE "idempotency_keys" (
  "tenant_id" UUID NOT NULL, "scope" TEXT NOT NULL, "key" UUID NOT NULL, "request_hash" CHAR(64) NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'IN_PROGRESS', "response_code" INTEGER, "response_body" JSONB,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, "expires_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("tenant_id", "scope", "key")
);
CREATE INDEX "idempotency_keys_expires_at_idx" ON "idempotency_keys"("expires_at");

CREATE TABLE "outbox_events" (
  "id" UUID NOT NULL, "tenant_id" UUID, "event_type" TEXT NOT NULL, "event_version" INTEGER NOT NULL,
  "aggregate_type" TEXT NOT NULL, "aggregate_id" UUID NOT NULL, "envelope" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, "published_at" TIMESTAMPTZ(6),
  "attempts" INTEGER NOT NULL DEFAULT 0, "last_error" TEXT, "next_attempt_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "outbox_unpublished" ON "outbox_events"("next_attempt_at", "created_at") WHERE "published_at" IS NULL;

CREATE TABLE "processed_events" (
  "consumer" TEXT NOT NULL, "event_id" UUID NOT NULL, "processed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "processed_events_pkey" PRIMARY KEY ("consumer", "event_id")
);
