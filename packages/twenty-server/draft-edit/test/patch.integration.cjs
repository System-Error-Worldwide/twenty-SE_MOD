const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
require(require('node:module').createRequire('/app/package.json').resolve('reflect-metadata'));
const file = '/app/packages/twenty-server/dist/engine/core-modules/tool-provider/tool-provider.module.js';
execFileSync(process.execPath, ['/work/src/apply-twenty-patch.cjs', file, '--apply']);
execFileSync(process.execPath, ['/work/src/apply-twenty-patch.cjs', file, '--apply']);
const altered = '/tmp/draft-edit-unexpected-build.js';
fs.writeFileSync(altered, 'different build');
assert.throws(() => execFileSync(process.execPath, ['/work/src/apply-twenty-patch.cjs', altered, '--apply'], { stdio: 'pipe' }));
const { ToolProviderModule } = require(file);
const providers = Reflect.getMetadata('providers', ToolProviderModule);
const entry = providers.find((value) => value.provide === 'OUTREACH_DRAFT_EDIT_TOOLS');
assert.ok(entry && entry.inject.length === 1 && entry.inject[0].name === 'ActionToolProvider');
entry.useFactory({}).then((result) => {
  assert.equal(result.ready, false);
  console.log('PASS: pinned Twenty module registers optional draft bootstrap and rejects unexpected builds');
}).catch((error) => { console.error(error); process.exitCode = 1; });
