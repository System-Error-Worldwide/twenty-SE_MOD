import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { draftRevision, replaceDraft } from '../src/draft-replacement.mjs';
import { ImapDraftMailbox } from '../src/imap-draft-mailbox.mjs';

const { ImapFlow } = createRequire('/app/package.json')('imapflow');
const config = { host: '127.0.0.1', port: 31143, secure: false, auth: { user: 'test', pass: 'test-only' }, tls: { rejectUnauthorized: false }, logger: false };
const client = new ImapFlow(config), other = new ImapFlow(config);
await client.connect(); await other.connect();
try {
  const folder = `DraftTest-${randomUUID()}`;
  await client.mailboxCreate(folder);
  const source = Buffer.from('From: test@local.invalid\r\nTo: test@local.invalid\r\nSubject: Test\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="x"\r\n\r\n--x\r\nContent-Type: text/plain\r\n\r\nbefore\r\n--x\r\nContent-Type: application/pdf\r\nContent-Disposition: attachment; filename="test.pdf"\r\nContent-Transfer-Encoding: base64\r\n\r\nJVBERi0xLjQK\r\n--x--\r\n');
  const replacement = Buffer.from(source.toString().replace('before', 'after'));
  const inserted = await client.append(folder, source, ['\\Draft', '\\Flagged', 'FixtureTag']);
  const sentinel = await client.append(folder, Buffer.from('Subject: unrelated\r\n\r\nkeep'), ['\\Draft', '\\Deleted']);
  const target = { accountId: 'isolated', folder, uidValidity: String(inserted.uidValidity), uid: inserted.uid };
  const journal = { async claim() { return { acquired: true }; }, async mark() {}, async finish() {} };
  const mailbox = new ImapDraftMailbox(client, folder); await mailbox.open();
  try {
    assert.deepEqual(await mailbox.capabilities(), { uidPlus: true, conditionalDelete: true });
    const result = await replaceDraft({ target, expectedRevision: draftRevision(source), operationId: 'dovecot-success-001', journal, mailbox, buildSource: async () => replacement });
    assert.equal(result.status, 'updated');
    const readback = await mailbox.readDraft(result.target);
    assert.deepEqual(readback.source, replacement);
    assert.equal(result.revision, draftRevision(readback.source));
    assert.ok(readback.flags.includes('\\Draft'));
    assert.ok(readback.flags.includes('\\Flagged'));
    assert.ok(readback.flags.some((flag) => flag.toLowerCase() === 'fixturetag'));
    assert.match(readback.source.toString(), /JVBERi0xLjQK/);
    assert.deepEqual((await client.search({ all: true }, { uid: true })).sort((a, b) => a - b), [sentinel.uid, result.target.uid].sort((a, b) => a - b));
    const secondTarget = result.target;
    const oldRead = mailbox.readDraft.bind(mailbox);
    mailbox.readDraft = async (t) => {
      const read = await oldRead(t);
      const otherLock = await other.getMailboxLock(folder);
      try { await other.messageFlagsAdd(String(t.uid), ['\\Seen'], { uid: true }); } finally { otherLock.release(); }
      return read;
    };
    const conflict = await replaceDraft({ target: secondTarget, expectedRevision: draftRevision(replacement), operationId: 'dovecot-conflict-01', journal, mailbox, buildSource: async () => Buffer.from(replacement.toString().replace('after', 'new')) });
    assert.equal(conflict.status, 'recovery_required');
    assert.equal(conflict.reason, 'original_changed');
    assert.ok(await oldRead(secondTarget));
    assert.ok(await oldRead(conflict.replacement));
    assert.equal((await client.search({ all: true }, { uid: true })).length, 3);
  } finally { mailbox.close(); }
  console.log('PASS: IMAP update preserves PDF bytes, isolates targeted UID, and detects concurrent change');
} finally { await other.logout(); await client.logout(); }
