import { Button } from '@/components/ui/button';
import {
  composer_image_camera,
  composer_image_camera_aria,
  composer_image_confirm_facts,
  composer_image_confirm_upload,
  composer_image_contains_minor,
  composer_image_contains_person,
  composer_image_contains_sensitive_data,
  composer_image_description,
  composer_image_drop_paste,
  composer_image_duplicate,
  composer_image_empty,
  composer_image_facts_confirmed,
  composer_image_no,
  composer_image_only_images,
  composer_image_preview_alt,
  composer_image_received,
  composer_image_received_with_rejected,
  composer_image_remove,
  composer_image_remove_aria,
  composer_image_remove_keeps_asset,
  composer_image_retry,
  composer_image_status_ready,
  composer_image_status_uploading,
  composer_image_title,
  composer_image_upload,
  composer_image_upload_aria,
  composer_image_upload_failed,
  composer_image_upload_list_aria,
  composer_image_yes,
} from '@/locale/paraglide/messages';
import { cn } from '@/lib/utils';
import {
  IconCamera,
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

import {
  confirmedAssetFacts,
  type AssetFactAnswers,
  type ConfirmedAssetFacts,
} from './creation-entry-model';

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
  status: 'confirming' | 'uploading' | 'ready' | 'failed';
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
  onQueueChange,
  onUpload,
}: {
  children: ReactNode;
  focusRef: RefObject<HTMLElement | null>;
  onAssetAdded: (assetId: string) => void;
  onAssetRemoved: (assetId: string) => void;
  onQueueChange: (
    uploads: Array<{ status: 'uploading' | 'ready' | 'failed' }>
  ) => void;
  onUpload: (
    file: File,
    facts: ConfirmedAssetFacts,
    identity: ComposerImageIdentity
  ) => Promise<void>;
}) {
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const seenHashesRef = useRef(new Set<string>());
  const previewUrlsRef = useRef(new Set<string>());
  useEffect(() => {
    onQueueChange(
      uploads.map(({ status }) => ({
        status: status === 'confirming' ? 'uploading' : status,
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
      await onUpload(item.file, facts, identity);
      setUploads((current) =>
        current.map((candidate) =>
          candidate.id === item.id
            ? {
                ...candidate,
                assetId: identity.assetId,
                error: undefined,
                status: 'ready',
              }
            : candidate
        )
      );
      onAssetAdded(identity.assetId);
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
          containsPerson: undefined,
          containsSensitiveData: undefined,
          minorStatus: undefined,
        },
        file,
        id: crypto.randomUUID(),
        previewUrl,
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
          className="grid gap-px overflow-hidden rounded-2xl bg-divider sm:grid-cols-2"
          aria-label={composer_image_upload_list_aria()}
        >
          {uploads.map((item) => {
            const itemFacts = confirmedAssetFacts(item.answers);
            const updateAnswers = (answers: AssetFactAnswers) =>
              setUploads((current) =>
                current.map((candidate) =>
                  candidate.id === item.id
                    ? { ...candidate, answers }
                    : candidate
                )
              );
            return (
              <li className="space-y-3 bg-surface-2 p-3" key={item.id}>
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
                    {item.status !== 'confirming' ? (
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
                          : item.status === 'ready'
                            ? composer_image_status_ready()
                            : (item.error ?? composer_image_upload_failed())}
                    </p>
                    {item.status === 'ready' ? (
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {composer_image_remove_keeps_asset()}
                      </p>
                    ) : null}
                  </div>
                </div>
                {item.status === 'confirming' ? (
                  <div className="space-y-3">
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
                          })
                        }
                        value={
                          item.answers.minorStatus === undefined
                            ? undefined
                            : item.answers.minorStatus === 'minor'
                        }
                      />
                    </div>
                    <Button
                      disabled={!itemFacts}
                      onClick={() => {
                        if (!itemFacts) return;
                        setUploads((current) =>
                          current.map((candidate) =>
                            candidate.id === item.id
                              ? { ...candidate, status: 'uploading' }
                              : candidate
                          )
                        );
                        void uploadItem(item, itemFacts);
                      }}
                      size="sm"
                      type="button"
                    >
                      <IconUpload aria-hidden="true" />
                      {composer_image_confirm_upload()}
                    </Button>
                  </div>
                ) : null}
                <div className="mt-2 flex gap-2">
                  {item.status === 'failed' && itemFacts ? (
                    <Button
                      onClick={() => {
                        setUploads((current) =>
                          current.map((candidate) =>
                            candidate.id === item.id
                              ? {
                                  ...candidate,
                                  error: undefined,
                                  status: 'uploading',
                                }
                              : candidate
                          )
                        );
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
