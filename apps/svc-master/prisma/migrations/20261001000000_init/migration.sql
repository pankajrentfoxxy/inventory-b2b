-- svc-master initial schema (phase-03 3.5) with RLS on every tenant table.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE "units" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "code" VARCHAR(10) NOT NULL, "name" VARCHAR(50) NOT NULL,
  "decimals" INTEGER NOT NULL DEFAULT 0, "uqc" VARCHAR(10), "status" VARCHAR(10) NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "units_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "units_decimals_check" CHECK ("decimals" BETWEEN 0 AND 3)
);
CREATE UNIQUE INDEX "units_tenant_code_uq" ON "units"("tenant_id", lower("code"));
CREATE INDEX "units_tenant_id_idx" ON "units"("tenant_id");

CREATE TABLE "tax_rates" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "name" VARCHAR(50) NOT NULL,
  "gst_rate" DECIMAL(5,2) NOT NULL, "cess_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
  "effective_from" DATE NOT NULL, "effective_to" DATE, "status" VARCHAR(10) NOT NULL DEFAULT 'ACTIVE',
  CONSTRAINT "tax_rates_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tax_rates_gst_rate_check" CHECK ("gst_rate" IN (0,0.1,0.25,1,1.5,3,5,6,7.5,12,18,28,40))
);
CREATE UNIQUE INDEX "tax_rates_tenant_id_name_effective_from_key" ON "tax_rates"("tenant_id", "name", "effective_from");
CREATE INDEX "tax_rates_tenant_id_idx" ON "tax_rates"("tenant_id");

CREATE TABLE "hsn_codes" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "code" VARCHAR(8) NOT NULL, "kind" VARCHAR(3) NOT NULL,
  "description" VARCHAR(300), "default_tax_rate_id" UUID,
  CONSTRAINT "hsn_codes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "hsn_codes_code_check" CHECK ("code" ~ '^[0-9]{4,8}$'),
  CONSTRAINT "hsn_codes_kind_check" CHECK ("kind" IN ('HSN','SAC')),
  CONSTRAINT "hsn_codes_default_tax_rate_id_fkey" FOREIGN KEY ("default_tax_rate_id") REFERENCES "tax_rates"("id") ON DELETE SET NULL
);
CREATE UNIQUE INDEX "hsn_codes_tenant_id_code_key" ON "hsn_codes"("tenant_id", "code");

CREATE TABLE "categories" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "parent_id" UUID, "name" VARCHAR(100) NOT NULL,
  "path" VARCHAR(800) NOT NULL, "status" VARCHAR(10) NOT NULL DEFAULT 'ACTIVE',
  CONSTRAINT "categories_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "categories"("id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "categories_tenant_parent_name_uq" ON "categories"("tenant_id", coalesce("parent_id", '00000000-0000-0000-0000-000000000000'::uuid), lower("name"));
CREATE INDEX "categories_tenant_id_path_idx" ON "categories"("tenant_id", "path");

CREATE TABLE "brands" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "name" VARCHAR(100) NOT NULL, "status" VARCHAR(10) NOT NULL DEFAULT 'ACTIVE',
  CONSTRAINT "brands_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "brands_tenant_name_uq" ON "brands"("tenant_id", lower("name"));
CREATE INDEX "brands_tenant_id_idx" ON "brands"("tenant_id");

CREATE TABLE "condition_grades" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "code" VARCHAR(10) NOT NULL, "name" VARCHAR(50) NOT NULL,
  "sort_order" INTEGER NOT NULL, "sellable" BOOLEAN NOT NULL DEFAULT true, "status" VARCHAR(10) NOT NULL DEFAULT 'ACTIVE',
  CONSTRAINT "condition_grades_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "condition_grades_tenant_id_code_key" ON "condition_grades"("tenant_id", "code");

