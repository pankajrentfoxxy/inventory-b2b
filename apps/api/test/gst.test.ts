import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mapZohoGstinRecord } from '../src/modules/integrations/gst.service.js';

const sample = {
  taxpayer_type: 'Regular',
  business_name: 'TRUETECH SERVICES PRIVATE LIMITED',
  adadr: [
    {
      addr: { bnm: 'JMD Megapolis IT Park', st: 'Sohna Road', loc: 'Gurugram', bno: '438', dst: 'Gurugram', locality: 'Sector 48', pncd: '122018', landMark: '', stcd: 'Haryana', flno: 'Fourth Floor' },
      ntr: 'Warehouse / Depot, Recipient of Goods or Services',
    },
  ],
  constitution_of_business: 'Private Limited Company',
  gstin: '06AAHCT0310N1ZG',
  pradr: {
    addr: { bnm: 'JMD Megapolis IT Park', st: 'SOHNA ROAD', loc: 'GURGAON', bno: '429', dst: 'Gurugram', locality: 'Sector 48', pncd: '122018', landMark: '', stcd: 'Haryana', flno: 'Fourth Flour' },
    ntr: 'Supplier of Services, Recipient of Goods or Services',
  },
  tradeNam: 'TRUETECH SERVICES PRIVATE LIMITED',
  nature_of_business: ['Supplier of Services', 'Recipient of Goods or Services', 'Warehouse / Depot'],
  is_einvoice_enabled: true,
  registered_date: '16/01/2019',
  status: 'Active',
};

describe('Zoho GSTIN record mapping', () => {
  it('maps business details, treatment suggestion and both addresses', () => {
    const r = mapZohoGstinRecord(sample, '06AAHCT0310N1ZG');
    assert.equal(r.legalName, 'TRUETECH SERVICES PRIVATE LIMITED');
    assert.equal(r.status, 'Active');
    assert.equal(r.taxpayerType, 'Regular');
    assert.equal(r.suggestedGstTreatmentCode, 'REGISTERED_BUSINESS_REGULAR');
    assert.equal(r.eInvoiceApplicable, true);
    assert.equal(r.stateCode, '06', 'Haryana resolved from state name');
    assert.equal(r.addresses.length, 2);
    const principal = r.addresses[0];
    assert.equal(principal.isPrincipal, true);
    assert.equal(principal.addressLine1, '429, Fourth Flour, JMD Megapolis IT Park');
    assert.equal(principal.addressLine2, 'SOHNA ROAD, Sector 48');
    assert.equal(principal.city, 'GURGAON');
    assert.equal(principal.state, 'Haryana');
    assert.equal(principal.postalCode, '122018');
    assert.equal(r.addresses[1].nature, 'Warehouse / Depot, Recipient of Goods or Services');
  });

  it('falls back to the GSTIN state code when the state name is unknown', () => {
    const r = mapZohoGstinRecord({ ...sample, pradr: { addr: { stcd: 'Unknown Land' } }, adadr: [] }, '06AAHCT0310N1ZG');
    assert.equal(r.addresses[0].stateCode, '06');
  });
});
