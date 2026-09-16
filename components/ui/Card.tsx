import React from 'react';
import { clsx } from 'clsx';

interface CardProps {
  title?: string;
  titleClassName?: string;
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
}

export function Card({ title, titleClassName, children, className, onClick }: CardProps) {
  return (
    <div
      onClick={onClick}
      className={clsx(
        'bg-white border border-gray-200 rounded-lg p-4 shadow-sm',
        onClick && 'cursor-pointer hover:shadow-md transition-shadow',
        className,
      )}
    >
      {title && (
        <h3 className={clsx(titleClassName ?? 'text-sm font-semibold text-gray-700', 'mb-3')}>{title}</h3>
      )}
      {children}
    </div>
  );
}

export default Card;
