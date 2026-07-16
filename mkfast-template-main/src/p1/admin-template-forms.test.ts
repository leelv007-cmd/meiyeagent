import assert from 'node:assert/strict';
import test from 'node:test';

import {
  adminTemplateDocument,
  adminTemplateRollout,
  adminTemplateTags,
  adminTemplateVersionFormSchema,
  adminTemplateVersionTargetSchema,
  createAdminTemplateSchema,
} from './admin-template-forms';

const document = JSON.stringify({
  height: 1350,
  pages: [{ elements: [], id: 'page-1' }],
  width: 1080,
});

test('validates template identity and normalizes comma-separated tags', () => {
  assert.equal(
    createAdminTemplateSchema.safeParse({
      family: '',
      name: '',
      tags: '',
    }).success,
    false
  );
  assert.deepEqual(adminTemplateTags('节日, 活动,,'), ['节日', '活动']);
});

test('accepts valid canvas JSON and integer rollout percentages', () => {
  assert.equal(
    adminTemplateVersionFormSchema.safeParse({
      document,
      rollout: '25',
      templateId: 'template-a',
      versionId: '',
    }).success,
    true
  );
  assert.equal(adminTemplateRollout('25'), 25);
  assert.equal(adminTemplateDocument(document).width, 1080);
});

test('rejects invalid documents, rollout values, and missing action targets', () => {
  assert.equal(
    adminTemplateVersionFormSchema.safeParse({
      document: '{broken',
      rollout: '25.5',
      templateId: 'template-a',
      versionId: '',
    }).success,
    false
  );
  assert.equal(
    adminTemplateVersionTargetSchema.safeParse({
      templateId: 'template-a',
      versionId: '',
    }).success,
    false
  );
});
