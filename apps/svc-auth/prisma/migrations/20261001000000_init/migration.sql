-- svc-auth initial schema (phase-01 section 1.5) + standard platform tables.

CREATE TABLE "users" (
  "id"                 UUID NOT NULL,
  "email"              VARCHAR(254) NOT NULL,
  "phone"              VARCHAR(30),
  "full_name"          VARCHAR(150) NOT NULL,
  "user_type"          VARCHAR(10) NOT NULL,
  "password_hash"      TEXT,
  "password_algo"      VARCHAR(20) NOT NULL DEFAULT 'argon2id',
  "mfa_secret_enc"     TEXT,
  "mfa_enabled"        BOOLEAN NOT NULL DEFAULT false,
  "status"             VARCHAR(10) NOT NULL DEFAULT 'ACTIVE',
  "failed_login_count" INTEGER NOT NULL DEFAULT 0,
  "locked_until"       TIMESTAMPTZ(6),
  "last_login_at"      TIMESTAMPTZ(6),
  "created_at"         TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"         TIMESTAMPTZ(6) NOT NULL,
  "version"            INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "users_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "users_user_type_check" CHECK ("user_type" IN ('PLATFORM','TENANT')),
  CONSTRAINT "users_status_check" CHECK ("status" IN ('INVITED','ACTIVE','LOCKED','DISABLED')),
  CONSTRAINT "users_email_lower_check" CHECK ("email" = lower("email"))
);
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

CREATE TABLE "sessions" (
  "id"            UUID NOT NULL,
  "user_id"       UUID NOT NULL,
  "tenant_id"     UUID,
  "membership_id" UUID,
  "token_type"    VARCHAR(10) NOT NULL,
  "ip"            VARCHAR(45),
  "user_agent"    VARCHAR(400),
  "created_at"    TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_seen_at"  TIMESTAMPTZ(6),
  "revoked_at"    TIMESTAMPTZ(6),
  "revoke_reason" VARCHAR(100),
  CONSTRAINT "sessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");
CREATE INDEX "sessions_tenant_id_idx" ON "sessions"("tenant_id");
CREATE INDEX "sessions_membership_id_idx" ON "sessions"("membership_id");

CREATE TABLE "refresh_tokens" (
  "id"         UUID NOT NULL,
  "session_id" UUID NOT NULL,
  "token_hash" CHAR(64) NOT NULL,
  "family_id"  UUID NOT NULL,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "used_at"    TIMESTAMPTZ(6),
  "revoked_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "refresh_tokens_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");
CREATE INDEX "refresh_tokens_family_id_idx" ON "refresh_tokens"("family_id");
CREATE INDEX "refresh_tokens_session_id_idx" ON "refresh_tokens"("session_id");

CREATE TABLE "password_reset_tokens" (
  "id"         UUID NOT NULL,
  "user_id"    UUID NOT NULL,
  "token_hash" CHAR(64) NOT NULL,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "used_at"    TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "password_reset_tokens_token_hash_key" ON "password_reset_tokens"("token_hash");
CREATE INDEX "password_reset_tokens_user_id_idx" ON "password_reset_tokens"("user_id");

CREATE TABLE "invite_tokens" (
  "id"         UUID NOT NULL,
  "user_id"    UUID NOT NULL,
  "tenant_id"  UUID,
  "kind"       VARCHAR(20) NOT NULL,
  "token_hash" CHAR(64) NOT NULL,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "used_at"    TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "invite_tokens_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "invite_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "invite_tokens_token_hash_key" ON "invite_tokens"("token_hash");
CREATE INDEX "invite_tokens_user_id_idx" ON "invite_tokens"("user_id");

CREATE TABLE "platform_role_assignments" (
  "user_id" UUID NOT NULL,
  "role"    VARCHAR(40) NOT NULL,
  CONSTRAINT "platform_role_assignments_pkey" PRIMARY KEY ("user_id", "role"),
  CONSTRAINT "platform_role_assignments_role_check" CHECK ("role" IN ('PLATFORM_SUPER_ADMIN','PLATFORM_REVIEWER','PLATFORM_SUPPORT')),
  CONSTRAINT "platform_role_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "tenant_memberships_bootstrap" (
  "id"         UUID NOT NULL,
  "tenant_id"  UUID NOT NULL,
  "user_id"    UUID NOT NULL,
  "role"       VARCHAR(40) NOT NULL DEFAULT 'OWNER',
  "status"     VARCHAR(10) NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tenant_memberships_bootstrap_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tenant_memberships_bootstrap_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "tenant_memberships_bootstrap_tenant_id_user_id_key" ON "tenant_memberships_bootstrap"("tenant_id", "user_id");
CREATE INDEX "tenant_memberships_bootstrap_user_id_idx" ON "tenant_memberships_bootstrap"("user_id");

CREATE TABLE "tenant_status_replica" (
  "tenant_id"  UUID NOT NULL,
  "status"     VARCHAR(15) NOT NULL,
  "version"    INTEGER NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tenant_status_replica_pkey" PRIMARY KEY ("tenant_id")
);

CREATE TABLE "signing_keys" (
  "kid"             VARCHAR(40) NOT NULL,
  "private_key_enc" TEXT NOT NULL,
  "public_key_pem"  TEXT NOT NULL,
  "active"          BOOLEAN NOT NULL DEFAULT true,
  "created_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "retired_at"      TIMESTAMPTZ(6),
  CONSTRAINT "signing_keys_pkey" PRIMARY KEY ("kid")
);

-- standard platform tables (identical in every service database)
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
