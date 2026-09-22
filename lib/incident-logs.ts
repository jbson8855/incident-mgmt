import { getDB } from '@/lib/db';
import type { IncidentGrade, IncidentLog, IncidentLogListParams, IncidentLogListResponse } from '@/types';

export const VALID_INCIDENT_GRADES: IncidentGrade[] = ['1등급', '2등급', '3등급', '등급외'];
const DEFAULT_PAGE_SIZE = 20;

export function listIncidentLogs(params: IncidentLogListParams): IncidentLogListResponse {
  const { teamName, companyName, grade, startDate, endDate } = params;
  const page = params.page && Number.isInteger(params.page) && params.page > 0 ? params.page : 1;
  const pageSize =
    params.pageSize && Number.isInteger(params.pageSize) && params.pageSize > 0 ? params.pageSize : DEFAULT_PAGE_SIZE;

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
  } else if (grade) {
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

  return {
    records,
    total,
    page,
    pageSize,
    hasMore: page * pageSize < total,
  };
}

export function getIncidentLog(id: number): IncidentLog | undefined {
  const db = getDB();
  return db.prepare('SELECT * FROM incident_logs WHERE id = ?').get(id) as IncidentLog | undefined;
}
