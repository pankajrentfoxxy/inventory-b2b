import { Router, type Request } from 'express';
import { asyncHandler, authenticate, getContext, idempotent, ifMatchVersion, parseQuery, requirePermission, requirePlatform, requireService, requireTenant, requireUuidParams, validateBody, validateQuery, type Logger, type SqlClient, type TokenVerifier } from '@b2b/platform-kit';
import { IamService, actorFrom } from './iam.service.js';
import { acceptInvitationSchema, cloneRoleSchema, createRoleSchema, inviteSchema, memberRolesSchema, membersQuerySchema, platformInviteSchema, platformRolesSchema, reasonSchema, rolePermissionsSchema, warehouseScopeSchema } from './iam.schema.js';

export interface IamRouterDeps {
  service: IamService;
  verifier: TokenVerifier;
  db: SqlClient;
  logger: Logger;
}

const meta = (req: Request) => ({ ip: req.ip ?? null, userAgent: req.header('user-agent') ?? null });

export function createTenantIamRouter({ service, verifier, db, logger }: IamRouterDeps) {
  const router = Router();
  // Public: invitation acceptance (token-authenticated).
  router.post('/invitations/accept', validateBody(acceptInvitationSchema), asyncHandler(async (req, res) => {
    res.json({ data: await service.acceptInvitation(req.body.token, { fullName: req.body.fullName, password: req.body.password }, req.correlationId ?? '') });
  }));

  router.use(authenticate({ verifier, types: ['tenant'] }), requireTenant);
  requireUuidParams(router, 'id');
  const tenantOf = (req: Request) => getContext(req).tenantId!;
  const actor = (req: Request) => actorFrom(getContext(req), meta(req).ip, meta(req).userAgent);
  const idem = (scope: string) => idempotent(scope, { db, logger });

  router.get('/me', asyncHandler(async (req, res) => res.json({ data: await service.me(getContext(req)) })));
  router.get('/permissions', requirePermission('iam.role.view'), asyncHandler(async (_req, res) => res.json({ data: await service.listPermissions('TENANT') })));
  router.get('/roles', requirePermission('iam.role.view'), asyncHandler(async (req, res) => res.json({ data: await service.listRoles(tenantOf(req)) })));
  router.post('/roles', requirePermission('iam.role.manage'), validateBody(createRoleSchema), asyncHandler(async (req, res) => res.status(201).json({ data: await service.createRole(tenantOf(req), actor(req), req.body) })));
  router.post('/roles/:id/clone', requirePermission('iam.role.manage'), validateBody(cloneRoleSchema), asyncHandler(async (req, res) => res.status(201).json({ data: await service.cloneRole(tenantOf(req), actor(req), req.params.id, req.body) })));
  router.put('/roles/:id/permissions', requirePermission('iam.role.manage'), validateBody(rolePermissionsSchema), asyncHandler(async (req, res) => res.json({ data: await service.replaceRolePermissions(tenantOf(req), actor(req), req.params.id, req.body.permissionCodes, ifMatchVersion(req)) })));
  router.delete('/roles/:id', requirePermission('iam.role.manage'), asyncHandler(async (req, res) => res.json({ data: await service.deleteRole(tenantOf(req), actor(req), req.params.id) })));

  router.get('/members', requirePermission('iam.member.view'), validateQuery(membersQuerySchema), asyncHandler(async (req, res) => res.json({ data: await service.listMembers(tenantOf(req), parseQuery<typeof membersQuerySchema>(res)) })));
  router.get('/invitations', requirePermission('iam.member.view'), asyncHandler(async (req, res) => res.json({ data: await service.listInvitations(tenantOf(req)) })));
  router.post('/invitations', requirePermission('iam.member.invite'), validateBody(inviteSchema), idem('POST /iam/invitations'), asyncHandler(async (req, res) => res.status(201).json({ data: await service.invite(tenantOf(req), actor(req), req.body) })));
  router.post('/invitations/:id/resend', requirePermission('iam.member.invite'), asyncHandler(async (req, res) => res.json({ data: await service.resendInvitation(tenantOf(req), actor(req), req.params.id) })));
  router.post('/invitations/:id/revoke', requirePermission('iam.member.invite'), asyncHandler(async (req, res) => res.json({ data: await service.revokeInvitation(tenantOf(req), actor(req), req.params.id) })));

  router.post('/members/:id/roles', requirePermission('iam.role.assign'), validateBody(memberRolesSchema), asyncHandler(async (req, res) => res.json({ data: await service.replaceMemberRoles(tenantOf(req), actor(req), req.params.id, req.body.roleIds) })));
  router.post('/members/:id/suspend', requirePermission('iam.member.suspend'), validateBody(reasonSchema), asyncHandler(async (req, res) => res.json({ data: await service.transitionMember(tenantOf(req), actor(req), req.params.id, 'suspend', req.body.reason) })));
  router.post('/members/:id/reactivate', requirePermission('iam.member.suspend'), validateBody(reasonSchema), asyncHandler(async (req, res) => res.json({ data: await service.transitionMember(tenantOf(req), actor(req), req.params.id, 'reactivate', req.body.reason) })));
  router.post('/members/:id/remove', requirePermission('iam.member.remove'), validateBody(reasonSchema), asyncHandler(async (req, res) => res.json({ data: await service.transitionMember(tenantOf(req), actor(req), req.params.id, 'remove', req.body.reason) })));
  router.put('/members/:id/warehouse-scope', requirePermission('iam.member.manage'), validateBody(warehouseScopeSchema), asyncHandler(async (req, res) => res.json({ data: await service.setWarehouseScope(tenantOf(req), actor(req), req.params.id, req.body) })));
  return router;
}

