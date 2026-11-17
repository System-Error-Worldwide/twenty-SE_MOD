import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { validateTarget } from './draft-replacement.mjs';

const returnedRows = (result) => Array.isArray(result) && result.length === 2 && Array.isArray(result[0]) && Number.isInteger(result[1]) ? result[0] : result;

export async function refreshCrmDraft({ dataSource, context, accountId, parsed, previousTarget, newTarget, attachments, attachmentFieldIdentifier }) {
  if (!context?.workspaceId || !accountId || !parsed?.messageId) return 'not_imported';
  if (!Array.isArray(attachments) || !attachmentFieldIdentifier) throw new Error('Attachment metadata unavailable');
  const partIds = new Set();
  for (const item of attachments) {
    if (!item || typeof item.externalId !== 'string' || !item.externalId || partIds.has(item.externalId) || typeof item.filename !== 'string' || !item.filename || !Number.isSafeInteger(item.size) || item.size < 0 || typeof item.mimeType !== 'string' || !item.mimeType) throw new Error('Invalid attachment metadata');
    partIds.add(item.externalId);
  }
  validateTarget(previousTarget);
  validateTarget(newTarget);
  if (previousTarget.accountId !== accountId || newTarget.accountId !== accountId || previousTarget.folder !== newTarget.folder || previousTarget.uidValidity !== newTarget.uidValidity || previousTarget.uid === newTarget.uid) throw new Error('Invalid replacement identity');
  const workspaces = await dataSource.query('SELECT "databaseSchema" FROM core.workspace WHERE id = $1', [context.workspaceId]);
  const schema = workspaces[0]?.databaseSchema;
  if (workspaces.length !== 1 || !/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(schema ?? '')) throw new Error('Workspace schema unavailable');
  return dataSource.transaction(async (manager) => {
    const messages = await manager.query(
      `SELECT m.id, a.id AS "associationId", a."messageExternalId" FROM "${schema}".message m
       JOIN "${schema}"."messageChannelMessageAssociation" a ON a."messageId" = m.id AND a."deletedAt" IS NULL
       JOIN core."messageChannel" c ON c.id = a."messageChannelId"
       WHERE m."headerMessageId" = ANY($1::text[]) AND m."isDraft" = true AND m."deletedAt" IS NULL
       AND c."connectedAccountId" = $2 AND c."workspaceId" = $3 FOR UPDATE OF m, a`,
      [[parsed.messageId, parsed.messageId.replace(/^<|>$/g, '')], accountId, context.workspaceId],
    );
    if (messages.length === 0) return 'not_imported';
    if (messages.length !== 1) throw new Error('Ambiguous imported draft');
    const oldExternalId = `${previousTarget.folder}:${previousTarget.uid}`;
    const newExternalId = `${newTarget.folder}:${newTarget.uid}`;
    if (messages[0].messageExternalId !== oldExternalId) throw new Error('Imported draft identity changed');
    const updatedAssociation = await manager.query(
      `UPDATE "${schema}"."messageChannelMessageAssociation" SET "messageExternalId" = $1, "updatedAt" = now() WHERE id = $2 AND "messageExternalId" = $3 AND "deletedAt" IS NULL RETURNING id`,
      [newExternalId, messages[0].associationId, oldExternalId],
    );
    if (returnedRows(updatedAssociation).length !== 1) throw new Error('Imported draft identity changed');
    await manager.query(`LOCK TABLE "${schema}".attachment IN SHARE ROW EXCLUSIVE MODE`);
    const existing = await manager.query(
      `SELECT a.id, a.file, f.id AS "fileId" FROM "${schema}".attachment a
       JOIN LATERAL jsonb_array_elements(a.file) item ON true
       JOIN core.file f ON f.id::text = item->>'fileId' AND f."workspaceId" = $2
       WHERE a."targetMessageId" = $1 AND a."deletedAt" IS NULL AND f.status = 'REMOTE'
         AND f."remoteOrigin"->>'originType' = 'MESSAGE' AND f."remoteOrigin"->>'originId' = $3
       FOR UPDATE OF a`, [messages[0].id, context.workspaceId, messages[0].associationId],
    );
    if (existing.some((row) => !Array.isArray(row.file) || row.file.length !== 1) || new Set(existing.map((row) => row.id)).size !== existing.length) throw new Error('Ambiguous attachment ownership');
    if (attachments.length) {
      const metadata = await manager.query(
        `SELECT "applicationId", "universalIdentifier" FROM core."fieldMetadata" WHERE "workspaceId" = $1 AND "universalIdentifier" = $2`,
        [context.workspaceId, attachmentFieldIdentifier],
      );
      if (metadata.length !== 1 || !metadata[0].applicationId || !metadata[0].universalIdentifier) throw new Error('Attachment field unavailable');
      for (const item of attachments) {
        const fileId = randomUUID();
        const suffix = extname(item.filename).slice(1).toLowerCase();
        const extension = /^[a-z0-9]{1,16}$/.test(suffix) ? suffix : 'bin';
        const path = `files-field/${metadata[0].universalIdentifier}/${fileId}.${extension}`;
        const origin = { originType: 'MESSAGE', originId: messages[0].associationId, originKey: item.externalId };
        await manager.query(`INSERT INTO core.file (id, path, size, "workspaceId", "applicationId", "mimeType", settings, "remoteOrigin", status) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,'REMOTE')`,
          [fileId, path, item.size, context.workspaceId, metadata[0].applicationId, item.mimeType, JSON.stringify({ isTemporaryFile: false, toDelete: false }), JSON.stringify(origin)]);
        await manager.query(`INSERT INTO "${schema}".attachment (id, name, file, "targetMessageId") VALUES ($1,$2,$3::jsonb,$4)`,
          [randomUUID(), item.filename, JSON.stringify([{ fileId, label: item.filename, extension }]), messages[0].id]);
      }
    }
    if (existing.length) {
      const attachmentIds = existing.map((row) => row.id);
      const fileIds = existing.map((row) => row.fileId);
      if (fileIds.some((id) => !id) || new Set(fileIds).size !== fileIds.length) throw new Error('Ambiguous attachment file ownership');
      const invalidated = await manager.query(
        `UPDATE core.file f SET "deletedAt" = now(), "updatedAt" = now()
         WHERE f.id = ANY($1::uuid[]) AND f."workspaceId" = $2 AND f."deletedAt" IS NULL AND f.status = 'REMOTE'
           AND f."remoteOrigin"->>'originType' = 'MESSAGE' AND f."remoteOrigin"->>'originId' = $3
           AND NOT EXISTS (SELECT 1 FROM "${schema}".attachment other
             WHERE other."deletedAt" IS NULL AND NOT (other.id = ANY($4::uuid[]))
               AND other.file @> jsonb_build_array(jsonb_build_object('fileId', f.id::text)))
         RETURNING f.id`,
        [fileIds, context.workspaceId, messages[0].associationId, attachmentIds],
      );
      if (returnedRows(invalidated).length !== fileIds.length) throw new Error('Attachment file is shared or unavailable');
      await manager.query(`UPDATE "${schema}".attachment SET "deletedAt" = now(), "updatedAt" = now() WHERE id = ANY($1::uuid[]) AND "deletedAt" IS NULL`, [attachmentIds]);
    }
    await manager.query(
      `UPDATE "${schema}".message SET subject = $1, text = $2, "updatedAt" = now() WHERE id = $3 AND "isDraft" = true`,
      [parsed.subject ?? '', parsed.text ?? '', messages[0].id],
    );
    return 'updated';
  });
}
