'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import type {
  Company,
  ImpactCategoryWithSubcategories,
  ImpactCriteria,
  ImpactItem,
  ImpactSubcategoryWithItems,
} from '@/types';

const BUSINESS_GROUP_ORDER = ['ERP', '유관시스템', 'EURAS', '영업관리', '콘라이브', '기타'];

// 대분류별 선택 방식 설명. 비즈니스영향도는 시스템을 여러 개 중복 체크할 수 있고, 나머지 두 대분류는
// 하위 항목이 모두 단일 선택(예/아니오)이라 대분류 단위로 한 번만 안내하면 충분하다.
function categorySelectionLabel(categoryCode: string): string {
  return categoryCode === 'business' ? '다중선택 가능' : '단일선택';
}

function cloneCriteria(criteria: ImpactCriteria): ImpactCriteria {
  return JSON.parse(JSON.stringify(criteria));
}

function mapSubcategory(
  categories: ImpactCategoryWithSubcategories[],
  subcategoryId: number,
  updater: (subcategory: ImpactSubcategoryWithItems) => ImpactSubcategoryWithItems,
): ImpactCategoryWithSubcategories[] {
  return categories.map((category) => ({
    ...category,
    subcategories: category.subcategories.map((sub) => (sub.id === subcategoryId ? updater(sub) : sub)),
  }));
}

function mapItem(
  categories: ImpactCategoryWithSubcategories[],
  itemId: number,
  updater: (item: ImpactItem) => ImpactItem,
): ImpactCategoryWithSubcategories[] {
  return categories.map((category) => ({
    ...category,
    subcategories: category.subcategories.map((sub) => ({
      ...sub,
      items: sub.items.map((item) => (item.id === itemId ? updater(item) : item)),
    })),
  }));
}

function removeItem(categories: ImpactCategoryWithSubcategories[], itemId: number): ImpactCategoryWithSubcategories[] {
  return categories.map((category) => ({
    ...category,
    subcategories: category.subcategories.map((sub) => ({
      ...sub,
      items: sub.items.filter((item) => item.id !== itemId),
    })),
  }));
}

function groupBusinessItems(items: ImpactItem[]): Array<{ groupName: string; items: ImpactItem[] }> {
  const map = new Map<string, ImpactItem[]>();
  for (const item of items) {
    const key = item.group_name ?? '기타';
    const list = map.get(key) ?? [];
    list.push(item);
    map.set(key, list);
  }
  const orderedKeys = [
    ...BUSINESS_GROUP_ORDER.filter((group) => map.has(group)),
    ...[...map.keys()].filter((group) => !BUSINESS_GROUP_ORDER.includes(group)),
  ];
  return orderedKeys.map((groupName) => ({ groupName, items: map.get(groupName)! }));
}

