"""Generate a private build header. Never print configuration values."""
import json
import sys
import re
from pathlib import Path

source, destination = map(Path, sys.argv[1:3])
config = json.loads(source.read_text(encoding='utf-8-sig'))
assert config.get('version') == 1
assert 0 <= len(config['wifiNetworks']) <= 8
for network in config['wifiNetworks']:
    assert 0 < len(network['ssid'].encode()) <= 32
    assert len(network['password'].encode()) <= 63
assert 0 < len(config['targets']) <= 4
assert re.fullmatch(r'[a-zA-Z0-9_-]{1,40}', config['deviceId'])
for target in config['targets']:
    assert target['url'].startswith('ws://') and config.get('allowLanPlaintext') is True
    assert len(target['secret']) >= 32
    assert len(target['url']) < 200
    assert 0 < len(target['name'].encode()) <= 40
    assert re.fullmatch(r'[a-zA-Z0-9_-]{1,20}', target.get('bluetoothName', target['name']))
data = '#pragma once\nstatic const char MT_CONFIG_JSON[] = ' + json.dumps(json.dumps(config, ensure_ascii=False, separators=(',', ':')), ensure_ascii=False) + ';\n'
destination.parent.mkdir(parents=True, exist_ok=True)
destination.write_text(data, encoding='utf-8')
