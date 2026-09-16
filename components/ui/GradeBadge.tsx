import { Badge } from './Badge';
import type { IncidentGrade } from '@/types';

const GRADE_COLOR: Record<IncidentGrade, 'red' | 'orange' | 'yellow' | 'gray'> = {
  '1등급': 'red',
  '2등급': 'orange',
  '3등급': 'yellow',
  등급외: 'gray',
};

interface GradeBadgeProps {
  grade: IncidentGrade;
  size?: 'sm' | 'md';
}

export function GradeBadge({ grade, size = 'sm' }: GradeBadgeProps) {
  return (
    <Badge color={GRADE_COLOR[grade]} size={size}>
      {grade}
    </Badge>
  );
}

export default GradeBadge;
