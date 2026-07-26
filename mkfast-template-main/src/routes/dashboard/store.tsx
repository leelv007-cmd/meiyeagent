import heroUiGlassCss from '@/components/heroui-pro/heroui-glass.css?url';
import { DashboardHeader } from '@/components/layout/dashboard-header';
import { EmptyState, Widget } from '@/components/heroui-pro';
import {
  Alert,
  Button,
  buttonVariants,
  Checkbox,
  Input,
  Label,
  ListBox,
  Select,
  Skeleton,
  Tabs,
  TextArea,
  TextField,
} from '@heroui/react';
import {
  account_usage_retry,
  dashboard_store_account_label,
  dashboard_store_account_notes_label,
  dashboard_store_accounts_empty,
  dashboard_store_add_project,
  dashboard_store_address_label,
  dashboard_store_advertising_certificate_label,
  dashboard_store_booking_label,
  dashboard_store_brand_voice_label,
  dashboard_store_city_label,
  dashboard_store_confirm_facts,
  dashboard_store_confirm_qualification,
  dashboard_store_confirmed,
  dashboard_store_delete_project,
  dashboard_store_description,
  dashboard_store_district_label,
  dashboard_store_douyin_account_label,
  dashboard_store_draft_source,
  dashboard_store_duration_minutes_label,
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
  dashboard_store_generate_draft,
  dashboard_store_group_account,
  dashboard_store_group_profile,
  dashboard_store_group_projects,
  dashboard_store_group_voice,
  dashboard_store_institution_license_label,
  dashboard_store_intake_action,
  dashboard_store_intake_at_label,
  dashboard_store_intake_description,
  dashboard_store_intake_title,
  dashboard_store_manual_confirmation_required,
  dashboard_store_manual_description,
  dashboard_store_manual_title,
  dashboard_store_name_label,
  dashboard_store_pasted_facts_label,
  dashboard_store_pasted_facts_placeholder,
  dashboard_store_platform_certification_label,
  dashboard_store_price_label,
  dashboard_store_profile_empty,
  dashboard_store_profile_tab,
  dashboard_store_profile_title,
  dashboard_store_project_name_label,
  dashboard_store_project_number,
  dashboard_store_project_price_label,
  dashboard_store_projects_empty,
  dashboard_store_qualification_tab,
  dashboard_store_regulated_description,
  dashboard_store_regulated_label,
  dashboard_store_regulated_off,
  dashboard_store_regulated_on,
  dashboard_store_save_failed,
  dashboard_store_treatment_scope_label,
  dashboard_store_unconfirmed_draft,
  dashboard_store_valid_until_label,
  dashboard_store_verification_label,
  dashboard_store_verification_restricted,
  dashboard_store_verification_unverified,
  dashboard_store_verification_verified,
  dashboard_store_xiaohongshu_homepage_label,
  product_navigation_leads,
  product_navigation_store,
  product_navigation_workspace,
  store_save_failed_description,
} from '@/locale/paraglide/messages';
import { formatLocaleDateTime } from '@/lib/locale';
import { Routes } from '@/lib/routes';
import { queryP1 } from '@/p1/client';
import { p1QueryKeys } from '@/p1/query-keys';
import { optionalSourceId } from '@/p1/source-object-navigation';
import { useComplianceDefaults } from '@/p1/use-compliance-defaults';
import { useProductState } from '@/product/client';
import {
  missingStoreProfileFields,
  type StoreProfileForm,
} from '@/product/store-profile-form';
import type { ProductCommand, StoreFact } from '@meiye/contracts';
import { useQuery } from '@tanstack/react-query';
import {
  IconAlertTriangle,
  IconArchive,
  IconCheck,
  IconFileText,
  IconFolderOff,
  IconMessage2,
  IconRefresh,
  IconShieldCheck,
  IconTrash,
} from '@tabler/icons-react';
import { createFileRoute, Link, redirect } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';

/**
 * Store page — T33 / #227 reshell along the Composer trunk.
 *
 * The primary surface is now "see what I already have": the confirmed store
 * profile plus the StoreFact ledger projection (context module
 * `store_facts_active`), with the five-step intake living where T24 owns it —
 * the conversation.
 */
type StoreTab = 'profile' | 'assets' | 'qualification';

