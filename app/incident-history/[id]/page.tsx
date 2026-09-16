'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { GradeBadge } from '@/components/ui/GradeBadge';
import type { IncidentCalculationResult, IncidentSingleChoiceResult } from '@/types';

export default function IncidentHistoryDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();

  const [record, setRecord] = useState<IncidentCalculationResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/incident-records/${params.id}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setError(body.error ?? '이력을 불러오지 못했습니다.');
          return;
        }
        const data: IncidentCalculationResult = await res.json();
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
        <Button variant="secondary" onClick={() => router.push('/incident-history')}>
          목록으로
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      <button
        onClick={() => router.push('/incident-history')}
        className="flex items-center gap-1.5 text-sm text-[#555] hover:text-[#0a0a0a] mb-4"
      >
        <ArrowLeft size={14} />
        목록으로
      </button>

      <h1 className="text-xl font-semibold text-[#0a0a0a] mb-6">{record.title || '장애 이력 상세'}</h1>

      <Card className="mb-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-sm text-[#999] mb-1">{record.companyName}</div>
            <div className="text-xs text-[#999]">산정 시각 {record.calculatedAt}</div>
          </div>
          <GradeBadge grade={record.grade} size="md" />
        </div>
        <div className="text-3xl font-semibold text-[#0a0a0a]">{record.totalScore.toFixed(3)}점</div>
      </Card>

      <Card title="대분류별 소계" className="mb-4">
        <div className="grid grid-cols-3 gap-4 text-sm">
          <div>
            <div className="text-[#999] mb-1">비즈니스영향도</div>
            <div className="font-medium text-[#0a0a0a]">{record.businessScore.toFixed(3)}</div>
          </div>
          <div>
            <div className="text-[#999] mb-1">장애복잡도</div>
            <div className="font-medium text-[#0a0a0a]">{record.complexityScore.toFixed(3)}</div>
          </div>
          <div>
            <div className="text-[#999] mb-1">고객서비스영향도</div>
            <div className="font-medium text-[#0a0a0a]">{record.customerScore.toFixed(3)}</div>
          </div>
        </div>
      </Card>

      <Card title="영향받은 시스템" className="mb-4">
        {record.systems.length === 0 ? (
          <div className="text-sm text-[#999]">선택된 시스템이 없습니다.</div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {record.systems.map((system) => (
              <span
                key={system.name}
                className="inline-flex items-center gap-1.5 text-xs bg-gray-100 text-[#333] rounded-md px-2 py-1"
              >
                {system.groupName && <span className="text-[#999]">{system.groupName} ·</span>}
                {system.name}
                <span className="text-[#999]">({system.value})</span>
              </span>
            ))}
          </div>
        )}
      </Card>

      <Card title="선택 항목" className="mb-6">
        <div className="space-y-2 text-sm">
          <div className="flex items-center">
            <span className="text-[#999] mr-2 w-24 shrink-0">서비스 장애 범위 가중치</span>
            <span className="text-[#333]">{record.failureScope.choice}</span>
            <span className="text-[#999] ml-1.5">({Math.round(record.failureScope.value * 1000) / 10}%)</span>
          </div>
          <ChoiceRow label="장애복잡도" choice={record.complexity} />
          <ChoiceRow label="접속장애여부" choice={record.accessFailure} />
          <ChoiceRow label="응답속도" choice={record.responseSpeed} />
          <ChoiceRow label="동일장애재발" choice={record.recurrence} />
        </div>
      </Card>
    </div>
  );
}

function ChoiceRow({ label, choice }: { label: string; choice: IncidentSingleChoiceResult }) {
  return (
    <div className="flex items-center">
      <span className="text-[#999] mr-2 w-24 shrink-0">{label}</span>
      <span className="text-[#333]">{choice.choice}</span>
      <span className="text-[#999] ml-1.5">({choice.value})</span>
      {choice.isUnknown && (
        <Badge color="gray" className="ml-2">
          미확인
        </Badge>
      )}
    </div>
  );
}
