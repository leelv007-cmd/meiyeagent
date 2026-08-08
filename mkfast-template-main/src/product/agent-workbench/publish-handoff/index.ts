/**
 * V31-17 Publish Handoff + self-report journey (agent-workbench).
 */

export {
  projectPublishHandoffPanel,
  panelViewFromPublishHandoff,
  evaluateDrivenPublishFromQr,
  projectSelfReportJourney,
  SELF_REPORT_CHIP_LABEL,
  type PublishHandoffPanelFacts,
  type PublishHandoffPanelView,
} from './publish-handoff-model';

export {
  PublishHandoffPanel,
  type PublishHandoffPanelProps,
} from './publish-handoff-panel';

export {
  PUBLISH_HANDOFF_SURFACE_KEYS,
  registerPublishHandoffSurfaces,
  __resetPublishHandoffSurfaceRegistrationForTests,
  type PublishHandoffSurfaceKey,
} from './publish-handoff-registry';

export {
  usePublishHandoff,
  type UsePublishHandoffInput,
  type UsePublishHandoffResult,
} from './use-publish-handoff';

export {
  exportAndDownloadFullPackage,
  resolveZipExportPlatform,
  withAssetDownloadParam,
  startBrowserDownload,
  type ExportFullPackageResult,
  type ExportFullPackageTransport,
  type ResultExportPlatform,
} from './export-full-package-download';

export {
  MobilePublishHandoffQr,
  resolveQrPayload,
  type MobilePublishHandoffQrProps,
} from './mobile-publish-handoff-qr';
