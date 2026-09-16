import { NextRequest, NextResponse } from 'next/server';
import { getDB } from '@/lib/db';
import type {
  Company,
  GradeThreshold,
  ImpactCategory,
  ImpactItem,
  ImpactSubcategory,
  IncidentCalculationRequest,
  IncidentCalculationResult,
  IncidentGrade,
  IncidentScopeInput,
  IncidentSingleChoiceInput,
  IncidentSystemSnapshot,
} from '@/types';

// 기준표관리에서 관리하는 등급 판정 기준(구간)으로 등급을 결정한다.
// min_score는 배타적 하한(그 값을 "초과"해야 해당 등급), max_score는 포함(그 값까지 "이하"). max_score가 null이면 상한 없음.
function resolveGrade(totalScore: number, thresholds: GradeThreshold[]): IncidentGrade {
  const sorted = [...thresholds].sort((a, b) => b.min_score - a.min_score);
  for (const threshold of sorted) {
    if (totalScore > threshold.min_score && (threshold.max_score === null || totalScore <= threshold.max_score)) {
      return threshold.grade;
    }
  }
  return sorted[sorted.length - 1]?.grade ?? '등급외';
}

// 서비스 장애 범위 가중치(전사/일부)는 장애 건 전체에 공통 적용되는 배율이며, 비즈니스영향도에만 곱해진다.
// 전사처럼 고정값 항목은 기준표에 저장된 value를 그대로 쓰고,
// 일부처럼 min_value/max_value가 설정된 직접입력형 항목은 그 범위 안의 값을 매번 입력받는다.
function resolveFailureScope(
  input: IncidentScopeInput | undefined,
  subcategoryName: string,
  items: ImpactItem[],
): { item: ImpactItem; value: number; error?: undefined } | { item?: undefined; value?: undefined; error: string } {
  if (!input || typeof input.itemId !== 'number') {
    return { error: `${subcategoryName} 항목을 선택해주세요.` };
  }
  const item = items.find((candidate) => candidate.id === input.itemId);
  if (!item) {
    return { error: `${subcategoryName}에서 선택한 항목을 찾을 수 없습니다.` };
  }
  if (item.min_value !== null && item.max_value !== null) {
    if (typeof input.inputValue !== 'number' || Number.isNaN(input.inputValue)) {
      return { error: `${item.name}은(는) ${Math.round(item.min_value * 100)}~${Math.round(item.max_value * 100)}% 사이의 값을 입력해주세요.` };
    }
    if (input.inputValue < item.min_value || input.inputValue > item.max_value) {
      return { error: `${item.name}은(는) ${Math.round(item.min_value * 100)}~${Math.round(item.max_value * 100)}% 사이의 값을 입력해주세요.` };
    }
    return { item, value: input.inputValue };
  }
  return { item, value: item.value };
}

