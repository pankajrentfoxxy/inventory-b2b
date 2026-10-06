-- PO lines order an exact laptop configuration (the master product, snapshotted in item_snapshot)
-- and carry its rental commercials next to the purchase rate. Nullable for lines created earlier;
-- the API requires both on every create / edit / revision.
ALTER TABLE "po_lines"
  ADD COLUMN "monthly_rental_amount" DECIMAL(18,2),
  ADD COLUMN "tenure_months" INTEGER;

ALTER TABLE "po_lines"
  ADD CONSTRAINT "po_lines_monthly_rental_amount_check" CHECK ("monthly_rental_amount" IS NULL OR "monthly_rental_amount" >= 0),
  ADD CONSTRAINT "po_lines_tenure_months_check" CHECK ("tenure_months" IS NULL OR "tenure_months" > 0);
