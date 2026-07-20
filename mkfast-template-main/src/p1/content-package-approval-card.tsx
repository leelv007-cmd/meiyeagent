import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  content_package_delivery_approval_account,
  content_package_delivery_approval_confirm,
  content_package_delivery_approval_cost,
  content_package_delivery_approval_hint,
  content_package_delivery_approval_schedule,
  content_package_delivery_approval_title,
} from '@/locale/paraglide/messages';
import type { FormEvent } from 'react';

/** Shared approval form used by Pending Actions, not the retired package detail. */
export function ContentPackageApprovalCard({
  disabled,
  onApprove,
}: {
  disabled: boolean;
  onApprove(input: {
    accountId: string;
    actionScheduledAt: string;
    cost: { amount: number; currency: 'CNY' };
  }): void;
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const accountId = String(form.get('accountId') ?? '').trim();
    const scheduled = String(form.get('actionScheduledAt') ?? '').trim();
    const amount = Number(form.get('cost') ?? 0);
    if (!accountId || !scheduled || !Number.isFinite(amount) || amount < 0) {
      return;
    }
    onApprove({
      accountId,
      actionScheduledAt: new Date(scheduled).toISOString(),
      cost: { amount, currency: 'CNY' },
    });
  }

  return (
    <form
      className="space-y-3 rounded-md border border-divider p-3"
      onSubmit={submit}
    >
      <div>
        <p className="font-medium">
          {content_package_delivery_approval_title()}
        </p>
        <p className="text-xs text-muted-foreground">
          {content_package_delivery_approval_hint()}
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor="content-package-delivery-account">
            {content_package_delivery_approval_account()}
          </Label>
          <Input
            disabled={disabled}
            id="content-package-delivery-account"
            name="accountId"
            required
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="content-package-delivery-schedule">
            {content_package_delivery_approval_schedule()}
          </Label>
          <Input
            disabled={disabled}
            id="content-package-delivery-schedule"
            name="actionScheduledAt"
            required
            type="datetime-local"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="content-package-delivery-cost">
            {content_package_delivery_approval_cost()}
          </Label>
          <Input
            defaultValue="0"
            disabled={disabled}
            id="content-package-delivery-cost"
            min="0"
            name="cost"
            required
            step="0.01"
            type="number"
          />
        </div>
      </div>
      <Button disabled={disabled} type="submit">
        {content_package_delivery_approval_confirm()}
      </Button>
    </form>
  );
}
