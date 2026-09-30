-- svc-inventory initial schema (phase-04 4.5). Ledger tables are append-only: the runtime role gets
-- INSERT/SELECT only (the grant script revokes UPDATE/DELETE on tables commented 'append-only').

CREATE TABLE "item_refs" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "sku" VARCHAR(40) NOT NULL, "name" VARCHAR(200) NOT NULL,
  "track_inventory" BOOLEAN NOT NULL, "is_serialized" BOOLEAN NOT NULL, "requires_imei" BOOLEAN NOT NULL,
  "serial_pattern" VARCHAR(120), "qc_required" BOOLEAN NOT NULL, "unit_code" VARCHAR(10) NOT NULL,
  "status" VARCHAR(10) NOT NULL, "version" INTEGER NOT NULL,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "item_refs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "item_refs_tenant_id_sku_idx" ON "item_refs"("tenant_id", "sku");

CREATE TABLE "warehouse_refs" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "code" VARCHAR(12) NOT NULL, "name" VARCHAR(100) NOT NULL,
  "status" VARCHAR(10) NOT NULL, "version" INTEGER NOT NULL,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "warehouse_refs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "warehouse_refs_tenant_id_idx" ON "warehouse_refs"("tenant_id");

CREATE TABLE "bin_refs" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "warehouse_id" UUID NOT NULL, "code" VARCHAR(20) NOT NULL,
  "status" VARCHAR(10) NOT NULL, "version" INTEGER NOT NULL,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "bin_refs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "bin_refs_tenant_id_warehouse_id_idx" ON "bin_refs"("tenant_id", "warehouse_id");

CREATE TABLE "stock_postings" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "posting_type" VARCHAR(30) NOT NULL,
  "ref_type" VARCHAR(30) NOT NULL, "ref_id" UUID NOT NULL, "ref_number" VARCHAR(60),
  "idempotency_key" VARCHAR(160) NOT NULL, "payload_hash" CHAR(64) NOT NULL,
  "requested_by_service" VARCHAR(40) NOT NULL, "actor_id" UUID, "reversal_of" UUID,
  "posted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "stock_postings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "stock_postings_reversal_of_fkey" FOREIGN KEY ("reversal_of") REFERENCES "stock_postings"("id")
);
CREATE UNIQUE INDEX "stock_postings_tenant_id_idempotency_key_key" ON "stock_postings"("tenant_id", "idempotency_key");
CREATE INDEX "stock_postings_tenant_id_ref_type_ref_id_idx" ON "stock_postings"("tenant_id", "ref_type", "ref_id");
COMMENT ON TABLE "stock_postings" IS 'append-only';

CREATE TABLE "stock_movements" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "posting_id" UUID NOT NULL, "line_no" INTEGER NOT NULL,
  "item_id" UUID NOT NULL, "warehouse_id" UUID, "bin_id" UUID, "party_id" UUID,
  "bucket" VARCHAR(20) NOT NULL, "qty" DECIMAL(18,3) NOT NULL, "unit_cost" DECIMAL(18,4), "grade_code" VARCHAR(20),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "stock_movements_qty_check" CHECK ("qty" <> 0),
  CONSTRAINT "stock_movements_bucket_check" CHECK ("bucket" IN ('QC_HOLD','AVAILABLE','RESERVED','REJECTED','IN_TRANSIT','DELIVERED','EXT_SUPPLIER','EXT_CUSTOMER','EXT_OPENING','EXT_ADJUSTMENT','EXT_SCRAP')),
  CONSTRAINT "stock_movements_posting_id_fkey" FOREIGN KEY ("posting_id") REFERENCES "stock_postings"("id")
);
CREATE UNIQUE INDEX "stock_movements_posting_id_line_no_key" ON "stock_movements"("posting_id", "line_no");
CREATE INDEX "stock_movements_tenant_id_item_id_warehouse_id_created_at_idx" ON "stock_movements"("tenant_id", "item_id", "warehouse_id", "created_at");
COMMENT ON TABLE "stock_movements" IS 'append-only';

