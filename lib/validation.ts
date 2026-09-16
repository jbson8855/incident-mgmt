// 영향도 기준표 항목의 값/가중치는 모두 0~1 사이 비율로 저장한다.
export function isValidRatio(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

export function isValidName(name: unknown): name is string {
  return typeof name === 'string' && name.trim().length > 0;
}
