import assert from 'node:assert/strict';
import test from 'node:test';

import {
  creativeOperationSchema,
  type SupplyOperation,
} from '@meiye/contracts';

import { MODEL_OPERATIONS } from '../model-supply/supply-contracts.js';
import {
  IMAGE_OPERATION_PROFILE,
  nativeSupplyOperation,
  selectImageIntentOperation,
} from './image-intent-compiler.js';

test('merchant reference context selects exactly three canonical image operations', () => {
  assert.equal(
    selectImageIntentOperation({ referenceCount: 0 }),
    'image.generate',
  );
  assert.equal(selectImageIntentOperation({ referenceCount: 1 }), 'image.edit');
  assert.equal(
    selectImageIntentOperation({ referenceCount: 2 }),
    'image.reference_transform',
  );
});

test('reference transform remains product intent and maps to native image editing', () => {
  const nativeModelOperations = new Set<string>(MODEL_OPERATIONS);
  type ReferenceTransformSupplyOperation = Extract<
    SupplyOperation,
    'image.reference_transform'
  >;
  const supplyBoundaryRemainsClosed: ReferenceTransformSupplyOperation extends never
    ? true
    : false = true;

  assert.equal(
    creativeOperationSchema.options.includes('image.reference_transform'),
    true,
  );
  assert.equal(supplyBoundaryRemainsClosed, true);
  assert.equal(nativeModelOperations.has('image.reference_transform'), false);
  assert.equal(
    IMAGE_OPERATION_PROFILE.operationMappings['image.reference_transform'],
    'image.edit',
  );
  assert.equal(nativeSupplyOperation('image.reference_transform'), 'image.edit');
});
