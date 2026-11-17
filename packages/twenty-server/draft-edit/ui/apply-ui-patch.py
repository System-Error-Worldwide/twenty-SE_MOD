import pathlib
import shutil
import subprocess
import sys

if len(sys.argv) != 3 or sys.argv[1] != '--apply':
    raise SystemExit('Usage: apply-ui-patch.py --apply SOURCE_ROOT')
root = pathlib.Path(sys.argv[2]).resolve()
head = subprocess.check_output(['git', '-C', str(root), 'rev-parse', 'HEAD'], text=True).strip()
if head != 'bd8ab939f0e238b5faeefcbeb897ecd6862b1a59':
    raise SystemExit('Unsupported Twenty source revision')
base = root / 'packages/twenty-front/src/modules'

def replace(path, before, after):
    text = path.read_text()
    if text.count(before) != 1:
        raise SystemExit(f'Patch anchor is not unique: {path.name}')
    path.write_text(text.replace(before, after, 1))

prefill = base / 'activities/emails/types/EmailDraftPrefill.ts'
replace(prefill, '  messageId: string;\n', '  messageId: string;\n  headerMessageId?: string;\n  rawText?: string;\n  rawFrom?: string;\n')
util = base / 'activities/emails/utils/getEmailDraftPrefillFromMessage.ts'
replace(util, "    messageParticipants: Pick<", "    headerMessageId?: string;\n    messageParticipants: Pick<")
replace(util, '    messageId: message.id,\n', '    messageId: message.id,\n    headerMessageId: message.headerMessageId,\n    rawText: message.text,\n')
replace(util, '    to: joinRecipientsByRole(MessageParticipantRole.TO),\n', '    rawFrom: joinRecipientsByRole(MessageParticipantRole.FROM),\n    to: joinRecipientsByRole(MessageParticipantRole.TO),\n')
hook = base / 'activities/emails/hooks/useSaveExistingDraft.ts'
if hook.exists():
    raise SystemExit('Save draft hook already exists')
shutil.copyfile(pathlib.Path(__file__).with_name('useSaveExistingDraft.ts.template'), hook)
hook_test = base / 'activities/emails/hooks/__tests__/useSaveExistingDraft.test.tsx'
if hook_test.exists():
    raise SystemExit('Save draft test already exists')
shutil.copyfile(pathlib.Path(__file__).with_name('useSaveExistingDraft.test.tsx.template'), hook_test)
component = base / 'page-layout/widgets/email-thread/components/EmailThreadComposer.tsx'
replace(component, "import { useEmailComposerState } from '@/activities/emails/hooks/useEmailComposerState';", "import { useEmailComposerState } from '@/activities/emails/hooks/useEmailComposerState';\nimport { useSaveExistingDraft } from '@/activities/emails/hooks/useSaveExistingDraft';\nimport { useApolloCoreClient } from '@/object-metadata/hooks/useApolloCoreClient';")
replace(component, '  IconArrowBackUp,\n', '  IconArrowBackUp,\n  IconDeviceFloppy,\n')
replace(component, '  const { t } = useLingui();\n', '  const { t } = useLingui();\n  const apolloCoreClient = useApolloCoreClient();\n')
replace(component, '  const { handleSend, canSend } = composerState;\n', '''  const handleDraftSaved = useCallback(() => {
    setIsComposerOpen(false);
    void apolloCoreClient.refetchQueries({ include: ['FindManyMessages', 'FindManyMessageParticipants', 'FindManyMessageChannelMessageAssociations'] });
  }, [apolloCoreClient, setIsComposerOpen]);
  const draftSave = useSaveExistingDraft({
    draftPrefill, composer: composerState, initialAccountId: replyContext.connectedAccountId,
    isOpen: isComposerOpen && Boolean(draftPrefill), onSaved: handleDraftSaved,
  });

  const { handleSend, canSend } = composerState;
''')
replace(component, '    if (!isInSidePanel) {\n      return [cancelReplyCommandMenuItem, sendCommandMenuItem];\n    }', '''    const saveDraftCommandMenuItem: WidgetCommandMenuItem = {
      id: 'save-draft', label: 'Save draft', Icon: IconDeviceFloppy,
      isPinned: true, onClick: draftSave.handleSave,
      disabled: !draftSave.canSave || isUploadingAttachments,
      replacedEngineComponentKey: EngineComponentKey.REPLY_TO_EMAIL_THREAD,
    };

    if (!isInSidePanel) {
      return [cancelReplyCommandMenuItem, ...(draftPrefill ? [saveDraftCommandMenuItem] : []), sendCommandMenuItem];
    }''')
replace(component, '      sendCommandMenuItem,\n    ];', '      ...(draftPrefill ? [saveDraftCommandMenuItem] : []),\n      sendCommandMenuItem,\n    ];')
replace(component, '    openAttachmentPicker,\n    t,\n', '    openAttachmentPicker,\n    draftPrefill,\n    draftSave.handleSave,\n    draftSave.canSave,\n    isUploadingAttachments,\n    t,\n')
replace(component, '        <StyledComposerContainer>\n', '''        <StyledComposerContainer>
          {draftPrefill && draftSave.error && <div role="alert">{draftSave.error}</div>}
          {draftPrefill && draftSave.formattingMayChange && <div role="status">Saving edited text may change the original formatting.</div>}
''')
