import { NextRequest, NextResponse } from 'next/server';
import { getDB } from '@/lib/db';
import { isAdminRequest } from '@/lib/auth';

function isValidScore(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: '관리자만 수정할 수 있습니다.' }, { status: 401 });
  }

  const { id } = await params;
  const thresholdId = Number(id);
  if (Number.isNaN(thresholdId)) {
    return NextResponse.json({ error: '잘못된 기준 ID입니다.' }, { status: 400 });
  }

  const body = await request.json();
  const db = getDB();
  const existing = db.prepare('SELECT * FROM grade_thresholds WHERE id = ?').get(thresholdId) as
    | { id: number; min_score: number; max_score: number | null }
    | undefined;
  if (!existing) {
    return NextResponse.json({ error: '기준을 찾을 수 없습니다.' }, { status: 404 });
  }

  const nextMinScore = body.minScore === undefined ? existing.min_score : body.minScore;
  const nextMaxScore = body.maxScore === undefined ? existing.max_score : body.maxScore;

  if (!isValidScore(nextMinScore)) {
    return NextResponse.json({ error: '최소값은 0 이상의 숫자여야 합니다.' }, { status: 400 });
  }
  if (nextMaxScore !== null && !isValidScore(nextMaxScore)) {
    return NextResponse.json({ error: '최대값은 0 이상의 숫자이거나 비어 있어야 합니다.' }, { status: 400 });
  }
  if (nextMaxScore !== null && nextMinScore > nextMaxScore) {
    return NextResponse.json({ error: '최소값은 최대값보다 클 수 없습니다.' }, { status: 400 });
  }

  db.prepare('UPDATE grade_thresholds SET min_score = ?, max_score = ? WHERE id = ?').run(
    nextMinScore,
    nextMaxScore,
    thresholdId,
  );

  const updated = db.prepare('SELECT * FROM grade_thresholds WHERE id = ?').get(thresholdId);
  return NextResponse.json(updated);
}
