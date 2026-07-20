import { isRestrictedProductAsset } from '@meiye/contracts';
import {
  IconCamera,
  IconChevronDown,
  IconChevronUp,
  IconPhoto,
  IconRefresh,
  IconTrash,
  IconUpload,
} from '@tabler/icons-react';
import {
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type RefObject,
  type ReactNode,
} from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  composer_image_camera,
  composer_image_camera_aria,
  composer_image_category,
  composer_image_category_before_after,
  composer_image_category_customer_case,
  composer_image_category_other,
  composer_image_category_price_list,
  composer_image_category_store,
  composer_image_authorize_attach,
  composer_image_confirm_facts,
  composer_image_confirm_upload,
  composer_image_contains_minor,
  composer_image_contains_person,
  composer_image_contains_sensitive_data,
  composer_image_description,
  composer_image_details_collapse,
  composer_image_details_expand,
  composer_image_drop_paste,
  composer_image_duplicate,
  composer_image_empty,
  composer_image_facts_confirmed,
  composer_image_internal_only,
  composer_image_internal_saved,
  composer_image_minor_public_blocked,
  composer_image_no,
  composer_image_one_click_no,
  composer_image_one_click_question,
  composer_image_one_click_yes,
  composer_image_only_images,
  composer_image_preview_alt,
  composer_image_public_marketing,
  composer_image_received,
  composer_image_received_with_rejected,
  composer_image_remove,
  composer_image_remove_aria,
  composer_image_remove_keeps_asset,
  composer_image_retry,
  composer_image_rights_evidence_expand,
  composer_image_rights_evidence_optional,
  composer_image_rights_expiry,
  composer_image_rights_no_expiry,
  composer_image_rights_platforms,
  composer_image_rights_required,
  composer_image_scope,
  composer_image_status_ready,
  composer_image_status_authorization_required,
  composer_image_status_uploading,
  composer_image_title,
  composer_image_upload,
  composer_image_upload_aria,
  composer_image_upload_failed,
  composer_image_upload_list_aria,
  composer_image_platform_douyin,
  composer_image_platform_xiaohongshu,
  composer_image_yes,
} from '@/locale/paraglide/messages';
import { cn } from '@/lib/utils';
import {
  confirmedAssetFacts,
  ordinaryOneClickAnswers,
  type AssetFactAnswers,
  type ConfirmedAssetFacts,
} from '@/product/creation-entry-model';

export interface ComposerImageIdentity {
  assetId: string;
  contentHash: string;
  uploadId: string;
}

interface UploadItem {
  answers: AssetFactAnswers;
  assetId?: string;
  error?: string;
  file: File;
  id: string;
  previewUrl: string;
  showDetails: boolean;
  showEvidence: boolean;
  status:
    | 'confirming'
    | 'uploading'
    | 'authorization_required'
    | 'ready'
    | 'failed';
}

export interface ComposerImageUploadResult {
  attached: boolean;
}

async function imageIdentity(file: File): Promise<ComposerImageIdentity> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    await file.arrayBuffer()
  );
  const contentHash = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');
  return {
    assetId: `asset-${contentHash.slice(0, 32)}`,
    contentHash,
    uploadId: `composer-${contentHash.slice(0, 32)}`,
  };
}

function FactChoice({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange: (value: boolean) => void;
  value: boolean | undefined;
}) {
  return (
    <fieldset className="min-w-0 space-y-2 rounded-2xl bg-muted p-3">
      <legend className="px-1 text-xs font-medium">{label}</legend>
      <div className="flex gap-2">
        {(
          [
            [false, composer_image_no()],
            [true, composer_image_yes()],
          ] as const
        ).map(([next, text]) => (
          <Button
            aria-pressed={value === next}
            className="flex-1"
            key={text}
            onClick={() => onChange(next)}
            size="sm"
            type="button"
            variant={value === next ? 'secondary' : 'outline'}
          >
            {text}
          </Button>
        ))}
      </div>
    </fieldset>
  );
}

