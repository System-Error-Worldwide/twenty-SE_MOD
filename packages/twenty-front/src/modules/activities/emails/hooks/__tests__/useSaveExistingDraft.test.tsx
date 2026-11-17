import { act, renderHook, waitFor } from '@testing-library/react';
import { useSaveExistingDraft } from '@/activities/emails/hooks/useSaveExistingDraft';
import { type EmailComposerState } from '@/activities/emails/types/EmailComposerState';
import { SESSION_COOKIE_OPT_IN_HEADER_NAME } from 'twenty-shared/constants';

jest.mock('@lingui/core/macro', () => ({
  t: (parts: TemplateStringsArray) => parts.join(''),
}));

const mockToast = jest.fn();
jest.mock(
  'twenty-ui/components/feedback',
  () => ({ useToast: () => ({ enqueueToast: mockToast }) }),
  { virtual: true },
);
jest.mock('~/config', () => ({
  REACT_APP_SERVER_BASE_URL: 'http://localhost:3000',
}));

const target = {
  accountId: 'account',
  folder: 'Drafts',
  uidValidity: '1',
  uid: 3,
};
const prefill = {
  messageId: 'record',
  headerMessageId: '<id@example.invalid>',
  rawText: 'Before',
  rawFrom: 'sender@example.invalid',
  subject: 'Funding',
  body: 'before-document',
  to: '',
  cc: '',
  bcc: '',
};
const recipients = {
  from: ['sender@example.invalid'],
  to: [],
  cc: [],
  bcc: [],
};
const composer = {
  connectedAccountId: 'account',
  fromHandle: undefined,
  to: [],
  cc: [],
  bcc: [],
  subject: 'Funding',
  body: 'after-document',
  files: [{ id: 'file', name: 'new.pdf' }],
} as unknown as EmailComposerState;
const reply = (result: unknown) =>
  Promise.resolve({
    ok: true,
    json: async () => ({
      result: { content: [{ text: JSON.stringify(result) }] },
    }),
  });

beforeEach(() => {
  jest.clearAllMocks();
});

test.each([false, true])(
  'saves with optional recipient fields omitted=%s and adds attachments without sending',
  async (omitOptionalRecipients) => {
    const calls: string[] = [];
    global.fetch = jest.fn((_, options) => {
      expect(options?.credentials).toBe('include');
      expect(options?.headers).toEqual(
        expect.objectContaining({ [SESSION_COOKIE_OPT_IN_HEADER_NAME]: '1' }),
      );
      const payload = JSON.parse(options?.body as string);
      calls.push(payload.params.name);
      if (payload.params.name === 'list_email_drafts')
        return reply({
          success: true,
          result: {
            drafts: [{ target, headerMessageId: prefill.headerMessageId }],
            truncated: false,
          },
        }) as Promise<Response>;
      if (payload.params.name === 'inspect_email_draft')
        return reply({
          success: true,
          result: {
            subject: 'Funding',
            text: 'Before',
            revision: 'a'.repeat(64),
            recipients,
          },
        }) as Promise<Response>;
      expect(payload.params.arguments.changes).toEqual({
        body: { document: 'after-document' },
        addFiles: [{ id: 'file', name: 'new.pdf' }],
      });
      expect(payload.params.arguments.expectedRevision).toBe('a'.repeat(64));
      return reply({
        success: true,
        result: { status: 'updated' },
      }) as Promise<Response>;
    }) as jest.Mock;
    const onSaved = jest.fn();
    const { result } = renderHook(() =>
      useSaveExistingDraft({
        draftPrefill: omitOptionalRecipients
          ? { ...prefill, cc: undefined, bcc: undefined }
          : prefill,
        composer,
        initialAccountId: 'account',
        isOpen: true,
        onSaved,
      }),
    );
    await waitFor(() => expect(result.current.canSave).toBe(true));
    await act(async () => {
      await result.current.handleSave();
    });
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([
      'list_email_drafts',
      'inspect_email_draft',
      'update_email_draft',
    ]);
  },
);

