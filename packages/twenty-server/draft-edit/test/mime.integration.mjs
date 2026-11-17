import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { editDraftMime } from '../src/edit-draft-mime.mjs';
const require = createRequire('/app/package.json');
const PostalMime = require('postal-mime');
const MailComposer = require('nodemailer/lib/mail-composer');
const firstPdf = Buffer.from('%PDF-1.4\nfirst fixture\n%%EOF');
const secondPdf = Buffer.from('%PDF-1.4\nsecond fixture\n%%EOF');
const initial = new MailComposer({
  from: { name: 'Moses', address: 'test@example.invalid' }, to: 'prospect@example.invalid', cc: 'cc@example.invalid', bcc: 'hidden@example.invalid',
  subject: 'Funding', text: 'Original text', html: '<p>Original text</p>', messageId: '<fixture@example.invalid>',
  attachments: [{ filename: 'DE.pdf', content: firstPdf, contentType: 'application/pdf' }],
}).compile();
initial.keepBcc = true;
const original = await initial.build();
assert.equal((await PostalMime.parse(original)).bcc[0].address, 'hidden@example.invalid');
const build = (changes, source = original) => editDraftMime({ source, changes, PostalMime, MailComposer });
const edited = await PostalMime.parse(await build({ body: { text: 'Personalised update', html: '<p>Personalised update</p>' } }));
assert.equal(edited.text.trim(), 'Personalised update');
assert.equal(edited.html.trim(), '<p>Personalised update</p>');
assert.equal(edited.from.address, 'test@example.invalid');
assert.equal(edited.to[0].address, 'prospect@example.invalid');
assert.equal(edited.cc[0].address, 'cc@example.invalid');
assert.equal(edited.bcc[0].address, 'hidden@example.invalid');
const subjectOnly = await PostalMime.parse(await build({ subject: 'Updated subject' }));
assert.equal(subjectOnly.bcc[0].address, 'hidden@example.invalid');
assert.equal(edited.messageId, '<fixture@example.invalid>');
assert.equal(edited.attachments[0].filename, 'DE.pdf');
assert.deepEqual(Buffer.from(edited.attachments[0].content), firstPdf);
const changed = await PostalMime.parse(await build({ attachments: [{ filename: 'EN.pdf', content: secondPdf, contentType: 'application/pdf' }] }));
assert.equal(changed.text.trim(), 'Original text');
assert.equal(changed.attachments.length, 1);
assert.equal(changed.attachments[0].filename, 'EN.pdf');
assert.deepEqual(Buffer.from(changed.attachments[0].content), secondPdf);
const added = await PostalMime.parse(await build({ addAttachments: [{ filename: 'EN.pdf', content: secondPdf, contentType: 'application/pdf' }] }));
assert.equal(added.attachments.length, 2);
assert.deepEqual(Buffer.from(added.attachments[0].content), firstPdf);
assert.deepEqual(Buffer.from(added.attachments[1].content), secondPdf);
const removed = await PostalMime.parse(await build({ attachments: [] }));
assert.equal(removed.attachments.length, 0);
await assert.rejects(build({ subject: 'unsafe\r\nBcc: hidden@example.invalid' }), /Invalid subject/);
await assert.rejects(build({ attachments: [{ filename: 'bad\nname.pdf', content: secondPdf, contentType: 'application/pdf' }] }), /Invalid attachment/);
await assert.rejects(build({ recipients: ['other@example.invalid'] }), /Unsupported change/);
console.log('PASS: MIME edit preserves and replaces PDF bytes and rejects unsafe changes');

const inlineBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1XQAAAAASUVORK5CYII=', 'base64');
const cidSource = await new MailComposer({
  from: 'sender@example.invalid', to: 'recipient@example.invalid', subject: 'CID attachment regression',
  text: 'Before', html: '<p>Before</p><img src="cid:inline-logo">',
  attachments: [
    { filename: 'ordinary.pdf', content: firstPdf, contentType: 'application/pdf', cid: 'ordinary-pdf', contentDisposition: 'attachment' },
    { filename: 'logo.png', content: inlineBytes, contentType: 'image/png', cid: 'inline-logo', contentDisposition: 'inline' },
  ],
}).compile().build();
const cidParsed = await PostalMime.parse(cidSource);
assert.equal(cidParsed.attachments.find((item) => item.filename === 'ordinary.pdf').disposition, 'attachment');
for (const attachments of [[], [{ filename: 'replacement.pdf', content: secondPdf, contentType: 'application/pdf' }]]) {
  const result = await PostalMime.parse(await build({ attachments }, cidSource));
  assert.equal(result.attachments.some((item) => item.filename === 'ordinary.pdf'), false);
  assert.equal(result.attachments.length, 1 + attachments.length);
  const inline = result.attachments.find((item) => item.filename === 'logo.png');
  assert.equal(inline.disposition, 'inline');
  assert.deepEqual(Buffer.from(inline.content), inlineBytes);
}
console.log('PASS: CID-bearing PDF removal/replacement preserves genuine inline image bytes');

const emptySubject = await build({ subject: '' });
assert.equal((await PostalMime.parse(emptySubject)).subject ?? '', '');
const afterEmptySubject = await PostalMime.parse(await build({ body: { text: 'Still editable' } }, emptySubject));
assert.equal(afterEmptySubject.subject ?? '', '');
assert.equal(afterEmptySubject.text.trim(), 'Still editable');
assert.deepEqual(Buffer.from(afterEmptySubject.attachments[0].content), firstPdf);
assert.equal(afterEmptySubject.bcc[0].address, 'hidden@example.invalid');
console.log('PASS: clearing subject permits the next body edit without changing PDF or Bcc');
