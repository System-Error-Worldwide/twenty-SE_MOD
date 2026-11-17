import { PostgresJournal } from './postgres-journal.mjs';
import { refreshCrmDraft } from './refresh-crm-draft.mjs';

export function createTwentyBindings({ accounts, imap, composer, dataSource, emailOperationDraft, getStandardFolder, draftsStandard, PostalMime, MailComposer, compileBody, extractImapBodyStructureAttachments, filterImportableMessageAttachments, resolveMessageAttachmentMimeType, attachmentFieldIdentifier }) {
  if (!accounts || !imap || !composer || !dataSource || !emailOperationDraft || !getStandardFolder || !draftsStandard || !PostalMime || !MailComposer) throw new Error('Incomplete Twenty bindings');
  const pool = {
    async query(sql, parameters) {
      const result = await dataSource.query(sql, parameters);
      if (Array.isArray(result) && result.length === 2 && Array.isArray(result[0]) && Number.isInteger(result[1])) return { rows: result[0], rowCount: result[1] };
      return { rowCount: Array.isArray(result) ? result.length : 0, rows: result };
    },
  };
  return {
    async authorizeAccount({ context, accountId }) {
      const usable = await accounts.findMailboxesUsableByCaller({ workspaceId: context.workspaceId, userWorkspaceId: context.userWorkspaceId, operation: emailOperationDraft });
      const account = usable.find((entry) => entry.id === accountId && entry.provider === 'imap_smtp_caldav' && entry.connectionParameters?.IMAP);
      return account ? { id: account.id, workspaceId: context.workspaceId } : null;
    },
    async getDraftFolder({ client }) {
      const entries = await client.list();
      const special = entries.filter((entry) => entry.specialUse?.includes('\\Drafts'));
      const matches = special.length ? special : entries.filter((entry) => getStandardFolder(entry.name) === draftsStandard);
      return matches.length === 1 ? matches[0].path : null;
    },
    async connect(account) { return imap.getClient(account.id); },
    async close(client) { return imap.closeClient(client); },
    async refreshDraft({ context, accountId, parsed, previousTarget, newTarget, bodyStructure }) {
      if (!bodyStructure || !extractImapBodyStructureAttachments || !filterImportableMessageAttachments || !resolveMessageAttachmentMimeType || !attachmentFieldIdentifier) throw new Error('Attachment metadata unavailable');
      const attachments = filterImportableMessageAttachments(extractImapBodyStructureAttachments(bodyStructure)).map((item) => ({ ...item, mimeType: resolveMessageAttachmentMimeType(item) }));
      return refreshCrmDraft({ dataSource, context, accountId, parsed, previousTarget, newTarget, attachments, attachmentFieldIdentifier }); },
    async resolveFiles({ context, files }) {
      const resolved = await composer.getAttachments(files, context.workspaceId);
      if (!Array.isArray(resolved) || resolved.length !== files.length) throw new Error('Files unavailable');
      return resolved;
    },
    journal: new PostgresJournal(pool), PostalMime, MailComposer, compileBody,
  };
}
