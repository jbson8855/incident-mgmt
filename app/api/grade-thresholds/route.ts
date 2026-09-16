import { NextResponse } from 'next/server';
import { getDB } from '@/lib/db';
import type { GradeThreshold } from '@/types';

// 장애등급 판정 기준은 모든 계열사에 공통으로 적용되므로 계열사 구분 없이 전체를 반환한다.
export async function GET() {
  const db = getDB();
  const thresholds = db
    .prepare('SELECT * FROM grade_thresholds ORDER BY display_order ASC, id ASC')
    .all() as GradeThreshold[];

  return NextResponse.json(thresholds);
}
