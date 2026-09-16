-- 여기에 테이블을 정의하세요.
-- lib/db.ts의 getDB()가 앱 시작 시 이 파일을 자동으로 실행합니다.

CREATE TABLE IF NOT EXISTS companies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- 대분류: 비즈니스영향도 / 장애복잡도 / 고객서비스영향도. 모든 계열사에 공통으로 적용되는 기준표라
-- 계열사별로 구분하지 않는다(계열사마다 달라지는 부분은 impact_items.company_id로만 표현한다).
CREATE TABLE IF NOT EXISTS impact_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  code TEXT NOT NULL,        -- 'business' | 'complexity' | 'customer' (안정적 식별용, 코드에서 분기할 때 사용)
  weight REAL NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0
);

-- 중분류. 카테고리와 마찬가지로 모든 계열사 공통.
CREATE TABLE IF NOT EXISTS impact_subcategories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL REFERENCES impact_categories(id),
  name TEXT NOT NULL,
  code TEXT NOT NULL,        -- 'target_systems' | 'severity' | 'access_failure' | 'response_speed' | 'recurrence' 등 안정적 식별용
  weight REAL NOT NULL,
  selection_type TEXT NOT NULL,  -- 'multiple' | 'single'
  display_order INTEGER NOT NULL DEFAULT 0
);

-- 항목(소분류). "대상(업무서비스)" 시스템 목록만 계열사마다 다르므로 그 항목들만 company_id를 채운다.
-- 나머지(장애복잡도/고객서비스영향도 및 서비스 장애 범위 가중치)는 company_id가 NULL인 공통 항목이다.
CREATE TABLE IF NOT EXISTS impact_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subcategory_id INTEGER NOT NULL REFERENCES impact_subcategories(id),
  company_id INTEGER REFERENCES companies(id),  -- NULL이면 모든 계열사 공통. 값이 있으면 그 계열사 전용(대상업무서비스 시스템).
  name TEXT NOT NULL,
  value REAL NOT NULL,       -- 0~1 (직접입력형 항목은 기본값/참고값으로만 사용)
  group_name TEXT,           -- 비즈니스영향도 항목에만 사용 (ERP/유관시스템/EURAS/영업관리/콘라이브/기타)
  display_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  min_value REAL,            -- 직접입력형 항목(예: 장애범위-일부장애)의 입력 허용 최소값 (0~1). 고정값 항목은 NULL.
  max_value REAL             -- 직접입력형 항목의 입력 허용 최대값 (0~1). 고정값 항목은 NULL.
);

-- 장애등급 산정 이력 (장애등급-계산 기능이 계산 완료 시 자동 저장. 이 테이블은 조회 전용으로만 참조된다)
CREATE TABLE IF NOT EXISTS incident_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id),
  company_name TEXT NOT NULL,          -- 산정 당시 계열사명 스냅샷
  calculated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),

  title TEXT NOT NULL DEFAULT '',      -- 장애 제목 (품질관리자가 입력하는 짧은 제목, 계산에는 반영되지 않음)
  systems_json TEXT NOT NULL,          -- 선택된 비즈니스영향도 시스템 스냅샷: [{"name":"SD(영업)","value":1,"groupName":"ERP"}, ...] (JSON, 빈 배열 가능)
  failure_scope_choice TEXT NOT NULL,  -- '전체장애' | '일부장애'
  failure_scope_value REAL NOT NULL,   -- 적용된 배율(0~1). 전체장애=1, 일부장애=산정 당시 직접입력한 값
  business_score REAL NOT NULL,        -- 비즈니스영향도 대분류 소계 (= 가중치 × 선택시스템 값 합 × 장애범위 배율)

  complexity_choice TEXT NOT NULL,     -- 실제 적용된 항목명 (예: '단순장애' | '복잡장애')
  complexity_is_unknown INTEGER NOT NULL DEFAULT 0,
  complexity_value REAL NOT NULL,      -- 적용된 항목 값(0~1)
  complexity_score REAL NOT NULL,      -- 장애복잡도 대분류 소계

  access_failure_choice TEXT NOT NULL,
  access_failure_is_unknown INTEGER NOT NULL DEFAULT 0,
  access_failure_value REAL NOT NULL,

  response_speed_choice TEXT NOT NULL,
  response_speed_is_unknown INTEGER NOT NULL DEFAULT 0,
  response_speed_value REAL NOT NULL,

  recurrence_choice TEXT NOT NULL,
  recurrence_is_unknown INTEGER NOT NULL DEFAULT 0,
  recurrence_value REAL NOT NULL,

  customer_score REAL NOT NULL,        -- 고객서비스영향도 대분류 소계

  total_score REAL NOT NULL,
  grade TEXT NOT NULL                  -- '1등급' | '2등급' | '3등급' | '등급외'
);

