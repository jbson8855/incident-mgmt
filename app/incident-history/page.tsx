'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { GradeBadge } from '@/components/ui/GradeBadge';
import type { Company, IncidentGrade, IncidentRecord, IncidentRecordListResponse } from '@/types';

const GRADE_OPTIONS: IncidentGrade[] = ['1등급', '2등급', '3등급', '등급외'];
const PAGE_SIZE = 20;

function isHighGrade(grade: IncidentGrade): boolean {
  return grade === '1등급' || grade === '2등급' || grade === '3등급';
}

export default function IncidentHistoryPage() {
  const router = useRouter();

  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState<string>('');
  const [grade, setGrade] = useState<string>('');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [page, setPage] = useState(1);

  const [data, setData] = useState<IncidentRecordListResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/companies')
      .then((res) => res.json())
      .then((list: Company[]) => setCompanies(list));
  }, []);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (companyId) params.set('companyId', companyId);
    if (grade) params.set('grade', grade);
    if (startDate) params.set('startDate', startDate);
    if (endDate) params.set('endDate', endDate);
    params.set('page', String(page));
    params.set('pageSize', String(PAGE_SIZE));

    fetch(`/api/incident-records?${params.toString()}`)
      .then((res) => res.json())
      .then((result: IncidentRecordListResponse) => setData(result))
      .finally(() => setLoading(false));
  }, [companyId, grade, startDate, endDate, page]);

  function resetToFirstPage<T>(setter: (value: T) => void) {
    return (value: T) => {
      setter(value);
      setPage(1);
    };
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="max-w-5xl">
      <h1 className="text-xl font-semibold text-[#0a0a0a] mb-1">장애등급 판정 이력</h1>
      <p className="text-sm text-[#555] mb-6">지금까지 산정한 장애등급 이력을 조회합니다.</p>

      <Card className="mb-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5">
            <label className="text-sm text-[#555]">계열사</label>
            <select
              value={companyId}
              onChange={(e) => resetToFirstPage(setCompanyId)(e.target.value)}
              className="text-sm border border-[#e5e5e5] rounded-md px-2 py-1.5 bg-white"
            >
              <option value="">전체</option>
              {companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1.5">
            <label className="text-sm text-[#555]">등급</label>
            <select
              value={grade}
              onChange={(e) => resetToFirstPage(setGrade)(e.target.value)}
              className="text-sm border border-[#e5e5e5] rounded-md px-2 py-1.5 bg-white"
            >
              <option value="">전체</option>
              {GRADE_OPTIONS.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1.5">
            <label className="text-sm text-[#555]">기간</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => resetToFirstPage(setStartDate)(e.target.value)}
              className="text-sm border border-[#e5e5e5] rounded-md px-2 py-1.5 bg-white"
            />
            <span className="text-sm text-[#999]">~</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => resetToFirstPage(setEndDate)(e.target.value)}
              className="text-sm border border-[#e5e5e5] rounded-md px-2 py-1.5 bg-white"
            />
          </div>

          {(companyId || grade || startDate || endDate) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setCompanyId('');
                setGrade('');
                setStartDate('');
                setEndDate('');
                setPage(1);
              }}
            >
              필터 초기화
            </Button>
          )}
        </div>
      </Card>

      <Card>
        {loading || !data ? (
          <div className="text-sm text-[#999] py-6 text-center">불러오는 중...</div>
        ) : data.records.length === 0 ? (
          <div className="text-sm text-[#999] py-6 text-center">조회된 이력이 없습니다.</div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#e5e5e5] text-left text-xs text-[#999]">
                    <th className="py-2 pr-3 font-medium">계열사</th>
                    <th className="py-2 pr-3 font-medium">제목</th>
                    <th className="py-2 pr-3 font-medium">등급</th>
                    <th className="py-2 pr-3 font-medium text-right">비즈니스영향도</th>
                    <th className="py-2 pr-3 font-medium text-right">장애복잡도</th>
                    <th className="py-2 pr-3 font-medium text-right">고객서비스영향도</th>
                    <th className="py-2 pr-3 font-medium text-right">합산 점수</th>
                    <th className="py-2 pr-3 font-medium">산정 일시</th>
                  </tr>
                </thead>
                <tbody>
                  {data.records.map((record: IncidentRecord) => {
                    const highlighted = isHighGrade(record.grade);
                    return (
                      <tr
                        key={record.id}
                        onClick={() => router.push(`/incident-history/${record.id}`)}
                        className={`border-b border-[#f0f0f0] cursor-pointer hover:bg-gray-50 ${
                          highlighted ? 'bg-red-50' : ''
                        }`}
                      >
                        <td className="py-2.5 pr-3 text-[#333]">{record.company_name}</td>
                        <td className="py-2.5 pr-3 text-[#333]">{record.title || '-'}</td>
                        <td className="py-2.5 pr-3">
                          <div className="flex items-center gap-1.5">
                            {highlighted && <AlertTriangle size={14} className="text-red-500" />}
                            <GradeBadge grade={record.grade} />
                          </div>
                        </td>
                        <td className="py-2.5 pr-3 text-right text-[#333]">{record.business_score.toFixed(3)}</td>
                        <td className="py-2.5 pr-3 text-right text-[#333]">{record.complexity_score.toFixed(3)}</td>
                        <td className="py-2.5 pr-3 text-right text-[#333]">{record.customer_score.toFixed(3)}</td>
                        <td className="py-2.5 pr-3 text-right font-medium text-[#0a0a0a]">{record.total_score.toFixed(3)}</td>
                        <td className="py-2.5 pr-3 text-[#555]">{record.calculated_at}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between mt-4 pt-3 border-t border-[#f0f0f0]">
              <div className="text-xs text-[#999]">
                총 {data.total}건 중 {(data.page - 1) * data.pageSize + 1}-
                {Math.min(data.page * data.pageSize, data.total)}건
              </div>
              <div className="flex items-center gap-2">
                <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  이전
                </Button>
                <span className="text-xs text-[#555]">
                  {data.page} / {totalPages}
                </span>
                <Button variant="secondary" size="sm" disabled={!data.hasMore} onClick={() => setPage((p) => p + 1)}>
                  다음
                </Button>
              </div>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
