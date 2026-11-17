import argparse
import hashlib
import json
import pathlib
import shutil
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument('--frontend-build', required=True, type=pathlib.Path)
parser.add_argument('--output', required=True, type=pathlib.Path)
args = parser.parse_args()
root = pathlib.Path(__file__).resolve().parents[1]
output = args.output.resolve()
if output.exists():
    raise SystemExit('Release directory already exists')
if not (args.frontend_build / 'index.html').is_file():
    raise SystemExit('Built frontend is missing')
sha = subprocess.check_output(['git', '-C', str(root), 'rev-parse', 'HEAD'], text=True).strip()
output.mkdir(parents=True)
for name in ['src', 'scripts', 'sql', 'test']:
    shutil.copytree(root / name, output / name, ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
shutil.copytree(args.frontend_build, output / 'frontend')

def manifest(files, base, target):
    target.write_text(''.join(f'{hashlib.sha256(file.read_bytes()).hexdigest()}  {file.relative_to(base)}\n' for file in sorted(files) if file.is_file()))

manifest([file for name in ['src', 'scripts', 'sql'] for file in (output / name).rglob('*')], output, output / 'code.sha256')
manifest((output / 'frontend').rglob('*'), output / 'frontend', output / 'frontend.sha256')
(output / 'source.json').write_text(json.dumps({'candidate': sha, 'upstream': 'bd8ab939f0e238b5faeefcbeb897ecd6862b1a59'}, indent=2) + '\n')
print(output)
