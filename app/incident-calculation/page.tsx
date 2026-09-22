'use client';

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { GradeBadge } from '@/components/ui/GradeBadge';
import type {
  Company,
  GradeThreshold,
  ImpactCriteria,
  ImpactItem,
  ImpactSubcategoryWithItems,
  IncidentCalculationResult,
  IncidentGrade,
  IncidentScopeInput,
} from '@/types';

type SingleChoiceCode = 'severity' | 'access_failure' | 'response_speed' | 'recurrence';

type ChoiceState = { itemId: number | null; isUnknown: boolean };

const EMPTY_CHOICE: ChoiceState = { itemId: null, isUnknown: false };

const EMPTY_CHOICES: Record<SingleChoiceCode, ChoiceState> = {
  severity: EMPTY_CHOICE,
  access_failure: EMPTY_CHOICE,
  response_speed: EMPTY_CHOICE,
  recurrence: EMPTY_CHOICE,
};

function isChoiceMade(choice: ChoiceState): boolean {
  return choice.isUnknown || choice.itemId !== null;
}

// 서비스 장애 범위 가중치(전사/일부)는 장애 건 전체에 공통 적용되는 배율이다. 일부처럼
// min_value/max_value가 설정된 항목은 그 범위 안의 값을 매번 직접 입력해야 한다.
type ScopeState = { itemId: number | null; inputPercent: string };

const EMPTY_SCOPE: ScopeState = { itemId: null, inputPercent: '' };

function isRangeItem(item: ImpactItem | undefined): boolean {
  return Boolean(item && item.min_value !== null && item.max_value !== null);
}

function isScopeValid(scope: ScopeState, sub: ImpactSubcategoryWithItems | undefined): boolean {
  if (!sub || scope.itemId === null) return false;
  const item = sub.items.find((candidate) => candidate.id === scope.itemId);
  if (!item) return false;
  if (!isRangeItem(item)) return true;
  const percent = Number(scope.inputPercent);
  if (scope.inputPercent.trim() === '' || Number.isNaN(percent)) return false;
  const minPercent = (item.min_value as number) * 100;
  const maxPercent = (item.max_value as number) * 100;
  return percent >= minPercent && percent <= maxPercent;
}

function toScopeInput(scope: ScopeState, sub: ImpactSubcategoryWithItems | undefined): IncidentScopeInput {
  const item = sub?.items.find((candidate) => candidate.id === scope.itemId);
  if (isRangeItem(item)) {
    return { itemId: scope.itemId as number, inputValue: Number(scope.inputPercent) / 100 };
  }
  return { itemId: scope.itemId as number };
}

function findSubcategoryByCode(criteria: ImpactCriteria, code: string): ImpactSubcategoryWithItems | undefined {
  for (const category of criteria.categories) {
    const found = category.subcategories.find((sub) => sub.code === code);
    if (found) return found;
  }
  return undefined;
}

// 안정화 기간 동안 계산 방식을 투명하게 보여주기 위한 실시간 미리보기 계산.
// 서버(app/api/incident-calculation)의 계산식을 그대로 클라이언트에서 재현한다 — 아직 선택 전인 항목은 undefined로 두어 화면에 "-"로 표시한다.
function resolveSingleChoiceValue(choice: ChoiceState, sub: ImpactSubcategoryWithItems | undefined): number | undefined {
  if (!sub || !isChoiceMade(choice)) return undefined;
  if (choice.isUnknown) {
    return sub.items.reduce((max, item) => Math.max(max, item.value), 0);
  }
  return sub.items.find((item) => item.id === choice.itemId)?.value;
}

function resolveGradePreview(totalScore: number, thresholds: GradeThreshold[]): IncidentGrade | undefined {
  if (thresholds.length === 0) return undefined;
  const sorted = [...thresholds].sort((a, b) => b.min_score - a.min_score);
  for (const threshold of sorted) {
    if (totalScore > threshold.min_score && (threshold.max_score === null || totalScore <= threshold.max_score)) {
      return threshold.grade;
    }
  }
  return sorted[sorted.length - 1]?.grade;
}

