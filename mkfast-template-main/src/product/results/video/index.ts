/**
 * Video Result Worksurface public surface (WT-E / #104).
 *
 * Contracts-only consumer of result-center + video-workflow public projection.
 * Mount under Result Center video workspaceKind; no Result Shell internal imports.
 */

export {
  VIDEO_WORKSPACE_KIND,
  VIDEO_WORKSURFACE_PROJECTION_ONLY,
  adoptComposedFilm,
  buildVideoWorksurfaceState,
  classifyAdoptCandidate,
  classifyDeterministicSort,
  classifyPlayControl,
  classifyShotCandidateSelect,
  classifySupplierTaskOps,
  merchantShotLabel,
  markDelivered,
  markDeliveryInProgress,
  projectVideoMobileP0Actions,
  projectVideoWorksurfaceActions,
  reorderShots,
  runCandidateAdoptDeliverLoop,
  seekPlayer,
  selectShotCandidate,
  setFullscreen,
  togglePlay,
  videoBillableScopes,
  videoWorksurfaceFixture,
  videoWorksurfaceFreeActions,
  type BuildVideoWorksurfaceInput,
  type VideoAdoptionState,
  type VideoBillableScope,
  type VideoComposedCandidate,
  type VideoDeliveryState,
  type VideoEditFeeDecision,
  type VideoLoopPhase,
  type VideoLoopStep,
  type VideoMobileP0Action,
  type VideoMobileP0ActionId,
  type VideoPlayerState,
  type VideoShotCandidate,
  type VideoStoryboardShot,
  type VideoSubtitleMode,
  type VideoSubtitleState,
  type VideoUncommittedAdjustments,
  type VideoWorksurfaceAction,
  type VideoWorksurfaceFreeAction,
  type VideoWorksurfaceState,
} from './video-worksurface-model';

export {
  VideoWorksurface,
  type VideoWorksurfaceProps,
} from './video-worksurface';
