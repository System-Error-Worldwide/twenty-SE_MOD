import pathlib
import shutil
import subprocess
import sys

if len(sys.argv) != 3 or sys.argv[1] != '--apply':
    raise SystemExit('Usage: integrate-fork.py --apply FORK_CHECKOUT')
source = pathlib.Path(__file__).resolve().parents[1]
root = pathlib.Path(sys.argv[2]).resolve()
head = subprocess.check_output(['git', '-C', str(root), 'rev-parse', 'HEAD'], text=True).strip()
if head != 'bd8ab939f0e238b5faeefcbeb897ecd6862b1a59':
    raise SystemExit('Unsupported Twenty source revision')
subprocess.run([sys.executable, str(source / 'ui/apply-ui-patch.py'), '--apply', str(root)], check=True)
extension = root / 'packages/twenty-server/draft-edit'
extension.mkdir()
for name in ['src', 'scripts', 'sql', 'test', 'docs', 'ui']:
    shutil.copytree(source / name, extension / name, ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))

def replace(relative, before, after):
    file = root / relative
    content = file.read_text()
    if content.count(before) != 1:
        raise SystemExit(f'Non-unique patch anchor: {relative}')
    file.write_text(content.replace(before, after, 1))

replace('packages/twenty-server/src/engine/core-modules/tool-provider/tool-provider.module.ts',
        '    ToolRegistryService,\n  ],',
        "    ToolRegistryService,\n    {\n      provide: 'OUTREACH_DRAFT_EDIT_TOOLS',\n      useFactory: (provider: ActionToolProvider) =>\n        require('../../../../draft-edit/src/twenty-install.cjs').register(provider),\n      inject: [ActionToolProvider],\n    },\n  ],")
replace('packages/twenty-server/src/engine/core-modules/tool/tools/email-tool/constants/email-attachment-file-folders.const.ts',
        '  FileFolder.EmailAttachment,\n', '  FileFolder.EmailAttachment,\n  FileFolder.AgentChat,\n')
for ownership in ['--chown=1000 ', '']:
    anchor = f'COPY {ownership}--from=twenty-server-build /app/packages/twenty-server/patches /app/packages/twenty-server/patches\n'
    replace('packages/twenty-docker/twenty/Dockerfile', anchor,
            anchor + f'COPY {ownership}--from=twenty-server-build /app/packages/twenty-server/draft-edit /app/packages/twenty-server/draft-edit\n')
timeline = 'packages/twenty-server/src/modules/timeline/utils/build-timeline-activity-target-join-columns.util.ts'
replace(timeline, "import { FieldMetadataType }", "import { STANDARD_OBJECTS } from 'twenty-shared/metadata';\nimport { FieldMetadataType }")
anchor = "import { type FlatEntityMaps }"
replace(timeline, anchor,
        "import { findFlatEntityByUniversalIdentifierOrThrow } from 'src/engine/metadata-modules/flat-entity/utils/find-flat-entity-by-universal-identifier-or-throw.util';\nimport { findManyFlatEntityByIdInFlatEntityMaps } from 'src/engine/metadata-modules/flat-entity/utils/find-many-flat-entity-by-id-in-flat-entity-maps.util';\n" + anchor)
replace(timeline, '  return targetFlatFieldMetadatas\n', '''  const timeline = findFlatEntityByUniversalIdentifierOrThrow({
    flatEntityMaps: flatObjectMetadataMaps,
    universalIdentifier: STANDARD_OBJECTS.timelineActivity.universalIdentifier,
  });
  const targetIds = new Set(
    findManyFlatEntityByIdInFlatEntityMaps({
      flatEntityIds: timeline.fieldIds,
      flatEntityMaps: flatFieldMetadataMaps,
    })
      .filter(({ morphId }) => morphId === STANDARD_OBJECTS.timelineActivity.morphIds.targetMorphId.morphId)
      .map(({ relationTargetObjectMetadataId }) => relationTargetObjectMetadataId)
      .filter(isDefined),
  );

  return targetFlatFieldMetadatas
''')
replace(timeline, 'if (!isDefined(targetObjectMetadataId)) {',
        'if (!isDefined(targetObjectMetadataId) || !targetIds.has(targetObjectMetadataId)) {')
print(root)
