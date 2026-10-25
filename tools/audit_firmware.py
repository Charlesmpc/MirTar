"""Check a distributable image against local private values without printing them."""
from pathlib import Path
import base64
import hashlib
import json
import sys

def audit_image(image: Path, root: Path) -> dict:
    raw = image.read_bytes()
    credentials, identifiers = set(), set()
    def visit(value):
        if isinstance(value, list):
            for item in value: visit(item)
        elif isinstance(value, dict):
            for key, item in value.items():
                if key.lower() in ('password', 'secret') and isinstance(item, str) and item and not item.startswith(('FILL_LOCALLY', 'REPLACE_WITH_', 'SAME_LOCAL_')):
                    credentials.add(item)
                elif key in ('ssid', 'bluetoothName', 'hostName') and isinstance(item, str) and len(item) > 3:
                    identifiers.add(item)
                visit(item)
    for path in (root/'.private').glob('*.config.json'):
        config = json.loads(path.read_text(encoding='utf-8-sig'))
        if not config.get('template'): visit(config)
    def present(value):
        encoded = value.encode()
        return any(item in raw for item in [encoded, value.encode('utf-16le'), json.dumps(value)[1:-1].encode(), base64.b64encode(encoded)])
    secrets = sum(present(value) for value in credentials)
    personal = sum(present(value) for value in identifiers)
    home = str(Path.home())
    personal += int(any(value.encode() in raw for value in [home, home.replace('\\', '/'), home.replace('\\', '\\\\')]))
    result = {'sha256': hashlib.sha256(raw).hexdigest(), 'bytes': len(raw),
              'knownCredentialMatches': secrets, 'knownPersonalMatches': personal}
    if secrets or personal: raise ValueError('Private data matched in image; values suppressed. Do not publish.')
    return result

if __name__ == '__main__':
    print(json.dumps(audit_image(Path(sys.argv[1]), Path(__file__).resolve().parent.parent)))
