import { draftRevision, replaceDraft, validateTarget } from './draft-replacement.mjs';
import { ImapDraftMailbox } from './imap-draft-mailbox.mjs';
import { editDraftMime } from './edit-draft-mime.mjs';

function mailboxAddresses(value) {
  const result = [];
  const visit = (entry) => {
    if (Array.isArray(entry)) return entry.forEach(visit);
    if (entry?.group) return visit(entry.group);
    if (typeof entry?.address !== 'string' || !entry.address.trim()) throw new Error('Address unavailable');
    result.push(entry.address.trim().toLowerCase());
  };
  if (value) visit(value);
  return result.sort();
}

export class DraftEditService {
  constructor({ authorizeAccount, getDraftFolder, connect, close, resolveFiles, journal, PostalMime, MailComposer, compileBody, refreshDraft }) {
    Object.assign(this, { authorizeAccount, getDraftFolder, connect, closeClient: close, resolveFiles, journal, PostalMime, MailComposer, compileBody, refreshDraft });
  }

  async withMailbox(context, target, run) {
    validateTarget(target);
    if (!context?.workspaceId || !context?.userWorkspaceId || !target?.accountId) throw new Error('Authenticated workspace user required');
    const account = await this.authorizeAccount({ context, accountId: target.accountId });
    if (!account || account.workspaceId !== context.workspaceId || account.id !== target.accountId) throw new Error('Account unavailable');
    const client = await this.connect(account);
    let mailbox;
    try {
      const draftFolder = await this.getDraftFolder({ account, client });
      if (!draftFolder || draftFolder !== target.folder) throw new Error('Target is not the drafts folder');
      mailbox = new ImapDraftMailbox(client, draftFolder);
      await mailbox.open();
      return await run(mailbox);
    } finally {
      mailbox?.close();
      await this.closeClient(client);
    }
  }

  async list({ context, accountId }) {
    if (!context?.workspaceId || !context?.userWorkspaceId || typeof accountId !== 'string' || !accountId) throw new Error('Authenticated workspace user required');
    const account = await this.authorizeAccount({ context, accountId });
    if (!account || account.workspaceId !== context.workspaceId || account.id !== accountId) throw new Error('Account unavailable');
    const client = await this.connect(account);
    let lock;
    try {
      const folder = await this.getDraftFolder({ account, client });
      if (!folder) throw new Error('Drafts folder unavailable');
      lock = await client.getMailboxLock(folder);
      const count = client.mailbox.exists;
      const uidValidity = String(client.mailbox.uidValidity);
      const drafts = [];
      if (count > 0) {
        const range = `${Math.max(1, count - 99)}:*`;
        for await (const entry of client.fetch(range, { uid: true, flags: true, envelope: true })) {
          if (!entry.flags.has('\\Draft') || entry.flags.has('\\Deleted')) continue;
          drafts.push({ target: { accountId, folder, uidValidity, uid: entry.uid }, subject: entry.envelope?.subject ?? '', headerMessageId: entry.envelope?.messageId ?? null });
        }
      }
      return { drafts, truncated: count > 100 };
    } finally { lock?.release(); await this.closeClient(client); }
  }

  async inspect({ context, target }) {
    return this.withMailbox(context, target, async (mailbox) => {
      const original = await mailbox.readDraft(target);
      if (!original || !original.isDraft || original.uidValidity !== target.uidValidity) throw new Error('Draft unavailable');
      const parsed = await this.PostalMime.parse(original.source);
      return {
        target, revision: draftRevision(original.source), subject: parsed.subject, text: parsed.text, html: parsed.html,
        recipients: { from: mailboxAddresses(parsed.from), to: mailboxAddresses(parsed.to), cc: mailboxAddresses(parsed.cc), bcc: mailboxAddresses(parsed.bcc) },
        attachments: (parsed.attachments ?? []).map(({ filename, mimeType, disposition }) => ({ filename, mimeType, disposition })),
      };
    });
  }

  async edit({ context, target, expectedRevision, operationId, changes }) {
    if (!changes || typeof changes !== 'object' || Array.isArray(changes) || Object.keys(changes).some((key) => !['subject', 'body', 'files', 'addFiles'].includes(key))) throw new Error('Invalid changes');
    return this.withMailbox(context, target, async (mailbox) => {
      const prepared = { ...changes };
      if (prepared.body && Object.hasOwn(prepared.body, 'document')) {
        if (typeof this.compileBody !== 'function' || typeof prepared.body.document !== 'string' || Object.keys(prepared.body).length !== 1) throw new Error('Invalid document');
        prepared.body = await this.compileBody(prepared.body.document);
      }
      if (Object.hasOwn(changes, 'files') && Object.hasOwn(changes, 'addFiles')) throw new Error('Conflicting file changes');
      for (const key of ['files', 'addFiles']) {
        if (!Object.hasOwn(changes, key)) continue;
        const files = changes[key];
        if (!Array.isArray(files) || files.some((file) => !file || typeof file.id !== 'string' || !file.id || typeof file.name !== 'string' || !file.name)) throw new Error('Invalid files');
        const attachments = await this.resolveFiles({ context, files });
        if (!Array.isArray(attachments) || attachments.length !== files.length) throw new Error('Files unavailable');
        prepared[key === 'files' ? 'attachments' : 'addAttachments'] = attachments;
        delete prepared[key];
      }
      const result = await replaceDraft({
        target, expectedRevision, operationId, mailbox, journal: this.journal,
        buildSource: (source) => editDraftMime({ source, changes: prepared, PostalMime: this.PostalMime, MailComposer: this.MailComposer }),
      });
      if (result.status === 'updated' && this.refreshDraft) {
        try {
          const saved = await mailbox.readDraft(result.target);
          if (!saved?.isDraft || saved.uidValidity !== result.target.uidValidity) throw new Error('Draft unavailable after save');
          result.crmRefresh = await this.refreshDraft({ context, accountId: target.accountId, parsed: await this.PostalMime.parse(saved.source) });
        } catch { result.crmRefresh = 'pending'; }
      }
      return result;
    });
  }
}
