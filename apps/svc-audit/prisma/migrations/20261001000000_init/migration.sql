-- svc-audit: append-only audit_events with Row-Level Security (ADR-0005) + standard tables.

CREATE TABLE "audit_events" (
  "id"             UUID NOT NULL,
  "event_id"       UUID NOT NULL,
  "tenant_id"      UUID,
  "producer"       VARCHAR(40) NOT NULL,
  "actor_type"     VARCHAR(10) NOT NULL,
  "actor_id"       UUID,
  "actor_name"     VARCHAR(150),
  "action"         VARCHAR(60) NOT NULL,
  "entity_type"    VARCHAR(60) NOT NULL,
  "entity_id"      UUID NOT NULL,
  "entity_version" INTEGER,
  "summary"        VARCHAR(500),
  "old_value"      JSONB,
  "new_value"      JSONB,
  "reason"         VARCHAR(500),
  "ip"             VARCHAR(45),
  "user_agent"     VARCHAR(400),
  "correlation_id" VARCHAR(128) NOT NULL,
  "occurred_at"    TIMESTAMPTZ(6) NOT NULL,
  "recorded_at"    TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "audit_events_event_id_key" ON "audit_events"("event_id");
CREATE INDEX "audit_events_tenant_id_occurred_at_idx" ON "audit_events"("tenant_id", "occurred_at");
CREATE INDEX "audit_events_tenant_id_entity_type_entity_id_idx" ON "audit_events"("tenant_id", "entity_type", "entity_id");
CREATE INDEX "audit_events_tenant_id_action_idx" ON "audit_events"("tenant_id", "action");
CREATE INDEX "audit_events_correlation_id_idx" ON "audit_events"("correlation_id");
COMMENT ON TABLE "audit_events" IS 'append-only';

-- RLS: tenant context sees its own rows; platform context sees everything (including tenant_id NULL).
ALTER TABLE "audit_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_events" FORCE ROW LEVEL SECURITY;
-- nullif(...)::uuid: an unset/empty setting becomes NULL (never a cast error); "col = NULL" is false.
CREATE POLICY tenant_isolation ON "audit_events"
  USING (
    current_setting('app.platform', true) = 'true'
    OR "tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid
  )
  WITH CHECK (
    current_setting('app.platform', true) = 'true'
    OR "tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid
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
