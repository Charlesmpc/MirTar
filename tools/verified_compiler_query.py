"""Return real compiler output via a file-backed capture on affected Windows hosts.

Never synthesize target/version metadata or relax the SDK's fatal query guards.
"""
import subprocess
import sys
import tempfile
import time

for attempt in range(12):
    with tempfile.TemporaryFile() as output:
        result = subprocess.run(sys.argv[1:], stdin=subprocess.DEVNULL, stdout=output, stderr=subprocess.PIPE)
        output.seek(0)
        data = output.read(65536)
    if result.returncode:
        sys.stderr.buffer.write(result.stderr)
        raise SystemExit(result.returncode)
    if data.strip():
        sys.stdout.buffer.write(data)
        raise SystemExit(0)
    time.sleep(0.1)
raise SystemExit('Real compiler query repeatedly returned no output; build stopped.')
