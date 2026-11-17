import { useCallback, useEffect, useRef, useState } from 'react';
import { useToast } from 'twenty-ui/components/feedback';
import { v4 } from 'uuid';
import { SESSION_COOKIE_OPT_IN_HEADER_NAME } from 'twenty-shared/constants';

import { type EmailComposerState } from '@/activities/emails/types/EmailComposerState';
import { type EmailDraftPrefill } from '@/activities/emails/types/EmailDraftPrefill';
import { serializeEmailRecipients } from '@/activities/emails/recipients/utils/serializeEmailRecipients';
import { parseEmailRecipients } from '@/activities/emails/recipients/utils/parseEmailRecipients';
import { REACT_APP_SERVER_BASE_URL } from '~/config';

type DraftTarget = { accountId: string; folder: string; uidValidity: string; uid: number };
type DraftList = { drafts: { headerMessageId: string | null; target: DraftTarget }[]; truncated: boolean };
type DraftInspection = { revision: string; subject: string; text?: string; html?: string; recipients: { from: string[]; to: string[]; cc: string[]; bcc: string[] } };
type ToolResponse<T> = { success: boolean; message: string; result?: T; error?: string };
type DraftUpdate = { status: string; target?: DraftTarget; revision?: string };

const callDraftTool = async <T,>(name: string, args: object): Promise<ToolResponse<T>> => {
  const response = await fetch(new URL('/mcp', REACT_APP_SERVER_BASE_URL), {
    method: 'POST', credentials: 'include',
    headers: { 'content-type': 'application/json', accept: 'application/json', [SESSION_COOKIE_OPT_IN_HEADER_NAME]: '1' },
    body: JSON.stringify({ jsonrpc: '2.0', id: v4(), method: 'tools/call', params: { name, arguments: args } }),
  });
  if (!response.ok) throw new Error('Draft service unavailable');
  const payload = await response.json();
  if (payload.error || !payload.result?.content?.[0]?.text) throw new Error('Draft service unavailable');
  return JSON.parse(payload.result.content[0].text) as ToolResponse<T>;
};

type DraftReady = { target: DraftTarget; revision: string; originalHtml: boolean };

export const useSaveExistingDraft = ({ draftPrefill, composer, initialAccountId, isOpen, onSaved }: {
  draftPrefill?: EmailDraftPrefill | null;
  composer: EmailComposerState;
  initialAccountId: string;
  isOpen: boolean;
  onSaved: () => void;
}) => {
  const { enqueueToast } = useToast();
  const [ready, setReady] = useState<DraftReady | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const draftId = draftPrefill?.headerMessageId;
  const draftSubject = draftPrefill?.subject;
  const draftText = draftPrefill?.rawText;
  const draftFrom = draftPrefill?.rawFrom;
  const draftTo = draftPrefill?.to;
  const draftCc = draftPrefill?.cc;
  const draftBcc = draftPrefill?.bcc;

  useEffect(() => {
    let active = true;
    setReady(null); setError(null);
    if (!isOpen) return () => { active = false; };
    const prepare = async () => {
      try {
        if (!draftId) throw new Error('Draft identity unavailable');
        const list = await callDraftTool<DraftList>('list_email_drafts', { accountId: initialAccountId });
        if (!list.success || !list.result || list.result.truncated) throw new Error('Draft list unavailable or incomplete');
        const matches = list.result.drafts.filter((draft) => draft.headerMessageId === draftId);
        if (matches.length !== 1) throw new Error('Draft identity is missing or ambiguous');
        const target = matches[0].target;
        const inspected = await callDraftTool<DraftInspection>('inspect_email_draft', { target });
        if (!inspected.success || !inspected.result) throw new Error('Draft unavailable');
        const normal = (value?: string) => (value ?? '').replace(/\r\n/g, '\n').trimEnd();
        if (inspected.result.subject !== draftSubject || normal(inspected.result.text) !== normal(draftText)) throw new Error('The mailbox draft differs from the displayed draft. Reopen it before saving.');
        const addresses = (value?: string) => parseEmailRecipients(value ?? '').map(({ address }) => address.trim().toLowerCase()).sort();
        const actual = inspected.result.recipients;
        if (!actual || !draftFrom || (['from', 'to', 'cc', 'bcc'] as const).some((key) => JSON.stringify(actual[key]) !== JSON.stringify(addresses({ from: draftFrom, to: draftTo, cc: draftCc, bcc: draftBcc }[key])))) throw new Error('The mailbox sender or recipients differ from the displayed draft. Reopen it before saving.');
        if (active) setReady({ target, revision: inspected.result.revision, originalHtml: Boolean(inspected.result.html) });
      } catch (caught) {
        if (active) setError(caught instanceof Error ? caught.message : 'Draft unavailable');
      }
    };
    void prepare();
    return () => { active = false; };
  }, [isOpen, draftId, draftSubject, draftText, draftFrom, draftTo, draftCc, draftBcc, initialAccountId]);

  const handleSave = useCallback(async () => {
    if (!ready || !draftPrefill || busy.current) return;
    busy.current = true; setSaving(true); setError(null);
    try {
      const normalize = (value: string) => serializeEmailRecipients(parseEmailRecipients(value));
      const recipientsChanged = serializeEmailRecipients(composer.to) !== normalize(draftPrefill.to) ||
        serializeEmailRecipients(composer.cc) !== normalize(draftPrefill.cc) || serializeEmailRecipients(composer.bcc) !== normalize(draftPrefill.bcc);
      if (recipientsChanged || composer.connectedAccountId !== initialAccountId || composer.fromHandle) throw new Error('Saving changes to sender or recipients is not supported.');
      const changes: { subject?: string; body?: { document: string }; addFiles?: typeof composer.files } = {};
      if (composer.subject !== draftPrefill.subject) changes.subject = composer.subject;
      if (composer.body !== draftPrefill.body) changes.body = { document: composer.body };
      if (composer.files.length) changes.addFiles = composer.files;
      if (!Object.keys(changes).length) { enqueueToast({ status: 'info', children: 'No draft changes to save' }); return; }
      const updated = await callDraftTool<DraftUpdate>('update_email_draft', { target: ready.target, expectedRevision: ready.revision, operationId: v4(), changes });
      if (!updated.success || !updated.result) {
        if (updated.result?.status === 'conflict') throw new Error('The draft changed elsewhere. Reopen it before saving.');
        if (updated.result?.status === 'recovery_required') throw new Error('Save needs recovery. Do not retry until the mailbox is checked.');
        throw new Error('The draft could not be saved.');
      }
      setReady(null);
      enqueueToast({ status: 'success', children: 'Draft saved' });
      onSaved();
    } catch (caught) {
      setReady(null);
      setError(caught instanceof Error ? caught.message : 'Draft could not be saved');
    } finally { busy.current = false; setSaving(false); }
  }, [ready, draftPrefill, composer, initialAccountId, enqueueToast, onSaved]);

  return { handleSave, canSave: Boolean(ready) && !saving, error, formattingMayChange: Boolean(ready?.originalHtml && composer.body !== draftPrefill?.body) };
};
