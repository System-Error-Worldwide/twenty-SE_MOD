import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { draftRevision, replaceDraft } from '../src/draft-replacement.mjs';

const { ImapFlow } = createRequire('/app/package.json')('imapflow');
const client = new ImapFlow({ host: '127.0.0.1', port: 3143, secure: false, auth: { user: 'test', pass: 'testing' }, logger: false });
await client.connect();
try {
  await client.mailboxCreate('Drafts');
  const source = Buffer.from('From: test@local.invalid\r\nTo: test@local.invalid\r\nSubject: Fixture\r\n\r\nTest');
  const appended = await client.append('Drafts', source, ['\\Draft']);
  assert.ok(appended.uid);
  let entered = false;
  const mailbox = {
    async capabilities() { return { uidPlus: client.capabilities.has('UIDPLUS'), conditionalDelete: client.capabilities.has('CONDSTORE') }; },
    async readDraft() { entered = true; throw new Error('must not read without capability'); },
  };
  const journal = { async claim() { return { acquired: true }; }, async finish() {}, async mark() { throw new Error('must not mark'); } };
  const result = await replaceDraft({
    target: { accountId: 'isolated', folder: 'Drafts', uidValidity: String(appended.uidValidity), uid: appended.uid },
    expectedRevision: draftRevision(source), operationId: 'greenmail-test-000001', mailbox, journal,
    buildSource: async () => { throw new Error('must not build'); },
  });
  assert.equal(result.status, 'rejected');
  assert.equal(result.reason, 'unsupported_mailbox');
  assert.equal(entered, false);
  const lock = await client.getMailboxLock('Drafts');
  try { assert.equal(client.mailbox.exists, 1); } finally { lock.release(); }
  console.log('PASS: real IMAP mailbox without CONDSTORE rejected, original draft remains');
} finally { await client.logout(); }
