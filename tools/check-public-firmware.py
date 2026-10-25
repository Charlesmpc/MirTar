from pathlib import Path
import json
import sys
from firmware_bundle import require_public
from audit_firmware import audit_image

root=Path(__file__).resolve().parent.parent
directory=Path(sys.argv[1]) if len(sys.argv)>1 else root/('.private/build-v'+json.loads((root/'package.json').read_text())['version'])
manifest=require_public(directory,json.loads((root/'package.json').read_text())['version'])
audit_image(directory/'MirTar-full.bin',root)
print(json.dumps({'version':manifest['version'],'publishable':True,'sha256':manifest['sha256'],'nvsEmpty':True}))
