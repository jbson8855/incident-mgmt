import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import type Database from 'better-sqlite3';
import { setupTestDb, teardownTestDb } from './helpers/testDb';
import type { IncidentLog, IncidentLogListResponse } from '@/types';

// lib/db.ts의 seedIncidentLogs 시드 배열 전체 건수(엑셀 원본 행 수). 시드 소스에서 직접 센 값이다.
const TOTAL_SEED_ROWS = 104;

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

async function fetchList(query = ''): Promise<{ status: number; body: IncidentLogListResponse }> {
  const { GET } = await import('@/app/api/incident-logs/route');
  const { NextRequest } = await import('next/server');
  const req = new NextRequest(`http://localhost/api/incident-logs${query}`);
  const res = await GET(req);
  const body = (await res.json()) as IncidentLogListResponse;
  return { status: res.status, body };
}

async function fetchDetail(id: number): Promise<{ status: number; body: IncidentLog | { error: string } }> {
  const { GET } = await import('@/app/api/incident-logs/[id]/route');
  const { NextRequest } = await import('next/server');
  const req = new NextRequest(`http://localhost/api/incident-logs/${id}`);
  const res = await GET(req, { params: Promise.resolve({ id: String(id) }) });
  const body = await res.json();
  return { status: res.status, body };
}

describe('US-1', () => {
  it('목록 조회 시 이력이 배열로 반환되고 시드된 데이터가 있으므로 0건보다 많다', async () => {
    const { status, body } = await fetchList();

    expect(status).toBe(200);
    expect(Array.isArray(body.records)).toBe(true);
    expect(body.records.length).toBeGreaterThan(0);
  });
});

describe('US-3', () => {
  it('teamName=TECH팀으로 필터링하면 TECH팀 건만 반환되고 전체 건수보다 적다', async () => {
    const { status, body } = await fetchList('?teamName=TECH팀&pageSize=200');

    expect(status).toBe(200);
    expect(body.total).toBeGreaterThan(0);
    expect(body.total).toBeLessThan(TOTAL_SEED_ROWS);
    expect(body.records.length).toBe(body.total);
    for (const record of body.records) {
      expect(record.team_name).toBe('TECH팀');
    }
  });
});

describe('US-4', () => {
  it('companyName=유진기업으로 필터링하면 관계사가 정확히 유진기업인 건만 반환된다', async () => {
    const { status, body } = await fetchList('?companyName=유진기업&pageSize=200');

    expect(status).toBe(200);
    expect(body.total).toBeGreaterThan(0);
    expect(body.total).toBeLessThan(TOTAL_SEED_ROWS);
    for (const record of body.records) {
      expect(record.company_name).toBe('유진기업');
    }
  });

  it('관계사명 일부("유진")만 넣으면 부분 일치로 매칭되지 않아 0건이 반환된다', async () => {
    const { status, body } = await fetchList('?companyName=유진');

    expect(status).toBe(200);
    expect(body.total).toBe(0);
    expect(body.records.length).toBe(0);
  });
});

describe('US-5', () => {
  it('grade=2등급으로 필터링하면 2등급 건만 반환된다', async () => {
    const { status, body } = await fetchList('?grade=2등급&pageSize=200');

    expect(status).toBe(200);
    expect(body.total).toBeGreaterThan(0);
    expect(body.total).toBeLessThan(TOTAL_SEED_ROWS);
    for (const record of body.records) {
      expect(record.grade).toBe('2등급');
    }
  });
});

describe('US-6', () => {
  it('grade=등급내로 조회하면 1·2·3등급만 포함되고 등급외는 제외된다', async () => {
    const { status, body } = await fetchList('?grade=등급내&pageSize=200');

    expect(status).toBe(200);
    expect(body.total).toBeGreaterThan(0);
    expect(body.total).toBeLessThan(TOTAL_SEED_ROWS);
    for (const record of body.records) {
      expect(record.grade).not.toBe('등급외');
      expect(['1등급', '2등급', '3등급']).toContain(record.grade);
    }
  });
});

describe('US-7', () => {
  it('grade=등급외로 조회하면 등급외만 반환되고, 등급내와 등급외 건수의 합은 전체 건수와 같다', async () => {
    const { status, body } = await fetchList('?grade=등급외&pageSize=200');
    const { body: withinGrade } = await fetchList('?grade=등급내&pageSize=200');

    expect(status).toBe(200);
    expect(body.total).toBeGreaterThan(0);
    for (const record of body.records) {
      expect(record.grade).toBe('등급외');
    }
    expect(body.total + withinGrade.total).toBe(TOTAL_SEED_ROWS);
  });
});

describe('US-8', () => {
  it('발생일 기간(startDate~endDate)으로 필터링하면 해당 기간에 발생한 건만 반환된다', async () => {
    const { status, body } = await fetchList('?startDate=2023-02-06&endDate=2023-02-06');

    expect(status).toBe(200);
    expect(body.total).toBe(2);
    expect(body.records.length).toBe(2);
    for (const record of body.records) {
      expect(record.occurred_date).toBe('2023-02-06');
    }
    // 동일 발생일 내에서는 id 내림차순으로 정렬된다(ORDER BY occurred_date DESC, id DESC).
    expect(body.records[0].id).toBe(9);
    expect(body.records[0].company_name).toBe('유진자산운용');
    expect(body.records[1].id).toBe(8);
    expect(body.records[1].company_name).toBe('유진기업');
  });
});

