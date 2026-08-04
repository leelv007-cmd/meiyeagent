import { commandP1 } from '@/p1/client';
import { useMutation } from '@tanstack/react-query';
import { useRef } from 'react';

export type ResultCommandTransport = (
  module: Parameters<typeof commandP1>[0],
  call: Parameters<typeof commandP1>[1],
  idempotencyKey?: string
) => Promise<unknown>;

type IntentAction =
  | 'result_adjust'
  | 'result_adjust_prepare'
  | 'result_adopt'
  | 'result_export';

type Run = () => Promise<unknown>;

export function useResultCommands(
  transport: ResultCommandTransport = commandP1
) {
  const intentKeys = useRef(new Map<string, string>());
  const command = useMutation({
    mutationFn: (input: {
      module: Parameters<typeof commandP1>[0];
      call: Parameters<typeof commandP1>[1];
      idempotencyKey?: string;
    }) => transport(input.module, input.call, input.idempotencyKey),
  });
  const adjust = useMutation({ mutationFn: (run: Run) => run() });
  const shellAction = useMutation({ mutationFn: (run: Run) => run() });
  const closeLoop = useMutation({ mutationFn: (run: Run) => run() });

  const execute = <T>(
    module: Parameters<typeof commandP1>[0],
    call: Parameters<typeof commandP1>[1],
    idempotencyKey?: string
  ) => command.mutateAsync({ module, call, idempotencyKey }) as Promise<T>;

  const executeIntent = async <T>(
    fingerprint: string,
    action: IntentAction,
    payload: Record<string, unknown>
  ) => {
    const key = intentKeys.current.get(fingerprint) ?? crypto.randomUUID();
    intentKeys.current.set(fingerprint, key);
    const result = await execute<T>(
      'result-delivery',
      { action, payload },
      key
    );
    intentKeys.current.delete(fingerprint);
    return result;
  };

  const keyFor = (fingerprint: string) => {
    const key = intentKeys.current.get(fingerprint) ?? crypto.randomUUID();
    intentKeys.current.set(fingerprint, key);
    return key;
  };

  return {
    adopt: <T>(fingerprint: string, payload: Record<string, unknown>) =>
      executeIntent<T>(fingerprint, 'result_adopt', payload),
    exportResult: <T>(fingerprint: string, payload: Record<string, unknown>) =>
      executeIntent<T>(fingerprint, 'result_export', payload),
    prepareAdjust: <T>(fingerprint: string, payload: Record<string, unknown>) =>
      executeIntent<T>(fingerprint, 'result_adjust_prepare', payload),
    confirmAdjust: <T>(fingerprint: string, payload: Record<string, unknown>) =>
      executeIntent<T>(fingerprint, 'result_adjust', payload),
    execute,
    keyFor,
    releaseKey: (fingerprint: string) => intentKeys.current.delete(fingerprint),
    runAdjust: <T>(run: () => Promise<T>) =>
      adjust.mutateAsync(run as Run) as Promise<T>,
    runShellAction: <T>(run: () => Promise<T>) =>
      shellAction.mutateAsync(run as Run) as Promise<T>,
    runCloseLoop: <T>(run: () => Promise<T>) =>
      closeLoop.mutateAsync(run as Run) as Promise<T>,
    adjustBusy: adjust.isPending,
    shellActionBusy: shellAction.isPending,
    closeLoopPending: closeLoop.isPending,
  };
}
