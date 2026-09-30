/**
 * Consumers (phase-05 5.4): receipts posted -> lots; GRN cancellation requests -> saga answer;
 * qc postings recorded -> lot closed. Consumers ignore events whose tenant does not match.
 */
import { EVENT_TYPES, grnCancellationRequestedPayload, qcPostingRecordedPayload, receiptPostedPayload, rk } from '@b2b/contracts';
import { registerConsumer, type ConsumerRuntime } from '@b2b/platform-kit';
import type { Tx } from '../db.js';
import type { QcService } from './qc.service.js';

export async function registerQcConsumers(runtime: ConsumerRuntime, service: QcService): Promise<void> {
  await registerConsumer(runtime, {
    name: 'qc.receipts',
    bindings: [rk(EVENT_TYPES.INVENTORY_RECEIPT_POSTED)],
    handle: async (envelope, tx) => {
      if (!envelope.tenantId) return;
      const p = receiptPostedPayload.parse(envelope.payload);
      await service.createLotsFromReceipt(tx as unknown as Tx, envelope.tenantId, p, envelope.correlationId);
    },
  });
  await registerConsumer(runtime, {
    name: 'qc.grn-cancellations',
    bindings: [rk(EVENT_TYPES.GRN_CANCELLATION_REQUESTED)],
    handle: async (envelope, tx) => {
      if (!envelope.tenantId) return;
      const p = grnCancellationRequestedPayload.parse(envelope.payload);
      await service.handleCancellationRequest(tx as unknown as Tx, envelope.tenantId, p, envelope.correlationId);
    },
  });
  await registerConsumer(runtime, {
    name: 'qc.postings',
    bindings: [rk(EVENT_TYPES.INVENTORY_QC_POSTING_RECORDED)],
    handle: async (envelope, tx) => {
      if (!envelope.tenantId) return;
      const p = qcPostingRecordedPayload.parse(envelope.payload);
      await service.closeLot(tx as unknown as Tx, envelope.tenantId, p.lotId, p.postingIds);
    },
  });
}
