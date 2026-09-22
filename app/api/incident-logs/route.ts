import { NextRequest, NextResponse } from 'next/server';
import { listIncidentLogs, VALID_INCIDENT_GRADES } from '@/lib/incident-logs';
import type { IncidentGrade } from '@/types';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;

  const teamName = searchParams.get('teamName') ?? undefined;
  const companyName = searchParams.get('companyName') ?? undefined;

  const gradeParam = searchParams.get('grade');
  const grade =
    gradeParam === '등급내'
      ? '등급내'
      : gradeParam && VALID_INCIDENT_GRADES.includes(gradeParam as IncidentGrade)
        ? (gradeParam as IncidentGrade)
        : undefined;

  const startDate = searchParams.get('startDate') ?? undefined;
  const endDate = searchParams.get('endDate') ?? undefined;

  const pageParam = Number(searchParams.get('page'));
  const page = Number.isInteger(pageParam) && pageParam > 0 ? pageParam : undefined;

  const pageSizeParam = Number(searchParams.get('pageSize'));
  const pageSize = Number.isInteger(pageSizeParam) && pageSizeParam > 0 ? pageSizeParam : undefined;

  const response = listIncidentLogs({ teamName, companyName, grade, startDate, endDate, page, pageSize });

  return NextResponse.json(response);
}
