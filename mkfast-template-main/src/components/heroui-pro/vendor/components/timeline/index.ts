import type { ComponentProps } from 'react';
import {
  TimelineConnector,
  TimelineContent,
  TimelineItem,
  TimelineMarker,
  TimelineRail,
  TimelineRoot,
  useTimelineItem,
} from './timeline';

export const Timeline = Object.assign(TimelineRoot, {
  Connector: TimelineConnector,
  Content: TimelineContent,
  Item: TimelineItem,
  Marker: TimelineMarker,
  Rail: TimelineRail,
  Root: TimelineRoot,
  useItem: useTimelineItem,
});

export type Timeline = {
  ConnectorProps: ComponentProps<typeof TimelineConnector>;
  ContentProps: ComponentProps<typeof TimelineContent>;
  ItemProps: ComponentProps<typeof TimelineItem>;
  MarkerProps: ComponentProps<typeof TimelineMarker>;
  Props: ComponentProps<typeof TimelineRoot>;
  RailProps: ComponentProps<typeof TimelineRail>;
  RootProps: ComponentProps<typeof TimelineRoot>;
};

export {
  TimelineConnector,
  TimelineContent,
  TimelineItem,
  TimelineMarker,
  TimelineRail,
  TimelineRoot,
  useTimelineItem,
};

export type {
  TimelineAxis,
  TimelineConnectorProps,
  TimelineContentProps,
  TimelineItemAlign,
  TimelineItemProps,
  TimelineMarkerProps,
  TimelinePlacement,
  TimelineRootProps as TimelineProps,
  TimelineRailProps,
  TimelineRootProps,
  TimelineSide,
  TimelineStatus,
} from './timeline';
export type { TimelineVariants } from './timeline.styles';
export { timelineVariants } from './timeline.styles';
