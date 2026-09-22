import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import type Database from 'better-sqlite3';
import { setupTestDb, teardownTestDb } from './helpers/testDb';
import type { ImpactCriteria, IncidentCalculationRequest, IncidentRecord } from '@/types';

let db: Database.Database;

beforeEach(async () => {
  db = await setupTestDb();
});
afterEach(() => {
  // Windows에서는 better-sqlite3가 파일 핸들을 쥔 채로는 임시 디렉터리를 지울 수 없어(EPERM),
  // teardownTestDb()가 삭제를 시도하기 전에 이 테스트 파일이 연 커넥션을 먼저 닫아준다.
  db.close();
  teardownTestDb();
});

const COMPANY_ID = 1;

async function fetchCriteria(): Promise<ImpactCriteria> {
  const { GET } = await import('@/app/api/impact-criteria/route');
  const { NextRequest } = await import('next/server');
  const req = new NextRequest(`http://localhost/api/impact-criteria?companyId=${COMPANY_ID}`);
  const res = await GET(req);
  return res.json();
}

function findItemIdByName(criteria: ImpactCriteria, subcategoryCode: string, itemName: string): number {
  for (const category of criteria.categories) {
    for (const subcategory of category.subcategories) {
      if (subcategory.code !== subcategoryCode) continue;
      const item = subcategory.items.find((candidate) => candidate.name === itemName);
      if (item) return item.id;
    }
  }
  throw new Error(`기준표에서 항목을 찾을 수 없습니다: ${subcategoryCode}/${itemName}`);
}

function baseBody(criteria: ImpactCriteria, overrides: Partial<IncidentCalculationRequest> = {}): IncidentCalculationRequest {
  const conlive = findItemIdByName(criteria, 'target_systems', '콘라이브');
  const jeonsa = findItemIdByName(criteria, 'failure_scope', '전사');
  const simple = findItemIdByName(criteria, 'severity', '단순장애');
  const accessNo = findItemIdByName(criteria, 'access_failure', '없음');
  const speedNo = findItemIdByName(criteria, 'response_speed', '없음');
  const recurrenceNo = findItemIdByName(criteria, 'recurrence', '없음');
  return {
    companyId: COMPANY_ID,
    title: '테스트 장애',
    selectedSystemItemIds: [conlive],
    failureScope: { itemId: jeonsa },
    complexity: { itemId: simple, isUnknown: false },
    accessFailure: { itemId: accessNo, isUnknown: false },
    responseSpeed: { itemId: speedNo, isUnknown: false },
    recurrence: { itemId: recurrenceNo, isUnknown: false },
    ...overrides,
  };
}

