import { NextRequest, NextResponse } from 'next/server';
import { getDB } from '@/lib/db';
import type { IncidentCalculationResult, IncidentRecord, IncidentSystemSnapshot } from '@/types';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const recordId = Number(id);
  if (Number.isNaN(recordId)) {
    return NextResponse.json({ error: '잘못된 이력 ID입니다.' }, { status: 400 });
  }

  const db = getDB();
  const row = db.prepare('SELECT * FROM incident_records WHERE id = ?').get(recordId) as IncidentRecord | undefined;
  if (!row) {
    return NextResponse.json({ error: '이력을 찾을 수 없습니다.' }, { status: 404 });
  }

  const systems = JSON.parse(row.systems_json) as IncidentSystemSnapshot[];

  const response: IncidentCalculationResult = {
    id: row.id,
    companyName: row.company_name,
    calculatedAt: row.calculated_at,
    title: row.title,
    systems,
    failureScope: { choice: row.failure_scope_choice, value: row.failure_scope_value },
    businessScore: row.business_score,
    complexity: {
      choice: row.complexity_choice,
      isUnknown: Boolean(row.complexity_is_unknown),
      value: row.complexity_value,
    },
    complexityScore: row.complexity_score,
    accessFailure: {
      choice: row.access_failure_choice,
      isUnknown: Boolean(row.access_failure_is_unknown),
      value: row.access_failure_value,
    },
    responseSpeed: {
      choice: row.response_speed_choice,
      isUnknown: Boolean(row.response_speed_is_unknown),
      value: row.response_speed_value,
    },
    recurrence: {
      choice: row.recurrence_choice,
      isUnknown: Boolean(row.recurrence_is_unknown),
      value: row.recurrence_value,
    },
    customerScore: row.customer_score,
    totalScore: row.total_score,
    grade: row.grade,
  };

  return NextResponse.json(response);
}
