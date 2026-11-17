import { DraftEditService } from './draft-edit-service.mjs';
import { makeDraftTools } from './draft-tools.mjs';
import { createTwentyBindings } from './twenty-bindings.mjs';
import { registerDraftTools } from './twenty-tool-registration.mjs';

export async function installTwentyDraftEditing({ provider, z, PostalMime, MailComposer, EmailOperation, PermissionFlagType, getStandardFolderByRegex, StandardFolder, convertEmailBodyToEmailDocument, compileOutboundEmailContent, extractImapBodyStructureAttachments, filterImportableMessageAttachments, resolveMessageAttachmentMimeType, attachmentFieldIdentifier }) {
  const composer = provider?.draftEmailTool?.emailComposerService;
  const imap = provider?.draftEmailTool?.messageOutboundService?.imapSmtpMessageOutboundService?.imapClientProvider;
  const accounts = provider?.findConnectedAccountsTool?.connectedAccountMetadataService;
  const dataSource = composer?.connectedAccountRepository?.manager?.connection;
  if (!composer || !imap || !accounts || !dataSource) throw new Error('Twenty v2.58.0 dependencies unavailable');
  const probe = await dataSource.query("SELECT to_regclass('draft_edit_operation') IS NOT NULL AS ready");
  if (probe.length !== 1 || probe[0].ready !== true) throw new Error('Draft operation journal is not installed');
  const bindings = createTwentyBindings({ accounts, imap, composer, dataSource, emailOperationDraft: EmailOperation.DRAFT, getStandardFolder: getStandardFolderByRegex, draftsStandard: StandardFolder.DRAFTS, PostalMime, MailComposer, extractImapBodyStructureAttachments, filterImportableMessageAttachments, resolveMessageAttachmentMimeType, attachmentFieldIdentifier, compileBody: async (body) => { const parsed = convertEmailBodyToEmailDocument(body); if (!parsed.success) throw new Error('Invalid email document'); const result = await compileOutboundEmailContent(parsed.document); return { text: result.plainText, html: result.html }; } });
  const tools = makeDraftTools(z, new DraftEditService(bindings));
  registerDraftTools({ provider, tools, emailPermissionFlag: PermissionFlagType.SEND_EMAIL_TOOL });
  return tools;
}
