'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { GradeBadge } from '@/components/ui/GradeBadge';
import type { IncidentLog } from '@/types';

export default function IncidentLogDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();

  const [record, setRecord] = useState<IncidentLog | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const goToList = useCallback(() => router.push('/incident-logs'), [router]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') goToList();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [goToList]);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/incident-logs/${params.id}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setError(body.error ?? '이력을 불러오지 못했습니다.');
          return;
        }
        const data: IncidentLog = await res.json();
        setRecord(data);
      })
      .finally(() => setLoading(false));
  }, [params.id]);

  if (loading) {
    return <div className="text-sm text-[#999]">불러오는 중...</div>;
  }

  if (error || !record) {
    return (
      <div className="max-w-2xl">
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2 mb-4">
          {error ?? '이력을 찾을 수 없습니다.'}
        </div>
        <Button variant="secondary" onClick={goToList}>
          목록으로
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      <button
        onClick={goToList}
        className="flex items-center gap-1.5 text-sm text-[#555] hover:text-[#0a0a0a] mb-4"
      >
        <ArrowLeft size={14} />
        목록으로
      </button>

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-[#0a0a0a]">{record.incident_type}</h1>
        <GradeBadge grade={record.grade} size="md" />
      </div>

      <Card title="요약" className="mb-4">
        <div className="grid grid-cols-2 gap-y-3 gap-x-4 text-sm sm:grid-cols-4">
          <SummaryField label="발생일" value={record.occurred_date} />
          <SummaryField label="팀명" value={record.team_name} />
          <SummaryField label="장애유형" value={record.incident_type} />
          <SummaryField label="관계사" value={record.company_name} />
          <SummaryField label="발생시간" value={record.occurred_time || '-'} />
          <SummaryField label="소요시간" value={record.duration || '-'} />
          <SummaryField label="소요시간 구분" value={record.duration_category || '-'} />
        </div>
      </Card>

      <Card title="장애 내용" className="mb-4">
        <p className="text-sm text-[#333] whitespace-pre-wrap">{record.description || '-'}</p>
      </Card>

      <Card title="조치 사항" className="mb-4">
        <p className="text-sm text-[#333] whitespace-pre-wrap">{record.action_taken || '-'}</p>
      </Card>

      <Card title="비고" className="mb-4">
        <p className="text-sm text-[#333] whitespace-pre-wrap">{record.note || '-'}</p>
      </Card>

      <Card title="세부 정보" className="mb-6">
        <div className="grid grid-cols-2 gap-y-3 gap-x-4 text-sm sm:grid-cols-3">
          <SummaryField label="발생요인" value={record.cause_source || '-'} />
          <SummaryField label="장애요인" value={record.cause_type || '-'} />
          <SummaryField label="이중화 구성 여부" value={record.has_redundancy || '-'} />
          <SummaryField label="업무서비스 중단 여부" value={record.service_outage || '-'} />
          <SummaryField label="중단규모" value={record.outage_scope || '-'} />
          <SummaryField label="조치시간" value={record.resolved_time || '-'} />
          <SummaryField label="장애보고서" value={record.has_report || '-'} />
        </div>
      </Card>
    </div>
  );
}

function SummaryField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[#999] mb-1">{label}</div>
      <div className="font-medium text-[#0a0a0a] whitespace-pre-wrap">{value}</div>
    </div>
  );
}
