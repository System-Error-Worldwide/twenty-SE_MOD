export function makeDraftTools(z, service) {
  const target = z.object({
    accountId: z.string().uuid(), folder: z.string().min(1).max(1024),
    uidValidity: z.string().regex(/^\d+$/).max(32), uid: z.number().int().positive().safe(),
  }).strict();
  const listSchema = z.object({ accountId: z.string().uuid() }).strict();
  const inspectSchema = z.object({ target }).strict();
  const editSchema = z.object({
    target, expectedRevision: z.string().regex(/^[a-f0-9]{64}$/),
    operationId: z.string().regex(/^[a-zA-Z0-9_-]{16,128}$/),
    changes: z.object({
      subject: z.string().max(998).optional(),
      body: z.union([z.object({ text: z.string().max(2000000), html: z.string().max(4000000).optional() }).strict(), z.object({ document: z.string().max(2000000) }).strict()]).optional(),
      files: z.array(z.object({ id: z.string().uuid(), name: z.string().min(1).max(255) }).strict()).max(50).optional(),
      addFiles: z.array(z.object({ id: z.string().uuid(), name: z.string().min(1).max(255) }).strict()).max(50).optional(),
    }).strict().refine((value) => Object.keys(value).length > 0 && !(value.files && value.addFiles)),
  }).strict();
  return {
    list_email_drafts: {
      description: 'List up to 100 recent mailbox drafts with identifiers for inspecting and updating them.',
      inputSchema: listSchema,
      async execute(parameters, context) {
        try {
          const result = await service.list({ context, ...listSchema.parse(parameters) });
          return { success: true, message: 'Drafts listed', result };
        } catch { return { success: false, message: 'Drafts could not be listed', error: 'Mailbox is unavailable or access is denied.' }; }
      },
    },
    inspect_email_draft: {
      description: 'Read an existing draft by connected account, drafts folder, UID validity and UID, including its revision and attachment names.',
      inputSchema: inspectSchema,
      async execute(parameters, context) {
        try {
          const result = await service.inspect({ context, ...inspectSchema.parse(parameters) });
          return { success: true, message: 'Draft inspected', result };
        } catch { return { success: false, message: 'Draft could not be inspected', error: 'Draft is unavailable or access is denied.' }; }
      },
    },
    update_email_draft: {
      description: 'Update one existing draft using its expected revision. Omit files to preserve attachments; pass files to replace them. Never sends email.',
      inputSchema: editSchema,
      async execute(parameters, context) {
        try {
          const result = await service.edit({ context, ...editSchema.parse(parameters) });
          return { success: ['updated', 'unchanged'].includes(result.status), message: result.status, result };
        } catch { return { success: false, message: 'Draft could not be updated', error: 'Draft, files or access are unavailable, or the request is invalid.' }; }
      },
    },
  };
}
