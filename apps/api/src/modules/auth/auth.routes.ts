import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { loginSchema, registerSchema } from '@b2b/shared';
import { errorBody } from '../../lib/errors.js';
import { asyncHandler, validateBody } from '../../lib/http.js';
import { requireAuth } from '../../middleware/auth.js';
import { env } from '../../config/env.js';
import * as authService from './auth.service.js';

export const authRouter = Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.isTest ? 10_000 : 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: errorBody('RATE_LIMITED', 'Too many attempts. Try again in a few minutes.'),
});

authRouter.post(
  '/register',
  authLimiter,
  validateBody(registerSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json(await authService.register(req.body));
  }),
);

authRouter.post(
  '/login',
  authLimiter,
  validateBody(loginSchema),
  asyncHandler(async (req, res) => {
    res.json(await authService.login(req.body));
  }),
);

authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await authService.me(req.auth!.userId));
  }),
);
