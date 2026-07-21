import { uploadThroughBoundedRoute } from '@/storage/upload-client';

export interface ProductAssetUploadResult {
  contentHash: string;
  contentType: string;
  key: string;
  replayed: boolean;
  url: string;
}

export function uploadProductAsset(input: {
  data: FormData;
}): Promise<ProductAssetUploadResult> {
  return uploadThroughBoundedRoute(input.data, 'product_asset');
}
