import { DashboardHeader } from '@/components/layout/dashboard-header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import {
  account_usage_retry,
  dashboard_store_account_label,
  dashboard_store_account_notes_label,
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
  dashboard_store_generate_draft,
  dashboard_store_group_account,
  dashboard_store_group_profile,
  dashboard_store_group_projects,
  dashboard_store_group_voice,
  dashboard_store_institution_license_label,
  dashboard_store_intake_at_label,
  dashboard_store_manual_confirmation_required,
  dashboard_store_name_label,
  dashboard_store_pasted_facts_label,
  dashboard_store_pasted_facts_placeholder,
  dashboard_store_platform_certification_label,
  dashboard_store_price_label,
  dashboard_store_profile_tab,
  dashboard_store_project_name_label,
  dashboard_store_project_number,
  dashboard_store_project_price_label,
  dashboard_store_qualification_tab,
  dashboard_store_regulated_description,
  dashboard_store_regulated_label,
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
  store_save_failed_description,
} from '@/locale/paraglide/messages';
import { formatLocaleDateTime } from '@/lib/locale';
import { Routes } from '@/lib/routes';
import { optionalSourceId } from '@/p1/source-object-navigation';
import { useComplianceDefaults } from '@/p1/use-compliance-defaults';
import { useProductState } from '@/product/client';
import {
  missingStoreProfileFields,
  type StoreProfileForm,
} from '@/product/store-profile-form';
import type { ProductCommand } from '@meiye/contracts';
import {
  IconAlertTriangle,
  IconArchive,
  IconCheck,
  IconFileText,
  IconRefresh,
  IconShieldCheck,
  IconTrash,
} from '@tabler/icons-react';
import { createFileRoute, Link, redirect } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';

