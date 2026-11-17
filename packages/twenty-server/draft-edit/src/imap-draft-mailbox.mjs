export class ImapDraftMailbox {
  constructor(client, folder) { this.client = client; this.folder = folder; this.lock = null; }

  async open() {
    this.lock = await this.client.getMailboxLock(this.folder);
  }

  close() {
    if (this.lock) { this.lock.release(); this.lock = null; }
  }

  async capabilities() {
    const mailbox = this.client.mailbox;
    return {
      uidPlus: Boolean(this.lock && this.client.capabilities.has('UIDPLUS')),
      conditionalDelete: Boolean(this.lock && this.client.enabled.has('CONDSTORE') && mailbox && !mailbox.noModseq),
    };
  }

  async readDraft(target) {
    if (!this.lock || target.folder !== this.folder || String(this.client.mailbox.uidValidity) !== target.uidValidity) return null;
    const entry = await this.client.fetchOne(String(target.uid), { uid: true, flags: true, source: true, modseq: true }, { uid: true });
    if (!entry || !entry.modseq) return null;
    return { uidValidity: String(this.client.mailbox.uidValidity), source: entry.source, isDraft: entry.flags.has('\\Draft') && !entry.flags.has('\\Deleted'), flags: [...entry.flags].filter((flag) => !['\\recent', '\\deleted'].includes(flag.toLowerCase())), modseq: String(entry.modseq) };
  }

  async appendDraft(folder, source, flags) {
    if (!this.lock || folder !== this.folder || !(await this.capabilities()).uidPlus) throw new Error('Mailbox is not ready');
    if (!Array.isArray(flags) || !flags.some((flag) => flag.toLowerCase() === '\\draft')) throw new Error('Draft flags unavailable');
    const result = await this.client.append(folder, source, flags);
    if (!result || !result.uid || !result.uidValidity) return null;
    return { uid: result.uid, uidValidity: String(result.uidValidity) };
  }

  async deleteDraftIfUnchanged(target, modseq) {
    const caps = await this.capabilities();
    if (!caps.uidPlus || !caps.conditionalDelete || target.folder !== this.folder ||
        String(this.client.mailbox.uidValidity) !== target.uidValidity || !/^[1-9]\d*$/.test(modseq)) return false;
    const response = await this.client.exec('UID STORE', [
      { type: 'SEQUENCE', value: String(target.uid) },
      [{ type: 'ATOM', value: 'UNCHANGEDSINCE' }, { type: 'ATOM', value: modseq }],
      { type: 'ATOM', value: '+FLAGS.SILENT' },
      [{ type: 'ATOM', value: '\\Deleted' }],
    ]);
    const result = response.response;
    const codes = (result.attributes ?? []).flatMap((attribute) => attribute.section ?? []).map((item) => String(item.value ?? '').toUpperCase());
    response.next();
    if (result.command !== 'OK' || codes.includes('MODIFIED')) return false;
    const marked = await this.client.fetchOne(String(target.uid), { flags: true }, { uid: true });
    if (!marked || !marked.flags.has('\\Deleted')) return false;
    const expunge = await this.client.exec('UID EXPUNGE', [{ type: 'SEQUENCE', value: String(target.uid) }]);
    const succeeded = expunge.response.command === 'OK';
    expunge.next();
    if (!succeeded) return false;
    const remaining = await this.client.fetchOne(String(target.uid), { uid: true }, { uid: true });
    return !remaining;
  }
}
