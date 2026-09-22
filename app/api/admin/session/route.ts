import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/auth';

export async function GET(request: NextRequest) {
  return NextResponse.json({ isAdmin: isAdminRequest(request) });
}