export const Route = createFileRoute('/dashboard/store')({
  validateSearch: (search: Record<string, unknown>) => {
    const assetId = optionalSourceId(search.assetId);
    const explicitTab =
      search.tab === 'profile' ||
      search.tab === 'assets' ||
      search.tab === 'qualification';
    return {
      ...(assetId ? { assetId } : {}),
      ...(explicitTab ? { tab: search.tab } : {}),
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

function StoreProfilePage() {
  const { tab: sourceTab = 'profile' } = Route.useSearch();
  const { state, error, loading, pending, execute, refresh } =
    useProductState();
  const complianceDefaults = useComplianceDefaults();
  const regulatedDefaultApplied = useRef(false);
  const regulatedTouched = useRef(false);
  const [pastedFacts, setPastedFacts] = useState('');
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
      <div className="space-y-4 p-4 lg:p-6">
        <Skeleton className="h-12" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  return (
    <>
      <DashboardHeader
        breadcrumbs={[
          { label: product_navigation_store(), isCurrentPage: true },
        ]}
        actions={
          <div className="flex items-center gap-2">
            {state.store?.confirmedAt ? (
              <Badge variant="outline">
                <IconCheck className="size-3" />
                {dashboard_store_confirmed()}
              </Badge>
            ) : null}
            <Link
              className={buttonVariants({ size: 'sm', variant: 'outline' })}
              to={Routes.LeadLedger}
            >
              <IconArchive />
              {product_navigation_leads()}
            </Link>
          </div>
        }
      />
      <main className="mx-auto w-full max-w-6xl flex-1 p-4 lg:p-6">
        <div className="meiye-ambient-copy mb-6">
          <h1 className="meiye-type-title">{product_navigation_store()}</h1>
          <p className="meiye-type-aux mt-1">{dashboard_store_description()}</p>
        </div>

        {error && (
          <Alert variant="destructive" className="mb-4">
            <IconAlertTriangle />
            <AlertTitle>{dashboard_store_save_failed()}</AlertTitle>
            <AlertDescription className="flex items-center justify-between gap-3">
              {store_save_failed_description()}
              <Button
                size="sm"
                variant="outline"
                onClick={() => void refresh()}
              >
                <IconRefresh />
                {account_usage_retry()}
              </Button>
            </AlertDescription>
          </Alert>
        )}

        <Tabs defaultValue={sourceTab}>
          <TabsList>
            <TabsTrigger value="profile">
              {dashboard_store_profile_tab()}
            </TabsTrigger>
            <TabsTrigger value="qualification">
              {dashboard_store_qualification_tab()}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="profile" className="mt-6 space-y-6">
            <section className="grid gap-4 rounded-xl bg-surface-1 p-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
              <div>
                <Label htmlFor="pasted-facts">
                  {dashboard_store_pasted_facts_label()}
                </Label>
                <Textarea
                  id="pasted-facts"
                  className="mt-2 min-h-24"
                  value={pastedFacts}
                  onChange={(event) => setPastedFacts(event.target.value)}
                  placeholder={dashboard_store_pasted_facts_placeholder()}
                />
              </div>
              <Button
                variant="outline"
                disabled={!pastedFacts.trim()}
                onClick={() => void deriveDraft()}
              >
                <IconFileText />
                {dashboard_store_generate_draft()}
              </Button>
            </section>
            {state.storeDraft && (
              <p className="text-sm text-muted-foreground">
                <Badge variant="outline">
                  {dashboard_store_unconfirmed_draft()}
                </Badge>{' '}
                {dashboard_store_draft_source({
                  date: formatLocaleDateTime(state.storeDraft.createdAt),
                })}
              </p>
            )}

            <div className="space-y-6 rounded-xl bg-surface-1 p-4">
              <section
                aria-labelledby="store-profile-group"
                className="space-y-4"
              >
                <h2
                  className="meiye-type-body font-semibold"
                  id="store-profile-group"
                >
                  {dashboard_store_group_profile()}
                </h2>
                <div className="grid gap-4 md:grid-cols-2">
                  <Field
                    id="store-name"
                    label={dashboard_store_name_label()}
                    required
                    value={form.name}
                    onChange={(name) => setForm({ ...form, name })}
                  />
                  <Field
                    id="store-city"
                    label={dashboard_store_city_label()}
                    required
                    value={form.city}
                    onChange={(city) => setForm({ ...form, city })}
                  />
                  <Field
                    id="store-district"
                    label={dashboard_store_district_label()}
                    required
                    value={form.district}
                    onChange={(district) => setForm({ ...form, district })}
                  />
                  <Field
                    id="store-address"
                    label={dashboard_store_address_label()}
                    required
                    value={form.address}
                    onChange={(address) => setForm({ ...form, address })}
                  />
                  <Field
                    id="store-booking"
                    label={dashboard_store_booking_label()}
                    required
                    value={form.booking}
                    onChange={(booking) => setForm({ ...form, booking })}
                  />
                </div>
              </section>

              <section
                aria-labelledby="store-account-group"
                className="space-y-4 border-t border-divider pt-6"
              >
                <h2
                  className="meiye-type-body font-semibold"
                  id="store-account-group"
                >
                  {dashboard_store_group_account()}
                </h2>
                <div className="grid gap-4 md:grid-cols-2">
                  <Field
                    id="store-xiaohongshu-account"
                    label={dashboard_store_account_label()}
                    value={form.account}
                    onChange={(account) => setForm({ ...form, account })}
                  />
                  <Field
                    id="store-douyin-account"
                    label={dashboard_store_douyin_account_label()}
                    value={form.douyinAccount}
                    onChange={(douyinAccount) =>
                      setForm({ ...form, douyinAccount })
                    }
                  />
                  <Field
                    id="store-xiaohongshu-homepage"
                    label={dashboard_store_xiaohongshu_homepage_label()}
                    value={form.accountHomepage}
                    onChange={(accountHomepage) =>
                      setForm({ ...form, accountHomepage })
                    }
                  />
                  <div>
                    <Label htmlFor="account-verification">
                      {dashboard_store_verification_label()}
                    </Label>
                    <select
                      id="account-verification"
                      className="mt-2 h-touch-target w-full rounded-lg border border-divider bg-surface-1 px-2.5 text-sm outline-none transition-colors enabled:hover:bg-surface-2 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40"
                      value={form.accountVerification}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          accountVerification: event.target.value as
                            | 'unverified'
                            | 'verified'
                            | 'restricted',
                        })
                      }
                    >
                      <option value="unverified">
                        {dashboard_store_verification_unverified()}
                      </option>
                      <option value="verified">
                        {dashboard_store_verification_verified()}
                      </option>
                      <option value="restricted">
                        {dashboard_store_verification_restricted()}
                      </option>
                    </select>
                  </div>
                  <Field
                    id="store-account-notes"
                    label={dashboard_store_account_notes_label()}
                    value={form.accountNotes}
                    onChange={(accountNotes) =>
                      setForm({ ...form, accountNotes })
                    }
                  />
                </div>
              </section>

              <section
                aria-labelledby="store-project-group"
                className="space-y-4 border-t border-divider pt-6"
              >
                <h2
                  className="meiye-type-body font-semibold"
                  id="store-project-group"
                >
                  {dashboard_store_group_projects()}
                </h2>
                <div className="grid gap-4 md:grid-cols-2">
                  <Field
                    id="store-project-name"
                    label={dashboard_store_project_name_label()}
                    required
                    value={form.projectName}
                    onChange={(projectName) =>
                      setForm({ ...form, projectName })
                    }
                  />
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <Label htmlFor="project-price">
                        {dashboard_store_project_price_label()}{' '}
                        <span aria-hidden="true">*</span>
                      </Label>
                      <Badge variant="outline">
                        {dashboard_store_manual_confirmation_required()}
                      </Badge>
                    </div>
                    <Input
                      id="project-price"
                      className="mt-2"
                      inputMode="numeric"
                      value={form.projectPrice}
                      onChange={(event) =>
                        setForm({ ...form, projectPrice: event.target.value })
                      }
                    />
                  </div>
                  {extraProjects.map((project, index) => (
                    <div
                      key={project.id}
                      className="grid gap-4 border-t border-divider pt-4 md:col-span-2 md:grid-cols-[1fr_160px_160px_auto]"
                    >
                      <Field
                        id={`${project.id}-name`}
                        label={dashboard_store_project_number({
                          number: index + 2,
                        })}
                        value={project.name}
                        onChange={(name) =>
                          setExtraProjects((current) =>
                            current.map((item) =>
                              item.id === project.id ? { ...item, name } : item
                            )
                          )
                        }
                      />
                      <Field
                        id={`${project.id}-price`}
                        label={dashboard_store_price_label()}
                        value={project.price}
                        onChange={(price) =>
                          setExtraProjects((current) =>
                            current.map((item) =>
                              item.id === project.id ? { ...item, price } : item
                            )
                          )
                        }
                      />
                      <Field
                        id={`${project.id}-duration`}
                        label={dashboard_store_duration_minutes_label()}
                        value={project.durationMinutes}
                        onChange={(durationMinutes) =>
                          setExtraProjects((current) =>
                            current.map((item) =>
                              item.id === project.id
                                ? { ...item, durationMinutes }
                                : item
                            )
                          )
                        }
                      />
                      <Button
                        className="self-end"
                        size="icon"
                        variant="ghost"
                        title={dashboard_store_delete_project()}
                        onClick={() =>
                          setExtraProjects((current) =>
                            current.filter((item) => item.id !== project.id)
                          )
                        }
                      >
                        <IconTrash />
                      </Button>
                    </div>
                  ))}
                  <div className="md:col-span-2">
                    <Button
                      variant="outline"
                      onClick={() =>
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
                    >
                      {dashboard_store_add_project()}
                    </Button>
                  </div>
                </div>
              </section>

              <section
                aria-labelledby="store-voice-group"
                className="space-y-4 border-t border-divider pt-6"
              >
                <h2
                  className="meiye-type-body font-semibold"
                  id="store-voice-group"
                >
                  {dashboard_store_group_voice()}
                </h2>
                <div>
                  <Label htmlFor="brand-voice">
                    {dashboard_store_brand_voice_label()} <span aria-hidden="true">*</span>
                  </Label>
                  <Textarea
                    id="brand-voice"
                    className="mt-2"
                    value={form.brandVoice}
                    onChange={(event) =>
                      setForm({ ...form, brandVoice: event.target.value })
                    }
                  />
                </div>
              </section>
            </div>
            <div className="flex justify-end border-t border-divider pt-4">
              <Button
                disabled={
                  pending ||
                  missingRequiredFields.length > 0
                }
                onClick={() => void confirmStore()}
              >
                <IconShieldCheck />
                {dashboard_store_confirm_facts()}
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="qualification" className="mt-6 space-y-6">
            <div className="flex items-center gap-3 rounded-xl bg-surface-1 p-4">
              <Checkbox
                checked={form.regulated}
                disabled={complianceDefaults.isPending}
                id="regulated"
                onCheckedChange={(checked) => {
                  regulatedTouched.current = true;
                  setForm({ ...form, regulated: checked === true });
                }}
              />
              <div>
                <Label htmlFor="regulated">
                  {dashboard_store_regulated_label()}
                </Label>
                <p className="mt-1 text-sm text-muted-foreground">
                  {dashboard_store_regulated_description()}
                </p>
              </div>
            </div>
            <QualificationForm
              existing={state.qualification}
              pending={pending}
              onConfirm={(qualification) =>
                void run({ type: 'confirm_qualification', qualification })
              }
            />
          </TabsContent>
        </Tabs>
      </main>
    </>
  );
}

function Field({
  id: explicitId,
  label,
  required = false,
  value,
  onChange,
}: {
  id?: string;
  label: string;
  required?: boolean;
  value: string;
  onChange: (value: string) => void;
}) {
  const id = explicitId ?? label.replaceAll('/', '-');
  return (
    <div>
      <Label htmlFor={id}>
        {label} {required ? <span aria-hidden="true">*</span> : null}
      </Label>
      <Input
        id={id}
        className="mt-2"
        required={required}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

function QualificationForm({
  existing,
  pending,
  onConfirm,
}: {
  existing?: {
    institutionLicense?: string;
    treatmentScope?: string;
    platformCertification?: string;
    advertisingCertificate?: string;
    validUntil?: string;
    intakeAt?: string;
  };
  pending: boolean;
  onConfirm: (qualification: {
    admitted: boolean;
    institutionLicense: string;
    treatmentScope: string;
    platformCertification: string;
    advertisingCertificate: string;
    validUntil: string;
    intakeAt: string;
  }) => void;
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
    <div className="grid gap-4 rounded-xl bg-surface-1 p-4 md:grid-cols-2">
      {Object.entries({
        institutionLicense: dashboard_store_institution_license_label(),
        treatmentScope: dashboard_store_treatment_scope_label(),
        platformCertification: dashboard_store_platform_certification_label(),
        advertisingCertificate: dashboard_store_advertising_certificate_label(),
        validUntil: dashboard_store_valid_until_label(),
        intakeAt: dashboard_store_intake_at_label(),
      }).map(([key, label]) => (
        <Field
          id={`qualification-${key}`}
          key={key}
          label={label}
          value={qualification[key as keyof typeof qualification]}
          onChange={(value) =>
            setQualification({ ...qualification, [key]: value })
          }
        />
      ))}
      <div className="flex justify-end border-t border-divider pt-4 md:col-span-2">
        <Button
          disabled={
            pending ||
            !qualification.institutionLicense ||
            !qualification.treatmentScope
          }
          onClick={() => onConfirm({ ...qualification, admitted: true })}
        >
          <IconShieldCheck />
          {dashboard_store_confirm_qualification()}
        </Button>
      </div>
    </div>
  );
}
