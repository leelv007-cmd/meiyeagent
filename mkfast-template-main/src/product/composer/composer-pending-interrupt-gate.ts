export const PENDING_INTERRUPT_SUBMIT_HINT =
  '请先处理上方待确认事项，再开始新的创作。';

export function composerPendingInterruptGate(count: number): {
  blocked: boolean;
  hint: string | null;
} {
  return count > 0
    ? { blocked: true, hint: PENDING_INTERRUPT_SUBMIT_HINT }
    : { blocked: false, hint: null };
}
