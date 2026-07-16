import { zodResolver } from '@hookform/resolvers/zod';
import {
  IconAlertTriangle,
  IconEye,
  IconFilePlus,
  IconPlayerPlay,
  IconRefresh,
  IconRocket,
  IconTrash,
} from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { m } from '@/locale/paraglide/messages';
import type {
  AdminTemplateView,
  AdminTemplateVersionView,
} from '@/p1/admin-view-model';
import { normalizeAdminTemplateHistory } from '@/p1/admin-view-model';
import {
  adminTemplateDocument,
  adminTemplateRetireSchema,
  adminTemplateRollout,
  adminTemplateTags,
  adminTemplateVersionFormSchema,
  adminTemplateVersionTargetSchema,
  createAdminTemplateSchema,
  type AdminTemplateVersionFormInput,
  type CreateAdminTemplateInput,
} from '@/p1/admin-template-forms';
import { commandP1, queryP1 } from '@/p1/client';
import { p1QueryKeys } from '@/p1/query-keys';
import {
  ImpactReviewDialog,
  type ImpactReviewRequest,
} from '@/components/admin/impact-review-dialog';

const BLANK_DOCUMENT = JSON.stringify(
  {
    height: 1350,
    pages: [{ elements: [], id: 'page-1' }],
    width: 1080,
  },
  null,
  2
);

function statusVariant(status: AdminTemplateView['publicationStatus']) {
  if (status === 'published') return 'secondary' as const;
  if (status === 'retired') return 'destructive' as const;
  return 'outline' as const;
}

interface AdminTemplateCommand {
  action: string;
  payload: Record<string, unknown>;
  pendingKey: string;
}

