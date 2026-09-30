-- Laptop configurations: the product master is laptop-specific. A configuration (one purchasable
-- variant) is identified by exactly eight specifications, each chosen from a tenant master.

CREATE TABLE "laptop_spec_options" (
  "id"         UUID         NOT NULL,
  "tenant_id"  UUID         NOT NULL,
  -- BRAND | MODEL | GENERATION | PROCESSOR | RAM | SSD | GPU | SCREEN_SIZE
  "kind"       VARCHAR(20)  NOT NULL,
  "name"       VARCHAR(100) NOT NULL,
  -- Short token used to build SKUs (e.g. DELL, LAT5440, I5, 16, 512)
  "code"       VARCHAR(20)  NOT NULL,
  -- Models belong to a brand
  "brand_id"   UUID,
  "sort_order" INTEGER      NOT NULL DEFAULT 0,
  "status"     VARCHAR(10)  NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "version"    INTEGER      NOT NULL DEFAULT 0,
  CONSTRAINT "laptop_spec_options_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "laptop_spec_options_kind_chk" CHECK ("kind" IN ('BRAND','MODEL','GENERATION','PROCESSOR','RAM','SSD','GPU','SCREEN_SIZE')),
  CONSTRAINT "laptop_spec_options_status_chk" CHECK ("status" IN ('ACTIVE','INACTIVE')),
  CONSTRAINT "laptop_spec_options_model_brand_chk" CHECK (("kind" = 'MODEL') = ("brand_id" IS NOT NULL)),
  CONSTRAINT "laptop_spec_options_brand_fkey" FOREIGN KEY ("brand_id") REFERENCES "laptop_spec_options"("id") ON DELETE RESTRICT
);
-- One value per kind (models: per brand), ignoring case.
CREATE UNIQUE INDEX "laptop_spec_options_name_uq" ON "laptop_spec_options"("tenant_id", "kind", coalesce("brand_id", '00000000-0000-0000-0000-000000000000'::uuid), lower("name"));
CREATE INDEX "laptop_spec_options_tenant_kind_idx" ON "laptop_spec_options"("tenant_id", "kind", "status");

ALTER TABLE "laptop_spec_options" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "laptop_spec_options" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "laptop_spec_options"
  USING (current_setting('app.platform', true) = 'true' OR tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (current_setting('app.platform', true) = 'true' OR tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "products"
  ADD COLUMN "brand_spec_id"       UUID,
  ADD COLUMN "model_spec_id"       UUID,
  ADD COLUMN "generation_spec_id"  UUID,
  ADD COLUMN "processor_spec_id"   UUID,
  ADD COLUMN "ram_spec_id"         UUID,
  ADD COLUMN "ssd_spec_id"         UUID,
  ADD COLUMN "gpu_spec_id"         UUID,
  ADD COLUMN "screen_size_spec_id" UUID,
  -- Names of the eight specs, copied so snapshots and documents never need a join
  ADD COLUMN "specs"               JSONB,
  -- The eight spec ids joined: two configurations with identical specs cannot coexist
  ADD COLUMN "config_key"          TEXT,
  ADD CONSTRAINT "products_brand_spec_fkey"       FOREIGN KEY ("brand_spec_id")       REFERENCES "laptop_spec_options"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "products_model_spec_fkey"       FOREIGN KEY ("model_spec_id")       REFERENCES "laptop_spec_options"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "products_generation_spec_fkey"  FOREIGN KEY ("generation_spec_id")  REFERENCES "laptop_spec_options"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "products_processor_spec_fkey"   FOREIGN KEY ("processor_spec_id")   REFERENCES "laptop_spec_options"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "products_ram_spec_fkey"         FOREIGN KEY ("ram_spec_id")         REFERENCES "laptop_spec_options"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "products_ssd_spec_fkey"         FOREIGN KEY ("ssd_spec_id")         REFERENCES "laptop_spec_options"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "products_gpu_spec_fkey"         FOREIGN KEY ("gpu_spec_id")         REFERENCES "laptop_spec_options"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "products_screen_size_spec_fkey" FOREIGN KEY ("screen_size_spec_id") REFERENCES "laptop_spec_options"("id") ON DELETE RESTRICT,
  -- A laptop configuration has all eight specs or none (legacy non-laptop rows)
  ADD CONSTRAINT "products_laptop_specs_complete_chk" CHECK (
    num_nonnulls("brand_spec_id","model_spec_id","generation_spec_id","processor_spec_id","ram_spec_id","ssd_spec_id","gpu_spec_id","screen_size_spec_id") IN (0, 8)
  );
CREATE UNIQUE INDEX "products_config_key_uq" ON "products"("tenant_id", "config_key") WHERE "config_key" IS NOT NULL;