async function callCalculate(body: unknown) {
  const { POST } = await import('@/app/api/incident-calculation/route');
  const { NextRequest } = await import('next/server');
  const req = new NextRequest('http://localhost/api/incident-calculation', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  const res = await POST(req);
  const json = await res.json();
  return { status: res.status, body: json };
}

function recordCount(): number {
  return (db.prepare('SELECT COUNT(*) AS count FROM incident_records').get() as { count: number }).count;
}

describe('ID-business-formula', () => {
  it('콘라이브(0.8)만 선택 + 서비스장애범위 일부 30% 입력 시 비즈니스영향도점수는 0.5 × 0.8 × 0.3 = 0.12다', async () => {
    const criteria = await fetchCriteria();
    const bujeon = findItemIdByName(criteria, 'failure_scope', '일부');
    const body = baseBody(criteria, { failureScope: { itemId: bujeon, inputValue: 0.3 } });

    const { status, body: result } = await callCalculate(body);

    expect(status).toBe(200);
    expect(result.businessScore).toBeCloseTo(0.12, 5);
  });
});

describe('US-2-1', () => {
  it('동일한 시스템 선택을 유지한 채 서비스 장애 범위만 전사(1)와 일부(0.3)로 바꾸면 비즈니스영향도 점수가 서로 달라진다', async () => {
    const criteria = await fetchCriteria();
    const jeonsa = findItemIdByName(criteria, 'failure_scope', '전사');
    const bujeon = findItemIdByName(criteria, 'failure_scope', '일부');

    const wholeCompany = await callCalculate(baseBody(criteria, { failureScope: { itemId: jeonsa } }));
    const partial = await callCalculate(baseBody(criteria, { failureScope: { itemId: bujeon, inputValue: 0.3 } }));

    expect(wholeCompany.status).toBe(200);
    expect(partial.status).toBe(200);
    expect(wholeCompany.body.businessScore).toBeCloseTo(0.5 * 0.8 * 1, 5);
    expect(partial.body.businessScore).toBeCloseTo(0.5 * 0.8 * 0.3, 5);
    expect(wholeCompany.body.businessScore).not.toBeCloseTo(partial.body.businessScore, 5);
  });
});

describe('ID-failure-scope-exclusive', () => {
  it('장애복잡도/고객서비스영향도 선택을 동일하게 유지한 채 장애범위만 바꿔도 complexityScore/customerScore는 변하지 않는다', async () => {
    const criteria = await fetchCriteria();
    const jeonsa = findItemIdByName(criteria, 'failure_scope', '전사');
    const bujeon = findItemIdByName(criteria, 'failure_scope', '일부');
    const complexItem = findItemIdByName(criteria, 'severity', '복잡장애');
    const accessYes = findItemIdByName(criteria, 'access_failure', '있음');

    const common: Partial<IncidentCalculationRequest> = {
      complexity: { itemId: complexItem, isUnknown: false },
      accessFailure: { itemId: accessYes, isUnknown: false },
    };

    const wholeCompany = await callCalculate(baseBody(criteria, { ...common, failureScope: { itemId: jeonsa } }));
    const partial = await callCalculate(
      baseBody(criteria, { ...common, failureScope: { itemId: bujeon, inputValue: 0.2 } }),
    );

    expect(wholeCompany.status).toBe(200);
    expect(partial.status).toBe(200);
    expect(wholeCompany.body.businessScore).not.toBeCloseTo(partial.body.businessScore, 5);
    expect(wholeCompany.body.complexityScore).toBeCloseTo(partial.body.complexityScore, 5);
    expect(wholeCompany.body.customerScore).toBeCloseTo(partial.body.customerScore, 5);
  });
});

describe('US-7 / ID-no-unknown-for-systems', () => {
  it('서비스장애범위가 빠지면 계산이 진행되지 않고(400) 이력이 저장되지 않는다', async () => {
    const criteria = await fetchCriteria();
    const body = baseBody(criteria) as Partial<IncidentCalculationRequest>;
    delete body.failureScope;
    const before = recordCount();

    const { status } = await callCalculate(body);

    expect(status).toBe(400);
    expect(recordCount()).toBe(before);
  });

  it('장애복잡도가 빠지면 계산이 진행되지 않고(400) 이력이 저장되지 않는다', async () => {
    const criteria = await fetchCriteria();
    const body = baseBody(criteria) as Partial<IncidentCalculationRequest>;
    delete body.complexity;
    const before = recordCount();

    const { status } = await callCalculate(body);

    expect(status).toBe(400);
    expect(recordCount()).toBe(before);
  });

  it('접속장애여부가 빠지면 계산이 진행되지 않고(400) 이력이 저장되지 않는다', async () => {
    const criteria = await fetchCriteria();
    const body = baseBody(criteria) as Partial<IncidentCalculationRequest>;
    delete body.accessFailure;
    const before = recordCount();

    const { status } = await callCalculate(body);

    expect(status).toBe(400);
    expect(recordCount()).toBe(before);
  });

  it('응답속도가 빠지면 계산이 진행되지 않고(400) 이력이 저장되지 않는다', async () => {
    const criteria = await fetchCriteria();
    const body = baseBody(criteria) as Partial<IncidentCalculationRequest>;
    delete body.responseSpeed;
    const before = recordCount();

    const { status } = await callCalculate(body);

    expect(status).toBe(400);
    expect(recordCount()).toBe(before);
  });

  it('동일장애재발이 빠지면 계산이 진행되지 않고(400) 이력이 저장되지 않는다', async () => {
    const criteria = await fetchCriteria();
    const body = baseBody(criteria) as Partial<IncidentCalculationRequest>;
    delete body.recurrence;
    const before = recordCount();

    const { status } = await callCalculate(body);

    expect(status).toBe(400);
    expect(recordCount()).toBe(before);
  });
});

describe('US-11 / ID-no-unknown-for-systems', () => {
  it('영향받은 시스템을 0개 선택하면 계산이 진행되지 않는다(400, 미확인으로 대체되지 않음)', async () => {
    const criteria = await fetchCriteria();
    const body = baseBody(criteria, { selectedSystemItemIds: [] });
    const before = recordCount();

    const { status } = await callCalculate(body);

    expect(status).toBe(400);
    expect(recordCount()).toBe(before);
  });
});

describe('US-8/US-9', () => {
  it('단일선택 항목(장애복잡도)에서 미확인을 선택하면 두 값 중 더 큰 값(복잡장애 0.8)이 적용된다', async () => {
    const criteria = await fetchCriteria();
    const body = baseBody(criteria, { complexity: { isUnknown: true } });

    const { status, body: result } = await callCalculate(body);

    expect(status).toBe(200);
    expect(result.complexity.isUnknown).toBe(true);
    expect(result.complexity.choice).toBe('복잡장애');
    expect(result.complexity.value).toBeCloseTo(0.8, 5);
    expect(result.complexityScore).toBeCloseTo(0.2 * 0.8, 5);
  });
});

describe('ID-failure-scope-range', () => {
  it('일부 장애 입력값이 허용 범위(10~50%)를 벗어나면(60%) 거부된다(400)', async () => {
    const criteria = await fetchCriteria();
    const bujeon = findItemIdByName(criteria, 'failure_scope', '일부');
    const body = baseBody(criteria, { failureScope: { itemId: bujeon, inputValue: 0.6 } });

    const { status } = await callCalculate(body);

    expect(status).toBe(400);
  });
});

describe('ID-failure-scope-required-input', () => {
  it('일부를 선택했는데 입력값(inputValue)이 없으면 계산이 진행되지 않는다(400)', async () => {
    const criteria = await fetchCriteria();
    const bujeon = findItemIdByName(criteria, 'failure_scope', '일부');
    const body = baseBody(criteria, { failureScope: { itemId: bujeon } });

    const { status } = await callCalculate(body);

    expect(status).toBe(400);
  });
});

describe('총점 계산 공식 / US-14', () => {
  it('total = businessScore + complexityScore + customerScore이며, 각 소계가 개별 필드로 응답에 포함된다', async () => {
    const criteria = await fetchCriteria();
    const jeonsa = findItemIdByName(criteria, 'failure_scope', '전사');
    const complexItem = findItemIdByName(criteria, 'severity', '복잡장애');
    const accessYes = findItemIdByName(criteria, 'access_failure', '있음');
    const speedYes = findItemIdByName(criteria, 'response_speed', '있음(성능불만)');
    const recurrenceNo = findItemIdByName(criteria, 'recurrence', '없음');

    const body = baseBody(criteria, {
      failureScope: { itemId: jeonsa },
      complexity: { itemId: complexItem, isUnknown: false },
      accessFailure: { itemId: accessYes, isUnknown: false },
      responseSpeed: { itemId: speedYes, isUnknown: false },
      recurrence: { itemId: recurrenceNo, isUnknown: false },
    });

    const { status, body: result } = await callCalculate(body);

    const expectedBusiness = 0.5 * 0.8 * 1; // 0.4
    const expectedComplexity = 0.2 * 0.8; // 0.16
    const expectedCustomer = 0.3 * (0.3 * 0.8 + 0.2 * 0.8 + 0.5 * 0.2); // 0.3 * 0.5 = 0.15
    const expectedTotal = expectedBusiness + expectedComplexity + expectedCustomer; // 0.71

    expect(status).toBe(200);
    expect(result.businessScore).toBeCloseTo(expectedBusiness, 5);
    expect(result.complexityScore).toBeCloseTo(expectedComplexity, 5);
    expect(result.customerScore).toBeCloseTo(expectedCustomer, 5);
    expect(result.totalScore).toBeCloseTo(expectedTotal, 5);
    expect(result.totalScore).toBeCloseTo(result.businessScore + result.complexityScore + result.customerScore, 5);
  });
});

describe('등급 판정 기준', () => {
  it('총점이 0.5 이하면 등급외로 판정한다', async () => {
    const criteria = await fetchCriteria();
    const hr = findItemIdByName(criteria, 'target_systems', 'HR(인사)');
    const bujeon = findItemIdByName(criteria, 'failure_scope', '일부');
    const simple = findItemIdByName(criteria, 'severity', '단순장애');
    const accessNo = findItemIdByName(criteria, 'access_failure', '없음');
    const speedNo = findItemIdByName(criteria, 'response_speed', '없음');
    const recurrenceNo = findItemIdByName(criteria, 'recurrence', '없음');

    // business = 0.5 * 0.2 * 0.1 = 0.01, complexity = 0.2*0.2 = 0.04,
    // customer = 0.3*(0.3*0.2+0.2*0.2+0.5*0.2) = 0.3*0.2 = 0.06, total = 0.11
    const body = baseBody(criteria, {
      selectedSystemItemIds: [hr],
      failureScope: { itemId: bujeon, inputValue: 0.1 },
      complexity: { itemId: simple, isUnknown: false },
      accessFailure: { itemId: accessNo, isUnknown: false },
      responseSpeed: { itemId: speedNo, isUnknown: false },
      recurrence: { itemId: recurrenceNo, isUnknown: false },
    });

    const { status, body: result } = await callCalculate(body);

    expect(status).toBe(200);
    expect(result.totalScore).toBeCloseTo(0.11, 5);
    expect(result.grade).toBe('등급외');
  });

  it('총점이 0.5 초과 0.7 이하면 3등급으로 판정한다', async () => {
    const criteria = await fetchCriteria();
    const jeonsa = findItemIdByName(criteria, 'failure_scope', '전사');
    const simple = findItemIdByName(criteria, 'severity', '단순장애');
    const accessYes = findItemIdByName(criteria, 'access_failure', '있음');
    const speedNo = findItemIdByName(criteria, 'response_speed', '없음');
    const recurrenceNo = findItemIdByName(criteria, 'recurrence', '없음');

    // business = 0.5*0.8*1 = 0.4, complexity = 0.2*0.2 = 0.04,
    // customer = 0.3*(0.3*0.8+0.2*0.2+0.5*0.2) = 0.3*0.38 = 0.114, total = 0.554
    const body = baseBody(criteria, {
      failureScope: { itemId: jeonsa },
      complexity: { itemId: simple, isUnknown: false },
      accessFailure: { itemId: accessYes, isUnknown: false },
      responseSpeed: { itemId: speedNo, isUnknown: false },
      recurrence: { itemId: recurrenceNo, isUnknown: false },
    });

    const { status, body: result } = await callCalculate(body);

    expect(status).toBe(200);
    expect(result.totalScore).toBeCloseTo(0.554, 5);
    expect(result.grade).toBe('3등급');
  });

  it('총점이 0.7 초과 0.8 이하면 2등급으로 판정한다', async () => {
    const criteria = await fetchCriteria();
    const jeonsa = findItemIdByName(criteria, 'failure_scope', '전사');
    const complexItem = findItemIdByName(criteria, 'severity', '복잡장애');
    const accessYes = findItemIdByName(criteria, 'access_failure', '있음');
    const speedYes = findItemIdByName(criteria, 'response_speed', '있음(성능불만)');
    const recurrenceNo = findItemIdByName(criteria, 'recurrence', '없음');

    // business = 0.4, complexity = 0.2*0.8 = 0.16,
    // customer = 0.3*(0.3*0.8+0.2*0.8+0.5*0.2) = 0.3*0.5 = 0.15, total = 0.71
    const body = baseBody(criteria, {
      failureScope: { itemId: jeonsa },
      complexity: { itemId: complexItem, isUnknown: false },
      accessFailure: { itemId: accessYes, isUnknown: false },
      responseSpeed: { itemId: speedYes, isUnknown: false },
      recurrence: { itemId: recurrenceNo, isUnknown: false },
    });

    const { status, body: result } = await callCalculate(body);

    expect(status).toBe(200);
    expect(result.totalScore).toBeCloseTo(0.71, 5);
    expect(result.grade).toBe('2등급');
  });

  it('총점이 0.8 초과면 1등급으로 판정한다', async () => {
    const criteria = await fetchCriteria();
    const jeonsa = findItemIdByName(criteria, 'failure_scope', '전사');
    const complexItem = findItemIdByName(criteria, 'severity', '복잡장애');
    const accessYes = findItemIdByName(criteria, 'access_failure', '있음');
    const speedYes = findItemIdByName(criteria, 'response_speed', '있음(성능불만)');
    const recurrenceYes = findItemIdByName(criteria, 'recurrence', '있음');

    // business = 0.4, complexity = 0.16, customer = 0.3*(0.24+0.16+0.4) = 0.3*0.8 = 0.24, total = 0.8 (경계, 이 자체는 2등급)
    // 1등급을 만들기 위해 두 시스템(콘라이브 0.8 + SD(영업) 1.0)을 선택해 business를 0.9로 올린다.
    const conlive = findItemIdByName(criteria, 'target_systems', '콘라이브');
    const sd = findItemIdByName(criteria, 'target_systems', 'SD(영업)');

    const body = baseBody(criteria, {
      selectedSystemItemIds: [conlive, sd],
      failureScope: { itemId: jeonsa },
      complexity: { itemId: complexItem, isUnknown: false },
      accessFailure: { itemId: accessYes, isUnknown: false },
      responseSpeed: { itemId: speedYes, isUnknown: false },
      recurrence: { itemId: recurrenceYes, isUnknown: false },
    });

    const { status, body: result } = await callCalculate(body);

    // business = 0.5*(0.8+1.0)*1 = 0.9, complexity = 0.16, customer = 0.24, total = 1.3
    expect(status).toBe(200);
    expect(result.totalScore).toBeCloseTo(1.3, 5);
    expect(result.grade).toBe('1등급');
  });
});

describe('등급 판정 상한 없음', () => {
  it('여러 시스템을 선택해 총점이 1.0을 초과해도 에러 없이 1등급으로 처리된다', async () => {
    const criteria = await fetchCriteria();
    const jeonsa = findItemIdByName(criteria, 'failure_scope', '전사');
    const complexItem = findItemIdByName(criteria, 'severity', '복잡장애');
    const accessYes = findItemIdByName(criteria, 'access_failure', '있음');
    const speedYes = findItemIdByName(criteria, 'response_speed', '있음(성능불만)');
    const recurrenceYes = findItemIdByName(criteria, 'recurrence', '있음');
    const conlive = findItemIdByName(criteria, 'target_systems', '콘라이브');
    const sd = findItemIdByName(criteria, 'target_systems', 'SD(영업)');
    const bc = findItemIdByName(criteria, 'target_systems', 'BC(공통)');

    const body = baseBody(criteria, {
      selectedSystemItemIds: [conlive, sd, bc],
      failureScope: { itemId: jeonsa },
      complexity: { itemId: complexItem, isUnknown: false },
      accessFailure: { itemId: accessYes, isUnknown: false },
      responseSpeed: { itemId: speedYes, isUnknown: false },
      recurrence: { itemId: recurrenceYes, isUnknown: false },
    });

    const { status, body: result } = await callCalculate(body);

    // business = 0.5*(0.8+1.0+0.9)*1 = 1.35, 총점은 1.75로 1.0을 크게 초과한다.
    expect(status).toBe(200);
    expect(result.totalScore).toBeGreaterThan(1.0);
    expect(result.grade).toBe('1등급');
  });
});

describe('US-15 / ID-always-persist', () => {
  it('계산이 끝나면 결과가 incident_records에 자동 저장된다', async () => {
    const criteria = await fetchCriteria();
    const body = baseBody(criteria, { title: '저장 확인용 장애' });

    const { status, body: result } = await callCalculate(body);
    expect(status).toBe(200);

    const row = db.prepare('SELECT * FROM incident_records WHERE id = ?').get(result.id) as IncidentRecord;
    expect(row).toBeDefined();
    expect(row.title).toBe('저장 확인용 장애');
    expect(row.total_score).toBeCloseTo(result.totalScore, 5);
    expect(row.grade).toBe(result.grade);
  });

  it('동일한 유효 요청을 두 번 호출하면 매번 새 레코드가 하나씩 추가된다(미리보기 전용 경로 없음)', async () => {
    const criteria = await fetchCriteria();
    const body = baseBody(criteria);
    const before = recordCount();

    const first = await callCalculate(body);
    const second = await callCalculate(body);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body.id).not.toBe(second.body.id);
    expect(recordCount()).toBe(before + 2);
  });
});

describe('ID-fixed-choice-values', () => {
  it('장애복잡도 단순장애(값 0.2)를 선택하면 complexityScore = 0.2 × 0.2 = 0.04다', async () => {
    const criteria = await fetchCriteria();
    const simple = findItemIdByName(criteria, 'severity', '단순장애');
    const body = baseBody(criteria, { complexity: { itemId: simple, isUnknown: false } });

    const { status, body: result } = await callCalculate(body);

    expect(status).toBe(200);
    expect(result.complexity.choice).toBe('단순장애');
    expect(result.complexity.value).toBeCloseTo(0.2, 5);
    expect(result.complexityScore).toBeCloseTo(0.04, 5);
  });
});
