-- svc-iam initial schema (phase-02 2.5) with Row-Level Security on tenant-scoped tables.

CREATE TABLE "permissions" (
  "code"          VARCHAR(80) NOT NULL,
  "module"        VARCHAR(40) NOT NULL,
  "scope"         VARCHAR(10) NOT NULL,
  "description"   VARCHAR(200) NOT NULL,
  "is_sensitive"  BOOLEAN NOT NULL DEFAULT false,
  "deprecated_at" TIMESTAMPTZ(6),
  CONSTRAINT "permissions_pkey" PRIMARY KEY ("code"),
  CONSTRAINT "permissions_scope_check" CHECK ("scope" IN ('TENANT','PLATFORM'))
);

CREATE TABLE "roles" (
  "id"          UUID NOT NULL,
  "tenant_id"   UUID,
  "key"         VARCHAR(60) NOT NULL,
  "name"        VARCHAR(100) NOT NULL,
  "description" VARCHAR(300),
  "is_system"   BOOLEAN NOT NULL DEFAULT false,
  "rank"        INTEGER NOT NULL,
  "created_by"  UUID,
  "created_at"  TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMPTZ(6) NOT NULL,
  "version"     INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "roles_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "roles_rank_check" CHECK ("rank" BETWEEN 1 AND 100)
);
CREATE UNIQUE INDEX "roles_tenant_key_uq" ON "roles"("tenant_id", "key") WHERE "tenant_id" IS NOT NULL;
CREATE UNIQUE INDEX "roles_platform_key_uq" ON "roles"("key") WHERE "tenant_id" IS NULL;
CREATE INDEX "roles_tenant_id_idx" ON "roles"("tenant_id");

CREATE TABLE "role_permissions" (
  "role_id"         UUID NOT NULL,
  "permission_code" VARCHAR(80) NOT NULL,
  "tenant_id"       UUID,
  CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id", "permission_code"),
  CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "role_permissions_permission_code_fkey" FOREIGN KEY ("permission_code") REFERENCES "permissions"("code") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "role_permissions_tenant_id_idx" ON "role_permissions"("tenant_id");

CREATE TABLE "memberships" (
  "id"                 UUID NOT NULL,
  "tenant_id"          UUID,
  "user_id"            UUID NOT NULL,
  "email"              VARCHAR(254) NOT NULL,
  "full_name"          VARCHAR(150) NOT NULL,
  "status"             VARCHAR(10) NOT NULL,
  "permission_version" INTEGER NOT NULL DEFAULT 1,
  "all_warehouses"     BOOLEAN NOT NULL DEFAULT true,
  "joined_at"          TIMESTAMPTZ(6),
  "suspended_at"       TIMESTAMPTZ(6),
  "removed_at"         TIMESTAMPTZ(6),
  "status_reason"      VARCHAR(500),
  "created_at"         TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"         TIMESTAMPTZ(6) NOT NULL,
  "version"            INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "memberships_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "memberships_status_check" CHECK ("status" IN ('INVITED','ACTIVE','SUSPENDED','REMOVED'))
);
CREATE UNIQUE INDEX "memberships_tenant_user_uq" ON "memberships"("tenant_id", "user_id") WHERE "tenant_id" IS NOT NULL;
CREATE UNIQUE INDEX "memberships_platform_user_uq" ON "memberships"("user_id") WHERE "tenant_id" IS NULL;
CREATE INDEX "memberships_tenant_id_status_idx" ON "memberships"("tenant_id", "status");
CREATE INDEX "memberships_user_id_idx" ON "memberships"("user_id");

CREATE TABLE "membership_roles" (
  "membership_id" UUID NOT NULL,
  "role_id"       UUID NOT NULL,
  "tenant_id"     UUID,
  "assigned_by"   UUID,
  "assigned_at"   TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "membership_roles_pkey" PRIMARY KEY ("membership_id", "role_id"),
  CONSTRAINT "membership_roles_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "membership_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "membership_roles_role_id_idx" ON "membership_roles"("role_id");

CREATE TABLE "membership_warehouse_scopes" (
  "membership_id" UUID NOT NULL,
  "warehouse_id"  UUID NOT NULL,
  "tenant_id"     UUID NOT NULL,
  CONSTRAINT "membership_warehouse_scopes_pkey" PRIMARY KEY ("membership_id", "warehouse_id"),
  CONSTRAINT "membership_warehouse_scopes_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "invitations" (
  "id"              UUID NOT NULL,
  "tenant_id"       UUID,
  "email"           VARCHAR(254) NOT NULL,
  "full_name"       VARCHAR(150),
  "role_ids"        UUID[] NOT NULL,
  "warehouse_ids"   UUID[] NOT NULL DEFAULT '{}',
  "token_hash"      CHAR(64) NOT NULL,
  "status"          VARCHAR(10) NOT NULL,
  "invited_by"      UUID,
  "invited_by_name" VARCHAR(150),
  "expires_at"      TIMESTAMPTZ(6) NOT NULL,
  "accepted_at"     TIMESTAMPTZ(6),
  "created_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "invitations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "invitations_status_check" CHECK ("status" IN ('PENDING','ACCEPTED','REVOKED','EXPIRED'))
);
CREATE UNIQUE INDEX "invitations_token_hash_key" ON "invitations"("token_hash");
CREATE UNIQUE INDEX "invitations_one_pending" ON "invitations"("tenant_id", "email") WHERE "status" = 'PENDING' AND "tenant_id" IS NOT NULL;
CREATE UNIQUE INDEX "invitations_one_pending_platform" ON "invitations"("email") WHERE "status" = 'PENDING' AND "tenant_id" IS NULL;
CREATE INDEX "invitations_tenant_id_status_idx" ON "invitations"("tenant_id", "status");

-- Row-Level Security (ADR-0005). Platform context sees everything (including tenant_id NULL rows);
-- a tenant context sees only its own rows. nullif(...)::uuid never raises on an empty setting.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['roles','role_permissions','memberships','membership_roles','membership_warehouse_scopes','invitations'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (current_setting('app.platform', true) = 'true' OR tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
      WITH CHECK (current_setting('app.platform', true) = 'true' OR tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)$p$, t);
  END LOOP;
END $$;

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
