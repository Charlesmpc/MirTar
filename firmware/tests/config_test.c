#include <assert.h>
#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include "runtime_config.h"
#include "wifi_deadline.h"
#include "nvs.h"
static char stored[MT_CONFIG_LIMIT + 1], pending[MT_CONFIG_LIMIT + 1];
static size_t stored_size, pending_size;
static bool fail_commit;
esp_err_t nvs_open(const char *name, int mode, nvs_handle_t *h) { (void)mode; assert(!strcmp(name,"mirtar")); *h=1; return ESP_OK; }
void nvs_close(nvs_handle_t h) { (void)h; pending_size=0; }
esp_err_t nvs_get_blob(nvs_handle_t h,const char *key,void *out,size_t *size) {
    (void)h; assert(!strcmp(key,"config")); if(!stored_size)return ESP_ERR_NVS_NOT_FOUND;
    if(!out){*size=stored_size;return ESP_OK;} if(*size<stored_size)return ESP_ERR_NVS_INVALID_LENGTH;
    memcpy(out,stored,stored_size);*size=stored_size;return ESP_OK;
}
esp_err_t nvs_set_blob(nvs_handle_t h,const char *key,const void *in,size_t size) {
    (void)h;assert(!strcmp(key,"config"));assert(size<=sizeof(pending));memcpy(pending,in,size);pending_size=size;return ESP_OK;
}
esp_err_t nvs_commit(nvs_handle_t h) { (void)h;if(fail_commit)return ESP_FAIL;memcpy(stored,pending,pending_size);stored_size=pending_size;return ESP_OK; }
static cJSON *parse(const char *text) { cJSON *o=mt_config_parse(text,strlen(text)+1);assert(o);return o; }
static cJSON *request(const char *ssid,const char *password) {
    cJSON *o=cJSON_CreateObject(),*w=cJSON_AddObjectToObject(o,"wifi");
    cJSON_AddStringToObject(w,"ssid",ssid);cJSON_AddStringToObject(w,"password",password);return o;
}
int main(int argc, char **argv) {
    cJSON *base=mt_config_load();assert(base&&mt_config_valid(base));assert(cJSON_GetArraySize(cJSON_GetObjectItem(base,"targets"))==0);
    cJSON *imported=mt_config_empty();cJSON *target=cJSON_CreateObject();
    cJSON_AddStringToObject(target,"name","WorkLaptop");cJSON_AddStringToObject(target,"bluetoothName","WorkLaptop");
    cJSON_AddStringToObject(target,"url","ws://192.168.1.10:28743/device");cJSON_AddStringToObject(target,"secret","0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");
    cJSON_AddItemToArray(cJSON_GetObjectItem(imported,"targets"),target);assert(mt_config_valid(imported));
    cJSON *bt=cJSON_CreateObject();cJSON_AddStringToObject(bt,"mode","bluetooth");cJSON_AddItemToObject(bt,"deviceConfig",imported);
    cJSON *bt_config=mt_config_merge(base,bt);assert(bt_config);assert(cJSON_GetArraySize(cJSON_GetObjectItem(bt_config,"wifiNetworks"))==0);
    cJSON_Delete(bt_config);cJSON_Delete(bt);bt=cJSON_CreateObject();cJSON_AddStringToObject(bt,"mode","bluetooth");assert(!mt_config_merge(base,bt));cJSON_Delete(bt);
    cJSON *r=request("LabNetwork","test-pass-1"),*config=mt_config_merge(base,r);assert(config&&mt_config_valid(config));
    assert(mt_config_save(config)==ESP_OK);cJSON *restored=mt_config_load();assert(restored&&mt_config_valid(restored));
    assert(!strcmp(cJSON_GetObjectItem(cJSON_GetArrayItem(cJSON_GetObjectItem(restored,"wifiNetworks"),0),"ssid")->valuestring,"LabNetwork"));
    cJSON_Delete(restored);cJSON_Delete(r);
    r=request("LabNetwork","new-test-pass");cJSON *updated=mt_config_merge(config,r);assert(updated);
    assert(cJSON_GetArraySize(cJSON_GetObjectItem(updated,"wifiNetworks"))==1);
    fail_commit=true;assert(mt_config_save(updated)!=ESP_OK);fail_commit=false;restored=mt_config_load();
    assert(!strcmp(cJSON_GetObjectItem(cJSON_GetArrayItem(cJSON_GetObjectItem(restored,"wifiNetworks"),0),"password")->valuestring,"test-pass-1"));
    cJSON_Delete(restored);cJSON_Delete(updated);cJSON_Delete(r);
    r=request("OpenNetwork","");updated=mt_config_merge(config,r);assert(updated);cJSON_Delete(updated);cJSON_Delete(r);
    r=request("BadNetwork","short");assert(!mt_config_merge(config,r));cJSON_Delete(r);
    for(int i=1;i<8;i++){char name[24];snprintf(name,sizeof(name),"LabNetwork%d",i);r=request(name,"test-pass-1");updated=mt_config_merge(config,r);assert(updated);cJSON_Delete(config);config=updated;cJSON_Delete(r);}
    r=request("NinthNetwork","test-pass-1");assert(!mt_config_merge(config,r));cJSON_Delete(r);
    r=request("FreshNetwork","test-pass-1");cJSON_AddTrueToObject(r,"replaceNetworks");updated=mt_config_merge(config,r);assert(updated);assert(cJSON_GetArraySize(cJSON_GetObjectItem(updated,"wifiNetworks"))==1);cJSON_Delete(updated);cJSON_Delete(r);
    /* Clearing profiles must work even if an imported file would otherwise overflow eight saved networks. */
    r=request("FreshNetwork","test-pass-1");cJSON_AddTrueToObject(r,"replaceNetworks");
    imported=mt_config_empty();cJSON *extra=request("ImportedNetwork","test-pass-1");
    cJSON_AddItemToArray(cJSON_GetObjectItem(imported,"wifiNetworks"),cJSON_DetachItemFromObjectCaseSensitive(extra,"wifi"));cJSON_Delete(extra);
    cJSON_AddItemToObject(r,"deviceConfig",imported);updated=mt_config_merge(config,r);assert(updated);
    assert(cJSON_GetArraySize(cJSON_GetObjectItem(updated,"wifiNetworks"))==1);cJSON_Delete(updated);cJSON_Delete(r);
    r=request("LabNetwork","replacement-pass");updated=mt_config_merge(config,r);assert(updated);assert(cJSON_GetArraySize(cJSON_GetObjectItem(updated,"wifiNetworks"))==8);cJSON_Delete(updated);cJSON_Delete(r);
    cJSON_AddTrueToObject(base,"template");assert(!mt_config_valid(base));cJSON_Delete(base);
    const char *nul="{\"name\":\"a\\u0000b\"}";assert(!mt_config_parse(nul,strlen(nul)+1));
    assert(!mt_config_parse("{}{}",5));assert(!mt_config_parse("{}",2));
    cJSON *escaped=parse("{\"name\":\"a\\\\u0000b\"}");cJSON_Delete(escaped);
    memcpy(stored,"not-json",9);stored_size=9;assert(!mt_config_load());
    int64_t deadline=mt_wifi_deadline(1000);
    assert(!mt_wifi_setup_due(true,false,false,deadline,deadline-1));
    assert(mt_wifi_setup_due(true,false,false,deadline,deadline));
    assert(!mt_wifi_setup_due(false,false,false,deadline,deadline+1));
    assert(!mt_wifi_setup_due(true,true,false,deadline,deadline+1));
    assert(!mt_wifi_setup_due(true,false,true,deadline,deadline+1));
    assert(!mt_wifi_setup_due(true,false,false,0,deadline+1));
    assert(deadline==30001000);
    uint8_t actual[33],expected[32]={0};memset(actual,'x',sizeof(actual));memcpy(actual,"Lab",4);memcpy(expected,"Lab",3);
    assert(mt_wifi_ssid_matches(actual,expected));actual[0]='X';assert(!mt_wifi_ssid_matches(actual,expected));
    memset(actual,'a',32);actual[32]=0;memset(expected,'a',32);assert(mt_wifi_ssid_matches(actual,expected));
    cJSON_Delete(config);
    const char *receipt="Configuration round-trip, profile bounds, commit failure, parser and 30-second policy: PASS";
    puts(receipt);
    if(argc==2){FILE *file=fopen(argv[1],"wb");assert(file);assert(fputs(receipt,file)>=0);assert(fclose(file)==0);}
    return 0;
}
