import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  model_card_channel_multi,
  model_card_channel_single,
  model_card_preview_alt,
  model_settings_capability_pending,
  model_settings_empty,
  model_settings_favorite,
  model_settings_favorite_added,
  model_settings_favorite_removed,
  model_settings_image_description,
  model_settings_image_title,
  model_settings_llm_description,
  model_settings_llm_title,
  model_settings_load_error,
  model_settings_load_error_title,
  model_settings_local_fixture,
  model_settings_model_types,
  model_settings_personal_default,
  model_settings_personal_default_action,
  model_settings_personal_default_updated,
  model_settings_production_available,
  model_settings_recent_rank,
  model_settings_refresh,
  model_settings_retry,
  model_settings_save_error,
  model_settings_selected,
  model_settings_selection_recorded,
  model_settings_tagline_anthropic,
  model_settings_tagline_domestic,
  model_settings_tagline_gemini,
  model_settings_tagline_openai,
  model_settings_unavailable,
  model_settings_unavailable_fallback,
  model_settings_unfavorite,
  model_settings_use_this_run,
  model_settings_video_description,
  model_settings_video_title,
  model_settings_workspace_default,
  model_settings_workspace_default_action,
  model_settings_workspace_default_updated,
} from '@/locale/paraglide/messages';
import { cn } from '@/lib/utils';
import { commandP1, queryP1 } from '@/p1/client';
import {
  readCurrentModelSelection,
  writeCurrentModelSelection,
} from '@/p1/model-current-selection';
import { modelPreviewUrl } from '@/p1/model-preview';
import {
  normalizeCatalog,
  normalizePreferences,
  type CatalogModelView,
  type CatalogView,
  type ModelOperation,
  type ModelPreferencesView,
} from '@/p1/settings-view-model';
import { p1QueryKeys } from '@/p1/query-keys';
import { useWorkspaceAccess } from '@/p1/use-workspace-access';
import {
  IconCheck,
  IconHeart,
  IconPhoto,
  IconRefresh,
  IconSparkles,
  IconVideo,
} from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

interface ModelSection {
  id: 'llm' | 'image' | 'video';
  title: () => string;
  description: () => string;
  operation: ModelOperation;
  icon: typeof IconSparkles;
}

const MODEL_SECTIONS: ModelSection[] = [
  {
    id: 'llm',
    title: model_settings_llm_title,
    description: model_settings_llm_description,
    operation: 'copy.generate',
    icon: IconSparkles,
  },
  {
    id: 'image',
    title: model_settings_image_title,
    description: model_settings_image_description,
    operation: 'image.generate',
    icon: IconPhoto,
  },
  {
    id: 'video',
    title: model_settings_video_title,
    description: model_settings_video_description,
    operation: 'video.generate',
    icon: IconVideo,
  },
];

const MODEL_TAGLINES: Record<string, () => string> = {
  'llm-anthropic': model_settings_tagline_anthropic,
  'llm-domestic': model_settings_tagline_domestic,
  'llm-gemini': model_settings_tagline_gemini,
  'llm-openai': model_settings_tagline_openai,
};

function ModelStatus({ model }: { model: CatalogModelView }) {
  if (model.availabilityKind === 'local_fixture') {
    return (
      <Badge className="text-muted-foreground" variant="ghost">
        {model_settings_local_fixture()}
      </Badge>
    );
  }
  return model.available ? (
    <Badge variant="secondary">
      <IconCheck />
      {model_settings_production_available()}
    </Badge>
  ) : (
    <Badge variant="destructive">{model_settings_unavailable()}</Badge>
  );
}

/** Merchant dual-end channel label (F-J-01); same keys as ModelCardPicker. */
function ModelChannelReadinessBadge({ model }: { model: CatalogModelView }) {
  if (model.channelReadiness === 'multi_channel_ready') {
    return (
      <Badge data-channel-readiness="multi_channel_ready" variant="secondary">
        {model_card_channel_multi()}
      </Badge>
    );
  }
  if (model.channelReadiness === 'single_channel') {
    return (
      <Badge data-channel-readiness="single_channel" variant="outline">
        {model_card_channel_single()}
      </Badge>
    );
  }
  return null;
}

interface ModelCardProps {
  busy: boolean;
  canManageWorkspace: boolean;
  canPersonalize: boolean;
  current: boolean;
  model: CatalogModelView;
  preferences: ModelPreferencesView;
  onFavorite: (model: CatalogModelView) => Promise<void>;
  onSetUserDefault: (model: CatalogModelView) => Promise<void>;
  onSetWorkspaceDefault: (model: CatalogModelView) => Promise<void>;
}

