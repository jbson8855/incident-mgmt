import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { adminCookieHeader } from './helpers/adminAuth';
import { setupTestDb, teardownTestDb } from './helpers/testDb';
import type {
  Company,
  GradeThreshold,
  ImpactCategory,
  ImpactCriteria,
  ImpactItem,
  ImpactSubcategory,
} from '@/types';

beforeEach(async () => {
  await setupTestDb();
});

afterEach(async () => {
  // Windows에서는 better-sqlite3가 임시 디렉터리 파일을 잠그고 있으면 teardownTestDb()의
  // rmSync가 EPERM으로 실패하므로, 임시 디렉터리를 지우기 전에 DB 커넥션을 먼저 닫는다.
  const { getDB } = await import('@/lib/db');
  getDB().close();
  teardownTestDb();
});

// 시드된 "유진기업"의 company id를 GET /api/companies로 조회한다 (하드코딩 금지).
async function getYujinCompanyId(): Promise<number> {
  const { GET } = await import('@/app/api/companies/route');
  const res = await GET();
  const companies = (await res.json()) as Company[];
  const yujin = companies.find((c) => c.name === '유진기업');
  if (!yujin) throw new Error('유진기업 시드 데이터를 찾을 수 없습니다.');
  return yujin.id;
}

async function getImpactCriteria(companyId: number): Promise<ImpactCriteria> {
  const { GET } = await import('@/app/api/impact-criteria/route');
  const res = await GET(new NextRequest(`http://localhost/api/impact-criteria?companyId=${companyId}`));
  return (await res.json()) as ImpactCriteria;
}

