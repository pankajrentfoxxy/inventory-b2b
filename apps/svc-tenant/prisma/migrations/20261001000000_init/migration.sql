-- svc-tenant initial schema (phase-01 1.5) + standard platform tables.

CREATE TABLE "tenants" (
  "id"                 UUID NOT NULL,
  "code"               VARCHAR(40) NOT NULL,
  "legal_name"         VARCHAR(200) NOT NULL,
  "display_name"       VARCHAR(150) NOT NULL,
  "pan"                CHAR(10),
  "gstin"              CHAR(15),
  "registered_address" JSONB NOT NULL,
  "state_code"         CHAR(2),
  "owner_name"         VARCHAR(150) NOT NULL,
  "owner_email"        VARCHAR(254) NOT NULL,
  "owner_phone"        VARCHAR(30),
  "status"             VARCHAR(15) NOT NULL,
  "status_reason"      VARCHAR(500),
  "source"             VARCHAR(20) NOT NULL,
  "created_by"         UUID,
  "approved_by"        UUID,
  "approved_at"        TIMESTAMPTZ(6),
  "activated_at"       TIMESTAMPTZ(6),
  "suspended_at"       TIMESTAMPTZ(6),
  "deactivated_at"     TIMESTAMPTZ(6),
  "created_at"         TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"         TIMESTAMPTZ(6) NOT NULL,
  "version"            INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "tenants_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tenants_status_check" CHECK ("status" IN ('PENDING','APPROVED','ACTIVE','SUSPENDED','DEACTIVATED','REJECTED')),
  CONSTRAINT "tenants_source_check" CHECK ("source" IN ('ADMIN_CREATED','APPLICATION','LEGACY_MIGRATION'))
);
CREATE UNIQUE INDEX "tenants_code_key" ON "tenants"("code");
CREATE UNIQUE INDEX "tenants_gstin_uq" ON "tenants"("gstin") WHERE "gstin" IS NOT NULL AND "status" <> 'REJECTED';
CREATE INDEX "tenants_status_created_at_idx" ON "tenants"("status", "created_at");
CREATE INDEX "tenants_owner_email_idx" ON "tenants"("owner_email");

CREATE TABLE "tenant_status_history" (
  "id"          UUID NOT NULL,
  "tenant_id"   UUID NOT NULL,
  "from_status" VARCHAR(15),
  "to_status"   VARCHAR(15) NOT NULL,
  "reason"      VARCHAR(500),
  "actor_id"    UUID,
  "actor_name"  VARCHAR(150),
  "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tenant_status_history_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tenant_status_history_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "tenant_status_history_tenant_id_occurred_at_idx" ON "tenant_status_history"("tenant_id", "occurred_at");

CREATE TABLE "tenant_settings" (
  "tenant_id"      UUID NOT NULL,
  "timezone"       VARCHAR(60) NOT NULL DEFAULT 'Asia/Kolkata',
  "fy_start_month" INTEGER NOT NULL DEFAULT 4,
  "base_currency"  CHAR(3) NOT NULL DEFAULT 'INR',
  "features"       JSONB NOT NULL DEFAULT '{}',
  "limits"         JSONB NOT NULL DEFAULT '{}',
  CONSTRAINT "tenant_settings_pkey" PRIMARY KEY ("tenant_id"),
  CONSTRAINT "tenant_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "vendor_applications" (
  "id"            UUID NOT NULL,
  "tenant_id"     UUID,
  "payload"       JSONB NOT NULL,
  "submitted_ip"  VARCHAR(45),
  "captcha_score" DECIMAL(4,3),
  "created_at"    TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "vendor_applications_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "vendor_applications_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "idempotency_keys" (
  "tenant_id"     UUID NOT NULL,
  "scope"         TEXT NOT NULL,
  "key"           UUID NOT NULL,
  "request_hash"  CHAR(64) NOT NULL,
  "status"        VARCHAR(20) NOT NULL DEFAULT 'IN_PROGRESS',
  "response_code" INTEGER,
  "response_body" JSONB,
  "created_at"    TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at"    TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("tenant_id", "scope", "key")
);
CREATE INDEX "idempotency_keys_expires_at_idx" ON "idempotency_keys"("expires_at");

CREATE TABLE "outbox_events" (
  "id"              UUID NOT NULL,
  "tenant_id"       UUID,
  "event_type"      TEXT NOT NULL,
  "event_version"   INTEGER NOT NULL,
  "aggregate_type"  TEXT NOT NULL,
  "aggregate_id"    UUID NOT NULL,
  "envelope"        JSONB NOT NULL,
  "created_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "published_at"    TIMESTAMPTZ(6),
  "attempts"        INTEGER NOT NULL DEFAULT 0,
  "last_error"      TEXT,
  "next_attempt_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "outbox_unpublished" ON "outbox_events"("next_attempt_at", "created_at") WHERE "published_at" IS NULL;

CREATE TABLE "processed_events" (
  "consumer"     TEXT NOT NULL,
  "event_id"     UUID NOT NULL,
  "processed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "processed_events_pkey" PRIMARY KEY ("consumer", "event_id")
);
