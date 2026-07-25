/**
 * 后台面板 chrome —— 壳换核不换的接缝。
 *
 * 各 admin 面里的数据流、表单逻辑、testid 与文案一律不动，动的是包着它们的外框：
 * shadcn `Card` 换成 HeroUI Pro 的 `Widget`，`Badge` 换成走同一套 DESIGN.md 状态色的
 * `AdminStatusChip`。两者刻意保留与被替换者同名的分件与同名的 variant 词表，
 * 换壳因此是一次可逐行核对的改名，而不是重写。
 *
 * 只在 `/admin` 子树内使用：Glass 样式表是路由级引入的，前台页面不受影响。
 */
import { Widget } from '@/components/heroui-pro';
import { cn } from '@/lib/utils';
import type { ComponentPropsWithRef, ReactNode } from 'react';

export function AdminPanel({
  children,
  className,
  ...props
}: ComponentPropsWithRef<'div'>) {
  return (
    <Widget className={cn('gap-0', className)} {...props}>
      {children}
    </Widget>
  );
}

export function AdminPanelHeader({
  children,
  className,
  ...props
}: ComponentPropsWithRef<'div'>) {
  return (
    <Widget.Header
      className={cn('flex-col items-start gap-1.5', className)}
      {...props}
    >
      {children}
    </Widget.Header>
  );
}

export function AdminPanelTitle({
  children,
  className,
  ...props
}: ComponentPropsWithRef<'span'>) {
  return (
    <Widget.Title className={className} {...props}>
      {children}
    </Widget.Title>
  );
}

export function AdminPanelDescription({
  children,
  className,
  ...props
}: ComponentPropsWithRef<'span'>) {
  return (
    <Widget.Description className={className} {...props}>
      {children}
    </Widget.Description>
  );
}

export function AdminPanelContent({
  children,
  className,
  ...props
}: ComponentPropsWithRef<'div'>) {
  return (
    <Widget.Content className={className} {...props}>
      {children}
    </Widget.Content>
  );
}

export function AdminPanelFooter({
  children,
  className,
  ...props
}: ComponentPropsWithRef<'div'>) {
  return (
    <Widget.Footer className={className} {...props}>
      {children}
    </Widget.Footer>
  );
}

/**
 * `Badge` 的后台对应物。
 *
 * variant 词表与 shadcn Badge 逐一对齐（default/secondary/destructive/outline），
 * 让面板里的状态映射函数原样保留；配色取 token 桥落下的 DESIGN.md 值，
 * 所以它跟着双主题走，不自带颜色。
 */
const CHIP_VARIANTS = {
  default: 'bg-accent text-accent-foreground border-transparent',
  secondary: 'bg-surface-secondary text-foreground border-transparent',
  destructive: 'bg-danger text-danger-foreground border-transparent',
  outline: 'border-border text-foreground',
} as const;

export type AdminStatusChipVariant = keyof typeof CHIP_VARIANTS;

export function AdminStatusChip({
  children,
  className,
  variant = 'default',
  ...props
}: ComponentPropsWithRef<'span'> & {
  children: ReactNode;
  variant?: AdminStatusChipVariant;
}) {
  return (
    <span
      className={cn(
        'inline-flex w-fit shrink-0 items-center justify-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        CHIP_VARIANTS[variant],
        className
      )}
      {...props}
    >
      {children}
    </span>
  );
}
