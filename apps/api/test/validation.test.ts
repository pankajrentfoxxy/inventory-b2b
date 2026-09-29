/**
 * Centralized validation: shared rule functions, zod field builders and the API error envelope.
 * The first block is pure (no database); the rest exercises real routes so backend enforcement
 * of the same rules is covered end to end.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  MESSAGES,
  amountField,
  gstinField,
  mobileField,
  normalizeSearch,
  panField,
  sanitizeInput,
  searchField,
  validateAmount,
  validateDate,
  validateDateRange,
  validateEmail,
  validateGstin,
  validateIfsc,
  validateInteger,
  validateMobile,
  validatePan,
  validatePercentage,
  validatePersonName,
  validatePincode,
  validateQuantity,
  validateRequired,
  validateUploadFile,
  validateUrl,
} from '@b2b/shared';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { VALID_GSTIN, api, byCode, formOptions, registerOrg, resetDatabase, vendorPayload, type Session } from './helpers.js';

const app = createApp();
let owner: Session;
let opts: Awaited<ReturnType<typeof formOptions>>;

before(async () => {
  await resetDatabase();
  owner = await registerOrg(app, 'Validation Co', 'owner@validation.test');
  opts = await formOptions(app, owner);
});

after(async () => {
  await prisma.$disconnect();
});

/* ------------------------------------------------------------------------- */
describe('shared rule functions (pure)', () => {
  it('mobile: exactly 10 digits, no letters, separators tolerated', () => {
    assert.equal(validateMobile('9876543210'), null);
    assert.equal(validateMobile('98765 43210'), null, 'a typed space between groups is fine');
    assert.equal(validateMobile('98765abc10'), MESSAGES.mobile);
    assert.equal(validateMobile('987654321'), MESSAGES.mobile);
    assert.equal(validateMobile('98765432101'), MESSAGES.mobile);
    assert.equal(validateMobile('1234567890'), MESSAGES.mobileStart);
    assert.equal(validateMobile(''), null, 'optional when blank');
    assert.equal(validateMobile('', true), MESSAGES.required('Mobile number'));
  });

  it('email: trims and rejects malformed addresses', () => {
    assert.equal(validateEmail('  accounts@vendor.com '), null);
    for (const bad of ['abc@', '@gmail.com', 'abc@gmail', 'a b@x.com', 'abc']) assert.equal(validateEmail(bad), MESSAGES.email, bad);
  });

  it('required: whitespace-only counts as empty', () => {
    assert.equal(validateRequired('   ', 'Name'), MESSAGES.required('Name'));
    assert.equal(validateRequired(null, 'Name'), MESSAGES.required('Name'));
    assert.equal(validateRequired('x', 'Name'), null);
  });

  it('names: letters and name punctuation only', () => {
    assert.equal(validatePersonName("Anne-Marie O'Neil Jr."), null);
    assert.equal(validatePersonName('Ravi123', { label: 'First name' }), MESSAGES.personName('First name'));
    assert.equal(validatePersonName('Ravi@', { label: 'First name' }), MESSAGES.personName('First name'));
  });

  it('pincode: exactly 6 digits, not starting with 0', () => {
    assert.equal(validatePincode('411001'), null);
    assert.equal(validatePincode('41100'), MESSAGES.pincode);
    assert.equal(validatePincode('4110011'), MESSAGES.pincode);
    assert.equal(validatePincode('01234'), MESSAGES.pincode);
    assert.equal(validatePincode('41100a'), MESSAGES.pincode);
  });

  it('GSTIN / PAN / IFSC: structure, check digit and case folding', () => {
    assert.equal(validateGstin(VALID_GSTIN.toLowerCase()), null, 'lowercase is accepted and upper-cased');
    assert.equal(validateGstin('27AAPFU0939F1ZX'), MESSAGES.gstin, 'bad check digit');
    assert.equal(validateGstin('27AAPFU0939F1'), MESSAGES.gstin, 'wrong length');
    assert.equal(validatePan('aapfu0939f'), null);
    assert.equal(validatePan('AAPF10939F'), MESSAGES.pan);
    assert.equal(validatePan('AAPFU0939'), MESSAGES.pan);
    assert.equal(validateIfsc('hdfc0001234'), null);
    assert.equal(validateIfsc('HDFC1001234'), MESSAGES.ifsc, '5th character must be 0');
    assert.equal(validateIfsc('HDF00001234'), MESSAGES.ifsc, 'first four must be letters');
    assert.equal(validateIfsc('HDFC000123'), MESSAGES.ifsc, 'length 11');
  });

  it('numbers: amounts, quantities, percentages and integers', () => {
    assert.equal(validateAmount('1,20,000.50'), null);
    assert.equal(validateAmount(0), null, 'zero is a valid amount');
    assert.equal(validateAmount('-5', { label: 'Rate' }), MESSAGES.negative('Rate'));
    assert.equal(validateAmount('-5', { label: 'Adjustment', allowNegative: true }), null);
    assert.equal(validateAmount('12.345', { label: 'Rate' }), MESSAGES.decimals('Rate', 2));
    assert.equal(validateAmount('12abc', { label: 'Rate' }), MESSAGES.number('Rate'));
    assert.equal(validateQuantity(0), MESSAGES.positive('Quantity'));
    assert.equal(validateQuantity('2.5'), null);
    assert.equal(validatePercentage(100), null);
    assert.equal(validatePercentage(100.01, { label: 'Rate' }), MESSAGES.percentage('Rate'));
    assert.equal(validatePercentage(-1, { label: 'Rate' }), MESSAGES.negative('Rate'));
    assert.equal(validateInteger('1.5', { label: 'Days' }), MESSAGES.integer('Days'));
    assert.equal(validateInteger('30', { label: 'Days', min: 0, max: 365 }), null);
  });

  it('dates: calendar-valid, ordered ranges', () => {
    assert.equal(validateDate('2026-09-29', 'Order date'), null);
    assert.equal(validateDate('2026-02-30', 'Order date'), MESSAGES.date('Order date'), 'Date.parse would accept this');
    assert.equal(validateDate('29/09/2026', 'Order date'), MESSAGES.date('Order date'));
    assert.equal(validateDate('', 'Order date', true), MESSAGES.required('Order date'));
    assert.equal(validateDateRange('2026-01-10', '2026-01-01', 'From date', 'To date'), MESSAGES.dateOrder('From date', 'To date'));
    assert.equal(validateDateRange('2026-01-01', '2026-01-01'), null);
  });

  it('url: http(s) only, bare hosts are normalised', () => {
    assert.equal(validateUrl('https://vendor.example.com/about'), null);
    assert.equal(validateUrl('vendor.example.com'), null);
    assert.equal(validateUrl('ftp://vendor.example.com'), MESSAGES.url);
    assert.equal(validateUrl('not a url'), MESSAGES.url);
  });

  it('files: extension, MIME and size', () => {
    assert.equal(validateUploadFile({ name: 'invoice.pdf', size: 1024, mimeType: 'application/pdf' }), null);
    assert.match(validateUploadFile({ name: 'virus.exe', size: 10, mimeType: 'application/octet-stream' }) ?? '', /Unsupported file type/);
    assert.match(validateUploadFile({ name: 'photo.png', size: 10, mimeType: 'application/pdf' }) ?? '', /Unsupported file type/, 'extension and MIME must agree');
    assert.match(validateUploadFile({ name: 'big.pdf', size: 11 * 1024 * 1024, mimeType: 'application/pdf' }) ?? '', /too large/);
  });

  it('sanitizers strip invalid characters while typing', () => {
    assert.equal(sanitizeInput('mobile', '98765abc10'), '9876510');
    assert.equal(sanitizeInput('mobile', '987654321012'), '9876543210', 'capped at 10');
    assert.equal(sanitizeInput('pincode', '4110-01'), '411001');
    assert.equal(sanitizeInput('gstin', '27aapfu0939f1zv!'), '27AAPFU0939F1ZV');
    assert.equal(sanitizeInput('pan', 'aapfu0939f'), 'AAPFU0939F');
    assert.equal(sanitizeInput('ifsc', 'hdfc-0001234'), 'HDFC0001234');
    assert.equal(sanitizeInput('decimal', '1a2.3.4'), '12.34');
    assert.equal(sanitizeInput('signedDecimal', '-1-2.5'), '-12.5');
    assert.equal(sanitizeInput('name', 'Ravi 9 Kumar!'), 'Ravi Kumar');
    assert.equal(sanitizeInput('email', ' a b@x.com '), 'ab@x.com');
  });

  it('search text is trimmed, collapsed and capped', () => {
    assert.equal(normalizeSearch('   '), '');
    assert.equal(normalizeSearch('  ssd   870 '), 'ssd 870');
    assert.equal(normalizeSearch('x'.repeat(500)).length, 200);
    assert.equal(searchField().parse(undefined), '');
  });

  it('zod builders normalise values', () => {
    assert.equal(mobileField().parse(' 98765 43210 '), '9876543210');
    assert.equal(mobileField().parse(''), null);
    assert.equal(gstinField().parse(VALID_GSTIN.toLowerCase()), VALID_GSTIN);
    assert.equal(panField().parse('aapfu0939f'), 'AAPFU0939F');
    assert.equal(amountField('Rate').parse('1,250.50'), 1250.5);
    assert.equal(amountField('Discount', { default: 0 }).parse(''), 0);
    assert.equal(mobileField().safeParse('98765abc10').success, false);
  });
});

