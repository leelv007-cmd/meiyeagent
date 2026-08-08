import { z } from 'zod';

export const nonEmptyTrimmedStringSchema = z.string().trim().min(1);

// Use this named fallback when one field carries multiple legacy identifier
// families and branding would require non-mechanical caller changes.
export const identifierSchema = nonEmptyTrimmedStringSchema;

export const approvalReceiptIdSchema =
  identifierSchema.brand<'ApprovalReceiptId'>();
export const assetIntakeBatchIdSchema = identifierSchema;
export const marketingIdentityIdSchema = identifierSchema;

/** V3.1 Agent-domain branded IDs (V31-01). Brand at the contract boundary. */
export const agentThreadIdSchema = identifierSchema.brand<'AgentThreadId'>();
export const agentRunIdSchema = identifierSchema.brand<'AgentRunId'>();
export const marketingGoalIdSchema =
  identifierSchema.brand<'MarketingGoalId'>();
export const marketingPlanIdSchema =
  identifierSchema.brand<'MarketingPlanId'>();
export const memoryIdSchema = identifierSchema.brand<'MemoryId'>();
export const agentSemanticEventIdSchema =
  identifierSchema.brand<'AgentSemanticEventId'>();
export const harnessReleaseIdSchema =
  identifierSchema.brand<'HarnessReleaseId'>();
export const outcomeEvidenceIdSchema =
  identifierSchema.brand<'OutcomeEvidenceId'>();
export const steeringCommandIdSchema =
  identifierSchema.brand<'SteeringCommandId'>();
export const merchantResourceIdSchema =
  identifierSchema.brand<'MerchantResourceId'>();
export const executionUnitIdSchema =
  identifierSchema.brand<'ExecutionUnitId'>();
export const planConfirmationDecisionIdSchema =
  identifierSchema.brand<'PlanConfirmationDecisionId'>();
export const agentExecutionConfirmationRequestIdSchema =
  identifierSchema.brand<'AgentExecutionConfirmationRequestId'>();

export type ApprovalReceiptId = z.infer<typeof approvalReceiptIdSchema>;
export type AssetIntakeBatchId = z.infer<typeof assetIntakeBatchIdSchema>;
export type MarketingIdentityId = z.infer<typeof marketingIdentityIdSchema>;
export type AgentThreadId = z.infer<typeof agentThreadIdSchema>;
export type AgentRunId = z.infer<typeof agentRunIdSchema>;
export type MarketingGoalId = z.infer<typeof marketingGoalIdSchema>;
export type MarketingPlanId = z.infer<typeof marketingPlanIdSchema>;
export type MemoryId = z.infer<typeof memoryIdSchema>;
export type AgentSemanticEventId = z.infer<typeof agentSemanticEventIdSchema>;
export type HarnessReleaseId = z.infer<typeof harnessReleaseIdSchema>;
export type OutcomeEvidenceId = z.infer<typeof outcomeEvidenceIdSchema>;
export type SteeringCommandId = z.infer<typeof steeringCommandIdSchema>;
export type MerchantResourceId = z.infer<typeof merchantResourceIdSchema>;
export type ExecutionUnitId = z.infer<typeof executionUnitIdSchema>;
export type PlanConfirmationDecisionId = z.infer<
  typeof planConfirmationDecisionIdSchema
>;
export type AgentExecutionConfirmationRequestId = z.infer<
  typeof agentExecutionConfirmationRequestIdSchema
>;
