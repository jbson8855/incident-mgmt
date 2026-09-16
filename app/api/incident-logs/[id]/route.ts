import { NextRequest, NextResponse } from 'next/server';
import { getDB } from '@/lib/db';
import type { IncidentLog } from '@/types';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const recordId = Number(id);
  if (Number.isNaN(recordId)) {
    return NextResponse.json({ error: '잘못된 이력 ID입니다.' }, { status: 400 });
  }

  const db = getDB();
  const row = db.prepare('SELECT * FROM incident_logs WHERE id = ?').get(recordId) as IncidentLog | undefined;
  if (!row) {
    return NextResponse.json({ error: '이력을 찾을 수 없습니다.' }, { status: 404 });
  }

  return NextResponse.json(row);
}
