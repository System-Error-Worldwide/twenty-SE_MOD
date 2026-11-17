const fs = require('node:fs');
const crypto = require('node:crypto');
const file = process.argv[2];
if (!file || process.argv[3] !== '--apply') throw new Error('Expected an explicit target and --apply');
const original = fs.readFileSync(file, 'utf8');
const digest = crypto.createHash('sha256').update(original).digest('hex');
if (digest === '631acd320f337920593afe8b4fcd57a9987c1e485953ba18c72aba741e563eb9') process.exit(0);
if (digest !== 'e3d8c5af2ca3111550d09838ef04e4f67d927f32109d9740cc94f944dc4c972c') throw new Error('Unsupported Twenty build');
const before = '            _toolregistryservice.ToolRegistryService\n        ],';
if (original.split(before).length !== 2) throw new Error('Patch anchor is not unique');
const after = `            _toolregistryservice.ToolRegistryService,
            {
                provide: 'OUTREACH_DRAFT_EDIT_TOOLS',
                useFactory: (provider) => require('../../../../draft-edit/src/twenty-install.cjs').register(provider),
                inject: [_actiontoolprovider.ActionToolProvider]
            }
        ],`;
fs.writeFileSync(file, original.replace(before, after), { encoding: 'utf8' });
