import { createHmac, timingSafeEqual } from 'crypto';

export const ADMIN_COOKIE_NAME = 'admin_session';

function timingSafeStringEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function signSession(): string {
  return createHmac('sha256', process.env.ADMIN_PASSWORD as string).update('admin').digest('hex');
}

export function isValidAdminPassword(password: unknown): boolean {
  if (!process.env.ADMIN_PASSWORD || typeof password !== 'string' || !password) return false;
  return timingSafeStringEqual(password, process.env.ADMIN_PASSWORD);
}

export function adminSessionToken(): string {
  return signSession();
}

function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get('cookie');
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const separatorIndex = part.indexOf('=');
    if (separatorIndex === -1) continue;
    if (part.slice(0, separatorIndex).trim() === name) {
      return part.slice(separatorIndex + 1).trim();
    }
  }
  return undefined;
}

export function isAdminRequest(request: Request): boolean {
  if (!process.env.ADMIN_PASSWORD) return false;
  const token = readCookie(request, ADMIN_COOKIE_NAME);
  if (!token) return false;
  return timingSafeStringEqual(token, signSession());
}
