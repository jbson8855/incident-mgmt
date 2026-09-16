import { NextRequest, NextResponse } from 'next/server';
import { getDB } from '@/lib/db';
import type { IncidentGrade, IncidentRecord, IncidentRecordListResponse } from '@/types';

const VALID_GRADES: IncidentGrade[] = ['1등급', '2등급', '3등급', '등급외'];
const DEFAULT_PAGE_SIZE = 20;

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;

  const companyIdParam = searchParams.get('companyId');
  const companyId = companyIdParam !== null && !Number.isNaN(Number(companyIdParam)) ? Number(companyIdParam) : null;

  const gradeParam = searchParams.get('grade');
  const grade = gradeParam && VALID_GRADES.includes(gradeParam as IncidentGrade) ? (gradeParam as IncidentGrade) : null;

  const startDate = searchParams.get('startDate');
  const endDate = searchParams.get('endDate');

  const pageParam = Number(searchParams.get('page'));
  const page = Number.isInteger(pageParam) && pageParam > 0 ? pageParam : 1;

  const pageSizeParam = Number(searchParams.get('pageSize'));
  const pageSize = Number.isInteger(pageSizeParam) && pageSizeParam > 0 ? pageSizeParam : DEFAULT_PAGE_SIZE;

  const conditions: string[] = [];
  const values: Record<string, unknown> = {};

  if (companyId !== null) {
    conditions.push('company_id = @companyId');
    values.companyId = companyId;
  }
  if (grade !== null) {
    conditions.push('grade = @grade');
    values.grade = grade;
  }
  if (startDate) {
    conditions.push('date(calculated_at) >= date(@startDate)');
    values.startDate = startDate;
  }
  if (endDate) {
    conditions.push('date(calculated_at) <= date(@endDate)');
    values.endDate = endDate;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const db = getDB();

  const { total } = db
    .prepare(`SELECT COUNT(*) AS total FROM incident_records ${whereClause}`)
    .get(values) as { total: number };

  const records = db
    .prepare(
      `SELECT * FROM incident_records ${whereClause}
       ORDER BY calculated_at DESC, id DESC
       LIMIT @limit OFFSET @offset`,
    )
    .all({ ...values, limit: pageSize, offset: (page - 1) * pageSize }) as IncidentRecord[];

  const response: IncidentRecordListResponse = {
    records,
    total,
    page,
    pageSize,
    hasMore: page * pageSize < total,
  };

  return NextResponse.json(response);
}