function resolveSingleChoice(
  input: IncidentSingleChoiceInput | undefined,
  subcategoryName: string,
  items: ImpactItem[],
): { item: ImpactItem; error?: undefined } | { item?: undefined; error: string } {
  if (!input) {
    return { error: `${subcategoryName} 항목을 선택해주세요.` };
  }
  if (items.length === 0) {
    return { error: `${subcategoryName} 항목의 기준표 데이터가 없습니다.` };
  }
  if (input.isUnknown) {
    const item = items.reduce((max, current) => (current.value > max.value ? current : max), items[0]);
    return { item };
  }
  if (input.itemId === undefined || input.itemId === null) {
    return { error: `${subcategoryName} 항목을 선택해주세요.` };
  }
  const item = items.find((candidate) => candidate.id === input.itemId);
  if (!item) {
    return { error: `${subcategoryName}에서 선택한 항목을 찾을 수 없습니다.` };
  }
  return { item };
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as IncidentCalculationRequest | null;

  if (!body || typeof body.companyId !== 'number') {
    return NextResponse.json({ error: 'companyId가 필요합니다.' }, { status: 400 });
  }
  if (typeof body.title !== 'string' || !body.title.trim()) {
    return NextResponse.json({ error: '장애 제목을 입력해주세요.' }, { status: 400 });
  }

  const db = getDB();

  const company = db.prepare('SELECT id, name, created_at FROM companies WHERE id = ?').get(body.companyId) as
    | Company
    | undefined;
  if (!company) {
    return NextResponse.json({ error: '계열사를 찾을 수 없습니다.' }, { status: 404 });
  }

  // 대분류/중분류는 모든 계열사 공통이라 계열사 조건 없이 전체를 가져온다.
  const categories = db.prepare('SELECT * FROM impact_categories').all() as ImpactCategory[];
  const businessCategory = categories.find((c) => c.code === 'business');
  const complexityCategory = categories.find((c) => c.code === 'complexity');
  const customerCategory = categories.find((c) => c.code === 'customer');
  if (!businessCategory || !complexityCategory || !customerCategory) {
    return NextResponse.json({ error: '기준표가 완전하지 않습니다.' }, { status: 400 });
  }

  const subcategories = db.prepare('SELECT * FROM impact_subcategories').all() as ImpactSubcategory[];

  const findSubcategory = (code: string) => subcategories.find((s) => s.code === code);
  const targetSystemsSub = findSubcategory('target_systems');
  const failureScopeSub = findSubcategory('failure_scope');
  const severitySub = findSubcategory('severity');
  const accessFailureSub = findSubcategory('access_failure');
  const responseSpeedSub = findSubcategory('response_speed');
  const recurrenceSub = findSubcategory('recurrence');
  if (!targetSystemsSub || !failureScopeSub || !severitySub || !accessFailureSub || !responseSpeedSub || !recurrenceSub) {
    return NextResponse.json({ error: '기준표가 완전하지 않습니다.' }, { status: 400 });
  }

  // 항목은 공통(company_id가 NULL)이거나 이 계열사 전용(company_id = company.id)인 것만 가져온다.
  const items = db
    .prepare('SELECT * FROM impact_items WHERE is_active = 1 AND (company_id IS NULL OR company_id = ?)')
    .all(company.id) as ImpactItem[];

  const itemsBySubcategory = new Map<number, ImpactItem[]>();
  for (const item of items) {
    const list = itemsBySubcategory.get(item.subcategory_id) ?? [];
    list.push(item);
    itemsBySubcategory.set(item.subcategory_id, list);
  }

  const targetSystemItems = itemsBySubcategory.get(targetSystemsSub.id) ?? [];
  const selectedSystemItemIds = body.selectedSystemItemIds ?? [];
  const invalidSystemIds = selectedSystemItemIds.filter(
    (id) => !targetSystemItems.some((item) => item.id === id),
  );
  if (invalidSystemIds.length > 0) {
    return NextResponse.json({ error: '선택한 시스템 중 존재하지 않는 항목이 있습니다.' }, { status: 400 });
  }
  if (selectedSystemItemIds.length === 0) {
    return NextResponse.json({ error: '영향받은 시스템을 입력해주세요.' }, { status: 400 });
  }
  const selectedSystems = targetSystemItems.filter((item) => selectedSystemItemIds.includes(item.id));
  const systemsSnapshot: IncidentSystemSnapshot[] = selectedSystems.map((item) => ({
    name: item.name,
    value: item.value,
    groupName: item.group_name,
  }));
  const failureScopeResolved = resolveFailureScope(
    body.failureScope,
    failureScopeSub.name,
    itemsBySubcategory.get(failureScopeSub.id) ?? [],
  );
  if (failureScopeResolved.error) {
    return NextResponse.json({ error: failureScopeResolved.error }, { status: 400 });
  }
  const failureScopeItem = failureScopeResolved.item!;
  const failureScopeValue = failureScopeResolved.value!;

  const businessScore =
    businessCategory.weight * selectedSystems.reduce((sum, item) => sum + item.value, 0) * failureScopeValue;

  const complexityResolved = resolveSingleChoice(
    body.complexity,
    severitySub.name,
    itemsBySubcategory.get(severitySub.id) ?? [],
  );
  const accessFailureResolved = resolveSingleChoice(
    body.accessFailure,
    accessFailureSub.name,
    itemsBySubcategory.get(accessFailureSub.id) ?? [],
  );
  const responseSpeedResolved = resolveSingleChoice(
    body.responseSpeed,
    responseSpeedSub.name,
    itemsBySubcategory.get(responseSpeedSub.id) ?? [],
  );
  const recurrenceResolved = resolveSingleChoice(
    body.recurrence,
    recurrenceSub.name,
    itemsBySubcategory.get(recurrenceSub.id) ?? [],
  );

  const validationErrors = [complexityResolved, accessFailureResolved, responseSpeedResolved, recurrenceResolved]
    .map((resolved) => resolved.error)
    .filter((error): error is string => Boolean(error));
  if (validationErrors.length > 0) {
    return NextResponse.json({ error: validationErrors.join(' ') }, { status: 400 });
  }

  const complexityItem = complexityResolved.item!;
  const accessFailureItem = accessFailureResolved.item!;
  const responseSpeedItem = responseSpeedResolved.item!;
  const recurrenceItem = recurrenceResolved.item!;

  const complexityScore = complexityCategory.weight * complexityItem.value;
  const customerScore =
    customerCategory.weight *
    (accessFailureSub.weight * accessFailureItem.value +
      responseSpeedSub.weight * responseSpeedItem.value +
      recurrenceSub.weight * recurrenceItem.value);
  const totalScore = businessScore + complexityScore + customerScore;

  const gradeThresholds = db.prepare('SELECT * FROM grade_thresholds').all() as GradeThreshold[];
  if (gradeThresholds.length === 0) {
    return NextResponse.json({ error: '장애등급 판정 기준이 없습니다.' }, { status: 400 });
  }
  const grade = resolveGrade(totalScore, gradeThresholds);

  const insert = db.prepare(
    `INSERT INTO incident_records (
      company_id, company_name, title, systems_json, failure_scope_choice, failure_scope_value, business_score,
      complexity_choice, complexity_is_unknown, complexity_value, complexity_score,
      access_failure_choice, access_failure_is_unknown, access_failure_value,
      response_speed_choice, response_speed_is_unknown, response_speed_value,
      recurrence_choice, recurrence_is_unknown, recurrence_value,
      customer_score, total_score, grade
    ) VALUES (
      @company_id, @company_name, @title, @systems_json, @failure_scope_choice, @failure_scope_value, @business_score,
      @complexity_choice, @complexity_is_unknown, @complexity_value, @complexity_score,
      @access_failure_choice, @access_failure_is_unknown, @access_failure_value,
      @response_speed_choice, @response_speed_is_unknown, @response_speed_value,
      @recurrence_choice, @recurrence_is_unknown, @recurrence_value,
      @customer_score, @total_score, @grade
    )`,
  );

  const result = insert.run({
    company_id: company.id,
    company_name: company.name,
    title: typeof body.title === 'string' ? body.title.trim() : '',
    systems_json: JSON.stringify(systemsSnapshot),
    failure_scope_choice: failureScopeItem.name,
    failure_scope_value: failureScopeValue,
    business_score: businessScore,
    complexity_choice: complexityItem.name,
    complexity_is_unknown: body.complexity.isUnknown ? 1 : 0,
    complexity_value: complexityItem.value,
    complexity_score: complexityScore,
    access_failure_choice: accessFailureItem.name,
    access_failure_is_unknown: body.accessFailure.isUnknown ? 1 : 0,
    access_failure_value: accessFailureItem.value,
    response_speed_choice: responseSpeedItem.name,
    response_speed_is_unknown: body.responseSpeed.isUnknown ? 1 : 0,
    response_speed_value: responseSpeedItem.value,
    recurrence_choice: recurrenceItem.name,
    recurrence_is_unknown: body.recurrence.isUnknown ? 1 : 0,
    recurrence_value: recurrenceItem.value,
    customer_score: customerScore,
    total_score: totalScore,
    grade,
  });

  const recordId = result.lastInsertRowid as number;
  const inserted = db
    .prepare('SELECT calculated_at FROM incident_records WHERE id = ?')
    .get(recordId) as { calculated_at: string };

  const response: IncidentCalculationResult = {
    id: recordId,
    companyName: company.name,
    calculatedAt: inserted.calculated_at,
    title: typeof body.title === 'string' ? body.title.trim() : '',
    systems: systemsSnapshot,
    failureScope: { choice: failureScopeItem.name, value: failureScopeValue },
    businessScore,
    complexity: { choice: complexityItem.name, isUnknown: Boolean(body.complexity.isUnknown), value: complexityItem.value },
    complexityScore,
    accessFailure: {
      choice: accessFailureItem.name,
      isUnknown: Boolean(body.accessFailure.isUnknown),
      value: accessFailureItem.value,
    },
    responseSpeed: {
      choice: responseSpeedItem.name,
      isUnknown: Boolean(body.responseSpeed.isUnknown),
      value: responseSpeedItem.value,
    },
    recurrence: {
      choice: recurrenceItem.name,
      isUnknown: Boolean(body.recurrence.isUnknown),
      value: recurrenceItem.value,
    },
    customerScore,
    totalScore,
    grade,
  };

  return NextResponse.json(response);
}
