-- svc-party initial schema (phase-03 3.5) with RLS on every tenant table.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE "parties" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "party_type" VARCHAR(10) NOT NULL, "code" VARCHAR(40) NOT NULL,
  "legal_name" VARCHAR(200) NOT NULL, "display_name" VARCHAR(150) NOT NULL, "gst_treatment" VARCHAR(15) NOT NULL,
  "gstin" CHAR(15), "pan" CHAR(10), "payment_term_id" UUID, "credit_limit" DECIMAL(18,2), "credit_days" INTEGER,
  "email" VARCHAR(254), "phone" VARCHAR(30), "website" VARCHAR(200),
  "status" VARCHAR(10) NOT NULL DEFAULT 'ACTIVE', "blocked_reason" VARCHAR(500), "linked_party_id" UUID, "remarks" TEXT,
  "custom_fields" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMPTZ(6) NOT NULL, "version" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "parties_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "parties_party_type_check" CHECK ("party_type" IN ('SUPPLIER','CUSTOMER')),
  CONSTRAINT "parties_gst_treatment_check" CHECK ("gst_treatment" IN ('REGISTERED','UNREGISTERED','COMPOSITION','CONSUMER','OVERSEAS','SEZ')),
  CONSTRAINT "parties_status_check" CHECK ("status" IN ('ACTIVE','INACTIVE','BLOCKED')),
  CONSTRAINT "parties_registered_needs_gstin" CHECK ("gst_treatment" NOT IN ('REGISTERED','COMPOSITION','SEZ') OR "gstin" IS NOT NULL),
  CONSTRAINT "parties_gstin_format" CHECK ("gstin" IS NULL OR "gstin" ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$')
);
CREATE UNIQUE INDEX "parties_tenant_type_code_uq" ON "parties"("tenant_id", "party_type", lower("code"));
CREATE UNIQUE INDEX "party_gstin_uq" ON "parties"("tenant_id", "party_type", "gstin") WHERE "gstin" IS NOT NULL;
CREATE INDEX "parties_tenant_id_party_type_status_idx" ON "parties"("tenant_id", "party_type", "status");
CREATE INDEX "parties_tenant_id_display_name_idx" ON "parties"("tenant_id", "display_name");
CREATE INDEX "parties_search_trgm" ON "parties" USING gin ((lower("display_name") || ' ' || lower("legal_name") || ' ' || coalesce("gstin", '')) gin_trgm_ops);

CREATE TABLE "party_addresses" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "party_id" UUID NOT NULL, "kind" VARCHAR(10) NOT NULL, "attention" VARCHAR(100),
  "line1" VARCHAR(200) NOT NULL, "line2" VARCHAR(200), "city" VARCHAR(100) NOT NULL, "state" VARCHAR(100), "state_code" CHAR(2) NOT NULL,
  "pincode" VARCHAR(10) NOT NULL, "country" CHAR(2) NOT NULL DEFAULT 'IN', "phone" VARCHAR(30), "is_default" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "party_addresses_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "party_addresses_kind_check" CHECK ("kind" IN ('BILLING','SHIPPING')),
  CONSTRAINT "party_addresses_pincode_in" CHECK ("country" <> 'IN' OR "pincode" ~ '^[1-9][0-9]{5}$'),
  CONSTRAINT "party_addresses_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE CASCADE
);
CREATE INDEX "party_addresses_tenant_id_party_id_idx" ON "party_addresses"("tenant_id", "party_id");
CREATE UNIQUE INDEX "party_addresses_one_default_per_kind" ON "party_addresses"("party_id", "kind") WHERE "is_default";

CREATE TABLE "party_contacts" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "party_id" UUID NOT NULL, "name" VARCHAR(150) NOT NULL,
  "email" VARCHAR(254), "phone" VARCHAR(30), "designation" VARCHAR(100), "is_primary" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "party_contacts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "party_contacts_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE CASCADE
);
CREATE INDEX "party_contacts_tenant_id_party_id_idx" ON "party_contacts"("tenant_id", "party_id");
CREATE UNIQUE INDEX "party_contacts_one_primary" ON "party_contacts"("party_id") WHERE "is_primary";

CREATE TABLE "party_bank_accounts" (
  "id" UUID NOT NULL, "tenant_id" UUID NOT NULL, "party_id" UUID NOT NULL, "bank_name" VARCHAR(100) NOT NULL,
  "account_holder" VARCHAR(150) NOT NULL, "account_number_enc" TEXT NOT NULL, "account_last4" VARCHAR(4) NOT NULL, "ifsc" CHAR(11) NOT NULL,
  "branch" VARCHAR(100), "account_type" VARCHAR(15) NOT NULL DEFAULT 'CURRENT', "is_primary" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "party_bank_accounts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "party_bank_accounts_type_check" CHECK ("account_type" IN ('SAVINGS','CURRENT','CASH_CREDIT','OVERDRAFT','OTHER')),
  CONSTRAINT "party_bank_accounts_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE CASCADE
);
CREATE INDEX "party_bank_accounts_tenant_id_party_id_idx" ON "party_bank_accounts"("tenant_id", "party_id");

CREATE TABLE "entity_references" (
  "tenant_id" UUID NOT NULL, "entity_type" VARCHAR(30) NOT NULL, "entity_id" UUID NOT NULL, "referenced_by" VARCHAR(30) NOT NULL,
  "first_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "entity_references_pkey" PRIMARY KEY ("tenant_id", "entity_type", "entity_id", "referenced_by")
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['parties','party_addresses','party_contacts','party_bank_accounts','entity_references'] LOOP
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