describe('US-15', () => {
  it('상세 조회 시 발생요인·장애요인·이중화 구성 여부·업무서비스 중단 여부·중단규모·조치시간·장애보고서 여부를 포함한 모든 필드가 응답에 포함된다', async () => {
    const { status, body } = await fetchDetail(103);

    expect(status).toBe(200);
    const record = body as IncidentLog;
    expect(record.id).toBe(103);
    expect(record.occurred_date).toBe('2025-08-05');
    expect(record.team_name).toBe('TECH팀');
    expect(record.incident_type).toBe('네트워크');
    expect(record.company_name).toBe('유진기업');
    expect(record.description).toBe('유진기업(파크원) 정전으로 인한 방화벽 장애\n - 본사 업무서비스 장애 (사업장 무관)');
    expect(record.action_taken).toBe('방화벽 장비자체의 DB복구 완료 후 정상 작동 확인');
    expect(record.cause_source).toBe('내부');
    expect(record.cause_type).toBe('HW');
    expect(record.has_redundancy).toBe('O');
    expect(record.service_outage).toBe('O');
    expect(record.outage_scope).toBe('일부');
    expect(record.grade).toBe('등급외');
    expect(record.occurred_time).toBe('6:01');
    expect(record.resolved_time).toBe('8:53');
    expect(record.duration).toBe('2:52');
    expect(record.duration_category).toBe('4: 2~4시간');
    expect(record.has_report).toBe('0');
    expect(record.note).toBe('정전내용 고객사로부터 통지 받지 못함');
  });
});

describe('US-17 / OutOfScope', () => {
  it('목록 route에는 등록·수정·삭제(POST/PATCH/DELETE)가 export되어 있지 않다', async () => {
    const routeModule = await import('@/app/api/incident-logs/route');

    expect((routeModule as Record<string, unknown>).POST).toBeUndefined();
    expect((routeModule as Record<string, unknown>).PATCH).toBeUndefined();
    expect((routeModule as Record<string, unknown>).DELETE).toBeUndefined();
  });

  it('상세 route에도 등록·수정·삭제(POST/PATCH/DELETE)가 export되어 있지 않다', async () => {
    const routeModule = await import('@/app/api/incident-logs/[id]/route');

    expect((routeModule as Record<string, unknown>).POST).toBeUndefined();
    expect((routeModule as Record<string, unknown>).PATCH).toBeUndefined();
    expect((routeModule as Record<string, unknown>).DELETE).toBeUndefined();
  });
});

describe('US-18', () => {
  it('기본 조회는 page=1, pageSize=20 단위로 나뉘어 조회되고 hasMore가 true다', async () => {
    const { status, body } = await fetchList();

    expect(status).toBe(200);
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(20);
    expect(body.total).toBe(TOTAL_SEED_ROWS);
    expect(body.records.length).toBe(20);
    expect(body.hasMore).toBe(true);
  });

  it('마지막 페이지(page=6, pageSize=20)는 남은 4건만 반환되고 hasMore가 false다', async () => {
    const { status, body } = await fetchList('?page=6&pageSize=20');

    expect(status).toBe(200);
    expect(body.page).toBe(6);
    expect(body.pageSize).toBe(20);
    expect(body.total).toBe(TOTAL_SEED_ROWS);
    expect(body.records.length).toBe(4);
    expect(body.hasMore).toBe(false);
  });
});

describe('ID-date-normalized', () => {
  it('발생일(occurred_date)은 모두 YYYY-MM-DD 형식으로 정규화되어 있다', async () => {
    const { status, body } = await fetchList('?pageSize=200');

    expect(status).toBe(200);
    expect(body.records.length).toBe(TOTAL_SEED_ROWS);
    for (const record of body.records) {
      expect(record.occurred_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

describe('ID-raw-time-preserved', () => {
  it('발생시간/조치시간/소요시간은 비정형 원본 표기가 정정 없이 그대로 저장되어 있다', async () => {
    const { status, body } = await fetchDetail(47);

    expect(status).toBe(200);
    const record = body as IncidentLog;
    expect(record.occurred_date).toBe('2023-09-01');
    expect(record.occurred_time).toBe('09-01(금)');
    expect(record.resolved_time).toBe('09-05(월)');
    expect(record.duration).toBe('4일');
  });
});

describe('ID-seed-once', () => {
  it('같은 프로세스에서 목록 API를 다시 호출해도(재시드 없음) 총 건수가 변하지 않는다', async () => {
    const first = await fetchList();
    const second = await fetchList();

    expect(first.body.total).toBe(TOTAL_SEED_ROWS);
    expect(second.body.total).toBe(first.body.total);
  });
});

describe('ID-sort-desc', () => {
  it('정렬은 발생일(occurred_date) 내림차순이다', async () => {
    const { status, body } = await fetchList('?pageSize=200');

    expect(status).toBe(200);
    expect(body.records.length).toBe(TOTAL_SEED_ROWS);
    for (let i = 0; i < body.records.length - 1; i++) {
      expect(body.records[i].occurred_date >= body.records[i + 1].occurred_date).toBe(true);
    }
  });
});

describe('ID-404', () => {
  it('존재하지 않는 id를 상세 조회하면 404와 에러 메시지가 반환된다', async () => {
    const { status, body } = await fetchDetail(999999);

    expect(status).toBe(404);
    expect((body as { error: string }).error).toBe('이력을 찾을 수 없습니다.');
  });
});
