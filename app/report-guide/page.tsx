import { Card } from '@/components/ui/Card';
import { GradeBadge } from '@/components/ui/GradeBadge';
import type { IncidentGrade } from '@/types';

type ReportStage = {
  timing: string;
  method: string;
};

type ReportPolicyRow = {
  label: string;
  grades: IncidentGrade[];
  target: string;
  stages: ReportStage[];
  reportDeadline: string;
  note: string | null;
};

const REPORT_POLICY: ReportPolicyRow[] = [
  {
    label: '1·2등급',
    grades: ['1등급', '2등급'],
    target: 'ITS (CEO, 각 팀장, 품질담당)\n고객사 담당자',
    stages: [
      { timing: '발생 즉시', method: '모바일 팀즈 (SMS)' },
      { timing: '조치 시작', method: '모바일 팀즈 (SMS)' },
      { timing: '조치 진행', method: '모바일 팀즈 (1시간마다)' },
      { timing: '조치 완료', method: '모바일 팀즈 (SMS)' },
    ],
    reportDeadline: '2영업일 이내',
    note: null,
  },
  {
    label: '3등급',
    grades: ['3등급'],
    target: 'ITS (각 팀장, 품질담당)\n고객사 담당자',
    stages: [
      { timing: '발생 즉시', method: '모바일 팀즈 (SMS)' },
      { timing: '조치 시작', method: '모바일 팀즈 (SMS)' },
      { timing: '조치 완료', method: '모바일 팀즈 (SMS)' },
    ],
    reportDeadline: '2영업일 이내',
    note: null,
  },
  {
    label: '등급외',
    grades: ['등급외'],
    target: 'ITS (각 팀장, 품질담당)\n고객사 담당자(필요시)',
    stages: [
      { timing: '조치 시작', method: '모바일 팀즈 (SMS)' },
      { timing: '조치 완료', method: '모바일 팀즈 (SMS)' },
    ],
    reportDeadline: '없음',
    note: '고객 서비스 중단이 발생한 경우 고객사 담당자까지 보고',
  },
];

export default function ReportGuidePage() {
  return (
    <div className="max-w-4xl">
      <h1 className="text-xl font-semibold text-[#0a0a0a] mb-1">장애발생시 보고 현황</h1>
      <p className="text-sm text-[#555] mb-6">장애등급에 따른 보고 대상, 보고 시점, 보고 방식 및 장애보고서 제출 기한입니다.</p>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-[#e5e5e5] text-left text-xs text-[#999]">
                <th className="py-2 pr-3 font-medium">장애등급</th>
                <th className="py-2 pr-3 font-medium">보고대상</th>
                <th className="py-2 pr-3 font-medium">보고시점</th>
                <th className="py-2 pr-3 font-medium">보고방식</th>
                <th className="py-2 pr-3 font-medium">장애보고서</th>
                <th className="py-2 pr-3 font-medium">비고</th>
              </tr>
            </thead>
            <tbody>
              {REPORT_POLICY.map((row) =>
                row.stages.map((stage, stageIndex) => (
                  <tr key={`${row.label}-${stageIndex}`} className="border-b border-[#f0f0f0]">
                    {stageIndex === 0 && (
                      <td className="py-2.5 pr-3 align-top" rowSpan={row.stages.length}>
                        <div className="flex flex-col gap-1">
                          {row.grades.map((grade) => (
                            <GradeBadge key={grade} grade={grade} />
                          ))}
                        </div>
                      </td>
                    )}
                    {stageIndex === 0 && (
                      <td
                        className="py-2.5 pr-3 align-top text-[#333] whitespace-pre-line"
                        rowSpan={row.stages.length}
                      >
                        {row.target}
                      </td>
                    )}
                    <td className="py-2.5 pr-3 text-[#333]">{stage.timing}</td>
                    <td className="py-2.5 pr-3 text-[#555]">{stage.method}</td>
                    {stageIndex === 0 && (
                      <td className="py-2.5 pr-3 align-top text-[#333]" rowSpan={row.stages.length}>
                        {row.reportDeadline}
                      </td>
                    )}
                    {stageIndex === 0 && (
                      <td className="py-2.5 pr-3 align-top text-[#555]" rowSpan={row.stages.length}>
                        {row.note ?? '-'}
                      </td>
                    )}
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