export const Route = createFileRoute('/dashboard/store')({
  head: () => ({ links: [{ rel: 'stylesheet', href: heroUiGlassCss }] }),
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
  },
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
  const { tab: sourceTab } = Route.useSearch();
  const { state, error, loading, pending, execute, refresh } =
    useProductState();
  const complianceDefaults = useComplianceDefaults();
  const regulatedDefaultApplied = useRef(false);
  const regulatedTouched = useRef(false);
  const [pastedFacts, setPastedFacts] = useState('');
  // The ledger is queried "as of now"; pinning it at mount keeps the query key
  // — and therefore the cache — stable while the page is open.
  const [factsAsOf] = useState(() => new Date().toISOString());
  const [form, setForm] = useState<StoreProfileForm>({
    name: '',
    city: '',
    district: '',
    address: '',
    booking: '',
    brandVoice: '',
    projectName: '',
    projectPrice: '',
    account: '',
    accountHomepage: '',
    accountVerification: 'unverified' as
      | 'unverified'
      | 'verified'
      | 'restricted',
    accountNotes: '',
    douyinAccount: '',
    regulated: false,
  });
  const [extraProjects, setExtraProjects] = useState<
    Array<{ id: string; name: string; price: string; durationMinutes: string }>
  >([]);
  const missingRequiredFields = missingStoreProfileFields(form);
  const workspaceId = state?.workspaceId;
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

  useEffect(() => {
    if (
      state?.store ||
      regulatedDefaultApplied.current ||
      regulatedTouched.current ||
      !complianceDefaults.data
    ) {
      return;
    }
    regulatedDefaultApplied.current = true;
    setForm((current) => ({
      ...current,
      regulated: complianceDefaults.data['compliance.regulated_mode.default'],
    }));
  }, [complianceDefaults.data, state?.store]);

  useEffect(() => {
    if (!state?.store) return;
    setForm({
      name: state.store.name,
      city: state.store.city,
      district: state.store.district,
      address: state.store.address,
      booking: state.store.booking,
      brandVoice: state.store.brandVoice,
      projectName: state.store.projects[0]?.name ?? '',
      projectPrice: String(state.store.projects[0]?.price ?? ''),
      account: state.store.accounts[0]?.nickname ?? '',
      accountHomepage:
        state.store.accounts.find((item) => item.platform === 'xiaohongshu')
          ?.homepageUrl ?? '',
      accountVerification:
        state.store.accounts.find((item) => item.platform === 'xiaohongshu')
          ?.verificationStatus ?? 'unverified',
      accountNotes:
        state.store.accounts.find((item) => item.platform === 'xiaohongshu')
          ?.notes ?? '',
      douyinAccount:
        state.store.accounts.find((item) => item.platform === 'douyin')
          ?.nickname ?? '',
      regulated: state.store.regulated,
    });
    setExtraProjects(
      state.store.projects.slice(1).map((project) => ({
        id: project.id,
        name: project.name,
        price: String(project.price),
        durationMinutes: String(project.durationMinutes),
      }))
    );
  }, [state?.store]);

  async function run(command: ProductCommand) {
    try {
      await execute(command);
    } catch {
      // Shared error surface handles the domain response.
    }
  }

  async function deriveDraft() {
    const price = pastedFacts.match(/(?:¥|￥)?\s*(\d{2,5})/)?.[1] ?? '';
    const name = pastedFacts.split(/[，。\n]/)[0]?.trim() || '';
    const projectName = pastedFacts.includes('猫眼') ? '透亮猫眼' : '';
    setForm((current) => ({
      ...current,
      name: current.name || name,
      projectPrice: current.projectPrice || price,
      projectName: current.projectName || projectName,
    }));
    await run({
      type: 'save_store_draft',
      sourceText: pastedFacts,
      extracted: {
        name: name || undefined,
        projectName: projectName || undefined,
        projectPrice: price ? Number(price) : undefined,
      },
    });
  }

  async function confirmStore() {
    await run({
      type: 'confirm_store',
      store: {
        name: form.name,
        city: form.city,
        district: form.district,
        address: form.address,
        booking: form.booking,
        brandVoice: form.brandVoice,
        prohibitions: ['不虚构价格与活动', '不承诺不可核验效果'],
        accounts: [
          ...(form.account
            ? [
                {
                  platform: 'xiaohongshu' as const,
                  nickname: form.account,
                  homepageUrl: form.accountHomepage || undefined,
                  verificationStatus: form.accountVerification,
                  notes: form.accountNotes || undefined,
                },
              ]
            : []),
          ...(form.douyinAccount
            ? [{ platform: 'douyin' as const, nickname: form.douyinAccount }]
            : []),
        ],
        projects: [
          {
            id:
              state?.store?.projects[0]?.id ?? `project-${crypto.randomUUID()}`,
            name: form.projectName,
            price: Number(form.projectPrice),
            durationMinutes: 90,
            confirmed: true,
          },
          ...extraProjects
            .filter((project) => project.name && Number(project.price))
            .map((project) => ({
              id: project.id,
              name: project.name,
              price: Number(project.price),
              durationMinutes: Number(project.durationMinutes) || 60,
              confirmed: true,
            })),
        ],
        regulated: form.regulated,
      },
    });
  }

  if (loading || !state) {
    return (
      <div className="meiye-heroui-glass space-y-4 p-4 lg:p-6">
        <Skeleton className="h-12 rounded-xl" />
        <Skeleton className="h-96 rounded-2xl" />
      </div>
    );
  }

  const store = state.store;

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
            <Link
              className={buttonVariants({ size: 'sm', variant: 'outline' })}
              to={Routes.LeadLedger}
            >
              <IconArchive className="size-4" />
              {product_navigation_leads()}
            </Link>
          </div>
        }
      />
      <main className="meiye-heroui-glass mx-auto w-full max-w-6xl flex-1 p-4 lg:p-6">
        <div className="meiye-ambient-copy mb-6">
          <h1 className="meiye-type-title">{product_navigation_store()}</h1>
          <p className="meiye-type-aux mt-1">{dashboard_store_description()}</p>
        </div>

        {error && (
          <Alert className="mb-4" status="danger">
            <Alert.Indicator>
              <IconAlertTriangle className="size-4" />
            </Alert.Indicator>
            <Alert.Content>
              <Alert.Title>{dashboard_store_save_failed()}</Alert.Title>
              <Alert.Description className="flex flex-wrap items-center justify-between gap-3">
                {store_save_failed_description()}
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
          {/* D-119 five-step intake lives in the conversation (T24 owns it);
              this page only points at it. */}
          <Widget className="meiye-porcelain">
            <Widget.Header>
              <Widget.Title className="flex items-center gap-2">
                <IconMessage2 className="size-4" />
                {dashboard_store_intake_title()}
              </Widget.Title>
            </Widget.Header>
            <Widget.Content className="flex flex-wrap items-center justify-between gap-4">
              <p className="text-muted max-w-prose text-sm">
                {dashboard_store_intake_description()}
              </p>
              <Link
                className={buttonVariants({ variant: 'primary' })}
                to={Routes.Dashboard}
              >
                {dashboard_store_intake_action()}
              </Link>
            </Widget.Content>
          </Widget>

          <Widget className="meiye-porcelain">
            <Widget.Header>
              <Widget.Title>{dashboard_store_profile_title()}</Widget.Title>
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
                <EmptyState>
                  <EmptyState.Header>
                    <EmptyState.Media variant="icon">
                      <IconFolderOff className="size-6" />
                    </EmptyState.Media>
                    <EmptyState.Description>
                      {dashboard_store_profile_empty()}
                    </EmptyState.Description>
                  </EmptyState.Header>
                </EmptyState>
              )}
              {state.storeDraft ? (
                <p className="text-muted mt-4 text-sm">
                  <span className="meiye-glass-trace mr-2 rounded-full px-2 py-0.5 text-xs">
                    {dashboard_store_unconfirmed_draft()}
                  </span>
                  {dashboard_store_draft_source({
                    date: formatLocaleDateTime(state.storeDraft.createdAt),
                  })}
                </p>
              ) : null}
            </Widget.Content>
          </Widget>

          <Widget className="meiye-porcelain">
            <Widget.Header>
              <Widget.Title>{dashboard_store_facts_title()}</Widget.Title>
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

          {/*
           * T38 removal candidate — predicate: the conversation intake route is
           * reachable.
           * Until T24 mounts that route this collapsed region is the only way to
           * confirm a store profile or qualification, so it is carried over
           * as-is (same three commands) rather than rebuilt or dropped.
           */}
          <details
            className="meiye-porcelain rounded-2xl p-4"
            open={Boolean(sourceTab)}
          >
            <summary className="text-foreground cursor-pointer font-medium">
              {dashboard_store_manual_title()}
            </summary>
            <p className="text-muted mt-1 text-sm">
              {dashboard_store_manual_description()}
            </p>
            <Tabs
              className="mt-4"
              defaultSelectedKey={
                sourceTab === 'qualification' ? 'qualification' : 'profile'
              }
            >
              <Tabs.List>
                <Tabs.Tab id="profile">
                  {dashboard_store_profile_tab()}
                </Tabs.Tab>
                <Tabs.Tab id="qualification">
                  {dashboard_store_qualification_tab()}
                </Tabs.Tab>
                <Tabs.Indicator />
              </Tabs.List>

              <Tabs.Panel className="mt-6 space-y-6" id="profile">
                <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
                  <TextField onChange={setPastedFacts} value={pastedFacts}>
                    <Label>{dashboard_store_pasted_facts_label()}</Label>
                    <TextArea
                      className="min-h-24"
                      placeholder={dashboard_store_pasted_facts_placeholder()}
                    />
                  </TextField>
                  <Button
                    isDisabled={!pastedFacts.trim()}
                    onPress={() => void deriveDraft()}
                    variant="outline"
                  >
                    <IconFileText className="size-4" />
                    {dashboard_store_generate_draft()}
                  </Button>
                </section>

                <section
                  aria-labelledby="store-profile-group"
                  className="space-y-4"
                >
                  <h2 className="font-medium" id="store-profile-group">
                    {dashboard_store_group_profile()}
                  </h2>
                  <div className="grid gap-4 md:grid-cols-2">
                    <Field
                      label={dashboard_store_name_label()}
                      onChange={(name) => setForm({ ...form, name })}
                      required
                      value={form.name}
                    />
                    <Field
                      label={dashboard_store_city_label()}
                      onChange={(city) => setForm({ ...form, city })}
                      required
                      value={form.city}
                    />
                    <Field
                      label={dashboard_store_district_label()}
                      onChange={(district) => setForm({ ...form, district })}
                      required
                      value={form.district}
                    />
                    <Field
                      label={dashboard_store_address_label()}
                      onChange={(address) => setForm({ ...form, address })}
                      required
                      value={form.address}
                    />
                    <Field
                      label={dashboard_store_booking_label()}
                      onChange={(booking) => setForm({ ...form, booking })}
                      required
                      value={form.booking}
                    />
                  </div>
                </section>

                <section
                  aria-labelledby="store-account-group"
                  className="border-divider space-y-4 border-t pt-6"
                >
                  <h2 className="font-medium" id="store-account-group">
                    {dashboard_store_group_account()}
                  </h2>
                  <div className="grid gap-4 md:grid-cols-2">
                    <Field
                      label={dashboard_store_account_label()}
                      onChange={(account) => setForm({ ...form, account })}
                      value={form.account}
                    />
                    <Field
                      label={dashboard_store_douyin_account_label()}
                      onChange={(douyinAccount) =>
                        setForm({ ...form, douyinAccount })
                      }
                      value={form.douyinAccount}
                    />
                    <Field
                      label={dashboard_store_xiaohongshu_homepage_label()}
                      onChange={(accountHomepage) =>
                        setForm({ ...form, accountHomepage })
                      }
                      value={form.accountHomepage}
                    />
                    <Select
                      onSelectionChange={(key) =>
                        setForm({
                          ...form,
                          accountVerification: key as
                            | 'unverified'
                            | 'verified'
                            | 'restricted',
                        })
                      }
                      selectedKey={form.accountVerification}
                    >
                      <Label>{dashboard_store_verification_label()}</Label>
                      <Select.Trigger>
                        <Select.Value />
                        <Select.Indicator />
                      </Select.Trigger>
                      <Select.Popover>
                        <ListBox>
                          <ListBox.Item id="unverified">
                            {dashboard_store_verification_unverified()}
                          </ListBox.Item>
                          <ListBox.Item id="verified">
                            {dashboard_store_verification_verified()}
                          </ListBox.Item>
                          <ListBox.Item id="restricted">
                            {dashboard_store_verification_restricted()}
                          </ListBox.Item>
                        </ListBox>
                      </Select.Popover>
                    </Select>
                    <Field
                      label={dashboard_store_account_notes_label()}
                      onChange={(accountNotes) =>
                        setForm({ ...form, accountNotes })
                      }
                      value={form.accountNotes}
                    />
                  </div>
                </section>

                <section
                  aria-labelledby="store-project-group"
                  className="border-divider space-y-4 border-t pt-6"
                >
                  <h2 className="font-medium" id="store-project-group">
                    {dashboard_store_group_projects()}
                  </h2>
                  <div className="grid gap-4 md:grid-cols-2">
                    <Field
                      label={dashboard_store_project_name_label()}
                      onChange={(projectName) =>
                        setForm({ ...form, projectName })
                      }
                      required
                      value={form.projectName}
                    />
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="meiye-glass-trace text-muted ml-auto rounded-full px-2 py-0.5 text-xs">
                          {dashboard_store_manual_confirmation_required()}
                        </span>
                      </div>
                      <Field
                        label={dashboard_store_project_price_label()}
                        onChange={(projectPrice) =>
                          setForm({ ...form, projectPrice })
                        }
                        required
                        value={form.projectPrice}
                      />
                    </div>
                    {extraProjects.map((project, index) => (
                      <div
                        className="border-divider grid gap-4 border-t pt-4 md:col-span-2 md:grid-cols-[1fr_160px_160px_auto]"
                        key={project.id}
                      >
                        <Field
                          label={dashboard_store_project_number({
                            number: index + 2,
                          })}
                          onChange={(name) =>
                            setExtraProjects((current) =>
                              current.map((item) =>
                                item.id === project.id
                                  ? { ...item, name }
                                  : item
                              )
                            )
                          }
                          value={project.name}
                        />
                        <Field
                          label={dashboard_store_price_label()}
                          onChange={(price) =>
                            setExtraProjects((current) =>
                              current.map((item) =>
                                item.id === project.id
                                  ? { ...item, price }
                                  : item
                              )
                            )
                          }
                          value={project.price}
                        />
                        <Field
                          label={dashboard_store_duration_minutes_label()}
                          onChange={(durationMinutes) =>
                            setExtraProjects((current) =>
                              current.map((item) =>
                                item.id === project.id
                                  ? { ...item, durationMinutes }
                                  : item
                              )
                            )
                          }
                          value={project.durationMinutes}
                        />
                        <Button
                          aria-label={dashboard_store_delete_project()}
                          className="self-end"
                          isIconOnly
                          onPress={() =>
                            setExtraProjects((current) =>
                              current.filter((item) => item.id !== project.id)
                            )
                          }
                          variant="ghost"
                        >
                          <IconTrash className="size-4" />
                        </Button>
                      </div>
                    ))}
                    <div className="md:col-span-2">
                      <Button
                        onPress={() =>
                          setExtraProjects((current) => [
                            ...current,
                            {
                              id: `project-${crypto.randomUUID()}`,
                              name: '',
                              price: '',
                              durationMinutes: '60',
                            },
                          ])
                        }
                        variant="outline"
                      >
                        {dashboard_store_add_project()}
                      </Button>
                    </div>
                  </div>
                </section>

                <section
                  aria-labelledby="store-voice-group"
                  className="border-divider space-y-4 border-t pt-6"
                >
                  <h2 className="font-medium" id="store-voice-group">
                    {dashboard_store_group_voice()}
                  </h2>
                  <TextField
                    onChange={(brandVoice) => setForm({ ...form, brandVoice })}
                    value={form.brandVoice}
                  >
                    <Label isRequired>
                      {dashboard_store_brand_voice_label()}
                    </Label>
                    <TextArea />
                  </TextField>
                </section>

                <div className="border-divider flex justify-end border-t pt-4">
                  <Button
                    isDisabled={pending || missingRequiredFields.length > 0}
                    onPress={() => void confirmStore()}
                  >
                    <IconShieldCheck className="size-4" />
                    {dashboard_store_confirm_facts()}
                  </Button>
                </div>
              </Tabs.Panel>

              <Tabs.Panel className="mt-6 space-y-6" id="qualification">
                <div className="flex items-start gap-3">
                  <Checkbox
                    isDisabled={complianceDefaults.isPending}
                    isSelected={form.regulated}
                    onChange={(checked) => {
                      regulatedTouched.current = true;
                      setForm({ ...form, regulated: checked });
                    }}
                  >
                    {dashboard_store_regulated_label()}
                  </Checkbox>
                  <p className="text-muted mt-1 text-sm">
                    {dashboard_store_regulated_description()}
                  </p>
                </div>
                <QualificationForm
                  existing={state.qualification}
                  onConfirm={(qualification) =>
                    void run({ type: 'confirm_qualification', qualification })
                  }
                  pending={pending}
                />
              </Tabs.Panel>
            </Tabs>
          </details>
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
  required = false,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  required?: boolean;
  value: string;
}) {
  return (
    <TextField isRequired={required} onChange={onChange} value={value}>
      <Label isRequired={required}>{label}</Label>
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
