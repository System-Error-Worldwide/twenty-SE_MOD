import { resolveDraftTarget } from './resolve-draft-target.mjs';

export function createSaveDraftControl(React) {
  return function SaveDraftControl({ accountId, messageId, initialSubject, initialText, callTool, getChanges, onSaved, makeOperationId = () => crypto.randomUUID() }) {
    const [state, setState] = React.useState({ status: 'checking' });
    const busy = React.useRef(false);
    React.useEffect(() => {
      let active = true;
      setState({ status: 'checking' });
      (async () => {
        try {
          const listed = await callTool('list_email_drafts', { accountId });
          if (!listed?.success) throw new Error('Could not list drafts');
          const target = resolveDraftTarget(listed.result, messageId);
          const inspected = await callTool('inspect_email_draft', { target });
          if (!inspected?.success) throw new Error('Could not inspect draft');
          const text = (value) => (value ?? '').replace(/\r\n/g, '\n').trimEnd();
          if (inspected.result.subject !== initialSubject || text(inspected.result.text) !== text(initialText)) throw new Error('The mailbox draft differs from the displayed draft. Reopen it before editing.');
          if (active) setState({ status: 'ready', target, revision: inspected.result.revision });
        } catch (error) { if (active) setState({ status: 'error', message: error.message }); }
      })();
      return () => { active = false; };
    }, [accountId, messageId, initialSubject, initialText, callTool]);

    const save = async () => {
      if (busy.current || state.status !== 'ready') return;
      busy.current = true;
      try {
        const changes = getChanges();
        if (!changes || changes.recipientsChanged || changes.senderChanged) throw new Error('Changing sender or recipients is not supported by Save draft.');
        const { recipientsChanged, senderChanged, ...allowedChanges } = changes;
        setState({ ...state, status: 'saving' });
        const result = await callTool('update_email_draft', { target: state.target, expectedRevision: state.revision, operationId: makeOperationId(), changes: allowedChanges });
        if (!result?.success) {
          const status = result?.result?.status;
          if (status === 'recovery_required') throw new Error('Save outcome needs recovery. Do not retry until the mailbox is checked.');
          if (status === 'conflict') throw new Error('The draft changed elsewhere. Reopen it before editing.');
          throw new Error('The draft could not be saved.');
        }
        setState({ status: 'saved' });
        onSaved?.(result.result);
      } catch (error) { setState({ status: 'error', message: error.message }); }
      finally { busy.current = false; }
    };
    return React.createElement(React.Fragment, null,
      React.createElement('button', { type: 'button', onClick: save, disabled: state.status !== 'ready' }, state.status === 'saving' ? 'Saving draft…' : 'Save draft'),
      state.status === 'checking' && React.createElement('span', { role: 'status' }, 'Checking draft…'),
      state.status === 'saved' && React.createElement('span', { role: 'status' }, 'Draft saved'),
      state.status === 'error' && React.createElement('span', { role: 'alert' }, state.message),
    );
  };
}
