import { formatLocaleDate } from '@/lib/locale';
import {
  memory_entry_source_available,
  memory_entry_source_deleted,
  memory_entry_source_unavailable,
} from '@/locale/paraglide/messages';

type MemorySource =
  | {
      status?: 'available' | 'deleted' | 'unavailable';
      preview?: string | null;
      observedAt?: string | null;
      deleted?: boolean;
    }
  | null
  | undefined;

/** Shared merchant-facing source semantics for vault rows and receipts. */
export function formatMemorySource(source: MemorySource): string {
  if (source?.deleted || source?.status === 'deleted') {
    return memory_entry_source_deleted();
  }
  if (
    source?.status !== 'unavailable' &&
    source?.preview &&
    source.observedAt
  ) {
    return memory_entry_source_available({
      date: formatLocaleDate(source.observedAt),
      preview: source.preview,
    });
  }
  return memory_entry_source_unavailable();
}
