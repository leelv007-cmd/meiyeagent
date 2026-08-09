/**
 * Server-owned turn authority projected from the frozen Composer submission
 * (V31-07 / V31-08).
 *
 * The Intent turn must not be told that a field is settled when the submission
 * does not actually carry it: a wrongly "known" field silently eats the single
 * merchant question, and a wrongly "authoritative" key lets a model assumption
 * about rights or money survive the high-risk gate. Both sides are therefore
 * read off the snapshot and the credit reservation rather than declared.
 */

import type { ImpactCategory } from './ambiguity-policy.js';
import type { CreationSubmissionRecord } from '../execution-spine/submission-coordinator.js';

/**
 * Impact category per assumption key. This is domain semantics — what kind of
 * damage a wrong value does — so it does not vary per submission. Whether the
 * system may answer the key is `authoritativeKeys`, which does.
 */
const IMPACT_BY_KEY: ReadonlyMap<string, ImpactCategory> = new Map([
  ['rights', 'rights'],
  ['assets', 'rights'],
  ['price', 'fees'],
  ['fees', 'fees'],
  ['store_facts', 'facts'],
  ['publish', 'external_action'],
]);

export type ComposerTurnAuthorityProjection = {
  knownFields: string[];
  impactByKey: ReadonlyMap<string, ImpactCategory>;
  authoritativeKeys: ReadonlySet<string>;
};

export function projectComposerTurnAuthority(
  submission: CreationSubmissionRecord,
): ComposerTurnAuthorityProjection {
  const snapshot = submission.snapshot;
  const hasAssets = snapshot.sources.assets.length > 0;
  // A reserved credit amount is what makes fees a system fact; a free run has
  // no fee authority to lend the model.
  const credits = submission.usageReservation.credits;
  const hasPaidReservation =
    Number.isSafeInteger(credits) && (credits ?? 0) > 0;
  // Revision 0 is the empty brief context: nothing about the store is confirmed.
  const hasConfirmedStoreFacts = snapshot.briefContext.revision > 0;

  const knownFields = [
    // Frozen by the schema on every snapshot.
    'intent',
    'platform',
    'lens',
    'deliverable_quantity',
    'identity',
    'quote',
    ...(hasAssets ? ['rights', 'assets'] : []),
    ...(hasConfirmedStoreFacts ? ['store_facts'] : []),
    ...(snapshot.beautyVoiceRole ? ['voice'] : []),
    ...(snapshot.briefConfirmation ? ['brief'] : []),
    ...(snapshot.sources.contentPackage ? ['source_content_package'] : []),
    ...(snapshot.modelSelection ? ['model'] : []),
    ...(snapshot.identityDecision ? ['identity_decision'] : []),
  ];

  const authoritativeKeys = new Set<string>();
  if (hasAssets) {
    authoritativeKeys.add('rights');
    authoritativeKeys.add('assets');
  }
  if (hasPaidReservation) {
    authoritativeKeys.add('price');
    authoritativeKeys.add('fees');
  }
  if (hasConfirmedStoreFacts) {
    authoritativeKeys.add('store_facts');
  }
  // `publish` is deliberately never authoritative: an external action is the
  // merchant's, never a default the server can lend the model.

  return { knownFields, impactByKey: IMPACT_BY_KEY, authoritativeKeys };
}
