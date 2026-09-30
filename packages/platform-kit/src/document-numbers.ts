/**
 * Document numbers for services that own documents (adjustments, POs, GRNs, QC lots...).
 * svc-master owns the *format* (numbering_configs); the owning service holds the *sequence* in its
 * own database so the number is claimed inside the create transaction (an atomic upsert on
 * `document_sequences`, no client-supplied numbers, no gaps from rolled-back reads).
 */
import type { SqlClient } from './db.js';
import type { Logger } from './logger.js';
import type { ServiceClient } from './service-client.js';

export interface NumberingConfig {
  /** e.g. "PO/{FY}/" -> PO/26-27/0001. Tokens: {FY}, {YYYY}, {YY}, {MM}. */
  prefixTemplate: string;
  padding: number;
  resetEachFy: boolean;
}

export interface NumberingSource {
  configFor(tenantId: string, docType: string, correlationId: string): Promise<NumberingConfig>;
}

export function financialYear(date: Date, startMonth = 4): string {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + 1;
  const start = m >= startMonth ? y : y - 1;
  return `${String(start).slice(-2)}-${String(start + 1).slice(-2)}`;
}

export const defaultNumbering = (docType: string): NumberingConfig => ({ prefixTemplate: `${docType}/{FY}/`, padding: 4, resetEachFy: true });

export const defaultNumberingSource: NumberingSource = { configFor: async (_tenantId, docType) => defaultNumbering(docType) };

/** Asks svc-master for the tenant's format; falls back to the default format when master is unavailable. */
export function createMasterNumberingSource(client: ServiceClient, logger: Logger): NumberingSource {
  return {
    async configFor(tenantId, docType, correlationId) {
      try {
        const res = await client.call<{ data: NumberingConfig }>(`/internal/v1/numbering/${docType}`, { correlationId, onBehalfOfTenant: tenantId });
        return { prefixTemplate: res.data.prefixTemplate, padding: res.data.padding, resetEachFy: res.data.resetEachFy };
      } catch (err) {
        logger.warn({ err, tenantId, docType }, 'numbering config unavailable from svc-master; using default format');
        return defaultNumbering(docType);
      }
    },
  };
}

export function formatDocumentNumber(config: NumberingConfig, sequence: number, now: Date): string {
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const prefix = config.prefixTemplate.replace('{FY}', financialYear(now)).replace('{YYYY}', yyyy).replace('{YY}', yyyy.slice(-2)).replace('{MM}', mm);
  return `${prefix}${String(sequence).padStart(config.padding, '0')}`;
}

/** Claims the next number inside the caller's transaction (row-level atomic upsert). */
export async function nextDocumentNumber(tx: SqlClient, input: { tenantId: string; docType: string; config: NumberingConfig; now?: Date }): Promise<string> {
  const now = input.now ?? new Date();
  const fy = input.config.resetEachFy ? financialYear(now) : 'ALL';
  const rows = await tx.$queryRaw<{ last_no: number }[]>`
    INSERT INTO "document_sequences" ("tenant_id", "doc_type", "fy", "last_no") VALUES (${input.tenantId}::uuid, ${input.docType}, ${fy}, 1)
    ON CONFLICT ("tenant_id", "doc_type", "fy") DO UPDATE SET "last_no" = "document_sequences"."last_no" + 1
    RETURNING "last_no"::int AS last_no`;
  return formatDocumentNumber(input.config, rows[0].last_no, now);
}

export const documentSequencesSql = `
CREATE TABLE IF NOT EXISTS "document_sequences" (
  "tenant_id" UUID NOT NULL, "doc_type" VARCHAR(10) NOT NULL, "fy" VARCHAR(10) NOT NULL, "last_no" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "document_sequences_pkey" PRIMARY KEY ("tenant_id", "doc_type", "fy")
);`;
