import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { setupTestDb, teardownTestDb } from './helpers/testDb';
import type Database from 'better-sqlite3';
import type {
  ImpactCriteria,
  ImpactItem,
  IncidentCalculationRequest,
  IncidentCalculationResult,
  IncidentRecordListResponse,
} from '@/types';

let db: Database.Database;

beforeEach(async () => {
  db = await setupTestDb();
});

afterEach(() => {
  teardownTestDb();
});

// seedImpactCriteria()가 DB 초기화 시 '유진기업'을 가장 먼저(유일하게) 생성하므로 매 테스트마다 id=1로 고정된다.
const COMPANY_ID = 1;

async function getCriteria(companyId: number): Promise<ImpactCriteria> {
  const { GET } = await import('@/app/api/impact-criteria/route');
  const req = new NextRequest(`http://localhost/api/impact-criteria?companyId=${companyId}`);
  const res = await GET(req);
  return (await res.json()) as ImpactCriteria;
}

function itemsOf(criteria: ImpactCriteria, subcategoryCode: string): ImpactItem[] {
  for (const category of criteria.categories) {
    const subcategory = category.subcategories.find((s) => s.code === subcategoryCode);
    if (subcategory) return subcategory.items;
  }
  throw new Error(`fixture: subcategory not found - ${subcategoryCode}`);
}

function byName(items: ImpactItem[], name: string): ImpactItem {
  const item = items.find((candidate) => candidate.name === name);
  if (!item) throw new Error(`fixture: item not found - ${name}`);
  return item;
}

type CalcChoices = {
  title?: string;
  systemName?: string;
  failureScopeName?: string;
  complexityName?: string;
  accessFailureName?: string;
  responseSpeedName?: string;
  recurrenceName?: string;
};

