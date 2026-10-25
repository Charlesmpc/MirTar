"""Package a committed release; private configuration and firmware stay local."""
import hashlib
import json
import re
import subprocess
import zipfile
from pathlib import Path

root = Path(__file__).resolve().parent.parent
def git(*args):
    return subprocess.check_output(['git', '-C', str(root), *args])

commit = git('rev-parse', 'HEAD').decode().strip()
version = json.loads(git('show', f'{commit}:package.json'))['version']
if not re.fullmatch(r'\d+\.\d+\.\d+(?:-[a-z]+\.\d+)?', version):
    raise SystemExit('Invalid release version')
tag = 'v' + version
output = root / '.private' / 'releases' / tag
output.mkdir(parents=True, exist_ok=True)
audit_path = output / 'source-audit.local.json'
subprocess.run(['node', str(root/'tools/audit-repository.mjs'), str(root), commit, str(audit_path)], check=True, cwd=root)
audit = json.loads(audit_path.read_text())
if not audit['credentialsClean'] or not audit['currentTreePrivateInfoClean']:
    raise SystemExit('Release content audit failed; inspect the private audit report')

def unsafe(path):
    return (any(part in ('.private', '.git', 'secrets', 'build', 'dist', 'node_modules') for part in Path(path).parts)
            or re.search(r'\.(bin|elf|map|log|key|pem|exe|dll)$', path, re.I)
            or re.search(r'(^|/)(device|bridge)(\.[^/]*)?\.config\.json$', path, re.I)
            or re.search(r'\.local\.json$', path, re.I)
            or Path(path).name.startswith('.env') and Path(path).name != '.env.example')

files = {}
for record in git('ls-tree', '-r', '-z', commit).split(b'\0'):
    if not record:
        continue
    meta, path = record.split(b'\t', 1)
    _, kind, oid = meta.decode().split()
    path = path.decode()
    if kind != 'blob' or unsafe(path):
        raise SystemExit('Refusing private/generated/non-file member: ' + path)
    files[path] = git('cat-file', 'blob', oid)

source = output / f'MirTar-{tag}-source.zip'
source.write_bytes(git('archive', '--format=zip', f'--prefix=MirTar-{tag}/', commit))
required = {'README.md', 'README.zh-CN.md', '.gitignore', 'package.json', 'package-lock.json', 'tsconfig.json',
            'DESIGN.md', 'TECH_DESIGN.md', 'tools/Start-Bridge.ps1', 'tools/Start-Bluetooth.ps1',
            'tools/Enable-Bluetooth.ps1', 'tools/New-LocalConfig.ps1', 'tools/check-private-files.mjs',
            'tools/check-private-files.test.mjs', 'tools/audit-repository.mjs', 'tools/audit-repository.test.mjs', 'tools/device-simulator.ts',
            'tools/validation/Stop-TestBrowser.ps1', 'firmware/UPSTREAM.md', 'firmware/UPSTREAM.zh_CN.md',
            'firmware/components/bsp/LICENSE', 'firmware/assets/OFL.txt'}
runtime_files = {path: data for path, data in files.items() if path in required or path.startswith(('bridge/', 'config/', 'docs/'))}
if not required.issubset(runtime_files):
    raise SystemExit('Incomplete runtime source package')
runtime = output / f'MirTar-{tag}-windows-bridge.zip'
with zipfile.ZipFile(runtime, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
    for path, data in sorted(runtime_files.items()):
        archive.writestr('MirTar-windows-bridge/' + path, data)
for asset, prefix in [(source, f'MirTar-{tag}/'), (runtime, 'MirTar-windows-bridge/')]:
    with zipfile.ZipFile(asset) as archive:
        if archive.testzip() is not None:
            raise SystemExit('ZIP integrity failure')
        for entry in archive.infolist():
            if entry.is_dir():
                continue
            path = entry.filename.removeprefix(prefix)
            if not entry.filename.startswith(prefix) or unsafe(path) or path not in files or archive.read(entry) != files[path]:
                raise SystemExit('Unexpected archive member: ' + entry.filename)

assets = [{'name': path.name, 'bytes': path.stat().st_size, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()} for path in [source, runtime]]
manifest = {'version': version, 'tag': tag, 'sourceCommit': commit, 'prerelease': '-' in version,
            'configuredFirmwareIncluded': False, 'sourceFiles': len(files), 'windowsBridgeFiles': len(runtime_files),
            'assets': assets, 'currentSourceAuditPassed': True, 'historyPrivacyReviewRequired': not audit['historyPrivateInfoClean']}
manifest_path = output/'release-manifest.json'
manifest_path.write_text(json.dumps(manifest, indent=2)+'\n', encoding='utf-8')
(output/'SHA256SUMS').write_text(''.join(hashlib.sha256(path.read_bytes()).hexdigest()+'  '+path.name+'\n'
                                      for path in [source, runtime, manifest_path]), encoding='utf-8')
print(json.dumps(manifest))
print('ZIP members match audited Git blobs; no configured firmware or private files packaged.')
