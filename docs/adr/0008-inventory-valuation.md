# ADR-0008: Inventory valuation by weighted average cost per item and warehouse

- Status: Accepted (Phase 4); FIFO layers deferred
- Related: ADR-0006, phase-plan/phase-04-inventory-core.md 4.13

## Context

Purchase receipts, opening stock and adjustments carry a unit cost. Reports (Phase 11) and the
adjustment approval threshold need a value per unit of stock. Finance has not required FIFO or
specific identification; refurbished serialized stock carries its own cost on the serial unit.

## Decision

- `item_cost` holds `avg_cost` and `qty_basis` per tenant x item x warehouse.
- Inbound lines from a virtual bucket with a cost (`RECEIPT`, `OPENING`, `ADJUSTMENT_IN` with a
  cost) update the average in the posting transaction:
  `avg = (avg * basis + cost * qty) / (basis + qty)`, `basis += qty`.
- Outbound lines to a virtual bucket reduce the basis (`basis = max(basis - qty, 0)`) and leave the
  average unchanged. Moves between buckets or bins do not touch cost.
- Serialized units keep `unit_cost` per serial in `serial_units` for unit-level margin later.
- Adjustments without an explicit cost are valued at the current average; the approval threshold
  (`inventory_settings.adjustment_approval_threshold`, default 25,000) applies to the absolute value.

## Consequences

- Valuation is deterministic and cheap; it is not the tax-authority-grade costing that a FIFO
  layer table would give. Switching methods later means a new ADR and a rebuild of `item_cost` from
  the ledger (possible because the ledger is complete and append-only).
- Cost is per warehouse; transfers (Phase 8) will move value with the goods using the source
  average.
