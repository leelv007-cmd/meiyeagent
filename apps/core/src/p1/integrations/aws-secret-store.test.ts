import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CreateSecretCommand,
  DeleteSecretCommand,
  GetSecretValueCommand,
  PutSecretValueCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';
import {
  AwsSecretsManagerSecretStore,
  IntegrationError,
  type SecretContext,
} from './index.js';

test('AWS Secrets Manager binds names, tags and encrypted envelopes to workspace context', async () => {
  const calls: object[] = [];
  const values = new Map<string, string>();
  const client = {
    async send(command: object) {
      calls.push(command);
      if (command instanceof CreateSecretCommand) {
        values.set(command.input.Name!, command.input.SecretString!);
        return { ARN: `arn:aws:secretsmanager:cn-north-1:123:secret:${command.input.Name}` };
      }
      if (command instanceof GetSecretValueCommand) {
        return { SecretString: values.get(command.input.SecretId!) };
      }
      if (command instanceof DeleteSecretCommand) {
        values.delete(command.input.SecretId!);
        return {};
      }
      throw new Error('unexpected command');
    },
  };
  const store = new AwsSecretsManagerSecretStore({
    client,
    prefix: 'meiye/p1',
    kmsKeyId: 'alias/meiye-integrations',
  });
  const context: SecretContext = {
    workspaceId: 'workspace-a',
    credentialId: 'credential-a',
    version: 1,
    provider: 'douyin',
  };

  const secretRef = await store.put(context, 'sensitive-token');
  assert.equal(secretRef.includes('sensitive-token'), false);
  const create = calls[0];
  assert.ok(create instanceof CreateSecretCommand);
  assert.equal(create.input.KmsKeyId, 'alias/meiye-integrations');
  assert.equal(create.input.Name, 'meiye/p1/workspace-a/douyin/credential-a/v1');
  assert.deepEqual(create.input.Tags, [
    { Key: 'workspace_id', Value: 'workspace-a' },
    { Key: 'credential_id', Value: 'credential-a' },
    { Key: 'credential_version', Value: '1' },
    { Key: 'provider', Value: 'douyin' },
  ]);
  assert.equal(await store.use(secretRef, context), 'sensitive-token');

  await assert.rejects(
    store.use(secretRef, { ...context, workspaceId: 'workspace-b' }),
    (error: unknown) =>
      error instanceof IntegrationError && error.code === 'SECRET_CONTEXT_MISMATCH'
  );
  await store.revoke(secretRef, context);
  const deleted = calls.at(-1);
  assert.ok(deleted instanceof DeleteSecretCommand);
  assert.equal(deleted.input.ForceDeleteWithoutRecovery, true);
  await assert.rejects(
    store.use(secretRef, context),
    (error: unknown) => error instanceof IntegrationError && error.code === 'SECRET_NOT_FOUND'
  );
});

test('AWS adapter accepts the installed SecretsManagerClient without a wrapper', () => {
  const client = new SecretsManagerClient({
    region: 'cn-north-1',
    credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
  });
  const store = new AwsSecretsManagerSecretStore({
    client,
    prefix: 'meiye/p1',
    kmsKeyId: 'alias/meiye-integrations',
  });
  assert.ok(store);
  client.destroy();
});

test('AWS adapter rotates an existing bound secret with PutSecretValue', async () => {
  const calls: object[] = [];
  const client = {
    async send(command: object) {
      calls.push(command);
      if (command instanceof CreateSecretCommand) {
        throw Object.assign(new Error('exists'), { name: 'ResourceExistsException' });
      }
      if (command instanceof PutSecretValueCommand) return { VersionId: 'version-2' };
      throw new Error('unexpected command');
    },
  };
  const store = new AwsSecretsManagerSecretStore({
    client,
    prefix: 'meiye/p1',
    kmsKeyId: 'alias/meiye-integrations',
  });
  const context: SecretContext = {
    workspaceId: 'workspace-a',
    credentialId: 'credential-a',
    version: 2,
    provider: 'feishu',
  };
  await store.put(context, 'rotated-secret');
  assert.ok(calls[1] instanceof PutSecretValueCommand);
  assert.equal(calls[1].input.SecretId, 'meiye/p1/workspace-a/feishu/credential-a/v2');
  assert.deepEqual(calls[1].input.VersionStages, ['AWSCURRENT']);
});

test('AWS revoke is idempotent when the secret was already deleted', async () => {
  const client = {
    async send(command: object) {
      assert.ok(command instanceof DeleteSecretCommand);
      throw Object.assign(new Error('already deleted'), {
        name: 'ResourceNotFoundException',
      });
    },
  };
  const store = new AwsSecretsManagerSecretStore({
    client,
    prefix: 'meiye/p1',
    kmsKeyId: 'alias/meiye-integrations',
  });
  const context: SecretContext = {
    workspaceId: 'workspace-a',
    credentialId: 'credential-a',
    version: 1,
    provider: 'douyin',
  };

  await store.revoke(
    'aws-sm://meiye%2Fp1%2Fworkspace-a%2Fdouyin%2Fcredential-a%2Fv1',
    context
  );
});
