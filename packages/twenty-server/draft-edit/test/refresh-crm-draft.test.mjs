import test from 'node:test';
import assert from 'node:assert/strict';
import { refreshCrmDraft } from '../src/refresh-crm-draft.mjs';

function fixture(rows, schema = 'workspace_fixture') {
  const writes = [];
  return {
    writes,
    dataSource: {
      async query() { return [{ databaseSchema: schema }]; },
      async transaction(run) {
        return run({ async query(sql, args) {
          if (sql.startsWith('SELECT')) return rows;
          writes.push(args); return [];
        } });
      },
    },
  };
}
const input = { context: { workspaceId: 'workspace' }, accountId: 'account', parsed: { messageId: '<fixture@example.invalid>', subject: 'Updated', text: 'After' } };
test('refreshes only one linked draft and carries content as SQL parameters', async () => {
  const f = fixture([{ id: 'record' }]);
  assert.equal(await refreshCrmDraft({ ...input, dataSource: f.dataSource }), 'updated');
  assert.deepEqual(f.writes, [['Updated', 'After', 'record']]);
});
test('unlinked or ambiguous imported drafts are not modified', async () => {
  const absent = fixture([]);
  assert.equal(await refreshCrmDraft({ ...input, dataSource: absent.dataSource }), 'not_imported');
  assert.equal(absent.writes.length, 0);
  const duplicate = fixture([{ id: 'a' }, { id: 'b' }]);
  await assert.rejects(refreshCrmDraft({ ...input, dataSource: duplicate.dataSource }), /Ambiguous/);
  assert.equal(duplicate.writes.length, 0);
});
test('rejects an unsafe workspace identifier before querying message records', async () => {
  const f = fixture([{ id: 'record' }], 'workspace"; DROP TABLE message; --');
  await assert.rejects(refreshCrmDraft({ ...input, dataSource: f.dataSource }), /schema/);
  assert.equal(f.writes.length, 0);
});