export function createPlatformIamRouter({ service, verifier }: IamRouterDeps) {
  const router = Router();
  router.use(authenticate({ verifier, types: ['platform', 'tenant'] }), requirePlatform, requirePermission('platform.iam.manage'));
  requireUuidParams(router, 'id');
  const actor = (req: Request) => actorFrom(getContext(req), meta(req).ip, meta(req).userAgent);
  router.get('/permissions', asyncHandler(async (_req, res) => res.json({ data: await service.listPermissions('PLATFORM') })));
  router.get('/roles', asyncHandler(async (_req, res) => res.json({ data: await service.listRoles(null) })));
  router.get('/staff', asyncHandler(async (_req, res) => res.json({ data: await service.listPlatformStaff() })));
  // Platform staff identities are created with the svc-auth `admin:create` CLI (never an API);
  // this endpoint assigns platform roles to an existing identity.
  router.post('/staff', validateBody(platformInviteSchema.extend({ userId: platformRolesSchema.shape.roleKeys.element.uuid() })), asyncHandler(async (req, res) => {
    res.status(201).json({ data: await service.upsertPlatformStaff({ userId: req.body.userId, email: req.body.email, fullName: req.body.fullName ?? req.body.email, roleKeys: req.body.roleKeys }, actor(req)) });
  }));
  router.put('/staff/:id/roles', validateBody(platformRolesSchema), asyncHandler(async (req, res) => {
    const staff = (await service.listPlatformStaff()).find((s) => s.id === req.params.id);
    if (!staff) {
      res.status(404).json({ success: false, message: 'Staff member not found', error: { code: 'NOT_FOUND', message: 'Staff member not found', correlationId: req.correlationId } });
      return;
    }
    res.json({ data: await service.upsertPlatformStaff({ userId: staff.userId, email: staff.email, fullName: staff.fullName, roleKeys: req.body.roleKeys }, actor(req)) });
  }));
  return router;
}

export function createInternalIamRouter({ service, verifier }: IamRouterDeps) {
  const router = Router();
  router.use(authenticate({ verifier, types: ['service'], serviceName: 'svc-iam' }), requireService());
  requireUuidParams(router, 'id');
  router.get('/users/:id/memberships', asyncHandler(async (req, res) => res.json({ data: await service.membershipsForUser(req.params.id, typeof req.query.status === 'string' ? req.query.status : undefined) })));
  router.get('/users/:id/platform-permissions', asyncHandler(async (req, res) => res.json({ data: await service.platformPermissionsForUser(req.params.id) })));
  router.get('/memberships/:id/effective-permissions', asyncHandler(async (req, res) => {
    const info = await service.effectivePermissions(req.params.id);
    if (!info) {
      res.status(404).json({ success: false, message: 'Membership not found', error: { code: 'NOT_FOUND', message: 'Membership not found', correlationId: req.correlationId } });
      return;
    }
    res.json({ data: info });
  }));
  router.post('/platform-staff', validateBody(platformRolesSchema.extend({ userId: platformRolesSchema.shape.roleKeys.element.uuid(), email: platformRolesSchema.shape.roleKeys.element, fullName: platformRolesSchema.shape.roleKeys.element })), asyncHandler(async (req, res) => {
    const ctx = getContext(req);
    res.json({ data: await service.upsertPlatformStaff(req.body, { userId: null, name: ctx.serviceName, membershipId: null, correlationId: ctx.correlationId }) });
  }));
  return router;
}
