import { NextRequest, NextResponse } from 'next/server';
import { getDB } from '@/lib/db';
import type { IncidentGrade, IncidentLog, IncidentLogListResponse } from '@/types';

const VALID_GRADES: IncidentGrade[] = ['1등급', '2등급', '3등급', '등급외'];
const DEFAULT_PAGE_SIZE = 20;

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;

  const teamName = searchParams.get('teamName');
  const companyName = searchParams.get('companyName');

  const gradeParam = searchParams.get('grade');
  const grade =
    gradeParam === '등급내' ? '등급내' : gradeParam && VALID_GRADES.includes(gradeParam as IncidentGrade) ? (gradeParam as IncidentGrade) : null;

  const startDate = searchParams.get('startDate');
  const endDate = searchParams.get('endDate');

  const pageParam = Number(searchParams.get('page'));
  const page = Number.isInteger(pageParam) && pageParam > 0 ? pageParam : 1;

  const pageSizeParam = Number(searchParams.get('pageSize'));
  const pageSize = Number.isInteger(pageSizeParam) && pageSizeParam > 0 ? pageSizeParam : DEFAULT_PAGE_SIZE;

  const conditions: string[] = [];
  const values: Record<string, unknown> = {};

  if (teamName) {
    conditions.push('team_name = @teamName');
    values.teamName = teamName;
  }
  if (companyName) {
    conditions.push('company_name = @companyName');
    values.companyName = companyName;
  }
  if (grade === '등급내') {
    conditions.push("grade != '등급외'");
  } else if (grade !== null) {
    conditions.push('grade = @grade');
    values.grade = grade;
  }
  if (startDate) {
    conditions.push('occurred_date >= @startDate');
    values.startDate = startDate;
  }
  if (endDate) {
    conditions.push('occurred_date <= @endDate');
    values.endDate = endDate;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const db = getDB();

  const { total } = db
    .prepare(`SELECT COUNT(*) AS total FROM incident_logs ${whereClause}`)
    .get(values) as { total: number };

  const records = db
    .prepare(
      `SELECT * FROM incident_logs ${whereClause}
       ORDER BY occurred_date DESC, id DESC
       LIMIT @limit OFFSET @offset`,
    )
    .all({ ...values, limit: pageSize, offset: (page - 1) * pageSize }) as IncidentLog[];

  const response: IncidentLogListResponse = {
    records,
    total,
    page,
    pageSize,
    hasMore: page * pageSize < total,
  };

  return NextResponse.json(response);
}
