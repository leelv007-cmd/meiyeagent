'use client';

import React, {
  type ComponentPropsWithRef,
  createContext,
  type ReactNode,
  useContext,
  useMemo,
} from 'react';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
import { composeSlotClassName } from '../../utils/compose';
import type { TimelineVariants } from './timeline.styles';
import { timelineVariants } from './timeline.styles';

export type TimelineAxis = NonNullable<TimelineVariants['axis']>;
export type TimelineItemAlign = NonNullable<TimelineVariants['itemAlign']>;
export type TimelineSide = 'end' | 'start';
export type TimelinePlacement = TimelineSide | 'alternate';
export type TimelineStatus =
  | 'current'
  | 'danger'
  | 'default'
  | 'muted'
  | 'success'
  | 'warning';

type TimelineContextValue = {
  axis: TimelineAxis;
  itemAlign: TimelineItemAlign;
  placement: TimelinePlacement;
  slots: ReturnType<typeof timelineVariants>;
};

type TimelineItemContextValue = {
  align: TimelineItemAlign;
  index: number;
  isLast: boolean;
  side: TimelineSide;
  status: TimelineStatus;
};

const TimelineContext = createContext<TimelineContextValue>({
  axis: 'start',
  itemAlign: 'start',
  placement: 'end',
  slots: timelineVariants(),
});

const TimelineItemContext = createContext<TimelineItemContextValue>({
  align: 'start',
  index: 0,
  isLast: false,
  side: 'end',
  status: 'default',
});

export const useTimelineItem = () => useContext(TimelineItemContext);

function isTimelineItem(child: ReactNode): child is React.ReactElement {
  return React.isValidElement(child) && child.type === TimelineItem;
}

function resolveSide(
  index: number,
  placement: TimelinePlacement,
  side?: TimelineSide
): TimelineSide {
  if (side) return side;
  if (placement === 'alternate') return index % 2 === 0 ? 'end' : 'start';
  return placement;
}

export interface TimelineRootProps extends Omit<
  ComponentPropsWithRef<'ol'>,
  'children'
> {
  /** Position of the timeline axis. @default "start" */
  axis?: TimelineVariants['axis'];
  children: ReactNode;
  /** Vertical rhythm between events. @default "comfortable" */
  density?: TimelineVariants['density'];
  /** Default vertical alignment for item content. @default "start" */
  itemAlign?: TimelineVariants['itemAlign'];
  /** Default content side for items. `alternate` alternates start/end by index. @default "end" */
  placement?: TimelinePlacement;
  /** Size variant. @default "md" */
  size?: TimelineVariants['size'];
}

type TimelineItemInternalProps = {
  _index: number;
  _isLast: boolean;
  _side: TimelineSide;
};

export const TimelineRoot = ({
  axis = 'start',
  children,
  className,
  density = 'comfortable',
  itemAlign = 'start',
  placement = 'end',
  size = 'md',
  ...props
}: TimelineRootProps) => {
  const slots = useMemo(
    () => timelineVariants({ axis, density, itemAlign, size }),
    [axis, density, itemAlign, size]
  );
  const contextValue = useMemo<TimelineContextValue>(
    () => ({
      axis: axis ?? 'start',
      itemAlign: itemAlign ?? 'start',
      placement,
      slots,
    }),
    [axis, itemAlign, placement, slots]
  );

  const childrenArray = React.Children.toArray(children);
  const itemCount = childrenArray.filter(isTimelineItem).length;
  let itemIndex = 0;
  const mappedChildren = childrenArray.map((child) => {
    if (!isTimelineItem(child)) return child;
    const index = itemIndex++;
    const side = resolveSide(
      index,
      placement,
      (child.props as TimelineItemProps).side
    );

    return React.cloneElement(child, {
      _index: index,
      _isLast: index === itemCount - 1,
      _side: side,
      key: child.key ?? `timeline-item-${index}`,
    } as Partial<TimelineItemInternalProps>);
  });

  return jsx(TimelineContext, {
    value: contextValue,
    children: jsx('ol', {
      className: composeSlotClassName(slots?.base, className),
      'data-axis': axis,
      'data-placement': placement,
      'data-slot': 'timeline',
      ...props,
      children: mappedChildren,
    }),
  });
};

export interface TimelineItemProps extends Omit<
  ComponentPropsWithRef<'li'>,
  'align' | 'children'
> {
  /** Vertical alignment for this item's content. @default inherited */
  align?: TimelineItemAlign;
  children?: ReactNode;
  /** Content side when the root axis is centered. */
  side?: TimelineSide;
  /** Marker tone for this item. @default "default" */
  status?: TimelineStatus;
}

