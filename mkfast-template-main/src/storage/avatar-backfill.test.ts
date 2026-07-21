import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildLegacyAvatarBackfillPlan,
  executeLegacyAvatarBackfillPlan,
  parseAvatarBackfillArguments,
} from './avatar-backfill';

const LEGACY_KEY = 'avatars/123e4567-e89b-12d3-a456-426614174000-profile.png';

function validPng(): Uint8Array {
  const png = new Uint8Array(24);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  png.set([0x00, 0x00, 0x02, 0x00], 16);
  png.set([0x00, 0x00, 0x02, 0x00], 20);
  return png;
}

test('a uniquely owned and verifiable legacy avatar is eligible for metadata backfill', async () => {
  const plan = await buildLegacyAvatarBackfillPlan(
    {
      baseUrl: 'https://app.example.com',
      existingKeys: new Set(),
      users: [
        {
          image: `https://app.example.com/api/storage/file?key=${encodeURIComponent(LEGACY_KEY)}`,
          updatedAt: new Date('2026-07-01T00:00:00.000Z'),
          userId: 'user-1',
          workspaceIds: ['workspace-1'],
        },
      ],
    },
    async () => validPng()
  );

  assert.deepEqual(plan, {
    alreadyManaged: 0,
    ambiguous: [],
    eligible: [
      {
        contentType: 'image/png',
        createdAt: new Date('2026-07-01T00:00:00.000Z'),
        description: 'legacy-avatar-backfill',
        filename: '123e4567-e89b-12d3-a456-426614174000-profile.png',
        id: '123e4567-e89b-12d3-a456-426614174000',
        image:
          'https://app.example.com/api/storage/file?key=avatars%2F123e4567-e89b-12d3-a456-426614174000-profile.png',
        isPublic: true,
        originalName: 'profile.png',
        purpose: 'avatar',
        r2Key: LEGACY_KEY,
        size: 24,
        userId: 'user-1',
        workspaceId: 'workspace-1',
      },
    ],
    external: [],
    missing: [],
  });
});

test('an object referenced by more than one user is ambiguous', async () => {
  const image = `/api/storage/file?key=${encodeURIComponent(LEGACY_KEY)}`;
  const plan = await buildLegacyAvatarBackfillPlan(
    {
      baseUrl: 'https://app.example.com',
      existingKeys: new Set(),
      users: [
        {
          image,
          updatedAt: new Date('2026-07-01T00:00:00.000Z'),
          userId: 'user-1',
          workspaceIds: ['workspace-1'],
        },
        {
          image,
          updatedAt: new Date('2026-07-01T00:00:00.000Z'),
          userId: 'user-2',
          workspaceIds: ['workspace-2'],
        },
      ],
    },
    async () => validPng()
  );

  assert.equal(plan.eligible.length, 0);
  assert.deepEqual(plan.ambiguous, [
    {
      reason: 'object is referenced by more than one user',
      r2Key: LEGACY_KEY,
      userId: 'user-1',
    },
    {
      reason: 'object is referenced by more than one user',
      r2Key: LEGACY_KEY,
      userId: 'user-2',
    },
  ]);
});

test('avatar backfill is dry-run unless apply is explicitly requested', () => {
  assert.deepEqual(parseAvatarBackfillArguments([]), { apply: false });
  assert.deepEqual(parseAvatarBackfillArguments(['--apply']), { apply: true });
  assert.throws(
    () => parseAvatarBackfillArguments(['--write']),
    /Unknown argument/u
  );
});

test('an avatar URL with duplicate key parameters is not treated as controlled', async () => {
  const plan = await buildLegacyAvatarBackfillPlan(
    {
      baseUrl: 'https://app.example.com',
      existingKeys: new Set(),
      users: [
        {
          image: `/api/storage/file?key=${encodeURIComponent(LEGACY_KEY)}&key=${encodeURIComponent('avatars/other.png')}`,
          updatedAt: new Date('2026-07-01T00:00:00.000Z'),
          userId: 'user-1',
          workspaceIds: ['workspace-1'],
        },
      ],
    },
    async () => validPng()
  );

  assert.equal(plan.eligible.length, 0);
  assert.deepEqual(plan.external, [
    {
      reason: 'image is not a controlled legacy avatar URL',
      userId: 'user-1',
    },
  ]);
});

