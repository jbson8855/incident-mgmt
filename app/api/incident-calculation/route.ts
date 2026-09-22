import { NextRequest, NextResponse } from 'next/server';
import { calculateIncident } from '@/lib/incident-calculation';
import type { IncidentCalculationRequest } from '@/types';

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as IncidentCalculationRequest | null;

  const outcome = calculateIncident(body);
  if (!outcome.ok) {
    return NextResponse.json({ error: outcome.error }, { status: outcome.status });
  }

  return NextResponse.json(outcome.result);
}
