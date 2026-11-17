export async function refreshCrmDraft({ dataSource, context, accountId, parsed }) {
  if (!context?.workspaceId || !accountId || !parsed?.messageId) return 'not_imported';
  const workspaces = await dataSource.query('SELECT "databaseSchema" FROM core.workspace WHERE id = $1', [context.workspaceId]);
  const schema = workspaces[0]?.databaseSchema;
  if (workspaces.length !== 1 || !/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(schema ?? '')) throw new Error('Workspace schema unavailable');
  return dataSource.transaction(async (manager) => {
    const messages = await manager.query(
      `SELECT m.id FROM "${schema}".message m
       WHERE m."headerMessageId" = ANY($1::text[]) AND m."isDraft" = true AND m."deletedAt" IS NULL
       AND EXISTS (
         SELECT 1 FROM "${schema}"."messageChannelMessageAssociation" a
         JOIN core."messageChannel" c ON c.id = a."messageChannelId"
         WHERE a."messageId" = m.id AND a."deletedAt" IS NULL AND c."connectedAccountId" = $2 AND c."workspaceId" = $3
       ) FOR UPDATE OF m`,
      [[parsed.messageId, parsed.messageId.replace(/^<|>$/g, '')], accountId, context.workspaceId],
    );
    if (messages.length === 0) return 'not_imported';
    if (messages.length !== 1) throw new Error('Ambiguous imported draft');
    await manager.query(
      `UPDATE "${schema}".message SET subject = $1, text = $2, "updatedAt" = now() WHERE id = $3 AND "isDraft" = true`,
      [parsed.subject ?? '', parsed.text ?? '', messages[0].id],
    );
    return 'updated';
  });
}
