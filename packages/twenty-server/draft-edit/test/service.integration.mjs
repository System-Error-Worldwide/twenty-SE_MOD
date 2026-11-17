import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { DraftEditService } from '../src/draft-edit-service.mjs';
import { PostgresJournal } from '../src/postgres-journal.mjs';
import { makeDraftTools } from '../src/draft-tools.mjs';
import { createTwentyBindings } from '../src/twenty-bindings.mjs';
import { installTwentyDraftEditing } from '../src/twenty-bootstrap.mjs';

const require = createRequire('/app/package.json');
const { ImapFlow } = require('imapflow');
const { Pool } = require('pg');
const { DataSource } = require('typeorm');
const PostalMime = require('postal-mime');
const MailComposer = require('nodemailer/lib/mail-composer');
const { z } = require('zod');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
require('reflect-metadata');
const { ConnectedAccountMetadataService } = require('/app/packages/twenty-server/dist/engine/metadata-modules/connected-account/connected-account-metadata.service.js');
const { EmailComposerService } = require('/app/packages/twenty-server/dist/engine/core-modules/tool/tools/email-tool/email-composer.service.js');
const { ActionToolProvider } = require('/app/packages/twenty-server/dist/engine/core-modules/tool-provider/providers/action-tool.provider.js');
const { PermissionFlagType } = require('twenty-shared/constants');
const config = { host: '127.0.0.1', port: 31143, secure: false, auth: { user: 'test', pass: 'test-only' }, tls: { rejectUnauthorized: false }, logger: false };
const pool = new Pool({ host: '127.0.0.1', port: 5432, database: 'draft_test', user: 'draft_test', password: 'test-only' });
const typeorm = new DataSource({ type: 'postgres', host: '127.0.0.1', database: 'draft_test', username: 'draft_test', password: 'test-only' });
await typeorm.initialize();
const seed = new ImapFlow(config); await seed.connect();
try {
  await pool.query(await readFile('/work/sql/draft-edit-journal.sql', 'utf8'));
  const folder = `ServiceTest-${randomUUID()}`; await seed.mailboxCreate(folder);
  const firstPdf = Buffer.from('%PDF-1.4\noriginal\n%%EOF');
  const nextPdf = Buffer.from('%PDF-1.4\nupdated\n%%EOF');
  const raw = await new MailComposer({ from: 'test@example.invalid', to: 'lead@example.invalid', subject: 'Original', text: 'Before', attachments: [{ filename: 'DE.pdf', content: firstPdf, contentType: 'application/pdf' }] }).compile().build();
  const appended = await seed.append(folder, raw, ['\\Draft']);
  const accountId = '00000000-0000-4000-8000-000000000001';
  const pdfId = '00000000-0000-4000-8000-000000000002';
  const target = { accountId, folder, uidValidity: String(appended.uidValidity), uid: appended.uid };
  const context = { workspaceId: 'workspace-1', userWorkspaceId: 'user-1', authContext: { type: 'user', allow: true, workspaceMemberId: 'member-1' } };
  const accountRepository = { async find({ where }) {
    return where.workspaceId === 'workspace-1' ? [{ id: accountId, provider: 'imap_smtp_caldav', scope: 'USER', userWorkspaceId: 'user-1', connectionParameters: { IMAP: {} } }] : [];
  } };
  const fileRepository = { async find(workspaceId, options) {
    return workspaceId === 'workspace-1' && options.where.id.value.includes(pdfId) ? [{ id: pdfId, size: nextPdf.length }] : [];
  } };
  const fileService = { async getFileStreamById({ workspaceId, fileId }) {
    return workspaceId === 'workspace-1' && fileId === pdfId ? { stream: Readable.from([nextPdf]), mimeType: 'application/pdf' } : null;
  } };
  const accounts = new ConnectedAccountMetadataService(accountRepository);
  const dataSource = typeorm;
  const composer = new EmailComposerService(null, { manager: { connection: dataSource } }, fileRepository, fileService);
  const imap = { async getClient() { const c = new ImapFlow(config); await c.connect(); const list = c.list.bind(c); c.list = async () => (await list()).filter((entry) => entry.path === folder); return c; }, async closeClient(c) { await c.logout(); } };
  const bindings = createTwentyBindings({
    accounts, imap, composer, dataSource,
    emailOperationDraft: 'DRAFT', getStandardFolder: (name) => name === folder ? 'drafts' : null, draftsStandard: 'drafts', PostalMime, MailComposer,
  });
  const service = new DraftEditService(bindings);
  const server = new McpServer({ name: 'draft-test', version: '1.0.0' });
  const dummy = { description: 'fixture', inputSchema: z.object({}), async execute() {} };
  const share = { ...dummy, async isEnabled() { return false; } };
  const permissionService = { async hasPermissionFlag({ authContext }) { return authContext?.allow === true; } };
  const draftTool = { ...dummy, emailComposerService: composer, messageOutboundService: { imapSmtpMessageOutboundService: { imapClientProvider: imap } } };
  const findTool = { ...dummy, connectedAccountMetadataService: accounts };
  const provider = new ActionToolProvider(dummy, dummy, draftTool, findTool, dummy, dummy, dummy, dummy, dummy, dummy, dummy, dummy, share, { isEnabled: () => false }, permissionService, { translateMessage: ({ messageId }) => messageId });
  const tools = await installTwentyDraftEditing({ provider, z, PostalMime, MailComposer, EmailOperation: { DRAFT: 'DRAFT' }, PermissionFlagType, getStandardFolderByRegex: (name) => name === folder ? 'drafts' : null, StandardFolder: { DRAFTS: 'drafts' } });
  const descriptors = await provider.generateDescriptors(context, { includeSchemas: false });
  assert.ok(descriptors.some((entry) => entry.name === 'update_email_draft'));
  const deniedContext = { ...context, authContext: { type: 'user', allow: false } };
  assert.equal((await provider.generateDescriptors(deniedContext, { includeSchemas: false })).some((entry) => entry.name === 'update_email_draft'), false);
  assert.equal((await provider.executeStaticTool('update_email_draft', {}, deniedContext)).success, false);
  for (const [name, tool] of Object.entries(tools)) {
    server.registerTool(name, { description: tool.description, inputSchema: tool.inputSchema }, async (args) => ({ content: [{ type: 'text', text: JSON.stringify(await provider.executeStaticTool(name, args, context)) }] }));
  }
  const mcpClient = new Client({ name: 'draft-test-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), mcpClient.connect(clientTransport)]);
  assert.deepEqual((await mcpClient.listTools()).tools.map((tool) => tool.name).sort(), ['inspect_email_draft', 'list_email_drafts', 'update_email_draft']);
  const call = async (name, args) => JSON.parse((await mcpClient.callTool({ name, arguments: args })).content[0].text);
  const listing = await call('list_email_drafts', { accountId });
  assert.equal(listing.success, true); assert.deepEqual(listing.result.drafts[0].target, target);
  const inspected = await call('inspect_email_draft', { target: listing.result.drafts[0].target });
  assert.equal(inspected.success, true);
  const before = inspected.result;
  assert.equal(before.subject, 'Original'); assert.equal(before.attachments[0].filename, 'DE.pdf');
  await assert.rejects(service.inspect({ context: { ...context, userWorkspaceId: 'other' }, target }), /Account unavailable/);
  await assert.rejects(service.inspect({ context, target: { ...target, uid: '1:*' } }), /Invalid draft target/);
  await assert.rejects(service.edit({ context, target, expectedRevision: before.revision, operationId: 'missing-file-00001', changes: { files: [{ id: 'foreign', name: 'foreign.pdf' }] } }), /Files not found/);
  const operationId = `service-${randomUUID()}`;
  const edited = await call('update_email_draft', { target, expectedRevision: before.revision, operationId, changes: { subject: 'Updated', body: { text: 'Personalised' }, files: [{ id: pdfId, name: 'EN.pdf' }] } });
  assert.equal(edited.success, true);
  const outcome = edited.result;
  assert.equal(outcome.status, 'updated');
  const after = await service.inspect({ context, target: outcome.target });
  assert.equal(after.subject, 'Updated'); assert.equal(after.text.trim(), 'Personalised'); assert.equal(after.attachments[0].filename, 'EN.pdf');
  const lock = await seed.getMailboxLock(folder);
  try {
    const list = await seed.search({ all: true }, { uid: true }); assert.deepEqual(list, [outcome.target.uid]);
    const updated = await seed.fetchOne(String(outcome.target.uid), { source: true }, { uid: true });
    const parsed = await PostalMime.parse(updated.source);
    assert.deepEqual(Buffer.from(parsed.attachments[0].content), nextPdf);
    assert.equal(parsed.to[0].address, 'lead@example.invalid');
  } finally { lock.release(); }
  const repeat = await service.edit({ context, target, expectedRevision: before.revision, operationId, changes: { files: [{ id: pdfId, name: 'EN.pdf' }] } });
  assert.equal(repeat.status, 'recovery_required');
  await mcpClient.close(); await server.close();
  console.log('PASS: standalone MCP edits IMAP draft and PDF via PostgreSQL; Twenty tool provider and authorization/composer classes with mocked repositories');
} finally { await seed.logout(); await typeorm.destroy(); await pool.end(); }
