#include <assert.h>
#include <stdio.h>
#include <string.h>
#include "runtime_config.h"
#include "bond_store.h"
#include "server_delete.h"
#include "nvs_memory.h"

static void put(const char *space,const char *key,const char *value) {
    nvs_handle_t h;assert(nvs_open(space,NVS_READWRITE,&h)==ESP_OK);
    assert(nvs_set_blob(h,key,value,strlen(value)+1)==ESP_OK&&nvs_commit(h)==ESP_OK);nvs_close(h);
}
static bool has(const char *space,const char *key) {
    nvs_handle_t h;esp_err_t rc=nvs_open(space,NVS_READONLY,&h);if(rc==ESP_ERR_NVS_NOT_FOUND)return false;
    assert(rc==ESP_OK);size_t bytes=0;rc=nvs_get_blob(h,key,NULL,&bytes);nvs_close(h);
    assert(rc==ESP_OK||rc==ESP_ERR_NVS_NOT_FOUND);return rc==ESP_OK;
}
static cJSON *configuration(void) {
    cJSON *c=mt_config_empty();cJSON_AddStringToObject(c,"buildFlavor","test-only");
    const char *ids[]={"HostA","HostB"};
    for(unsigned i=0;i<2;i++){
        cJSON *s=cJSON_CreateObject();cJSON_AddItemToArray(cJSON_GetObjectItem(c,"servers"),s);
        cJSON_AddStringToObject(s,"id",ids[i]);cJSON_AddStringToObject(s,"name","Same display name");
        cJSON_AddStringToObject(s,"bluetoothName",ids[i]);cJSON_AddStringToObject(s,"secret","0123456789abcdef0123456789abcdef");
        cJSON *wifi=cJSON_AddObjectToObject(s,"wifi");cJSON_AddStringToObject(wifi,"ssid",i?"NetworkB":"NetworkA");
        cJSON_AddStringToObject(wifi,"password","test-only-password");cJSON_AddStringToObject(wifi,"url","ws://192.168.1.20:28743/device");
    }
    assert(mt_config_valid(c));return c;
}
static unsigned count(void) {
    cJSON *c=mt_config_load();assert(c);unsigned n=cJSON_GetArraySize(cJSON_GetObjectItem(c,"servers"));cJSON_Delete(c);return n;
}
static void seed_bond(const char *id,uint8_t address[6]) {
    assert(mt_bond_prepare(id,address)==ESP_OK);nvs_handle_t h;
    assert(__wrap_nvs_open("nimble_bond",NVS_READWRITE,&h)==ESP_OK);
    assert(nvs_set_blob(h,"our_sec_1",id,strlen(id)+1)==ESP_OK&&nvs_commit(h)==ESP_OK);nvs_close(h);
}
int main(int argc,char **argv) {
    assert(mt_server_delete_recover()==ESP_OK);
    cJSON *config=configuration();assert(mt_config_save(config)==ESP_OK);
    uint8_t a[6],b[6],again[6];seed_bond("HostA",a);seed_bond("HostB",b);
    char root_a[16],bank_a[16],old_a[16];assert(mt_bond_namespace("HostA",root_a));
    snprintf(bank_a,sizeof(bank_a),"%s",root_a);bank_a[1]='a';snprintf(old_a,sizeof(old_a),"%s",root_a);old_a[1]='b';
    put(old_a,"old_keys","inactive-generation");put("mtb_pending","temporary","enrollment-copy");
    put("nimble_bond","legacy","unassigned");put("unrelated","key","preserve");
    assert(mt_server_delete("missing")==ESP_ERR_NOT_FOUND&&count()==2);
    assert(mt_server_delete("bad id")==ESP_ERR_INVALID_ARG&&!has("mt_delete","pending"));
    // A failed durable intent cannot authorize partial erasure.
    fail_commit_space="mt_delete";assert(mt_server_delete("HostA")!=ESP_OK);fail_commit_space=NULL;
    assert(count()==2&&has(bank_a,"our_sec_1")&&has(old_a,"old_keys")&&!has("mt_delete","pending"));
    // Interrupted midway through two generations: retain intent; block other deletion.
    fail_commit_space=old_a;assert(mt_server_delete("HostA")!=ESP_OK);
    assert(has("mt_delete","pending")&&count()==2&&!has(bank_a,"our_sec_1")&&has(old_a,"old_keys"));
    assert(mt_server_delete("HostB")==ESP_ERR_INVALID_STATE);fail_commit_space=NULL;
    assert(mt_server_delete_recover()==ESP_OK&&count()==1&&!has("mt_delete","pending"));
    assert(!has(root_a,"profile")&&!has(old_a,"old_keys")&&!has("mtb_pending","temporary"));
    assert(has("nimble_bond","legacy")&&has("unrelated","key"));
    assert(mt_bond_prepare("HostB",again)==ESP_OK&&!memcmp(b,again,6));
    cJSON *remaining=mt_config_load(),*expected=mt_config_remove_server(config,"HostA");
    assert(cJSON_Compare(remaining,expected,true));cJSON_Delete(remaining);cJSON_Delete(expected);
    assert(mt_server_delete_recover()==ESP_OK); // repeated boot is harmless
    assert(mt_config_save(config)==ESP_OK);seed_bond("HostA",again);assert(memcmp(a,again,6));
    // Config commit fails AFTER bond deletion: next boot completes without reviving keys.
    fail_commit_space="mirtar";assert(mt_server_delete("HostA")!=ESP_OK);fail_commit_space=NULL;
    assert(count()==2&&!has(root_a,"profile")&&has("mt_delete","pending"));
    assert(mt_server_delete_recover()==ESP_OK&&count()==1);
    assert(mt_bond_prepare("HostB",again)==ESP_OK&&!memcmp(b,again,6));
    // Lost journal-clear commit AFTER final host removal: recovery handles empty list.
    fail_commit_space="mt_delete";fail_commit_skip=1;assert(mt_server_delete("HostB")!=ESP_OK);fail_commit_space=NULL;
    assert(count()==0&&has("mt_delete","pending"));assert(mt_server_delete_recover()==ESP_OK);
    assert(count()==0&&!has("mt_delete","pending")&&has("nimble_bond","legacy"));
    // Refuse a foreign owner even if a storage index is reused/corrupted.
    assert(mt_config_save(config)==ESP_OK);seed_bond("HostA",again);
    nvs_handle_t h;assert(nvs_open(root_a,NVS_READWRITE,&h)==ESP_OK);unsigned char profile[55];size_t bytes=sizeof(profile);
    assert(nvs_get_blob(h,"profile",profile,&bytes)==ESP_OK);profile[7]='X';
    assert(nvs_set_blob(h,"profile",profile,sizeof(profile))==ESP_OK&&nvs_commit(h)==ESP_OK);nvs_close(h);
    assert(mt_server_delete("HostA")==ESP_ERR_INVALID_STATE&&count()==2&&has(bank_a,"our_sec_1"));
    profile[7]='H';assert(nvs_open(root_a,NVS_READWRITE,&h)==ESP_OK);
    assert(nvs_set_blob(h,"profile",profile,sizeof(profile))==ESP_OK&&nvs_commit(h)==ESP_OK);nvs_close(h);
    assert(mt_server_delete_recover()==ESP_OK&&count()==1);
    // Wi-Fi-only host without a Bluetooth profile must also be removable.
    cJSON *only=mt_config_empty(),*s=cJSON_Duplicate(cJSON_GetArrayItem(cJSON_GetObjectItem(config,"servers"),0),true);
    cJSON_ReplaceItemInObjectCaseSensitive(s,"id",cJSON_CreateString("WifiOnly"));
    cJSON_AddItemToArray(cJSON_GetObjectItem(only,"servers"),s);assert(mt_config_save(only)==ESP_OK);
    assert(mt_server_delete("WifiOnly")==ESP_OK&&count()==0);cJSON_Delete(only);cJSON_Delete(config);
    const char *receipt="PASS: whole-server deletion, two-bank erasure, same-name host isolation, empty list, fresh re-add identity, journal/config/bank failure recovery and collision guard";
    puts(receipt);if(argc==2){FILE *f=fopen(argv[1],"wb");assert(f);assert(fputs(receipt,f)>=0&&fclose(f)==0);}return 0;
}