export function AdminTemplateControl() {
  const [familyFilter, setFamilyFilter] = useState('all');
  const [impactReview, setImpactReview] = useState<ImpactReviewRequest>();
  const queryClient = useQueryClient();
  const catalogQuery = useQuery({
    queryKey: p1QueryKeys.request('operations', 'admin_template_catalog'),
    queryFn: ({ signal }) =>
      queryP1<unknown>(
        'operations',
        {
          action: 'admin_template_catalog',
          payload: {},
        },
        signal
      ),
    select: normalizeAdminTemplateHistory,
  });
  const commandMutation = useMutation({
    mutationFn: (request: AdminTemplateCommand) =>
      commandP1<unknown>('operations', {
        action: request.action,
        payload: request.payload,
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: p1QueryKeys.module('operations'),
      }),
  });
  const createForm = useForm<CreateAdminTemplateInput>({
    defaultValues: {
      family: 'seasonal_campaign',
      name: '',
      tags: '',
    },
    resolver: zodResolver(createAdminTemplateSchema),
  });
  const versionForm = useForm<AdminTemplateVersionFormInput>({
    defaultValues: {
      document: BLANK_DOCUMENT,
      rollout: '100',
      templateId: '',
      versionId: '',
    },
    resolver: zodResolver(adminTemplateVersionFormSchema),
  });
  const templates = catalogQuery.data?.templates ?? [];
  const versions = catalogQuery.data?.versions ?? [];
  const templateId = versionForm.watch('templateId');
  const busy = commandMutation.isPending
    ? commandMutation.variables?.pendingKey
    : undefined;
  const loading = catalogQuery.isPending;
  const error = catalogQuery.error
    ? m.p1_admin_template_catalog_error_description()
    : undefined;
  const refresh = () => catalogQuery.refetch();
  const executeCommand = <T,>(request: AdminTemplateCommand) =>
    commandMutation.mutateAsync(request) as Promise<T>;

  useEffect(() => {
    if (!versionForm.getValues('templateId') && templates[0]?.id) {
      versionForm.setValue('templateId', templates[0].id);
    }
  }, [templates, versionForm]);

  const versionTarget = (values: AdminTemplateVersionFormInput) => {
    const result = adminTemplateVersionTargetSchema.safeParse(values);
    if (result.success) return result.data;
    versionForm.setError('versionId', {
      message:
        result.error.issues[0]?.message ??
        m.p1_admin_template_validation_version(),
    });
    toast.error(m.p1_admin_template_select_template_version());
    return undefined;
  };

  const createDraft = versionForm.handleSubmit(async (values) => {
    try {
      const result = await executeCommand<AdminTemplateVersionView>({
        action: 'admin_create_template_version',
        payload: {
          document: adminTemplateDocument(values.document),
          rolloutPercent: adminTemplateRollout(values.rollout),
          templateId: values.templateId,
        },
        pendingKey: 'draft',
      });
      versionForm.setValue('versionId', result.id);
      toast.success(m.p1_admin_template_draft_created({ revision: result.id }));
    } catch {
      toast.error(m.p1_admin_template_draft_error());
    }
  });

  const createTemplate = createForm.handleSubmit(async (values) => {
    const documentValid = await versionForm.trigger('document');
    if (!documentValid) {
      toast.error(m.p1_admin_template_fix_document());
      return;
    }
    try {
      const result = await executeCommand<{
        template: AdminTemplateView;
        version?: AdminTemplateVersionView;
      }>({
        action: 'admin_create_template',
        payload: {
          document: adminTemplateDocument(versionForm.getValues('document')),
          family: values.family,
          name: values.name,
          tags: adminTemplateTags(values.tags),
        },
        pendingKey: 'create-template',
      });
      versionForm.setValue('templateId', result.template.id);
      versionForm.setValue('versionId', result.version?.id ?? '');
      createForm.reset({ ...values, name: '' });
      toast.success(m.p1_admin_template_create_success());
    } catch {
      toast.error(m.p1_admin_template_create_error());
    }
  });

  const enable = versionForm.handleSubmit(async (values) => {
    const target = versionTarget(values);
    if (!target) return;
    try {
      await executeCommand({
        action: 'admin_enable_template_version',
        payload: {
          rolloutPercent: adminTemplateRollout(values.rollout),
          ...target,
        },
        pendingKey: 'enable',
      });
      toast.success(m.p1_admin_template_enable_success());
    } catch {
      toast.error(m.p1_admin_template_enable_error());
    }
  });

  const preview = versionForm.handleSubmit(async (values) => {
    const target = versionTarget(values);
    if (!target) return;
    try {
      const result = await executeCommand<{ document: unknown }>({
        action: 'admin_preview_template_version',
        payload: target,
        pendingKey: 'preview',
      });
      versionForm.setValue(
        'document',
        JSON.stringify(result.document, null, 2)
      );
      toast.success(m.p1_admin_template_preview_success());
    } catch {
      toast.error(m.p1_admin_template_preview_error());
    }
  });

  const publish = versionForm.handleSubmit(async (values) => {
    const target = versionTarget(values);
    if (!target) return;
    setImpactReview({
      title: m.p1_admin_template_publish_review_title(),
      description: m.p1_admin_template_publish_review_description(),
      scope: m.p1_admin_template_publish_review_scope({
        revision: target.versionId,
        template: target.templateId,
      }),
      changes: [
        m.p1_admin_template_publish_change_rollout(),
        m.p1_admin_template_publish_change_new_work(),
        m.p1_admin_template_publish_change_history(),
      ],
      confirmLabel: m.p1_admin_template_publish_confirm(),
      onConfirm: async (reason) => {
        await executeCommand<AdminTemplateVersionView>({
          action: 'admin_publish_template_version',
          payload: {
            rolloutPercent: 100,
            reason,
            ...target,
          },
          pendingKey: 'publish',
        });
        toast.success(m.p1_admin_template_publish_success());
      },
    });
  });

  const retire = async () => {
    const target = adminTemplateRetireSchema.safeParse({ templateId });
    if (!target.success) {
      versionForm.setError('templateId', {
        message:
          target.error.issues[0]?.message ??
          m.p1_admin_template_validation_template(),
      });
      toast.error(m.p1_admin_template_select_template());
      return;
    }
    setImpactReview({
      title: m.p1_admin_template_retire_review_title(),
      description: m.p1_admin_template_retire_review_description(),
      scope: m.p1_admin_template_retire_review_scope({
        template: target.data.templateId,
      }),
      changes: [
        m.p1_admin_template_retire_change_catalog(),
        m.p1_admin_template_retire_change_work(),
        m.p1_admin_template_retire_change_shortcuts(),
      ],
      confirmLabel: m.p1_admin_template_retire_confirm(),
      onConfirm: async (reason) => {
        await executeCommand({
          action: 'admin_retire_template',
          payload: { ...target.data, reason },
          pendingKey: 'retire',
        });
        toast.success(m.p1_admin_template_retire_success());
      },
    });
  };

  const visibleVersions = useMemo(
    () =>
      [...versions]
        .filter((version) => !templateId || version.templateId === templateId)
        .sort((left, right) => right.revision - left.revision),
    [templateId, versions]
  );
  const families = useMemo(
    () => [...new Set(templates.map((template) => template.family))].sort(),
    [templates]
  );
  const visibleTemplates = useMemo(
    () =>
      templates.filter(
        (template) => familyFilter === 'all' || template.family === familyFilter
      ),
    [familyFilter, templates]
  );

  return (
    <div className="space-y-6">
      <Alert>
        <IconAlertTriangle />
        <AlertTitle>{m.p1_admin_template_notice_title()}</AlertTitle>
        <AlertDescription>
          {m.p1_admin_template_notice_description()}
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>{m.p1_admin_template_create_title()}</CardTitle>
          <CardDescription>
            {m.p1_admin_template_create_description()}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4 md:grid-cols-3" onSubmit={createTemplate}>
            <div className="space-y-2">
              <Label htmlFor="admin-new-template-name">
                {m.p1_admin_template_name()}
              </Label>
              <Input
                id="admin-new-template-name"
                placeholder={m.p1_admin_template_name_placeholder()}
                {...createForm.register('name')}
              />
              {createForm.formState.errors.name ? (
                <p className="text-xs text-destructive">
                  {createForm.formState.errors.name.message}
                </p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="admin-new-template-family">
                {m.p1_admin_template_family()}
              </Label>
              <Input
                id="admin-new-template-family"
                placeholder="seasonal_campaign"
                {...createForm.register('family')}
              />
              {createForm.formState.errors.family ? (
                <p className="text-xs text-destructive">
                  {createForm.formState.errors.family.message}
                </p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="admin-new-template-tags">
                {m.p1_admin_template_tags()}
              </Label>
              <Input
                id="admin-new-template-tags"
                placeholder={m.p1_admin_template_tags_placeholder()}
                {...createForm.register('tags')}
              />
              {createForm.formState.errors.tags ? (
                <p className="text-xs text-destructive">
                  {createForm.formState.errors.tags.message}
                </p>
              ) : null}
            </div>
            <div className="md:col-span-3">
              <Button disabled={Boolean(busy)} type="submit">
                <IconFilePlus />
                {busy === 'create-template'
                  ? m.p1_admin_template_creating()
                  : m.p1_admin_template_create_button()}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(22rem,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>{m.p1_admin_template_catalog_title()}</CardTitle>
            <CardDescription>
              {m.p1_admin_template_catalog_description()}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {error ? (
              <Alert variant="destructive">
                <AlertTitle>
                  {m.p1_admin_template_catalog_error_title()}
                </AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Label htmlFor="admin-template-family-filter">
                  {m.p1_admin_template_family_filter()}
                </Label>
                <select
                  className="h-9 rounded-md border bg-background px-3 text-sm"
                  id="admin-template-family-filter"
                  onChange={(event) => setFamilyFilter(event.target.value)}
                  value={familyFilter}
                >
                  <option value="all">
                    {m.p1_admin_template_family_all()}
                  </option>
                  {families.map((family) => (
                    <option key={family} value={family}>
                      {family}
                    </option>
                  ))}
                </select>
              </div>
              <Button
                disabled={catalogQuery.isFetching}
                onClick={() => void refresh()}
                variant="outline"
              >
                <IconRefresh />
                {m.p1_admin_template_refresh()}
              </Button>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{m.p1_admin_template_column_template()}</TableHead>
                  <TableHead>{m.p1_admin_template_column_family()}</TableHead>
                  <TableHead>{m.p1_admin_template_column_status()}</TableHead>
                  <TableHead>{m.p1_admin_template_column_current()}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleTemplates.map((template) => (
                  <TableRow
                    className="cursor-pointer"
                    data-state={
                      template.id === templateId ? 'selected' : undefined
                    }
                    key={template.id}
                    onClick={() => {
                      versionForm.setValue('templateId', template.id);
                      versionForm.setValue(
                        'versionId',
                        template.enabledVersionId ??
                          template.publishedVersionId ??
                          ''
                      );
                    }}
                  >
                    <TableCell>
                      <div className="font-medium">{template.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {template.id}
                      </div>
                    </TableCell>
                    <TableCell>{template.family}</TableCell>
                    <TableCell>
                      <Badge
                        variant={statusVariant(template.publicationStatus)}
                      >
                        {template.publicationStatus}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {template.enabledVersionId ??
                        template.publishedVersionId ??
                        m.p1_template_version_unpublished()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {!loading && templates.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                {m.p1_admin_template_catalog_empty()}
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{m.p1_admin_template_version_actions_title()}</CardTitle>
            <CardDescription>
              {m.p1_admin_template_version_actions_description()}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={createDraft}>
              <div className="space-y-2">
                <Label htmlFor="admin-template-id">
                  {m.p1_admin_template_id()}
                </Label>
                <Input
                  id="admin-template-id"
                  placeholder="official-social_cover"
                  {...versionForm.register('templateId')}
                />
                {versionForm.formState.errors.templateId ? (
                  <p className="text-xs text-destructive">
                    {versionForm.formState.errors.templateId.message}
                  </p>
                ) : null}
              </div>
              <div className="space-y-2">
                <Label htmlFor="admin-template-version-id">
                  {m.p1_admin_template_version_id()}
                </Label>
                <Input
                  id="admin-template-version-id"
                  placeholder={m.p1_admin_template_version_placeholder()}
                  {...versionForm.register('versionId')}
                />
                {versionForm.formState.errors.versionId ? (
                  <p className="text-xs text-destructive">
                    {versionForm.formState.errors.versionId.message}
                  </p>
                ) : null}
              </div>
              <div className="space-y-2">
                <Label htmlFor="admin-template-rollout">
                  {m.p1_admin_template_rollout()}
                </Label>
                <Input
                  id="admin-template-rollout"
                  inputMode="numeric"
                  max="100"
                  min="0"
                  type="number"
                  {...versionForm.register('rollout')}
                />
                {versionForm.formState.errors.rollout ? (
                  <p className="text-xs text-destructive">
                    {versionForm.formState.errors.rollout.message}
                  </p>
                ) : null}
              </div>
              <div className="space-y-2">
                <Label htmlFor="admin-template-document">
                  {m.p1_admin_template_document()}
                </Label>
                <Textarea
                  className="min-h-72 font-mono text-xs"
                  id="admin-template-document"
                  spellCheck={false}
                  {...versionForm.register('document')}
                />
                {versionForm.formState.errors.document ? (
                  <p className="text-xs text-destructive">
                    {versionForm.formState.errors.document.message}
                  </p>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button disabled={Boolean(busy)} type="submit">
                  <IconFilePlus />
                  {busy === 'draft'
                    ? m.p1_admin_template_creating()
                    : m.p1_admin_template_create_draft()}
                </Button>
                <Button
                  disabled={Boolean(busy)}
                  onClick={() => void preview()}
                  type="button"
                  variant="outline"
                >
                  <IconEye />
                  {busy === 'preview'
                    ? m.p1_admin_template_loading()
                    : m.p1_admin_template_preview_version()}
                </Button>
                <Button
                  disabled={Boolean(busy)}
                  onClick={() => void enable()}
                  type="button"
                  variant="outline"
                >
                  <IconPlayerPlay />
                  {busy === 'enable'
                    ? m.p1_admin_template_enabling()
                    : m.p1_admin_template_enable_version()}
                </Button>
                <Button
                  disabled={Boolean(busy)}
                  onClick={() => void publish()}
                  type="button"
                  variant="secondary"
                >
                  <IconRocket />
                  {busy === 'publish'
                    ? m.p1_admin_template_publishing()
                    : m.p1_admin_template_publish_version()}
                </Button>
                <Button
                  disabled={Boolean(busy)}
                  onClick={() => void retire()}
                  type="button"
                  variant="destructive"
                >
                  <IconTrash />
                  {busy === 'retire'
                    ? m.p1_admin_template_retiring()
                    : m.p1_admin_template_retire_template()}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{m.p1_admin_template_history_title()}</CardTitle>
          <CardDescription>
            {m.p1_admin_template_history_description()}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{m.p1_admin_template_column_version_id()}</TableHead>
                <TableHead>
                  {m.p1_admin_template_column_template_id()}
                </TableHead>
                <TableHead>{m.p1_admin_template_column_status()}</TableHead>
                <TableHead>{m.p1_admin_template_column_rollout()}</TableHead>
                <TableHead>{m.p1_admin_template_column_summary()}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleVersions.map((version) => (
                <TableRow key={version.id}>
                  <TableCell>
                    <div className="font-medium">v{version.revision}</div>
                    <div className="text-xs text-muted-foreground">
                      {version.id}
                    </div>
                  </TableCell>
                  <TableCell>{version.templateId}</TableCell>
                  <TableCell>{version.status}</TableCell>
                  <TableCell>{version.rolloutPercent}%</TableCell>
                  <TableCell>
                    {version.documentSummary.width}×
                    {version.documentSummary.height} ·{' '}
                    {m.p1_admin_template_document_summary({
                      elements: version.documentSummary.elementCount,
                      pages: version.documentSummary.pageCount,
                    })}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {visibleVersions.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {m.p1_admin_template_history_empty()}
            </p>
          ) : null}
        </CardContent>
      </Card>
      <ImpactReviewDialog
        onOpenChange={(open) => !open && setImpactReview(undefined)}
        open={Boolean(impactReview)}
        request={impactReview}
      />
    </div>
  );
}
