export interface CanvasLibraryAsset {
  authorizationStatus: 'pending' | 'authorized' | 'withdrawn' | 'blocked';
  id: string;
  label: string;
  objectKey: string;
  sourceType: 'real' | 'ai_generated';
  src: string;
}
