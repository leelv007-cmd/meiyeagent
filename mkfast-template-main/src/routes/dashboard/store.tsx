import { DashboardHeader } from '@/components/layout/dashboard-header';
import { EmptyState, Widget } from '@/components/heroui-pro';
import {
  Alert,
  Button,
  buttonVariants,
  Input,
  Label,
  Skeleton,
  TextField,
} from '@heroui/react';
import {
  account_usage_retry,
  dashboard_store_accounts_empty,
  dashboard_store_address_label,
  dashboard_store_advertising_certificate_label,
  dashboard_store_booking_label,
  dashboard_store_city_label,
  dashboard_store_confirm_qualification,
  dashboard_store_confirmed,
  dashboard_store_description,
  dashboard_store_fact_kind_customer_case,
  dashboard_store_fact_kind_discount,
  dashboard_store_fact_kind_fulfillment,
  dashboard_store_fact_kind_group_buy,
  dashboard_store_fact_kind_other,
  dashboard_store_fact_kind_price,
  dashboard_store_fact_kind_qualification,
  dashboard_store_fact_kind_service,
  dashboard_store_fact_kind_staff_experience,
  dashboard_store_facts_description,
  dashboard_store_facts_empty,
  dashboard_store_facts_failed,
  dashboard_store_facts_loading,
  dashboard_store_facts_no_expiry,
  dashboard_store_facts_title,
  dashboard_store_facts_valid_until,
  dashboard_store_group_account,
  dashboard_store_group_projects,
  dashboard_store_group_voice,
  dashboard_store_institution_license_label,
  dashboard_store_intake_at_label,
  dashboard_store_name_label,
  dashboard_store_platform_certification_label,
  dashboard_store_profile_empty,
  dashboard_store_profile_title,
  dashboard_store_projects_empty,
  dashboard_store_qualification_required,
  dashboard_store_qualification_tab,
  dashboard_store_regulated_description,
  dashboard_store_regulated_label,
  dashboard_store_regulated_off,
  dashboard_store_regulated_on,
  dashboard_store_treatment_scope_label,
  dashboard_store_valid_until_label,
  product_navigation_store,
  product_navigation_workspace,
} from '@/locale/paraglide/messages';
import { formatLocaleDateTime } from '@/lib/locale';
import { appPageHead } from '@/lib/seo';
import { Routes } from '@/lib/routes';
import { queryP1 } from '@/p1/client';
import { p1QueryKeys } from '@/p1/query-keys';
import { optionalSourceId } from '@/p1/source-object-navigation';
import { useProductState } from '@/product/client';
import { requiresMedicalQualification } from '@/product/store-intake/store-industry';
import { StoreIntakeWizard } from '@/product/store-intake/store-intake-wizard';
import type { ProductCommand, StoreFact } from '@meiye/contracts';
import { useQuery } from '@tanstack/react-query';
import {
  IconAlertTriangle,
  IconCheck,
  IconFolderOff,
  IconRefresh,
  IconShieldCheck,
} from '@tabler/icons-react';
import { createFileRoute, Link, redirect } from '@tanstack/react-router';
import { useEffect, useState, type CSSProperties } from 'react';

/**
 * Store page — T33 / #227 reshell along the Composer trunk.
 *
 * The primary surface is now "see what I already have": the confirmed store
 * profile plus the StoreFact ledger projection (context module
 * `store_facts_active`), with the five-step intake living where T24 owns it —
 * the conversation.
 *
 * The qualification admission block stays on this page: D-151④ retired the
 * manual *store profile* form, not the regulated-category admission gate. It is
 * the only web entry for `confirm_qualification`, and without it a store with
 * `regulated: true` can never clear `confirmed_qualification` grounding.
 */
type StoreTab = 'profile' | 'assets' | 'qualification';

export const Route = createFileRoute('/dashboard/store')({
  validateSearch: (
    search: Record<string, unknown>
  ): { assetId?: string; tab?: StoreTab } => {
    const assetId = optionalSourceId(search.assetId);
    const tab =
      search.tab === 'profile' ||
      search.tab === 'assets' ||
      search.tab === 'qualification'
        ? search.tab
        : undefined;
    return {
      ...(assetId ? { assetId } : {}),
      ...(tab ? { tab } : {}),
    };
  },
  beforeLoad: ({ search }) => {
    if (search.assetId) {
      throw redirect({
        to: '/dashboard/assets/$assetId',
        params: { assetId: search.assetId },
      });
    }
    if (search.tab === 'assets') {
      throw redirect({ to: Routes.AssetLibrary });
    }
    if (search.tab === 'qualification') {
      throw redirect({
        to: Routes.StoreProfile,
        search: {},
        replace: true,
      });
    }
  },
  head: () => appPageHead(product_navigation_store()),
  component: StoreProfilePage,
});