/* ------------------------------------------------------------------------- */
describe('API enforces the same rules and returns the standard envelope', () => {
  it('rejects an 11-digit / lettered / short mobile with field-level errors', async () => {
    for (const mobile of ['98765432101', '98765abc10', '987654321']) {
      const res = await api(app, owner).post('/api/vendors').send(vendorPayload(opts, { displayName: `Mobile ${mobile}`, mobile }));
      assert.equal(res.status, 422, mobile);
      assert.equal(res.body.success, false);
      assert.equal(res.body.message, MESSAGES.fixHighlighted);
      assert.equal(res.body.error.code, 'VALIDATION_ERROR');
      assert.equal(res.body.errors.mobile, MESSAGES.mobile, 'keyed errors map');
      assert.ok(res.body.error.details.some((d: { path: string }) => d.path === 'mobile'), 'ordered details list');
    }
  });

  it('rejects digits in a person name and non-numeric PIN codes', async () => {
    const res = await api(app, owner).post('/api/vendors').send(vendorPayload(opts, { displayName: 'Name Rules', firstName: 'Ravi123' }));
    assert.equal(res.status, 422);
    assert.equal(res.body.errors.firstName, MESSAGES.personName('First name'));

    const payload = vendorPayload(opts, { displayName: 'Pin Rules' }) as { addresses: { postalCode?: string }[] };
    payload.addresses[0].postalCode = '41100a';
    const pin = await api(app, owner).post('/api/vendors').send(payload);
    assert.equal(pin.status, 422);
    assert.equal(pin.body.errors['addresses.0.postalCode'], MESSAGES.pincode);
  });

  it('upper-cases GSTIN / PAN / IFSC, trims + lower-cases email and normalises the website before saving', async () => {
    const res = await api(app, owner).post('/api/vendors').send(
      vendorPayload(opts, {
        displayName: 'Normalised Vendor',
        gstin: VALID_GSTIN.toLowerCase(),
        pan: 'aapfu0939f',
        email: '  Accounts@Acme.example  ',
        website: 'acme.example',
        bankAccounts: [{ bankName: 'HDFC Bank', accountHolderName: 'Normalised Vendor', accountNumber: '50100123456789', ifsc: 'hdfc0001234', accountType: 'CURRENT', isPrimary: true }],
      }),
    );
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.data.gstin, VALID_GSTIN);
    assert.equal(res.body.data.pan, 'AAPFU0939F');
    assert.equal(res.body.data.email, 'accounts@acme.example', 'trimmed and lower-cased');
    assert.equal(res.body.data.website, 'https://acme.example');
    assert.equal(res.body.data.bankAccounts[0].ifsc, 'HDFC0001234');
  });

  it('rejects an invalid website protocol', async () => {
    const res = await api(app, owner).post('/api/vendors').send(vendorPayload(opts, { displayName: 'Bad Site', website: 'ftp://acme.example' }));
    assert.equal(res.status, 422);
    assert.equal(res.body.errors.website, MESSAGES.url);
  });

  it('validates contact sub-resource mobiles', async () => {
    const vendor = await api(app, owner).post('/api/vendors').send(vendorPayload(opts, { displayName: 'Contact Rules' }));
    assert.equal(vendor.status, 201);
    const res = await api(app, owner).post(`/api/vendors/${vendor.body.data.id}/contacts`).send({ firstName: 'Meera', mobile: 'abc' });
    assert.equal(res.status, 422);
    assert.equal(res.body.errors.mobile, MESSAGES.mobile);
  });

  it('money fields: max 2 decimals, no negatives, SKU upper-cased', async () => {
    const decimals = await api(app, owner).post('/api/items').send({ name: 'Decimals', purchaseRate: '12.345' });
    assert.equal(decimals.status, 422);
    assert.equal(decimals.body.errors.purchaseRate, MESSAGES.decimals('Purchase rate', 2));

    const negative = await api(app, owner).post('/api/items').send({ name: 'Negative', sellingRate: -5 });
    assert.equal(negative.status, 422);
    assert.equal(negative.body.errors.sellingRate, MESSAGES.negative('Selling rate'));

    const letters = await api(app, owner).post('/api/items').send({ name: 'Letters', purchaseRate: '12abc' });
    assert.equal(letters.status, 422);
    assert.equal(letters.body.errors.purchaseRate, MESSAGES.number('Purchase rate'));

    const ok = await api(app, owner).post('/api/items').send({ name: 'Zero Priced', sku: 'zero-01', purchaseRate: 0, sellingRate: '1,250.50' });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    assert.equal(ok.body.data.sku, 'ZERO-01');
    assert.equal(ok.body.data.purchaseRate, 0, 'zero is stored, not treated as blank');
    assert.equal(ok.body.data.sellingRate, 1250.5);
  });

  it('percentages and integers in settings masters', async () => {
    const over = await api(app, owner).post('/api/settings/taxes').send({ name: 'GST101', rate: 101 });
    assert.equal(over.status, 422);
    assert.equal(over.body.errors.rate, MESSAGES.max('Rate', 100));

    const text = await api(app, owner).post('/api/settings/taxes').send({ name: 'GSTX', rate: 'abc' });
    assert.equal(text.status, 422);
    assert.equal(text.body.errors.rate, MESSAGES.number('Rate'));

    const days = await api(app, owner).post('/api/settings/payment-terms').send({ name: 'Net 1.5', days: 1.5 });
    assert.equal(days.status, 422);
    assert.equal(days.body.errors.days, MESSAGES.integer('Days'));

    const blank = await api(app, owner).post('/api/settings/reporting-tags').send({ name: '   ' });
    assert.equal(blank.status, 422);
    assert.equal(blank.body.errors.name, MESSAGES.required('Tag name'));
  });

  it('dates: calendar validity on create, ordered ranges on list filters', async () => {
    const vendor = await api(app, owner).post('/api/vendors').send(vendorPayload(opts, { displayName: 'Date Rules' }));
    const item = await api(app, owner).post('/api/items').send({ name: 'Dated item' });
    const locations = await api(app, owner).get('/api/settings/locations');
    const po = await api(app, owner).post('/api/purchase-orders').send({
      vendorId: vendor.body.data.id,
      deliveryLocationId: locations.body.data[0].id,
      orderDate: '2026-02-30',
      lines: [{ itemId: item.body.data.id, quantity: 1, rate: 10 }],
    });
    assert.equal(po.status, 422);
    assert.equal(po.body.errors.orderDate, MESSAGES.date('Order date'));

    const range = await api(app, owner).get('/api/purchase-orders?dateFrom=2026-02-10&dateTo=2026-02-01');
    assert.equal(range.status, 422);
    assert.equal(range.body.message, 'Invalid query parameters');
    assert.equal(range.body.errors.dateTo, MESSAGES.dateOrder('From date', 'To date'));

    const blankSearch = await api(app, owner).get('/api/purchase-orders?search=%20%20%20');
    assert.equal(blankSearch.status, 200, 'whitespace search is treated as no search');
  });

  it('route params are validated through the same envelope', async () => {
    const res = await api(app, owner).put('/api/settings/document-sequences/INVOICE').send({ prefix: 'X-', nextNumber: 1, padding: 3 });
    assert.equal(res.status, 422);
    assert.equal(res.body.success, false);
    assert.equal(res.body.message, 'Invalid request path');
    assert.ok(res.body.errors.docType);

    const missing = await api(app, owner).get('/api/nope');
    assert.equal(missing.status, 404);
    assert.equal(missing.body.success, false);
    assert.equal(missing.body.error.code, 'ROUTE_NOT_FOUND');
  });

  it('uploads: rejects unsupported types server-side, accepts allowed ones', async () => {
    const vendor = await api(app, owner).post('/api/vendors').send(vendorPayload(opts, { displayName: 'Upload Rules', gstTreatmentId: byCode(opts.gstTreatments, 'UNREGISTERED_BUSINESS').id, gstin: '', pan: '', bankAccounts: [] }));
    assert.equal(vendor.status, 201, JSON.stringify(vendor.body));
    const vendorId = vendor.body.data.id;

    const exe = await api(app, owner).post(`/api/vendors/${vendorId}/documents`).attach('file', Buffer.from('MZ'), { filename: 'setup.exe', contentType: 'application/octet-stream' });
    assert.equal(exe.status, 422);
    assert.match(exe.body.errors.file, /Unsupported file type/);

    const spoofed = await api(app, owner).post(`/api/vendors/${vendorId}/documents`).attach('file', Buffer.from('MZ'), { filename: 'setup.pdf', contentType: 'application/x-msdownload' });
    assert.equal(spoofed.status, 422, 'extension says pdf but MIME does not');

    const none = await api(app, owner).post(`/api/vendors/${vendorId}/documents`);
    assert.equal(none.status, 422);
    assert.equal(none.body.errors.file, MESSAGES.fileRequired);

    const ok = await api(app, owner).post(`/api/vendors/${vendorId}/documents`).attach('file', Buffer.from('hello'), { filename: 'note.txt', contentType: 'text/plain' });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    const removed = await api(app, owner).delete(`/api/vendors/${vendorId}/documents/${ok.body.data.id}`);
    assert.equal(removed.status, 200);
  });
});
