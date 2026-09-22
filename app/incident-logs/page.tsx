'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { GradeBadge } from '@/components/ui/GradeBadge';
import type { IncidentLog, IncidentLogListResponse } from '@/types';

const GRADE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '등급내', label: '등급내(1·2·3등급)' },
  { value: '1등급', label: '1등급' },
  { value: '2등급', label: '2등급' },
  { value: '3등급', label: '3등급' },
  { value: '등급외', label: '등급외' },
];
const PAGE_SIZE = 20;

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function defaultStartDate(): string {
  const date = new Date();
  date.setFullYear(date.getFullYear() - 1);
  return formatLocalDate(date);
}

export default function IncidentLogsPage() {
  const router = useRouter();

  const [teamOptions, setTeamOptions] = useState<string[]>([]);
  const [companyOptions, setCompanyOptions] = useState<string[]>([]);

  const [teamName, setTeamName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [grade, setGrade] = useState('');
  const [startDate, setStartDate] = useState(defaultStartDate);
  const [endDate, setEndDate] = useState(() => formatLocalDate(new Date()));
  const [page, setPage] = useState(1);

  const [data, setData] = useState<IncidentLogListResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/incident-logs?pageSize=1000')
      .then((res) => res.json())
      .then((result: IncidentLogListResponse) => {
        setTeamOptions(Array.from(new Set(result.records.map((r) => r.team_name))).sort());
        setCompanyOptions(Array.from(new Set(result.records.map((r) => r.company_name))).sort());
      });
  }, []);

  useEffect(() => {
    // 필터/페이지가 바뀔 때마다 새 fetch가 시작됐음을 보여줘야 하므로 매번 다시 로딩 상태로 되돌린다.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    const params = new URLSearchParams();
    if (teamName) params.set('teamName', teamName);
    if (companyName) params.set('companyName', companyName);
    if (grade) params.set('grade', grade);
    if (startDate) params.set('startDate', startDate);
    if (endDate) params.set('endDate', endDate);
    params.set('page', String(page));
    params.set('pageSize', String(PAGE_SIZE));

    fetch(`/api/incident-logs?${params.toString()}`)
      .then((res) => res.json())
      .then((result: IncidentLogListResponse) => setData(result))
      .finally(() => setLoading(false));
  }, [teamName, companyName, grade, startDate, endDate, page]);

  const hasFilter = useMemo(
    () =>
      Boolean(
        teamName || companyName || grade || startDate !== defaultStartDate() || endDate !== formatLocalDate(new Date()),
      ),
    [teamName, companyName, grade, startDate, endDate],
  );

  function resetToFirstPage<T>(setter: (value: T) => void) {
    return (value: T) => {
      setter(value);
      setPage(1);
    };
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="max-w-5xl">
      <h1 className="text-xl font-semibold text-[#0a0a0a] mb-1">과거 장애 이력</h1>
      <p className="text-sm text-[#555] mb-6">엑셀로 관리하던 과거 장애 이력을 조회합니다.</p>

      <Card className="mb-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5">
            <label className="text-sm text-[#555]">팀명</label>
            <select
              value={teamName}
              onChange={(e) => resetToFirstPage(setTeamName)(e.target.value)}
              className="text-sm border border-[#e5e5e5] rounded-md px-2 py-1.5 bg-white"
            >
              <option value="">전체</option>
              {teamOptions.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1.5">
            <label className="text-sm text-[#555]">관계사</label>
            <select
              value={companyName}
              onChange={(e) => resetToFirstPage(setCompanyName)(e.target.value)}
              className="text-sm border border-[#e5e5e5] rounded-md px-2 py-1.5 bg-white"
            >
              <option value="">전체</option>
              {companyOptions.map((c) => (
                <option key={c} value={c}>
                  {c}
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
                <option key={g.value} value={g.value}>
                  {g.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1.5">
            <label className="text-sm text-[#555]">발생일</label>
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

          {hasFilter && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setTeamName('');
                setCompanyName('');
                setGrade('');
                setStartDate(defaultStartDate());
                setEndDate(formatLocalDate(new Date()));
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
            <p className="text-xs text-[#999] mb-2">행을 더블클릭하면 상세 내역을 확인할 수 있습니다.</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#e5e5e5] text-left text-xs text-[#999]">
                    <th className="py-2 pr-3 font-medium">발생일</th>
                    <th className="py-2 pr-3 font-medium">팀명</th>
                    <th className="py-2 pr-3 font-medium">장애유형</th>
                    <th className="py-2 pr-3 font-medium">관계사</th>
                    <th className="py-2 pr-3 font-medium">장애등급</th>
                    <th className="py-2 pr-3 font-medium">발생시간</th>
                    <th className="py-2 pr-3 font-medium">소요시간</th>
                    <th className="py-2 pr-3 font-medium">비고</th>
                  </tr>
                </thead>
                <tbody>
                  {data.records.map((record: IncidentLog) => (
                    <tr
                      key={record.id}
                      onDoubleClick={() => router.push(`/incident-logs/${record.id}`)}
                      title="더블클릭하면 상세 내역을 확인할 수 있습니다."
                      className="border-b border-[#f0f0f0] cursor-pointer hover:bg-gray-50"
                    >
                      <td className="py-2.5 pr-3 text-[#333]">{record.occurred_date}</td>
                      <td className="py-2.5 pr-3 text-[#333]">{record.team_name}</td>
                      <td className="py-2.5 pr-3 text-[#333]">{record.incident_type}</td>
                      <td className="py-2.5 pr-3 text-[#333]">{record.company_name}</td>
                      <td className="py-2.5 pr-3">
                        <GradeBadge grade={record.grade} />
                      </td>
                      <td className="py-2.5 pr-3 text-[#555]">{record.occurred_time || '-'}</td>
                      <td className="py-2.5 pr-3 text-[#555]">{record.duration || '-'}</td>
                      <td className="py-2.5 pr-3 text-[#555] max-w-xs truncate">{record.note || '-'}</td>
                    </tr>
                  ))}
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
