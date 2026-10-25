"""Verify a merged image against this build's actual flash segments and layout."""
from pathlib import Path
import hashlib
import json
import sys
import re
from audit_firmware import audit_image

root = Path(sys.argv[1])
args = json.loads((root/'flasher_args.json').read_text())
full = root/'MirTar-full.bin'
image = full.read_bytes()
assert len(image) <= 8*1024*1024
assert image[0] == 0xE9
segments = {}
for offset, source in args['flash_files'].items():
    start = int(offset, 0)
    segment = (root/source).read_bytes()
    assert image[start:start+len(segment)] == segment, source
    segments[offset] = {'path':source,'sha256':hashlib.sha256(segment).hexdigest(),'bytes':len(segment)}
manifest = {'sdk':'5.5.6','chip':'esp32c3','flashOffset':'0x0','sha256':hashlib.sha256(image).hexdigest(),
            'bytes':len(image),'elfSha256':hashlib.sha256((root/'MirTar.elf').read_bytes()).hexdigest(),
            'configurationEmbedded':False,'runtimeProvisioning':True,'configurationSchemaVersion':2,
            'configFileImport':True,'bluetoothEnrollment':True,'wifiPerHost':True,'deviceTested':False,'segments':segments}
project = json.loads((root/'project_description.json').read_text(encoding='utf-8'))
manifest['version'] = project.get('project_version', 'unknown')
numbers = re.match(r'(\d+)\.(\d+)', project.get('project_version', ''))
assert numbers and tuple(map(int, numbers.groups())) >= (0, 4), 'Use the matching pre-provisioning verifier for old images'
manifest['templateConfiguration'] = False
manifest['privacyAudit'] = audit_image(full, Path(__file__).resolve().parent.parent)
(root/'mirtar-manifest.json').write_text(json.dumps(manifest,indent=2))
print(json.dumps(manifest))
