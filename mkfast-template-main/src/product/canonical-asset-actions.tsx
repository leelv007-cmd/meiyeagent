import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  asset_capture_camera,
  asset_capture_continue,
  asset_capture_description,
  asset_capture_error_description,
  asset_capture_error_title,
  asset_capture_store_required,
  asset_capture_title,
  asset_capture_upload,
  asset_capture_open_existing,
  asset_capture_uploading,
  asset_governance_action_failed,
  asset_governance_authorize,
  asset_governance_category,
  asset_governance_category_before_after,
  asset_governance_category_customer_case,
  asset_governance_category_other,
  asset_governance_category_price_list,
  asset_governance_category_store,
  asset_governance_contains_minor,
  asset_governance_contains_person,
  asset_governance_contains_sensitive_data,
  asset_governance_error_description,
  asset_governance_error_title,
  asset_governance_minor_blocked,
  asset_governance_retry_withdrawal,
  asset_governance_rights_evidence,
  asset_governance_rights_incomplete,
  asset_governance_rights_owner,
  asset_governance_save,
  asset_governance_status_authorized,
  asset_governance_status_blocked,
  asset_governance_status_pending,
  asset_governance_status_withdrawn,
  asset_governance_tags,
  asset_governance_title,
  asset_governance_update_evidence,
  asset_governance_withdraw,
  composer_image_platform_douyin,
  composer_image_platform_xiaohongshu,
  composer_image_rights_expiry,
  composer_image_rights_no_expiry,
  composer_image_rights_platforms,
} from '@/locale/paraglide/messages';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';
import { getPathWithLocale } from '@/lib/urls';
import {
  type ProductAssetUploadResult,
  uploadThroughBoundedRoute,
} from '@/storage/upload-client';
import {
  isRestrictedProductAsset,
  type Asset,
  type Platform,
  type ProductCommand,
} from '@meiye/contracts';
import {
  IconAlertTriangle,
  IconCamera,
  IconCheck,
  IconPhoto,
  IconRefresh,
  IconShieldCheck,
  IconTrash,
  IconUpload,
} from '@tabler/icons-react';
import { useState } from 'react';
import { executeAssetAuthorization } from '@/product/asset-authorization-model';
import {
  findWorkspaceAssetByObjectKey,
  presentAssetRegistrationFailure,
  registerWorkspaceAsset,
} from '@/product/asset-registration';
import { assetAuthorizationPresentation } from './canonical-asset-governance-model';
import type { useProductState } from './client';

type ProductController = Pick<
  ReturnType<typeof useProductState>,
  'error' | 'execute' | 'pending' | 'state'
>;

const AUTHORIZATION_STATUS_LABELS: Record<
  Asset['authorizationStatus'],
  () => string
> = {
  authorized: asset_governance_status_authorized,
  blocked: asset_governance_status_blocked,
  pending: asset_governance_status_pending,
  withdrawn: asset_governance_status_withdrawn,
};

