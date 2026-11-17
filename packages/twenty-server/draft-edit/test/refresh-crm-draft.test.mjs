import test from 'node:test';
import assert from 'node:assert/strict';
import { refreshCrmDraft } from '../src/refresh-crm-draft.mjs';

function fixture(rows, schema = 'workspace_fixture', updateResult = [{ id: 'association' }], existing = [], invalidationResult = null) {
  const writes = [];
  return {
    writes,
    dataSource: {
      async query() { return [{ databaseSchema: schema }]; },
      async transaction(run) {
        return run({ async query(sql, args) {
          if (sql.includes('FROM \"workspace_fixture\".message m')) return rows;
          if (sql.includes('FROM \"workspace_fixture\".attachment a')) return existing;
          if (sql.includes('FROM core.\"fieldMetadata\"')) return [{ applicationId: 'app', universalIdentifier: 'field' }];
          if (sql.startsWith('LOCK TABLE')) return [];
          writes.push({ sql, args });
          if (sql.startsWith('UPDATE core.file')) return invalidationResult ?? existing.map((row) => ({ id: row.fileId }));
          return sql.includes('RETURNING id') ? updateResult : [];
        } });
      },
    },
  };
}
const previousTarget = { accountId: 'account', folder: 'Drafts', uidValidity: '42', uid: 79 };
const input = { attachments: [], attachmentFieldIdentifier: 'field', context: { workspaceId: 'workspace' }, accountId: 'account', parsed: { messageId: '<fixture@example.invalid>', subject: 'Updated', text: 'After' }, previousTarget, newTarget: { ...previousTarget, uid: 80 } };
const record = { id: 'record', associationId: 'association', messageExternalId: 'Drafts:79' };
test('refreshes uniquely linked draft and replaces its precise mailbox identity', async () => {
  const f = fixture([record]);
  assert.equal(await refreshCrmDraft({ ...input, dataSource: f.dataSource }), 'updated');
  assert.deepEqual(f.writes.map((entry) => entry.args), [['Drafts:80', 'association', 'Drafts:79'], ['Updated', 'After', 'record']]);
});
test('unlinked, ambiguous or stale associations cannot be modified', async () => {
  for (const rows of [[], [record, { ...record, id: 'other' }], [{ ...record, messageExternalId: 'Drafts:78' }]]) {
    const f = fixture(rows);
    if (rows.length === 0) assert.equal(await refreshCrmDraft({ ...input, dataSource: f.dataSource }), 'not_imported');
    else await assert.rejects(refreshCrmDraft({ ...input, dataSource: f.dataSource }), /Ambiguous|identity changed/);
    assert.equal(f.writes.length, 0);
  }
});
test('rejects an association changed at update time before updating message content', async () => {
  const f = fixture([record], 'workspace_fixture', []);
  await assert.rejects(refreshCrmDraft({ ...input, dataSource: f.dataSource }), /identity changed/);
  assert.equal(f.writes.length, 1);
});
test('rejects invalid target transitions and unsafe workspace identifiers', async () => {
  for (const next of [{ ...input.newTarget, accountId: 'other' }, { ...input.newTarget, folder: 'Other' }, { ...input.newTarget, uidValidity: '43' }, previousTarget]) {
    const f = fixture([record]);
    await assert.rejects(refreshCrmDraft({ ...input, newTarget: next, dataSource: f.dataSource }), /identity/);
    assert.equal(f.writes.length, 0);
  }
  const f = fixture([record], 'workspace"; DROP TABLE message; --');
  await assert.rejects(refreshCrmDraft({ ...input, dataSource: f.dataSource }), /schema/);
  assert.equal(f.writes.length, 0);
});

test('rebuilds remote attachment records from the final MIME parts', async () => {
  const old = { id: 'old', fileId: 'old-file', file: [{ fileId: 'old-file', label: 'old.pdf' }] };
  const f = fixture([record], 'workspace_fixture', [{ id: 'association' }], [old]);
  const attachments = [{ externalId: '2.1', filename: 'new.pdf', size: 123, mimeType: 'application/pdf' }, { externalId: '3', filename: 'extra.pdf', size: 12, mimeType: 'application/pdf' }];
  assert.equal(await refreshCrmDraft({ ...input, attachments, dataSource: f.dataSource }), 'updated');
  const files = f.writes.filter((entry) => entry.sql.includes('INSERT INTO core.file'));
  assert.equal(files.length, 2);
  assert.deepEqual(JSON.parse(files[0].args[6]), { isTemporaryFile: false, toDelete: false });
  assert.deepEqual(files.map((entry) => JSON.parse(entry.args[7])), [
    { originType: 'MESSAGE', originId: 'association', originKey: '2.1' },
    { originType: 'MESSAGE', originId: 'association', originKey: '3' },
  ]);
  assert.equal(f.writes.filter((entry) => entry.sql.includes('INSERT INTO "workspace_fixture".attachment')).length, 2);
  assert.equal(JSON.parse(f.writes.find((entry) => entry.sql.includes('INSERT INTO "workspace_fixture".attachment')).args[2])[0].extension, 'pdf');
  assert.deepEqual(f.writes.find((entry) => entry.sql.startsWith('UPDATE core.file')).args, [['old-file'], 'workspace', 'association', ['old']]);
  assert.deepEqual(f.writes.find((entry) => entry.sql.includes('UPDATE "workspace_fixture".attachment SET "deletedAt"')).args, [['old']]);
});
test('rejects duplicate part IDs and mixed-ownership records', async () => {
  const item = { externalId: '1', filename: 'a.pdf', size: 1, mimeType: 'application/pdf' };
  await assert.rejects(refreshCrmDraft({ ...input, attachments: [item, item], dataSource: fixture([record]).dataSource }), /Invalid attachment/);
  const f = fixture([record], 'workspace_fixture', [{ id: 'association' }], [{ id: 'a', file: [{ fileId: 'x' }, { fileId: 'y' }] }]);
  await assert.rejects(refreshCrmDraft({ ...input, dataSource: f.dataSource }), /Ambiguous attachment/);
});

test('fails closed when an old remote reference is shared or unavailable', async () => {
  const old = { id: 'old', fileId: 'old-file', file: [{ fileId: 'old-file', label: 'old.pdf' }] };
  const f = fixture([record], 'workspace_fixture', [{ id: 'association' }], [old], []);
  await assert.rejects(refreshCrmDraft({ ...input, dataSource: f.dataSource }), /shared or unavailable/);
  assert.equal(f.writes.some((entry) => entry.sql.includes('UPDATE "workspace_fixture".attachment SET "deletedAt"')), false);
});
test('accepts TypeORM Postgres update-returning tuple', async () => {
  const f = fixture([record], 'workspace_fixture', [[{ id: 'association' }], 1]);
  assert.equal(await refreshCrmDraft({ ...input, dataSource: f.dataSource }), 'updated');
});
