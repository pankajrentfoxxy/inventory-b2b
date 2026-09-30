import { loadConfig } from './config.js';
import { createAuthRuntime } from './service.js';

const config = loadConfig();
const runtime = await createAuthRuntime(config);
await runtime.start();
const server = runtime.app.listen(config.PORT, () => runtime.logger.info({ port: config.PORT, env: config.NODE_ENV }, 'svc-auth listening'));
if (config.MFA_DEV_BYPASS_CODE) runtime.logger.warn('MFA_DEV_BYPASS_CODE is set: platform two-factor accepts a fixed code (development only)');

async function shutdown(signal: string) {
  runtime.logger.info({ signal }, 'svc-auth shutting down');
  server.close(async () => {
    await runtime.stop();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
