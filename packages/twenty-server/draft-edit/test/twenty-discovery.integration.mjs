import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const base = 'http://127.0.0.1:3000';
async function metadata(query, variables, token) {
  const response = await fetch(`${base}/metadata`, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ query, variables }) });
  const body = await response.json();
  if (body.errors?.length) throw new Error(body.errors.map((e) => e.message).join('; '));
  return body.data;
}
const { createRequire } = await import('node:module');
const { Pool } = createRequire('/app/package.json')('pg');
const pool = new Pool({ host: '127.0.0.1', database: 'twenty_isolated', user: 'draft_test', password: 'test-only' });
const lookup = await pool.query(`SELECT u.email FROM core."user" u JOIN core."userWorkspace" uw ON uw."userId" = u.id WHERE u.email LIKE 'fixture-%@example.invalid' ORDER BY u."createdAt" LIMIT 1`);
await pool.end();
assert.equal(lookup.rowCount, 1);
const email = lookup.rows[0].email;
const login = await metadata('mutation($email:String!,$password:String!,$origin:String!){getLoginTokenFromCredentials(email:$email,password:$password,origin:$origin){loginToken{token}}}', { email, password: 'Fixture123!@#', origin: base });
const loginToken = login.getLoginTokenFromCredentials.loginToken.token;
const auth = await metadata('mutation($loginToken:String!,$origin:String!){getAuthTokensFromLoginToken(loginToken:$loginToken,origin:$origin){tokens{accessOrWorkspaceAgnosticToken{token}}}}', { loginToken, origin: base });
const token = auth.getAuthTokensFromLoginToken.tokens.accessOrWorkspaceAgnosticToken.token;
const response = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }) });
const body = await response.json();
if (body.error) throw new Error(`MCP: ${body.error.message}`);
const names = body.result.tools.map((tool) => tool.name);
const expectTools = process.env.EXPECT_DRAFT_TOOLS !== 'absent';
for (const name of ['list_email_drafts', 'inspect_email_draft', 'update_email_draft']) assert.equal(names.includes(name), expectTools, `Unexpected tool availability: ${name}`);
assert.ok(names.includes('find_connected_accounts'));
console.log(`PASS: authenticated Twenty MCP draft tools ${expectTools ? 'present' : 'absent'}; existing tool remains`);
