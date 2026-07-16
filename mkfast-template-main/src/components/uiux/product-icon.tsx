import type { ShellIcon } from '@/config/sidebar-config';
import { cn } from '@/lib/utils';

interface ProductIconProps {
  className?: string;
  icon: ShellIcon;
  label?: string;
  size?: 16 | 18 | 20 | 24;
}

export function ProductIcon({
  className,
  icon: Icon,
  label,
  size = 18,
}: ProductIconProps) {
  return (
    <Icon
      aria-hidden={label ? undefined : true}
      aria-label={label}
      className={cn('shrink-0', className)}
      focusable="false"
      role={label ? 'img' : undefined}
      size={size}
      stroke={1.7}
    />
  );
}
