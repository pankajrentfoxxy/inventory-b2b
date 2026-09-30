/**
 * Consumers (phase-05 5.7): inventory's answers to receipts and reversals, QC completion, and the
 * QC side of the cancellation saga. Every handler checks the entity belongs to the envelope's tenant.
 */
import { EVENT_TYPES, qcCancellationRefusedPayload, qcPostingRecordedPayload, receiptPostedPayload, receiptRejectedPayload, receiptReversalRefusedPayload, receiptReversedPayload, rk } from '@b2b/contracts';
import { registerConsumer, type ConsumerRuntime } from '@b2b/platform-kit';
import type { Tx } from '../db.js';
import type { ProcurementService } from './procurement.service.js';

export async function registerProcurementConsumers(runtime: ConsumerRuntime, service: ProcurementService): Promise<void> {
  await registerConsumer(runtime, {
    name: 'procurement.receipt-status',
    bindings: [rk(EVENT_TYPES.INVENTORY_RECEIPT_POSTED), rk(EVENT_TYPES.INVENTORY_RECEIPT_REJECTED)],
    handle: async (envelope, tx) => {
      if (!envelope.tenantId) return;
      const t = tx as unknown as Tx;
      if (envelope.eventType === EVENT_TYPES.INVENTORY_RECEIPT_POSTED) await service.onReceiptPosted(t, envelope.tenantId, receiptPostedPayload.parse(envelope.payload), envelope.correlationId);
      else await service.onReceiptRejected(t, envelope.tenantId, receiptRejectedPayload.parse(envelope.payload), envelope.correlationId);
    },
  });
  await registerConsumer(runtime, {
    name: 'procurement.qc-completion',
    bindings: [rk(EVENT_TYPES.INVENTORY_QC_POSTING_RECORDED)],
    handle: async (envelope, tx) => {
      if (!envelope.tenantId) return;
      await service.onQcPostingRecorded(tx as unknown as Tx, envelope.tenantId, qcPostingRecordedPayload.parse(envelope.payload), envelope.correlationId);
    },
  });
  await registerConsumer(runtime, {
    name: 'procurement.cancellation-saga',
    bindings: [rk(EVENT_TYPES.QC_LOT_CANCELLATION_REFUSED), rk(EVENT_TYPES.INVENTORY_RECEIPT_REVERSED), rk(EVENT_TYPES.INVENTORY_RECEIPT_REVERSAL_REFUSED)],
    handle: async (envelope, tx) => {
      if (!envelope.tenantId) return;
      const t = tx as unknown as Tx;
      if (envelope.eventType === EVENT_TYPES.QC_LOT_CANCELLATION_REFUSED) await service.onQcCancellationRefused(t, envelope.tenantId, qcCancellationRefusedPayload.parse(envelope.payload), envelope.correlationId);
      else if (envelope.eventType === EVENT_TYPES.INVENTORY_RECEIPT_REVERSED) await service.onReceiptReversed(t, envelope.tenantId, receiptReversedPayload.parse(envelope.payload), envelope.correlationId);
      else await service.onReversalRefused(t, envelope.tenantId, receiptReversalRefusedPayload.parse(envelope.payload), envelope.correlationId);
    },
  });
}
