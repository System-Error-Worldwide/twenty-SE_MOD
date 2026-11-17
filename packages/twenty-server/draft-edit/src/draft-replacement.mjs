import { createHash } from 'node:crypto';

const hexDigest = (buffer) => createHash('sha256').update(buffer).digest('hex');
const targetKey = (target) => JSON.stringify([target.accountId, target.folder, target.uidValidity, target.uid]);

export function validateTarget(target) {
  if (!target || typeof target.accountId !== 'string' || !target.accountId ||
      typeof target.folder !== 'string' || !target.folder ||
      !Number.isSafeInteger(target.uid) || target.uid < 1 ||
      typeof target.uidValidity !== 'string' || !/^\d+$/.test(target.uidValidity)) {
    throw new TypeError('Invalid draft target');
  }
}

function validateRevision(revision) {
  if (typeof revision !== 'string' || !/^[a-f0-9]{64}$/.test(revision)) {
    throw new TypeError('Invalid draft revision');
  }
}

export function draftRevision(source) {
  if (!Buffer.isBuffer(source) || source.length === 0) throw new TypeError('Draft source is required');
  return hexDigest(source);
}

export async function replaceDraft({ target, expectedRevision, operationId, mailbox, journal, buildSource }) {
  validateTarget(target);
  validateRevision(expectedRevision);
  if (typeof operationId !== 'string' || !/^[a-zA-Z0-9_-]{16,128}$/.test(operationId)) throw new TypeError('Invalid operation ID');
  if (!mailbox || !journal || typeof buildSource !== 'function') throw new TypeError('Missing adapter');

  const key = targetKey(target);
  const existing = await journal.claim({ operationId, targetKey: key, expectedRevision });
  if (!existing.acquired) return { status: 'recovery_required', reason: existing.reason ?? 'operation_already_started' };

  let phase = 'claimed';
  try {
    const capabilities = await mailbox.capabilities();
    if (!capabilities.uidPlus || !capabilities.conditionalDelete) {
      await journal.finish(operationId, { status: 'rejected', reason: 'unsupported_mailbox' });
      return { status: 'rejected', reason: 'unsupported_mailbox' };
    }
    const original = await mailbox.readDraft(target);
    if (!original || original.uidValidity !== target.uidValidity || !Buffer.isBuffer(original.source) ||
        !original.isDraft || typeof original.modseq !== 'string') {
      await journal.finish(operationId, { status: 'rejected', reason: 'draft_not_found_or_changed' });
      return { status: 'rejected', reason: 'draft_not_found_or_changed' };
    }
    if (draftRevision(original.source) !== expectedRevision) {
      await journal.finish(operationId, { status: 'conflict' });
      return { status: 'conflict' };
    }
    const nextSource = await buildSource(original.source);
    if (!Buffer.isBuffer(nextSource) || nextSource.length === 0) throw new TypeError('Replacement source is required');
    if (draftRevision(nextSource) === expectedRevision) {
      await journal.finish(operationId, { status: 'unchanged' });
      return { status: 'unchanged', target, revision: expectedRevision };
    }
    phase = 'appending';
    await journal.mark(operationId, { phase, target, expectedRevision });
    const added = await mailbox.appendDraft(target.folder, nextSource, original.flags);
    if (!added || added.uidValidity !== target.uidValidity || !Number.isSafeInteger(added.uid) || added.uid < 1 || added.uid === target.uid) {
      return { status: 'recovery_required', reason: 'append_identity_unknown' };
    }
    const replacement = { ...target, uid: added.uid };
    let replacementRevision = draftRevision(nextSource);
    await journal.mark(operationId, { phase: 'appended', target, replacement, expectedRevision, revision: draftRevision(nextSource) });
    phase = 'appended';
    if (Array.isArray(original.flags)) {
      const appended = await mailbox.readDraft(replacement);
      const saved = new Set((appended?.flags ?? []).map((flag) => flag.toLowerCase()));
      if (!appended?.isDraft || original.flags.some((flag) => !saved.has(flag.toLowerCase()))) return { status: 'recovery_required', reason: 'replacement_flags_missing', replacement };
      if (Buffer.isBuffer(appended.source)) replacementRevision = draftRevision(appended.source);
    }
    const deleted = await mailbox.deleteDraftIfUnchanged(target, original.modseq);
    if (!deleted) return { status: 'recovery_required', reason: 'original_changed', replacement };
    await journal.finish(operationId, { status: 'updated', replacement, revision: replacementRevision });
    return { status: 'updated', target: replacement, revision: replacementRevision };
  } catch (error) {
    if (phase === 'claimed') {
      await journal.finish(operationId, { status: 'rejected', reason: 'preparation_failed' });
      return { status: 'rejected', reason: 'preparation_failed' };
    }
    return { status: 'recovery_required', reason: phase === 'appending' ? 'append_outcome_unknown' : 'replacement_incomplete' };
  }
}
