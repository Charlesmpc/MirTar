"""Package committed source and optional public firmware; personal presets stay local."""
import argparse
import hashlib
import json
import re
import subprocess
import zipfile
from pathlib import Path
from firmware_bundle import require_public,digest
from audit_firmware import audit_image

root = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser()
parser.add_argument('--prerelease', action='store_true', help='Mark a preview release without changing its firmware version')
parser.add_argument('--firmware-build',type=Path,help='Only a verified public bundle may be added')
args = parser.parse_args()
def git(*args):
    return subprocess.check_output(['git', '-C', str(root), *args])

commit = git('rev-parse', 'HEAD').decode().strip()
version = json.loads(git('show', f'{commit}:package.json'))['version']
if not re.fullmatch(r'\d+\.\d+\.\d+(?:-[a-z]+\.\d+)?', version):
    raise SystemExit('Invalid release version')
tag = 'v' + version
firmware_build=args.firmware_build or root/('.private/build-v'+version)
firmware_manifest=None
if args.firmware_build or (firmware_build/'MirTar-full.bin').exists():
    firmware_manifest=require_public(firmware_build,version)
    audit_image(firmware_build/'MirTar-full.bin',root)
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
            'tools/Enable-Bluetooth.ps1', 'tools/Test-Bluetooth.ps1', 'tools/Test-BridgeRecovery.ps1', 'tools/Reset-BluetoothPairing.ps1', 'tools/New-LocalConfig.ps1', 'tools/Add-Server.ps1', 'tools/add-server.ts', 'tools/Convert-DeviceConfig.ps1', 'tools/Export-DeviceConfig.ps1', 'tools/check-private-files.mjs',
            'tools/check-private-files.test.mjs', 'tools/audit-repository.mjs', 'tools/audit-repository.test.mjs', 'tools/device-simulator.ts', 'tools/portal.test.mjs', 'tools/test-firmware.py', 'tools/test-bonds.py',
            'firmware/main/portal.html', 'firmware/main/runtime_config.c', 'firmware/main/runtime_config.h',
            'firmware/main/state.c', 'firmware/main/state.h', 'firmware/tests/config_test.c', 'firmware/tests/stubs/esp_err.h', 'firmware/tests/stubs/nvs.h',
            'firmware/main/bond_store.c','firmware/main/bond_store.h','firmware/tests/bond_store_test.c',
            'firmware/main/server_delete.c','firmware/main/server_delete.h','firmware/tests/server_delete_test.c','tools/test-server-delete.py',
            'firmware/main/question.c','firmware/main/question.h','firmware/tests/question_test.c',
            'tools/New-AgentSession.ps1','tools/new-agent-session.ts',
            'tools/Manage-BridgeService.ps1','tools/Run-BridgeService.ps1','tools/run-bridge-service.ts',
            'tools/Resolve-CodexBackend.ps1',
            'firmware/tests/bond_stubs/nvs_memory.c','firmware/tests/bond_stubs/nvs_memory.h',
            'firmware/tests/bond_stubs/esp_err.h','firmware/tests/bond_stubs/esp_random.h','firmware/tests/bond_stubs/nvs.h',
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
if firmware_manifest:
    public_image=output/'MirTar-full.bin';public_app=output/'MirTar.bin';public_receipt=output/'firmware-manifest.json'
    public_image.write_bytes((firmware_build/'MirTar-full.bin').read_bytes())
    public_app.write_bytes((firmware_build/'MirTar.bin').read_bytes())
    public_receipt.write_text(json.dumps(firmware_manifest,indent=2)+'\n',encoding='utf-8')
    assets.extend({'name':path.name,'bytes':path.stat().st_size,'sha256':digest(path.read_bytes())} for path in [public_image,public_app,public_receipt])
manifest = {'version': version, 'tag': tag, 'sourceCommit': commit, 'prerelease': args.prerelease or '-' in version,
            'configuredFirmwareIncluded': False, 'distribution':'public','firmwareIncluded':bool(firmware_manifest), 'sourceFiles': len(files), 'windowsBridgeFiles': len(runtime_files),
            'assets': assets, 'currentSourceAuditPassed': True, 'historyPrivacyReviewRequired': not audit['historyPrivateInfoClean']}
manifest_path = output/'release-manifest.json'
manifest_path.write_text(json.dumps(manifest, indent=2)+'\n', encoding='utf-8')
(output/'SHA256SUMS').write_text(''.join(hashlib.sha256(path.read_bytes()).hexdigest()+'  '+path.name+'\n'
                                      for path in [output/item['name'] for item in assets]+[manifest_path]), encoding='utf-8')
print(json.dumps(manifest))
print('ZIP members match audited Git blobs; no configured firmware or private files packaged.')
