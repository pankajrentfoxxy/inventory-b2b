import { createLogger } from '@b2b/platform-kit';
import { loadConfigFromDotenv } from './config.js';
import { createGateway } from './app.js';

const config = loadConfigFromDotenv();
const logger = createLogger({ service: 'gateway', level: config.LOG_LEVEL, pretty: config.NODE_ENV !== 'production' });

const gateway = createGateway(config, { logger });
await gateway.start();
const server = gateway.app.listen(config.PORT, () => {
  logger.info({ port: config.PORT, legacyApi: config.LEGACY_API_URL, auth: config.AUTH_URL, tenant: config.TENANT_URL, env: config.NODE_ENV }, 'Gateway listening');
});

async function shutdown(signal: string) {
  logger.info({ signal }, 'Gateway shutting down');
  server.close(async () => {
    await gateway.stop();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
