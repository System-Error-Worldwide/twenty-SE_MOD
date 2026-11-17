import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTwentyBindings } from '../src/twenty-bindings.mjs';

function fixture() {
  const calls = [];
  const args = {
    accounts: { async findMailboxesUsableByCaller(x) { calls.push(x); return [{ id: 'allowed', provider: 'imap_smtp_caldav', connectionParameters: { IMAP: {} } }, { id: 'other', provider: 'GOOGLE' }]; } },
    imap: { async getClient(id) { return id; }, async closeClient() {} },
    composer: { async getAttachments(files, workspace) { calls.push({ files, workspace }); return files.map((f) => ({ filename: f.name, content: Buffer.from('pdf'), contentType: 'application/pdf' })); } },
    dataSource: { async query() { return [{ operation_id: 'test' }]; } }, emailOperationDraft: 'DRAFT', getStandardFolder: (name) => name === 'Drafts' ? 'drafts' : null,
    draftsStandard: 'drafts', PostalMime: {}, MailComposer: function () {},
  };
  return { binding: createTwentyBindings(args), calls };
}

test('uses Twenty caller-scoped account discovery and rejects unlisted accounts and non-IMAP providers', async () => {
  const { binding, calls } = fixture(); const context = { workspaceId: 'ws', userWorkspaceId: 'user' };
  assert.deepEqual(await binding.authorizeAccount({ context, accountId: 'allowed' }), { id: 'allowed', workspaceId: 'ws' });
  assert.equal(await binding.authorizeAccount({ context, accountId: 'other' }), null);
  assert.equal(await binding.authorizeAccount({ context, accountId: 'unknown' }), null);
  assert.deepEqual(calls[0], { workspaceId: 'ws', userWorkspaceId: 'user', operation: 'DRAFT' });
});

test('uses a unique drafts folder and fails closed when ambiguous', async () => {
  const { binding } = fixture();
  assert.equal(await binding.getDraftFolder({ client: { list: async () => [{ name: 'Drafts', path: 'Drafts' }] } }), 'Drafts');
  assert.equal(await binding.getDraftFolder({ client: { list: async () => [{ path: 'A', specialUse: '\\Drafts' }, { path: 'B', specialUse: '\\Drafts' }] } }), null);
});

test('resolves files in the requesting workspace via Twenty composer', async () => {
  const { binding, calls } = fixture(); const files = [{ id: 'file-id', name: 'DE.pdf' }];
  assert.equal((await binding.resolveFiles({ context: { workspaceId: 'ws' }, files }))[0].filename, 'DE.pdf');
  assert.deepEqual(calls[0], { files, workspace: 'ws' });
});


test('normalizes TypeORM update results for journal transitions', async () => {
  const { binding } = fixture();
  binding.journal.pool = { query: createTwentyBindings({
    accounts: {}, imap: {}, composer: {}, dataSource: { async query() { return [[{ operation_id: 'id' }], 1]; } },
    emailOperationDraft: 'DRAFT', getStandardFolder: () => null, draftsStandard: 'drafts', PostalMime: {}, MailComposer: function () {},
  }).journal.pool.query };
  await assert.doesNotReject(binding.journal.mark('id', { phase: 'appending' }));
});
