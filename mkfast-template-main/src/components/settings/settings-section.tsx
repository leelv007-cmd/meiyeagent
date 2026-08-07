import { createContext, use, type ReactNode } from 'react';

import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/**
 * One settings section, one surface.
 *
 * Each section used to be a heading with one to three cards under it, and every
 * card carried a title of its own: 登录安全 opened a card called 修改密码,
 * 应用安装 opened one called 安装应用, and 积分与账单 opened three cards
 * competing at equal weight, each with its own border and its own filled footer
 * band. That is a card inside a card, twice over — a second surface and a
 * second name for one thing.
 *
 * The section is the panel. What used to be a card is a group inside it, told
 * apart by a rule rather than by another border.
 */

/**
 * Heading rank for a group title, so a section that prints no heading of its own
 * does not leave the groups under it skipping a level. The phone renders only
 * the credits section and names it in the page h1, which is exactly that case.
 */
const SettingsHeadingLevel = createContext<2 | 3>(3);

export function useSettingsHeadingLevel() {
  return use(SettingsHeadingLevel);
}

export function SettingsSection({
  children,
  id,
  title,
}: {
  children: ReactNode;
  id: string;
  /** Omitted where the page h1 already names this section. */
  title?: string;
}) {
  return (
    <SettingsHeadingLevel value={title ? 3 : 2}>
      <section className="scroll-mt-16" id={id}>
        <Card className="gap-0 py-0">
          {title ? (
            <div className="px-6 pt-5 pb-4">
              <h2 className="text-lg font-semibold">{title}</h2>
            </div>
          ) : null}
          <div className={cn('divide-y', title && 'border-t')}>{children}</div>
        </Card>
      </section>
    </SettingsHeadingLevel>
  );
}

/** A group inside a section. Siblings are separated by the section's rules. */
export function SettingsRow({
  children,
  className,
  ...props
}: React.ComponentProps<'div'>) {
  return (
    <div className={cn('space-y-4 px-6 py-5', className)} {...props}>
      {children}
    </div>
  );
}

export function SettingsRowHeader({
  description,
  title,
}: {
  description?: string;
  title: string;
}) {
  const level = useSettingsHeadingLevel();
  const Heading = level === 2 ? 'h2' : 'h3';
  return (
    <div className="space-y-1">
      <Heading className="text-base font-medium">{title}</Heading>
      {description ? (
        <p className="text-sm text-muted-foreground">{description}</p>
      ) : null}
    </div>
  );
}

/**
 * The hint-and-action line that closed each card. It used to be a `bg-muted`
 * band — a filled strip painted inside the card, which is what read as a card
 * within a card even where the markup had only one. Same content, no second
 * surface.
 */
export function SettingsRowFooter({
  children,
  hint,
}: {
  /** The action(s), kept to the trailing edge. */
  children?: ReactNode;
  hint?: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-muted-foreground">{hint}</p>
      {children}
    </div>
  );
}