async function calculate(companyId: number, choices: CalcChoices = {}): Promise<IncidentCalculationResult> {
  const criteria = await getCriteria(companyId);
  const targetSystems = itemsOf(criteria, 'target_systems');
  const failureScope = itemsOf(criteria, 'failure_scope');
  const severity = itemsOf(criteria, 'severity');
  const accessFailure = itemsOf(criteria, 'access_failure');
  const responseSpeed = itemsOf(criteria, 'response_speed');
  const recurrence = itemsOf(criteria, 'recurrence');

  const body: IncidentCalculationRequest = {
    companyId,
    title: choices.title ?? '테스트 장애',
    selectedSystemItemIds: [byName(targetSystems, choices.systemName ?? targetSystems[0].name).id],
    failureScope: { itemId: byName(failureScope, choices.failureScopeName ?? '전사').id },
    complexity: { itemId: byName(severity, choices.complexityName ?? '단순장애').id, isUnknown: false },
    accessFailure: { itemId: byName(accessFailure, choices.accessFailureName ?? '없음').id, isUnknown: false },
    responseSpeed: { itemId: byName(responseSpeed, choices.responseSpeedName ?? '없음').id, isUnknown: false },
    recurrence: { itemId: byName(recurrence, choices.recurrenceName ?? '없음').id, isUnknown: false },
  };

  const { POST } = await import('@/app/api/incident-calculation/route');
  const req = new NextRequest('http://localhost/api/incident-calculation', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
  const res = await POST(req);
  if (!res.ok) {
    throw new Error(`fixture: 계산 API 실패 - ${JSON.stringify(await res.json())}`);
  }
  return (await res.json()) as IncidentCalculationResult;
}

async function getDetail(id: number): Promise<IncidentCalculationResult> {
  const { GET } = await import('@/app/api/incident-records/[id]/route');
  const req = new NextRequest(`http://localhost/api/incident-records/${id}`);
  const res = await GET(req, { params: Promise.resolve({ id: String(id) }) });
  return (await res.json()) as IncidentCalculationResult;
}

async function getList(
  query: Record<string, string | number | undefined> = {},
): Promise<IncidentRecordListResponse> {
  const { GET } = await import('@/app/api/incident-records/route');
  const url = new URL('http://localhost/api/incident-records');
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  const req = new NextRequest(url.toString());
  const res = await GET(req);
  return (await res.json()) as IncidentRecordListResponse;
}

describe('장애 이력 - 목록', () => {
  it('US-1/US-2: 목록 조회 시 이력이 배열로 반환되고 계열사·등급·산정 일시가 포함된다', async () => {
    const created = await calculate(COMPANY_ID);
    const list = await getList();

    expect(Array.isArray(list.records)).toBe(true);
    const found = list.records.find((r) => r.id === created.id);
    expect(found).toBeDefined();
    expect(found!.company_id).toBe(COMPANY_ID);
    expect(found!.company_name).toBe('유진기업');
    expect(typeof found!.grade).toBe('string');
    expect(typeof found!.calculated_at).toBe('string');
  });

  it('US-7: 목록이 산정 시각(calculated_at) 기준 최근순(내림차순)으로 정렬된다', async () => {
    const first = await calculate(COMPANY_ID, { title: '첫번째' });
    const second = await calculate(COMPANY_ID, { title: '두번째' });

    const list = await getList();
    const ids = list.records.map((r) => r.id);

    expect(ids.indexOf(second.id)).toBeLessThan(ids.indexOf(first.id));
  });

  it('US-8: 계열사(companyId)로 필터링된다', async () => {
    const targetSub = db
      .prepare("SELECT id FROM impact_subcategories WHERE code = 'target_systems'")
      .get() as { id: number };
    const company2Id = db.prepare('INSERT INTO companies (name) VALUES (?)').run('테스트계열사')
      .lastInsertRowid as number;
    db.prepare(
      `INSERT INTO impact_items (subcategory_id, company_id, name, value, group_name, display_order, is_active, min_value, max_value)
       VALUES (@subcategory_id, @company_id, '테스트시스템', 0.5, NULL, 1, 1, NULL, NULL)`,
    ).run({ subcategory_id: targetSub.id, company_id: company2Id });

    const recordA = await calculate(COMPANY_ID);
    const recordB = await calculate(company2Id, { systemName: '테스트시스템' });

    const filtered = await getList({ companyId: COMPANY_ID });
    const ids = filtered.records.map((r) => r.id);

    expect(ids).toContain(recordA.id);
    expect(ids).not.toContain(recordB.id);
    expect(filtered.records.every((r) => r.company_id === COMPANY_ID)).toBe(true);
  });

  it('US-9: 등급(grade)으로 필터링된다', async () => {
    const mild = await calculate(COMPANY_ID);
    const severe = await calculate(COMPANY_ID, {
      systemName: 'SD(영업)',
      complexityName: '복잡장애',
      accessFailureName: '있음',
      responseSpeedName: '있음(성능불만)',
      recurrenceName: '있음',
    });

    expect(mild.grade).not.toBe(severe.grade);

    const filtered = await getList({ grade: severe.grade });
    const ids = filtered.records.map((r) => r.id);

    expect(ids).toContain(severe.id);
    expect(ids).not.toContain(mild.id);
    expect(filtered.records.every((r) => r.grade === severe.grade)).toBe(true);
  });

  it('US-10: 기간(startDate~endDate)으로 필터링된다', async () => {
    const jan = await calculate(COMPANY_ID, { title: '1월 건' });
    const jun = await calculate(COMPANY_ID, { title: '6월 건' });

    db.prepare('UPDATE incident_records SET calculated_at = ? WHERE id = ?').run('2024-01-15 10:00:00', jan.id);
    db.prepare('UPDATE incident_records SET calculated_at = ? WHERE id = ?').run('2024-06-20 10:00:00', jun.id);

    const janResult = await getList({ startDate: '2024-01-01', endDate: '2024-01-31' });
    expect(janResult.records.map((r) => r.id)).toEqual([jan.id]);

    const junResult = await getList({ startDate: '2024-06-01', endDate: '2024-06-30' });
    expect(junResult.records.map((r) => r.id)).toEqual([jun.id]);
  });

  it('US-13: 페이지 단위로 나뉘어 보인다(page/pageSize, total/hasMore 포함)', async () => {
    const r1 = await calculate(COMPANY_ID, { title: '1' });
    const r2 = await calculate(COMPANY_ID, { title: '2' });
    const r3 = await calculate(COMPANY_ID, { title: '3' });

    const page1 = await getList({ page: 1, pageSize: 2 });
    expect(page1.records.length).toBe(2);
    expect(page1.total).toBe(3);
    expect(page1.page).toBe(1);
    expect(page1.pageSize).toBe(2);
    expect(page1.hasMore).toBe(true);

    const page2 = await getList({ page: 2, pageSize: 2 });
    expect(page2.records.length).toBe(1);
    expect(page2.hasMore).toBe(false);

    const allIds = new Set([...page1.records, ...page2.records].map((r) => r.id));
    expect(allIds).toEqual(new Set([r1.id, r2.id, r3.id]));
  });

  it('US-12: 이력 수정·삭제 API가 없다(PATCH/PUT/DELETE 미노출)', async () => {
    const listModule: Record<string, unknown> = await import('@/app/api/incident-records/route');
    const detailModule: Record<string, unknown> = await import('@/app/api/incident-records/[id]/route');

    expect('PATCH' in listModule).toBe(false);
    expect('PUT' in listModule).toBe(false);
    expect('DELETE' in listModule).toBe(false);
    expect('PATCH' in detailModule).toBe(false);
    expect('PUT' in detailModule).toBe(false);
    expect('DELETE' in detailModule).toBe(false);
  });
});

describe('장애 이력 - 상세', () => {
  it('US-5: 상세 응답에 총점과 대분류별 소계(비즈니스/복잡도/고객서비스)가 포함된다', async () => {
    const created = await calculate(COMPANY_ID);
    const detail = await getDetail(created.id);

    expect(typeof detail.businessScore).toBe('number');
    expect(typeof detail.complexityScore).toBe('number');
    expect(typeof detail.customerScore).toBe('number');
    expect(typeof detail.totalScore).toBe('number');
    expect(detail.totalScore).toBeCloseTo(
      detail.businessScore + detail.complexityScore + detail.customerScore,
      10,
    );
  });

  it('US-6: 상세 응답에 "미확인"으로 선택했던 항목이 표시된다(complexity.isUnknown)', async () => {
    const criteria = await getCriteria(COMPANY_ID);
    const targetSystems = itemsOf(criteria, 'target_systems');
    const failureScope = itemsOf(criteria, 'failure_scope');
    const accessFailure = itemsOf(criteria, 'access_failure');
    const responseSpeed = itemsOf(criteria, 'response_speed');
    const recurrence = itemsOf(criteria, 'recurrence');

    const body: IncidentCalculationRequest = {
      companyId: COMPANY_ID,
      title: '미확인 테스트',
      selectedSystemItemIds: [targetSystems[0].id],
      failureScope: { itemId: byName(failureScope, '전사').id },
      complexity: { isUnknown: true },
      accessFailure: { itemId: byName(accessFailure, '없음').id, isUnknown: false },
      responseSpeed: { itemId: byName(responseSpeed, '없음').id, isUnknown: false },
      recurrence: { itemId: byName(recurrence, '없음').id, isUnknown: false },
    };

    const { POST } = await import('@/app/api/incident-calculation/route');
    const postRes = await POST(
      new NextRequest('http://localhost/api/incident-calculation', {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    expect(postRes.ok).toBe(true);
    const created = (await postRes.json()) as IncidentCalculationResult;

    const detail = await getDetail(created.id);

    expect(detail.complexity.isUnknown).toBe(true);
    expect(typeof detail.complexity.choice).toBe('string');
    expect(typeof detail.complexity.value).toBe('number');
  });

  it('Impl-상세화면: 상세 응답이 계열사·산정시각·선택 시스템 전체·항목별 선택결과·소계·총점·등급을 모두 포함한다', async () => {
    const created = await calculate(COMPANY_ID, { systemName: '콘라이브' });
    const detail = await getDetail(created.id);

    expect(detail.companyName).toBe('유진기업');
    expect(typeof detail.calculatedAt).toBe('string');

    expect(Array.isArray(detail.systems)).toBe(true);
    expect(detail.systems.length).toBeGreaterThan(0);
    expect(detail.systems[0]).toMatchObject({
      name: expect.any(String),
      value: expect.any(Number),
    });

    for (const result of [detail.failureScope, detail.complexity, detail.accessFailure, detail.responseSpeed, detail.recurrence]) {
      expect(typeof result.choice).toBe('string');
      expect(typeof result.value).toBe('number');
    }
    expect(typeof detail.complexity.isUnknown).toBe('boolean');
    expect(typeof detail.accessFailure.isUnknown).toBe('boolean');
    expect(typeof detail.responseSpeed.isUnknown).toBe('boolean');
    expect(typeof detail.recurrence.isUnknown).toBe('boolean');

    expect(typeof detail.businessScore).toBe('number');
    expect(typeof detail.complexityScore).toBe('number');
    expect(typeof detail.customerScore).toBe('number');
    expect(typeof detail.totalScore).toBe('number');
    expect(['1등급', '2등급', '3등급', '등급외']).toContain(detail.grade);
  });

  it('Impl-스냅샷: 저장된 이력은 이후 기준표 변경과 무관하게 스냅샷 값을 유지한다', async () => {
    const created = await calculate(COMPANY_ID, { systemName: '콘라이브' });
    const before = await getDetail(created.id);

    // '영향도-기준표-관리'에서 값 변경 및 비활성화가 일어난 상황을 흉내낸다.
    db.prepare("UPDATE impact_items SET value = 0.01, is_active = 0 WHERE name = '콘라이브'").run();

    const after = await getDetail(created.id);

    expect(after.businessScore).toBe(before.businessScore);
    expect(after.totalScore).toBe(before.totalScore);
    expect(after.grade).toBe(before.grade);
    expect(after.systems).toEqual(before.systems);
  });
});
