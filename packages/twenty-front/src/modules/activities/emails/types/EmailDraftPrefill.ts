import { type EmailRecipients } from 'twenty-shared/workflow';

export type EmailDraftPrefill = EmailRecipients & {
  messageId: string;
  headerMessageId?: string;
  rawText?: string;
  rawFrom?: string;
  subject: string;
  body: string;
};
