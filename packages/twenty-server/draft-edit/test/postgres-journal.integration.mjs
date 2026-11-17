import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { PostgresJournal } from '../src/postgres-journal.mjs';
import { draftRevision, replaceDraft } from '../src/draft-replacement.mjs';

const { Pool } = createRequire('/app/package.json')('pg');
const pool = new Pool({ host: '127.0.0.1', port: 5432, database: 'draft_test', user: 'draft_test', password: 'test-only', max: 4 });
try {
  await pool.query(await readFile('/work/sql/draft-edit-journal.sql', 'utf8'));
  const journal = new PostgresJournal(pool);
  const targetKey = '["test-account","Drafts","42",3]';
  const expectedRevision = 'a'.repeat(64);
  const claims = await Promise.all([
    journal.claim({ operationId: 'concurrent-operation-1', targetKey, expectedRevision }),
    journal.claim({ operationId: 'concurrent-operation-2', targetKey, expectedRevision }),
  ]);
  assert.equal(claims.filter((r) => r.acquired).length, 1);
  const winner = claims[0].acquired ? 'concurrent-operation-1' : 'concurrent-operation-2';
  await journal.mark(winner, { phase: 'appended', replacement: { uid: 4 } });
  const persisted = await pool.query('SELECT state, details FROM draft_edit_operation WHERE operation_id=$1', [winner]);
  assert.equal(persisted.rows[0].state, 'active');
  assert.equal(persisted.rows[0].details.replacement.uid, 4);
  assert.equal((await journal.claim({ operationId: winner, targetKey, expectedRevision })).acquired, false);
  await journal.finish(winner, { status: 'updated' });
  assert.equal((await journal.claim({ operationId: winner, targetKey, expectedRevision })).acquired, false);
  assert.equal((await journal.claim({ operationId: 'new-operation-000001', targetKey, expectedRevision })).acquired, true);
  await assert.rejects(journal.mark(winner, { phase: 'appending' }), /not active/);
  const source = Buffer.from('isolated original');
  const target = { accountId: 'isolated', folder: 'Drafts', uidValidity: '2', uid: 9 };
  let appendCount = 0;
  const mailbox = {
    async capabilities() { return { uidPlus: true, conditionalDelete: true }; },
    async readDraft() { return { uidValidity: '2', isDraft: true, source, modseq: '3' }; },
    async appendDraft() { appendCount++; throw new Error('ambiguous network outcome'); },
  };
  const args = { target, expectedRevision: draftRevision(source), operationId: 'ambiguous-operation-1', journal, mailbox, buildSource: async () => Buffer.from('replacement') };
  assert.equal((await replaceDraft(args)).reason, 'append_outcome_unknown');
  const reopened = new PostgresJournal(pool);
  assert.equal((await replaceDraft({ ...args, journal: reopened })).status, 'recovery_required');
  assert.equal(appendCount, 1);
  const unresolved = await pool.query('SELECT state, details FROM draft_edit_operation WHERE operation_id=$1', [args.operationId]);
  assert.equal(unresolved.rows[0].state, 'active');
  assert.equal(unresolved.rows[0].details.phase, 'appending');
  console.log('PASS: PostgreSQL journal serializes competing edits and retains recovery state');
} finally { await pool.end(); }
