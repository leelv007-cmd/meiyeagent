/**
 * Shared primitive schemas for agent-domain modules. Not part of the public
 * barrel — keep these names out of `agent-domain.ts` re-exports.
 */

import { z } from 'zod';

import { nonEmptyTrimmedStringSchema } from '../identifiers.js';

export const timestampSchema = z.iso.datetime();
export const revisionNumberSchema = z.number().int().nonnegative().safe();
export const positiveRevisionSchema = z.number().int().positive().safe();
export const hashStringSchema = nonEmptyTrimmedStringSchema.max(128);
export const jsonValueSchema = z.json();
