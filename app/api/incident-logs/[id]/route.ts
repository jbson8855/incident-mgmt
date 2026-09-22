import { NextRequest, NextResponse } from 'next/server';
import { getIncidentLog } from '@/lib/incident-logs';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const recordId = Number(id);
  if (Number.isNaN(recordId)) {
    return NextResponse.json({ error: '잘못된 이력 ID입니다.' }, { status: 400 });
  }

  const row = getIncidentLog(recordId);
  if (!row) {
    return NextResponse.json({ error: '이력을 찾을 수 없습니다.' }, { status: 404 });
  }

  return NextResponse.json(row);
}
