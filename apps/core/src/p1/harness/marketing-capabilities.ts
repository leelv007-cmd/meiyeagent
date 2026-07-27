import { marketingPackageCapabilitiesSchema } from '@meiye/contracts';

import { editContentPackageLifecycleVersion } from '../operations/content-package-lifecycle.js';
import { ReuseMemoryService } from '../operations/reuse-memory-service.js';
import { executeCopySelection } from './execution-selection.js';
import { assessRecipeFactSatisfaction } from './fact-satisfaction.js';
import { buildCopyPlatformVariants } from './output-compiler.js';
import { runHarnessWorkflow } from './workflow-core.js';

const capabilityImplementations = {
  mainRecommendation: executeCopySelection,
  platformDeliverables: buildCopyPlatformVariants,
  factsAndRights: assessRecipeFactSatisfaction,
  quickEdit: editContentPackageLifecycleVersion,
  publishExport: editContentPackageLifecycleVersion,
  asyncRecovery: runHarnessWorkflow,
  remix: ReuseMemoryService.prototype.verifyReuseTaskSeed,
} as const;

export function deriveMarketingPackageCapabilities() {
  return marketingPackageCapabilitiesSchema.parse(
    Object.fromEntries(
      Object.entries(capabilityImplementations).map(
        ([capability, implementation]) => [
          capability,
          typeof implementation === 'function',
        ],
      ),
    ),
  );
}
