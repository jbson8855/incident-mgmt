// 여기에 타입을 정의하세요.
// 모든 타입은 이 파일에서 단일 관리합니다.

export type Company = {
  id: number;
  name: string;
  created_at: string;
};

export type ImpactCategoryCode = 'business' | 'complexity' | 'customer';

// 대분류/중분류는 모든 계열사에 공통이다(계열사별 차이는 ImpactItem.company_id로만 표현).
export type ImpactCategory = {
  id: number;
  name: string;
  code: ImpactCategoryCode;
  weight: number;
  display_order: number;
};

export type SelectionType = 'multiple' | 'single';

export type ImpactSubcategory = {
  id: number;
  category_id: number;
  name: string;
  code: string;
  weight: number;
  selection_type: SelectionType;
  display_order: number;
};

export type ImpactItem = {
  id: number;
  subcategory_id: number;
  company_id: number | null; // null이면 모든 계열사 공통. 값이 있으면 그 계열사 전용(대상업무서비스 시스템).
  name: string;
  value: number;
  group_name: string | null;
  display_order: number;
  is_active: number;
  min_value: number | null; // 직접입력형 항목(예: 장애범위-일부장애)의 입력 허용 최소값. 고정값 항목은 null.
  max_value: number | null; // 직접입력형 항목의 입력 허용 최대값. 고정값 항목은 null.
};

// 계열사 전체 기준표 조회 결과 트리 타입
export type ImpactSubcategoryWithItems = ImpactSubcategory & {
  items: ImpactItem[];
};

export type ImpactCategoryWithSubcategories = ImpactCategory & {
  subcategories: ImpactSubcategoryWithItems[];
};

export type ImpactCriteria = {
  company: Company;
  categories: ImpactCategoryWithSubcategories[];
};

export type IncidentGrade = '1등급' | '2등급' | '3등급' | '등급외';

// 장애등급 판정 기준(총점 구간별 등급). 모든 계열사에 동일하게 적용되는 공통 기준. max_score가 null이면 상한 없음.
export type GradeThreshold = {
  id: number;
  grade: IncidentGrade;
  min_score: number;
  max_score: number | null;
  display_order: number;
};

// 산정 당시 선택된 비즈니스영향도 시스템 스냅샷
export type IncidentSystemSnapshot = {
  name: string;
  value: number;
  groupName: string | null;
};

// 예/아니오/미확인 단일 선택 중분류(장애복잡도/접속장애여부/응답속도/동일장애재발)의 산정 결과
export type IncidentSingleChoiceResult = {
  choice: string;
  isUnknown: boolean;
  value: number;
};

// 장애범위(전체장애/일부장애) 산정 결과. 장애 건 전체에 공통 적용되는 배율.
export type IncidentScopeResult = {
  choice: string;
  value: number;
};

// incident_records 테이블 행 (DB 원본 형태)
export type IncidentRecord = {
  id: number;
  company_id: number;
  company_name: string;
  calculated_at: string;
  title: string;
  systems_json: string;
  failure_scope_choice: string;
  failure_scope_value: number;
  business_score: number;
  complexity_choice: string;
  complexity_is_unknown: number;
  complexity_value: number;
  complexity_score: number;
  access_failure_choice: string;
  access_failure_is_unknown: number;
  access_failure_value: number;
  response_speed_choice: string;
  response_speed_is_unknown: number;
  response_speed_value: number;
  recurrence_choice: string;
  recurrence_is_unknown: number;
  recurrence_value: number;
  customer_score: number;
  total_score: number;
  grade: IncidentGrade;
};

// 클라이언트에서 보내는 예/아니오/미확인 선택 입력 (itemId는 isUnknown이 아닐 때 필수)
export type IncidentSingleChoiceInput = {
  itemId?: number;
  isUnknown: boolean;
};

// 클라이언트에서 보내는 장애범위 선택 입력. 일부장애처럼 직접입력형 항목(min_value/max_value 존재)을
// 선택한 경우 inputValue(0~1)가 필수이며, 전체장애처럼 고정값 항목은 inputValue를 생략한다.
export type IncidentScopeInput = {
  itemId: number;
  inputValue?: number;
};

export type IncidentCalculationRequest = {
  companyId: number;
  title: string;
  selectedSystemItemIds: number[];
  failureScope: IncidentScopeInput;
  complexity: IncidentSingleChoiceInput;
  accessFailure: IncidentSingleChoiceInput;
  responseSpeed: IncidentSingleChoiceInput;
  recurrence: IncidentSingleChoiceInput;
};

// 장애 이력 목록 조회 쿼리 파라미터 (app/api/incident-records)
export type IncidentRecordListParams = {
  companyId?: number;
  grade?: IncidentGrade;
  startDate?: string;
  endDate?: string;
  page?: number;
  pageSize?: number;
};

// 장애 이력 목록 조회 응답 (페이지네이션 포함, 행은 기존 IncidentRecord 재사용)
export type IncidentRecordListResponse = {
  records: IncidentRecord[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
};

// incident_logs 테이블 행 (엑셀로 수기 관리해온 과거 장애 이력 원본. incident_records와는 무관)
export type IncidentLog = {
  id: number;
  occurred_date: string;
  team_name: string;
  incident_type: string;
  company_name: string;
  description: string;
  action_taken: string;
  cause_source: string;
  cause_type: string;
  has_redundancy: string;
  service_outage: string;
  outage_scope: string;
  grade: IncidentGrade;
  occurred_time: string;
  resolved_time: string;
  duration: string;
  duration_category: string;
  has_report: string;
  note: string;
};

// 과거 장애 이력 목록 조회 쿼리 파라미터 (app/api/incident-logs)
// grade에 '등급내'를 넘기면 1/2/3등급을 모두 포함해서 조회한다(등급외 제외).
export type IncidentLogListParams = {
  teamName?: string;
  companyName?: string;
  grade?: IncidentGrade | '등급내';
  startDate?: string;
  endDate?: string;
  page?: number;
  pageSize?: number;
};

// 과거 장애 이력 목록 조회 응답 (페이지네이션 포함)
export type IncidentLogListResponse = {
  records: IncidentLog[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
};

// 계산 API 응답: 산정 결과 + 방금 생성된 이력 건 id
export type IncidentCalculationResult = {
  id: number;
  companyName: string;
  calculatedAt: string;
  title: string;
  systems: IncidentSystemSnapshot[];
  failureScope: IncidentScopeResult;
  businessScore: number;
  complexity: IncidentSingleChoiceResult;
  complexityScore: number;
  accessFailure: IncidentSingleChoiceResult;
  responseSpeed: IncidentSingleChoiceResult;
  recurrence: IncidentSingleChoiceResult;
  customerScore: number;
  totalScore: number;
  grade: IncidentGrade;
};
