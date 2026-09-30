/**
 * One-off CLI to seed the first platform administrator (phase-01 step 8.8). Never an API.
 *
 *   npm run admin:create -w @b2b/svc-auth -- --email admin@rentfoxxy.com --name "Platform Admin" --password "Str0ngPassw0rd!"
 *
 * The admin must enrol MFA on first login (PLATFORM_MFA_REQUIRED=on).
 */
import { uuidv7 } from '@b2b/platform-kit';
import { loadConfig } from '../src/config.js';
import { createPrisma } from '../src/db.js';
import { hashPassword, passwordProblem } from '../src/modules/passwords.js';

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

const email = arg('email')?.toLowerCase();
const name = arg('name');
const password = arg('password');
const role = arg('role') ?? 'PLATFORM_SUPER_ADMIN';
if (!email || !name || !password) {
  console.error('usage: --email <email> --name <name> --password <password> [--role PLATFORM_SUPER_ADMIN|PLATFORM_REVIEWER|PLATFORM_SUPPORT]');
  process.exit(2);
}
const problem = passwordProblem(password);
if (problem) {
  console.error(problem);
  process.exit(2);
}

const config = loadConfig();
const prisma = createPrisma(config.DATABASE_URL, false);
const passwordHash = await hashPassword(password);
const user = await prisma.user.upsert({
  where: { email },
  update: { fullName: name, passwordHash, passwordAlgo: 'argon2id', status: 'ACTIVE', userType: 'PLATFORM' },
  create: { id: uuidv7(), email, fullName: name, passwordHash, passwordAlgo: 'argon2id', status: 'ACTIVE', userType: 'PLATFORM' },
});
await prisma.platformRoleAssignment.upsert({ where: { userId_role: { userId: user.id, role } }, update: {}, create: { userId: user.id, role } });
console.log(`platform admin ready: ${email} (${role}); MFA enrolment happens at first login`);
await prisma.$disconnect();