export const TimelineItem = ({
  _index: injectedIndex,
  _isLast: injectedIsLast,
  _side: injectedSide,
  align: alignProp,
  children,
  className,
  side: sideProp,
  status = 'default',
  ...props
}: TimelineItemProps & Partial<TimelineItemInternalProps>) => {
  const { itemAlign, placement, slots } = useContext(TimelineContext);
  const index = injectedIndex ?? 0;
  const isLast = injectedIsLast ?? false;
  const align = alignProp ?? itemAlign;
  const side = injectedSide ?? resolveSide(index, placement, sideProp);
  const contextValue = useMemo<TimelineItemContextValue>(
    () => ({ align, index, isLast, side, status }),
    [align, index, isLast, side, status]
  );

  const railChildren: ReactNode[] = [];
  const contentChildren: ReactNode[] = [];
  let railElement: React.ReactElement<TimelineRailProps> | null = null;
  let railChildrenProp: ReactNode = null;

  React.Children.forEach(children, (child) => {
    if (
      React.isValidElement<TimelineRailProps>(child) &&
      child.type === TimelineRail
    ) {
      railElement = child;
      railChildrenProp = child.props.children;
    } else if (
      !React.isValidElement(child) ||
      (child.type !== TimelineMarker && child.type !== TimelineConnector)
    ) {
      railChildren.push(child);
    } else {
      contentChildren.push(child);
    }
  });

  const resolvedRail =
    railElement && contentChildren.length > 0
      ? React.cloneElement(railElement, {
          children: jsxs(Fragment, {
            children: [railChildrenProp, contentChildren],
          }),
        })
      : (railElement ?? jsx(TimelineRail, { children: contentChildren }));

  return jsx(TimelineItemContext, {
    value: contextValue,
    children: jsxs('li', {
      'aria-current': status === 'current' ? 'true' : undefined,
      className: composeSlotClassName(slots?.item, className, {
        itemAlign: align,
      }),
      'data-align': align,
      'data-index': index,
      'data-last': isLast || undefined,
      'data-side': side,
      'data-slot': 'timeline-item',
      'data-status': status,
      ...props,
      children: [railChildren, resolvedRail],
    }),
  });
};

export interface TimelineRailProps extends ComponentPropsWithRef<'span'> {
  children?: ReactNode;
}

export const TimelineRail = ({
  children,
  className,
  ...props
}: TimelineRailProps) => {
  const { slots } = useContext(TimelineContext);
  const childrenArray = React.Children.toArray(children);
  const hasMarker = childrenArray.some(
    (child) => React.isValidElement(child) && child.type === TimelineMarker
  );
  const hasConnector = childrenArray.some(
    (child) => React.isValidElement(child) && child.type === TimelineConnector
  );

  return jsxs('span', {
    className: composeSlotClassName(slots?.rail, className),
    'data-slot': 'timeline-rail',
    ...props,
    children: [
      !hasMarker ? jsx(TimelineMarker, {}) : null,
      children,
      !hasConnector ? jsx(TimelineConnector, {}) : null,
    ],
  });
};

export interface TimelineMarkerProps extends ComponentPropsWithRef<'span'> {
  children?: ReactNode;
  /** Override the marker tone for this item. */
  status?: TimelineStatus;
}

export const TimelineMarker = ({
  children,
  className,
  status: statusProp,
  ...props
}: TimelineMarkerProps) => {
  const { slots } = useContext(TimelineContext);
  const { status } = useTimelineItem();
  const resolvedStatus = statusProp ?? status;
  const ariaProps = {
    'aria-hidden': children
      ? props['aria-hidden']
      : (props['aria-hidden'] ?? true),
    ...props,
  };

  return jsx('span', {
    className: composeSlotClassName(slots?.marker, className),
    'data-slot': 'timeline-marker',
    'data-status': resolvedStatus,
    ...ariaProps,
    children,
  });
};

export interface TimelineConnectorProps extends ComponentPropsWithRef<'span'> {
  /** Force rendering even for the final item. */
  force?: boolean;
}

export const TimelineConnector = ({
  className,
  force,
  ...props
}: TimelineConnectorProps) => {
  const { slots } = useContext(TimelineContext);
  const { isLast } = useTimelineItem();

  if (isLast && !force) return null;

  return jsx('span', {
    'aria-hidden': 'true',
    className: composeSlotClassName(slots?.connector, className),
    'data-force': force || undefined,
    'data-slot': 'timeline-connector',
    ...props,
  });
};

export interface TimelineContentProps extends ComponentPropsWithRef<'div'> {
  children: ReactNode;
  /** Place content on the start or end side of a centered timeline. */
  side?: TimelineSide;
}

export const TimelineContent = ({
  children,
  className,
  side: sideProp,
  ...props
}: TimelineContentProps) => {
  const { slots } = useContext(TimelineContext);
  const { side } = useTimelineItem();
  const resolvedSide = sideProp ?? side;

  return jsx('div', {
    className: composeSlotClassName(slots?.content, className),
    'data-side': resolvedSide,
    'data-slot': 'timeline-content',
    ...props,
    children,
  });
};