CREATE TABLE "stock_balances" (
  "tenant_id" UUID NOT NULL, "item_id" UUID NOT NULL, "warehouse_id" UUID NOT NULL,
  "bin_id" UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000', "bucket" VARCHAR(20) NOT NULL,
  "qty" DECIMAL(18,3) NOT NULL DEFAULT 0, "version" BIGINT NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "stock_balances_pkey" PRIMARY KEY ("tenant_id", "item_id", "warehouse_id", "bin_id", "bucket"),
  CONSTRAINT "stock_balances_bucket_check" CHECK ("bucket" IN ('QC_HOLD','AVAILABLE','RESERVED','REJECTED','IN_TRANSIT')),
  CONSTRAINT "stock_balances_qty_check" CHECK ("qty" >= 0)
);
CREATE INDEX "stock_balances_tenant_id_warehouse_id_bucket_idx" ON "stock_balances"("tenant_id", "warehouse_id", "bucket");

CREATE TABLE "customer_stock_balances" (
  "tenant_id" UUID NOT NULL, "item_id" UUID NOT NULL, "party_id" UUID NOT NULL, "bucket" VARCHAR(20) NOT NULL,
  "qty" DECIMAL(18,3) NOT NULL DEFAULT 0, "version" BIGINT NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "customer_stock_balances_pkey" PRIMARY KEY ("tenant_id", "item_id", "party_id", "bucket"),
  CONSTRAINT "customer_stock_balances_bucket_check" CHECK ("bucket" = 'DELIVERED'),
  CONSTRAINT "customer_stock_balances_qty_check" CHECK ("qty" >= 0)
);

CREATE TABLE "serial_units" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "item_id" UUID NOT NULL, "serial_no" VARCHAR(80) NOT NULL, "imei" VARCHAR(20),
  "bucket" VARCHAR(20) NOT NULL, "warehouse_id" UUID, "bin_id" UUID, "party_id" UUID, "grade_code" VARCHAR(20),
  "qc_status" VARCHAR(10) NOT NULL DEFAULT 'PENDING', "unit_cost" DECIMAL(18,4),
  "po_id" UUID, "grn_id" UUID, "qc_lot_id" UUID, "so_id" UUID, "reservation_id" UUID, "dc_id" UUID, "shipment_id" UUID,
  "warranty_policy_id" UUID, "warranty_start" DATE, "warranty_end" DATE,
  "version" BIGINT NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "serial_units_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "serial_units_qc_status_check" CHECK ("qc_status" IN ('PENDING','PASSED','FAILED'))
);
CREATE UNIQUE INDEX "serial_uq" ON "serial_units"("tenant_id", "item_id", upper("serial_no"));
CREATE UNIQUE INDEX "imei_uq" ON "serial_units"("tenant_id", "imei") WHERE "imei" IS NOT NULL;
CREATE INDEX "serial_lookup" ON "serial_units"("tenant_id", upper("serial_no"));
CREATE INDEX "serial_units_tenant_id_item_id_warehouse_id_bucket_grade_code_idx" ON "serial_units"("tenant_id", "item_id", "warehouse_id", "bucket", "grade_code");

CREATE TABLE "serial_events" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "serial_unit_id" UUID NOT NULL, "posting_id" UUID NOT NULL,
  "from_bucket" VARCHAR(20), "to_bucket" VARCHAR(20) NOT NULL, "warehouse_id" UUID, "bin_id" UUID, "party_id" UUID,
  "ref_type" VARCHAR(30) NOT NULL, "ref_id" UUID NOT NULL, "ref_number" VARCHAR(60),
  "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "serial_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "serial_events_serial_unit_id_fkey" FOREIGN KEY ("serial_unit_id") REFERENCES "serial_units"("id"),
  CONSTRAINT "serial_events_posting_id_fkey" FOREIGN KEY ("posting_id") REFERENCES "stock_postings"("id")
);
CREATE INDEX "serial_events_tenant_id_serial_unit_id_occurred_at_idx" ON "serial_events"("tenant_id", "serial_unit_id", "occurred_at");
COMMENT ON TABLE "serial_events" IS 'append-only';

