const MAX_ATTACHMENTS_BYTES = 25 * 1024 * 1024;
const MANAGED_HEADERS = new Set(['from', 'to', 'cc', 'bcc', 'reply-to', 'subject', 'date', 'message-id', 'in-reply-to', 'references', 'mime-version', 'content-type', 'content-transfer-encoding']);
const ALLOWED_EXTRA_HEADERS = new Set(['x-mailer', 'user-agent', 'importance', 'x-priority', 'list-unsubscribe']);

function addressList(value) {
  if (!value) return undefined;
  const addresses = Array.isArray(value) ? value : [value];
  if (addresses.some((a) => !a || typeof a.address !== 'string' || !a.address || /[\r\n]/.test(a.address) || /[\r\n]/.test(a.name ?? ''))) {
    throw new Error('Unsupported address structure');
  }
  return addresses.map(({ address, name }) => ({ address, name: name || undefined }));
}

function checkAttachments(attachments) {
  if (!Array.isArray(attachments)) throw new Error('Attachments must be an array');
  let size = 0;
  return attachments.map((item) => {
    if (!item || !Buffer.isBuffer(item.content) || typeof item.filename !== 'string' || !item.filename || /[\r\n]/.test(item.filename) ||
        typeof item.contentType !== 'string' || /[\r\n]/.test(item.contentType)) throw new Error('Invalid attachment');
    size += item.content.length;
    if (size > MAX_ATTACHMENTS_BYTES) throw new Error('Attachments too large');
    return { filename: item.filename, content: item.content, contentType: item.contentType, contentDisposition: item.disposition ?? 'attachment', cid: item.cid };
  });
}

export async function editDraftMime({ source, changes, PostalMime, MailComposer }) {
  if (!Buffer.isBuffer(source) || source.length === 0 || source.length > 40 * 1024 * 1024 || !changes || typeof changes !== 'object' || Array.isArray(changes)) throw new Error('Invalid draft');
  const allowed = new Set(['subject', 'body', 'attachments', 'addAttachments']);
  if (Object.keys(changes).some((key) => !allowed.has(key))) throw new Error('Unsupported change');
  const parsed = await PostalMime.parse(source);
  const headers = [];
  for (const header of parsed.headers) {
    if (MANAGED_HEADERS.has(header.key)) continue;
    if (!ALLOWED_EXTRA_HEADERS.has(header.key) || /[\r\n]/.test(header.value)) throw new Error('Unsupported message header');
    headers.push({ key: header.originalKey, value: header.value });
  }
  const sourceText = source.toString('latin1');
  if (/content-type\s*:\s*(?:multipart\/signed|multipart\/encrypted|application\/(?:pkcs7|x-pkcs7|pgp))/i.test(sourceText)) throw new Error('Signed or encrypted drafts are unsupported');
  if (typeof parsed.subject !== 'string' || !parsed.from || !parsed.messageId || !parsed.date) throw new Error('Incomplete message');
  if (changes.subject !== undefined && (typeof changes.subject !== 'string' || /[\r\n]/.test(changes.subject))) throw new Error('Invalid subject');
  if (changes.body !== undefined && (typeof changes.body !== 'object' || changes.body === null || typeof changes.body.text !== 'string' || (changes.body.html !== undefined && typeof changes.body.html !== 'string'))) throw new Error('Invalid body');
  const existing = (parsed.attachments ?? []).map((item) => ({
    filename: item.filename || 'attachment', content: Buffer.from(item.content), contentType: item.mimeType || 'application/octet-stream',
    disposition: item.disposition || 'attachment', cid: item.contentId?.replace(/^<|>$/g, ''),
  }));
  const preservedInline = existing.filter((item) => item.disposition === 'inline' || item.cid);
  if (changes.attachments !== undefined && changes.addAttachments !== undefined) throw new Error('Conflicting attachment changes');
  const attachments = changes.attachments !== undefined ? [...preservedInline, ...changes.attachments] : [...existing, ...(changes.addAttachments ?? [])];
  const options = {
    from: addressList(parsed.from), to: addressList(parsed.to), cc: addressList(parsed.cc), bcc: addressList(parsed.bcc),
    replyTo: addressList(parsed.replyTo), subject: changes.subject ?? parsed.subject,
    messageId: parsed.messageId, date: new Date(parsed.date), inReplyTo: parsed.inReplyTo, references: parsed.references,
    text: changes.body?.text ?? parsed.text, html: changes.body ? changes.body.html : parsed.html,
    attachments: checkAttachments(attachments), headers,
  };
  if (Number.isNaN(options.date.getTime())) throw new Error('Invalid date');
  return new MailComposer(options).compile().build();
}
