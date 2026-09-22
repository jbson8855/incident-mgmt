import { NextRequest, NextResponse } from 'next/server';
import { getDB } from '@/lib/db';
import { isAdminRequest } from '@/lib/auth';
import { isValidName } from '@/lib/validation';
import type { Company } from '@/types';

export async function GET() {
  const db = getDB();
  const companies = db
    .prepare('SELECT id, name, created_at FROM companies ORDER BY id ASC')
    .all() as Company[];

  return NextResponse.json(companies);
}

// 새 계열사는 이름만 등록하면 된다. 기준표(대분류/중분류, 장애복잡도/고객서비스영향도, 서비스 장애 범위 가중치)는
// 모든 계열사 공통이라 이미 존재하는 것을 그대로 쓰고, "대상(업무서비스)" 시스템 목록만 빈 상태로 시작해
// 기준표 관리 화면에서 새로 입력하면 된다.
export async function POST(request: NextRequest) {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: '관리자만 수정할 수 있습니다.' }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const name = body?.name;
  if (!isValidName(name)) {
    return NextResponse.json({ error: '계열사명을 입력해주세요.' }, { status: 400 });
  }

  const db = getDB();
  const trimmedName = (name as string).trim();
  const existing = db.prepare('SELECT id FROM companies WHERE name = ?').get(trimmedName);
  if (existing) {
    return NextResponse.json({ error: '이미 존재하는 계열사명입니다.' }, { status: 409 });
  }

  const result = db.prepare('INSERT INTO companies (name) VALUES (?)').run(trimmedName);
  const created = db.prepare('SELECT id, name, created_at FROM companies WHERE id = ?').get(result.lastInsertRowid) as Company;
  return NextResponse.json(created, { status: 201 });
}
