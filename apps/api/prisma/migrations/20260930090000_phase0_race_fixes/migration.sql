-- Phase 0 (architecture foundation): legacy procurement race-condition fixes R1-R7 and the
-- platform plumbing tables (idempotency keys, outbox, inbox) that every service database carries.
--
-- PRE-CHECK before applying to a production copy. Both queries must return zero rows; if they do
-- not, run the documented data correction in docs/phase-0/verification.md first.
--
--   SELECT id FROM purchase_order_lines WHERE received_quantity < 0 OR received_quantity > quantity;
--   SELECT l.id FROM purchase_order_lines l
--     LEFT JOIN (SELECT gl.purchase_order_line_id, sum(gl.quantity) q
--                  FROM purchase_receive_lines gl JOIN purchase_receives g ON g.id = gl.purchase_receive_id
--                 WHERE g.status <> 'CANCELLED' GROUP BY gl.purchase_order_line_id) r
--            ON r.purchase_order_line_id = l.id
--    WHERE coalesce(r.q, 0) <> l.received_quantity;

-- R4: optimistic concurrency token on the purchase order aggregate. Every write bumps it.
ALTER TABLE "purchase_orders" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;

-- R1 / R5 / R7: the database is the last line of defence against over-receipt.
ALTER TABLE "purchase_order_lines"
  ADD CONSTRAINT "purchase_order_lines_received_within_ordered"
  CHECK ("received_quantity" >= 0 AND "received_quantity" <= "quantity");

-- R2: natural idempotency for GRN creation (belt and braces next to idempotency_keys).
ALTER TABLE "purchase_receives" ADD COLUMN "idempotency_key" UUID;
CREATE UNIQUE INDEX "purchase_receives_organization_id_idempotency_key_key"
  ON "purchase_receives"("organization_id", "idempotency_key");

-- README 5.6: idempotency keys. No foreign key to organizations on purpose: this table moves into
-- each service database unchanged.
CREATE TABLE "idempotency_keys" (
  "tenant_id"     UUID         NOT NULL,
  "scope"         TEXT         NOT NULL,
  "key"           UUID         NOT NULL,
  "request_hash"  CHAR(64)     NOT NULL,
  "status"        VARCHAR(20)  NOT NULL DEFAULT 'IN_PROGRESS',
  "response_code" INTEGER,
  "response_body" JSONB,
  "created_at"    TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at"    TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("tenant_id", "scope", "key")
);
CREATE INDEX "idempotency_keys_expires_at_idx" ON "idempotency_keys"("expires_at");

-- README 5.8 / Phase 0 step 4: transactional outbox. Rows are inserted in the same transaction as
-- the state change and published by the relay (FOR UPDATE SKIP LOCKED).
CREATE TABLE "outbox_events" (
  "id"              UUID         NOT NULL,
  "tenant_id"       UUID,
  "event_type"      TEXT         NOT NULL,
  "event_version"   INTEGER      NOT NULL,
  "aggregate_type"  TEXT         NOT NULL,
  "aggregate_id"    UUID         NOT NULL,
  "envelope"        JSONB        NOT NULL,
  "created_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "published_at"    TIMESTAMPTZ(6),
  "attempts"        INTEGER      NOT NULL DEFAULT 0,
  "last_error"      TEXT,
  "next_attempt_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "outbox_unpublished" ON "outbox_events"("next_attempt_at", "created_at") WHERE "published_at" IS NULL;

-- Inbox: exactly-once effect on top of at-least-once delivery.
CREATE TABLE "processed_events" (
  "consumer"     TEXT         NOT NULL,
  "event_id"     UUID         NOT NULL,
  "processed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "processed_events_pkey" PRIMARY KEY ("consumer", "event_id")
);
