import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

// ── Record crumb ──
// The header trail is built from the nav tree, which only knows declared hrefs -
// so a record route (/admin/supply/tasks/$taskId) resolved to its SECTION and
// stopped there, leaving the section marked aria-current="page" while you were
// actually a level below it. The nav tree cannot label a record: the name lives
// in the record, which the page reads.
//
// So the page tells the header. A detail page calls useRecordCrumb(name) and the
// trail gains a final segment; the section above it becomes a link again. Pages
// that do not call it are unaffected - the trail simply ends at the section.
//
// Deliberately not route staticData: that is static, and these labels come from
// a query that resolves after the route matches. Deliberately not read out of
// the query caches by the header either - that would wire the shell to every
// feature's query keys.

interface RecordCrumbValue {
  label: string | undefined;
  setLabel: (label: string | undefined) => void;
}

const RecordCrumbContext = createContext<RecordCrumbValue>({
  label: undefined,
  setLabel: () => {},
});

export function RecordCrumbProvider({ children }: { children: ReactNode }) {
  const [label, setLabel] = useState<string | undefined>(undefined);
  const value = useMemo(() => ({ label, setLabel }), [label]);
  return (
    <RecordCrumbContext.Provider value={value}>
      {children}
    </RecordCrumbContext.Provider>
  );
}

/** The record segment for the current page, or undefined on a list page. */
export function useRecordCrumbLabel() {
  return useContext(RecordCrumbContext).label;
}

/**
 * Publish this page's record name to the header trail. Pass `undefined` while
 * the record is still loading - the trail then ends at the section rather than
 * flashing a placeholder.
 *
 * Clears on unmount, so navigating from a record back to its list cannot leave
 * a stale segment behind.
 */
export function useRecordCrumb(label: string | undefined) {
  const { setLabel } = useContext(RecordCrumbContext);
  useEffect(() => {
    setLabel(label);
    return () => setLabel(undefined);
  }, [label, setLabel]);
}
