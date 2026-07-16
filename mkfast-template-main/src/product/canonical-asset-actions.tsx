import { uploadProductAsset } from '@/api/product-assets';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { m } from '@/locale/paraglide/messages';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';
import { getPathWithLocale } from '@/lib/urls';
import type { Asset, ProductCommand } from '@meiye/contracts';
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
  authorized: m.asset_governance_status_authorized,
  blocked: m.asset_governance_status_blocked,
  pending: m.asset_governance_status_pending,
  withdrawn: m.asset_governance_status_withdrawn,
};

export function CanonicalAssetCapture({
  product,
}: {
  product: ProductController;
}) {
  const isMobile = useIsMobile();
  const [uploading, setUploading] = useState(false);
  const [failure, setFailure] = useState<string>();
  const [createdAssetId, setCreatedAssetId] = useState<string>();

  async function upload(file: File) {
    if (!product.state) return;
    if (!product.state.store) {
      setFailure(m.asset_capture_store_required());
      return;
    }
    setUploading(true);
    setFailure(undefined);
    const assetId = `asset-${crypto.randomUUID()}`;
    try {
      const body = new FormData();
      body.append('file', file);
      const stored = await uploadProductAsset({ data: body });
      await product.execute({
        type: 'add_asset',
        asset: {
          id: assetId,
          objectKey: stored.key,
          mediaType: file.type.startsWith('video/') ? 'video' : 'image',
          sourceType: 'real',
          category: 'other',
          tags: [],
          rightsOwner: product.state.store.name,
          consentScope: 'internal_only',
          containsPerson: false,
          containsSensitiveData: false,
          minorStatus: 'none',
        },
      });
      setCreatedAssetId(assetId);
    } catch {
      setFailure(m.asset_capture_upload_failed());
    } finally {
      setUploading(false);
    }
  }

  const canCapture = Boolean(product.state?.store);

  return (
    <section aria-labelledby="asset-capture-title" className="space-y-4">
      <div>
        <h2 className="meiye-type-body font-semibold" id="asset-capture-title">
          {m.asset_capture_title()}
        </h2>
        <p className="meiye-type-aux mt-1">{m.asset_capture_description()}</p>
      </div>
      {failure || product.error ? (
        <Alert variant="destructive">
          <IconAlertTriangle />
          <AlertTitle>{m.asset_capture_error_title()}</AlertTitle>
          <AlertDescription>
            {failure ?? m.asset_capture_error_description()}
          </AlertDescription>
        </Alert>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <AssetInput
          capture
          disabled={uploading || !product.state}
          icon={IconCamera}
          id="canonical-asset-camera"
          label={m.asset_capture_camera()}
          onFile={upload}
          variant={canCapture && isMobile ? 'secondary' : 'ghost'}
        />
        <AssetInput
          disabled={uploading || !product.state}
          icon={IconUpload}
          id="canonical-asset-upload"
          label={m.asset_capture_upload()}
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
          {m.asset_capture_continue()}
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
      {disabled ? m.asset_capture_uploading() : label}
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
  const [containsPerson, setContainsPerson] = useState(asset.containsPerson);
  const [containsSensitiveData, setContainsSensitiveData] = useState(
    asset.containsSensitiveData
  );
  const [minorStatus, setMinorStatus] = useState<Asset['minorStatus']>(
    asset.minorStatus
  );
  const [failure, setFailure] = useState<string>();
  const authorization = assetAuthorizationPresentation(asset);

  async function run(command: ProductCommand) {
    setFailure(undefined);
    try {
      await product.execute(command);
    } catch {
      setFailure(m.asset_governance_action_failed());
    }
  }

  return (
    <section aria-labelledby="asset-governance-title" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold" id="asset-governance-title">
          {m.asset_governance_title()}
        </h2>
        <Badge aria-live="polite" variant="outline">
          {AUTHORIZATION_STATUS_LABELS[authorization.status]()}
        </Badge>
      </div>
      {failure || product.error ? (
        <Alert variant="destructive">
          <IconAlertTriangle />
          <AlertTitle>{m.asset_governance_error_title()}</AlertTitle>
          <AlertDescription>
            {failure ?? m.asset_governance_error_description()}
          </AlertDescription>
        </Alert>
      ) : null}
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <Label htmlFor={`${asset.id}-category`}>
            {m.asset_governance_category()}
          </Label>
          <select
            className="mt-2 h-touch-target w-full rounded-md border border-divider bg-surface-1 px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            id={`${asset.id}-category`}
            onChange={(event) =>
              setCategory(event.target.value as NonNullable<Asset['category']>)
            }
            value={category}
          >
            <option value="store">{m.asset_governance_category_store()}</option>
            <option value="before_after">
              {m.asset_governance_category_before_after()}
            </option>
            <option value="customer_case">
              {m.asset_governance_category_customer_case()}
            </option>
            <option value="price_list">
              {m.asset_governance_category_price_list()}
            </option>
            <option value="other">{m.asset_governance_category_other()}</option>
          </select>
        </div>
        <AssetField
          id={`${asset.id}-tags`}
          label={m.asset_governance_tags()}
          onChange={setTags}
          value={tags}
        />
        <AssetField
          id={`${asset.id}-rights-owner`}
          label={m.asset_governance_rights_owner()}
          onChange={setRightsOwner}
          value={rightsOwner}
        />
        <AssetField
          id={`${asset.id}-rights-evidence`}
          label={m.asset_governance_rights_evidence()}
          onChange={setRightsEvidence}
          value={rightsEvidence}
        />
      </div>
      <div className="grid gap-2 text-sm md:grid-cols-3">
        <AssetCheck
          checked={containsPerson}
          id={`${asset.id}-contains-person`}
          label={m.asset_governance_contains_person()}
          onChange={setContainsPerson}
        />
        <AssetCheck
          checked={containsSensitiveData}
          id={`${asset.id}-contains-sensitive-data`}
          label={m.asset_governance_contains_sensitive_data()}
          onChange={setContainsSensitiveData}
        />
        <AssetCheck
          checked={minorStatus === 'minor'}
          id={`${asset.id}-minor-status`}
          label={m.asset_governance_contains_minor()}
          onChange={(checked) => setMinorStatus(checked ? 'minor' : 'none')}
        />
      </div>
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
          {m.asset_governance_save()}
        </Button>
        {authorization.action !== 'none' ? (
          <Button
            disabled={
              product.pending ||
              (asset.sourceType === 'real' && !rightsEvidence.trim())
            }
            onClick={() =>
              void run({
                type: 'authorize_asset',
                assetId: asset.id,
                consentScope: 'public_marketing',
                rightsEvidence: rightsEvidence.trim() || undefined,
              })
            }
          >
            <IconShieldCheck />
            {authorization.action === 'update_evidence'
              ? m.asset_governance_update_evidence()
              : m.asset_governance_authorize()}
          </Button>
        ) : null}
        {asset.authorizationStatus === 'authorized' ? (
          <Button
            disabled={product.pending}
            onClick={() =>
              void run({ type: 'withdraw_asset', assetId: asset.id })
            }
            variant="ghost"
          >
            <IconTrash />
            {m.asset_governance_withdraw()}
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
            {m.asset_governance_retry_withdrawal()}
          </Button>
        ) : null}
      </div>
      {asset.authorizationStatus === 'blocked' ? (
        <p className="text-sm text-destructive">
          {m.asset_governance_minor_blocked()}
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
