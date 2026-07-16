import type { SecretContext, SecretStorePort } from './contracts.js';
import { IntegrationError } from './contracts.js';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  CreateSecretCommand,
  DeleteSecretCommand,
  GetSecretValueCommand,
  PutSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';

interface SecretRecord {
  context: SecretContext;
  value: string;
  revoked: boolean;
}

function sameContext(left: SecretContext, right: SecretContext) {
  return (
    left.workspaceId === right.workspaceId &&
    left.credentialId === right.credentialId &&
    left.version === right.version &&
    left.provider === right.provider
  );
}

export class FakeKmsSecretStore implements SecretStorePort {
  private readonly records = new Map<string, SecretRecord>();

  reference(context: SecretContext) {
    return `kms://${context.workspaceId}/${context.credentialId}/v${context.version}`;
  }

  async put(context: SecretContext, value: string) {
    const ref = this.reference(context);
    this.records.set(ref, { context: structuredClone(context), value, revoked: false });
    return ref;
  }

  async use(secretRef: string, context: SecretContext) {
    const record = this.records.get(secretRef);
    if (!record || record.revoked) {
      throw new IntegrationError('SECRET_NOT_FOUND', 'Secret is unavailable.', 404);
    }
    if (!sameContext(record.context, context)) {
      throw new IntegrationError(
        'SECRET_CONTEXT_MISMATCH',
        'Secret AAD does not match the requested workspace binding.',
        403
      );
    }
    return record.value;
  }

  async revoke(secretRef: string, context: SecretContext) {
    const record = this.records.get(secretRef);
    if (!record) return;
    if (!sameContext(record.context, context)) {
      throw new IntegrationError('SECRET_CONTEXT_MISMATCH', 'Secret AAD mismatch.', 403);
    }
    record.revoked = true;
    record.value = '';
  }
}

interface EncryptedFileRecord {
  ciphertext: string;
  iv: string;
  tag: string;
}

interface EncryptedFilePayload {
  records: Record<string, EncryptedFileRecord>;
  schemaVersion: 1;
}

export class EncryptedFileSecretStore implements SecretStorePort {
  private readonly key: Buffer;
  private writeQueue = Promise.resolve();

  constructor(
    private readonly options: { filePath: string; key: string },
  ) {
    this.key = Buffer.from(options.key, 'hex');
    if (this.key.length !== 32 || !/^[a-f0-9]{64}$/iu.test(options.key)) {
      throw new Error('Encrypted file secret store key must be 64 hex characters.');
    }
  }

  reference(context: SecretContext) {
    return `file-kms://${context.workspaceId}/${context.credentialId}/v${context.version}`;
  }

  async put(context: SecretContext, value: string) {
    const secretRef = this.reference(context);
    await this.mutate((payload) => {
      payload.records[secretRef] = this.encrypt(secretRef, { context, value });
    });
    return secretRef;
  }

  async use(secretRef: string, context: SecretContext) {
    const record = (await this.read()).records[secretRef];
    if (!record) {
      throw new IntegrationError('SECRET_NOT_FOUND', 'Secret is unavailable.', 404);
    }
    const envelope = this.decrypt(secretRef, record);
    if (!sameContext(envelope.context, context)) {
      throw new IntegrationError(
        'SECRET_CONTEXT_MISMATCH',
        'Secret AAD does not match the requested workspace binding.',
        403,
      );
    }
    return envelope.value;
  }

  async revoke(secretRef: string, context: SecretContext) {
    await this.mutate((payload) => {
      const record = payload.records[secretRef];
      if (!record) return;
      const envelope = this.decrypt(secretRef, record);
      if (!sameContext(envelope.context, context)) {
        throw new IntegrationError(
          'SECRET_CONTEXT_MISMATCH',
          'Secret AAD mismatch.',
          403,
        );
      }
      delete payload.records[secretRef];
    });
  }

  private encrypt(
    secretRef: string,
    envelope: { context: SecretContext; value: string },
  ): EncryptedFileRecord {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(secretRef));
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(envelope), 'utf8'),
      cipher.final(),
    ]);
    return {
      ciphertext: ciphertext.toString('base64'),
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
    };
  }

  private decrypt(secretRef: string, record: EncryptedFileRecord) {
    try {
      const decipher = createDecipheriv(
        'aes-256-gcm',
        this.key,
        Buffer.from(record.iv, 'base64'),
      );
      decipher.setAAD(Buffer.from(secretRef));
      decipher.setAuthTag(Buffer.from(record.tag, 'base64'));
      return JSON.parse(
        Buffer.concat([
          decipher.update(Buffer.from(record.ciphertext, 'base64')),
          decipher.final(),
        ]).toString('utf8'),
      ) as { context: SecretContext; value: string };
    } catch {
      throw new IntegrationError(
        'SECRET_ENVELOPE_INVALID',
        'Secret envelope is invalid.',
        500,
      );
    }
  }

  private async read(): Promise<EncryptedFilePayload> {
    try {
      const payload = JSON.parse(
        await readFile(this.options.filePath, 'utf8'),
      ) as EncryptedFilePayload;
      if (payload.schemaVersion !== 1 || !payload.records) throw new Error();
      return payload;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { records: {}, schemaVersion: 1 };
      }
      throw new IntegrationError(
        'SECRET_ENVELOPE_INVALID',
        'Secret store file is invalid.',
        500,
      );
    }
  }

  private async mutate(change: (payload: EncryptedFilePayload) => void) {
    const write = this.writeQueue.then(async () => {
      const payload = await this.read();
      change(payload);
      await mkdir(dirname(this.options.filePath), { recursive: true });
      const temporaryPath = `${this.options.filePath}.${process.pid}.tmp`;
      await writeFile(temporaryPath, JSON.stringify(payload), { mode: 0o600 });
      await rename(temporaryPath, this.options.filePath);
    });
    this.writeQueue = write.catch(() => {});
    return write;
  }
}