// 장애등급계산 화면을 벗어났다 돌아와도(예: 장애 이력 조회 후 복귀) 입력하던 값이 남아있도록
// 세션 동안만 유지되는 임시 저장소에 입력값을 보관한다. "입력항목 Reset" 버튼을 눌러야만 지워진다.
const DRAFT_STORAGE_KEY = 'incident-calculation-draft';

type Draft = {
  companyId: number;
  title: string;
  selectedSystemIds: number[];
  scope: ScopeState;
  choices: Record<SingleChoiceCode, ChoiceState>;
  result: IncidentCalculationResult | null;
};

function loadDraft(): Draft | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Draft) : null;
  } catch {
    return null;
  }
}

function saveDraft(draft: Draft) {
  try {
    sessionStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
  } catch {
    // 세션 스토리지를 쓸 수 없는 환경(프라이빗 모드 등)이면 조용히 건너뛴다 — 입력 자체는 계속 동작한다.
  }
}

function clearDraft() {
  try {
    sessionStorage.removeItem(DRAFT_STORAGE_KEY);
  } catch {
    // no-op
  }
}

function groupByGroupName(items: ImpactItem[]): Array<{ groupName: string; items: ImpactItem[] }> {
  const map = new Map<string, ImpactItem[]>();
  for (const item of items) {
    const key = item.group_name ?? '기타';
    const list = map.get(key) ?? [];
    list.push(item);
    map.set(key, list);
  }
  return [...map.entries()].map(([groupName, groupItems]) => ({ groupName, items: groupItems }));
}