CREATE INDEX IF NOT EXISTS idx_incident_records_calculated_at ON incident_records(calculated_at);

-- 장애등급 판정 기준(총점 구간별 등급). "장애등급-계산" 기능이 읽어서 사용하는 기준 데이터.
-- 모든 계열사에 동일하게 적용되는 공통 기준이라 계열사별로 구분하지 않는다.
CREATE TABLE IF NOT EXISTS grade_thresholds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  grade TEXT NOT NULL,        -- '1등급' | '2등급' | '3등급' | '등급외'
  min_score REAL NOT NULL,    -- 이 값을 "초과"해야 해당 등급 (배타적 하한)
  max_score REAL,             -- 이 값까지 "이하"로 해당 등급 (포함). NULL이면 상한 없음.
  display_order INTEGER NOT NULL DEFAULT 0
);

-- 엑셀로 수기 관리해온 과거 장애 이력 원본 로그. incident_records(장애등급 계산기가 자동 저장하는 산정
-- 이력)와는 완전히 별개이며, 조회 전용으로만 쓰인다. 관계사는 companies 테이블과 연동하지 않고 자유
-- 텍스트로 저장한다.
CREATE TABLE IF NOT EXISTS incident_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  occurred_date TEXT NOT NULL,                 -- 발생일 (YYYY-MM-DD로 정규화)
  team_name TEXT NOT NULL,                     -- 팀명
  incident_type TEXT NOT NULL,                 -- 장애유형
  company_name TEXT NOT NULL,                  -- 관계사 (자유 텍스트)
  description TEXT NOT NULL DEFAULT '',        -- 장애내용
  action_taken TEXT NOT NULL DEFAULT '',       -- 조치사항
  cause_source TEXT NOT NULL DEFAULT '',       -- 발생요인 (내부/외부 등, 원본 표기 그대로)
  cause_type TEXT NOT NULL DEFAULT '',         -- 장애요인 (HW/APP/회선/DB 등)
  has_redundancy TEXT NOT NULL DEFAULT '',     -- 이중화 구성 여부 (원본 표기 그대로)
  service_outage TEXT NOT NULL DEFAULT '',     -- 업무서비스 중단 여부 (원본 표기 그대로)
  outage_scope TEXT NOT NULL DEFAULT '',       -- 중단규모 (전사/일부 등, 원본 표기 그대로)
  grade TEXT NOT NULL,                         -- 장애등급 ('1등급'|'2등급'|'3등급'|'등급외')
  occurred_time TEXT NOT NULL DEFAULT '',      -- 발생시간 (원본 표기 그대로, 정규화하지 않음)
  resolved_time TEXT NOT NULL DEFAULT '',      -- 조치시간 (원본 표기 그대로)
  duration TEXT NOT NULL DEFAULT '',           -- 소요시간 (원본 표기 그대로)
  duration_category TEXT NOT NULL DEFAULT '',  -- 소요시간 구분
  has_report TEXT NOT NULL DEFAULT '',         -- 장애보고서
  note TEXT NOT NULL DEFAULT ''                -- 비고
);

CREATE INDEX IF NOT EXISTS idx_incident_logs_occurred_date ON incident_logs(occurred_date);