export function ComposerImageInput({
  children,
  focusRef,
  onAssetAdded,
  onAssetRemoved,
  onAuthorize,
  onQueueChange,
  onUpload,
}: {
  children: ReactNode;
  focusRef: RefObject<HTMLElement | null>;
  onAssetAdded: (assetId: string) => void;
  onAssetRemoved: (assetId: string) => void;
  onAuthorize: (assetId: string, facts: ConfirmedAssetFacts) => Promise<void>;
  onQueueChange: (
    uploads: Array<{ status: 'uploading' | 'ready' | 'failed' }>
  ) => void;
  onUpload: (
    file: File,
    facts: ConfirmedAssetFacts,
    identity: ComposerImageIdentity
  ) => Promise<ComposerImageUploadResult>;
}) {
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const seenHashesRef = useRef(new Set<string>());
  const previewUrlsRef = useRef(new Set<string>());
  useEffect(() => {
    onQueueChange(
      uploads.map(({ status }) => ({
        status:
          status === 'confirming' || status === 'authorization_required'
            ? 'ready'
            : status,
      }))
    );
  }, [onQueueChange, uploads]);

  useEffect(
    () => () => {
      for (const url of previewUrlsRef.current) URL.revokeObjectURL(url);
    },
    []
  );

  const uploadItem = async (item: UploadItem, facts: ConfirmedAssetFacts) => {
    try {
      const identity = await imageIdentity(item.file);
      if (seenHashesRef.current.has(identity.contentHash)) {
        setUploads((current) => current.filter(({ id }) => id !== item.id));
        URL.revokeObjectURL(item.previewUrl);
        previewUrlsRef.current.delete(item.previewUrl);
        setNotice(composer_image_duplicate());
        return;
      }
      seenHashesRef.current.add(identity.contentHash);
      const result = await onUpload(item.file, facts, identity);
      setUploads((current) =>
        current.map((candidate) =>
          candidate.id === item.id
            ? {
                ...candidate,
                assetId: identity.assetId,
                error: undefined,
                status: result.attached ? 'ready' : 'authorization_required',
              }
            : candidate
        )
      );
      if (result.attached) onAssetAdded(identity.assetId);
    } catch {
      const identity = await imageIdentity(item.file).catch(() => undefined);
      if (identity) seenHashesRef.current.delete(identity.contentHash);
      setUploads((current) =>
        current.map((candidate) =>
          candidate.id === item.id
            ? {
                ...candidate,
                error: composer_image_upload_failed(),
                status: 'failed',
              }
            : candidate
        )
      );
    }
  };

  const ingestImages = (files: File[]) => {
    const images = files.filter((file) => file.type.startsWith('image/'));
    const rejected = files.length - images.length;
    if (images.length === 0) {
      setNotice(composer_image_only_images());
      return;
    }
    setNotice(
      rejected > 0
        ? composer_image_received_with_rejected({
            images: images.length,
            rejected,
          })
        : composer_image_received({ count: images.length })
    );
    for (const file of images) {
      const previewUrl = URL.createObjectURL(file);
      previewUrlsRef.current.add(previewUrl);
      const item: UploadItem = {
        answers: {
          category: 'store',
          consentScope: undefined,
          containsPerson: undefined,
          containsSensitiveData: undefined,
          minorStatus: undefined,
          rightsEvidence: '',
          rightsNoFixedExpiry: false,
          rightsPlatforms: [],
          rightsValidUntil: '',
        },
        file,
        id: crypto.randomUUID(),
        previewUrl,
        showDetails: false,
        showEvidence: false,
        status: 'confirming',
      };
      setUploads((current) => [...current, item]);
    }
  };

  const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
    const images = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .flatMap((item) => {
        const file = item.getAsFile();
        return file ? [file] : [];
      });
    if (images.length === 0) return;
    event.preventDefault();
    ingestImages(images);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    ingestImages(Array.from(event.dataTransfer.files));
  };

  return (
    <section
      aria-labelledby="composer-input-title"
      className="space-y-3"
      ref={focusRef}
      tabIndex={-1}
    >
      <div>
        <h3 className="text-sm font-semibold" id="composer-input-title">
          {composer_image_title()}
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {composer_image_description()}
        </p>
      </div>
      <div
        className={cn(
          'space-y-3 rounded-2xl border border-dashed border-divider bg-muted p-3 transition-colors',
          dragging && 'border-primary bg-primary/5'
        )}
        onDragEnter={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node)) {
            setDragging(false);
          }
        }}
        onDragOver={(event) => event.preventDefault()}
        onDrop={handleDrop}
        onPaste={handlePaste}
      >
        {children}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            onClick={() =>
              document.getElementById('composer-camera-input')?.click()
            }
            size="sm"
            type="button"
            variant="outline"
          >
            <IconCamera aria-hidden="true" />
            {composer_image_camera()}
          </Button>
          <input
            accept="image/*"
            aria-label={composer_image_camera_aria()}
            capture="environment"
            className="sr-only"
            id="composer-camera-input"
            onChange={(event) => {
              ingestImages(Array.from(event.target.files ?? []));
              event.target.value = '';
            }}
            type="file"
          />
          <Button
            onClick={() =>
              document.getElementById('composer-gallery-input')?.click()
            }
            size="sm"
            type="button"
            variant="outline"
          >
            <IconUpload aria-hidden="true" />
            {composer_image_upload()}
          </Button>
          <input
            accept="image/*"
            aria-label={composer_image_upload_aria()}
            className="sr-only"
            id="composer-gallery-input"
            multiple
            onChange={(event) => {
              ingestImages(Array.from(event.target.files ?? []));
              event.target.value = '';
            }}
            type="file"
          />
          <span className="text-xs text-muted-foreground">
            {composer_image_drop_paste()}
          </span>
        </div>
      </div>
      {notice ? (
        <p aria-live="polite" className="text-xs text-muted-foreground">
          {notice}
        </p>
      ) : null}
      {uploads.length > 0 ? (
        <ul
          className={cn(
            'grid gap-px overflow-hidden rounded-2xl bg-divider',
            uploads.length > 1 && 'sm:grid-cols-2'
          )}
          aria-label={composer_image_upload_list_aria()}
        >
          {uploads.map((item) => {
            const evidenceOptions = {
              evidenceContext: 'composer' as const,
              evidenceNonce: item.id,
            };
            const itemFacts = confirmedAssetFacts(
              item.answers,
              evidenceOptions
            );
            const restricted =
              item.answers.category !== undefined &&
              item.answers.containsPerson !== undefined &&
              isRestrictedProductAsset({
                category: item.answers.category,
                containsPerson: item.answers.containsPerson,
              });
            const updateItem = (patch: Partial<UploadItem>) =>
              setUploads((current) =>
                current.map((candidate) =>
                  candidate.id === item.id
                    ? { ...candidate, ...patch }
                    : candidate
                )
              );
            const updateAnswers = (answers: AssetFactAnswers) =>
              updateItem({ answers });
            const submitFacts = (
              facts: ConfirmedAssetFacts,
              answers?: AssetFactAnswers
            ) => {
              if (item.status === 'authorization_required' && item.assetId) {
                if (facts.consentScope !== 'public_marketing') return;
                updateItem({
                  ...(answers ? { answers } : {}),
                  status: 'uploading',
                });
                void onAuthorize(item.assetId, facts)
                  .then(() => {
                    updateItem({ status: 'ready' });
                    onAssetAdded(item.assetId!);
                  })
                  .catch(() => {
                    updateItem({
                      error: composer_image_upload_failed(),
                      status: 'authorization_required',
                    });
                  });
                return;
              }
              updateItem({
                ...(answers ? { answers } : {}),
                status: 'uploading',
              });
              void uploadItem(item, facts);
            };
            const submitOneClick = (
              consentScope: 'internal_only' | 'public_marketing'
            ) => {
              const answers = ordinaryOneClickAnswers({
                confirmsNoPeopleBeforeAfterCustomerCaseOrSensitiveData:
                  consentScope === 'public_marketing',
                consentScope,
              });
              if (!answers) return;
              const facts = confirmedAssetFacts(answers, evidenceOptions);
              if (!facts) return;
              submitFacts(facts, answers);
            };
            return (
              <li className="min-w-0 space-y-3 bg-surface-2 p-3" key={item.id}>
                <div className="flex gap-3">
                  <img
                    alt={composer_image_preview_alt({ name: item.file.name })}
                    className="size-20 rounded object-cover"
                    src={item.previewUrl}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {item.file.name}
                    </p>
                    {item.status === 'ready' ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {composer_image_facts_confirmed()}
                      </p>
                    ) : null}
                    <p
                      aria-live="polite"
                      className={cn(
                        'mt-1 text-xs',
                        item.status === 'failed'
                          ? 'text-destructive'
                          : 'text-muted-foreground'
                      )}
                    >
                      {item.status === 'confirming'
                        ? composer_image_confirm_facts()
                        : item.status === 'uploading'
                          ? composer_image_status_uploading()
                          : item.status === 'authorization_required'
                            ? composer_image_status_authorization_required()
                            : item.status === 'ready'
                              ? composer_image_status_ready()
                              : (item.error ?? composer_image_upload_failed())}
                    </p>
                    {item.status === 'ready' ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {composer_image_remove_keeps_asset()}
                      </p>
                    ) : null}
                  </div>
                </div>
                {item.status === 'confirming' ||
                item.status === 'authorization_required' ? (
                  <div className="space-y-3">
                    {!item.showDetails ? (
                      <div className="space-y-3 rounded-2xl bg-muted p-3">
                        <p className="text-sm font-medium">
                          {composer_image_one_click_question()}
                        </p>
                        <div className="grid gap-2">
                          <Button
                            className="h-auto min-h-11 whitespace-normal py-2 text-center leading-snug"
                            onClick={() => submitOneClick('public_marketing')}
                            size="sm"
                            type="button"
                          >
                            {composer_image_one_click_yes()}
                          </Button>
                          <Button
                            className="h-auto min-h-11 whitespace-normal py-2 text-center leading-snug"
                            onClick={() => submitOneClick('internal_only')}
                            size="sm"
                            type="button"
                            variant="outline"
                          >
                            {composer_image_one_click_no()}
                          </Button>
                        </div>
                        <Button
                          aria-expanded={false}
                          className="h-auto w-full justify-start px-0 py-1 text-left text-xs font-normal text-muted-foreground hover:bg-transparent hover:text-foreground"
                          onClick={() => updateItem({ showDetails: true })}
                          type="button"
                          variant="ghost"
                        >
                          <IconChevronDown
                            aria-hidden="true"
                            className="size-4"
                          />
                          {composer_image_details_expand()}
                        </Button>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <Button
                          aria-expanded
                          className="h-auto w-full justify-start px-0 py-1 text-left text-xs font-normal text-muted-foreground hover:bg-transparent hover:text-foreground"
                          onClick={() => updateItem({ showDetails: false })}
                          type="button"
                          variant="ghost"
                        >
                          <IconChevronUp
                            aria-hidden="true"
                            className="size-4"
                          />
                          {composer_image_details_collapse()}
                        </Button>
                        <fieldset className="space-y-2 rounded-2xl bg-muted p-3">
                          <legend className="px-1 text-xs font-medium">
                            {composer_image_category()}
                          </legend>
                          <select
                            aria-label={composer_image_category()}
                            className="h-10 w-full rounded-md border border-divider bg-surface-1 px-3 text-sm"
                            onChange={(event) =>
                              updateAnswers({
                                ...item.answers,
                                category: event.target
                                  .value as AssetFactAnswers['category'],
                              })
                            }
                            value={item.answers.category ?? 'store'}
                          >
                            <option value="store">
                              {composer_image_category_store()}
                            </option>
                            <option value="before_after">
                              {composer_image_category_before_after()}
                            </option>
                            <option value="customer_case">
                              {composer_image_category_customer_case()}
                            </option>
                            <option value="price_list">
                              {composer_image_category_price_list()}
                            </option>
                            <option value="other">
                              {composer_image_category_other()}
                            </option>
                          </select>
                        </fieldset>
                        <div className="grid gap-px overflow-hidden rounded-xl bg-divider">
                          <FactChoice
                            label={composer_image_contains_person()}
                            onChange={(value) =>
                              updateAnswers({
                                ...item.answers,
                                containsPerson: value,
                              })
                            }
                            value={item.answers.containsPerson}
                          />
                          <FactChoice
                            label={composer_image_contains_sensitive_data()}
                            onChange={(value) =>
                              updateAnswers({
                                ...item.answers,
                                containsSensitiveData: value,
                              })
                            }
                            value={item.answers.containsSensitiveData}
                          />
                          <FactChoice
                            label={composer_image_contains_minor()}
                            onChange={(value) =>
                              updateAnswers({
                                ...item.answers,
                                minorStatus: value ? 'minor' : 'none',
                                ...(value
                                  ? { consentScope: 'internal_only' }
                                  : {}),
                              })
                            }
                            value={
                              item.answers.minorStatus === undefined
                                ? undefined
                                : item.answers.minorStatus === 'minor'
                            }
                          />
                        </div>
                        <fieldset className="space-y-2 rounded-2xl bg-muted p-3">
                          <legend className="px-1 text-xs font-medium">
                            {composer_image_scope()}
                          </legend>
                          <div className="flex gap-2">
                            {(
                              [
                                [
                                  'internal_only',
                                  composer_image_internal_only(),
                                ],
                                [
                                  'public_marketing',
                                  composer_image_public_marketing(),
                                ],
                              ] as const
                            ).map(([scope, label]) => (
                              <Button
                                aria-pressed={
                                  item.answers.consentScope === scope
                                }
                                className="flex-1"
                                disabled={
                                  scope === 'public_marketing' &&
                                  item.answers.minorStatus === 'minor'
                                }
                                key={scope}
                                onClick={() =>
                                  updateAnswers({
                                    ...item.answers,
                                    consentScope: scope,
                                  })
                                }
                                size="sm"
                                type="button"
                                variant={
                                  item.answers.consentScope === scope
                                    ? 'secondary'
                                    : 'outline'
                                }
                              >
                                {label}
                              </Button>
                            ))}
                          </div>
                          {item.answers.minorStatus === 'minor' ? (
                            <p className="text-xs text-destructive">
                              {composer_image_minor_public_blocked()}
                            </p>
                          ) : null}
                        </fieldset>
                        {item.answers.consentScope === 'public_marketing' ? (
                          <div className="space-y-3 rounded-2xl bg-muted p-3">
                            {restricted ? (
                              <>
                                <fieldset className="space-y-2">
                                  <legend className="text-xs font-medium">
                                    {composer_image_rights_platforms()}
                                  </legend>
                                  <div className="flex gap-2">
                                    {(
                                      [
                                        [
                                          'xiaohongshu',
                                          composer_image_platform_xiaohongshu(),
                                        ],
                                        [
                                          'douyin',
                                          composer_image_platform_douyin(),
                                        ],
                                      ] as const
                                    ).map(([platform, label]) => {
                                      const selected =
                                        item.answers.rightsPlatforms.includes(
                                          platform
                                        );
                                      return (
                                        <Button
                                          aria-pressed={selected}
                                          key={platform}
                                          onClick={() =>
                                            updateAnswers({
                                              ...item.answers,
                                              rightsPlatforms: selected
                                                ? item.answers.rightsPlatforms.filter(
                                                    (value) =>
                                                      value !== platform
                                                  )
                                                : [
                                                    ...item.answers
                                                      .rightsPlatforms,
                                                    platform,
                                                  ],
                                            })
                                          }
                                          size="sm"
                                          type="button"
                                          variant={
                                            selected ? 'secondary' : 'outline'
                                          }
                                        >
                                          {label}
                                        </Button>
                                      );
                                    })}
                                  </div>
                                </fieldset>
                                <fieldset className="space-y-2">
                                  <legend className="text-xs font-medium">
                                    {composer_image_rights_expiry()}
                                  </legend>
                                  <Button
                                    aria-pressed={
                                      item.answers.rightsNoFixedExpiry
                                    }
                                    onClick={() =>
                                      updateAnswers({
                                        ...item.answers,
                                        rightsNoFixedExpiry:
                                          !item.answers.rightsNoFixedExpiry,
                                        rightsValidUntil: '',
                                      })
                                    }
                                    size="sm"
                                    type="button"
                                    variant={
                                      item.answers.rightsNoFixedExpiry
                                        ? 'secondary'
                                        : 'outline'
                                    }
                                  >
                                    {composer_image_rights_no_expiry()}
                                  </Button>
                                  {!item.answers.rightsNoFixedExpiry ? (
                                    <Input
                                      aria-label={composer_image_rights_expiry()}
                                      min={new Date()
                                        .toISOString()
                                        .slice(0, 10)}
                                      onChange={(event) =>
                                        updateAnswers({
                                          ...item.answers,
                                          rightsValidUntil: event.target.value,
                                        })
                                      }
                                      type="date"
                                      value={item.answers.rightsValidUntil}
                                    />
                                  ) : null}
                                </fieldset>
                              </>
                            ) : null}
                            {item.showEvidence ? (
                              <label
                                className="block text-xs font-medium"
                                htmlFor={`${item.id}-rights-evidence`}
                              >
                                {composer_image_rights_evidence_optional()}
                                <Input
                                  className="mt-2 bg-surface-1"
                                  id={`${item.id}-rights-evidence`}
                                  onChange={(event) =>
                                    updateAnswers({
                                      ...item.answers,
                                      rightsEvidence: event.target.value,
                                    })
                                  }
                                  value={item.answers.rightsEvidence}
                                />
                              </label>
                            ) : (
                              <Button
                                className="h-auto px-0 py-1 text-xs font-normal text-muted-foreground hover:bg-transparent hover:text-foreground"
                                onClick={() =>
                                  updateItem({ showEvidence: true })
                                }
                                type="button"
                                variant="ghost"
                              >
                                {composer_image_rights_evidence_expand()}
                              </Button>
                            )}
                            {!itemFacts ? (
                              <p className="text-xs text-destructive">
                                {composer_image_rights_required()}
                              </p>
                            ) : null}
                          </div>
                        ) : null}
                        <Button
                          disabled={!itemFacts}
                          onClick={() => {
                            if (!itemFacts) return;
                            submitFacts(itemFacts);
                          }}
                          size="sm"
                          type="button"
                        >
                          <IconUpload aria-hidden="true" />
                          {item.status === 'authorization_required'
                            ? composer_image_authorize_attach()
                            : composer_image_confirm_upload()}
                        </Button>
                      </div>
                    )}
                    {item.status === 'authorization_required' ? (
                      <p className="text-xs text-muted-foreground">
                        {composer_image_internal_saved()}
                      </p>
                    ) : null}
                  </div>
                ) : null}
                <div className="mt-2 flex gap-2">
                  {item.status === 'failed' && itemFacts ? (
                    <Button
                      onClick={() => {
                        updateItem({ error: undefined, status: 'uploading' });
                        void uploadItem(item, itemFacts);
                      }}
                      size="xs"
                      type="button"
                      variant="outline"
                    >
                      <IconRefresh aria-hidden="true" />
                      {composer_image_retry()}
                    </Button>
                  ) : null}
                  {item.status !== 'uploading' ? (
                    <Button
                      aria-label={composer_image_remove_aria({
                        name: item.file.name,
                      })}
                      onClick={() => {
                        if (item.assetId) onAssetRemoved(item.assetId);
                        void imageIdentity(item.file).then((identity) =>
                          seenHashesRef.current.delete(identity.contentHash)
                        );
                        URL.revokeObjectURL(item.previewUrl);
                        previewUrlsRef.current.delete(item.previewUrl);
                        setUploads((current) =>
                          current.filter(
                            (candidate) => candidate.id !== item.id
                          )
                        );
                      }}
                      size="xs"
                      type="button"
                      variant="ghost"
                    >
                      <IconTrash aria-hidden="true" />
                      {composer_image_remove()}
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="flex items-center gap-2 rounded-xl bg-muted p-3 text-xs text-muted-foreground">
          <IconPhoto aria-hidden="true" className="size-4" />
          {composer_image_empty()}
        </div>
      )}
    </section>
  );
}
