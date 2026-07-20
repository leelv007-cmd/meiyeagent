import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  assisted_intake_amount,
  assisted_intake_confirm,
  assisted_intake_confirmed,
  assisted_intake_effective,
  assisted_intake_expiry,
  assisted_intake_expiry_none,
  assisted_intake_manual,
  assisted_intake_paste,
  assisted_intake_prepare,
  assisted_intake_preview,
  assisted_intake_screenshot,
  assisted_intake_screenshot_first,
  assisted_intake_source,
  assisted_intake_text,
  assisted_intake_title,
  assisted_intake_trigger,
} from '@/locale/paraglide/messages';
import type {
  AssetIntakeBatch,
  PrepareAssistedPriceIntakeCommand,
  StoreFact,
} from '@meiye/contracts';
import { useEffect, useState } from 'react';

type AssistedInputMode = PrepareAssistedPriceIntakeCommand['inputMode'];

export function AssistedAssetIntake({
  autoOpen,
  onConfirm,
  onPrepare,
  screenshotAssetIds,
  storeId,
}: {
  autoOpen: boolean;
  onConfirm: (input: {
    batchId: string;
    candidateId: string;
    factId: string;
    expectedFactRevision: number;
  }) => Promise<StoreFact>;
  onPrepare: (
    input: PrepareAssistedPriceIntakeCommand
  ) => Promise<AssetIntakeBatch>;
  screenshotAssetIds: string[];
  storeId: string;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<AssistedInputMode>('paste_text');
  const [text, setText] = useState('');
  const [amount, setAmount] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [prepared, setPrepared] = useState<AssetIntakeBatch>();
  const [confirmedRevision, setConfirmedRevision] = useState<number>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (autoOpen) setOpen(true);
  }, [autoOpen]);
  const candidate = prepared?.candidates.find(
    (item) => item.objectKind === 'store_fact'
  );

  const canPrepare =
    storeId.length > 0 &&
    (mode === 'manual_select'
      ? Number.isFinite(Number(amount)) && amount.trim().length > 0
      : text.trim().length > 0 &&
        (mode !== 'screenshot' || screenshotAssetIds.length > 0));

  const prepare = async () => {
    const suffix = crypto.randomUUID();
    const base = {
      batchId: `assisted-${suffix}`,
      taskId: `assisted-task-${suffix}`,
      candidateId: `assisted-price-${suffix}`,
      key: 'offer.price',
      scope: { storeId },
      effectiveFrom: new Date().toISOString(),
      expiresAt: expiryDate
        ? new Date(`${expiryDate}T23:59:59+08:00`).toISOString()
        : null,
    };
    const input: PrepareAssistedPriceIntakeCommand =
      mode === 'screenshot'
        ? {
            ...base,
            inputMode: mode,
            screenshotAssetId: screenshotAssetIds[0]!,
            recognizedText: text,
          }
        : mode === 'paste_text'
          ? { ...base, inputMode: mode, pastedText: text }
          : {
              ...base,
              inputMode: mode,
              amount: Number(amount),
              currency: 'CNY',
            };
    setPending(true);
    setError(undefined);
    try {
      setPrepared(await onPrepare(input));
      setConfirmedRevision(undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setPending(false);
    }
  };

  const confirm = async () => {
    if (!prepared || !candidate) return;
    setPending(true);
    setError(undefined);
    try {
      const fact = await onConfirm({
        batchId: prepared.batchId,
        candidateId: candidate.candidateId,
        factId: `fact-${candidate.candidateId}`,
        expectedFactRevision: 0,
      });
      setConfirmedRevision(fact.revision);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="space-y-3 rounded-2xl border border-divider bg-background/80 p-3">
      <Button
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        size="sm"
        type="button"
        variant="outline"
      >
        {assisted_intake_trigger()}
      </Button>
      {open ? (
        <div className="space-y-3" data-testid="assisted-asset-intake">
          <p className="text-sm font-medium">{assisted_intake_title()}</p>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ['screenshot', assisted_intake_screenshot()],
                ['paste_text', assisted_intake_paste()],
                ['manual_select', assisted_intake_manual()],
              ] as const
            ).map(([inputMode, label]) => (
              <Button
                aria-pressed={mode === inputMode}
                key={inputMode}
                onClick={() => {
                  setMode(inputMode);
                  setPrepared(undefined);
                  setConfirmedRevision(undefined);
                }}
                size="sm"
                type="button"
                variant={mode === inputMode ? 'secondary' : 'ghost'}
              >
                {label}
              </Button>
            ))}
          </div>
          {mode === 'manual_select' ? (
            <Input
              aria-label={assisted_intake_amount()}
              min="0"
              onChange={(event) => setAmount(event.target.value)}
              placeholder={assisted_intake_amount()}
              step="0.01"
              type="number"
              value={amount}
            />
          ) : (
            <Textarea
              aria-label={assisted_intake_text()}
              onChange={(event) => setText(event.target.value)}
              placeholder={assisted_intake_text()}
              value={text}
            />
          )}
          {mode === 'screenshot' && screenshotAssetIds.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {assisted_intake_screenshot_first()}
            </p>
          ) : null}
          <label
            className="block space-y-1 text-xs text-muted-foreground"
            htmlFor="assisted-intake-expiry"
          >
            <span>{assisted_intake_expiry()}</span>
            <Input
              id="assisted-intake-expiry"
              onChange={(event) => setExpiryDate(event.target.value)}
              type="date"
              value={expiryDate}
            />
          </label>
          <Button
            disabled={!canPrepare || pending}
            onClick={() => void prepare()}
            size="sm"
            type="button"
          >
            {assisted_intake_prepare()}
          </Button>
          {candidate?.objectKind === 'store_fact' ? (
            <div
              aria-live="polite"
              className="space-y-1 rounded-xl bg-muted p-3 text-xs"
              data-testid="assisted-intake-preview"
            >
              <p className="font-medium">{assisted_intake_preview()}</p>
              <p>{JSON.stringify(candidate.fact.value)}</p>
              <p>
                {assisted_intake_source()}: {candidate.fact.source.referenceId}
              </p>
              <p>
                {assisted_intake_effective()}: {candidate.fact.effectiveFrom}
              </p>
              <p>
                {assisted_intake_expiry()}:{' '}
                {candidate.fact.expiresAt ?? assisted_intake_expiry_none()}
              </p>
              {confirmedRevision ? (
                <p>
                  {assisted_intake_confirmed({ revision: confirmedRevision })}
                </p>
              ) : (
                <Button
                  disabled={pending}
                  onClick={() => void confirm()}
                  size="sm"
                  type="button"
                >
                  {assisted_intake_confirm()}
                </Button>
              )}
            </div>
          ) : null}
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