test('dry-run writes nothing and apply submits only eligible records', async () => {
  const plan = await buildLegacyAvatarBackfillPlan(
    {
      baseUrl: 'https://app.example.com',
      existingKeys: new Set(),
      users: [
        {
          image: `/api/storage/file?key=${encodeURIComponent(LEGACY_KEY)}`,
          updatedAt: new Date('2026-07-01T00:00:00.000Z'),
          userId: 'user-1',
          workspaceIds: ['workspace-1'],
        },
        {
          image: 'https://images.example.net/avatar.png',
          updatedAt: new Date('2026-07-01T00:00:00.000Z'),
          userId: 'user-2',
          workspaceIds: ['workspace-2'],
        },
      ],
    },
    async () => validPng()
  );
  const inserted: string[] = [];
  const insert = async (record: { userId: string }) => {
    inserted.push(record.userId);
    return true;
  };

  assert.deepEqual(await executeLegacyAvatarBackfillPlan(plan, false, insert), {
    applied: 0,
    mode: 'dry-run',
    refusedStateChanges: 0,
  });
  assert.deepEqual(inserted, []);
  assert.deepEqual(await executeLegacyAvatarBackfillPlan(plan, true, insert), {
    applied: 1,
    mode: 'apply',
    refusedStateChanges: 0,
  });
  assert.deepEqual(inserted, ['user-1']);
});

test('an object inspection failure is ambiguous and cannot become public', async () => {
  const plan = await buildLegacyAvatarBackfillPlan(
    {
      baseUrl: 'https://app.example.com',
      existingKeys: new Set(),
      users: [
        {
          image: `/api/storage/file?key=${encodeURIComponent(LEGACY_KEY)}`,
          updatedAt: new Date('2026-07-01T00:00:00.000Z'),
          userId: 'user-1',
          workspaceIds: ['workspace-1'],
        },
      ],
    },
    async () => {
      throw new Error('R2 credentials rejected');
    }
  );

  assert.equal(plan.eligible.length, 0);
  assert.deepEqual(plan.ambiguous, [
    {
      reason: 'object inspection failed',
      r2Key: LEGACY_KEY,
      userId: 'user-1',
    },
  ]);
});

test('an empty workspace identifier is ambiguous', async () => {
  const plan = await buildLegacyAvatarBackfillPlan(
    {
      baseUrl: 'https://app.example.com',
      existingKeys: new Set(),
      users: [
        {
          image: `/api/storage/file?key=${encodeURIComponent(LEGACY_KEY)}`,
          updatedAt: new Date('2026-07-01T00:00:00.000Z'),
          userId: 'user-1',
          workspaceIds: [''],
        },
      ],
    },
    async () => validPng()
  );

  assert.equal(plan.eligible.length, 0);
  assert.equal(
    plan.ambiguous[0]?.reason,
    'user must have exactly one workspace membership'
  );
});

test('a controlled DB reference whose R2 object is absent is reported missing', async () => {
  const plan = await buildLegacyAvatarBackfillPlan(
    {
      baseUrl: 'https://app.example.com',
      existingKeys: new Set(),
      users: [
        {
          image: `/api/storage/file?key=${encodeURIComponent(LEGACY_KEY)}`,
          updatedAt: new Date('2026-07-01T00:00:00.000Z'),
          userId: 'user-1',
          workspaceIds: ['workspace-1'],
        },
      ],
    },
    async () => null
  );

  assert.equal(plan.eligible.length, 0);
  assert.deepEqual(plan.missing, [{ r2Key: LEGACY_KEY, userId: 'user-1' }]);
});