describe('영향도 기준표 관리', () => {
  it('US-1: 계열사 기준표 전체 조회 시 비즈니스영향도/장애복잡도/고객서비스영향도 대분류 3개가 중분류·항목을 포함한 트리로 응답에 모두 포함된다', async () => {
    const companyId = await getYujinCompanyId();
    const body = await getImpactCriteria(companyId);

    expect(body.categories).toHaveLength(3);
    const codes = body.categories.map((c) => c.code).sort();
    expect(codes).toEqual(['business', 'complexity', 'customer']);

    const business = body.categories.find((c) => c.code === 'business')!;
    const complexity = body.categories.find((c) => c.code === 'complexity')!;
    const customer = body.categories.find((c) => c.code === 'customer')!;

    // 비즈니스영향도 → 대상(업무서비스) 중분류, 그 안에 시드된 시스템 항목들(예: SD(영업) 1)이 있어야 한다.
    const targetSystems = business.subcategories.find((s) => s.code === 'target_systems')!;
    expect(targetSystems).toBeDefined();
    const sdSales = targetSystems.items.find((i) => i.name === 'SD(영업)');
    expect(sdSales?.value).toBe(1);

    // 장애복잡도 → 장애심각도 중분류, 단순장애 0.2 / 복잡장애 0.8
    const severity = complexity.subcategories.find((s) => s.code === 'severity')!;
    expect(severity).toBeDefined();
    expect(severity.items.find((i) => i.name === '단순장애')?.value).toBe(0.2);
    expect(severity.items.find((i) => i.name === '복잡장애')?.value).toBe(0.8);

    // 고객서비스영향도 → 접속장애여부/응답속도/동일장애재발 중분류가 모두 있어야 한다.
    const customerSubcategoryCodes = customer.subcategories.map((s) => s.code).sort();
    expect(customerSubcategoryCodes).toEqual(expect.arrayContaining(['access_failure', 'response_speed', 'recurrence']));
  });

  it('US-3/US-6/US-8: 항목 값(반영률/기준값)을 PATCH로 새 값으로 수정하면 그 값으로 갱신된다', async () => {
    const companyId = await getYujinCompanyId();
    const before = await getImpactCriteria(companyId);
    const business = before.categories.find((c) => c.code === 'business')!;
    const targetSystems = business.subcategories.find((s) => s.code === 'target_systems')!;
    const sdSales = targetSystems.items.find((i) => i.name === 'SD(영업)')!;

    const { PATCH } = await import('@/app/api/impact-criteria/items/[id]/route');
    const res = await PATCH(
      new NextRequest(`http://localhost/api/impact-criteria/items/${sdSales.id}`, {
        method: 'PATCH',
        headers: { Cookie: await adminCookieHeader() },
        body: JSON.stringify({ value: 0.6 }),
      }),
      { params: Promise.resolve({ id: String(sdSales.id) }) },
    );
    expect(res.status).toBe(200);
    const updated = (await res.json()) as ImpactItem;
    expect(updated.value).toBe(0.6);

    const after = await getImpactCriteria(companyId);
    const afterBusiness = after.categories.find((c) => c.code === 'business')!;
    const afterTargetSystems = afterBusiness.subcategories.find((s) => s.code === 'target_systems')!;
    expect(afterTargetSystems.items.find((i) => i.id === sdSales.id)?.value).toBe(0.6);
  });

  it('US-4: 대상(업무서비스) 중분류에 이름/값/그룹명으로 POST하면 새 항목이 비즈니스영향도 목록에 추가되고 그룹명이 함께 저장·반환된다', async () => {
    const companyId = await getYujinCompanyId();
    const before = await getImpactCriteria(companyId);
    const business = before.categories.find((c) => c.code === 'business')!;
    const targetSystems = business.subcategories.find((s) => s.code === 'target_systems')!;

    const { POST } = await import('@/app/api/impact-criteria/items/route');
    const res = await POST(
      new NextRequest('http://localhost/api/impact-criteria/items', {
        method: 'POST',
        headers: { Cookie: await adminCookieHeader() },
        body: JSON.stringify({
          subcategoryId: targetSystems.id,
          name: '신규시스템',
          value: 0.4,
          groupName: '기타',
          companyId,
        }),
      }),
    );
    expect(res.status).toBe(201);
    const created = (await res.json()) as ImpactItem;
    expect(created.name).toBe('신규시스템');
    expect(created.value).toBe(0.4);
    expect(created.group_name).toBe('기타');

    const after = await getImpactCriteria(companyId);
    const afterBusiness = after.categories.find((c) => c.code === 'business')!;
    const afterTargetSystems = afterBusiness.subcategories.find((s) => s.code === 'target_systems')!;
    const found = afterTargetSystems.items.find((i) => i.id === created.id);
    expect(found).toBeDefined();
    expect(found?.name).toBe('신규시스템');
    expect(found?.group_name).toBe('기타');
  });

  it('US-5: 항목을 DELETE하면 실제 행 삭제가 아니라 비활성화되어 이후 GET 조회(활성 항목만 반환)에서 빠진다', async () => {
    const companyId = await getYujinCompanyId();
    const before = await getImpactCriteria(companyId);
    const business = before.categories.find((c) => c.code === 'business')!;
    const targetSystems = business.subcategories.find((s) => s.code === 'target_systems')!;
    const sdSales = targetSystems.items.find((i) => i.name === 'SD(영업)')!;

    const { DELETE } = await import('@/app/api/impact-criteria/items/[id]/route');
    const res = await DELETE(
      new NextRequest(`http://localhost/api/impact-criteria/items/${sdSales.id}`, {
        method: 'DELETE',
        headers: { Cookie: await adminCookieHeader() },
      }),
      { params: Promise.resolve({ id: String(sdSales.id) }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);

    const after = await getImpactCriteria(companyId);
    const afterBusiness = after.categories.find((c) => c.code === 'business')!;
    const afterTargetSystems = afterBusiness.subcategories.find((s) => s.code === 'target_systems')!;
    expect(afterTargetSystems.items.find((i) => i.id === sdSales.id)).toBeUndefined();

    // 실제 행이 삭제된 것이 아니라 비활성화(is_active=0)된 것인지 DB에서 직접 확인한다.
    const { getDB } = await import('@/lib/db');
    const db = getDB();
    const row = db.prepare('SELECT is_active FROM impact_items WHERE id = ?').get(sdSales.id) as { is_active: number } | undefined;
    expect(row).toBeDefined();
    expect(row?.is_active).toBe(0);
  });

  it('US-7: 접속장애여부/응답속도/동일장애재발 중 하나의 중분류 weight를 PATCH로 수정하면 반영된다', async () => {
    const companyId = await getYujinCompanyId();
    const before = await getImpactCriteria(companyId);
    const customer = before.categories.find((c) => c.code === 'customer')!;
    const accessFailure = customer.subcategories.find((s) => s.code === 'access_failure')!;
    expect(accessFailure.weight).toBe(0.3);

    const { PATCH } = await import('@/app/api/impact-criteria/subcategories/[id]/route');
    const res = await PATCH(
      new NextRequest(`http://localhost/api/impact-criteria/subcategories/${accessFailure.id}`, {
        method: 'PATCH',
        headers: { Cookie: await adminCookieHeader() },
        body: JSON.stringify({ weight: 0.4 }),
      }),
      { params: Promise.resolve({ id: String(accessFailure.id) }) },
    );
    expect(res.status).toBe(200);
    const updated = (await res.json()) as ImpactSubcategory;
    expect(updated.weight).toBe(0.4);

    const after = await getImpactCriteria(companyId);
    const afterCustomer = after.categories.find((c) => c.code === 'customer')!;
    expect(afterCustomer.subcategories.find((s) => s.code === 'access_failure')?.weight).toBe(0.4);
  });

  it('US-9: 비즈니스영향도/장애복잡도/고객서비스영향도 중 하나의 대분류 weight를 PATCH로 수정하면 반영된다', async () => {
    const companyId = await getYujinCompanyId();
    const before = await getImpactCriteria(companyId);
    const complexity = before.categories.find((c) => c.code === 'complexity')!;
    expect(complexity.weight).toBe(0.2);

    const { PATCH } = await import('@/app/api/impact-criteria/categories/[id]/route');
    const res = await PATCH(
      new NextRequest(`http://localhost/api/impact-criteria/categories/${complexity.id}`, {
        method: 'PATCH',
        headers: { Cookie: await adminCookieHeader() },
        body: JSON.stringify({ weight: 0.25 }),
      }),
      { params: Promise.resolve({ id: String(complexity.id) }) },
    );
    expect(res.status).toBe(200);
    const updated = (await res.json()) as ImpactCategory;
    expect(updated.weight).toBe(0.25);

    const after = await getImpactCriteria(companyId);
    expect(after.categories.find((c) => c.code === 'complexity')?.weight).toBe(0.25);
  });

  it('US-11: 항목의 value가 0~1 범위를 벗어나면 저장이 거부된다(400, 레코드 미변경)', async () => {
    const companyId = await getYujinCompanyId();
    const before = await getImpactCriteria(companyId);
    const business = before.categories.find((c) => c.code === 'business')!;
    const targetSystems = business.subcategories.find((s) => s.code === 'target_systems')!;
    const sdSales = targetSystems.items.find((i) => i.name === 'SD(영업)')!;

    const { PATCH } = await import('@/app/api/impact-criteria/items/[id]/route');
    const res = await PATCH(
      new NextRequest(`http://localhost/api/impact-criteria/items/${sdSales.id}`, {
        method: 'PATCH',
        headers: { Cookie: await adminCookieHeader() },
        body: JSON.stringify({ value: 1.5 }),
      }),
      { params: Promise.resolve({ id: String(sdSales.id) }) },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(typeof body.error).toBe('string');

    const after = await getImpactCriteria(companyId);
    const afterBusiness = after.categories.find((c) => c.code === 'business')!;
    const afterTargetSystems = afterBusiness.subcategories.find((s) => s.code === 'target_systems')!;
    expect(afterTargetSystems.items.find((i) => i.id === sdSales.id)?.value).toBe(sdSales.value);
  });

  it('US-11: 항목의 name이 공백/빈 문자열이면 저장이 거부된다(400, 레코드 미변경)', async () => {
    const companyId = await getYujinCompanyId();
    const before = await getImpactCriteria(companyId);
    const business = before.categories.find((c) => c.code === 'business')!;
    const targetSystems = business.subcategories.find((s) => s.code === 'target_systems')!;
    const sdSales = targetSystems.items.find((i) => i.name === 'SD(영업)')!;

    const { PATCH } = await import('@/app/api/impact-criteria/items/[id]/route');
    const res = await PATCH(
      new NextRequest(`http://localhost/api/impact-criteria/items/${sdSales.id}`, {
        method: 'PATCH',
        headers: { Cookie: await adminCookieHeader() },
        body: JSON.stringify({ name: '   ' }),
      }),
      { params: Promise.resolve({ id: String(sdSales.id) }) },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(typeof body.error).toBe('string');

    const after = await getImpactCriteria(companyId);
    const afterBusiness = after.categories.find((c) => c.code === 'business')!;
    const afterTargetSystems = afterBusiness.subcategories.find((s) => s.code === 'target_systems')!;
    expect(afterTargetSystems.items.find((i) => i.id === sdSales.id)?.name).toBe(sdSales.name);
  });

  it('US-14: GET /api/grade-thresholds로 전체 조회하면 1등급 0.8초과/2등급 0.7초과~0.8/3등급 0.5초과~0.7/등급외가 반환되고, 특정 등급을 PATCH로 수정하면 반영된다', async () => {
    const { GET } = await import('@/app/api/grade-thresholds/route');
    const res = await GET();
    const thresholds = (await res.json()) as GradeThreshold[];

    const grade1 = thresholds.find((t) => t.grade === '1등급')!;
    const grade2 = thresholds.find((t) => t.grade === '2등급')!;
    const grade3 = thresholds.find((t) => t.grade === '3등급')!;
    expect(grade1.min_score).toBe(0.8);
    expect(grade1.max_score).toBeNull(); // 1등급은 상한 없음
    expect(grade2.min_score).toBe(0.7);
    expect(grade2.max_score).toBe(0.8);
    expect(grade3.min_score).toBe(0.5);
    expect(grade3.max_score).toBe(0.7);

    const { PATCH } = await import('@/app/api/grade-thresholds/[id]/route');
    const patchRes = await PATCH(
      new NextRequest(`http://localhost/api/grade-thresholds/${grade2.id}`, {
        method: 'PATCH',
        headers: { Cookie: await adminCookieHeader() },
        body: JSON.stringify({ minScore: 0.75, maxScore: 0.85 }),
      }),
      { params: Promise.resolve({ id: String(grade2.id) }) },
    );
    expect(patchRes.status).toBe(200);
    const updated = (await patchRes.json()) as GradeThreshold;
    expect(updated.min_score).toBe(0.75);
    expect(updated.max_score).toBe(0.85);

    const afterRes = await GET();
    const afterThresholds = (await afterRes.json()) as GradeThreshold[];
    const afterGrade2 = afterThresholds.find((t) => t.grade === '2등급')!;
    expect(afterGrade2.min_score).toBe(0.75);
    expect(afterGrade2.max_score).toBe(0.85);
  });

  it('ID-weight-sum-not-blocking: 대분류 가중치 합이 100%가 아니게 되는 PATCH를 보내도 저장이 거부되지 않는다(성공 응답)', async () => {
    const companyId = await getYujinCompanyId();
    const before = await getImpactCriteria(companyId);
    // 비즈니스영향도 0.5 + 장애복잡도 0.2 + 고객서비스영향도 0.3 = 1(100%). 하나만 바꿔 합을 깨뜨린다.
    const business = before.categories.find((c) => c.code === 'business')!;
    expect(business.weight).toBe(0.5);

    const { PATCH } = await import('@/app/api/impact-criteria/categories/[id]/route');
    const res = await PATCH(
      new NextRequest(`http://localhost/api/impact-criteria/categories/${business.id}`, {
        method: 'PATCH',
        headers: { Cookie: await adminCookieHeader() },
        body: JSON.stringify({ weight: 0.9 }),
      }),
      { params: Promise.resolve({ id: String(business.id) }) },
    );
    expect(res.status).toBe(200);
    const updated = (await res.json()) as ImpactCategory;
    expect(updated.weight).toBe(0.9);

    const after = await getImpactCriteria(companyId);
    const complexity = after.categories.find((c) => c.code === 'complexity')!;
    const customer = after.categories.find((c) => c.code === 'customer')!;
    const newBusiness = after.categories.find((c) => c.code === 'business')!;
    // 0.9 + 0.2 + 0.3 = 1.4 ≠ 1(100%) 이지만 저장은 그대로 성공해 있어야 한다.
    expect(newBusiness.weight + complexity.weight + customer.weight).not.toBe(1);
    expect(newBusiness.weight).toBe(0.9);
  });
});