function factKindLabel(kind: StoreFact['kind']) {
  switch (kind) {
    case 'service':
      return dashboard_store_fact_kind_service();
    case 'price':
      return dashboard_store_fact_kind_price();
    case 'discount':
      return dashboard_store_fact_kind_discount();
    case 'group_buy':
      return dashboard_store_fact_kind_group_buy();
    case 'qualification':
      return dashboard_store_fact_kind_qualification();
    case 'fulfillment':
      return dashboard_store_fact_kind_fulfillment();
    case 'staff_experience':
      return dashboard_store_fact_kind_staff_experience();
    case 'customer_case':
      return dashboard_store_fact_kind_customer_case();
    case 'other':
      return dashboard_store_fact_kind_other();
  }
}

/** Merchant-facing rendering of an arbitrary JSON fact value. */
function factValueText(value: StoreFact['value']) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return Object.values(value as Record<string, unknown>)
    .filter((entry) => entry !== null && typeof entry !== 'object')
    .map(String)
    .join(' · ');
}

function StoreProfilePage() {
  const { state, error, pending, execute, refresh } = useProductState();
  // The ledger is queried "as of now"; pinning it at mount keeps the query key
  // — and therefore the cache — stable while the page is open.
  const [factsAsOf, setFactsAsOf] = useState(() => new Date().toISOString());
  const workspaceId = state?.workspaceId;
  // ...but a Day-0 save happens on this very page, and it writes facts dated
  // after the pin. `store_facts_active` reads `at` as an upper bound, so those
  // facts stay invisible for as long as the merchant stays here: the archive
  // card reports the profile as confirmed while the fact ledger below it still
  // reads empty. Move the pin whenever the store profile moves.
  const storeRevision = state?.store?.revision;
  useEffect(() => {
    setFactsAsOf(new Date().toISOString());
  }, [storeRevision]);
  const factsPayload = {
    scope: { storeId: workspaceId ?? '' },
    at: factsAsOf,
  };
  const facts = useQuery({
    enabled: Boolean(workspaceId),
    queryKey: p1QueryKeys.request(
      'context',
      'store_facts_active',
      factsPayload
    ),
    queryFn: ({ signal }) =>
      queryP1<StoreFact[]>(
        'context',
        { action: 'store_facts_active', payload: factsPayload },
        signal
      ),
  });

  async function run(command: ProductCommand) {
    try {
      await execute(command);
    } catch {
      // Shared error surface handles the domain response.
    }
  }

  // Only the *first* load blanks the page. Gating on `loading` too would tear
  // the whole surface down on every background refresh — including the one the
  // intake wizard fires after a successful save, which unmounted the wizard
  // mid-acknowledgement and lost the merchant's "saved" confirmation.
  if (!state) {
    return (
      <div className="space-y-4 p-4 lg:p-6">
        <Skeleton className="h-12 rounded-xl" />
        <Skeleton className="h-96 rounded-2xl" />
      </div>
    );
  }

  const store = state.store;
  const showQualification = requiresMedicalQualification({
    regulated: store?.regulated,
    hasQualificationRecord: Boolean(state.qualification),
  });

  return (
    <>
      <DashboardHeader
        breadcrumbs={[
          { label: product_navigation_store(), isCurrentPage: true },
        ]}
        actions={
          <div className="flex items-center gap-2">
            {store?.confirmedAt ? (
              <span className="meiye-glass-piece text-muted inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs">
                <IconCheck className="size-3" />
                {dashboard_store_confirmed()}
              </span>
            ) : null}
            <Link
              className={buttonVariants({ size: 'sm', variant: 'outline' })}
              to={Routes.ContentWorkspace}
            >
              {product_navigation_workspace()}
            </Link>
          </div>
        }
      />
      <main className="mx-auto w-full max-w-6xl flex-1 p-4 lg:p-6">
        <div className="meiye-ambient-copy mb-6">
          <h1 className="meiye-type-title" data-testid="store-ambient-title">
            {product_navigation_store()}
          </h1>
          <p className="meiye-type-aux mt-1" data-testid="store-ambient-aux">
            {dashboard_store_description()}
          </p>
        </div>

        {error && (
          <Alert className="mb-4" status="danger">
            <Alert.Indicator>
              <IconAlertTriangle className="size-4" />
            </Alert.Indicator>
            <Alert.Content>
              <Alert.Title>{dashboard_store_facts_title()}</Alert.Title>
              <Alert.Description className="flex flex-wrap items-center justify-between gap-3">
                {dashboard_store_facts_failed()}
                <Button
                  onPress={() => void refresh()}
                  size="sm"
                  variant="outline"
                >
                  <IconRefresh className="size-4" />
                  {account_usage_retry()}
                </Button>
              </Alert.Description>
            </Alert.Content>
          </Alert>
        )}

        <div className="space-y-6">
          <Widget className="meiye-porcelain">
            <Widget.Header>
              {/*
                Pro's `Widget.Title` renders a `<span>`, so this page offered a
                screen reader nothing to jump between: one h1 and three blocks
                of unranked text. The vendor patch contract forbids changing
                what a component renders, so the heading is written here with
                the sheet's own slot class — same CSS, correct outline.
              */}
              <h2 className="widget__title">
                {dashboard_store_profile_title()}
              </h2>
            </Widget.Header>
            <Widget.Content>
              {store ? (
                <dl
                  className="grid gap-4 sm:grid-cols-2"
                  data-i18n-pass-through="store-profile"
                >
                  <ProfileFact
                    label={dashboard_store_name_label()}
                    value={store.name}
                  />
                  <ProfileFact
                    label={dashboard_store_city_label()}
                    value={`${store.city} ${store.district}`.trim()}
                  />
                  <ProfileFact
                    label={dashboard_store_address_label()}
                    value={store.address}
                  />
                  <ProfileFact
                    label={dashboard_store_booking_label()}
                    value={store.booking}
                  />
                  <ProfileFact
                    label={dashboard_store_group_account()}
                    value={
                      store.accounts
                        .map((account) => account.nickname)
                        .join(' · ') || dashboard_store_accounts_empty()
                    }
                  />
                  <ProfileFact
                    label={dashboard_store_group_projects()}
                    value={
                      store.projects
                        .map((project) => `${project.name} ¥${project.price}`)
                        .join(' · ') || dashboard_store_projects_empty()
                    }
                  />
                  <ProfileFact
                    className="sm:col-span-2"
                    label={dashboard_store_group_voice()}
                    value={store.brandVoice}
                  />
                  <ProfileFact
                    className="sm:col-span-2"
                    label={dashboard_store_regulated_label()}
                    value={
                      store.regulated
                        ? dashboard_store_regulated_on()
                        : dashboard_store_regulated_off()
                    }
                  />
                </dl>
              ) : (
                /* HeroUI's vendored empty-state.css paints the description with
                    `color: var(--muted)`, but inside .meiye-product-shell that
                    token is the muted *background* (--tint-hover, 4% ink / 6%
                    white) — measured 1.06:1, i.e. the line is invisible. Same
                    trap as OI-73 on the works surface; mapped back onto the ink
                    gradient here. Per-site on purpose: the shared-layer fix is
                    OI-48. */
                <EmptyState
                  style={{ '--muted': 'var(--ink-60)' } as CSSProperties}
                >
                  <EmptyState.Header>
                    <EmptyState.Media variant="icon">
                      <IconFolderOff className="size-6" />
                    </EmptyState.Media>
                    <EmptyState.Description data-testid="store-profile-empty-description">
                      {dashboard_store_profile_empty()}
                    </EmptyState.Description>
                  </EmptyState.Header>
                </EmptyState>
              )}
            </Widget.Content>
          </Widget>

          <Widget className="meiye-porcelain">
            <Widget.Header>
              <h2 className="widget__title">{dashboard_store_facts_title()}</h2>
              <Widget.Description>
                {dashboard_store_facts_description()}
              </Widget.Description>
            </Widget.Header>
            <Widget.Content>
              {facts.isPending ? (
                <p aria-live="polite" className="text-muted text-sm">
                  {dashboard_store_facts_loading()}
                </p>
              ) : facts.isError ? (
                <div className="flex flex-wrap items-center gap-3">
                  <p className="text-muted text-sm">
                    {dashboard_store_facts_failed()}
                  </p>
                  <Button
                    onPress={() => void facts.refetch()}
                    size="sm"
                    variant="outline"
                  >
                    <IconRefresh className="size-4" />
                    {account_usage_retry()}
                  </Button>
                </div>
              ) : facts.data.length === 0 ? (
                <p className="text-muted text-sm">
                  {dashboard_store_facts_empty()}
                </p>
              ) : (
                <ul className="divide-divider divide-y">
                  {facts.data.map((fact) => (
                    <li
                      className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-3 first:pt-0 last:pb-0"
                      key={`${fact.factId}:${fact.revision}`}
                    >
                      <span className="meiye-glass-trace text-muted shrink-0 rounded-full px-2 py-0.5 text-xs">
                        {factKindLabel(fact.kind)}
                      </span>
                      <span
                        className="text-foreground min-w-0 flex-1 text-sm"
                        data-i18n-pass-through="store-fact"
                      >
                        {factValueText(fact.value)}
                      </span>
                      <span className="text-muted text-xs">
                        {fact.expiresAt
                          ? dashboard_store_facts_valid_until({
                              date: formatLocaleDateTime(fact.expiresAt),
                            })
                          : dashboard_store_facts_no_expiry()}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Widget.Content>
          </Widget>

          {/* D-151④ retired the manual profile form and promised the five-step
              wizard would take its place here once W02 landed. This is that
              entry: the same wizard the asset library mounts, writing through
              the one finalize channel. */}
          <StoreIntakeWizard product={{ refresh, state }} surface="store" />

          {/* D-C3: this is a regulated-category admission form, and the first
              launch admits no medical category — so an ordinary beauty store is
              no longer asked for a clinic licence it must never hold. The block
              itself is unchanged and returns for any store the platform marks
              regulated, or one that already filed a record. */}
          {showQualification ? (
            <Widget className="meiye-porcelain" id="store-qualification">
              <Widget.Header>
                <h2 className="widget__title">
                  {dashboard_store_qualification_tab()}
                </h2>
                <Widget.Description>
                  {dashboard_store_regulated_description()}
                </Widget.Description>
              </Widget.Header>
              <Widget.Content>
                {store?.regulated && !state.qualification?.confirmed ? (
                  <output
                    className="text-foreground mb-4 block text-sm"
                    data-testid="store-qualification-required"
                  >
                    {dashboard_store_qualification_required()}
                  </output>
                ) : null}
                <QualificationForm
                  existing={state.qualification}
                  onConfirm={(qualification) =>
                    void run({ type: 'confirm_qualification', qualification })
                  }
                  pending={pending}
                />
              </Widget.Content>
            </Widget>
          ) : null}
        </div>
      </main>
    </>
  );
}

function ProfileFact({
  className,
  label,
  value,
}: {
  className?: string;
  label: string;
  value: string;
}) {
  return (
    <div className={className}>
      <dt className="text-muted text-xs">{label}</dt>
      <dd className="text-foreground mt-1 text-sm">{value}</dd>
    </div>
  );
}

function Field({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <TextField onChange={onChange} value={value}>
      <Label>{label}</Label>
      <Input />
    </TextField>
  );
}

function QualificationForm({
  existing,
  onConfirm,
  pending,
}: {
  existing?: {
    institutionLicense?: string;
    treatmentScope?: string;
    platformCertification?: string;
    advertisingCertificate?: string;
    validUntil?: string;
    intakeAt?: string;
  };
  onConfirm: (qualification: {
    admitted: boolean;
    institutionLicense: string;
    treatmentScope: string;
    platformCertification: string;
    advertisingCertificate: string;
    validUntil: string;
    intakeAt: string;
  }) => void;
  pending: boolean;
}) {
  const [qualification, setQualification] = useState({
    institutionLicense: existing?.institutionLicense ?? '',
    treatmentScope: existing?.treatmentScope ?? '',
    platformCertification: existing?.platformCertification ?? '',
    advertisingCertificate: existing?.advertisingCertificate ?? '',
    validUntil: existing?.validUntil ?? '',
    intakeAt: existing?.intakeAt ?? new Date().toISOString().slice(0, 10),
  });
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {Object.entries({
        institutionLicense: dashboard_store_institution_license_label(),
        treatmentScope: dashboard_store_treatment_scope_label(),
        platformCertification: dashboard_store_platform_certification_label(),
        advertisingCertificate: dashboard_store_advertising_certificate_label(),
        validUntil: dashboard_store_valid_until_label(),
        intakeAt: dashboard_store_intake_at_label(),
      }).map(([key, label]) => (
        <Field
          key={key}
          label={label}
          onChange={(value) =>
            setQualification({ ...qualification, [key]: value })
          }
          value={qualification[key as keyof typeof qualification]}
        />
      ))}
      <div className="border-divider flex justify-end border-t pt-4 md:col-span-2">
        <Button
          data-testid="store-confirm-qualification"
          isDisabled={
            pending ||
            !qualification.institutionLicense ||
            !qualification.treatmentScope
          }
          onPress={() => onConfirm({ ...qualification, admitted: true })}
        >
          <IconShieldCheck className="size-4" />
          {dashboard_store_confirm_qualification()}
        </Button>
      </div>
    </div>
  );
}