export default function IncidentCalculationPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState<number | null>(null);
  const [criteria, setCriteria] = useState<ImpactCriteria | null>(null);
  const [gradeThresholds, setGradeThresholds] = useState<GradeThreshold[]>([]);
  const [loading, setLoading] = useState(true);

  const [title, setTitle] = useState('');
  const [selectedSystemIds, setSelectedSystemIds] = useState<Set<number>>(new Set());
  const [scope, setScope] = useState<ScopeState>(EMPTY_SCOPE);
  const [choices, setChoices] = useState<Record<SingleChoiceCode, ChoiceState>>(EMPTY_CHOICES);

  const [calculating, setCalculating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<IncidentCalculationResult | null>(null);

  // 화면을 벗어났다 돌아왔을 때 복원할 draft가 있었는지, 이미 한 번 반영했는지 추적한다.
  const hasHydratedRef = useRef(false);
  // true가 되기 전까지는 draft 저장을 미룬다 — 그렇지 않으면 draft를 불러오기도 전에
  // 아직 초기값(빈 값)인 state가 먼저 저장되어 방금 복원하려던 값을 덮어써버린다.
  const [isHydrated, setIsHydrated] = useState(false);

  // 계산하기 클릭 시 미입력 항목이 있으면 해당 위치로 스크롤·포커스 이동하기 위한 참조.
  const titleSectionRef = useRef<HTMLDivElement>(null);
  const scopeSectionRef = useRef<HTMLDivElement>(null);
  const scopePercentInputRef = useRef<HTMLInputElement>(null);
  const targetSystemsSectionRef = useRef<HTMLDivElement>(null);
  const severitySectionRef = useRef<HTMLDivElement>(null);
  const accessFailureSectionRef = useRef<HTMLDivElement>(null);
  const responseSpeedSectionRef = useRef<HTMLDivElement>(null);
  const recurrenceSectionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/api/companies')
      .then((res) => res.json())
      .then((data: Company[]) => {
        setCompanies(data);
        const draft = loadDraft();
        if (draft && data.some((c) => c.id === draft.companyId)) {
          setSelectedCompanyId(draft.companyId);
        } else if (data.length > 0) {
          setSelectedCompanyId(data[0].id);
        }
      });
  }, []);

  useEffect(() => {
    if (selectedCompanyId === null) return;
    // 계열사를 바꿀 때마다 새 fetch가 시작됐음을 보여줘야 하므로 매번 다시 로딩 상태로 되돌린다.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setIsHydrated(false);
    fetch(`/api/impact-criteria?companyId=${selectedCompanyId}`)
      .then((res) => res.json())
      .then((data: ImpactCriteria) => {
        setCriteria(data);

        // 이 화면에 처음 진입했을 때만 이전 draft 복원을 시도한다 — 사용자가 계열사 셀렉트를
        // 직접 바꾼 경우(hasHydratedRef가 이미 true)는 새 계열사 기준으로 다시 시작한다.
        const draft = !hasHydratedRef.current ? loadDraft() : null;
        hasHydratedRef.current = true;

        if (draft && draft.companyId === selectedCompanyId) {
          setTitle(draft.title);
          setSelectedSystemIds(new Set(draft.selectedSystemIds));
          setScope(draft.scope);
          setChoices(draft.choices);
          setResult(draft.result);
          setError(null);
          setIsHydrated(true);
          return;
        }

        setTitle('');
        setSelectedSystemIds(new Set());
        // 서비스 장애 범위 가중치는 대부분 "전사"(고정값)로 시작하는 경우가 많아 기본 선택해둔다 —
        // 필요하면 "일부"로 바꿔서 비율을 직접 입력할 수 있다.
        const defaultScopeItem = findSubcategoryByCode(data, 'failure_scope')?.items.find((item) => !isRangeItem(item));
        setScope(defaultScopeItem ? { itemId: defaultScopeItem.id, inputPercent: '' } : EMPTY_SCOPE);
        setChoices(EMPTY_CHOICES);
        setResult(null);
        setError(null);
        setIsHydrated(true);
      })
      .finally(() => setLoading(false));

  }, [selectedCompanyId]);

  // 장애등급 판정 기준은 모든 계열사에 공통이라 계열사 선택과 무관하게 한 번만 불러온다.
  useEffect(() => {
    fetch('/api/grade-thresholds')
      .then((res) => res.json())
      .then((data: GradeThreshold[]) => setGradeThresholds(data));
  }, []);

  // 입력값이 바뀔 때마다 세션 저장소에 반영해 화면을 벗어났다 돌아와도 유지되게 한다.
  // isHydrated가 true가 되기 전(= draft 복원 또는 기본값 설정이 끝나기 전)에는 저장하지 않는다 —
  // 그렇지 않으면 복원 직전의 빈 초기 state가 먼저 저장되어 방금 불러온 draft를 덮어써버린다.
  useEffect(() => {
    if (selectedCompanyId === null || !isHydrated) return;
    saveDraft({
      companyId: selectedCompanyId,
      title,
      selectedSystemIds: [...selectedSystemIds],
      scope,
      choices,
      result,
    });
  }, [selectedCompanyId, isHydrated, title, selectedSystemIds, scope, choices, result]);

  const targetSystemsSub = useMemo(() => (criteria ? findSubcategoryByCode(criteria, 'target_systems') : undefined), [criteria]);
  const failureScopeSub = useMemo(() => (criteria ? findSubcategoryByCode(criteria, 'failure_scope') : undefined), [criteria]);
  const severitySub = useMemo(() => (criteria ? findSubcategoryByCode(criteria, 'severity') : undefined), [criteria]);
  const accessFailureSub = useMemo(() => (criteria ? findSubcategoryByCode(criteria, 'access_failure') : undefined), [criteria]);
  const responseSpeedSub = useMemo(() => (criteria ? findSubcategoryByCode(criteria, 'response_speed') : undefined), [criteria]);
  const recurrenceSub = useMemo(() => (criteria ? findSubcategoryByCode(criteria, 'recurrence') : undefined), [criteria]);

  const preview = useMemo(() => {
    if (!criteria) return null;
    const businessCategory = criteria.categories.find((c) => c.code === 'business');
    const complexityCategory = criteria.categories.find((c) => c.code === 'complexity');
    const customerCategory = criteria.categories.find((c) => c.code === 'customer');
    if (!businessCategory || !complexityCategory || !customerCategory) return null;

    const selectedSystems = (targetSystemsSub?.items ?? []).filter((item) => selectedSystemIds.has(item.id));
    const systemsSum = selectedSystems.reduce((sum, item) => sum + item.value, 0);
    const scopeItem = failureScopeSub?.items.find((item) => item.id === scope.itemId);
    const scopeValue = isScopeValid(scope, failureScopeSub)
      ? isRangeItem(scopeItem)
        ? Number(scope.inputPercent) / 100
        : (scopeItem?.value ?? undefined)
      : undefined;
    const businessScore = scopeValue === undefined ? undefined : businessCategory.weight * systemsSum * scopeValue;

    const complexityValue = resolveSingleChoiceValue(choices.severity, severitySub);
    const complexityScore = complexityValue === undefined ? undefined : complexityCategory.weight * complexityValue;

    const accessValue = resolveSingleChoiceValue(choices.access_failure, accessFailureSub);
    const responseValue = resolveSingleChoiceValue(choices.response_speed, responseSpeedSub);
    const recurrenceValue = resolveSingleChoiceValue(choices.recurrence, recurrenceSub);
    const customerReady = accessValue !== undefined && responseValue !== undefined && recurrenceValue !== undefined;
    const customerScore = customerReady
      ? customerCategory.weight *
        ((accessFailureSub?.weight ?? 0) * accessValue +
          (responseSpeedSub?.weight ?? 0) * responseValue +
          (recurrenceSub?.weight ?? 0) * recurrenceValue)
      : undefined;

    const knownTotal = (businessScore ?? 0) + (complexityScore ?? 0) + (customerScore ?? 0);
    const isComplete = businessScore !== undefined && complexityScore !== undefined && customerScore !== undefined;

    return {
      businessScore,
      complexityScore,
      customerScore,
      totalScore: knownTotal,
      grade: isComplete ? resolveGradePreview(knownTotal, gradeThresholds) : undefined,
    };
  }, [
    criteria,
    targetSystemsSub,
    selectedSystemIds,
    failureScopeSub,
    scope,
    severitySub,
    choices,
    accessFailureSub,
    responseSpeedSub,
    recurrenceSub,
    gradeThresholds,
  ]);

  // 미입력 항목을 클릭 시점에 알려주고 그 위치로 스크롤·포커스 이동시키기 위한 헬퍼.
  function focusSection(ref: React.RefObject<HTMLDivElement | null>) {
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    ref.current?.querySelector<HTMLInputElement>('input')?.focus();
  }

  function focusScopeSection() {
    scopeSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const selectedItem = failureScopeSub?.items.find((item) => item.id === scope.itemId);
    if (isRangeItem(selectedItem)) {
      scopePercentInputRef.current?.focus();
    } else {
      scopeSectionRef.current?.querySelector<HTMLInputElement>('input[type="radio"]')?.focus();
    }
  }

  function toggleSystem(itemId: number) {
    setSelectedSystemIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }

  function updateChoice(code: SingleChoiceCode, next: ChoiceState) {
    setChoices((prev) => ({ ...prev, [code]: next }));
  }

  function toChoiceInput(choice: ChoiceState): { itemId?: number; isUnknown: boolean } {
    return choice.isUnknown ? { isUnknown: true } : { itemId: choice.itemId ?? undefined, isUnknown: false };
  }

  function resetForm() {
    setTitle('');
    setSelectedSystemIds(new Set());
    const defaultScopeItem = criteria
      ? findSubcategoryByCode(criteria, 'failure_scope')?.items.find((item) => !isRangeItem(item))
      : undefined;
    setScope(defaultScopeItem ? { itemId: defaultScopeItem.id, inputPercent: '' } : EMPTY_SCOPE);
    setChoices(EMPTY_CHOICES);
    setResult(null);
    setError(null);
    clearDraft();
  }

  async function handleCalculate() {
    if (!criteria) return;

    const missing: Array<{ message: string; focus: () => void }> = [];
    if (!title.trim()) {
      missing.push({ message: '장애 제목을 입력해주세요.', focus: () => focusSection(titleSectionRef) });
    }
    if (!isScopeValid(scope, failureScopeSub)) {
      missing.push({ message: '서비스 장애 범위 가중치를 입력해주세요.', focus: focusScopeSection });
    }
    if (selectedSystemIds.size === 0) {
      missing.push({ message: '영향받은 시스템을 입력해주세요.', focus: () => focusSection(targetSystemsSectionRef) });
    }
    if (!isChoiceMade(choices.severity)) {
      missing.push({ message: '장애복잡도를 선택해주세요.', focus: () => focusSection(severitySectionRef) });
    }
    if (!isChoiceMade(choices.access_failure)) {
      missing.push({ message: '접속장애여부를 선택해주세요.', focus: () => focusSection(accessFailureSectionRef) });
    }
    if (!isChoiceMade(choices.response_speed)) {
      missing.push({ message: '응답속도를 선택해주세요.', focus: () => focusSection(responseSpeedSectionRef) });
    }
    if (!isChoiceMade(choices.recurrence)) {
      missing.push({ message: '동일장애재발을 선택해주세요.', focus: () => focusSection(recurrenceSectionRef) });
    }

    if (missing.length > 0) {
      setError(missing[0].message);
      missing[0].focus();
      return;
    }

    setCalculating(true);
    setError(null);
    try {
      const res = await fetch('/api/incident-calculation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: criteria.company.id,
          title,
          selectedSystemItemIds: [...selectedSystemIds],
          failureScope: toScopeInput(scope, failureScopeSub),
          complexity: toChoiceInput(choices.severity),
          accessFailure: toChoiceInput(choices.access_failure),
          responseSpeed: toChoiceInput(choices.response_speed),
          recurrence: toChoiceInput(choices.recurrence),
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? '계산에 실패했습니다.');
        return;
      }

      const data: IncidentCalculationResult = await res.json();
      setResult(data);
    } finally {
      setCalculating(false);
    }
  }

  if (loading || !criteria) {
    return <div className="text-sm text-[#999]">불러오는 중...</div>;
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-semibold text-[#0a0a0a] mb-1">장애등급 계산</h1>
      <p className="text-sm text-[#555] mb-6">
        계열사와 장애 항목을 선택하면 장애등급 산정표 기준으로 자동 계산합니다.
      </p>

      <div className="mb-6 flex items-center gap-2">
        <label className="text-sm text-[#555]">계열사</label>
        <select
          value={selectedCompanyId ?? ''}
          onChange={(e) => setSelectedCompanyId(Number(e.target.value))}
          className="text-sm border border-[#e5e5e5] rounded-md px-2 py-1.5 bg-white"
        >
          {companies.map((company) => (
            <option key={company.id} value={company.id}>
              {company.name}
            </option>
          ))}
        </select>
        <div className="flex-1" />
        <Button variant="secondary" size="sm" onClick={resetForm}>
          입력항목 Reset
        </Button>
      </div>

      {error && (
        <div className="mb-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
          {error}
        </div>
      )}

      {result && (
        <Card className="mb-4">
          <div className="mb-3">
            <div className="text-sm text-[#999] mb-1">{result.companyName}</div>
            <div className="text-xs text-[#999]">산정 시각 {result.calculatedAt}</div>
          </div>
          <div className="flex flex-col items-center justify-center py-6 border-y border-[#f0f0f0]">
            <div className="text-[40px] leading-tight font-bold text-[#0a0a0a]">{result.grade}</div>
            <div className="mt-2">
              <GradeBadge grade={result.grade} size="md" />
            </div>
            <div className="text-sm text-[#999] mt-2">총점 {result.totalScore.toFixed(3)}점</div>
          </div>
          <div className="grid grid-cols-3 gap-4 text-sm mt-4">
            <div>
              <div className="text-[#999] mb-1">비즈니스영향도</div>
              <div className="font-medium text-[#0a0a0a]">{result.businessScore.toFixed(3)}</div>
            </div>
            <div>
              <div className="text-[#999] mb-1">장애복잡도</div>
              <div className="font-medium text-[#0a0a0a]">{result.complexityScore.toFixed(3)}</div>
            </div>
            <div>
              <div className="text-[#999] mb-1">고객서비스영향도</div>
              <div className="font-medium text-[#0a0a0a]">{result.customerScore.toFixed(3)}</div>
            </div>
          </div>
        </Card>
      )}

      {!result && preview && (
        <Card title="실시간 계산 미리보기" className="mb-4 bg-gray-50">
          <p className="text-xs text-[#999] mb-3">선택 중인 항목까지 반영한 값입니다. 아직 선택하지 않은 항목은 &ldquo;-&rdquo;로 표시됩니다.</p>
          <div className="grid grid-cols-4 gap-4 text-sm mb-3">
            <div>
              <div className="text-[#999] mb-1">비즈니스영향도</div>
              <div className="font-medium text-[#0a0a0a]">{preview.businessScore?.toFixed(3) ?? '-'}</div>
            </div>
            <div>
              <div className="text-[#999] mb-1">장애복잡도</div>
              <div className="font-medium text-[#0a0a0a]">{preview.complexityScore?.toFixed(3) ?? '-'}</div>
            </div>
            <div>
              <div className="text-[#999] mb-1">고객서비스영향도</div>
              <div className="font-medium text-[#0a0a0a]">{preview.customerScore?.toFixed(3) ?? '-'}</div>
            </div>
            <div>
              <div className="text-[#999] mb-1">합계</div>
              <div className="font-medium text-[#0a0a0a]">{preview.totalScore.toFixed(3)}</div>
            </div>
          </div>
          {preview.grade && <GradeBadge grade={preview.grade} />}
        </Card>
      )}

      <Card title="장애 제목" className="mb-4">
        <div ref={titleSectionRef}>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="장애를 요약하는 제목을 입력하세요. (계산에는 반영되지 않습니다)"
            className="w-full text-sm border border-[#e5e5e5] rounded-md px-3 py-2 outline-none focus:border-[#999]"
          />
        </div>
      </Card>

      <Card title="비즈니스영향도" titleClassName="text-[21px] font-semibold text-blue-700" className="mb-4">
        <div className="mb-4" ref={scopeSectionRef}>
          <div className="text-sm font-medium text-[#0a0a0a] mb-2">서비스 장애 범위 가중치</div>
          <div className="flex flex-wrap items-center gap-4">
            {(failureScopeSub?.items ?? []).map((item) => (
              <label key={item.id} className="flex items-center gap-1.5 text-sm text-[#333]">
                <input
                  type="radio"
                  name="failure-scope"
                  checked={scope.itemId === item.id}
                  onChange={() => setScope({ itemId: item.id, inputPercent: '' })}
                />
                {item.name} {!isRangeItem(item) && `(${Math.round(item.value * 100)}%)`}
              </label>
            ))}
            {(() => {
              const scopeSelectedItem = failureScopeSub?.items.find((item) => item.id === scope.itemId);
              if (!isRangeItem(scopeSelectedItem)) return null;
              const scopeInputMinPercent = (scopeSelectedItem?.min_value as number) * 100;
              const scopeInputMaxPercent = (scopeSelectedItem?.max_value as number) * 100;
              return (
              <div className="flex items-center gap-1.5 text-sm text-[#333]">
                <input
                  ref={scopePercentInputRef}
                  type="number"
                  min={scopeInputMinPercent}
                  max={scopeInputMaxPercent}
                  step={1}
                  value={scope.inputPercent}
                  onChange={(e) => {
                    const raw = e.target.value;
                    if (raw === '') {
                      setScope((prev) => ({ ...prev, inputPercent: '' }));
                      return;
                    }
                    // 기준표에 설정된 상한(기본 50%)을 넘는 값은 입력 즉시 상한으로 맞춘다.
                    // 하한은 즉시 clamp하면 자릿수를 늘려가며 입력하는 도중(예: 10을 치려고 1을 친 순간) 값이 튀므로
                    // 하한 검증은 계산하기 클릭 시 서버 검증에 맡긴다.
                    const num = Number(raw);
                    const clamped = Number.isNaN(num) ? raw : String(Math.min(num, scopeInputMaxPercent));
                    setScope((prev) => ({ ...prev, inputPercent: clamped }));
                  }}
                  placeholder="비율"
                  className="w-20 text-sm text-right border border-[#e5e5e5] rounded-md px-2 py-1 outline-none focus:border-[#999]"
                />
                <span className="text-[#999]">%</span>
              </div>
              );
            })()}
          </div>
        </div>

        <div ref={targetSystemsSectionRef}>
          <div className="flex items-baseline gap-2 mb-3">
            <div className="text-sm font-medium text-[#0a0a0a]">영향받은 시스템</div>
            <p className="text-xs text-[#999]">해당하는 시스템을 최소 1개 이상 선택하세요.</p>
          </div>
          <div className="space-y-3">
            {groupByGroupName(targetSystemsSub?.items ?? []).map((group) => (
              <div key={group.groupName}>
                <div className="text-xs font-medium text-[#999] mb-1">{group.groupName}</div>
                <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                  {group.items.map((item) => (
                    <Fragment key={item.id}>
                      <label className="flex items-center gap-1.5 text-sm text-[#333]">
                        <input
                          type="checkbox"
                          checked={selectedSystemIds.has(item.id)}
                          onChange={() => toggleSystem(item.id)}
                        />
                        {item.name}
                      </label>
                      {group.groupName === 'ERP' && item.name === 'FI(재무)' && (
                        <div className="basis-full h-0" aria-hidden="true" />
                      )}
                    </Fragment>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </Card>

      <Card title="장애복잡도" titleClassName="text-[21px] font-semibold text-blue-700" className="mb-4">
        <div ref={severitySectionRef}>
          <SingleChoiceGroup subcategory={severitySub} choice={choices.severity} onChange={(next) => updateChoice('severity', next)} hideLabel />
        </div>
      </Card>

      <Card title="고객서비스영향도" titleClassName="text-[21px] font-semibold text-blue-700" className="mb-6">
        <div className="space-y-4">
          <div ref={accessFailureSectionRef}>
            <SingleChoiceGroup
              subcategory={accessFailureSub}
              choice={choices.access_failure}
              onChange={(next) => updateChoice('access_failure', next)}
            />
          </div>
          <div ref={responseSpeedSectionRef}>
            <SingleChoiceGroup
              subcategory={responseSpeedSub}
              choice={choices.response_speed}
              onChange={(next) => updateChoice('response_speed', next)}
            />
          </div>
          <div ref={recurrenceSectionRef}>
            <SingleChoiceGroup
              subcategory={recurrenceSub}
              choice={choices.recurrence}
              onChange={(next) => updateChoice('recurrence', next)}
            />
          </div>
        </div>
      </Card>

      <Button onClick={handleCalculate} disabled={calculating}>
        {calculating ? '계산 중...' : '계산하기'}
      </Button>
    </div>
  );
}

function SingleChoiceGroup({
  subcategory,
  choice,
  onChange,
  hideLabel,
}: {
  subcategory: ImpactSubcategoryWithItems | undefined;
  choice: ChoiceState;
  onChange: (next: ChoiceState) => void;
  hideLabel?: boolean;
}) {
  if (!subcategory) return null;

  return (
    <div>
      {!hideLabel && <div className="text-sm font-medium text-[#0a0a0a] mb-2">{subcategory.name}</div>}
      <div className="flex flex-wrap gap-4">
        {subcategory.items.map((item) => (
          <label key={item.id} className="flex items-center gap-1.5 text-sm text-[#333]">
            <input
              type="radio"
              name={`choice-${subcategory.id}`}
              checked={!choice.isUnknown && choice.itemId === item.id}
              onChange={() => onChange({ itemId: item.id, isUnknown: false })}
            />
            {item.name}
          </label>
        ))}
        <label className="flex items-center gap-1.5 text-sm text-[#333]">
          <input
            type="radio"
            name={`choice-${subcategory.id}`}
            checked={choice.isUnknown}
            onChange={() => onChange({ itemId: null, isUnknown: true })}
          />
          미확인
        </label>
      </div>
    </div>
  );
}
