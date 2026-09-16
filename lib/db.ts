import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

let db: Database.Database | null = null;

export function getDB(): Database.Database {
  if (db) return db;
  const dataDir = path.join(process.cwd(), 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, 'admin.db');
  db = new Database(dbPath);
  const schema = fs.readFileSync(path.join(process.cwd(), 'schema.sql'), 'utf-8');
  db.exec(schema);
  migrateGradeThresholdsToGlobal(db);
  migrateImpactCriteriaToShared(db);
  seedImpactCriteria(db);
  seedIncidentLogs(db);
  return db;
}

// grade_thresholds는 원래 계열사별로 나뉘어 있었으나, 모든 계열사에 동일하게 적용되는 공통 기준으로
// 바뀌면서 company_id를 없앴다. 예전 스키마로 이미 생성된 DB 파일을 위한 1회성 이관 로직.
function migrateGradeThresholdsToGlobal(db: Database.Database) {
  const columns = db.prepare("PRAGMA table_info(grade_thresholds)").all() as Array<{ name: string }>;
  const hasCompanyId = columns.some((c) => c.name === 'company_id');
  if (!hasCompanyId) return;

  const migrate = db.transaction(() => {
    // 계열사마다 값이 같다는 전제이므로, 등급별로 가장 먼저 만들어진 행 하나만 남긴다.
    const rows = db
      .prepare(
        `SELECT grade, min_score, max_score, display_order FROM grade_thresholds
         WHERE id IN (SELECT MIN(id) FROM grade_thresholds GROUP BY grade)`,
      )
      .all() as Array<{ grade: string; min_score: number; max_score: number | null; display_order: number }>;

    db.exec('ALTER TABLE grade_thresholds RENAME TO grade_thresholds_old');
    db.exec(`
      CREATE TABLE grade_thresholds (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        grade TEXT NOT NULL,
        min_score REAL NOT NULL,
        max_score REAL,
        display_order INTEGER NOT NULL DEFAULT 0
      )
    `);
    const insert = db.prepare(
      'INSERT INTO grade_thresholds (grade, min_score, max_score, display_order) VALUES (@grade, @min_score, @max_score, @display_order)',
    );
    for (const row of rows) insert.run(row);
    db.exec('DROP TABLE grade_thresholds_old');
  });

  migrate();
}

// impact_categories/impact_subcategories는 원래 계열사별로 통째로 복제되어 있었으나, 장애복잡도/고객서비스영향도
// (그리고 비즈니스영향도의 대분류·중분류 가중치, "서비스 장애 범위 가중치")는 모든 계열사에 동일하게 적용되는
// 공통 기준으로 바뀌면서 계열사 구분을 없앴다. 계열사마다 달라지는 부분은 "대상(업무서비스)" 시스템 목록뿐이라,
// 그 항목들만 impact_items.company_id로 어느 계열사 전용인지 표시한다. 예전 스키마로 이미 생성된 DB 파일을
// 위한 1회성 이관 로직 — code별로 가장 먼저 만들어진 행 하나만 "공통" 대표로 남기고 나머지는 병합/삭제한다.
function migrateImpactCriteriaToShared(db: Database.Database) {
  const categoryColumns = db.prepare('PRAGMA table_info(impact_categories)').all() as Array<{ name: string }>;
  const categoriesHaveCompanyId = categoryColumns.some((c) => c.name === 'company_id');
  const itemColumns = db.prepare('PRAGMA table_info(impact_items)').all() as Array<{ name: string }>;
  const itemsHaveCompanyId = itemColumns.some((c) => c.name === 'company_id');

  if (!categoriesHaveCompanyId && itemsHaveCompanyId) return; // 이미 이관 완료

  // impact_categories를 리네임하면 SQLite가 impact_subcategories의 FK 정의를 자동으로 새 이름으로 고쳐 쓰기 때문에,
  // 그 상태에서 impact_categories_old를 DROP하면 FK 제약 위반이 난다. PRAGMA는 트랜잭션 밖에서만 바꿀 수 있으므로
  // 마이그레이션 전체를 감싸 잠시 꺼둔다.
  const foreignKeysWereOn = (db.pragma('foreign_keys', { simple: true }) as number) === 1;
  if (foreignKeysWereOn) db.pragma('foreign_keys = OFF');

  type OldCategory = { id: number; company_id: number | null; name: string; code: string; weight: number; display_order: number };
  type OldSubcategory = {
    id: number;
    category_id: number;
    name: string;
    code: string;
    weight: number;
    selection_type: string;
    display_order: number;
  };

  const migrate = db.transaction(() => {
    const categories: OldCategory[] = categoriesHaveCompanyId
      ? (db.prepare('SELECT id, company_id, name, code, weight, display_order FROM impact_categories ORDER BY id ASC').all() as OldCategory[])
      : (db.prepare('SELECT id, name, code, weight, display_order FROM impact_categories ORDER BY id ASC').all() as Array<Omit<OldCategory, 'company_id'>>).map(
          (c) => ({ ...c, company_id: null }),
        );

    // code별 대표(가장 먼저 만들어진) 카테고리 id, 그리고 각 카테고리가 원래 어느 계열사 소속이었는지 기록해둔다.
    const survivorCategoryIdByCode = new Map<string, number>();
    const categoryIdToSurvivorId = new Map<number, number>();
    const categoryIdToOriginalCompanyId = new Map<number, number | null>();
    for (const cat of categories) {
      categoryIdToOriginalCompanyId.set(cat.id, cat.company_id);
      if (!survivorCategoryIdByCode.has(cat.code)) survivorCategoryIdByCode.set(cat.code, cat.id);
      categoryIdToSurvivorId.set(cat.id, survivorCategoryIdByCode.get(cat.code)!);
    }

    const subcategories = db
      .prepare('SELECT id, category_id, name, code, weight, selection_type, display_order FROM impact_subcategories ORDER BY id ASC')
      .all() as OldSubcategory[];

    // (대표 카테고리 id, code) 조합별 대표 중분류 하나만 남긴다.
    const survivorSubIdByKey = new Map<string, number>();
    const subIdToSurvivorId = new Map<number, number>();
    const subIdToOriginalCompanyId = new Map<number, number | null>();
    for (const sub of subcategories) {
      const survivorCategoryId = categoryIdToSurvivorId.get(sub.category_id) ?? sub.category_id;
      const key = `${survivorCategoryId}:${sub.code}`;
      subIdToOriginalCompanyId.set(sub.id, categoryIdToOriginalCompanyId.get(sub.category_id) ?? null);
      if (!survivorSubIdByKey.has(key)) survivorSubIdByKey.set(key, sub.id);
      subIdToSurvivorId.set(sub.id, survivorSubIdByKey.get(key)!);
    }

    if (!itemsHaveCompanyId) {
      db.exec('ALTER TABLE impact_items ADD COLUMN company_id INTEGER REFERENCES companies(id)');
    }

    // 항목 이관: "대상(업무서비스)"(target_systems) 항목은 원래 계열사 id를 company_id로 붙여 대표 중분류로 옮긴다.
    // 그 외(공통이어야 할) 항목은 대표 중분류 소속이면 company_id=NULL로 남기고, 대표가 아닌 중복 중분류 소속이면 버린다.
    const items = db.prepare('SELECT id, subcategory_id FROM impact_items').all() as Array<{ id: number; subcategory_id: number }>;
    const subcategoryById = new Map(subcategories.map((s) => [s.id, s]));
    for (const item of items) {
      const sub = subcategoryById.get(item.subcategory_id);
      if (!sub) continue;
      const survivorSubId = subIdToSurvivorId.get(sub.id) ?? sub.id;
      if (sub.code === 'target_systems') {
        const originalCompanyId = subIdToOriginalCompanyId.get(sub.id) ?? null;
        db.prepare('UPDATE impact_items SET subcategory_id = ?, company_id = ? WHERE id = ?').run(survivorSubId, originalCompanyId, item.id);
      } else if (survivorSubId === sub.id) {
        db.prepare('UPDATE impact_items SET company_id = NULL WHERE id = ?').run(item.id);
      } else {
        db.prepare('DELETE FROM impact_items WHERE id = ?').run(item.id);
      }
    }

    // 대표가 아닌 중복 중분류 삭제, 대표 중분류는 대표 카테고리를 가리키도록 갱신.
    for (const sub of subcategories) {
      const survivorSubId = subIdToSurvivorId.get(sub.id) ?? sub.id;
      if (survivorSubId !== sub.id) {
        db.prepare('DELETE FROM impact_subcategories WHERE id = ?').run(sub.id);
        continue;
      }
      const survivorCategoryId = categoryIdToSurvivorId.get(sub.category_id) ?? sub.category_id;
      if (survivorCategoryId !== sub.category_id) {
        db.prepare('UPDATE impact_subcategories SET category_id = ? WHERE id = ?').run(survivorCategoryId, sub.id);
      }
    }

    if (categoriesHaveCompanyId) {
      for (const cat of categories) {
        if ((categoryIdToSurvivorId.get(cat.id) ?? cat.id) !== cat.id) {
          db.prepare('DELETE FROM impact_categories WHERE id = ?').run(cat.id);
        }
      }
      db.exec('ALTER TABLE impact_categories RENAME TO impact_categories_old');
      db.exec(`
        CREATE TABLE impact_categories (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          code TEXT NOT NULL,
          weight REAL NOT NULL,
          display_order INTEGER NOT NULL DEFAULT 0
        )
      `);
      const survivors = db.prepare('SELECT id, name, code, weight, display_order FROM impact_categories_old').all();
      const insertCategory = db.prepare(
        'INSERT INTO impact_categories (id, name, code, weight, display_order) VALUES (@id, @name, @code, @weight, @display_order)',
      );
      for (const row of survivors) insertCategory.run(row as Record<string, unknown>);
      db.exec('DROP TABLE impact_categories_old');
    }
  });

  try {
    migrate();
  } finally {
    if (foreignKeysWereOn) db.pragma('foreign_keys = ON');
  }
}

