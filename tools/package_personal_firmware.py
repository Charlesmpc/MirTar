"""Add a local NVS preset to a verified public app; this output is never publishable."""
import argparse
import base64
import csv
import importlib.util
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
from device_config import load_config,validate_config
from firmware_bundle import digest,inspect_bundle,member,require_public

def read_nvs_config(data,idf):
    source=Path(idf)/'components/nvs_flash/nvs_partition_tool/nvs_parser.py'
    spec=importlib.util.spec_from_file_location('mirtar_nvs_parser',source)
    parser=importlib.util.module_from_spec(spec);spec.loader.exec_module(parser)
    partition=parser.NVS_Partition('private-preset',bytearray(data))
    entries=[]
    for page in partition.pages:
        if not page.is_empty and page.header['crc']['original']!=page.header['crc']['computed']:raise ValueError('NVS page CRC mismatch')
        for entry in page.entries:
            if entry.state=='Written':
                if entry.metadata['crc']['original']!=entry.metadata['crc']['computed']:raise ValueError('NVS entry CRC mismatch')
                entries.append(entry)
    namespaces=[e.data['value'] for e in entries if e.metadata['namespace']==0 and e.key=='mirtar']
    if len(namespaces)!=1:raise ValueError('Missing preset namespace')
    selected=[e for e in entries if e.metadata['namespace']==namespaces[0] and e.key=='config']
    indexes=[e for e in selected if e.metadata['type']=='blob_index']
    if len(indexes)!=1:raise ValueError('Missing preset blob index')
    index=indexes[0];chunks={e.metadata['chunk_index']:e for e in selected if e.metadata['type']=='blob_data'}
    result=b''
    for number in range(index.data['chunk_start'],index.data['chunk_start']+index.data['chunk_count']):
        if number not in chunks:raise ValueError('Missing preset blob chunk')
        chunk=chunks[number]
        result+=b''.join(bytes(child.raw) for child in chunk.children)[:chunk.data['size']]
    if len(result)!=index.data['size']:raise ValueError('Preset blob size mismatch')
    return result

def package(public_build,config_path,name,output,idf,python=sys.executable):
    root=Path(__file__).resolve().parent.parent
    public_build,config_path,output=map(lambda p:Path(p).resolve(),(public_build,config_path,output))
    private=root/'.private'
    if not config_path.is_relative_to(private) or not output.is_relative_to(private):raise ValueError('Personal input/output must stay in ignored .private')
    if public_build==output or public_build.is_relative_to(output) or output.is_relative_to(public_build):raise ValueError('Personal output must be separate from public artifacts')
    if not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,19}',name):raise ValueError('Invalid personal variant label')
    public=require_public(public_build)
    source_config=load_config(config_path.read_bytes())
    if not source_config['servers']:raise ValueError('Personal preset must contain at least one host')
    source_config['buildFlavor']=name
    payload=validate_config(source_config)+b'\0'
    output.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(dir=output) as work:
        work=Path(work);source=work/'preset.csv';nvs_path=work/'nvs.bin'
        with source.open('w',encoding='utf-8',newline='') as file:
            writer=csv.writer(file);writer.writerow(['key','type','encoding','value']);writer.writerow(['mirtar','namespace','','']);writer.writerow(['config','data','base64',base64.b64encode(payload).decode()])
        command=[str(python),str(Path(idf)/'components/nvs_flash/nvs_partition_generator/nvs_partition_gen.py'),'generate',str(source),str(nvs_path),'0x6000']
        result=subprocess.run(command,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        if result.returncode:raise ValueError('SDK NVS generation failed; private diagnostics suppressed')
        nvs=nvs_path.read_bytes()
        if len(nvs)!=0x6000 or read_nvs_config(nvs,idf)!=payload:raise ValueError('Preset readback mismatch')
    manifest,image,(start,size),version=inspect_bundle(public_build)
    image=bytearray(image);image[start:start+size]=nvs
    for record in public['segments'].values():
        dest=member(output,record['path']);dest.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(member(public_build,record['path']),dest)
    (output/'preset-nvs.bin').write_bytes(nvs)
    (output/'MirTar-full.bin').write_bytes(image)
    (output/'preset.config.json').write_bytes(payload[:-1])
    manifest.update(version=version+'-'+name,applicationVersion=version,distribution='personal',publishable=False,
        configurationEmbedded=True,containsPersonalConfiguration=True,configurationLocation='nvs',
        configurationSha256=digest(payload[:-1]),presetReadbackVerified=True,hostCount=len(source_config['servers']),
        publicImageSha256=public['sha256'],sha256=digest(image),bytes=len(image))
    manifest.pop('privacyAudit',None)
    manifest['segments']['0x9000']={'path':'preset-nvs.bin','sha256':digest(nvs),'bytes':len(nvs)}
    (output/'mirtar-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
    flash=json.loads((public_build/'flasher_args.json').read_text());flash['flash_files']['0x9000']='preset-nvs.bin'
    (output/'flasher_args.json').write_text(json.dumps(flash,indent=2)+'\n',encoding='utf-8')
    check,merged,_,app_version=inspect_bundle(output)
    if app_version!=version or read_nvs_config(merged[start:start+size],idf)!=payload:raise ValueError('Final personal image verification failed')
    try:require_public(output)
    except ValueError:pass
    else:raise ValueError('Personal image must be rejected by publication guard')
    return {key:check[key] for key in ['version','applicationVersion','distribution','publishable','sha256','hostCount','presetReadbackVerified']}

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--public-build',required=True,type=Path);parser.add_argument('--config',required=True,type=Path)
    parser.add_argument('--name',default='personal');parser.add_argument('--output',required=True,type=Path)
    parser.add_argument('--idf',type=Path,default=Path(__file__).resolve().parent.parent/'.private/toolchains/esp-idf-v5.5.6')
    args=parser.parse_args()
    try:print(json.dumps(package(args.public_build,args.config,args.name,args.output,args.idf)))
    except Exception as error:raise SystemExit('Personal packaging failed ('+type(error).__name__+'); configuration contents suppressed.') from None
