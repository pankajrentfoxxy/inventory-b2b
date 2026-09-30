-- Laptop QC: a unit can be put on HOLD (stays in QC hold, blocks the lot decision until resolved),
-- and every laptop unit carries a structured check against the ordered configuration.
ALTER TABLE "qc_unit_results" DROP CONSTRAINT "qc_unit_results_result_check";
ALTER TABLE "qc_unit_results" ADD CONSTRAINT "qc_unit_results_result_check" CHECK ("result" IN ('PASS','FAIL','HOLD'));
-- { specChecks: { brand: { match, actual }, ... }, powersOn, missingParts: [], assetTag }
ALTER TABLE "qc_unit_results" ADD COLUMN "laptop_check" JSONB;
