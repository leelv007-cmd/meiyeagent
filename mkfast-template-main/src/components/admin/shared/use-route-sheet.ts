import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Drives a sheet that a route owns instead of a trigger.
 *
 * A route-mounted sheet only renders while its route is active, so writing
 * `<Sheet open>` mounts the dialog already open. The popup then arrives in its
 * final state - no `data-starting-style`, opacity already 1 - and there is no
 * closed -> open change for the enter transition to run from, so it pops in
 * while every trigger-driven sheet slides. Mounting closed and opening on the
 * next commit gives the transition its starting frame.
 *
 * Closing is the mirror: navigating away on the click unmounts the sheet before
 * it can animate out, so the navigation waits for the exit transition instead.
 */
export function useRouteSheet(onClosed: () => void) {
  const [open, setOpen] = useState(false);
  const opened = useRef(false);

  useEffect(() => {
    setOpen(true);
  }, []);

  // Tracked off our own committed state rather than the matching
  // `onOpenChangeComplete(true)`: that callback is tied to the enter transition
  // finishing, and a browser that never runs it would leave this latch closed -
  // the sheet would then close without ever navigating back to the list.
  useEffect(() => {
    if (open) opened.current = true;
  }, [open]);

  const onOpenChangeComplete = useCallback(
    (isOpen: boolean) => {
      if (isOpen) return;
      // The closed state we mount in must not read as a close and navigate away
      // before the sheet has opened at all.
      if (opened.current) onClosed();
    },
    [onClosed]
  );

  return { open, onOpenChange: setOpen, onOpenChangeComplete };
}
