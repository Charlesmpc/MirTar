"""Guard the exact public image before invoking the official publisher, stored outside the repo."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
from firmware_bundle import require_public
from audit_firmware import audit_image

root=Path(__file__).resolve().parent.parent
version=json.loads((root/'package.json').read_text())['version']
parser=argparse.ArgumentParser()
parser.add_argument('--publisher',required=True,type=Path,help='Official publisher.py installed outside this repository')
parser.add_argument('--build-directory',type=Path,default=root/('.private/build-v'+version))
parser.add_argument('publisher_args',nargs=argparse.REMAINDER)
args=parser.parse_args()
forward=args.publisher_args
if forward and forward[0]=='--': forward=forward[1:]
if not forward or forward[0] not in ('validate','submit') or any(a=='--firmware' or a.startswith('--firmware=') for a in forward):
    raise SystemExit('Use validate/submit; firmware is selected only from the verified public bundle.')
require_public(args.build_directory,version)
firmware=(args.build_directory/'MirTar-full.bin').resolve()
audit_image(firmware,root)
environment={**os.environ,'FOLOTOY_AI_PASSPORT_URL':'https://ai-passport.folotoy.cn'}
if Path(environment.get('FOLOTOY_PUBLISHER_CONFIG',str(Path.home()/'.config/folotoy-ai-passport-publisher/config.json'))).resolve().is_relative_to(root):
    raise SystemExit('Publisher credentials must stay outside the repository.')
if args.publisher.resolve().is_relative_to(root) and '.private' not in args.publisher.resolve().parts:
    raise SystemExit('Keep the official publisher installation outside tracked source.')
raise SystemExit(subprocess.call([sys.executable,str(args.publisher),*forward,'--firmware',str(firmware)],env=environment))
