"""Run the actual server configuration C code and recording guards on the host."""
import argparse
import os
from pathlib import Path
import shutil
import subprocess

root = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser()
parser.add_argument('--cc', help='Host C compiler executable, such as clang or gcc')
parser.add_argument('--zig', type=Path, help='Optional Zig executable to use as a host C compiler')
parser.add_argument('--idf', type=Path, default=Path(os.getenv('IDF_PATH', root/'.private/toolchains/esp-idf-v5.5.6')))
args = parser.parse_args()
output = root/'.private/host-tests'
output.mkdir(parents=True, exist_ok=True)
zig = args.zig or root/'.private/host-compiler/ziglang/zig.exe'
compiler = args.cc or shutil.which('clang') or shutil.which('gcc') or shutil.which('cc')
if not compiler and zig.is_file():
    command = [str(zig), 'cc'] + (['-target', 'x86_64-windows-gnu'] if os.name == 'nt' else [])
elif compiler:
    command = [compiler]
else:
    raise SystemExit('Provide a host C compiler with --cc, or an isolated Zig compiler with --zig. Firmware cross-compiler cannot run host tests.')
cjson = args.idf/'components/json/cJSON'
executable = output/('config-tests.exe' if os.name == 'nt' else 'config-tests')
environment = {**os.environ, 'ZIG_GLOBAL_CACHE_DIR': str(output/'zig-global'), 'ZIG_LOCAL_CACHE_DIR': str(output/'zig-local')}
(output/'temp').mkdir(exist_ok=True)
environment.update({'TMP': str(output/'temp'), 'TEMP': str(output/'temp')})
subprocess.run(command + ['-std=c11', '-Wall', '-Wextra', '-Werror',
    '-I'+str(root/'firmware/tests/stubs'), '-I'+str(root/'firmware/main'), '-I'+str(cjson),
    str(root/'firmware/tests/config_test.c'), str(root/'firmware/main/runtime_config.c'), str(root/'firmware/main/state.c'), str(cjson/'cJSON.c'),
    '-o', str(executable)], env=environment, check=True)
receipt = output/'config-tests.receipt.txt'
receipt.unlink(missing_ok=True)
subprocess.run([str(executable), str(receipt)], check=True)
result = receipt.read_text(encoding='utf-8') if receipt.is_file() else ''
if 'Configuration round-trip' not in result or 'PASS' not in result:
    raise SystemExit('Host test executable produced no success receipt; results are unverified.')
print(result.strip())