function seedImpactCriteria(db: Database.Database) {
  const existing = db.prepare('SELECT id FROM companies WHERE name = ?').get('유진기업') as
    | { id: number }
    | undefined;
  if (existing) return;

  const insertCompany = db.prepare('INSERT INTO companies (name) VALUES (?)');
  const insertCategory = db.prepare(
    `INSERT INTO impact_categories (name, code, weight, display_order)
     VALUES (@name, @code, @weight, @display_order)`,
  );
  const insertSubcategory = db.prepare(
    `INSERT INTO impact_subcategories (category_id, name, code, weight, selection_type, display_order)
     VALUES (@category_id, @name, @code, @weight, @selection_type, @display_order)`,
  );
  const insertItem = db.prepare(
    `INSERT INTO impact_items (subcategory_id, company_id, name, value, group_name, display_order, min_value, max_value)
     VALUES (@subcategory_id, @company_id, @name, @value, @group_name, @display_order, @min_value, @max_value)`,
  );
  const insertGradeThreshold = db.prepare(
    `INSERT INTO grade_thresholds (grade, min_score, max_score, display_order)
     VALUES (@grade, @min_score, @max_score, @display_order)`,
  );

  const seed = db.transaction(() => {
    const companyId = insertCompany.run('유진기업').lastInsertRowid as number;

    // 대분류/중분류는 모든 계열사 공통이라 계열사 id를 넣지 않는다.
    const businessCategoryId = insertCategory.run({
      name: '비즈니스 영향도',
      code: 'business',
      weight: 0.5,
      display_order: 1,
    }).lastInsertRowid as number;
    const complexityCategoryId = insertCategory.run({
      name: '장애 복잡도',
      code: 'complexity',
      weight: 0.2,
      display_order: 2,
    }).lastInsertRowid as number;
    const customerCategoryId = insertCategory.run({
      name: '고객서비스 영향도',
      code: 'customer',
      weight: 0.3,
      display_order: 3,
    }).lastInsertRowid as number;

    const targetSystemsSubcategoryId = insertSubcategory.run({
      category_id: businessCategoryId,
      name: '대상(업무서비스)',
      code: 'target_systems',
      weight: 1,
      selection_type: 'multiple',
      display_order: 1,
    }).lastInsertRowid as number;
    const failureScopeSubcategoryId = insertSubcategory.run({
      category_id: businessCategoryId,
      name: '서비스 장애 범위 가중치',
      code: 'failure_scope',
      weight: 1, // 가중치 개념이 아니라 비즈니스영향도 소계에 곱해지는 배율로 취급 (계산 로직에서 특별 처리)
      selection_type: 'single',
      display_order: 0, // 비즈니스영향도 안에서 대상(업무서비스)보다 먼저 선택하는 항목이라 순서를 앞에 둔다
    }).lastInsertRowid as number;
    const severitySubcategoryId = insertSubcategory.run({
      category_id: complexityCategoryId,
      name: '장애심각도',
      code: 'severity',
      weight: 0.2,
      selection_type: 'single',
      display_order: 1,
    }).lastInsertRowid as number;
    const accessFailureSubcategoryId = insertSubcategory.run({
      category_id: customerCategoryId,
      name: '접속장애여부',
      code: 'access_failure',
      weight: 0.3,
      selection_type: 'single',
      display_order: 1,
    }).lastInsertRowid as number;
    const responseSpeedSubcategoryId = insertSubcategory.run({
      category_id: customerCategoryId,
      name: '응답속도',
      code: 'response_speed',
      weight: 0.2,
      selection_type: 'single',
      display_order: 2,
    }).lastInsertRowid as number;
    const recurrenceSubcategoryId = insertSubcategory.run({
      category_id: customerCategoryId,
      name: '동일장애재발',
      code: 'recurrence',
      weight: 0.5,
      selection_type: 'single',
      display_order: 3,
    }).lastInsertRowid as number;

    // 아래 항목들(장애복잡도/고객서비스영향도/서비스 장애 범위 가중치)은 모든 계열사 공통이라 company_id를 null로 둔다.
    insertItem.run({ subcategory_id: severitySubcategoryId, company_id: null, name: '단순장애', value: 0.2, group_name: null, display_order: 1, min_value: null, max_value: null });
    insertItem.run({ subcategory_id: severitySubcategoryId, company_id: null, name: '복잡장애', value: 0.8, group_name: null, display_order: 2, min_value: null, max_value: null });

    insertItem.run({ subcategory_id: accessFailureSubcategoryId, company_id: null, name: '있음', value: 0.8, group_name: null, display_order: 1, min_value: null, max_value: null });
    insertItem.run({ subcategory_id: accessFailureSubcategoryId, company_id: null, name: '없음', value: 0.2, group_name: null, display_order: 2, min_value: null, max_value: null });

    insertItem.run({ subcategory_id: responseSpeedSubcategoryId, company_id: null, name: '있음(성능불만)', value: 0.8, group_name: null, display_order: 1, min_value: null, max_value: null });
    insertItem.run({ subcategory_id: responseSpeedSubcategoryId, company_id: null, name: '없음', value: 0.2, group_name: null, display_order: 2, min_value: null, max_value: null });

    insertItem.run({ subcategory_id: recurrenceSubcategoryId, company_id: null, name: '있음', value: 0.8, group_name: null, display_order: 1, min_value: null, max_value: null });
    insertItem.run({ subcategory_id: recurrenceSubcategoryId, company_id: null, name: '없음', value: 0.2, group_name: null, display_order: 2, min_value: null, max_value: null });

    // 전사: 고정값(100%), 입력 없음. 일부: 산정 시점에 10~50% 사이 값을 직접 입력해야 함 (value는 화면 표시용 기본값). 공통.
    insertItem.run({ subcategory_id: failureScopeSubcategoryId, company_id: null, name: '전사', value: 1, group_name: null, display_order: 1, min_value: null, max_value: null });
    insertItem.run({ subcategory_id: failureScopeSubcategoryId, company_id: null, name: '일부', value: 0.3, group_name: null, display_order: 2, min_value: 0.1, max_value: 0.5 });

    const targetSystems: Array<{ name: string; value: number; group_name: string }> = [
      { name: 'HR(인사)', value: 0.2, group_name: 'ERP' },
      { name: 'BC(공통)', value: 0.9, group_name: 'ERP' },
      { name: 'CO(관리)', value: 0.2, group_name: 'ERP' },
      { name: 'FI(재무)', value: 0.5, group_name: 'ERP' },
      { name: 'MM(구매)', value: 0.7, group_name: 'ERP' },
      { name: 'PP(생산)', value: 0.5, group_name: 'ERP' },
      { name: 'SD(영업)', value: 1, group_name: 'ERP' },
      { name: 'TR(자금)-펌뱅킹', value: 0.4, group_name: 'ERP' },
      { name: 'e-HR', value: 0.2, group_name: '유관시스템' },
      { name: 'ez_A', value: 0.1, group_name: '유관시스템' },
      { name: '통합구매(EUPROS)', value: 0.7, group_name: '유관시스템' },
      { name: '생산관리', value: 1, group_name: 'EURAS' },
      { name: '출하관리', value: 1, group_name: 'EURAS' },
      { name: '품질관리', value: 1, group_name: 'EURAS' },
      { name: '차량관제', value: 0.5, group_name: 'EURAS' },
      { name: '수주영업', value: 0.7, group_name: '영업관리' },
      { name: '건자재영업(EUMAS)', value: 0.7, group_name: '영업관리' },
      { name: '영업모바일', value: 0.7, group_name: '영업관리' },
      { name: '콘라이브', value: 0.8, group_name: '콘라이브' },
      { name: 'EAI', value: 0.7, group_name: '기타' },
      { name: 'Smart Bill 등', value: 0.2, group_name: '기타' },
    ];
    // "대상(업무서비스)" 시스템 목록만 계열사 전용이라 company_id를 채운다.
    targetSystems.forEach((system, index) => {
      insertItem.run({
        subcategory_id: targetSystemsSubcategoryId,
        company_id: companyId,
        name: system.name,
        value: system.value,
        group_name: system.group_name,
        display_order: index + 1,
        min_value: null,
        max_value: null,
      });
    });

    insertGradeThreshold.run({ grade: '1등급', min_score: 0.8, max_score: null, display_order: 1 });
    insertGradeThreshold.run({ grade: '2등급', min_score: 0.7, max_score: 0.8, display_order: 2 });
    insertGradeThreshold.run({ grade: '3등급', min_score: 0.5, max_score: 0.7, display_order: 3 });
    insertGradeThreshold.run({ grade: '등급외', min_score: 0, max_score: 0.5, display_order: 4 });
  });

  seed();
}

