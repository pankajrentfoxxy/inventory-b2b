/**
 * GST portal lookup abstraction. Providers implement GstLookupProvider and are selected with
 * GST_PROVIDER. Shipped providers:
 *   - none          : reports NOT_CONFIGURED (501) so the UI can say so honestly
 *   - zoho-session  : Zoho Inventory's GSTIN search, authenticated with a browser session
 *                     (cookie + CSRF token). Sessions expire; the UI surfaces that clearly.
 */
import { INDIAN_STATES, stateCodeFromGstin } from '@b2b/shared';
import { env } from '../../config/env.js';
import { HttpError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';

export interface GstAddress {
  nature: string | null;
  addressLine1: string;
  addressLine2: string;
  city: string;
  district: string | null;
  state: string;
  stateCode: string | null;
  postalCode: string;
  isPrincipal: boolean;
}

export interface GstLookupResult {
  gstin: string;
  legalName: string | null;
  tradeName: string | null;
  status: string | null;
  taxpayerType: string | null;
  constitution: string | null;
  registeredDate: string | null;
  eInvoiceApplicable: boolean | null;
  natureOfBusiness: string[];
  stateCode: string | null;
  /** Code from the org's GST treatment master that matches the taxpayer type. */
  suggestedGstTreatmentCode: string | null;
  addresses: GstAddress[];
  source: string;
}

export interface GstLookupProvider {
  readonly name: string;
  lookup(gstin: string): Promise<GstLookupResult>;
}

/* ---- none ---------------------------------------------------------------- */

class NotConfiguredProvider implements GstLookupProvider {
  readonly name = 'none';
  async lookup(): Promise<GstLookupResult> {
    throw new HttpError(
      501,
      'GST_LOOKUP_NOT_CONFIGURED',
      'GST portal lookup is not configured yet. PAN and source of supply are derived from the GSTIN; enter the remaining details manually.',
    );
  }
}

/* ---- zoho session ---------------------------------------------------------- */

interface ZohoAddr {
  bno?: string;
  flno?: string;
  bnm?: string;
  st?: string;
  locality?: string;
  loc?: string;
  dst?: string;
  stcd?: string;
  pncd?: string;
  landMark?: string;
}
interface ZohoAddrBlock {
  addr?: ZohoAddr;
  ntr?: string;
}
export interface ZohoGstinRecord {
  gstin?: string;
  business_name?: string;
  tradeNam?: string;
  status?: string;
  taxpayer_type?: string;
  constitution_of_business?: string;
  registered_date?: string;
  is_einvoice_enabled?: boolean;
  einvoiceStatus?: string;
  nature_of_business?: string[];
  pradr?: ZohoAddrBlock;
  adadr?: ZohoAddrBlock[];
}

const TAXPAYER_TO_TREATMENT: Record<string, string> = {
  regular: 'REGISTERED_BUSINESS_REGULAR',
  composition: 'REGISTERED_BUSINESS_COMPOSITION',
  'sez unit': 'SPECIAL_ECONOMIC_ZONE',
  'sez developer': 'SEZ_DEVELOPER',
  'tax deductor': 'TAX_DEDUCTOR',
};

const join = (parts: (string | undefined)[]) => parts.map((p) => (p ?? '').trim()).filter(Boolean).join(', ');

function stateCodeFor(stateName: string | undefined, gstin: string): string | null {
  const byName = stateName
    ? INDIAN_STATES.find((s) => s.name.toLowerCase() === stateName.trim().toLowerCase())
    : undefined;
  return byName?.code ?? stateCodeFromGstin(gstin);
}

function mapAddress(block: ZohoAddrBlock, gstin: string, isPrincipal: boolean): GstAddress | null {
  const a = block.addr;
  if (!a) return null;
  return {
    nature: block.ntr ?? null,
    addressLine1: join([a.bno, a.flno, a.bnm]),
    addressLine2: join([a.st, a.locality, a.landMark]),
    city: (a.loc || a.dst || '').trim(),
    district: a.dst?.trim() || null,
    state: (a.stcd ?? '').trim(),
    stateCode: stateCodeFor(a.stcd, gstin),
    postalCode: (a.pncd ?? '').trim(),
    isPrincipal,
  };
}

/** Pure mapping from Zoho's record to our result; unit-tested without network. */
export function mapZohoGstinRecord(data: ZohoGstinRecord, requestedGstin: string, source = 'Zoho Inventory'): GstLookupResult {
  const gstin = (data.gstin ?? requestedGstin).toUpperCase();
  const addresses = [
    ...(data.pradr ? [mapAddress(data.pradr, gstin, true)] : []),
    ...(data.adadr ?? []).map((b) => mapAddress(b, gstin, false)),
  ].filter((x): x is GstAddress => Boolean(x));
  const taxpayerType = data.taxpayer_type ?? null;
  const eInvoice =
    typeof data.is_einvoice_enabled === 'boolean'
      ? data.is_einvoice_enabled
      : data.einvoiceStatus
        ? data.einvoiceStatus.toLowerCase() === 'yes'
        : null;
  return {
    gstin,
    legalName: data.business_name?.trim() || null,
    tradeName: data.tradeNam?.trim() || data.business_name?.trim() || null,
    status: data.status ?? null,
    taxpayerType,
    constitution: data.constitution_of_business ?? null,
    registeredDate: data.registered_date ?? null,
    eInvoiceApplicable: eInvoice,
    natureOfBusiness: data.nature_of_business ?? [],
    stateCode: addresses[0]?.stateCode ?? stateCodeFromGstin(gstin),
    suggestedGstTreatmentCode: taxpayerType ? (TAXPAYER_TO_TREATMENT[taxpayerType.toLowerCase()] ?? null) : null,
    addresses,
    source,
  };
}

class ZohoSessionGstProvider implements GstLookupProvider {
  readonly name = 'Zoho Inventory';
  constructor(
    private readonly cfg: { baseUrl: string; organizationId: string; cookie: string; csrfToken: string; roleId?: string },
  ) {}

  async lookup(gstin: string): Promise<GstLookupResult> {
    const url = new URL('/api/v1/search/gstin', this.cfg.baseUrl);
    url.searchParams.set('gstin', gstin);
    url.searchParams.set('organization_id', this.cfg.organizationId);

    let res: Response;
    try {
      res = await fetch(url, {
        headers: {
          Accept: '*/*',
          Cookie: this.cfg.cookie,
          Referer: `${this.cfg.baseUrl}/app/${this.cfg.organizationId}`,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36',
          'X-ZB-SOURCE': 'zbclient',
          'X-ZCSRF-TOKEN': `zomcsparam=${this.cfg.csrfToken}`,
          'X-ZOHO-Include-Formatted': 'true',
          ...(this.cfg.roleId ? { 'X-ROLE-ID': this.cfg.roleId } : {}),
        },
        signal: AbortSignal.timeout(20_000),
      });
    } catch (err) {
      logger.warn({ err }, 'GST lookup: network failure');
      throw new HttpError(502, 'GST_PROVIDER_ERROR', 'Could not reach the GST lookup service. Try again in a moment.');
    }

    const contentType = res.headers.get('content-type') ?? '';
    if (res.status === 401 || res.status === 403 || !contentType.includes('application/json')) {
      logger.warn({ status: res.status, contentType }, 'GST lookup: Zoho session rejected');
      throw new HttpError(
        502,
        'GST_PROVIDER_SESSION_EXPIRED',
        'The Zoho session used for GST lookup has expired. Update ZOHO_GST_COOKIE / ZOHO_GST_CSRF_TOKEN in the API environment.',
      );
    }

    const body = (await res.json()) as { code?: number; message?: string; data?: ZohoGstinRecord };
    if (body.code !== 0 || !body.data) {
      throw new HttpError(422, 'GSTIN_NOT_FOUND', body.message?.trim() || 'No GST registration was found for this GSTIN.');
    }
    return mapZohoGstinRecord(body.data, gstin, this.name);
  }
}

/* ---- factory --------------------------------------------------------------- */

let cached: GstLookupProvider | null = null;

export function getGstProvider(): GstLookupProvider {
  if (cached) return cached;
  switch (env.GST_PROVIDER) {
    case 'zoho-session': {
      const missing = ['ZOHO_GST_ORGANIZATION_ID', 'ZOHO_GST_COOKIE', 'ZOHO_GST_CSRF_TOKEN'].filter((k) => !env[k as keyof typeof env]);
      if (missing.length) throw new Error(`GST_PROVIDER=zoho-session requires ${missing.join(', ')}`);
      cached = new ZohoSessionGstProvider({
        baseUrl: env.ZOHO_GST_BASE_URL,
        organizationId: env.ZOHO_GST_ORGANIZATION_ID!,
        cookie: env.ZOHO_GST_COOKIE!,
        csrfToken: env.ZOHO_GST_CSRF_TOKEN!,
        roleId: env.ZOHO_GST_ROLE_ID,
      });
      break;
    }
    case 'none':
    default:
      cached = new NotConfiguredProvider();
  }
  return cached;
}
