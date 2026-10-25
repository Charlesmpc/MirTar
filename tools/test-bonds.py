"""Exercise the actual bond-profile store using simulated NVS, without a radio."""
from pathlib import Path
import os
import shutil
import subprocess

root=Path(__file__).resolve().parent.parent
output=root/'.private/host-tests';output.mkdir(parents=True,exist_ok=True)
compiler=shutil.which('clang') or shutil.which('gcc')
command=[compiler] if compiler else [str(root/'.private/host-compiler/ziglang/zig.exe'),'cc','-target','x86_64-windows-gnu']
environment={**os.environ,'ZIG_GLOBAL_CACHE_DIR':str(output/'zig-global'),'ZIG_LOCAL_CACHE_DIR':str(output/'zig-local'),'TMP':str(output/'temp'),'TEMP':str(output/'temp')}
(output/'temp').mkdir(exist_ok=True)
executable=output/('bond-tests.exe' if os.name=='nt' else 'bond-tests')
subprocess.run(command+['-std=c11','-Wall','-Wextra','-Werror','-I'+str(root/'firmware/tests/bond_stubs'),'-I'+str(root/'firmware/main'),str(root/'firmware/main/bond_store.c'),str(root/'firmware/tests/bond_store_test.c'),'-o',str(executable)],env=environment,check=True)
receipt=output/'bond-tests.receipt.txt';receipt.unlink(missing_ok=True)
subprocess.run([str(executable),str(receipt)],check=True)
if not receipt.is_file() or not receipt.read_text().startswith('PASS:'):raise SystemExit('Bond test result unverified')
print(receipt.read_text().strip())