CREATE TABLE "warranty_policies" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "name" VARCHAR(100) NOT NULL, "duration_months" INTEGER NOT NULL,
  "starts_on" VARCHAR(15) NOT NULL, "terms" TEXT, "status" VARCHAR(10) NOT NULL DEFAULT 'ACTIVE',
  CONSTRAINT "warranty_policies_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "warranty_policies_duration_check" CHECK ("duration_months" >= 0),
  CONSTRAINT "warranty_policies_starts_on_check" CHECK ("starts_on" IN ('INVOICE_DATE','DELIVERY_DATE'))
);
CREATE INDEX "warranty_policies_tenant_id_idx" ON "warranty_policies"("tenant_id");

CREATE TABLE "products" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "sku" VARCHAR(40) NOT NULL, "name" VARCHAR(200) NOT NULL, "description" TEXT,
  "type" VARCHAR(10) NOT NULL, "track_inventory" BOOLEAN NOT NULL, "is_serialized" BOOLEAN NOT NULL DEFAULT false,
  "requires_imei" BOOLEAN NOT NULL DEFAULT false, "serial_pattern" VARCHAR(200), "qc_required" BOOLEAN NOT NULL DEFAULT true,
  "category_id" UUID, "brand_id" UUID, "unit_id" UUID NOT NULL, "hsn_id" UUID, "tax_rate_id" UUID, "default_warranty_id" UUID,
  "purchase_price" DECIMAL(18,2), "selling_price" DECIMAL(18,2), "reorder_level" DECIMAL(18,3),
  "attributes" JSONB NOT NULL DEFAULT '{}', "custom_fields" JSONB NOT NULL DEFAULT '{}',
  "status" VARCHAR(10) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMPTZ(6) NOT NULL, "version" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "products_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "products_type_check" CHECK ("type" IN ('GOODS','SERVICE')),
  CONSTRAINT "products_status_check" CHECK ("status" IN ('DRAFT','ACTIVE','INACTIVE','ARCHIVED')),
  CONSTRAINT "products_service_not_stocked" CHECK ("type" = 'GOODS' OR ("track_inventory" = false AND "is_serialized" = false)),
  CONSTRAINT "products_serialized_tracks" CHECK (NOT "is_serialized" OR "track_inventory"),
  CONSTRAINT "products_imei_serialized" CHECK (NOT "requires_imei" OR "is_serialized"),
  CONSTRAINT "products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL,
  CONSTRAINT "products_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE SET NULL,
  CONSTRAINT "products_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE RESTRICT,
  CONSTRAINT "products_hsn_id_fkey" FOREIGN KEY ("hsn_id") REFERENCES "hsn_codes"("id") ON DELETE SET NULL,
  CONSTRAINT "products_tax_rate_id_fkey" FOREIGN KEY ("tax_rate_id") REFERENCES "tax_rates"("id") ON DELETE SET NULL,
  CONSTRAINT "products_default_warranty_id_fkey" FOREIGN KEY ("default_warranty_id") REFERENCES "warranty_policies"("id") ON DELETE SET NULL
);
CREATE UNIQUE INDEX "products_sku_uq" ON "products"("tenant_id", lower("sku"));
CREATE INDEX "products_tenant_id_status_idx" ON "products"("tenant_id", "status");
CREATE INDEX "products_tenant_id_name_idx" ON "products"("tenant_id", "name");
CREATE INDEX "products_search_trgm" ON "products" USING gin ((lower("name") || ' ' || lower("sku")) gin_trgm_ops);

CREATE TABLE "warehouses" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "code" VARCHAR(20) NOT NULL, "name" VARCHAR(100) NOT NULL,
  "address" JSONB NOT NULL, "state_code" CHAR(2) NOT NULL, "gstin" CHAR(15), "is_default" BOOLEAN NOT NULL DEFAULT false,
  "status" VARCHAR(10) NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMPTZ(6) NOT NULL, "version" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "warehouses_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "warehouses_status_check" CHECK ("status" IN ('ACTIVE','INACTIVE'))
);
CREATE UNIQUE INDEX "warehouses_tenant_code_uq" ON "warehouses"("tenant_id", lower("code"));
CREATE UNIQUE INDEX "one_default_wh" ON "warehouses"("tenant_id") WHERE "is_default";
CREATE INDEX "warehouses_tenant_id_status_idx" ON "warehouses"("tenant_id", "status");