interface SecretsManagerClientPort {
  send(command: object): Promise<unknown>;
}

export class AwsSecretsManagerSecretStore implements SecretStorePort {
  private readonly prefix: string;

  constructor(
    private readonly options: {
      client: SecretsManagerClientPort;
      prefix: string;
      kmsKeyId: string;
    }
  ) {
    this.prefix = options.prefix.replace(/^\/+|\/+$/g, '');
  }

  reference(context: SecretContext) {
    return `aws-sm://${encodeURIComponent(this.name(context))}`;
  }

  async put(context: SecretContext, value: string) {
    const name = this.name(context);
    const contextHash = this.contextHash(context);
    const secretString = JSON.stringify({
      schemaVersion: 1,
      context,
      contextHash,
      value,
    });
    const requestToken = createHash('sha256')
      .update(`${contextHash}:${value}`)
      .digest('hex');
    try {
      await this.options.client.send(
        new CreateSecretCommand({
          Name: name,
          KmsKeyId: this.options.kmsKeyId,
          ClientRequestToken: requestToken,
          SecretString: secretString,
          Tags: this.tags(context),
        })
      );
    } catch (error) {
      if ((error as { name?: string }).name !== 'ResourceExistsException') throw error;
      await this.options.client.send(
        new PutSecretValueCommand({
          SecretId: name,
          ClientRequestToken: requestToken,
          SecretString: secretString,
          VersionStages: ['AWSCURRENT'],
        })
      );
    }
    return this.reference(context);
  }

  async use(secretRef: string, context: SecretContext) {
    const name = this.validateRef(secretRef, context);
    let output: unknown;
    try {
      output = await this.options.client.send(new GetSecretValueCommand({ SecretId: name }));
    } catch (error) {
      if ((error as { name?: string }).name === 'ResourceNotFoundException') {
        throw new IntegrationError('SECRET_NOT_FOUND', 'Secret is unavailable.', 404);
      }
      throw error;
    }
    const secretString = (output as { SecretString?: string }).SecretString;
    if (!secretString) {
      throw new IntegrationError('SECRET_NOT_FOUND', 'Secret is unavailable.', 404);
    }
    let envelope: {
      context?: SecretContext;
      contextHash?: string;
      value?: string;
    };
    try {
      envelope = JSON.parse(secretString) as typeof envelope;
    } catch {
      throw new IntegrationError('SECRET_ENVELOPE_INVALID', 'Secret envelope is invalid.', 500);
    }
    if (
      !envelope.context ||
      !sameContext(envelope.context, context) ||
      envelope.contextHash !== this.contextHash(context)
    ) {
      throw new IntegrationError(
        'SECRET_CONTEXT_MISMATCH',
        'Secret envelope does not match the workspace binding.',
        403
      );
    }
    if (typeof envelope.value !== 'string') {
      throw new IntegrationError('SECRET_ENVELOPE_INVALID', 'Secret value is invalid.', 500);
    }
    return envelope.value;
  }

  async revoke(secretRef: string, context: SecretContext) {
    const name = this.validateRef(secretRef, context);
    try {
      await this.options.client.send(
        new DeleteSecretCommand({
          SecretId: name,
          ForceDeleteWithoutRecovery: true,
        })
      );
    } catch (error) {
      if ((error as { name?: string }).name !== 'ResourceNotFoundException') {
        throw error;
      }
    }
  }

  private validateRef(secretRef: string, context: SecretContext) {
    const prefix = 'aws-sm://';
    if (!secretRef.startsWith(prefix)) {
      throw new IntegrationError('SECRET_REF_INVALID', 'Secret reference is invalid.', 400);
    }
    const name = decodeURIComponent(secretRef.slice(prefix.length));
    if (name !== this.name(context)) {
      throw new IntegrationError('SECRET_CONTEXT_MISMATCH', 'Secret AAD mismatch.', 403);
    }
    return name;
  }

  private name(context: SecretContext) {
    return [
      this.prefix,
      this.segment(context.workspaceId),
      this.segment(context.provider),
      this.segment(context.credentialId),
      `v${context.version}`,
    ].join('/');
  }

  private segment(value: string) {
    return /^[A-Za-z0-9_+=.@-]+$/.test(value)
      ? value
      : `b64_${Buffer.from(value).toString('base64url')}`;
  }

  private contextHash(context: SecretContext) {
    return createHash('sha256')
      .update(
        JSON.stringify({
          credentialId: context.credentialId,
          provider: context.provider,
          version: context.version,
          workspaceId: context.workspaceId,
        })
      )
      .digest('hex');
  }

  private tags(context: SecretContext) {
    return [
      { Key: 'workspace_id', Value: context.workspaceId },
      { Key: 'credential_id', Value: context.credentialId },
      { Key: 'credential_version', Value: String(context.version) },
      { Key: 'provider', Value: context.provider },
    ];
  }
}
