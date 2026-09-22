import { NextRequest, NextResponse } from 'next/server';
import { getDB } from '@/lib/db';
import { isAdminRequest } from '@/lib/auth';
import { isValidName, isValidRatio } from '@/lib/validation';
import type { SelectionType } from '@/types';

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: '관리자만 수정할 수 있습니다.' }, { status: 401 });
  }

  const { id } = await params;
  const itemId = Number(id);
  if (Number.isNaN(itemId)) {
    return NextResponse.json({ error: '잘못된 항목 ID입니다.' }, { status: 400 });
  }

  const body = await request.json();
  const db = getDB();
  const existing = db.prepare('SELECT * FROM impact_items WHERE id = ?').get(itemId) as
    | { id: number; name: string; value: number; min_value: number | null; max_value: number | null }
    | undefined;
  if (!existing) {
    return NextResponse.json({ error: '항목을 찾을 수 없습니다.' }, { status: 404 });
  }

  const nextName = body.name === undefined ? existing.name : body.name;
  const nextValue = body.value === undefined ? existing.value : body.value;
  const nextMinValue = body.minValue === undefined ? existing.min_value : body.minValue;
  const nextMaxValue = body.maxValue === undefined ? existing.max_value : body.maxValue;

  if (!isValidName(nextName)) {
    return NextResponse.json({ error: '항목 이름을 입력해주세요.' }, { status: 400 });
  }
  if (!isValidRatio(nextValue)) {
    return NextResponse.json({ error: '값은 0~1 사이의 숫자여야 합니다.' }, { status: 400 });
  }
  if (nextMinValue !== null && !isValidRatio(nextMinValue)) {
    return NextResponse.json({ error: '최소값은 0~1 사이의 숫자여야 합니다.' }, { status: 400 });
  }
  if (nextMaxValue !== null && !isValidRatio(nextMaxValue)) {
    return NextResponse.json({ error: '최대값은 0~1 사이의 숫자여야 합니다.' }, { status: 400 });
  }
  if (nextMinValue !== null && nextMaxValue !== null && nextMinValue > nextMaxValue) {
    return NextResponse.json({ error: '최소값은 최대값보다 클 수 없습니다.' }, { status: 400 });
  }

  db.prepare('UPDATE impact_items SET name = ?, value = ?, min_value = ?, max_value = ? WHERE id = ?').run(
    (nextName as string).trim(),
    nextValue,
    nextMinValue,
    nextMaxValue,
    itemId,
  );

  const updated = db.prepare('SELECT * FROM impact_items WHERE id = ?').get(itemId);
  return NextResponse.json(updated);
}

// 기본 동작은 비활성화(soft, is_active=0) — 과거 산정 이력과의 정합성을 위해 행 자체는 남겨둔다.
// ?permanent=true를 주면 행을 완전히 삭제한다 — 잘못 추가한 항목("test" 등)을 되돌릴 때 사용.
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: '관리자만 수정할 수 있습니다.' }, { status: 401 });
  }

  const { id } = await params;
  const itemId = Number(id);
  if (Number.isNaN(itemId)) {
    return NextResponse.json({ error: '잘못된 항목 ID입니다.' }, { status: 400 });
  }
  const permanent = request.nextUrl.searchParams.get('permanent') === 'true';

  const db = getDB();
  const existing = db
    .prepare(
      `SELECT i.id, s.selection_type FROM impact_items i
       JOIN impact_subcategories s ON s.id = i.subcategory_id
       WHERE i.id = ?`,
    )
    .get(itemId) as { id: number; selection_type: SelectionType } | undefined;
  if (!existing) {
    return NextResponse.json({ error: '항목을 찾을 수 없습니다.' }, { status: 404 });
  }
  // 예/아니오 고정 이진 항목(단일 선택 중분류)은 두 값이 항상 존재해야 계산 로직이 성립하므로 삭제/비활성화를 막는다.
  if (existing.selection_type !== 'multiple') {
    return NextResponse.json({ error: '이 항목은 삭제할 수 없습니다.' }, { status: 400 });
  }

  if (permanent) {
    db.prepare('DELETE FROM impact_items WHERE id = ?').run(itemId);
  } else {
    db.prepare('UPDATE impact_items SET is_active = 0 WHERE id = ?').run(itemId);
  }

  return NextResponse.json({ success: true });
}