CREATE TABLE "locations" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "warehouse_id" UUID NOT NULL, "code" VARCHAR(20) NOT NULL, "name" VARCHAR(100),
  "purpose" VARCHAR(15), "status" VARCHAR(10) NOT NULL DEFAULT 'ACTIVE',
  CONSTRAINT "locations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "locations_purpose_check" CHECK ("purpose" IS NULL OR "purpose" IN ('RECEIVING','QC','STORAGE','PACKING','DISPATCH','QUARANTINE')),
  CONSTRAINT "locations_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "locations_tenant_wh_code_uq" ON "locations"("tenant_id", "warehouse_id", lower("code"));
CREATE INDEX "locations_tenant_id_warehouse_id_idx" ON "locations"("tenant_id", "warehouse_id");

CREATE TABLE "bins" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "location_id" UUID NOT NULL, "code" VARCHAR(20) NOT NULL,
  "capacity" DECIMAL(18,3), "status" VARCHAR(10) NOT NULL DEFAULT 'ACTIVE', "version" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "bins_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "bins_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "bins_tenant_loc_code_uq" ON "bins"("tenant_id", "location_id", lower("code"));
CREATE INDEX "bins_tenant_id_location_id_idx" ON "bins"("tenant_id", "location_id");

CREATE TABLE "payment_terms" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "name" VARCHAR(60) NOT NULL, "days" INTEGER NOT NULL,
  "is_default" BOOLEAN NOT NULL DEFAULT false, "status" VARCHAR(10) NOT NULL DEFAULT 'ACTIVE',
  CONSTRAINT "payment_terms_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payment_terms_days_check" CHECK ("days" >= 0)
);
CREATE UNIQUE INDEX "payment_terms_tenant_name_uq" ON "payment_terms"("tenant_id", lower("name"));
CREATE UNIQUE INDEX "one_default_payment_term" ON "payment_terms"("tenant_id") WHERE "is_default";
CREATE INDEX "payment_terms_tenant_id_idx" ON "payment_terms"("tenant_id");

CREATE TABLE "numbering_configs" (
  "tenant_id" UUID NOT NULL, "doc_type" VARCHAR(10) NOT NULL, "prefix_template" VARCHAR(40) NOT NULL,
  "padding" INTEGER NOT NULL DEFAULT 4, "reset_each_fy" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "numbering_configs_pkey" PRIMARY KEY ("tenant_id", "doc_type")
);

CREATE TABLE "custom_field_defs" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "entity" VARCHAR(30) NOT NULL, "key" VARCHAR(40) NOT NULL, "label" VARCHAR(100) NOT NULL,
  "data_type" VARCHAR(10) NOT NULL, "options" JSONB, "required" BOOLEAN NOT NULL DEFAULT false, "status" VARCHAR(10) NOT NULL DEFAULT 'ACTIVE',
  CONSTRAINT "custom_field_defs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "custom_field_defs_data_type_check" CHECK ("data_type" IN ('TEXT','NUMBER','DATE','BOOLEAN','SELECT'))
);
CREATE UNIQUE INDEX "custom_field_defs_tenant_id_entity_key_key" ON "custom_field_defs"("tenant_id", "entity", "key");

CREATE TABLE "entity_references" (
  "tenant_id" UUID NOT NULL, "entity_type" VARCHAR(30) NOT NULL, "entity_id" UUID NOT NULL, "referenced_by" VARCHAR(30) NOT NULL,
  "first_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "entity_references_pkey" PRIMARY KEY ("tenant_id", "entity_type", "entity_id", "referenced_by")
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['units','tax_rates','hsn_codes','categories','brands','condition_grades','warranty_policies','products','warehouses','locations','bins','payment_terms','numbering_configs','custom_field_defs','entity_references'] LOOP
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