function ModelCard({
  busy,
  canManageWorkspace,
  canPersonalize,
  current,
  model,
  preferences,
  onFavorite,
  onSetUserDefault,
  onSetWorkspaceDefault,
}: ModelCardProps) {
  const favorite = preferences.favorites.includes(model.id);
  const recentIndex = preferences.recent.indexOf(model.id);
  const selectionDisabled = busy || !model.available || !canPersonalize;
  const tagline = MODEL_TAGLINES[model.id]?.();
  return (
    <Card
      className={cn(current && 'bg-surface-2')}
      data-selected={current || undefined}
    >
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <label
            className={cn(
              'flex min-h-touch-target cursor-pointer items-center gap-2',
              selectionDisabled && 'cursor-not-allowed opacity-65',
              current && 'text-primary'
            )}
            htmlFor={`model-option-${model.id}`}
          >
            <RadioGroupItem
              aria-label={model.displayName}
              disabled={selectionDisabled}
              id={`model-option-${model.id}`}
              value={model.id}
            />
            <span>{model.displayName}</span>
          </label>
          <ModelStatus model={model} />
          <ModelChannelReadinessBadge model={model} />
        </CardTitle>
        <CardDescription className="meiye-type-body text-foreground">
          {tagline ??
            (model.capabilityLabels.join(' · ') ||
              model_settings_capability_pending())}
        </CardDescription>
        <CardAction>
          <Button
            aria-label={
              favorite ? model_settings_unfavorite() : model_settings_favorite()
            }
            disabled={busy || !model.available || !canPersonalize}
            onClick={() => void onFavorite(model)}
            size="icon-sm"
            variant={favorite ? 'secondary' : 'ghost'}
          >
            <IconHeart className={favorite ? 'fill-current' : undefined} />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex min-h-5 flex-wrap gap-2">
          {preferences.userDefault === model.id ? (
            <Badge variant="secondary">
              {model_settings_personal_default()}
            </Badge>
          ) : null}
          {preferences.workspaceDefault === model.id ? (
            <Badge variant="secondary">
              {model_settings_workspace_default()}
            </Badge>
          ) : null}
          {recentIndex >= 0 ? (
            <Badge variant="ghost">
              {model_settings_recent_rank({ rank: recentIndex + 1 })}
            </Badge>
          ) : null}
          {current ? (
            <Badge variant="secondary">
              <IconCheck />
              {model_settings_selected()}
            </Badge>
          ) : null}
        </div>
        {!model.available ? (
          <p className="text-sm text-destructive">
            {model.unavailableReason ?? model_settings_unavailable_fallback()}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={busy || !model.available || !canPersonalize}
            onClick={() => void onSetUserDefault(model)}
            variant="outline"
          >
            {model_settings_personal_default_action()}
          </Button>
          {canManageWorkspace ? (
            <Button
              disabled={busy || !model.available}
              onClick={() => void onSetWorkspaceDefault(model)}
              variant="outline"
            >
              {model_settings_workspace_default_action()}
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function LoadingCards() {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {[0, 1, 2, 3].map((value) => (
        <Skeleton className="h-52 rounded-xl" key={value} />
      ))}
    </div>
  );
}

export function ModelSettings() {
  const access = useWorkspaceAccess();
  const [sectionId, setSectionId] = useState<ModelSection['id']>('llm');
  const [currentSelections, setCurrentSelections] = useState<
    Partial<Record<ModelOperation, string>>
  >(() =>
    Object.fromEntries(
      MODEL_SECTIONS.flatMap((item) => {
        const selection = readCurrentModelSelection(item.operation);
        return selection ? [[item.operation, selection.catalogModelId]] : [];
      })
    )
  );

  const section =
    MODEL_SECTIONS.find((candidate) => candidate.id === sectionId) ??
    MODEL_SECTIONS[0];
  const queryClient = useQueryClient();
  const catalogQuery = useQuery({
    queryKey: p1QueryKeys.request('model-supply', 'catalog', {
      operation: section.operation,
    }),
    queryFn: ({ signal }) =>
      queryP1<unknown>(
        'model-supply',
        { action: 'catalog', payload: { operation: section.operation } },
        signal
      ),
  });
  const preferencesQuery = useQuery({
    queryKey: p1QueryKeys.request('model-supply', 'preferences', {
      operation: section.operation,
    }),
    queryFn: ({ signal }) =>
      queryP1<unknown>(
        'model-supply',
        { action: 'preferences', payload: { operation: section.operation } },
        signal
      ),
  });
  const commandMutation = useMutation({
    mutationFn: (request: {
      action: string;
      operation: ModelOperation;
      payload: Record<string, unknown>;
    }) =>
      commandP1('model-supply', {
        action: request.action,
        payload: { operation: request.operation, ...request.payload },
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: p1QueryKeys.module('model-supply'),
      }),
  });
  const catalog = useMemo<CatalogView>(
    () => normalizeCatalog(catalogQuery.data, section.operation),
    [catalogQuery.data, section.operation]
  );
  const preferences = useMemo<ModelPreferencesView>(
    () => normalizePreferences(preferencesQuery.data),
    [preferencesQuery.data]
  );
  const loading = catalogQuery.isPending || preferencesQuery.isPending;
  const errorCause = catalogQuery.error ?? preferencesQuery.error;
  const error = errorCause ? model_settings_load_error() : undefined;
  const busy = commandMutation.isPending;
  const canPersonalize = access.can('personal.preferences.manage');
  const canManageWorkspace = access.can('workspace.models.manage');

  const refresh = () =>
    Promise.all([catalogQuery.refetch(), preferencesQuery.refetch()]);

  const execute = async (
    action: string,
    payload: Record<string, unknown>,
    successMessage: string,
    operation: ModelOperation = section.operation
  ) => {
    try {
      await commandMutation.mutateAsync({ action, operation, payload });
      toast.success(successMessage);
    } catch {
      toast.error(model_settings_save_error());
    }
  };

  const selectModel = async (model: CatalogModelView) => {
    const operation = section.operation;
    writeCurrentModelSelection(operation, {
      catalogModelId: model.id,
      mode: 'fixed',
    });
    setCurrentSelections((current) => ({
      ...current,
      [operation]: model.id,
    }));
    await execute(
      'record_recent',
      { modelId: model.id },
      model_settings_selection_recorded(),
      operation
    );
  };

  const currentSelection = currentSelections[section.operation];
  const SectionIcon = section.icon;

  return (
    <Tabs
      onValueChange={(value) => {
        const nextId = value as ModelSection['id'];
        setSectionId(nextId);
      }}
      value={sectionId}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <TabsList aria-label={model_settings_model_types()}>
          {MODEL_SECTIONS.map((item) => {
            const Icon = item.icon;
            return (
              <TabsTrigger key={item.id} value={item.id}>
                <Icon />
                {item.title()}
              </TabsTrigger>
            );
          })}
        </TabsList>
        <Button
          disabled={loading}
          onClick={() => void refresh()}
          variant="outline"
        >
          <IconRefresh />
          {model_settings_refresh()}
        </Button>
      </div>

      {MODEL_SECTIONS.map((item) => (
        <TabsContent key={item.id} value={item.id}>
          <div className="mb-4 flex items-center gap-4 rounded-xl bg-surface-1 p-4">
            <item.icon className="size-5 shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              <h2 className="font-medium">{item.title()}</h2>
              <p className="meiye-type-aux mt-1">{item.description()}</p>
            </div>
            <img
              alt={model_card_preview_alt({ name: item.title() })}
              className="size-20 shrink-0 rounded-lg object-cover"
              loading="lazy"
              src={modelPreviewUrl(item.id)}
            />
          </div>
        </TabsContent>
      ))}

      {error ? (
        <Card>
          <CardHeader>
            <CardTitle>{model_settings_load_error_title()}</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => void refresh()} variant="outline">
              {model_settings_retry()}
            </Button>
          </CardContent>
        </Card>
      ) : loading ? (
        <LoadingCards />
      ) : (
        <div className="space-y-4">
          <RadioGroup
            aria-label={model_settings_use_this_run()}
            className="grid gap-4 lg:grid-cols-2"
            onValueChange={(value) => {
              const model = catalog.models.find(
                (candidate) => candidate.id === value
              );
              if (!model || model.id === currentSelection) return;
              void selectModel(model);
            }}
            value={currentSelection ?? ''}
          >
            {catalog.models.map((model) => (
              <ModelCard
                busy={busy}
                canManageWorkspace={canManageWorkspace}
                canPersonalize={canPersonalize}
                current={currentSelection === model.id}
                key={model.id}
                model={model}
                onFavorite={(candidate) =>
                  execute(
                    'set_favorite',
                    {
                      favorite: !preferences.favorites.includes(candidate.id),
                      modelId: candidate.id,
                    },
                    preferences.favorites.includes(candidate.id)
                      ? model_settings_favorite_removed()
                      : model_settings_favorite_added()
                  )
                }
                onSetUserDefault={(candidate) =>
                  execute(
                    'set_user_default',
                    { modelId: candidate.id },
                    model_settings_personal_default_updated()
                  )
                }
                onSetWorkspaceDefault={(candidate) =>
                  execute(
                    'set_workspace_default',
                    { modelId: candidate.id },
                    model_settings_workspace_default_updated()
                  )
                }
                preferences={preferences}
              />
            ))}
          </RadioGroup>
          {catalog.models.length === 0 ? (
            <Card>
              <CardContent className="py-6 text-center text-muted-foreground">
                <SectionIcon className="mx-auto mb-2 size-6" />
                {model_settings_empty()}
              </CardContent>
            </Card>
          ) : null}
        </div>
      )}
    </Tabs>
  );
}
