import type { ImageModelRecipeProfile } from '@meiye/contracts';

import type { ContentPackageRevisionWritePort } from '../execution-spine/content-package-revision-port.js';
import type {
  MediaBoundedExecutionAuthorization,
  ModelSupplyResult,
  ModelSupplySubmission,
} from '../model-supply/index.js';
import type { NoteMediaAdmissionPort } from './note-media-admission.js';
import type { NotePlanSettingsSource } from './note-plan-compiler.js';
import type { NotePlanEnhancementJudgeResolver } from './note-plan-structured-port.js';
import type {
  HarnessExecutionChildObservabilityFactory,
  HarnessStructuredNodeRunnerFactory,
  SensitiveLexiconReadPort,
} from './production-stage-ports.js';
import {
  type ImageExactTextVerifier,
  ModelSupplyHarnessMediaExecutionPort,
  UnifiedHarnessStagePorts,
} from './unified-media-stage-ports.js';
import type { HarnessStagePorts } from './workflow-core.js';

export function createProductionHarnessMediaAssembly(input: {
  contentPackages: ContentPackageRevisionWritePort;
  copy: HarnessStagePorts;
  exactText?: ImageExactTextVerifier;
  imageProfile?: ImageModelRecipeProfile;
  models: {
    submit(input: ModelSupplySubmission): Promise<ModelSupplyResult>;
    getDurableMediaJob?(
      workspaceId: string,
      jobId: string,
    ): Promise<{
      result: ModelSupplyResult;
      providerLifecycleLatencyMs?: number;
    }>;
    resumeBoundedMediaJob?(input: {
      workspaceId: string;
      jobId: string;
      authorization: MediaBoundedExecutionAuthorization;
    }): Promise<{ result: ModelSupplyResult }>;
  };
  noteAdmission: NoteMediaAdmissionPort;
  noteEnhancementJudge: NotePlanEnhancementJudgeResolver;
  noteSettings: NotePlanSettingsSource;
  now: () => string;
  runners: HarnessStructuredNodeRunnerFactory;
  sensitiveLexicon: SensitiveLexiconReadPort;
  executionChildObservability?: HarnessExecutionChildObservabilityFactory;
}) {
  return new UnifiedHarnessStagePorts(
    input.copy,
    input.runners,
    new ModelSupplyHarnessMediaExecutionPort(
      input.models,
      input.exactText,
      input.noteAdmission,
      input.imageProfile,
    ),
    input.contentPackages,
    input.now,
    input.noteSettings,
    input.noteEnhancementJudge,
    input.executionChildObservability,
    input.sensitiveLexicon,
  );
}
