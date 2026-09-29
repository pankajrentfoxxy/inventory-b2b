import { Router } from 'express';
import { addMemberSchema, updateMemberSchema } from '@b2b/shared';
import { asyncHandler, validateBody } from '../../lib/http.js';
import { getCtx, requireAuth, requireOrganization, requirePermission } from '../../middleware/auth.js';
import * as orgService from './organization.service.js';

export const organizationRouter = Router();

organizationRouter.use(requireAuth, requireOrganization);

/** The caller's context inside the selected organization: role + effective permissions. */
organizationRouter.get('/current', (req, res) => {
  const ctx = getCtx(req);
  res.json({
    organization: { id: ctx.organizationId, name: ctx.organizationName },
    role: { id: ctx.roleId, code: ctx.roleCode },
    isOwner: ctx.isOwner,
    permissions: [...ctx.permissions].sort(),
  });
});

organizationRouter.get(
  '/current/roles',
  requirePermission('settings.view', 'settings.manage'),
  asyncHandler(async (req, res) => {
    res.json({ data: await orgService.listRoles(getCtx(req).organizationId) });
  }),
);

organizationRouter.get(
  '/current/members',
  requirePermission('settings.view', 'settings.manage'),
  asyncHandler(async (req, res) => {
    res.json({ data: await orgService.listMembers(getCtx(req).organizationId) });
  }),
);

organizationRouter.post(
  '/current/members',
  requirePermission('settings.manage'),
  validateBody(addMemberSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json({ data: await orgService.addMember(getCtx(req).organizationId, req.body) });
  }),
);

organizationRouter.patch(
  '/current/members/:memberId',
  requirePermission('settings.manage'),
  validateBody(updateMemberSchema),
  asyncHandler(async (req, res) => {
    res.json({ data: await orgService.updateMember(getCtx(req).organizationId, req.params.memberId, req.body) });
  }),
);
