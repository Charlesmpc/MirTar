import json
from pathlib import Path
import struct
import tempfile
import unittest
from firmware_bundle import digest,require_public,export_public
from package_personal_firmware import package,read_nvs_config

ROOT=Path(__file__).resolve().parent.parent
class Bundles(unittest.TestCase):
    def setUp(self):
        (ROOT/'.private/bundle-tests').mkdir(parents=True,exist_ok=True)
        self.temp=tempfile.TemporaryDirectory(dir=ROOT/'.private/bundle-tests');self.root=Path(self.temp.name)
        self.public=self.root/'public';self.public.mkdir()
        app=bytearray(512);app[0]=0xe9;app[32:36]=bytes.fromhex('3254cdab');app[48:53]=b'0.5.0'
        table=struct.pack('<HBBII16sI',0x50aa,1,2,0x9000,0x6000,b'nvs',0)
        self.image=bytearray(b'\xff'*(0x10000+len(app)));segments={}
        for offset,name,data in [(0,'bootloader.bin',b'\xe9boot'),(0x8000,'partition-table.bin',table),(0x10000,'MirTar.bin',bytes(app))]:
            (self.public/name).write_bytes(data);self.image[offset:offset+len(data)]=data
            segments[hex(offset)]={'path':name,'bytes':len(data),'sha256':digest(data)}
        self.manifest={'version':'0.5.0','applicationVersion':'0.5.0','distribution':'public','publishable':True,'configurationEmbedded':False,'containsPersonalConfiguration':False,'sha256':digest(self.image),'segments':segments}
        (self.public/'flasher_args.json').write_text(json.dumps({'flash_files':{o:r['path'] for o,r in segments.items()}}))
        self.save()
    def tearDown(self):self.temp.cleanup()
    def save(self):
        self.manifest['sha256']=digest(self.image)
        (self.public/'MirTar-full.bin').write_bytes(self.image)
        (self.public/'mirtar-manifest.json').write_text(json.dumps(self.manifest))
    def test_empty_public_bundle_exports_without_config(self):
        require_public(self.public,'0.5.0');target=self.root/'export';export_public(self.public,target)
        self.assertEqual((target/'MirTar-full.bin').read_bytes(),self.image)
    def test_personal_nvs_cannot_be_relabelled_public(self):
        self.image[0x9000:0x9006]=b'preset';self.save()
        with self.assertRaisesRegex(ValueError,'empty NVS'):require_public(self.public)
    def test_private_flag_and_actual_application_version_both_gate_publication(self):
        self.manifest['publishable']=False;self.save()
        with self.assertRaises(ValueError):require_public(self.public)
        self.manifest['publishable']=True
        app=bytearray((self.public/'MirTar.bin').read_bytes());app[48:80]=b'0.5.0-personal'.ljust(32,b'\0')
        (self.public/'MirTar.bin').write_bytes(app);self.image[0x10000:]=app
        self.manifest['segments']['0x10000']['sha256']=digest(app);self.save()
        with self.assertRaises(ValueError):require_public(self.public)
    def test_modified_segment_and_wrong_release_are_rejected(self):
        with self.assertRaises(ValueError):require_public(self.public,'0.6.0')
        (self.public/'MirTar.bin').write_bytes(b'wrong')
        with self.assertRaises(ValueError):require_public(self.public)
    def test_old_reset_all_preview_cannot_be_packaged_as_current_051(self):
        app=bytearray((self.public/'MirTar.bin').read_bytes());app[48:80]=b'0.5.1'.ljust(32,b'\0')
        (self.public/'MirTar.bin').write_bytes(app);self.image[0x10000:]=app
        self.manifest['segments']['0x10000']['sha256']=digest(app)
        self.manifest.update(version='0.5.1',applicationVersion='0.5.1');self.save()
        with self.assertRaisesRegex(ValueError,'server-scoped'):require_public(self.public)
        self.manifest.update(bluetoothStorageSchema=1,bluetoothResetScope='server',bluetoothPerServerIdentity=True);self.save()
        require_public(self.public,'0.5.1')
    def test_sdk_preset_round_trip_crosses_pages_and_stays_private(self):
        idf=ROOT/'.private/toolchains/esp-idf-v5.5.6'
        python=ROOT/'.private/toolchains/idf-tools/python_env/idf5.5_py3.12_env/Scripts/python.exe'
        if not python.exists():self.skipTest('Local SDK Python not installed')
        cfg={'version':2,'deviceId':'test-card','skin':'reading','allowLanPlaintext':True,'servers':[{'id':'host-1','name':'Test computer','bluetoothName':'TestComputer','secret':'a'*64}]}
        cfg['padding']='x'*(3990-len(json.dumps(cfg,separators=(',',':')).encode())-13)
        path=self.root/'device.test.config.json';path.write_text(json.dumps(cfg,separators=(',',':')))
        output=self.root/'personal';receipt=package(self.public,path,'test-only',output,idf,python)
        self.assertFalse(receipt['publishable']);self.assertEqual(receipt['version'],'0.5.0-test-only')
        payload=read_nvs_config((output/'preset-nvs.bin').read_bytes(),idf)
        self.assertEqual(json.loads(payload[:-1])['buildFlavor'],'test-only');self.assertGreater(len(payload),3900)
        with self.assertRaises(ValueError):require_public(output)
        self.assertEqual((output/'MirTar.bin').read_bytes(),(self.public/'MirTar.bin').read_bytes())

if __name__=='__main__':unittest.main()
