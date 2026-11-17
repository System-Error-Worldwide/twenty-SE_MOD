import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveDraftTarget } from '../src/resolve-draft-target.mjs';

test('resolves one exact message ID', () => {
  const target = { uid: 3 };
  assert.equal(resolveDraftTarget({ drafts: [{ headerMessageId: '<one@example.invalid>', target }], truncated: false }, '<one@example.invalid>'), target);
});
test('rejects missing, duplicate and incomplete results', () => {
  const draft = { headerMessageId: '<same@example.invalid>', target: { uid: 3 } };
  assert.throws(() => resolveDraftTarget({ drafts: [draft, draft], truncated: false }, draft.headerMessageId), /ambiguous/);
  assert.throws(() => resolveDraftTarget({ drafts: [], truncated: false }, draft.headerMessageId), /ambiguous/);
  assert.throws(() => resolveDraftTarget({ drafts: [draft], truncated: true }, draft.headerMessageId), /complete/);
});
