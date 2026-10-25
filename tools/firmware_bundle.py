"""Read actual image contents before allowing a firmware bundle to be published."""
import hashlib
import json
from pathlib import Path
import re
import shutil
import struct

def digest(data):
    return hashlib.sha256(data).hexdigest()

def member(root, relative):
    path = (root / relative).resolve()
    if not path.is_relative_to(root.resolve()):
        raise ValueError('Firmware segment must be inside its build directory')
    return path

def inspect_bundle(directory):
    root = Path(directory).resolve()
    manifest = json.loads((root/'mirtar-manifest.json').read_text(encoding='utf-8'))
    image = (root/'MirTar-full.bin').read_bytes()
    if not image or len(image)>8*1024*1024 or digest(image)!=manifest['sha256']:
        raise ValueError('Merged image does not match the manifest')
    for offset, record in manifest['segments'].items():
        data = member(root, record['path']).read_bytes()
        start = int(offset, 0)
        if digest(data)!=record['sha256'] or image[start:start+len(data)]!=data:
            raise ValueError('Firmware segment mismatch')
    table_record = manifest['segments'].get('0x8000')
    app_record = manifest['segments'].get('0x10000')
    if not table_record or not app_record:
        raise ValueError('Unsupported partition/application layout')
    table = member(root, table_record['path']).read_bytes()
    nvs = None
    for position in range(0,len(table)-31,32):
        magic,kind,subtype,start,size,label,_ = struct.unpack_from('<HBBII16sI',table,position)
        if magic==0x50aa and label.split(b'\0')[0]==b'nvs' and kind==1 and subtype==2:
            nvs = (start,size)
    if nvs!=(0x9000,0x6000) or len(image)<sum(nvs):
        raise ValueError('Unexpected NVS layout')
    app = member(root,app_record['path']).read_bytes()
    if app[32:36]!=bytes.fromhex('3254cdab'):
        raise ValueError('Missing actual application descriptor')
    version = app[48:80].split(b'\0')[0].decode('ascii')
    return manifest,image,nvs,version

def require_public(directory, expected_version=None):
    manifest,image,(start,size),version = inspect_bundle(directory)
    if (manifest.get('distribution')!='public' or manifest.get('publishable') is not True or
        manifest.get('configurationEmbedded') is not False or manifest.get('containsPersonalConfiguration') is not False or
        not re.fullmatch(r'\d+\.\d+\.\d+',version) or manifest['version']!=version or
        expected_version and version!=expected_version):
        raise ValueError('Only the unpersonalized public release may be published')
    if set(manifest['segments'])!={'0x0','0x8000','0x10000'} or image[start:start+size]!=b'\xff'*size:
        raise ValueError('Public firmware must have an empty NVS region')
    return manifest

def export_public(source, destination):
    source,destination = Path(source).resolve(),Path(destination).resolve()
    manifest = require_public(source)
    if source==destination:
        return manifest
    if (destination/'mirtar-manifest.json').exists() and json.loads((destination/'mirtar-manifest.json').read_text(encoding='utf-8')).get('distribution')!='public':
        raise ValueError('Public export must not overwrite a personal artifact bundle')
    destination.mkdir(parents=True,exist_ok=True)
    for filename in ['MirTar-full.bin','mirtar-manifest.json','flasher_args.json']+[r['path'] for r in manifest['segments'].values()]:
        target = member(destination,filename)
        target.parent.mkdir(parents=True,exist_ok=True)
        shutil.copyfile(member(source,filename),target)
    require_public(destination,manifest['version'])
    return manifest

if __name__=='__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('directory',type=Path)
    parser.add_argument('--export',type=Path)
    parser.add_argument('--version')
    args = parser.parse_args()
    result = export_public(args.directory,args.export) if args.export else require_public(args.directory,args.version)
    print(json.dumps({key:result[key] for key in ['version','distribution','publishable','sha256']}))
