import { Link } from '@tanstack/react-router';

import {
  workbench_credit_buy_booster,
  workbench_credit_upgrade,
} from '@/locale/paraglide/messages';

import { CREDIT_PURCHASE_DESTINATIONS } from './credit-purchase-navigation';

/** The two distinct recovery exits shown wherever a quoted run is short. */
export function WorkbenchCreditPurchaseActions() {
  return (
    <div className="flex flex-wrap gap-3 text-sm font-medium underline underline-offset-4">
      <Link
        data-testid="workbench-credit-buy-booster"
        hash={CREDIT_PURCHASE_DESTINATIONS.booster.hash}
        to={CREDIT_PURCHASE_DESTINATIONS.booster.to}
      >
        {workbench_credit_buy_booster()}
      </Link>
      <Link
        data-testid="workbench-credit-upgrade"
        hash={CREDIT_PURCHASE_DESTINATIONS.upgrade.hash}
        to={CREDIT_PURCHASE_DESTINATIONS.upgrade.to}
      >
        {workbench_credit_upgrade()}
      </Link>
    </div>
  );
}