test('rejects ambiguous draft identity before editing', async () => {
  global.fetch = jest.fn(
    () =>
      reply({
        success: true,
        result: {
          drafts: [
            { target, headerMessageId: prefill.headerMessageId },
            { target, headerMessageId: prefill.headerMessageId },
          ],
          truncated: false,
        },
      }) as Promise<Response>,
  ) as jest.Mock;
  const { result } = renderHook(() =>
    useSaveExistingDraft({
      draftPrefill: prefill,
      composer,
      initialAccountId: 'account',
      isOpen: true,
      onSaved: jest.fn(),
    }),
  );
  await waitFor(() => expect(result.current.error).toMatch(/ambiguous/));
  expect(result.current.canSave).toBe(false);
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

test('refuses to overwrite when the displayed draft is stale', async () => {
  global.fetch = jest.fn((_, options) => {
    const payload = JSON.parse(options?.body as string);
    if (payload.params.name === 'list_email_drafts')
      return reply({
        success: true,
        result: {
          drafts: [{ target, headerMessageId: prefill.headerMessageId }],
          truncated: false,
        },
      }) as Promise<Response>;
    return reply({
      success: true,
      result: {
        subject: 'Funding',
        text: 'Changed elsewhere',
        revision: 'b'.repeat(64),
      },
    }) as Promise<Response>;
  }) as jest.Mock;
  const { result } = renderHook(() =>
    useSaveExistingDraft({
      draftPrefill: prefill,
      composer,
      initialAccountId: 'account',
      isOpen: true,
      onSaved: jest.fn(),
    }),
  );
  await waitFor(() => expect(result.current.error).toMatch(/differs/));
  expect(result.current.canSave).toBe(false);
  expect(global.fetch).toHaveBeenCalledTimes(2);
});

test('refuses a stale recipient even if subject and text match', async () => {
  global.fetch = jest.fn((_, options) => {
    const payload = JSON.parse(options?.body as string);
    if (payload.params.name === 'list_email_drafts')
      return reply({
        success: true,
        result: {
          drafts: [{ target, headerMessageId: prefill.headerMessageId }],
          truncated: false,
        },
      }) as Promise<Response>;
    return reply({
      success: true,
      result: {
        subject: 'Funding',
        text: 'Before',
        revision: 'a'.repeat(64),
        recipients: { ...recipients, to: ['other@example.invalid'] },
      },
    }) as Promise<Response>;
  }) as jest.Mock;
  const { result } = renderHook(() =>
    useSaveExistingDraft({
      draftPrefill: prefill,
      composer,
      initialAccountId: 'account',
      isOpen: true,
      onSaved: jest.fn(),
    }),
  );
  await waitFor(() =>
    expect(result.current.error).toMatch(/sender or recipients differ/),
  );
  expect(result.current.canSave).toBe(false);
  expect(global.fetch).toHaveBeenCalledTimes(2);
});

test('does not send or save unsupported recipient changes', async () => {
  global.fetch = jest.fn((_, options) => {
    const payload = JSON.parse(options?.body as string);
    if (payload.params.name === 'list_email_drafts')
      return reply({
        success: true,
        result: {
          drafts: [{ target, headerMessageId: prefill.headerMessageId }],
          truncated: false,
        },
      }) as Promise<Response>;
    return reply({
      success: true,
      result: {
        subject: 'Funding',
        text: 'Before',
        revision: 'a'.repeat(64),
        recipients,
      },
    }) as Promise<Response>;
  }) as jest.Mock;
  const changed = {
    ...composer,
    to: [{ address: 'other@example.invalid' }],
  } as EmailComposerState;
  const { result } = renderHook(() =>
    useSaveExistingDraft({
      draftPrefill: prefill,
      composer: changed,
      initialAccountId: 'account',
      isOpen: true,
      onSaved: jest.fn(),
    }),
  );
  await waitFor(() => expect(result.current.canSave).toBe(true));
  await act(async () => {
    await result.current.handleSave();
  });
  expect(result.current.error).toMatch(/recipients/);
  expect(global.fetch).toHaveBeenCalledTimes(2);
});
