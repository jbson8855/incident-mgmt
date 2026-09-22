'use client';

import { useEffect, useState } from 'react';
import { AdminSessionBar, useAdminSession } from '@/components/AdminSessionBar';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import type { GradeThreshold } from '@/types';

function validateDraft(thresholds: GradeThreshold[]): string[] {
  const errors: string[] = [];
  for (const threshold of thresholds) {
    if (threshold.min_score < 0) {
      errors.push(`'${threshold.grade}' 최소값은 0 이상이어야 합니다.`);
    }
    if (threshold.max_score !== null && threshold.min_score > threshold.max_score) {
      errors.push(`'${threshold.grade}' 최소값은 최대값보다 클 수 없습니다.`);
    }
  }
  return errors;
}

export default function GradeThresholdsPage() {
  const { isAdmin, refresh: refreshAdmin } = useAdminSession();
  const [thresholds, setThresholds] = useState<GradeThreshold[]>([]);
  const [original, setOriginal] = useState<GradeThreshold[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/grade-thresholds')
      .then((res) => res.json())
      .then((data: GradeThreshold[]) => {
        setThresholds(data);
        setOriginal(data);
      })
      .finally(() => setLoading(false));
  }, []);

  function updateMin(thresholdId: number, minScore: number) {
    setThresholds((prev) => prev.map((t) => (t.id === thresholdId ? { ...t, min_score: minScore } : t)));
  }

  function updateMax(thresholdId: number, maxScore: number | null) {
    setThresholds((prev) => prev.map((t) => (t.id === thresholdId ? { ...t, max_score: maxScore } : t)));
  }

  async function handleSave() {
    const validationErrors = validateDraft(thresholds);
    if (validationErrors.length > 0) {
      setErrors(validationErrors);
      setMessage(null);
      return;
    }

    setErrors([]);
    setSaving(true);
    try {
      const requests: Promise<Response>[] = [];

      for (const threshold of thresholds) {
        const originalThreshold = original.find((t) => t.id === threshold.id);
        if (
          originalThreshold &&
          (originalThreshold.min_score !== threshold.min_score || originalThreshold.max_score !== threshold.max_score)
        ) {
          requests.push(
            fetch(`/api/grade-thresholds/${threshold.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ minScore: threshold.min_score, maxScore: threshold.max_score }),
            }),
          );
        }
      }

      if (requests.length === 0) {
        setMessage('변경된 내용이 없습니다.');
        return;
      }

      const responses = await Promise.all(requests);
      const failed = responses.filter((res) => !res.ok);
      if (failed.length > 0) {
        setErrors(['일부 항목 저장에 실패했습니다. 다시 시도해주세요.']);
      } else {
        setMessage('저장되었습니다.');
        setOriginal(thresholds);
      }
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="text-sm text-[#999]">불러오는 중...</div>;
  }

  return (
    <div className="max-w-2xl">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-[#0a0a0a] mb-1">장애등급 판정 기준</h1>
          <p className="text-sm text-[#555]">
            총점 구간에 따라 최종 장애등급을 판정하는 기준입니다. 모든 계열사에 동일하게 적용됩니다.
          </p>
        </div>
        <Button onClick={handleSave} disabled={saving || !isAdmin}>
          {saving ? '저장 중...' : '저장'}
        </Button>
      </div>

      <AdminSessionBar isAdmin={isAdmin} onChange={refreshAdmin} />

      {errors.length > 0 && (
        <div className="mb-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
          <ul className="list-disc list-inside space-y-0.5">
            {errors.map((error, i) => (
              <li key={i}>{error}</li>
            ))}
          </ul>
        </div>
      )}

      {message && !errors.length && (
        <div className="mb-4 text-sm text-green-700 bg-green-50 border border-green-200 rounded-md px-3 py-2">
          {message}
        </div>
      )}

      <div className={isAdmin ? undefined : 'pointer-events-none opacity-50 select-none'}>
        <Card>
          <p className="text-xs text-[#999] mb-3">최대값을 비워두면 상한이 없습니다.</p>
          <div className="space-y-1">
            {thresholds.map((threshold) => (
              <div key={threshold.id} className="flex items-center gap-2 py-1 px-2 rounded-md hover:bg-gray-50">
                <span className="flex-1 text-sm font-medium text-[#0a0a0a]">{threshold.grade}</span>
                <span className="text-xs text-[#999]">초과</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  value={Math.round(threshold.min_score * 1000) / 10}
                  onChange={(e) => updateMin(threshold.id, Number(e.target.value) / 100)}
                  className="w-20 text-sm text-right border border-[#e5e5e5] rounded px-2 py-1 outline-none focus:border-[#999]"
                />
                <span className="text-xs text-[#999]">~ 이하</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  placeholder="상한없음"
                  value={threshold.max_score === null ? '' : Math.round(threshold.max_score * 1000) / 10}
                  onChange={(e) => updateMax(threshold.id, e.target.value === '' ? null : Number(e.target.value) / 100)}
                  className="w-24 text-sm text-right border border-[#e5e5e5] rounded px-2 py-1 outline-none focus:border-[#999]"
                />
                <span className="text-sm text-[#999]">%</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
