"""Run actual deletion/config/Bluetooth C against fault-injected host NVS."""
from pathlib import Path
import os
import shutil
import subprocess

root=Path(__file__).resolve().parent.parent
output=root/'.private/host-tests';output.mkdir(parents=True,exist_ok=True)
compiler=shutil.which('clang') or shutil.which('gcc')
command=[compiler] if compiler else [str(root/'.private/host-compiler/ziglang/zig.exe'),'cc','-target','x86_64-windows-gnu']
idf=Path(os.getenv('IDF_PATH',root/'.private/toolchains/esp-idf-v5.5.6'))
cjson=idf/'components/json/cJSON'
environment={**os.environ,'ZIG_GLOBAL_CACHE_DIR':str(output/'zig-global'),'ZIG_LOCAL_CACHE_DIR':str(output/'zig-local'),'TMP':str(output/'temp'),'TEMP':str(output/'temp')}
(output/'temp').mkdir(exist_ok=True)
executable=output/('server-delete-tests.exe' if os.name=='nt' else 'server-delete-tests')
sources=['firmware/main/bond_store.c','firmware/main/runtime_config.c','firmware/main/server_delete.c','firmware/tests/server_delete_test.c','firmware/tests/bond_stubs/nvs_memory.c']
subprocess.run(command+['-std=c11','-Wall','-Wextra','-Werror','-I'+str(root/'firmware/tests/bond_stubs'),'-I'+str(root/'firmware/main'),'-I'+str(cjson)]+[str(root/p) for p in sources]+[str(cjson/'cJSON.c'),'-o',str(executable)],env=environment,check=True)
receipt=output/'server-delete-tests.receipt.txt';receipt.unlink(missing_ok=True)
subprocess.run([str(executable),str(receipt)],check=True)
if not receipt.is_file() or not receipt.read_text().startswith('PASS:'):raise SystemExit('Server deletion test result unverified')
print(receipt.read_text().strip())
