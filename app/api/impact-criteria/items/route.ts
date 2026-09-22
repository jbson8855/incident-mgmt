import { NextRequest, NextResponse } from 'next/server';
import { getDB } from '@/lib/db';
import { isAdminRequest } from '@/lib/auth';
import { isValidName, isValidRatio } from '@/lib/validation';
import type { SelectionType } from '@/types';

export async function POST(request: NextRequest) {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: '관리자만 수정할 수 있습니다.' }, { status: 401 });
  }

  const body = await request.json();
  const { subcategoryId, name, value, groupName, companyId } = body;

  if (typeof subcategoryId !== 'number' || Number.isNaN(subcategoryId)) {
    return NextResponse.json({ error: '중분류 ID가 필요합니다.' }, { status: 400 });
  }
  if (!isValidName(name)) {
    return NextResponse.json({ error: '항목 이름을 입력해주세요.' }, { status: 400 });
  }
  if (!isValidRatio(value)) {
    return NextResponse.json({ error: '값은 0~1 사이의 숫자여야 합니다.' }, { status: 400 });
  }

  const db = getDB();
  const subcategory = db
    .prepare('SELECT id, code, selection_type FROM impact_subcategories WHERE id = ?')
    .get(subcategoryId) as { id: number; code: string; selection_type: SelectionType } | undefined;
  if (!subcategory) {
    return NextResponse.json({ error: '중분류를 찾을 수 없습니다.' }, { status: 404 });
  }
  // 예/아니오 고정 이진 항목(단일 선택 중분류)은 "미확인 = 두 값 중 큰 값" 계산 로직이
  // 정확히 두 항목을 전제하므로, 항목 추가는 다중 선택(비즈니스영향도 시스템 목록)만 허용한다.
  if (subcategory.selection_type !== 'multiple') {
    return NextResponse.json({ error: '이 항목 그룹에는 항목을 추가할 수 없습니다.' }, { status: 400 });
  }
  // "대상(업무서비스)"(target_systems)는 계열사 전용 항목이라 어느 계열사 것인지 반드시 지정해야 한다.
  const isTargetSystems = subcategory.code === 'target_systems';
  if (isTargetSystems && (typeof companyId !== 'number' || Number.isNaN(companyId))) {
    return NextResponse.json({ error: 'companyId가 필요합니다.' }, { status: 400 });
  }

  const { maxOrder } = db
    .prepare('SELECT COALESCE(MAX(display_order), 0) as maxOrder FROM impact_items WHERE subcategory_id = ?')
    .get(subcategoryId) as { maxOrder: number };

  const result = db
    .prepare(
      `INSERT INTO impact_items (subcategory_id, company_id, name, value, group_name, display_order, is_active)
       VALUES (?, ?, ?, ?, ?, ?, 1)`,
    )
    .run(
      subcategoryId,
      isTargetSystems ? companyId : null,
      name.trim(),
      value,
      typeof groupName === 'string' && groupName.trim() ? groupName.trim() : null,
      maxOrder + 1,
    );

  const created = db.prepare('SELECT * FROM impact_items WHERE id = ?').get(result.lastInsertRowid);
  return NextResponse.json(created, { status: 201 });
}