export function CanonicalAssetCapture({
  product,
}: {
  product: ProductController;
}) {
  const isMobile = useIsMobile();
  const [uploading, setUploading] = useState(false);
  const [failure, setFailure] = useState<string>();
  const [failureOutlet, setFailureOutlet] = useState<string>();
  const [createdAssetId, setCreatedAssetId] = useState<string>();

  async function upload(file: File) {
    if (!product.state) return;
    if (!product.state.store) {
      setFailure(asset_capture_store_required());
      setFailureOutlet(undefined);
      return;
    }
    setUploading(true);
    setFailure(undefined);
    setFailureOutlet(undefined);
    let storedKey: string | undefined;
    try {
      const body = new FormData();
      body.append('file', file);
      const stored = await uploadThroughBoundedRoute<ProductAssetUploadResult>(
        body,
        'product_asset'
      );
      storedKey = stored.key;
      const registered = await registerWorkspaceAsset({
        contentHash: stored.contentHash,
        execute: product.execute,
        facts: {
          category: 'other',
          consentScope: 'internal_only',
          containsPerson: false,
          containsSensitiveData: false,
          mediaType: file.type.startsWith('video/') ? 'video' : 'image',
          minorStatus: 'none',
          rightsOwner: product.state.store.name,
          sourceType: 'real',
          tags: [],
        },
        objectKey: stored.key,
      });
      setCreatedAssetId(registered.assetId);
    } catch (error) {
      const presented = presentAssetRegistrationFailure(error, 'library');
      setFailure(presented.message);
      const existing = storedKey
        ? findWorkspaceAssetByObjectKey(product.state.assets, storedKey)
        : undefined;
      setFailureOutlet(
        presented.outlet === 'asset_detail' ? existing?.id : undefined
      );
    } finally {
      setUploading(false);
    }
  }

  const canCapture = Boolean(product.state?.store);

  return (
    <section
      aria-labelledby="asset-capture-title"
      className="meiye-porcelain space-y-4 rounded-2xl p-4"
    >
      <div>
        <h2 className="meiye-type-body font-semibold" id="asset-capture-title">
          {asset_capture_title()}
        </h2>
        <p className="meiye-type-aux mt-1">{asset_capture_description()}</p>
      </div>
      {failure || product.error ? (
        <Alert variant="destructive">
          <IconAlertTriangle />
          <AlertTitle>{asset_capture_error_title()}</AlertTitle>
          <AlertDescription>
            <p>{failure ?? asset_capture_error_description()}</p>
            {failureOutlet ? (
              <a
                className={buttonVariants({
                  className: 'mt-2',
                  variant: 'outline',
                })}
                href={getPathWithLocale(
                  `/dashboard/assets/${encodeURIComponent(failureOutlet)}`
                )}
              >
                <IconPhoto />
                {asset_capture_open_existing()}
              </a>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <AssetInput
          capture
          disabled={uploading || !product.state}
          icon={IconCamera}
          id="canonical-asset-camera"
          label={asset_capture_camera()}
          onFile={upload}
          variant={canCapture && isMobile ? 'secondary' : 'ghost'}
        />
        <AssetInput
          disabled={uploading || !product.state}
          icon={IconUpload}
          id="canonical-asset-upload"
          label={asset_capture_upload()}
          onFile={upload}
          variant={canCapture && !isMobile ? 'secondary' : 'ghost'}
        />
      </div>
      {createdAssetId ? (
        <a
          className={buttonVariants({ variant: 'outline' })}
          href={getPathWithLocale(
            `/dashboard/assets/${encodeURIComponent(createdAssetId)}`
          )}
        >
          <IconPhoto />
          {asset_capture_continue()}
        </a>
      ) : null}
    </section>
  );
}

function AssetInput({
  capture,
  disabled,
  icon: Icon,
  id,
  label,
  onFile,
  variant,
}: {
  capture?: boolean;
  disabled: boolean;
  icon: typeof IconCamera;
  id: string;
  label: string;
  onFile: (file: File) => Promise<void>;
  variant: 'secondary' | 'ghost';
}) {
  return (
    <label
      className={buttonVariants({
        className: cn(
          'h-24 cursor-pointer',
          variant === 'secondary' &&
            'bg-surface-2 font-semibold text-foreground hover:bg-surface-2 [&_svg]:text-primary'
        ),
        variant,
      })}
      htmlFor={id}
    >
      <Icon />
      {disabled ? asset_capture_uploading() : label}
      <input
        accept="image/*,video/mp4,video/webm"
        capture={capture ? 'environment' : undefined}
        className="sr-only"
        disabled={disabled}
        id={id}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void onFile(file);
        }}
        type="file"
      />
    </label>
  );
}

export function CanonicalAssetGovernance({
  asset,
  product,
}: {
  asset: Asset;
  product: ProductController;
}) {
  const [category, setCategory] = useState<NonNullable<Asset['category']>>(
    asset.category ?? 'other'
  );
  const [tags, setTags] = useState(asset.tags.join(', '));
  const [rightsOwner, setRightsOwner] = useState(asset.rightsOwner);
  const [rightsEvidence, setRightsEvidence] = useState(
    asset.rightsEvidence ?? ''
  );
  const [rightsPlatforms, setRightsPlatforms] = useState<Platform[]>(
    asset.rightsPlatforms ?? []
  );
  const [rightsValidUntil, setRightsValidUntil] = useState(
    asset.rightsValidUntil?.slice(0, 10) ?? ''
  );
  const [rightsNoFixedExpiry, setRightsNoFixedExpiry] = useState(
    asset.rightsNoFixedExpiry ?? false
  );
  const [containsPerson, setContainsPerson] = useState(asset.containsPerson);
  const [containsSensitiveData, setContainsSensitiveData] = useState(
    asset.containsSensitiveData
  );
  const [minorStatus, setMinorStatus] = useState<Asset['minorStatus']>(
    asset.minorStatus
  );
  const [failure, setFailure] = useState<string>();
  const authorization = assetAuthorizationPresentation(asset);
  const restricted = isRestrictedProductAsset({ category, containsPerson });
  const restrictedRightsComplete =
    !restricted ||
    (rightsPlatforms.length > 0 &&
      (rightsNoFixedExpiry || Boolean(rightsValidUntil)));

  async function run(command: ProductCommand) {
    setFailure(undefined);
    try {
      await product.execute(command);
    } catch {
      setFailure(asset_governance_action_failed());
    }
  }

  async function authorize() {
    setFailure(undefined);
    try {
      await executeAssetAuthorization(product.execute, {
        assetId: asset.id,
        category,
        consentScope: 'public_marketing',
        containsPerson,
        containsSensitiveData,
        minorStatus,
        rightsEvidence: rightsEvidence.trim() || undefined,
        rightsNoFixedExpiry: restricted ? rightsNoFixedExpiry : undefined,
        rightsOwner: rightsOwner.trim(),
        rightsPlatforms: restricted ? rightsPlatforms : undefined,
        rightsValidUntil:
          restricted && !rightsNoFixedExpiry && rightsValidUntil
            ? new Date(`${rightsValidUntil}T23:59:59.999Z`).toISOString()
            : undefined,
        systemEvidence: { context: 'asset-library', nonce: asset.id },
        tags: tags
          .split(/[，,]/)
          .map((item) => item.trim())
          .filter(Boolean),
      });
    } catch {
      setFailure(asset_governance_action_failed());
    }
  }

  return (
    <section aria-labelledby="asset-governance-title" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold" id="asset-governance-title">
          {asset_governance_title()}
        </h2>
        <Badge aria-live="polite" variant="outline">
          {AUTHORIZATION_STATUS_LABELS[authorization.status]()}
        </Badge>
      </div>
      {failure || product.error ? (
        <Alert variant="destructive">
          <IconAlertTriangle />
          <AlertTitle>{asset_governance_error_title()}</AlertTitle>
          <AlertDescription>
            {failure ?? asset_governance_error_description()}
          </AlertDescription>
        </Alert>
      ) : null}
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <Label htmlFor={`${asset.id}-category`}>
            {asset_governance_category()}
          </Label>
          <select
            className="mt-2 h-touch-target w-full rounded-md border border-divider bg-surface-1 px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            id={`${asset.id}-category`}
            onChange={(event) =>
              setCategory(event.target.value as NonNullable<Asset['category']>)
            }
            value={category}
          >
            <option value="store">{asset_governance_category_store()}</option>
            <option value="before_after">
              {asset_governance_category_before_after()}
            </option>
            <option value="customer_case">
              {asset_governance_category_customer_case()}
            </option>
            <option value="price_list">
              {asset_governance_category_price_list()}
            </option>
            <option value="other">{asset_governance_category_other()}</option>
          </select>
        </div>
        <AssetField
          id={`${asset.id}-tags`}
          label={asset_governance_tags()}
          onChange={setTags}
          value={tags}
        />
        <AssetField
          id={`${asset.id}-rights-owner`}
          label={asset_governance_rights_owner()}
          onChange={setRightsOwner}
          value={rightsOwner}
        />
        <AssetField
          id={`${asset.id}-rights-evidence`}
          label={asset_governance_rights_evidence()}
          onChange={setRightsEvidence}
          value={rightsEvidence}
        />
      </div>
      <div className="grid gap-2 text-sm md:grid-cols-3">
        <AssetCheck
          checked={containsPerson}
          id={`${asset.id}-contains-person`}
          label={asset_governance_contains_person()}
          onChange={setContainsPerson}
        />
        <AssetCheck
          checked={containsSensitiveData}
          id={`${asset.id}-contains-sensitive-data`}
          label={asset_governance_contains_sensitive_data()}
          onChange={setContainsSensitiveData}
        />
        <AssetCheck
          checked={minorStatus === 'minor'}
          id={`${asset.id}-minor-status`}
          label={asset_governance_contains_minor()}
          onChange={(checked) => setMinorStatus(checked ? 'minor' : 'none')}
        />
      </div>
      {restricted ? (
        <div className="grid gap-4 rounded-md border border-divider p-3 md:grid-cols-2">
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">
              {composer_image_rights_platforms()}
            </legend>
            <div className="flex gap-2">
              {(
                [
                  ['xiaohongshu', composer_image_platform_xiaohongshu()],
                  ['douyin', composer_image_platform_douyin()],
                ] as const
              ).map(([platform, label]) => {
                const selected = rightsPlatforms.includes(platform);
                return (
                  <Button
                    aria-pressed={selected}
                    key={platform}
                    onClick={() =>
                      setRightsPlatforms((current) =>
                        selected
                          ? current.filter((value) => value !== platform)
                          : [...current, platform]
                      )
                    }
                    size="sm"
                    type="button"
                    variant={selected ? 'secondary' : 'outline'}
                  >
                    {label}
                  </Button>
                );
              })}
            </div>
          </fieldset>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">
              {composer_image_rights_expiry()}
            </legend>
            <Button
              aria-pressed={rightsNoFixedExpiry}
              onClick={() => {
                setRightsNoFixedExpiry((current) => !current);
                setRightsValidUntil('');
              }}
              size="sm"
              type="button"
              variant={rightsNoFixedExpiry ? 'secondary' : 'outline'}
            >
              {composer_image_rights_no_expiry()}
            </Button>
            {!rightsNoFixedExpiry ? (
              <Input
                aria-label={composer_image_rights_expiry()}
                min={new Date().toISOString().slice(0, 10)}
                onChange={(event) => setRightsValidUntil(event.target.value)}
                type="date"
                value={rightsValidUntil}
              />
            ) : null}
          </fieldset>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={product.pending || !rightsOwner.trim()}
          onClick={() =>
            void run({
              type: 'update_asset_metadata',
              assetId: asset.id,
              category,
              tags: tags
                .split(/[，,]/)
                .map((item) => item.trim())
                .filter(Boolean),
              rightsOwner: rightsOwner.trim(),
              containsPerson,
              containsSensitiveData,
              minorStatus,
            })
          }
          variant="outline"
        >
          <IconCheck />
          {asset_governance_save()}
        </Button>
        {authorization.action !== 'none' ? (
          <Button
            disabled={
              product.pending ||
              !rightsOwner.trim() ||
              minorStatus === 'minor' ||
              !restrictedRightsComplete
            }
            onClick={() => void authorize()}
          >
            <IconShieldCheck />
            {authorization.action === 'update_evidence'
              ? asset_governance_update_evidence()
              : asset_governance_authorize()}
          </Button>
        ) : null}
        {asset.authorizationStatus === 'authorized' ? (
          <Button
            data-testid="asset-withdraw-button"
            disabled={product.pending}
            onClick={() =>
              void run({ type: 'withdraw_asset', assetId: asset.id })
            }
            variant="ghost"
          >
            <IconTrash />
            {asset_governance_withdraw()}
          </Button>
        ) : null}
        {asset.authorizationStatus === 'withdrawn' ? (
          <Button
            disabled={product.pending}
            onClick={() =>
              void run({ type: 'withdraw_asset', assetId: asset.id })
            }
            variant="outline"
          >
            <IconRefresh />
            {asset_governance_retry_withdrawal()}
          </Button>
        ) : null}
      </div>
      {/* W02 ③: the authorize button used to sit disabled with no explanation
          whenever a restricted asset lacked a rights scope — a silent dead end.
          The gate itself stays: `hasCurrentRestrictedAssetAuthorization` is
          enforced server-side, so dropping it here would only trade a disabled
          button for a rejected command. What was missing was the sentence
          telling the merchant what to do about it. */}
      {authorization.action !== 'none' && !restrictedRightsComplete ? (
        <p
          className="text-sm text-muted-foreground"
          data-testid="asset-governance-rights-incomplete"
        >
          {asset_governance_rights_incomplete()}
        </p>
      ) : null}
      {asset.authorizationStatus === 'blocked' ? (
        <p className="text-sm text-destructive">
          {asset_governance_minor_blocked()}
        </p>
      ) : null}
    </section>
  );
}

function AssetField({
  id,
  label,
  onChange,
  value,
}: {
  id: string;
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <Input
        className="mt-2"
        id={id}
        onChange={(event) => onChange(event.target.value)}
        value={value}
      />
    </div>
  );
}

function AssetCheck({
  checked,
  id,
  label,
  onChange,
}: {
  checked: boolean;
  id: string;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <Checkbox
        checked={checked}
        id={id}
        onCheckedChange={(value) => onChange(value === true)}
      />
      <Label htmlFor={id}>{label}</Label>
    </div>
  );
}
