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
import { Chip } from '@heroui/react';
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
 * `Badge` 的后台对应物 —— HeroUI v3 `Chip`（D-130 组件基准），配色全部来自
 * token 桥落下的 DESIGN.md 值，因此跟着双主题走、不自带颜色。
 *
 * variant 词表刻意与 shadcn Badge 逐一对齐（default/secondary/destructive/
 * outline），面板里既有的「状态 → variant」映射函数因此一行都不用改。
 */
const CHIP_VARIANTS = {
  default: { color: 'accent', variant: 'primary' },
  secondary: { color: 'default', variant: 'secondary' },
  destructive: { color: 'danger', variant: 'primary' },
  outline: { color: 'default', variant: 'tertiary' },
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
  const chip = CHIP_VARIANTS[variant];
  return (
    // 展开在前：span 自带的 `color` 属性否则会盖掉 Chip 的配色 variant。
    <Chip
      {...props}
      className={cn('w-fit shrink-0 whitespace-nowrap', className)}
      color={chip.color}
      size="sm"
      variant={chip.variant}
    >
      {children}
    </Chip>
  );
}
