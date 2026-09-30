CREATE TABLE "deliveries" (
  "id"             UUID NOT NULL,
  "event_id"       UUID NOT NULL,
  "tenant_id"      UUID,
  "channel"        VARCHAR(10) NOT NULL DEFAULT 'EMAIL',
  "recipient"      VARCHAR(254) NOT NULL,
  "template"       VARCHAR(60) NOT NULL,
  "subject"        VARCHAR(200) NOT NULL,
  "body_text"      TEXT NOT NULL,
  "status"         VARCHAR(10) NOT NULL,
  "error"          VARCHAR(500),
  "correlation_id" VARCHAR(128) NOT NULL,
  "created_at"     TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "deliveries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "deliveries_status_check" CHECK ("status" IN ('SENT','FAILED','SKIPPED'))
);
CREATE UNIQUE INDEX "deliveries_event_id_key" ON "deliveries"("event_id");
CREATE INDEX "deliveries_recipient_created_at_idx" ON "deliveries"("recipient", "created_at");
CREATE INDEX "deliveries_tenant_id_created_at_idx" ON "deliveries"("tenant_id", "created_at");

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
