import { createHash } from 'node:crypto';

/** One identity shared by the domain request and the rendered interaction. */
export function executionConfirmationRequestId(workflowId: string): string {
  const id = workflowId.trim();
  if (!id) throw new Error('Execution confirmation requires a workflow ID.');
  return `confirmation:${id}`;
}

/** Durable identity for the exact frozen authority presented to the merchant. */
export function executionConfirmationAuthorityRequestId(input: {
  workflowId: string;
  planRevision: number;
  snapshotHash: string;
}): string {
  const workflowId = input.workflowId.trim();
  const snapshotHash = input.snapshotHash.trim();
  if (
    !workflowId ||
    !Number.isSafeInteger(input.planRevision) ||
    input.planRevision < 1
  ) {
    throw new Error('Execution confirmation requires a frozen plan authority.');
  }
  if (!snapshotHash) {
    throw new Error('Execution confirmation requires a snapshot hash.');
  }
  const digest = createHash('sha256')
    .update(`${workflowId}\0${input.planRevision}\0${snapshotHash}`)
    .digest('hex')
    .slice(0, 40);
  return `confirmation:${digest}`;
}
