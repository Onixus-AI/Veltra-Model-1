type Stage = 'context' | 'worker' | 'receipt';

/** Persist only actionable categories; never store provider bodies or credentials. */
export function dailyFailure(stage: Stage, error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (stage === 'context') return 'Business snapshot unavailable. Check scoped CRM, Mail and job records.';
  if (stage === 'receipt') return 'Plan completed but its Workspace receipt could not be saved. Check storage before retrying.';
  if (message.includes('Private Hermes authentication')) return 'Hermes Cloud Run authentication failed. Check the production OIDC provider and invoker.';
  if (message.includes('Onixelia is not connected') || message.includes('Invalid Onixelia service configuration')) return 'Onixelia service configuration is invalid or missing.';
  if (message.includes('Onixelia endpoint not found')) return 'Onixelia planning endpoint was not found. Check the deployed service URL and route.';
  if (message.includes('Onixelia request was rejected')) return 'Onixelia rejected the planning request. Check service authorization.';
  if (message.includes('Onixelia could not complete')) return 'Onixelia worker failed the planning request. Check its service logs.';
  if (message.includes('invalid execution receipt') || message.includes('invalid review receipt') || message.includes('unavailable source')) return 'Hermes or Jev returned an invalid plan receipt. Check the worker contract.';
  return 'Daily planning failed in the worker stage. Check Onixelia service logs.';
}