function validateDraft(criteria: ImpactCriteria, pendingDeactivateIds: Set<number>): string[] {
  const errors: string[] = [];

  const categoryWeightSum = criteria.categories.reduce((sum, category) => sum + category.weight, 0);
  if (Math.abs(categoryWeightSum - 1) > 0.001) {
    errors.push(
      `비즈니스영향도 + 장애복잡도 + 고객서비스영향도 가중치의 합은 100%여야 합니다 (현재 ${Math.round(categoryWeightSum * 1000) / 10}%).`,
    );
  }

  for (const category of criteria.categories) {
    if (!(category.weight >= 0 && category.weight <= 1)) {
      errors.push(`'${category.name}' 가중치는 0~100% 사이여야 합니다.`);
    }
    for (const sub of category.subcategories) {
      if (!(sub.weight >= 0 && sub.weight <= 1)) {
        errors.push(`'${sub.name}' 가중치는 0~100% 사이여야 합니다.`);
      }
      // 단일선택 중분류(장애심각도/접속장애여부/응답속도/동일장애재발)는 항목 중 하나만 골라 그 값을 그대로
      // 쓰므로, 항목 값의 합이 100%가 아니면 선택지에 따라 점수 편차가 원래 의도한 만큼 균형 잡히지 않는다.
      // 서비스 장애 범위 가중치(failure_scope)는 이 화면에 노출되지 않는 별도 항목이라 제외한다.
      if (sub.selection_type === 'single' && sub.code !== 'failure_scope') {
        const itemValueSum = sub.items.reduce((sum, item) => sum + item.value, 0);
        if (Math.abs(itemValueSum - 1) > 0.001) {
          errors.push(`'${sub.name}' 항목 값의 합은 100%여야 합니다 (현재 ${Math.round(itemValueSum * 1000) / 10}%).`);
        }
      }
      for (const item of sub.items) {
        if (pendingDeactivateIds.has(item.id)) continue; // 저장 시 비활성화될 항목이라 검증 대상에서 제외한다.
        if (!item.name.trim()) {
          errors.push(`'${sub.name}'의 항목 이름은 비어 있을 수 없습니다.`);
        }
        if (Number.isNaN(item.value) || item.value < 0 || item.value > 1) {
          errors.push(`'${sub.name} - ${item.name || '(이름 없음)'}'의 값은 0~1 사이여야 합니다.`);
        }
        if (item.min_value !== null && item.max_value !== null) {
          if (item.min_value < 0 || item.min_value > 1 || item.max_value < 0 || item.max_value > 1) {
            errors.push(`'${sub.name} - ${item.name || '(이름 없음)'}'의 최소/최대값은 0~1 사이여야 합니다.`);
          } else if (item.min_value > item.max_value) {
            errors.push(`'${sub.name} - ${item.name || '(이름 없음)'}'의 최소값은 최대값보다 클 수 없습니다.`);
          }
        }
      }
    }
  }
  return errors;
}

