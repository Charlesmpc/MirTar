"""Validate local v2 presets without including their contents in diagnostics."""
import json
import re

def load_config(raw):
    if len(raw)>4096: raise ValueError('Device configuration exceeds 4096 bytes')
    def pairs(items):
        result={}
        for key,value in items:
            if key in result: raise ValueError('Duplicate configuration key')
            result[key]=value
        return result
    try: config=json.loads(raw.decode('utf-8-sig'),object_pairs_hook=pairs,parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
    except Exception: raise ValueError('Invalid device JSON; contents suppressed') from None
    validate_config(config)
    return config

def validate_config(config):
    def bounded(value,depth=0):
        if depth>12:raise ValueError('Device configuration is too deeply nested')
        if isinstance(value,str) and '\0' in value:raise ValueError('Embedded NUL in configuration')
        if isinstance(value,dict):
            for key,item in value.items():bounded(key,depth);bounded(item,depth+1)
        elif isinstance(value,list):
            for item in value:bounded(item,depth+1)
    bounded(config)
    def identifier(value,limit):return isinstance(value,str) and re.fullmatch(r'[a-zA-Z0-9_-]{1,'+str(limit)+'}',value)
    def text(value,limit):return isinstance(value,str) and 0<len(value.encode('utf-8'))<=limit and not any(ord(c)<32 or ord(c)==127 for c in value)
    if not isinstance(config,dict) or config.get('version')!=2 or config.get('template') or not identifier(config.get('deviceId'),40) or config.get('skin') not in ('reading','terminal') or config.get('allowLanPlaintext') is not True or 'targets' in config or 'wifiNetworks' in config:
        raise ValueError('Expected a real version 2 device configuration')
    if 'buildFlavor' in config and not identifier(config['buildFlavor'],20):raise ValueError('Invalid build flavor')
    servers=config.get('servers')
    if not isinstance(servers,list) or len(servers)>4:raise ValueError('Invalid host count')
    ids,names=set(),set()
    for server in servers:
        if not isinstance(server,dict) or not identifier(server.get('id'),40) or not text(server.get('name'),40) or not identifier(server.get('bluetoothName'),20) or 'url' in server or 'wifiNetworks' in server:
            raise ValueError('Invalid host fields')
        secret=server.get('secret')
        if not isinstance(secret,str) or not 32<=len(secret.encode())<=128 or secret.startswith(('FILL_LOCALLY','REPLACE_WITH_','SAME_LOCAL_')) or '\0' in secret:
            raise ValueError('Invalid host binding key; values suppressed')
        if server['id'] in ids or server['bluetoothName'] in names:raise ValueError('Duplicate host identity')
        ids.add(server['id']);names.add(server['bluetoothName'])
        wifi=server.get('wifi')
        if wifi is not None:
            if not isinstance(wifi,dict) or not text(wifi.get('ssid'),32):raise ValueError('Invalid host Wi-Fi')
            password,url=wifi.get('password'),wifi.get('url')
            if not isinstance(password,str) or '\0' in password or password and not 8<=len(password.encode())<=63:raise ValueError('Invalid Wi-Fi password; values suppressed')
            if not isinstance(url,str) or not url.startswith('ws://') or not 8<=len(url.encode())<200 or '@' in url or any(ord(c)<=32 or ord(c)==127 for c in url):raise ValueError('Invalid host address')
    encoded=json.dumps(config,ensure_ascii=False,separators=(',',':')).encode()
    if len(encoded)>4096:raise ValueError('Invalid preset size')
    return encoded
