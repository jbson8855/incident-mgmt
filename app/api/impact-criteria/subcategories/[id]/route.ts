import { NextRequest, NextResponse } from 'next/server';
import { getDB } from '@/lib/db';
import { isValidRatio } from '@/lib/validation';

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const subcategoryId = Number(id);
  if (Number.isNaN(subcategoryId)) {
    return NextResponse.json({ error: '잘못된 중분류 ID입니다.' }, { status: 400 });
  }

  const body = await request.json();
  if (!isValidRatio(body.weight)) {
    return NextResponse.json({ error: '가중치는 0~1 사이의 숫자여야 합니다.' }, { status: 400 });
  }

  const db = getDB();
  const existing = db.prepare('SELECT id FROM impact_subcategories WHERE id = ?').get(subcategoryId);
  if (!existing) {
    return NextResponse.json({ error: '중분류를 찾을 수 없습니다.' }, { status: 404 });
  }

  db.prepare('UPDATE impact_subcategories SET weight = ? WHERE id = ?').run(body.weight, subcategoryId);

  const updated = db.prepare('SELECT * FROM impact_subcategories WHERE id = ?').get(subcategoryId);
  return NextResponse.json(updated);
}
