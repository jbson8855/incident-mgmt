'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Calculator, Gauge, Send, SlidersHorizontal } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { GradeBadge } from '@/components/ui/GradeBadge';
import type { IncidentRecord, IncidentRecordListResponse } from '@/types';

const SHORTCUTS = [
  {
    href: '/impact-criteria',
    label: '장애기준표 관리',
    description: '계열사별 가중치·항목 조회 및 수정',
    Icon: SlidersHorizontal,
  },
  {
    href: '/grade-thresholds',
    label: '장애등급 판정기준',
    description: '총점 구간별 등급 기준 조회 및 수정',
    Icon: Gauge,
  },
  {
    href: '/report-guide',
    label: '장애발생시 보고 현황',
    description: '등급별 보고 대상·시점·방식 확인',
    Icon: Send,
  },
];

export default function HomePage() {
  const router = useRouter();
  const [records, setRecords] = useState<IncidentRecord[] | null>(null);

  useEffect(() => {
    fetch('/api/incident-records?page=1&pageSize=5')
      .then((res) => res.json())
      .then((data: IncidentRecordListResponse) => setRecords(data.records));
  }, []);

  return (
    <div className="max-w-4xl">
      <h1 className="text-xl font-semibold text-[#0a0a0a] mb-1">장애등급 산정</h1>
      <p className="text-sm text-[#555] mb-8">
        장애가 발생하면 계열사와 항목을 선택해 최초 장애등급을 즉시 산정합니다.
      </p>

      <button
        onClick={() => router.push('/incident-calculation')}
        className="w-full flex items-center gap-4 rounded-lg border border-[#0a0a0a] bg-[#0a0a0a] hover:bg-[#1a1a1a] text-white px-6 py-5 mb-8 transition-colors text-left"
      >
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-white/10">
          <Calculator size={20} />
        </div>
        <div className="flex-1">
          <div className="text-base font-semibold">새 장애등급 계산 시작</div>
          <div className="text-sm text-white/60 mt-0.5">계열사와 장애 항목을 선택하면 등급이 자동 산정됩니다</div>
        </div>
        <ArrowRight size={18} className="text-white/60 shrink-0" />
      </button>

      <div className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-[#0a0a0a]">최근 산정 이력</h2>
          <a href="/incident-history" className="text-xs text-[#999] hover:text-[#555]">
            전체 이력 보기 →
          </a>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
          {records === null ? (
            <div className="text-sm text-[#999] py-6 text-center">불러오는 중...</div>
          ) : records.length === 0 ? (
            <div className="text-sm text-[#999] py-6 text-center">아직 산정된 이력이 없습니다.</div>
          ) : (
            records.map((record, i) => (
              <div
                key={record.id}
                onClick={() => router.push(`/incident-history/${record.id}`)}
                className={`flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50 ${
                  i > 0 ? 'border-t border-[#f0f0f0]' : ''
                }`}
              >
                <GradeBadge grade={record.grade} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-[#333] truncate">{record.title || '(제목 없음)'}</div>
                  <div className="text-xs text-[#999]">{record.company_name}</div>
                </div>
                <div className="text-xs text-[#999] shrink-0">{record.calculated_at}</div>
              </div>
            ))
          )}
        </div>
      </div>

      <div>
        <h2 className="text-sm font-semibold text-[#0a0a0a] mb-3">바로가기</h2>
        <div className="grid grid-cols-3 gap-3">
          {SHORTCUTS.map(({ href, label, description, Icon }) => (
            <Card key={href} onClick={() => router.push(href)}>
              <Icon size={16} className="text-[#999] mb-2" />
              <div className="text-sm font-medium text-[#0a0a0a] mb-0.5">{label}</div>
              <div className="text-xs text-[#999]">{description}</div>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
