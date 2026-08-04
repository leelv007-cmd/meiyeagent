# Payment (Waffo / Stripe)

New subscription and credit-package checkout uses **Waffo Pancake** through
the shared `PaymentProvider` interface. Stripe remains available only for
controlled legacy webhook processing and does not publish a sellable catalog.
Set `VITE_PAYMENT_PROVIDER` to `waffo`, `stripe`, or `''` (disabled). See
[Env](./env.md) for configuration details.

### Shared routes

- **Pricing**: `/pricing` - plans and checkout buttons.
- **Payment callback**: `/payment?session_id=...&callback=/settings/billing` -
  polls until paid, then redirects.
- **Billing**: `/settings/billing` - current plan and subscription management.

### Shared server API (Server Functions)

- `createCheckoutSession` - create a checkout session and return its redirect
  URL.
- `createCustomerPortalSession` - create a billing portal session.
- `getCurrentPlan` - return the current plan and subscription for a user.
- `checkPaymentCompletion` - report whether a session is paid.

### Module layout

| Path | Purpose |
|------|---------|
| `src/payment/types.ts` | `PaymentProvider` interface and shared types |
| `src/payment/index.ts` | Provider registry and exported functions |
| `src/payment/provider/waffo.ts` | Waffo checkout, portal, and webhook provider |
| `src/payment/provider/stripe.ts` | Legacy Stripe webhook provider |
| `src/routes/api/webhooks/waffo.ts` | Waffo webhook route |
| `src/routes/api/webhooks/stripe.ts` | Legacy Stripe webhook route |
| `src/config/website.ts` | Runtime policy and Waffo product catalog wiring |

---

## Waffo Pancake

### Setup

1. Configure server-only credentials through the deployment secret store:
   `WAFFO_MERCHANT_ID`, `WAFFO_PRIVATE_KEY`, and the environment-specific
   webhook public key. `WAFFO_STORE_ID` is required for authoritative order
   reads when a paid lifecycle webhook omits billing-period fields.
2. Select `WAFFO_ENVIRONMENT=test` for Test fixtures or `production` for
   Production authority. Test checkout also requires
   `VITE_WAFFO_TEST_CHECKOUT_ENABLED=true` and all nine subscription product
   IDs. Do not publish or route Production traffic as part of local setup.
3. Configure the webhook endpoint as
   `https://your-domain.com/api/webhooks/waffo`. Signatures arrive in
   `X-Waffo-Signature` and are verified with RSA-SHA256 against the public key
   for the selected environment.
4. Configure `WAFFO_CREDIT_PACKAGE_PRODUCT_MAPPING` for fixed one-time credit
   package products. Product facts are validated against the checkout binding
   snapshot before settlement.

## Stripe retirement compatibility

The Stripe route remains reachable for controlled legacy webhooks. Configure
`STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` when that compatibility path is
needed. Runtime policy deliberately publishes empty Stripe price IDs, so it
cannot create new commerce. Use `pnpm payment:audit-stripe-retirement` for the
read-only local retirement audit.
