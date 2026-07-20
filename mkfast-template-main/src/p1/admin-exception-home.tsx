import { useMemo } from 'react';

import { ExceptionHomePanel } from '@/components/admin/capability/exception-home-panel';
import {
  buildExceptionHomeView,
  type BuildExceptionHomeInput,
  type ExceptionHomeView,
} from '@/p1/admin-exception-home-model';

/**
 * Admin exception-first home control (J2 / D-055).
 * Pure projection from ActionableInboxItem + capability registry metrics.
 * Live pending-actions fetch stays with Z2-WIRING / #94 service assembly.
 */
export function AdminExceptionHome({
  view: viewProp,
  input,
}: {
  view?: ExceptionHomeView;
  input?: BuildExceptionHomeInput;
} = {}) {
  const view = useMemo(
    () => viewProp ?? buildExceptionHomeView(input),
    [viewProp, input]
  );

  return <ExceptionHomePanel view={view} />;
}
