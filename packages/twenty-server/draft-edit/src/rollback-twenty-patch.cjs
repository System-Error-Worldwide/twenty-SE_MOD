const fs = require('node:fs');
const crypto = require('node:crypto');
const file = process.argv[2];
if (!file || process.argv[3] !== '--rollback') throw new Error('Expected an explicit target and --rollback');
const current = fs.readFileSync(file, 'utf8');
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const originalHash = 'e3d8c5af2ca3111550d09838ef04e4f67d927f32109d9740cc94f944dc4c972c';
const patchedHash = '631acd320f337920593afe8b4fcd57a9987c1e485953ba18c72aba741e563eb9';
if (hash(current) === originalHash) process.exit(0);
if (hash(current) !== patchedHash) throw new Error('Unsupported Twenty build');
const before = `            _toolregistryservice.ToolRegistryService,
            {
                provide: 'OUTREACH_DRAFT_EDIT_TOOLS',
                useFactory: (provider) => require('../../../../draft-edit/src/twenty-install.cjs').register(provider),
                inject: [_actiontoolprovider.ActionToolProvider]
            }
        ],`;
const after = '            _toolregistryservice.ToolRegistryService\n        ],';
if (current.split(before).length !== 2) throw new Error('Rollback anchor is not unique');
const original = current.replace(before, after);
if (hash(original) !== originalHash) throw new Error('Rollback verification failed');
fs.writeFileSync(file, original, { encoding: 'utf8' });
