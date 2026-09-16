import { NextRequest, NextResponse } from 'next/server';
import { getDB } from '@/lib/db';
import type {
  Company,
  ImpactCategory,
  ImpactCriteria,
  ImpactItem,
  ImpactSubcategory,
  ImpactSubcategoryWithItems,
} from '@/types';

export async function GET(request: NextRequest) {
  const companyIdParam = request.nextUrl.searchParams.get('companyId');
  const companyId = companyIdParam ? Number(companyIdParam) : NaN;

  if (!companyIdParam || Number.isNaN(companyId)) {
    return NextResponse.json({ error: 'companyId 쿼리 파라미터가 필요합니다.' }, { status: 400 });
  }

  const db = getDB();
  const company = db.prepare('SELECT id, name, created_at FROM companies WHERE id = ?').get(companyId) as
    | Company
    | undefined;

  if (!company) {
    return NextResponse.json({ error: '계열사를 찾을 수 없습니다.' }, { status: 404 });
  }

  // 대분류/중분류는 모든 계열사 공통이라 계열사 조건 없이 전체를 가져온다.
  const categories = db
    .prepare('SELECT * FROM impact_categories ORDER BY display_order ASC, id ASC')
    .all() as ImpactCategory[];

  const subcategories = db
    .prepare('SELECT * FROM impact_subcategories ORDER BY display_order ASC, id ASC')
    .all() as ImpactSubcategory[];

  // 항목은 공통(company_id가 NULL)이거나 이 계열사 전용(company_id = companyId)인 것만 가져온다.
  const items = db
    .prepare(
      `SELECT * FROM impact_items
       WHERE is_active = 1 AND (company_id IS NULL OR company_id = ?)
       ORDER BY display_order ASC, id ASC`,
    )
    .all(companyId) as ImpactItem[];

  const itemsBySubcategory = new Map<number, ImpactItem[]>();
  for (const item of items) {
    const list = itemsBySubcategory.get(item.subcategory_id) ?? [];
    list.push(item);
    itemsBySubcategory.set(item.subcategory_id, list);
  }

  const subcategoriesByCategory = new Map<number, ImpactSubcategoryWithItems[]>();
  for (const subcategory of subcategories) {
    const withItems: ImpactSubcategoryWithItems = {
      ...subcategory,
      items: itemsBySubcategory.get(subcategory.id) ?? [],
    };
    const list = subcategoriesByCategory.get(subcategory.category_id) ?? [];
    list.push(withItems);
    subcategoriesByCategory.set(subcategory.category_id, list);
  }

  const result: ImpactCriteria = {
    company,
    categories: categories.map((category) => ({
      ...category,
      subcategories: subcategoriesByCategory.get(category.id) ?? [],
    })),
  };

  return NextResponse.json(result);
}
