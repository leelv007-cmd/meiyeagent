import assert from 'node:assert/strict';
import test from 'node:test';
import { Routes } from './routes';

test('Z2-WIRING batch B registers admin capabilities and cloudflare routes', () => {
  assert.equal(Routes.Admin, '/admin');
  assert.equal(Routes.AdminCapabilities, '/admin/capabilities');
  // D3 / #375: standalone Recipe Studio route retired; Templates is the entry.
  assert.equal('AdminRecipeStudio' in Routes, false);
  assert.equal(Routes.AdminSkills, '/admin/skills');
  assert.equal(Routes.AdminCloudflare, '/admin/cloudflare');
  // Existing seven admin leaves remain stable.
  assert.equal(Routes.AdminModels, '/admin/models');
  assert.equal(Routes.AdminTemplates, '/admin/templates');
  assert.equal(Routes.AdminIntegrations, '/admin/integrations');
  assert.equal(Routes.AdminPlans, '/admin/plans');
  assert.equal(Routes.AdminRedemptions, '/admin/redemptions');
  assert.equal(Routes.AdminUsers, '/admin/users');
  assert.equal(Routes.AdminAudit, '/admin/audit');
  // Spec G / #388: remounted write surfaces.
  assert.equal(Routes.AdminRefundReview, '/admin/refund-review');
  assert.equal(Routes.AdminSensitiveWords, '/admin/sensitive-words');
});