// incident_logs: 엑셀로 수기 관리해온 과거 장애 이력 원본을 최초 1회만 적재하는 시드.
// 필드 순서: occurred_date, team_name, incident_type, company_name, description, action_taken,
// cause_source, cause_type, has_redundancy, service_outage, outage_scope, grade, occurred_time,
// resolved_time, duration, duration_category, has_report, note
function seedIncidentLogs(db: Database.Database) {
  const { count } = db.prepare('SELECT COUNT(*) AS count FROM incident_logs').get() as { count: number };
  if (count > 0) return;

  const rows: string[][] = [
    ['2023-01-02', 'TECH팀', '네트워크', '동양', '[동양] 경남지역 KT 지사 전체 장애로 인한 네트워크 단절', 'KT측 경남국사 장애', '외부', '회선', 'O', 'O', '1', '등급외', '16:00', '17:10', '1:10', '3: 1~2시간', '', '외부요인(통신사)에 의한 업무서비스 중단'],
    ['2023-01-10', 'TECH팀', '스토리지', '유진기업', '유진기업 VSP 통합스토리지 Disk HDD003-0F 장애', '디스크 교체', '내부', 'HW', 'O', 'X', '', '등급외', '', '1:00', '1:00', '3: 1~2시간', '', 'Spare Disk로 자동복구,  긴급조치 불필요, 조치시간만 작성'],
    ['2023-01-10', 'TECH팀', '네트워크', '동양', '[동양] 예산공장 KT 인터넷 회선 장애', 'KT측 장애처리', '외부', '회선', 'O', 'X', '', '등급외', '14:00', '17:30', '3:30', '4: 2~4시간', '', ''],
    ['2023-01-16', 'TECH팀', '네트워크', '유진한일합섬', '[한일합섬] 의령공장 KT 인터넷 회선 장애', 'KT측 장애처리', '외부', '회선', 'O', 'X', '', '등급외', '9:00', '10:00', '1:00', '2: 30분~1시간', '', ''],
    ['2023-01-25', 'TECH팀', '서버', '유진로지스틱스', '유진로지스틱스 Ubireport 이미지 변환 서비스 장애', '이미지변환 서비스 재기동', '외부', 'APP', 'O', 'O', '', '등급외', '9:30', '10:00', '0:30', '1: 30분이내', '', '해당서비스만 업무중단'],
    ['2023-01-30', 'TECH팀', '서버', '유진기업', '유진그룹 메신저2(DOMSG) 서버 Disk Slot0 장애', '디스크 교체', '내부', 'HW', 'O', 'X', '', '등급외', '', '1:00', '1:00', '2: 30분~1시간', '', 'Raid 구성으로 Disk 정상동작,  긴급조치 불필요, 조치시간만 작성'],
    ['2023-02-02', 'TECH팀', '네트워크', '유진기업', '[유진기업] 사무국 불특정 사용자 무선AP 네트워크 지연', '해당 무선AP 리부팅', '내부', 'HW', 'O', 'X', '', '등급외', '14:00', '15:30', '1:30', '3: 1~2시간', '', ''],
    ['2023-02-06', 'TECH팀', '서버', '유진기업', '유진기업 IBM Unix 통합서버#1 P770 I/O Drawer 파워 장애', 'I/O Drawer 파워 부품 교체', '내부', 'HW', 'O', 'X', '', '등급외', '', '2:00', '2:00', '3: 1~2시간', '', '부품 이중화 긴급조치 불필요, 조치시간만 작성'],
    ['2023-02-06', 'TECH팀', '네트워크', '유진자산운용', '[유진자산운용] 방화벽 엔지니어 원격 점검시 장애 발생', '1호기를 마스터 정비로 수동 전환', '내부', 'HW', 'O', 'O', '', '2등급', '10:13', '10:51', '0:38', '2: 30분~1시간', '', 'HA 구성 변경이 필요하여 조치 취함 (패치 오류로 발생)'],
    ['2023-02-07', 'TECH팀', '서버', '유진로지스틱스', '유진로지스틱스 Fax 이미지전송 PDF 변환 서비스 장애', 'FaxClient 서비스 재기동', '내부', 'APP', 'O', 'O', '', '등급외', '10:30', '11:00', '0:30', '1: 30분이내', '', '해당서비스만 업무중단'],
    ['2023-02-15', 'TECH팀', '네트워크', '동양', '[동양] 본사 KT 인터넷 회선', 'KT측 장애처리', '외부', '회선', 'O', 'X', '', '등급외', '9:10', '10:00', '0:50', '2: 30분~1시간', '', ''],
    ['2023-02-21', 'TECH팀', '서버', '유진기업', '유진기업 EGWRA(폐레미콘원격제어)서버 RDP Hang 장애', '서버 리부팅', '내부', 'HW', 'X', 'O', '', '등급외', '14:30', '15:00', '0:30', '1: 30분이내', '', ''],
    ['2023-03-12', 'TECH팀', 'Cloud', '유진홈센터', 'acem-dev-was(10.41.28.243) 물리서버 인프라 문제로 인한 장애 발생', 'HA(Live Migration, 자동 이관 복구), 개발서버', '외부', 'HW', 'X', 'X', '', '등급외', '19:02', '19:18', '0:16', '1: 30분이내', '', '개발서버로 운영업무 서비스 중단없음, CSP에서 자동복구'],
    ['2023-03-15', 'TECH팀', '스토리지', '동양', '동양 XP20000 통합스토리지 Disk HDD11-0D 장애', '디스크 교체', '내부', 'HW', 'O', 'X', '', '등급외', '', '1:00', '1:00', '2: 30분~1시간', '', 'Spare Disk로 자동복구,  긴급조치 불필요, 조치시간만 작성'],
    ['2023-03-16', 'TECH팀', '서버', '동양', '동양 tyrasdb1(통합DB#1) 다운 장애', '서버 리부팅 (커널 메모리 Fault)', '내부', 'HW', 'O', 'X', '', '등급외', '', '1:00', '1:00', '2: 30분~1시간', '', '휴일장애, 이중화 구성으로 업무서비스 영향 없음'],
    ['2023-03-17', 'TECH팀', '스토리지', '동양', '동양 XP20000 통합스토리지 Disk HDD13-04 장애', '디스크 교체', '내부', 'HW', 'O', 'X', '', '등급외', '', '1:00', '1:00', '2: 30분~1시간', '', 'Spare Disk로 자동복구,  긴급조치 불필요, 조치시간만 작성'],
    ['2023-03-20', 'TECH팀', '서버', '유진로지스틱스', '유진로지스틱스 EULOS서비스 장애', 'EULOS 서비스 재기동', '내부', 'APP', 'O', 'O', '', '등급외', '8:30', '9:00', '0:30', '1: 30분이내', '', '해당서비스만 업무중단'],
    ['2023-03-24', 'TECH팀', '서버', '유진기업', '유진기업 IBM Unix 통합서버 관리 HMC#3 Disk Slot0 장애', '디스크 교체', '내부', 'HW', 'O', 'X', '', '등급외', '', '1:00', '1:00', '2: 30분~1시간', '', 'Raid 구성으로 Disk 정상동작,  긴급조치 불필요, 조치시간만 작성'],
    ['2023-03-25', 'TECH팀', '서버', '유진로지스틱스', '유진로지스틱스 klosdb01서버 Disk Slot0 장애', '디스크 교체', '내부', 'HW', 'O', 'X', '', '등급외', '', '1:00', '1:00', '2: 30분~1시간', '', 'Raid 구성으로 Disk 정상동작,  긴급조치 불필요, 조치시간만 작성'],
    ['2023-03-29', 'TECH팀', '서버', '유진로지스틱스', '유진로지스틱스 KLWMS 서비스 장애', 'KLWMS 서비스 재기동', '내부', 'APP', 'O', 'O', '', '등급외', '11:00', '11:30', '0:30', '1: 30분이내', '', '해당서비스만 업무중단'],
    ['2023-04-04', 'TECH팀', '스토리지', '유진기업', '유진기업 VSP 통합스토리지 Disk HDD015-00 장애', '디스크 교체', '내부', 'HW', 'O', 'X', '', '등급외', '', '1:00', '1:00', '2: 30분~1시간', '', 'Spare Disk로 자동복구,  긴급조치 불필요, 조치시간만 작성'],
    ['2023-04-04', 'TECH팀', '스토리지', '유진기업', '유진기업 VSP 통합스토리지 Disk HDD014-03 장애', '디스크 교체', '내부', 'HW', 'O', 'X', '', '등급외', '', '1:00', '1:00', '2: 30분~1시간', '', 'Spare Disk로 자동복구,  긴급조치 불필요, 조치시간만 작성'],
    ['2023-04-04', 'TECH팀', '서버', '동양', '동양 tyetax 서버 Disk Slot1 장애', '디스크 교체', '내부', 'HW', 'O', 'X', '', '등급외', '', '1:00', '1:00', '2: 30분~1시간', '', 'Raid 구성으로 Disk 정상동작,  긴급조치 불필요, 조치시간만 작성'],
    ['2023-04-12', 'TECH팀', '서버', '동양', '동양 HP Unix 통합서버#2 CPU FAN 장애', 'CPU FAN 교체', '내부', 'HW', 'O', 'X', '', '등급외', '16:00', '19:00', '4:00', '4: 2~4시간', '', '서버 오프라인 교체 필요, 업무 종료 후 19:00 교체 작업 진행'],
    ['2023-04-12', 'TECH팀', '서버', '동양', '동양 HP Unix 통합서버#2 Disk 확장컨트롤러 파워 모듈 장애', 'Disk 확장컨트롤러 파워 모듈 교체', '내부', 'HW', 'O', 'X', '', '등급외', '19:30', '22:30', '3:00', '4: 2~4시간', '', 'CPU FAN교체 진행 후 추가 장애'],
    ['2023-05-09', 'TECH팀', '스토리지', '유진기업', '유진기업 VSP 통합스토리지 Disk HDD006-0F 장애', '디스크 교체', '내부', 'HW', 'O', 'X', '', '등급외', '', '1:00', '1:00', '2: 30분~1시간', '', 'Spare Disk로 자동복구,  긴급조치 불필요, 조치시간만 작성'],
    ['2023-05-10', 'TECH팀', '서버', '유진로지스틱스', '유진로지스틱스 KLWMS 서비스 장애', 'KLWMS 서비스 재기동', '내부', 'HW', 'O', 'X', '', '등급외', '16:00', '16:30', '0:30', '1: 30분이내', '', '해당서비스만 업무중단'],
    ['2023-05-29', 'TECH팀', 'DB', '대외', '[한국초저온] 통합관제  MS-SQL 데이터베이스 장애\n- 메모리내 엑세스 위반으로 발생 추정\n- 에러 로그 : c0000005 EXCEPTION_ACCESS_VIOLATION', 'DB인스턴스 재기동', '내부', 'DB', 'X', 'O', '', '등급외', '8:30', '10:20', '1:50', '3: 1~2시간', '', '통합관제업무 서비스만 중단, 일반업무는 정상서비스\nDB담당자 대체 휴뮤일로 장애처리 지연'],
    ['2023-06-15', 'TECH팀', '서버', '유진로지스틱스', '유진로지스틱스 EULOS 서비스 장애', 'EULOS 서비스 재기동', '내부', 'APP', 'O', 'O', '', '등급외', '9:00', '9:30', '0:30', '1: 30분이내', '', '해당서비스만 업무중단'],
    ['2023-06-15', 'TECH팀', '네트워크', '동양', '[동양] 서부산 출하실 KT 인터넷 회선 장애', 'KT측 장애처리', '외부', '회선', 'X', 'O', '', '등급외', '14:00', '16:40', '2:40', '4: 2~4시간', '', ''],
    ['2023-06-21', 'TECH팀', '스토리지', '유진기업', '유진기업 VSP 통합스토리지 Disk HDD016-02 장애', '디스크 교체', '내부', 'HW', 'O', 'X', '', '등급외', '', '1:00', '1:00', '2: 30분~1시간', '', 'Spare Disk로 자동복구,  긴급조치 불필요, 조치시간만 작성'],
    ['2023-06-25', 'TECH팀', '서버', '유진자산운용', '유진자산운용 메일메신저모니터링 서버 네트워크 장애', '네트워크 케이블 불량에 따른 교체', '내부', 'HW', 'X', 'X', '', '등급외', '8:00', '11:00', '3:00', '4: 2~4시간', '', '휴일장애'],
    ['2023-06-26', 'TECH팀', '스토리지', '유진기업', '유진그룹 그룹웨어 스토리지 Disk Slot11 장애', '디스크 교체', '내부', 'HW', 'O', 'X', '', '등급외', '', '1:00', '1:00', '2: 30분~1시간', '', 'Spare Disk로 자동복구,  긴급조치 불필요, 조치시간만 작성'],
    ['2023-06-28', 'TECH팀', '서버', '대외', '메이필드 mf api서버 서버 다운 장애', '서버 리부팅 (메모리 Crash)', '내부', 'HW', 'X', 'O', '', '3등급', '13:00', '13:30', '0:30', '1: 30분이내', '', '메이플호텔: ap서버 active-standby 로 이중화 되어 있는데 업무 서비스가 1번 서버에서만 가동되는 서비스가 있어서 장애가 남 (서버사 hang-up 상태라 ping에 이상이 없어 모니터링에 이상징후가 없었음 – 재기동함)'],
    ['2023-06-29', 'TECH팀', '서버', '유진기업', '유진기업 IBM Unix 통합서버#1 FSP I/O드로어 연결 부품 장애', 'FSP I/O Drawer 부품 교체', '내부', 'HW', 'O', 'X', '', '등급외', '16:00', '21:00', '5:00', '5: 4시간 이상', '', '서버 오프라인 교체 필요, 업무 종료 후 20:00 교체 작업 진행'],
    ['2023-07-03', 'TECH팀', '서버', '동양', '동양 tyetax서버 Raid Controller Cache Battery 장애', '장애 부품 교체', '내부', 'HW', 'X', 'O', '', '등급외', '', '1:00', '1:00', '2: 30분~1시간', '', '긴급조치 불필요, 조치시간만 작성'],
    ['2023-07-03', 'TECH팀', '네트워크', '동양', '[동양] 전주공장 출하실 KT 인터넷 회선 장애', 'KT측 장애처리', '외부', '회선', 'O', 'X', '', '등급외', '9:30', '16:00', '6:30', '5: 4시간 이상', '', ''],
    ['2023-07-12', 'TECH팀', '서버', '대외', '메이필드 mferpap2 서버 다운 장애', '서버 리부팅 (메모리 Crash)', '내부', 'HW', 'O', 'X', '', '등급외', '16:00', '16:30', '0:30', '1: 30분이내', '', ''],
    ['2023-07-13', 'TECH팀', 'Cloud', '유진홈센터', 'eghc-was-1(10.41.143.29) 물리서버 인프라 문제로 인한 장애 발생', 'HA(Live Migration, 자동 이관 복구)', '외부', 'HW', 'O', 'X', '', '등급외', '13:08', '13:29', '0:21', '1: 30분이내', '', 'CSP에서 자동복구'],
    ['2023-07-21', 'TECH팀', '스토리지', '유진기업', '유진기업 VSP 통합스토리지 Disk HDD010-05 장애', '디스크 교체', '내부', 'HW', 'O', 'X', '', '등급외', '', '1:00', '1:00', '2: 30분~1시간', '', 'Spare Disk로 자동복구,  긴급조치 불필요, 조치시간만 작성'],
    ['2023-07-24', 'TECH팀', '스토리지', '동양', '동양 XP20000 통합스토리지 Disk HDD12-03 장애', '디스크 교체', '내부', 'HW', 'O', 'X', '', '등급외', '', '1:00', '1:00', '2: 30분~1시간', '', 'Spare Disk로 자동복구,  긴급조치 불필요, 조치시간만 작성'],
    ['2023-08-04', 'TECH팀', '네트워크', '동양', '[동양] 부산공장 KT 인터넷 회선 장애', 'KT측 장애처리', '외부', '회선', 'O', 'X', '', '등급외', '9:30', '16:00', '6:30', '5: 4시간 이상', '', ''],
    ['2023-08-06', 'TECH팀', '서버', '동양', '동양 tyerpdb1서버 CPU Cell 인식오류 다운 장애', 'Cell 인식 오류 Partition 수동 reset 후 재기동', '내부', 'HW', 'O', 'X', '', '등급외', '11:00', '17:00', '6:00', '5: 4시간 이상', '0', 'Partition된 4개 서버 재기동 (휴일장애)'],
    ['2023-08-06', 'TECH팀', 'DB', '동양', '[동양] ERP ( TYERPDB1) 서버 OS 다운으로 오라클 데이터베이스 장애', '서버 리부팅 후 DB서비스 재기동', '내부', 'HW', 'O', 'X', '', '등급외', '13:30', '15:31', '2:01', '4: 2~4시간', '', '휴일(일요일) 장애로 서비스 사용자 없었음\n- 이중화 구성(DB RAC구성)으로 서비스중단 없음'],
    ['2023-08-11', 'TECH팀', '서버', '동양', '동양 tysangi 서버 Disk Slot0 장애', '디스크 교체', '내부', 'HW', 'O', 'X', '', '등급외', '', '1:00', '1:00', '2: 30분~1시간', '', 'Raid 구성으로 Disk 정상동작,  긴급조치 불필요, 조치시간만 작성'],
    ['2023-08-31', 'TECH팀', '네트워크', '동양', '[동양] IDC SSL_VPN 장비 장애', '해당 장비 리부팅', '내부', 'HW', 'X', 'O', '', '등급외', '9:30', '11:30', '2:00', '4: 2~4시간', '', '특이사항 없음'],
    ['2023-09-01', 'TECH팀', '네트워크', '동양', '[동양] 김해공장 KT 인터넷 2회선 장애', 'KT측 장애처리', '외부', '회선', 'O', 'O', '', '등급외', '09-01(금)', '09-05(월)', '4일', '4: 2~4시간', '', 'KT 인입선로 단절로 KT 라인 모두단절'],
    ['2023-09-05', 'TECH팀', '네트워크', '유진기업', '[유진기업] 파크원 빌딩 23F 무선AP#2 지연장애', '해당 장비 리부팅', '내부', 'HW', 'O', 'X', '', '등급외', '10:30', '11:30', '1:00', '2: 30분~1시간', '', ''],
    ['2023-09-07', 'TECH팀', 'Cloud', '유진홈센터', 'acem-search-server-1(10.33.145.147) 물리서버 인프라 문제로 인한 장애 발생', 'HA(Live Migration, 자동 이관 복구)', '외부', 'HW', 'O', 'X', '', '등급외', '21:14', '21:15', '0:01', '1: 30분이내', '', 'CSP에서 자동복구'],
    ['2023-09-19', 'TECH팀', '스토리지', '유진자산운용', '유진자산운용 BSS개발서버 스토리지 파워 장애', '파워 교체', '내부', 'HW', 'O', 'X', '', '등급외', '', '1:00', '1:00', '2: 30분~1시간', '', '부품 이중화 긴급조치 불필요, 조치시간만 작성'],
    ['2023-09-20', 'TECH팀', '스토리지', '유진기업', '유진기업 VSP 통합스토리지 Disk HDD001-0C 장애', '디스크 교체', '내부', 'HW', 'O', 'X', '', '등급외', '', '1:00', '1:00', '2: 30분~1시간', '', 'Spare Disk로 자동복구,  긴급조치 불필요, 조치시간만 작성'],
    ['2023-09-06', 'TECH팀', 'Cloud', '대외', 'pseng-webwas1(10.41.43.135) 물리서버 인프라 문제로 인한 장애 발생', 'HA(Live Migration, 자동 이관 복구)', '외부', 'HW', 'X', 'X', '', '등급외', '2:00', '2:02', '0:02', '1: 30분이내', '', '대외 (장애 공지), CSP에서 자동복구'],
    ['2023-10-04', 'TECH팀', '스토리지', '유진기업', '유진기업 가상화 스토리지 Disk Slot6 장애', '디스크 교체', '내부', 'HW', 'O', 'X', '', '등급외', '', '1:00', '1:00', '2: 30분~1시간', '', 'Spare Disk로 자동복구,  긴급조치 불필요, 조치시간만 작성'],
    ['2023-10-17', 'TECH팀', 'Cloud', '대외', 'valmax-app(10.41.173.46) 물리서버 인프라 문제로 인한 장애 발생', 'HA(Live Migration, 자동 이관 복구)', '외부', 'HW', 'X', 'X', '', '등급외', '13:00', '13:16', '0:16', '1: 30분이내', '', '대외 (장애 공지), CSP에서 자동복구'],
    ['2023-10-17', 'TECH팀', 'Cloud', '유진홈센터', 'acem-search-server-1(10.41.173.118) 물리서버 인프라 문제로 인한 장애 발생', 'HA(Live Migration, 자동 이관 복구)', '외부', 'HW', 'O', 'X', '', '등급외', '13:00', '13:16', '0:16', '1: 30분이내', '', 'CSP에서 자동복구'],
    ['2023-10-18', 'TECH팀', '스토리지', '유진기업', '유진기업 VSP 통합스토리지 Disk HDD003-0D 장애', '디스크 교체', '내부', 'HW', 'O', 'X', '', '등급외', '', '1:00', '1:00', '2: 30분~1시간', '', 'Spare Disk로 자동복구,  긴급조치 불필요, 조치시간만 작성'],
    ['2023-11-03', 'TECH팀', '서버', '동양', '동양 sqlserver 서버 Disk Slot3 장애', '디스크 교체', '내부', 'HW', 'O', 'X', '', '등급외', '', '1:00', '1:00', '2: 30분~1시간', '', 'Raid 구성으로 Disk 정상동작,  긴급조치 불필요, 조치시간만 작성'],
    ['2023-11-15', 'TECH팀', '서버', '유진기업', '유진기업 egyeta서버 연말정산 서비스 장애', 'Yeta 서비스 Tomcat 기동', '내부', 'APP', 'O', 'O', '', '등급외', '8:30', '9:00', '0:30', '1: 30분이내', '', '연말정산기간에만 사용'],
    ['2023-11-21', 'TECH팀', 'Cloud', '유진홈센터', 'eghc-was-2(10.41.141.52) 물리서버 인프라 문제로 인한 장애 발생', 'HA(Live Migration, 자동 이관 복구)', '외부', 'HW', 'O', 'X', '', '등급외', '4:19', '4:21', '0:02', '1: 30분이내', '', '업무시간 외, CSP에서 자동복구'],
    ['2023-11-30', 'TECH팀', 'Cloud', '유진홈센터', 'eghc-redis(10.41.9.112) 물리서버 인프라 문제로 인한 장애 발생', 'HA Standby 자동 기동', '외부', 'HW', 'O', 'X', '', '등급외', '0:00', '0:00', '0:00', '1: 30분이내', '', 'Cloud for Redis ,CSP에서 자동복구'],
    ['2023-12-11', 'TECH팀', '서버', '동양', '동양 admin(문서변환)서버 다운 장애, Rebooting 불가', '서버 교체 및 백업본이용 복구', '내부', 'HW', 'X', 'X', '', '등급외', '7:00', '11월 13일', '3일', '4: 2~4시간', '0', '장애 조치 후 재장애 발생 등으로 인한 3일간 장애 조치'],
    ['2023-12-11', 'TECH팀', '네트워크', '동양', '[동양] 서부산출하실 KT 인터넷 회선 장애', 'KT측 장애처리', '외부', '회선', 'X', 'O', '', '등급외', '9:30', '14:00', '4:30', '5: 4시간 이상', '', ''],
    ['2023-12-11', 'TECH팀', '네트워크', '동양', '[동양] 안양공장 KT 인터넷 회선 장애', 'KT측 장애처리', '외부', '회선', 'O', 'X', '', '등급외', '9:00', '16:00', '7:00', '5: 4시간 이상', '', ''],
    ['2023-12-12', 'TECH팀', '스토리지', '유진기업', '유진그룹 그룹웨어 스토리지 Disk Slot6 장애', '디스크 교체', '내부', 'HW', 'O', 'X', '', '등급외', '', '1:00', '1:00', '2: 30분~1시간', '', 'Spare Disk로 자동복구,  긴급조치 불필요, 조치시간만 작성'],
    ['2023-12-15', 'TECH팀', '스토리지', '동양', '동양 XP20000 통합스토리지 Disk HDD10-0D 장애', '디스크 교체', '내부', 'HW', 'O', 'X', '', '등급외', '', '1:00', '1:00', '2: 30분~1시간', '', 'Spare Disk로 자동복구,  긴급조치 불필요, 조치시간만 작성'],
    ['2023-12-18', 'TECH팀', '네트워크', '유진기업', '[유진기업] 남양주공장 인터넷 회선 장애', 'LG측 장애처리', '외부', '회선', 'O', 'X', '', '등급외', '9:00', '11:30', '2:30', '4: 2~4시간', '', ''],
    ['2023-12-27', 'TECH팀', '서버', '유진로지스틱스', '유진로지스틱스 WMS인터페이스서버 Oracle 장애', 'Oracle 재기동', '내부', 'DB', 'X', 'O', '', '등급외', '2:00', '3:00', '1:00', '2: 30분~1시간', '', ''],
    ['2023-12-28', 'TECH팀', '네트워크', '동양', '[동양] 김해공장 KT 인터넷 장애', 'KT측 장애처리', '외부', '회선', 'O', 'X', '', '등급외', '9:00', '16:00', '7:00', '5: 4시간 이상', '', ''],
    ['2024-01-08', 'TECH팀', '서버', '유진자산운용', '유진자산운용 msgsvr_new서버 네트워크 장애', '네트워크 케이블 교체', '내부', 'HW', 'X', 'O', '', '등급외', '8:00', '12:00', '4:00', '4: 2~4시간', '', ''],
    ['2024-01-16', 'TECH팀', '스토리지', '동양', '동양 통합DB Fujitu스토리지 BBU배터리 장애', '배터리 교체', '내부', 'HW', 'O', 'O', '', '3등급', '', '2:00', '2:00', '3: 1~2시간', '', '스토리지에 배터리가 2개 있고 DB서버에서 각각 이중화로 물려 있는데 배터리 교체 작업시 1번 배터리 교체 후 서비스가 다 기동되고 2번 배터리 교체 해야 하는데 기동 전 교체하여 장애'],
    ['2024-01-22', 'TECH팀', '네트워크', '동양', '[동양] 서부산공장 KT 인터넷 회선 장애', 'KT측 장애처리', '외부', '회선', 'O', 'X', '', '등급외', '9:00', '11:30', '2:30', '4: 2~4시간', '', ''],
    ['2024-01-29', 'TECH팀', '서버', '동양', '동양 sqlserver 서버 Disk Slot0 장애', '디스크 교체', '내부', 'HW', 'O', 'X', '', '등급외', '', '1:00', '1:00', '2: 30분~1시간', '', 'Raid 구성으로 Disk 정상동작,  긴급조치 불필요, 조치시간만 작성'],
    ['2024-02-08', 'TECH팀', '네트워크', '유진자산운용', '[유진자산운용] 방화벽 비대칭 트래픽으로 인한 통신 단절', '1호기를 마스터 정비로 수동 전환', '내부', 'HW', 'O', 'O', '', '2등급', '2:41', '8:34', '5:53', '5: 4시간 이상', '', '자산운용-방화벽 : 이중화된 방화벽에 장애가 발생하여 2번 방화벽으로 take over 되었고\n장애난 1번 서버가 정상화 되었는데 2번 서버에서 1번 서버로 재 take over 되지 않아서 장애\n(최초 설치시에 잘못된 설정을 해당 네트워크 구성에 맞게 방화벽 HA 설정 변경)'],
    ['2024-02-14', 'TECH팀', 'Cloud', '유진홈센터', 'acem-dev-was(10.41.28.243) 물리서버 인프라 문제로 인한 장애 발생', 'HA(Live Migration, 자동 이관 복구)', '외부', 'HW', 'X', 'X', '', '등급외', '18:29', '18:33', '0:04', '1: 30분이내', '', '개발서버로 운영업무 서비스 중단없음, CSP에서 자동복구'],
    ['2024-02-20', 'TECH팀', '서버', '유진기업', '유진기업 erpqas서버 Disk Slot0 장애', '디스크 교체', '내부', 'HW', 'O', 'X', '', '등급외', '', '1:00', '1:00', '2: 30분~1시간', '', 'Raid 구성으로 Disk 정상동작,  긴급조치 불필요, 조치시간만 작성'],
    ['2024-02-20', 'TECH팀', '스토리지', '유진기업', '유진그룹 그룹웨어 스토리지 Disk Slot8 장애', '디스크 교체', '내부', 'HW', 'O', 'X', '', '등급외', '', '1:00', '1:00', '2: 30분~1시간', '', 'Spare Disk로 자동복구,  긴급조치 불필요, 조치시간만 작성'],
    ['2024-02-26', 'TECH팀', '스토리지', '유진기업', '유진기업 VSP 통합스토리지 Disk HDD010-01 장애', '디스크 교체', '내부', 'HW', 'O', 'X', '', '등급외', '', '1:00', '1:00', '2: 30분~1시간', '', 'Spare Disk로 자동복구,  긴급조치 불필요, 조치시간만 작성'],
    ['2024-03-04', 'TECH팀', '스토리지', '유진기업', '유진기업 VSP 통합스토리지 Disk HDD012-05 장애', '디스크 교체', '내부', 'HW', 'O', 'X', '', '등급외', '', '1:00', '1:00', '2: 30분~1시간', '', 'Spare Disk로 자동복구,  긴급조치 불필요, 조치시간만 작성'],
    ['2024-03-04', 'TECH팀', '서버', '유진기업', '유진기업 eai2서버 Disk Slot2 장애', '디스크 교체', '내부', 'HW', 'O', 'X', '', '등급외', '', '1:00', '1:00', '2: 30분~1시간', '', 'Raid 구성으로 Disk 정상동작,  긴급조치 불필요, 조치시간만 작성'],
    ['2024-03-07', 'TECH팀', '네트워크', '동양', '[동양] IDC SSL_VPN 장비 장애', '해당 장비 리부팅', '내부', 'HW', 'X', 'O', '', '등급외', '9:50', '10:30', '0:40', '2: 30분~1시간', '', ''],
    ['2024-03-18', 'TECH팀', '네트워크', '유진기업', '[유진기업] 평택공장 인터넷 회선 장애', 'LG측 장애처리', '외부', '회선', 'O', 'X', '', '등급외', '9:00', '14:00', '5:00', '5: 4시간 이상', '', ''],
    ['2024-03-30', 'TECH팀', '네트워크', '동양', '[동양] IDC SSL_VPN 장비 Hangup 장애', '해당 장비 리부팅', '내부', 'HW', 'X', 'O', '', '등급외', '12:59', '13:24', '0:25', '1: 30분이내', '', '펌웨어 패치 및 예비장비 구성 예정'],
    ['2024-03-30', 'TECH팀', 'Cloud', '대외', 'pseng-mariadb(10.41.38.161) 물리서버 인프라 문제로 인한 장애 발생', 'HA(Live Migration, 자동 이관 복구)', '외부', 'HW', 'X', 'X', '', '등급외', '4:01', '4:04', '0:43', '2: 30분~1시간', '', 'CSP에서 자동복구'],
    ['2024-04-05', 'TECH팀', '네트워크', '동양', '[동양] 안양공장 사무실 ~ 출하실간 라인 불량으로 네트워크 상태 불안', '해당 사업장에 신규 광케이블 포설', '내부', 'HW', 'X', 'O', '', '등급외', '04월 05일', '04월 13일', '8일', '4: 2~4시간', '', '출하실만 네트워크 단절'],
    ['2024-04-15', 'TECH팀', '서버', '유진기업', '유진기업 DNS Node1 리부팅 장애', '벤더사 덤프 분석중', '내부', 'HW', 'O', 'X', '', '등급외', '8:30', '9:00', '0:30', '1: 30분이내', '', '유지보수 업체 덤프 전달 후 현재 벤더사 분석중'],
    ['2024-02-23', '그룹지원팀', '그룹웨어', '전사', '대용량 메일 첨부 파일 다운로드 오류', '대용량 메일 서비스 db 계정 수정', '내부', 'HW', '', 'X', '전사', '등급외', '10:55', '12:30', '1:35', '3: 1~2시간', '', ''],
    ['2024-04-18', '그룹지원팀', '그룹웨어', '동양', '전표 상신 실패-커넥션 풀 에러', 'http 재기동', '내부', 'HW', '', 'O', '', '3등급', '10:00', '12:35', '2:35', '4: 2~4시간', '', 'TOCAPS 전표상신 : 동양에서 그룹웨어에 사용자가 많은 월말 월초 전표 상신시에 그룹웨어 성능 부족으로 장애 (현재는 발생하지 않음) – 기존 용량산정에서 동양은 없었음'],
    ['2024-03-11', '그룹지원팀', '그룹웨어', '동양', '동양 전표 결재 미완료 문서 완료함으로 가는 오류', '장애 시간 내 결재 완료 문서 확인\n업체 요청 통해 진행함으로 이동', '내부', 'HW', '', 'X', '', '등급외', '15:10', '2024-03-12', '2일', '4: 2~4시간', '', 'TOCAPS'],
    ['2024-03-22', '그룹지원팀', '그룹웨어', '유진기업', '유진기업 전표 결재 미완료 문서 완료함으로 가는 오류', '장애 시간 내 결재 완료 문서 확인\n업체 요청 통해 진행함으로 이동', '내부', 'APP', '', 'X', '', '등급외', '10:35', '13:20', '2:45', '4: 2~4시간', '', 'ez-A'],
    ['2023-07-17', '그룹지원팀', '그룹웨어', '동양', '품의서 결재 정보 수신 실패-커넥션 풀 에러', 'http 재기동', '내부', 'HW', '', 'O', '', '3등급', '13:00', '16:00', '3:00', '4: 2~4시간', '', 'TOCAPS 전표상신 : 동양에서 그룹웨어에 사용자가 많은 월말 월초 전표 상신시에 그룹웨어 성능 부족으로 장애 (현재는 발생하지 않음) – 기존 용량산정에서 동양은 없었음'],
    ['2024-04-30', '그룹지원팀', '그룹웨어', '전사', '신규 그룹웨어 전체 장애', '재기동', '내부', 'APP', '', 'O', '전사', '2등급', '15:56', '16:50', '0:54', '2: 30분~1시간', '0', '오픈 다음날 사용자 정보가 한사람으로 전부 update 됨'],
    ['2024-04-16', 'DT혁신팀', '콘라이브', '유진기업', '신규 GPS 데이터 생성 안됨 (유진기업 차량관제만 장애. 다른 제조사는 정상)', 'GPS MYSQL FAILE OVER 발생 ( 원인 문의중 )\n차카다(차량관제) 시스템 재기동', '외부', 'APP', '', 'O', '일부(차량관제)', '등급외', '16:57', '17:30', '0:33', '2: 30분~1시간', '', '유진기업 차카다 시스템'],
    ['2024-04-09', 'DT혁신팀', '콘라이브', '유진기업', 'MONGO DB CPU 간헐적 95%', '낮은 서버 스펙(Type 변경) . 모니터링 중.\n향후 문제 지속시 서버 용량 증설이 요구됨(비용수반)', '베스핀글로벌', 'DB', '', 'X', '', '등급외', '', '', '0:00', '1: 30분이내', '', '유진기업 차카다 시스템'],
    ['2024-01-03', 'DT혁신팀', '콘라이브', '유진기업', '콘라이브에 유진기업 데이터 생성 안됨', '송신측 sql수정이후  수신측에서 VALIDATION RETURN 발생\n송신측 SQL수정', '내부', 'APP', '', 'O', '일부', '등급외', '7:00', '9:05', '2:05', '4: 2~4시간', '', '유진기업 if 시스템'],
    ['2023-09-25', 'DT혁신팀', '콘라이브', '유진기업', 'GPS 데이터 파싱 지연', '차카다 시스템 처리 한계 ( 1대당 300차량 처리 )\n서버 증설, 차카다 시스템 프로세스 변경', '외부', 'APP', '', 'X', '', '등급외', '2023-09-25', '2023-10-04', '10일', '4: 2~4시간', '', '유진기업 차카다 시스템'],
    ['2023-08-07', 'DT혁신팀', '콘라이브', '유진기업', 'IOS 최초 배포 시 화면 나오지 않음', '개발버전에서 정상이었으나 , 마켓으로 배포시 문제\n사설 앱 설치 버전을 즉각 제공하여 해결 후 10/5일 마켓 재등록', '내부', 'APP', '', 'X', '', '등급외', '2023-08-07', '2023-08-07', '1일', '4: 2~4시간', '', 'conlive'],
    ['2023-10-25', '정보전략1팀', 'ERP', '유진기업', 'ERP 연동데이터 update 처리 지연\nPSAPPRD 테이블스페이스 Free Space 부족으로 발생', 'PSAPPRD 테이블스페이스 DataFile 88G 확대', '내부', 'DB', '', 'X', '', '1등급', '8:30', '9:50', '1:20', '3: 1~2시간', '0', '- 일별 DB 모니터링을 통한 주요 테이블스페이스 Free space 점검\n- 테이블스페이스 일 증가량을 파악하여 3~6개월 Free space 확보'],
    ['2024-06-10', '정보전략1팀', '출하', '유진기업', '로컬 배차지시테이블(T_PROD_CMMD) DDL 오류\n※ 장애 발생 후 데이터 점검 결과\n   1. 장애 영향 공장\n   -  부천,강서,인천,수원,광주,서서울,안산,동서울,안성,천안,군산,동두천  (총 12개 /전체  24개)\n   2. 데이터 발생량\n   - 장애 발생 후 출하 차량: 60대  (전체 출하 차량: 4991대)\n[원인]\n1) T_PROD_CMMD 테이블 삭제 후 신규 생성 과정에서 기존 테이블에 있던 컬럼 누락\n누락한 컬럼 :MIX_TIME_BP1 (1호기 믹싱타임), MIX_TIME_BP2 (2호기 믹싱타임)\n2) 담당자 인식 부족 (출하 마감이라고 판단 후 임의로 패치 적용)', '1) 16:30 - 출하시스템 패치 적용(김현재사원)\n\n2) 16:39 - 최초 현업담당자(강서공장 출하실 - 고원식 과장)로부터 배차지시 불가 연락받음.  이후 타 사업장 출하실에서도 장애상황 연락받음\n\n3) 16:40~17:05 - 프로그램 오류 확인 및 패치 코드확인\n\n4) 17:05~17:20 - 오류 원인 파악 후 전공장 일괄 업데이트 (로컬 마리아 DB 배차지시 테이블 DDL 오류)\n\n5) 17:20~17:30 - 프로그램 정상가동 확인 (공장별로 별도 확인 전화)', '내부', 'APP', '', 'O', '전사', '3등급', '16:30', '17:20', '0:50', '2: 30분~1시간', '0', 'c/s 패치시 현장시스템 DB layout DDL 문 오류로 발생 (잘못된 패치)\n[3등급 사유]\n- 1시간 이내\n- 사업장 50% (12/24) , 매출액 1.2% (60/4,991차량) 장애 발생\n[재발 방지 대책]\n    1. 업무처리 프로세스 문서화\n   ex) ITSM 승인 완료 - 작업계획서 제출 - 팀장 구두 승인 - 작업진행\n2. 프로그램 사전 테스트 강화 (개발, 테스트 이원화)\n   - 업무 부담당자 테스트 절차 추가\n   - 공장 1개 임시 배포 후 현업담당자 확인\n3. 업무시간 이후 패치 (18시 이후, 물량 마감 확인)'],
    ['2024-06-17', '정보전략1팀', '차량관제', '유진기업', '차량관제 시스템 교체로 인한 신규 기기 정보 미입력\n - 4개 사업장(동서울, 서서울, 남양주, 동두천) 250대 차량', '업체에서 조치', '외부', 'APP', '', 'O', '일부', '등급외', '9:00', '13:00', '4:00', '4: 2~4시간', '', ''],
    ['2024-06-17', '정보전략1팀', '출하', '유진기업', '출하시스템 지연 현상', '보안 백신 업데이트 종료', '내부', 'APP', '', 'X', '전사', '등급외', '14:30', '15:00', '0:30', '2: 30분~1시간', '', ''],
    ['2024-06-27', '정보전략3팀', '그룹웨어', '전사', '마이크로소프트 메일 서버 이상이 발견되어 그룹웨어 메일 장애', 'MS 사 조치', '외부', 'APP', '', 'X', '전사', '등급외', '10:20', '11:10', '0:50', '2: 30분~1시간', '', ''],
    ['2024-07-03', '정보전략3팀', '그룹웨어', '동양', '동양 im SSO 서버 비밀번호 초기화로 품질관리/TOCAPS 로그인 불가', '그룹웨어 로그인 후 비밀번호 초기화', '내부', 'APP', '', 'O', '일부', '등급외', '14:52', '2:49', '12:00', '5: 4시간 이상', '0', ''],
    ['2025-08-05', 'TECH팀', '네트워크', '유진기업', '유진기업(파크원) 정전으로 인한 방화벽 장애\n - 본사 업무서비스 장애 (사업장 무관)', '방화벽 장비자체의 DB복구 완료 후 정상 작동 확인', '내부', 'HW', 'O', 'O', '일부', '등급외', '6:01', '8:53', '2:52', '4: 2~4시간', '0', '정전내용 고객사로부터 통지 받지 못함'],
    ['2025-10-20', 'TECH팀', '서버', '유진자산운용', '웹사이트 접속시 사이트 접속 안됨 (담당자 실수로 logoff 대신 서버 shutdown 버튼을 클릭하여 서버가 Down)', '구로IDC 방문하여 서버 기동', '외부', 'APP', '', 'O', '일부', '등급외', '17:10', '18:10', '1:00', '2: 30분~1시간', '0', 'Gjtec - 김경태과장'],
  ];

  const insert = db.prepare(
    `INSERT INTO incident_logs (
      occurred_date, team_name, incident_type, company_name, description, action_taken,
      cause_source, cause_type, has_redundancy, service_outage, outage_scope, grade,
      occurred_time, resolved_time, duration, duration_category, has_report, note
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const seed = db.transaction(() => {
    for (const row of rows) insert.run(...row);
  });

  seed();
}
