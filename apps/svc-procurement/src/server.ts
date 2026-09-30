import { loadConfig } from './config.js';
import { createProcurementRuntime } from './service.js';

const config = loadConfig();
const runtime = await createProcurementRuntime(config);
await runtime.start();
const server = runtime.app.listen(config.PORT, () => runtime.logger.info({ port: config.PORT, env: config.NODE_ENV }, 'svc-procurement listening'));

async function shutdown(signal: string) {
  runtime.logger.info({ signal }, 'svc-procurement shutting down');
  server.close(async () => {
    await runtime.stop();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
