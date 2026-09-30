-- svc-qc initial schema (phase-05 5.5) with RLS on every tenant table.

CREATE TABLE "qc_checklists" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "name" VARCHAR(100) NOT NULL, "applies_to" JSONB NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1, "status" VARCHAR(10) NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "qc_checklists_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "qc_checklists_tenant_id_idx" ON "qc_checklists"("tenant_id");

CREATE TABLE "qc_checklist_items" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "checklist_id" UUID NOT NULL, "seq" INTEGER NOT NULL, "label" VARCHAR(200) NOT NULL,
  "kind" VARCHAR(10) NOT NULL, "critical" BOOLEAN NOT NULL DEFAULT false, "min_value" DECIMAL(18,4), "max_value" DECIMAL(18,4),
  CONSTRAINT "qc_checklist_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "qc_checklist_items_kind_check" CHECK ("kind" IN ('PASS_FAIL','NUMERIC','TEXT','PHOTO')),
  CONSTRAINT "qc_checklist_items_checklist_id_fkey" FOREIGN KEY ("checklist_id") REFERENCES "qc_checklists"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "qc_checklist_items_checklist_id_seq_key" ON "qc_checklist_items"("checklist_id", "seq");

CREATE TABLE "qc_lots" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "number" VARCHAR(40) NOT NULL,
  "source_type" VARCHAR(20) NOT NULL, "source_id" UUID NOT NULL, "source_line_id" UUID NOT NULL, "source_number" VARCHAR(60),
  "item_id" UUID NOT NULL, "item_snapshot" JSONB NOT NULL, "warehouse_id" UUID NOT NULL, "bin_id" UUID,
  "mode" VARCHAR(10) NOT NULL, "qty" DECIMAL(18,3) NOT NULL, "pass_qty" DECIMAL(18,3) NOT NULL DEFAULT 0, "fail_qty" DECIMAL(18,3) NOT NULL DEFAULT 0,
  "serials" TEXT[] NOT NULL DEFAULT '{}', "checklist_id" UUID, "checklist_version" INTEGER,
  "status" VARCHAR(20) NOT NULL, "status_reason" VARCHAR(300), "inspector_id" UUID, "started_at" TIMESTAMPTZ(6),
  "decided_at" TIMESTAMPTZ(6), "decided_by" UUID, "posting_ids" UUID[] NOT NULL DEFAULT '{}', "closed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "version" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "qc_lots_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "qc_lots_source_type_check" CHECK ("source_type" IN ('GRN','CUSTOMER_RETURN','TRANSFER_IN','RTO')),
  CONSTRAINT "qc_lots_mode_check" CHECK ("mode" IN ('QUANTITY','SERIAL')),
  CONSTRAINT "qc_lots_status_check" CHECK ("status" IN ('OPEN','IN_INSPECTION','DECIDED','CLOSED','CANCELLED')),
  CONSTRAINT "qc_lots_qty_check" CHECK ("pass_qty" + "fail_qty" <= "qty")
);
CREATE UNIQUE INDEX "qc_lots_tenant_id_number_key" ON "qc_lots"("tenant_id", "number");
CREATE UNIQUE INDEX "qc_lots_tenant_id_source_type_source_line_id_key" ON "qc_lots"("tenant_id", "source_type", "source_line_id");
CREATE INDEX "qc_lots_tenant_id_status_created_at_idx" ON "qc_lots"("tenant_id", "status", "created_at");
CREATE INDEX "qc_lots_tenant_id_source_id_idx" ON "qc_lots"("tenant_id", "source_id");

CREATE TABLE "qc_unit_results" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "lot_id" UUID NOT NULL, "serial_no" VARCHAR(80) NOT NULL,
  "result" VARCHAR(4) NOT NULL, "grade_code" VARCHAR(20), "defect_codes" TEXT[] NOT NULL DEFAULT '{}', "remarks" VARCHAR(500),
  "checklist_answers" JSONB NOT NULL DEFAULT '{}', "inspected_by" UUID NOT NULL, "inspected_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "qc_unit_results_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "qc_unit_results_result_check" CHECK ("result" IN ('PASS','FAIL')),
  CONSTRAINT "qc_unit_results_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "qc_lots"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "qc_unit_results_lot_id_serial_no_key" ON "qc_unit_results"("lot_id", "serial_no");

CREATE TABLE "qc_defect_codes" (
  "tenant_id" UUID NOT NULL, "code" VARCHAR(20) NOT NULL, "description" VARCHAR(200) NOT NULL, "status" VARCHAR(10) NOT NULL DEFAULT 'ACTIVE',
  CONSTRAINT "qc_defect_codes_pkey" PRIMARY KEY ("tenant_id", "code")
);

CREATE TABLE "document_sequences" (
  "tenant_id" UUID NOT NULL, "doc_type" VARCHAR(10) NOT NULL, "fy" VARCHAR(10) NOT NULL, "last_no" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "document_sequences_pkey" PRIMARY KEY ("tenant_id", "doc_type", "fy")
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['qc_checklists','qc_checklist_items','qc_lots','qc_unit_results','qc_defect_codes','document_sequences'] LOOP
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
