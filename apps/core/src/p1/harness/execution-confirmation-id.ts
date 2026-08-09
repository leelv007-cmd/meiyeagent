/** One identity shared by the domain request and the rendered interaction. */
export function executionConfirmationRequestId(workflowId: string): string {
  const id = workflowId.trim();
  if (!id) throw new Error('Execution confirmation requires a workflow ID.');
  return `confirmation:${id}`;
}
