"""Accept real objdump metadata only when it matches every ELF archive section.

Used by the private Windows SDK linker helper. It never synthesizes linker data.
"""
import io
import re
import subprocess
import time
from collections import Counter
from pathlib import Path
from elftools.elf.elffile import ELFFile
from ldgen.entity import EntityDB

def expected_members(library):
    raw = Path(library).read_bytes()
    if raw[:8] != b'!<arch>\n':
        raise ValueError('Expected a normal GNU ar archive')
    position, names, members = 8, b'', []
    while position < len(raw):
        header = raw[position:position+60]
        if len(header) != 60 or header[58:60] != b'`\n':
            raise ValueError('Invalid archive header')
        size = int(header[48:58])
        name = header[:16].decode().strip()
        data = raw[position+60:position+60+size]
        if len(data) != size:
            raise ValueError('Truncated archive')
        position += 60+size+size%2
        if name == '//':
            names = data
            continue
        if not data.startswith(b'\x7fELF'):
            continue
        if name.startswith('/') and name[1:].isdigit():
            name = names[int(name[1:]):].split(b'/\n')[0].decode()
        else:
            name = name.rstrip('/')
        elf = ELFFile(io.BytesIO(data))
        sections = Counter((section.name, section['sh_size']) for section in elf.iter_sections()
            if section['sh_type'] not in ('SHT_NULL', 'SHT_SYMTAB', 'SHT_STRTAB', 'SHT_RELA', 'SHT_REL', 'SHT_SYMTAB_SHNDX'))
        members.append((name, sections))
    return members

def complete_output(output, expected, library):
    actual = []
    for line in output.splitlines():
        member = re.match(r'^(.+?):\s+file format ', line)
        if member:
            actual.append((member[1], Counter()))
        section = re.match(r'^\s*\d+\s+(\S+)\s+([0-9a-fA-F]+)\s', line)
        if section and actual:
            actual[-1][1][(section[1], int(section[2], 16))] += 1
    if actual != expected:
        return False
    # Retain the SDK's full grammar check as well as the ELF cross-check.
    try:
        dump = io.StringIO(output)
        dump.name = library
        database = EntityDB()
        database.add_sections_info(dump)
        for info in database.sections.values():
            database._get_infos_from_file(info)
    except Exception:
        return False
    return True

def run_verified(objdump, library, environment):
    expected = expected_members(library)
    for attempt in range(20):
        output = subprocess.check_output([objdump, '-h', library], env=environment).decode()
        if output.strip() and complete_output(output, expected, library):
            return output
        if attempt < 19:
            time.sleep(0.1)
    raise RuntimeError('Real objdump metadata repeatedly failed ELF/member/section verification: ' + library)
