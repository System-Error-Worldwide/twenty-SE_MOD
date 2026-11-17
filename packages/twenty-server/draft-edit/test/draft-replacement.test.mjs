import assert from 'node:assert/strict';
import { test } from 'node:test';
import { draftRevision, replaceDraft } from '../src/draft-replacement.mjs';

const target = { accountId: 'account', folder: 'Drafts', uidValidity: '42', uid: 3 };
const original = Buffer.from('From: sender\r\nSubject: before\r\n\r\nhello');
const updated = Buffer.from('From: sender\r\nSubject: after\r\n\r\nhello');

function setup() {
  const calls = [];
  let claimed = false;
  const journal = {
    async claim() { if (claimed) return { acquired: false }; claimed = true; return { acquired: true }; },
    async mark(id, entry) { calls.push(['mark', entry.phase]); },
    async finish(id, entry) { calls.push(['finish', entry.status]); },
  };
  const mailbox = {
    async capabilities() { return { uidPlus: true, conditionalDelete: true }; },
    async readDraft() { return { uidValidity: '42', isDraft: true, source: original, modseq: '7' }; },
    async appendDraft(folder, source) { calls.push(['append', source]); return { uid: 4, uidValidity: '42' }; },
    async deleteDraftIfUnchanged(draft, modseq) { calls.push(['delete', draft.uid, modseq]); return true; },
  };
  return { target, expectedRevision: draftRevision(original), operationId: 'operation-123456789', mailbox, journal, buildSource: async () => updated, calls };
}

test('replaces the verified revision and returns the new identity', async () => {
  const f = setup(); const result = await replaceDraft(f);
  assert.equal(result.status, 'updated'); assert.equal(result.target.uid, 4);
  assert.equal(result.revision, draftRevision(updated));
  assert.deepEqual(f.calls.map((c) => c[0]), ['mark', 'append', 'mark', 'delete', 'finish']);
  assert.deepEqual(f.calls[3], ['delete', 3, '7']);
});

test('rejects stale revision or wrong UIDVALIDITY before appending', async () => {
  const f = setup(); f.expectedRevision = draftRevision(Buffer.from('stale'));
  assert.equal((await replaceDraft(f)).status, 'conflict');
  assert.equal(f.calls.some((c) => c[0] === 'append'), false);
  const g = setup(); g.target = { ...target, uidValidity: '99' };
  assert.equal((await replaceDraft(g)).reason, 'draft_not_found_or_changed');
  assert.equal(g.calls.some((c) => c[0] === 'append'), false);
});

test('refuses servers without safe conditional deletion', async () => {
  const f = setup(); f.mailbox.capabilities = async () => ({ uidPlus: true, conditionalDelete: false });
  assert.equal((await replaceDraft(f)).reason, 'unsupported_mailbox');
  assert.equal(f.calls.some((c) => c[0] === 'append'), false);
});

test('ambiguous append and a retry never cause a second append', async () => {
  const f = setup(); let count = 0;
  f.mailbox.appendDraft = async () => { count++; throw new Error('connection lost'); };
  assert.equal((await replaceDraft(f)).reason, 'append_outcome_unknown');
  assert.equal((await replaceDraft(f)).status, 'recovery_required');
  assert.equal(count, 1);
  assert.equal(f.calls.some((c) => c[0] === 'delete'), false);
});

test('concurrent original change retains both messages for recovery', async () => {
  const f = setup(); f.mailbox.deleteDraftIfUnchanged = async () => false;
  const result = await replaceDraft(f);
  assert.equal(result.reason, 'original_changed'); assert.equal(result.replacement.uid, 4);
  assert.equal(f.calls.some((c) => c[0] === 'finish'), false);
});

test('retains the original when the server drops a flag from the replacement', async () => {
  const f = setup();
  f.mailbox.readDraft = async (draft) => ({ uidValidity: '42', isDraft: true, source: draft.uid === 3 ? original : updated, modseq: '7', flags: draft.uid === 3 ? ['\\Draft', '\\Flagged', 'FixtureTag'] : ['\\Draft'] });
  const result = await replaceDraft(f);
  assert.equal(result.reason, 'replacement_flags_missing');
  assert.equal(result.replacement.uid, 4);
  assert.equal(f.calls.some((c) => c[0] === 'delete'), false);
});

test('no-op does not append or delete', async () => {
  const f = setup(); f.buildSource = async () => original;
  assert.equal((await replaceDraft(f)).status, 'unchanged');
  assert.equal(f.calls.some((c) => c[0] === 'append' || c[0] === 'delete'), false);
});

test('malformed target and operation identifiers fail before accessing adapters', async () => {
  const f = setup(); f.target = { ...target, uid: 0 };
  await assert.rejects(replaceDraft(f), /Invalid draft target/);
  const g = setup(); g.operationId = 'bad';
  await assert.rejects(replaceDraft(g), /Invalid operation ID/);
});


test('ambiguous durable journal writes do not append or release the operation', async () => {
  const f = setup(); f.journal.mark = async () => { throw new Error('commit outcome unknown'); };
  assert.equal((await replaceDraft(f)).status, 'recovery_required');
  assert.equal(f.calls.some((c) => c[0] === 'append' || c[0] === 'finish'), false);
  assert.equal((await replaceDraft(f)).status, 'recovery_required');
});
