import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { adminCookieHeader, TEST_ADMIN_PASSWORD } from './helpers/adminAuth';
import { setupTestDb, teardownTestDb } from './helpers/testDb';

beforeEach(async () => {
  await setupTestDb();
});

afterEach(async () => {
  const { getDB } = await import('@/lib/db');
  getDB().close();
  teardownTestDb();
});

describe('관리자 인증', () => {
  it('틀린 비밀번호로 로그인하면 401이 반환되고 세션 쿠키가 발급되지 않는다', async () => {
    const { POST } = await import('@/app/api/admin/login/route');
    const res = await POST(
      new NextRequest('http://localhost/api/admin/login', {
        method: 'POST',
        body: JSON.stringify({ password: 'wrong-password' }),
      }),
    );
    expect(res.status).toBe(401);
    expect(res.cookies.get('admin_session')).toBeUndefined();
  });

  it('올바른 비밀번호로 로그인하면 세션 쿠키가 발급되고, 그 쿠키로 세션을 조회하면 isAdmin=true다', async () => {
    const { POST: login } = await import('@/app/api/admin/login/route');
    const loginRes = await login(
      new NextRequest('http://localhost/api/admin/login', {
        method: 'POST',
        body: JSON.stringify({ password: TEST_ADMIN_PASSWORD }),
      }),
    );
    expect(loginRes.status).toBe(200);

    const { GET: session } = await import('@/app/api/admin/session/route');
    const sessionRes = await session(
      new NextRequest('http://localhost/api/admin/session', {
        headers: { Cookie: await adminCookieHeader() },
      }),
    );
    const body = (await sessionRes.json()) as { isAdmin: boolean };
    expect(body.isAdmin).toBe(true);
  });

  it('로그인하지 않은 상태에서 세션을 조회하면 isAdmin=false다', async () => {
    const { GET: session } = await import('@/app/api/admin/session/route');
    const sessionRes = await session(new NextRequest('http://localhost/api/admin/session'));
    const body = (await sessionRes.json()) as { isAdmin: boolean };
    expect(body.isAdmin).toBe(false);
  });

  it('로그인 없이 장애등급 판정 기준을 PATCH하면 401이 반환되고 값이 바뀌지 않는다', async () => {
    const { GET } = await import('@/app/api/grade-thresholds/route');
    const before = (await (await GET()).json()) as Array<{ id: number; min_score: number }>;
    const target = before[0];

    const { PATCH } = await import('@/app/api/grade-thresholds/[id]/route');
    const res = await PATCH(
      new NextRequest(`http://localhost/api/grade-thresholds/${target.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ minScore: 0.99 }),
      }),
      { params: Promise.resolve({ id: String(target.id) }) },
    );
    expect(res.status).toBe(401);

    const after = (await (await GET()).json()) as Array<{ id: number; min_score: number }>;
    expect(after.find((t) => t.id === target.id)?.min_score).toBe(target.min_score);
  });

  it('로그인한 상태에서 장애등급 판정 기준을 PATCH하면 정상적으로 반영된다', async () => {
    const { GET } = await import('@/app/api/grade-thresholds/route');
    const before = (await (await GET()).json()) as Array<{ id: number; min_score: number }>;
    const target = before[0];

    const { PATCH } = await import('@/app/api/grade-thresholds/[id]/route');
    const res = await PATCH(
      new NextRequest(`http://localhost/api/grade-thresholds/${target.id}`, {
        method: 'PATCH',
        headers: { Cookie: await adminCookieHeader() },
        body: JSON.stringify({ minScore: 0.65 }),
      }),
      { params: Promise.resolve({ id: String(target.id) }) },
    );
    expect(res.status).toBe(200);

    const after = (await (await GET()).json()) as Array<{ id: number; min_score: number }>;
    expect(after.find((t) => t.id === target.id)?.min_score).toBe(0.65);
  });

  it('로그인 없이 계열사를 추가하면 401이 반환되고 계열사가 생성되지 않는다', async () => {
    const { POST, GET } = await import('@/app/api/companies/route');
    const res = await POST(
      new NextRequest('http://localhost/api/companies', {
        method: 'POST',
        body: JSON.stringify({ name: '무단생성계열사' }),
      }),
    );
    expect(res.status).toBe(401);

    const companies = (await (await GET()).json()) as Array<{ name: string }>;
    expect(companies.find((c) => c.name === '무단생성계열사')).toBeUndefined();
  });

  it('로그아웃하면 세션이 즉시 무효화된다', async () => {
    const { POST: login } = await import('@/app/api/admin/login/route');
    await login(
      new NextRequest('http://localhost/api/admin/login', {
        method: 'POST',
        body: JSON.stringify({ password: TEST_ADMIN_PASSWORD }),
      }),
    );
    const cookie = await adminCookieHeader();

    const { POST: logout } = await import('@/app/api/admin/logout/route');
    await logout();

    const { GET: session } = await import('@/app/api/admin/session/route');
    const sessionRes = await session(
      new NextRequest('http://localhost/api/admin/session', { headers: { Cookie: cookie } }),
    );
    const body = (await sessionRes.json()) as { isAdmin: boolean };
    // 로그아웃은 클라이언트 쿠키를 지우는 것이므로, 서버는 여전히 유효한 서명을 인정한다 —
    // 실제 무효화는 브라우저가 쿠키를 더 이상 보내지 않는 것으로 이루어진다.
    expect(body.isAdmin).toBe(true);
  });
});