export default function ImpactCriteriaPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState<number | null>(null);
  const [draft, setDraft] = useState<ImpactCriteria | null>(null);
  const [original, setOriginal] = useState<ImpactCriteria | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  const [addingSubcategoryId, setAddingSubcategoryId] = useState<number | null>(null);
  const [newItemName, setNewItemName] = useState('');
  const [newItemValue, setNewItemValue] = useState('');
  const [newItemGroup, setNewItemGroup] = useState('');

  const [addingCompany, setAddingCompany] = useState(false);
  const [newCompanyName, setNewCompanyName] = useState('');
  const [addingCompanyError, setAddingCompanyError] = useState<string | null>(null);

  // 비활성화 버튼을 눌러도 바로 지우지 않고, 저장을 누를 때까지 "비활성화 예정" 상태로만 표시한다.
  // 저장 전까지는 "활성화" 버튼으로 다시 눌러 취소할 수 있다.
  const [pendingDeactivateIds, setPendingDeactivateIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    fetch('/api/companies')
      .then((res) => res.json())
      .then((data: Company[]) => {
        setCompanies(data);
        if (data.length > 0) setSelectedCompanyId(data[0].id);
      });
  }, []);

  useEffect(() => {
    if (selectedCompanyId === null) return;
    setLoading(true);
    setMessage(null);
    setErrors([]);
    setPendingDeactivateIds(new Set());
    fetch(`/api/impact-criteria?companyId=${selectedCompanyId}`)
      .then((res) => res.json())
      .then((data: ImpactCriteria) => {
        setDraft(cloneCriteria(data));
        setOriginal(cloneCriteria(data));
      })
      .finally(() => setLoading(false));
  }, [selectedCompanyId]);

  const weightSum = useMemo(() => {
    if (!draft) return 0;
    return draft.categories.reduce((sum, category) => sum + category.weight, 0);
  }, [draft]);
  // 비즈니스영향도/장애복잡도/고객서비스영향도 가중치의 합은 항상 100%여야 한다 — 맞지 않으면 저장 시 오류로 막는다(validateDraft).
  const weightSumInvalid = draft !== null && Math.abs(weightSum - 1) > 0.001;

  function updateCategoryWeightPercent(categoryId: number, percentStr: string) {
    const percent = Number(percentStr);
    setDraft((prev) =>
      prev
        ? {
            ...prev,
            categories: prev.categories.map((category) =>
              category.id === categoryId
                ? { ...category, weight: Number.isNaN(percent) ? 0 : percent / 100 }
                : category,
            ),
          }
        : prev,
    );
  }

  function updateSubcategoryWeightPercent(subcategoryId: number, percentStr: string) {
    const percent = Number(percentStr);
    setDraft((prev) =>
      prev
        ? { ...prev, categories: mapSubcategory(prev.categories, subcategoryId, (sub) => ({ ...sub, weight: Number.isNaN(percent) ? 0 : percent / 100 })) }
        : prev,
    );
  }

  function updateItemName(itemId: number, name: string) {
    setDraft((prev) => (prev ? { ...prev, categories: mapItem(prev.categories, itemId, (item) => ({ ...item, name })) } : prev));
  }

  function updateItemValue(itemId: number, value: number) {
    setDraft((prev) => (prev ? { ...prev, categories: mapItem(prev.categories, itemId, (item) => ({ ...item, value })) } : prev));
  }

  function updateItemMinValue(itemId: number, minValue: number) {
    setDraft((prev) => (prev ? { ...prev, categories: mapItem(prev.categories, itemId, (item) => ({ ...item, min_value: minValue })) } : prev));
  }

  function updateItemMaxValue(itemId: number, maxValue: number) {
    setDraft((prev) => (prev ? { ...prev, categories: mapItem(prev.categories, itemId, (item) => ({ ...item, max_value: maxValue })) } : prev));
  }

  function openAddItemForm(subcategoryId: number) {
    setAddingSubcategoryId(subcategoryId);
    setNewItemName('');
    setNewItemValue('');
    setNewItemGroup('');
    setErrors([]);
    setMessage(null);
  }

  async function submitAddItem(subcategoryId: number, isBusinessTarget: boolean) {
    const trimmedName = newItemName.trim();
    const parsedValue = Number(newItemValue);
    const validationErrors: string[] = [];
    if (!trimmedName) validationErrors.push('항목 이름을 입력해주세요.');
    if (Number.isNaN(parsedValue) || parsedValue < 0 || parsedValue > 1) {
      validationErrors.push('값은 0~1 사이의 숫자여야 합니다.');
    }
    if (isBusinessTarget && !newItemGroup.trim()) validationErrors.push('그룹명을 입력해주세요.');
    if (validationErrors.length > 0) {
      setErrors(validationErrors);
      return;
    }

    const res = await fetch('/api/impact-criteria/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subcategoryId,
        name: trimmedName,
        value: parsedValue,
        groupName: isBusinessTarget ? newItemGroup.trim() : undefined,
        // "대상(업무서비스)" 항목은 계열사 전용이라 어느 계열사 것인지 함께 보낸다.
        companyId: isBusinessTarget ? selectedCompanyId : undefined,
      }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setErrors([body.error ?? '항목 추가에 실패했습니다.']);
      return;
    }

    const created: ImpactItem = await res.json();
    setDraft((prev) => (prev ? { ...prev, categories: mapSubcategory(prev.categories, subcategoryId, (sub) => ({ ...sub, items: [...sub.items, created] })) } : prev));
    setOriginal((prev) => (prev ? { ...prev, categories: mapSubcategory(prev.categories, subcategoryId, (sub) => ({ ...sub, items: [...sub.items, created] })) } : prev));
    setAddingSubcategoryId(null);
    setErrors([]);
    setMessage('항목이 추가되었습니다.');
  }

  // 기준표(장애복잡도/고객서비스영향도 등)는 모든 계열사 공통이라 새 계열사는 이름만 등록하면 된다.
  // "대상(업무서비스)" 시스템 목록은 빈 상태로 시작하고, 등록 직후 선택해 바로 입력할 수 있게 한다.
  async function submitAddCompany() {
    const trimmedName = newCompanyName.trim();
    if (!trimmedName) {
      setAddingCompanyError('계열사명을 입력해주세요.');
      return;
    }

    const res = await fetch('/api/companies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: trimmedName }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setAddingCompanyError(body.error ?? '계열사 추가에 실패했습니다.');
      return;
    }

    const created: Company = await res.json();
    setCompanies((prev) => [...prev, created]);
    setSelectedCompanyId(created.id);
    setAddingCompany(false);
    setNewCompanyName('');
    setAddingCompanyError(null);
  }

  // 비활성화 버튼은 즉시 삭제하지 않고 "비활성화 예정"으로만 표시한다. 다시 누르면(버튼이 "활성화"로 바뀐 상태) 취소된다.
  function togglePendingDeactivate(itemId: number) {
    setPendingDeactivateIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }

  // 삭제는 비활성화와 달리 저장을 기다리지 않고 즉시 행을 완전히 제거한다 — 잘못 추가한 항목을 되돌릴 때 쓴다.
  async function deleteItemPermanently(itemId: number, itemName: string) {
    if (!window.confirm(`'${itemName}' 항목을 완전히 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`)) return;
    const res = await fetch(`/api/impact-criteria/items/${itemId}?permanent=true`, { method: 'DELETE' });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setErrors([body.error ?? '항목 삭제에 실패했습니다.']);
      return;
    }
    setDraft((prev) => (prev ? { ...prev, categories: removeItem(prev.categories, itemId) } : prev));
    setOriginal((prev) => (prev ? { ...prev, categories: removeItem(prev.categories, itemId) } : prev));
    setPendingDeactivateIds((prev) => {
      if (!prev.has(itemId)) return prev;
      const next = new Set(prev);
      next.delete(itemId);
      return next;
    });
    setErrors([]);
    setMessage('항목이 삭제되었습니다.');
  }

  async function handleSave() {
    if (!draft || !original) return;
    const validationErrors = validateDraft(draft, pendingDeactivateIds);
    if (validationErrors.length > 0) {
      setErrors(validationErrors);
      setMessage(null);
      return;
    }

    setErrors([]);
    setSaving(true);
    try {
      const requests: Promise<Response>[] = [];

      for (const category of draft.categories) {
        const originalCategory = original.categories.find((c) => c.id === category.id);
        if (originalCategory && originalCategory.weight !== category.weight) {
          requests.push(
            fetch(`/api/impact-criteria/categories/${category.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ weight: category.weight }),
            }),
          );
        }

        for (const sub of category.subcategories) {
          const originalSub = originalCategory?.subcategories.find((s) => s.id === sub.id);
          if (originalSub && originalSub.weight !== sub.weight) {
            requests.push(
              fetch(`/api/impact-criteria/subcategories/${sub.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ weight: sub.weight }),
              }),
            );
          }

          for (const item of sub.items) {
            if (pendingDeactivateIds.has(item.id)) continue; // 비활성화 예정 항목은 아래에서 한 번에 처리한다.
            const originalItem = originalSub?.items.find((i) => i.id === item.id);
            if (
              originalItem &&
              (originalItem.name !== item.name ||
                originalItem.value !== item.value ||
                originalItem.min_value !== item.min_value ||
                originalItem.max_value !== item.max_value)
            ) {
              requests.push(
                fetch(`/api/impact-criteria/items/${item.id}`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    name: item.name,
                    value: item.value,
                    minValue: item.min_value,
                    maxValue: item.max_value,
                  }),
                }),
              );
            }
          }
        }
      }

      for (const itemId of pendingDeactivateIds) {
        requests.push(fetch(`/api/impact-criteria/items/${itemId}`, { method: 'DELETE' }));
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
        let savedCategories = draft.categories;
        for (const itemId of pendingDeactivateIds) {
          savedCategories = removeItem(savedCategories, itemId);
        }
        const savedCriteria = { ...draft, categories: savedCategories };
        setDraft(savedCriteria);
        setOriginal(cloneCriteria(savedCriteria));
        setPendingDeactivateIds(new Set());
        setMessage('저장되었습니다.');
      }
    } finally {
      setSaving(false);
    }
  }

  if (loading || !draft) {
    return <div className="text-sm text-[#999]">불러오는 중...</div>;
  }

  return (
    <div className="max-w-4xl">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-[#0a0a0a] mb-1">영향도 기준표 관리</h1>
          <p className="text-sm text-[#555]">
            계열사별 장애등급 산정 항목(비즈니스 영향도 / 장애 복잡도 / 고객서비스 영향도)의 가중치와 세부 항목을 조회하고 수정합니다.
          </p>
        </div>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? '저장 중...' : '저장'}
        </Button>
      </div>

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

        {addingCompany ? (
          <>
            <input
              type="text"
              autoFocus
              placeholder="새 계열사명"
              value={newCompanyName}
              onChange={(e) => setNewCompanyName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitAddCompany();
                if (e.key === 'Escape') {
                  setAddingCompany(false);
                  setNewCompanyName('');
                  setAddingCompanyError(null);
                }
              }}
              className="text-sm border border-[#e5e5e5] rounded-md px-2 py-1.5 outline-none focus:border-[#999]"
            />
            <Button size="sm" onClick={submitAddCompany}>
              추가
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setAddingCompany(false);
                setNewCompanyName('');
                setAddingCompanyError(null);
              }}
            >
              취소
            </Button>
            {addingCompanyError && <span className="text-xs text-red-600">{addingCompanyError}</span>}
          </>
        ) : (
          <Button size="sm" variant="secondary" onClick={() => setAddingCompany(true)}>
            + 계열사 추가
          </Button>
        )}
      </div>
      <p className="text-xs text-[#999] -mt-4 mb-6">
        장애복잡도 / 고객서비스영향도와 비즈니스영향도의 가중치는 모든 계열사 공통입니다. 계열사마다 다른 부분은
        &ldquo;대상(업무서비스)&rdquo; 시스템 목록뿐이며, 새 계열사는 이 목록이 빈 채로 시작합니다.
      </p>

      {weightSumInvalid && (
        <div className="mb-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
          비즈니스영향도 + 장애복잡도 + 고객서비스영향도 가중치의 합은 100%여야 합니다 (현재 {Math.round(weightSum * 1000) / 10}%).
        </div>
      )}

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

      <div className="space-y-6">
        {draft.categories.map((category) => (
          <Card key={category.id}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-[#0a0a0a]">
                {category.name} <span className="text-sm font-normal text-[#999]">({categorySelectionLabel(category.code)})</span>
              </h2>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  value={Math.round(category.weight * 1000) / 10}
                  onChange={(e) => updateCategoryWeightPercent(category.id, e.target.value)}
                  className="w-16 text-sm text-right border border-[#e5e5e5] rounded-md px-2 py-1 outline-none focus:border-[#999]"
                />
                <span className="text-sm text-[#999]">%</span>
              </div>
            </div>

            <div className="space-y-5">
              {/* 서비스 장애 범위 가중치(전사/일부)는 장애 발생 건마다 달라지는 값이라 기준표관리가 아닌
                  장애등급계산 화면에서만 선택·입력한다 (기준표관리에는 노출하지 않음). */}
              {(() => {
                const visibleSubcategories = category.subcategories.filter((sub) => sub.code !== 'failure_scope');
                // 대분류 안에 중분류가 하나뿐이면(대상업무서비스/장애심각도) 중분류 가중치는 항상 대분류 값과
                // 동일하게 취급되어 산정식에 쓰이지 않는다 — 혼동을 주는 비율 입력을 아예 노출하지 않는다.
                const showSubWeight = visibleSubcategories.length > 1;
                return visibleSubcategories.map((sub) => {
                  const isBusinessTarget = sub.code === 'target_systems';
                  // 항목 추가/비활성화는 다중 선택 목록(비즈니스영향도 시스템 목록)에서만 허용한다.
                  // 나머지 중분류(장애복잡도/접속장애여부/응답속도/동일장애재발)는 예/아니오 고정 이진 구조이며
                  // 값 수정만 지원한다 — 항목 수가 바뀌면 "미확인 = 두 값 중 큰 값" 계산 로직이 깨진다.
                  const canManageItems = sub.selection_type === 'multiple';
                  // 단일선택 중분류는 항목 값의 합이 100%여야 하므로(validateDraft) 편집 중에도 바로 확인할 수 있게 표시한다.
                  const itemValueSum = sub.items.reduce((sum, item) => sum + item.value, 0);
                  const itemValueSumInvalid = sub.selection_type === 'single' && Math.abs(itemValueSum - 1) > 0.001;
                  return (
                    <div key={sub.id} className="border-t border-[#f0f0f0] pt-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-medium text-[#0a0a0a]">{sub.name}</h3>
                        {sub.selection_type === 'single' && (
                          <span className={`text-xs ${itemValueSumInvalid ? 'text-red-600' : 'text-[#999]'}`}>
                            항목 합계 {Math.round(itemValueSum * 1000) / 10}%{itemValueSumInvalid && ' (100%여야 함)'}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3">
                        {showSubWeight && (
                          <div className="flex items-center gap-1.5">
                            <input
                              type="number"
                              min={0}
                              max={100}
                              step={1}
                              value={Math.round(sub.weight * 1000) / 10}
                              onChange={(e) => updateSubcategoryWeightPercent(sub.id, e.target.value)}
                              className="w-16 text-sm text-right border border-[#e5e5e5] rounded-md px-2 py-1 outline-none focus:border-[#999]"
                            />
                            <span className="text-sm text-[#999]">%</span>
                          </div>
                        )}
                        {canManageItems && (
                          <Button size="sm" variant="secondary" onClick={() => openAddItemForm(sub.id)}>
                            항목 추가
                          </Button>
                        )}
                      </div>
                    </div>

                    {isBusinessTarget ? (
                      <div className="space-y-3">
                        {groupBusinessItems(sub.items).map((group) => (
                          <div key={group.groupName}>
                            <div className="text-xs font-medium text-[#999] mb-1 px-2">{group.groupName}</div>
                            <div className="space-y-0.5">
                              {group.items.map((item) => (
                                <ItemRow
                                  key={item.id}
                                  item={item}
                                  canDeactivate={canManageItems}
                                  pendingDeactivate={pendingDeactivateIds.has(item.id)}
                                  onChangeName={updateItemName}
                                  onChangeValue={updateItemValue}
                                  onChangeMinValue={updateItemMinValue}
                                  onChangeMaxValue={updateItemMaxValue}
                                  onToggleDeactivate={togglePendingDeactivate}
                                  onDeletePermanently={deleteItemPermanently}
                                />
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="space-y-0.5">
                        {sub.items.map((item) => (
                          <ItemRow
                            key={item.id}
                            item={item}
                            canDeactivate={canManageItems}
                            pendingDeactivate={pendingDeactivateIds.has(item.id)}
                            onChangeName={updateItemName}
                            onChangeValue={updateItemValue}
                            onChangeMinValue={updateItemMinValue}
                            onChangeMaxValue={updateItemMaxValue}
                            onToggleDeactivate={togglePendingDeactivate}
                            onDeletePermanently={deleteItemPermanently}
                          />
                        ))}
                      </div>
                    )}

                    {canManageItems && addingSubcategoryId === sub.id && (
                      <div className="mt-2 flex items-center gap-2 bg-gray-50 rounded-md px-2 py-2">
                        <input
                          type="text"
                          placeholder="이름"
                          value={newItemName}
                          onChange={(e) => setNewItemName(e.target.value)}
                          className="flex-1 text-sm border border-[#e5e5e5] rounded px-2 py-1 outline-none focus:border-[#999]"
                        />
                        <input
                          type="number"
                          placeholder="값 (0~1)"
                          min={0}
                          max={1}
                          step={0.1}
                          value={newItemValue}
                          onChange={(e) => setNewItemValue(e.target.value)}
                          className="w-24 text-sm border border-[#e5e5e5] rounded px-2 py-1 outline-none focus:border-[#999]"
                        />
                        {isBusinessTarget && (
                          <input
                            type="text"
                            placeholder="그룹명 (예: ERP)"
                            list="business-group-options"
                            value={newItemGroup}
                            onChange={(e) => setNewItemGroup(e.target.value)}
                            className="w-32 text-sm border border-[#e5e5e5] rounded px-2 py-1 outline-none focus:border-[#999]"
                          />
                        )}
                        <Button size="sm" onClick={() => submitAddItem(sub.id, isBusinessTarget)}>
                          추가
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setAddingSubcategoryId(null)}>
                          취소
                        </Button>
                      </div>
                    )}
                  </div>
                  );
                });
              })()}
            </div>
          </Card>
        ))}
      </div>

      <datalist id="business-group-options">
        {BUSINESS_GROUP_ORDER.map((group) => (
          <option key={group} value={group} />
        ))}
      </datalist>
    </div>
  );
}

function ItemRow({
  item,
  canDeactivate,
  pendingDeactivate,
  onChangeName,
  onChangeValue,
  onChangeMinValue,
  onChangeMaxValue,
  onToggleDeactivate,
  onDeletePermanently,
}: {
  item: ImpactItem;
  canDeactivate: boolean;
  pendingDeactivate: boolean;
  onChangeName: (itemId: number, name: string) => void;
  onChangeValue: (itemId: number, value: number) => void;
  onChangeMinValue: (itemId: number, minValue: number) => void;
  onChangeMaxValue: (itemId: number, maxValue: number) => void;
  onToggleDeactivate: (itemId: number) => void;
  onDeletePermanently: (itemId: number, itemName: string) => void;
}) {
  const isRangeInput = item.min_value !== null && item.max_value !== null;

  return (
    <div
      className={`flex items-center gap-2 py-1 px-2 rounded-md hover:bg-gray-50 ${pendingDeactivate ? 'opacity-40' : ''}`}
    >
      <input
        type="text"
        value={item.name}
        disabled={pendingDeactivate}
        onChange={(e) => onChangeName(item.id, e.target.value)}
        className="flex-1 text-sm border border-transparent hover:border-[#e5e5e5] focus:border-[#999] rounded px-2 py-1 outline-none bg-transparent disabled:hover:border-transparent"
      />
      {isRangeInput ? (
        <div className="flex items-center gap-1 text-xs text-[#999]">
          <span>산정 시 직접입력</span>
          <input
            type="number"
            min={0}
            max={100}
            step={1}
            disabled={pendingDeactivate}
            value={Math.round((item.min_value as number) * 1000) / 10}
            onChange={(e) => onChangeMinValue(item.id, Number(e.target.value) / 100)}
            className="w-16 text-sm text-right border border-[#e5e5e5] rounded px-2 py-1 outline-none focus:border-[#999]"
          />
          <span>~</span>
          <input
            type="number"
            min={0}
            max={100}
            step={1}
            disabled={pendingDeactivate}
            value={Math.round((item.max_value as number) * 1000) / 10}
            onChange={(e) => onChangeMaxValue(item.id, Number(e.target.value) / 100)}
            className="w-16 text-sm text-right border border-[#e5e5e5] rounded px-2 py-1 outline-none focus:border-[#999]"
          />
          <span>%</span>
        </div>
      ) : (
        <input
          type="number"
          min={0}
          max={1}
          step={0.1}
          disabled={pendingDeactivate}
          value={item.value}
          onChange={(e) => onChangeValue(item.id, e.target.valueAsNumber)}
          className="w-20 text-sm text-right border border-[#e5e5e5] rounded px-2 py-1 outline-none focus:border-[#999]"
        />
      )}
      {canDeactivate && (
        <button
          type="button"
          onClick={() => onToggleDeactivate(item.id)}
          className={
            pendingDeactivate
              ? 'text-xs text-green-700 hover:text-green-800 px-2 py-1 rounded hover:bg-green-50'
              : 'text-xs text-red-600 hover:text-red-700 px-2 py-1 rounded hover:bg-red-50'
          }
        >
          {pendingDeactivate ? '활성화' : '비활성화'}
        </button>
      )}
      {canDeactivate && (
        // 비활성화(저장 시점까지 유예되는 소프트 삭제)와 달리, 삭제는 행을 즉시 완전히 지운다 —
        // 잘못 추가한 항목("test" 등)을 되돌릴 때 쓴다.
        <button
          type="button"
          onClick={() => onDeletePermanently(item.id, item.name)}
          className="text-xs text-red-700 hover:text-white px-2 py-1 rounded border border-red-200 hover:bg-red-600 hover:border-red-600"
        >
          삭제
        </button>
      )}
    </div>
  );
}
