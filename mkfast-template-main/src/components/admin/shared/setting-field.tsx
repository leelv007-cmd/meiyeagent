import { Badge } from '@/components/reui/badge';
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldSeparator,
  FieldTitle,
} from '@/components/ui/field';
import { cn } from '@/lib/utils';
import type { ComponentProps, ReactNode } from 'react';

/**
 * 设置行：左侧标题＋说明，右侧控件，行下自画分隔线（最后一行不画）。
 *
 * 取自 surge `src/features/settings/components/general/setting-field.tsx`
 * （ReUI settings-3 block 的行原语），admin 的受控配置面统一走这一种行式布局，
 * 替代此前每个控制台各画一套的 label/控件网格。
 */
export function SettingField({
  title,
  description,
  badge,
  children,
  last,
  labelFor,
  contentClassName,
}: {
  title: ReactNode;
  description?: ReactNode;
  badge?: {
    label: string;
    variant: ComponentProps<typeof Badge>['variant'];
  };
  children: ReactNode;
  last?: boolean;
  labelFor?: string;
  contentClassName?: string;
}) {
  return (
    <>
      <Field orientation="responsive" className="gap-4 px-4 py-4">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5 @md/field-group:max-w-sm">
          <div className="flex flex-wrap items-center gap-2">
            {labelFor ? (
              <FieldLabel htmlFor={labelFor}>{title}</FieldLabel>
            ) : (
              <FieldTitle>{title}</FieldTitle>
            )}
            {badge ? (
              <Badge variant={badge.variant}>{badge.label}</Badge>
            ) : null}
          </div>
          {description ? (
            <FieldDescription>{description}</FieldDescription>
          ) : null}
        </div>

        <FieldContent
          className={cn('min-w-0 @md/field-group:w-78', contentClassName)}
        >
          {children}
        </FieldContent>
      </Field>

      {!last ? <FieldSeparator /> : null}
    </>
  );
}
