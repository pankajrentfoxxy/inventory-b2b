#!/bin/bash
# Database-per-service bootstrap (phase-plan/README.md 2 and phase-00 step 4, ADR-0001).
#
# For every service: database <svc>_db, a runtime role <svc>_role (DML only, no DDL, not a
# superuser, no BYPASSRLS) that can CONNECT to its own database only, and a migration role
# <svc>_migrator that owns the schema. Runs once, on first container start (docker-entrypoint-initdb.d).
set -euo pipefail

ROLE_PASSWORD="${SERVICE_ROLE_PASSWORD:-b2b_dev}"

# Phase 0 creates only what Phase 0/1 needs; later phases append to this list (the script is
# idempotent, so re-running it on an existing cluster is safe).
SERVICES=(
  audit
  auth
  tenant
  notification
  iam
  master
  party
  inventory
  procurement
  qc
  sales
  fulfillment
  returns
  billing
  payment
  reporting
  legacy
)

psql_admin() {
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres "$@"
}

for svc in "${SERVICES[@]}"; do
  db="${svc}_db"
  role="${svc}_role"
  migrator="${svc}_migrator"

  psql_admin <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${migrator}') THEN
    CREATE ROLE ${migrator} LOGIN PASSWORD '${ROLE_PASSWORD}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN
    CREATE ROLE ${role} LOGIN PASSWORD '${ROLE_PASSWORD}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
\$\$;
SQL

  if ! psql_admin -tAc "SELECT 1 FROM pg_database WHERE datname = '${db}'" | grep -q 1; then
    psql_admin -c "CREATE DATABASE ${db} OWNER ${migrator} ENCODING 'UTF8' TEMPLATE template0"
  fi

  # Nobody but the two service roles may connect to this database.
  psql_admin <<SQL
REVOKE ALL ON DATABASE ${db} FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE ${db} TO ${migrator};
GRANT CONNECT ON DATABASE ${db} TO ${role};
SQL

  # Inside the database: migrator owns public; runtime role gets DML on everything, now and later.
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$db" <<SQL
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
ALTER SCHEMA public OWNER TO ${migrator};
GRANT USAGE ON SCHEMA public TO ${role};
ALTER DEFAULT PRIVILEGES FOR ROLE ${migrator} IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${role};
ALTER DEFAULT PRIVILEGES FOR ROLE ${migrator} IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${role};
SQL
done

# Every other service database is explicitly off limits for every runtime role (README 5.2 / ADR-0001).
for svc in "${SERVICES[@]}"; do
  for other in "${SERVICES[@]}"; do
    if [ "$svc" != "$other" ]; then
      psql_admin -c "REVOKE ALL ON DATABASE ${other}_db FROM ${svc}_role, ${svc}_migrator" >/dev/null
    fi
  done
done

echo "service databases and roles ready: ${SERVICES[*]}"
