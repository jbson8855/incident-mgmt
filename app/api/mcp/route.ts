import { createMcpHandler } from 'mcp-handler';
import { z } from 'zod';
import { calculateIncident } from '@/lib/incident-calculation';
import { getIncidentLog, listIncidentLogs } from '@/lib/incident-logs';
import type { IncidentCalculationRequest } from '@/types';

const handler = createMcpHandler((server) => {
  server.registerTool(
    'calculate_incident',
    {
      title: '장애등급 산정하기',
      description: '계열사, 영향받은 시스템, 장애범위, 장애복잡도, 고객서비스영향도 항목을 입력받아 장애등급을 산정하고 이력에 기록한다.',
      inputSchema: z.object({
        companyId: z.number(),
        title: z.string(),
        selectedSystemItemIds: z.array(z.number()),
        failureScope: z.object({
          itemId: z.number(),
          inputValue: z.number().optional(),
        }),
        complexity: z.object({
          itemId: z.number().optional(),
          isUnknown: z.boolean(),
        }),
        accessFailure: z.object({
          itemId: z.number().optional(),
          isUnknown: z.boolean(),
        }),
        responseSpeed: z.object({
          itemId: z.number().optional(),
          isUnknown: z.boolean(),
        }),
        recurrence: z.object({
          itemId: z.number().optional(),
          isUnknown: z.boolean(),
        }),
      }),
    },
    async (input) => {
      const outcome = calculateIncident(input as IncidentCalculationRequest);
      if (!outcome.ok) {
        return { content: [{ type: 'text', text: outcome.error }] };
      }
      return { content: [{ type: 'text', text: JSON.stringify(outcome.result, null, 2) }] };
    },
  );

  server.registerTool(
    'list_incident_logs',
    {
      title: '과거 장애 이력 목록 보기',
      description: '엑셀로 수기 관리해온 과거 장애 이력을 팀/계열사/등급/기간으로 필터링해 목록으로 조회한다.',
      inputSchema: z.object({
        teamName: z.string().optional(),
        companyName: z.string().optional(),
        grade: z.enum(['1등급', '2등급', '3등급', '등급외', '등급내']).optional(),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        page: z.number().optional(),
        pageSize: z.number().optional(),
      }),
    },
    async ({ teamName, companyName, grade, startDate, endDate, page, pageSize }) => {
      const result = listIncidentLogs({ teamName, companyName, grade, startDate, endDate, page, pageSize });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.registerTool(
    'get_incident_log',
    {
      title: '과거 장애 이력 상세 보기',
      description: '과거 장애 이력 한 건을 id로 조회한다.',
      inputSchema: z.object({
        id: z.number(),
      }),
    },
    async ({ id }) => {
      const row = getIncidentLog(id);
      if (!row) {
        return { content: [{ type: 'text', text: '이력을 찾을 수 없습니다.' }] };
      }
      return { content: [{ type: 'text', text: JSON.stringify(row, null, 2) }] };
    },
  );
});

export { handler as GET, handler as POST };
