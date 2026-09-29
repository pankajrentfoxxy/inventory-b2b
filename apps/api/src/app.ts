import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import pinoHttp from 'pino-http';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { organizationRouter } from './modules/organizations/organization.routes.js';
import { vendorRouter } from './modules/vendors/vendor.routes.js';
import { settingsRouter } from './modules/settings/settings.routes.js';
import { integrationsRouter } from './modules/integrations/integrations.routes.js';
import { itemRouter } from './modules/items/item.routes.js';
import { purchaseOrderRouter } from './modules/purchases/purchaseOrder.routes.js';
import { purchaseReceiveRouter } from './modules/purchases/purchaseReceive.routes.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(helmet());
  app.use(
    cors({
      origin: (origin, cb) => {
        if (!origin || env.corsOrigins.includes(origin)) return cb(null, true);
        cb(new Error(`Origin ${origin} is not allowed`));
      },
      credentials: true,
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Organization-Id'],
      exposedHeaders: ['Content-Disposition'],
    }),
  );
  app.use(compression());
  app.use(express.json({ limit: '1mb' }));
  if (!env.isTest) {
    app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/api/health' } }));
  }

  app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'b2b-inventory-api', time: new Date().toISOString() }));

  app.use('/api/auth', authRouter);
  app.use('/api/organizations', organizationRouter);
  app.use('/api/vendors', vendorRouter);
  app.use('/api/settings', settingsRouter);
  app.use('/api/integrations', integrationsRouter);
  app.use('/api/items', itemRouter);
  app.use('/api/purchase-orders', purchaseOrderRouter);
  app.use('/api/purchase-receives', purchaseReceiveRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
