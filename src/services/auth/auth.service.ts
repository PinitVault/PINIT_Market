import jwt from 'jsonwebtoken';
import { prisma } from '../../lib/prisma';
import { config } from '../../config/index';

const ACCESS_EXPIRES  = '7d';
const REFRESH_EXPIRES = '30d';
const REFRESH_MS      = 30 * 24 * 60 * 60 * 1000;

export interface JwtPayload {
  sub: string;
  shortId: string;
  name: string;
  role: string;
  iat?: number;
  exp?: number;
}

type UserRow = { id: string; shortId: string; fullName: string; role: string; isActive: boolean; lastLoginAt: Date | null };

function generateShortId(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = 'PINIT-';
  for (let i = 0; i < 8; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

function signAccess(p: Omit<JwtPayload, 'iat' | 'exp'>): string {
  return jwt.sign(p, config.jwt.secret, { expiresIn: ACCESS_EXPIRES });
}
function signRefresh(userId: string): string {
  return jwt.sign({ sub: userId }, config.jwt.secret, { expiresIn: REFRESH_EXPIRES });
}

async function findByShortId(shortId: string): Promise<UserRow | null> {
  const rows = await (prisma as any).$queryRaw`
    SELECT id, "shortId", "fullName", role, "isActive", "lastLoginAt"
    FROM users WHERE "shortId" = ${shortId} LIMIT 1
  `;
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function createUser(shortId: string): Promise<UserRow> {
  const rows = await (prisma as any).$queryRaw`
    INSERT INTO users (id, "shortId", "fullName", role, "isActive", "createdAt", "updatedAt")
    VALUES (gen_random_uuid(), ${shortId}, 'PINIT User', 'USER', true, now(), now())
    RETURNING id, "shortId", "fullName", role, "isActive", "lastLoginAt"
  `;
  return rows[0];
}

async function touchLogin(id: string) {
  await (prisma as any).$executeRaw`UPDATE users SET "lastLoginAt" = now(), "updatedAt" = now() WHERE id = ${id}`;
}

function tokenFor(user: UserRow) {
  const access  = signAccess({ sub: user.id, shortId: user.shortId, name: user.fullName, role: user.role });
  const refresh = signRefresh(user.id);
  return { access, refresh };
}

export const authService = {
  async createAccount() {
    let shortId = generateShortId();
    let attempts = 0;
    while (await findByShortId(shortId)) {
      shortId = generateShortId();
      if (++attempts > 10) throw new Error('ID_GENERATION_FAILED');
    }

    const user = await createUser(shortId);
    const { access, refresh } = tokenFor(user);

    await prisma.refreshToken.create({
      data: { token: refresh, userId: user.id, expiresAt: new Date(Date.now() + REFRESH_MS) },
    });

    return { user: { id: user.id, shortId: user.shortId, name: user.fullName, role: user.role }, accessToken: access, refreshToken: refresh };
  },

  async loginWithId(shortId: string) {
    const user = await findByShortId(shortId.toUpperCase().trim());
    if (!user || !user.isActive) throw new Error('INVALID_ID');

    await touchLogin(user.id);
    const { access, refresh } = tokenFor(user);

    await prisma.refreshToken.create({
      data: { token: refresh, userId: user.id, expiresAt: new Date(Date.now() + REFRESH_MS) },
    });

    return { user: { id: user.id, shortId: user.shortId, name: user.fullName, role: user.role }, accessToken: access, refreshToken: refresh };
  },

  async refresh(token: string) {
    const stored = await prisma.refreshToken.findUnique({ where: { token } });
    if (!stored || stored.expiresAt < new Date()) throw new Error('INVALID_REFRESH');

    const rows = await (prisma as any).$queryRaw`
      SELECT id, "shortId", "fullName", role, "isActive", "lastLoginAt" FROM users WHERE id = ${stored.userId} LIMIT 1
    `;
    const user: UserRow | undefined = rows[0];
    if (!user || !user.isActive) throw new Error('INVALID_REFRESH');

    await prisma.refreshToken.delete({ where: { token } });
    const { access, refresh } = tokenFor(user);

    await prisma.refreshToken.create({
      data: { token: refresh, userId: user.id, expiresAt: new Date(Date.now() + REFRESH_MS) },
    });

    return { accessToken: access, refreshToken: refresh };
  },

  async logout(token: string) {
    await prisma.refreshToken.deleteMany({ where: { token } });
  },

  verifyAccess(token: string): JwtPayload {
    return jwt.verify(token, config.jwt.secret) as JwtPayload;
  },
};
