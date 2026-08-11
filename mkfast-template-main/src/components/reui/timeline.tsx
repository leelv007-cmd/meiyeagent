import { createContext, useContext } from 'react';

import { cn } from '@/lib/utils';

/**
 * Static vertical timeline used by the admin audit and operations surfaces.
 * Every item declares its step; `defaultValue` marks the completed prefix.
 */
const TimelineContext = createContext<number | undefined>(undefined);

function useActiveStep() {
  const activeStep = useContext(TimelineContext);
  if (activeStep === undefined) {
    throw new Error('TimelineItem must be used within a Timeline');
  }
  return activeStep;
}

interface TimelineProps extends React.ComponentProps<'ol'> {
  defaultValue?: number;
}

function Timeline({
  defaultValue = 1,
  className,
  children,
  ...props
}: TimelineProps) {
  return (
    <TimelineContext.Provider value={defaultValue}>
      <ol
        {...props}
        className={cn('group/timeline flex list-none flex-col p-0', className)}
        data-orientation="vertical"
        data-slot="timeline"
      >
        {children}
      </ol>
    </TimelineContext.Provider>
  );
}

function TimelineContent({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      {...props}
      className={cn('text-sm text-muted-foreground', className)}
      data-slot="timeline-content"
    />
  );
}

function TimelineHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div {...props} className={cn(className)} data-slot="timeline-header" />
  );
}

function TimelineIndicator({
  className,
  ...props
}: React.ComponentProps<'div'>) {
  return (
    <div
      {...props}
      aria-hidden="true"
      className={cn(
        'absolute top-0 -left-6 size-4 -translate-x-1/2 rounded-full border-2 border-primary/20 group-data-completed/timeline-item:border-primary',
        className
      )}
      data-slot="timeline-indicator"
    />
  );
}

interface TimelineItemProps extends React.ComponentProps<'li'> {
  step: number;
}

function TimelineItem({ step, className, ...props }: TimelineItemProps) {
  const activeStep = useActiveStep();

  return (
    <li
      {...props}
      className={cn(
        'group/timeline-item relative ms-8 flex flex-1 flex-col gap-0.5 not-last:pb-6 has-[+[data-completed]]:**:data-[slot=timeline-separator]:bg-primary',
        className
      )}
      data-completed={step <= activeStep || undefined}
      data-slot="timeline-item"
    />
  );
}

function TimelineSeparator({
  className,
  ...props
}: React.ComponentProps<'div'>) {
  return (
    <div
      {...props}
      aria-hidden="true"
      className={cn(
        'absolute -left-6 h-[calc(100%-1rem-0.25rem)] w-0.5 -translate-x-1/2 translate-y-4.5 self-start bg-primary/10 group-last/timeline-item:hidden',
        className
      )}
      data-slot="timeline-separator"
    />
  );
}

function TimelineTitle({ className, ...props }: React.ComponentProps<'h3'>) {
  return (
    <h3
      {...props}
      className={cn('text-sm font-medium', className)}
      data-slot="timeline-title"
    />
  );
}

export {
  Timeline,
  TimelineContent,
  TimelineHeader,
  TimelineIndicator,
  TimelineItem,
  TimelineSeparator,
  TimelineTitle,
};