CREATE TABLE "inventory_adjustments" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "number" VARCHAR(40) NOT NULL, "warehouse_id" UUID NOT NULL,
  "reason_code" VARCHAR(20) NOT NULL, "notes" VARCHAR(500), "status" VARCHAR(20) NOT NULL, "status_reason" VARCHAR(300),
  "total_value" DECIMAL(18,2) NOT NULL DEFAULT 0, "posting_ids" UUID[] NOT NULL DEFAULT '{}',
  "created_by" UUID NOT NULL, "submitted_by" UUID, "approved_by" UUID, "posted_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "version" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "inventory_adjustments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "inventory_adjustments_reason_code_check" CHECK ("reason_code" IN ('COUNT_CORRECTION','DAMAGE','LOSS','FOUND','OPENING','OTHER')),
  CONSTRAINT "inventory_adjustments_status_check" CHECK ("status" IN ('DRAFT','PENDING_APPROVAL','POSTED','CANCELLED'))
);
CREATE UNIQUE INDEX "inventory_adjustments_tenant_id_number_key" ON "inventory_adjustments"("tenant_id", "number");
CREATE INDEX "inventory_adjustments_tenant_id_status_created_at_idx" ON "inventory_adjustments"("tenant_id", "status", "created_at");

CREATE TABLE "inventory_adjustment_lines" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "adjustment_id" UUID NOT NULL, "line_no" INTEGER NOT NULL,
  "item_id" UUID NOT NULL, "bin_id" UUID, "bucket" VARCHAR(20) NOT NULL, "qty_delta" DECIMAL(18,3) NOT NULL,
  "unit_cost" DECIMAL(18,4), "serial_numbers" TEXT[] NOT NULL DEFAULT '{}',
  CONSTRAINT "inventory_adjustment_lines_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "inventory_adjustment_lines_qty_delta_check" CHECK ("qty_delta" <> 0),
  CONSTRAINT "inventory_adjustment_lines_bucket_check" CHECK ("bucket" IN ('AVAILABLE','QC_HOLD','REJECTED')),
  CONSTRAINT "inventory_adjustment_lines_adjustment_id_fkey" FOREIGN KEY ("adjustment_id") REFERENCES "inventory_adjustments"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "inventory_adjustment_lines_adjustment_id_line_no_key" ON "inventory_adjustment_lines"("adjustment_id", "line_no");

CREATE TABLE "item_cost" (
  "tenant_id" UUID NOT NULL, "item_id" UUID NOT NULL, "warehouse_id" UUID NOT NULL,
  "avg_cost" DECIMAL(18,4) NOT NULL, "qty_basis" DECIMAL(18,3) NOT NULL,
  CONSTRAINT "item_cost_pkey" PRIMARY KEY ("tenant_id", "item_id", "warehouse_id")
);

CREATE TABLE "inventory_settings" (
  "tenant_id" UUID NOT NULL, "adjustment_approval_threshold" DECIMAL(18,2) NOT NULL DEFAULT 25000,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inventory_settings_pkey" PRIMARY KEY ("tenant_id")
);

CREATE TABLE "document_sequences" (
  "tenant_id" UUID NOT NULL, "doc_type" VARCHAR(10) NOT NULL, "fy" VARCHAR(10) NOT NULL, "last_no" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "document_sequences_pkey" PRIMARY KEY ("tenant_id", "doc_type", "fy")
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['item_refs','warehouse_refs','bin_refs','stock_postings','stock_movements','stock_balances','customer_stock_balances','serial_units','serial_events','inventory_adjustments','inventory_adjustment_lines','item_cost','inventory_settings','document_sequences'] LOOP
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
