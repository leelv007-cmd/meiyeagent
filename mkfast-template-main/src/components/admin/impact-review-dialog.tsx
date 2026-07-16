import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  admin_impact_action_failed,
  admin_impact_cancel,
  admin_impact_changes,
  admin_impact_confirm,
  admin_impact_pending,
  admin_impact_reason_label,
  admin_impact_reason_min,
  admin_impact_reason_placeholder,
  admin_impact_review_title,
  admin_impact_scope,
} from '@/locale/paraglide/messages';
import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';

export const impactReasonSchema = z
  .string()
  .trim()
  .min(8, admin_impact_reason_min());

export interface ImpactReviewRequest {
  changes: string[];
  confirmLabel: string;
  description: string;
  initialReason?: string;
  scope: string;
  title: string;
  onConfirm: (reason: string) => Promise<void>;
}

export function ImpactReviewDialog({
  open,
  request,
  onOpenChange,
}: {
  open: boolean;
  request?: ImpactReviewRequest;
  onOpenChange: (open: boolean) => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const previouslyOpen = useRef(false);
  const returnFocus = useRef<HTMLElement | null>(null);
  if (open && !previouslyOpen.current && typeof document !== 'undefined') {
    returnFocus.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
  }
  previouslyOpen.current = open;

  useEffect(() => {
    if (!open) return;
    setReason(request?.initialReason ?? '');
    setError(undefined);
  }, [open, request]);

  const close = () => {
    if (pending) return;
    setReason('');
    setError(undefined);
    onOpenChange(false);
  };

  const confirm = async () => {
    if (!request) return;
    const parsed = impactReasonSchema.safeParse(reason);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message);
      return;
    }
    setPending(true);
    try {
      await request.onConfirm(parsed.data);
      setReason('');
      setError(undefined);
      onOpenChange(false);
    } catch {
      setError(admin_impact_action_failed());
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : close())}>
      <DialogContent className="sm:max-w-lg" finalFocus={returnFocus}>
        <DialogHeader>
          <DialogTitle>
            {request?.title ?? admin_impact_review_title()}
          </DialogTitle>
          <DialogDescription>{request?.description}</DialogDescription>
        </DialogHeader>
        <dl className="grid gap-3 rounded-lg border p-3">
          <div>
            <dt className="text-xs font-medium text-muted-foreground">
              {admin_impact_scope()}
            </dt>
            <dd className="mt-1 text-sm">{request?.scope}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-muted-foreground">
              {admin_impact_changes()}
            </dt>
            <dd className="mt-1">
              <ul className="list-disc space-y-1 pl-5 text-sm">
                {request?.changes.map((change) => (
                  <li key={change}>{change}</li>
                ))}
              </ul>
            </dd>
          </div>
        </dl>
        <div className="space-y-2">
          <Label htmlFor="impact-review-reason">
            {admin_impact_reason_label()}
          </Label>
          <Textarea
            autoFocus
            id="impact-review-reason"
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
              setError(undefined);
            }}
            placeholder={admin_impact_reason_placeholder()}
          />
          {error ? (
            <p className="text-xs text-destructive" role="alert">
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button
            disabled={pending}
            onClick={close}
            type="button"
            variant="outline"
          >
            {admin_impact_cancel()}
          </Button>
          <Button
            disabled={pending}
            onClick={() => void confirm()}
            type="button"
          >
            {pending
              ? admin_impact_pending()
              : (request?.confirmLabel ?? admin_impact_confirm())}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
