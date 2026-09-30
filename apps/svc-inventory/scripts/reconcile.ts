/**
 * On-demand reconciliation (phase-04 4.9 step 7): ledger vs balances, posting balance, serial
 * counts, negative balances, for every tenant with postings. Exit code 1 on any mismatch so it can
 * run nightly under a scheduler and page on failure.
 */
import { loadConfig } from '../src/config.js';
import { createInventoryRuntime } from '../src/service.js';

const rt = await createInventoryRuntime(loadConfig());
let failed = false;
for (const tenantId of await rt.service.tenantsWithStock()) {
  const report = await rt.service.reconciliation(tenantId);
  if (!report.ok) failed = true;
  console.log(JSON.stringify({ tenantId, ...report }));
}
await rt.stop();
process.exit(failed ? 1 : 0);
