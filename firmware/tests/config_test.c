#include <assert.h>
#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include "runtime_config.h"
#include "state.h"
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

static const char *text(const cJSON *o,const char *key){return cJSON_GetObjectItemCaseSensitive(o,key)->valuestring;}
static cJSON *with_server(const char *id,const char *ssid){
    cJSON *config=mt_config_empty(),*server=cJSON_CreateObject();
    cJSON_AddStringToObject(server,"id",id);cJSON_AddStringToObject(server,"name",id);cJSON_AddStringToObject(server,"bluetoothName",id);
    cJSON_AddStringToObject(server,"secret","0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");
    if(ssid){cJSON *wifi=cJSON_AddObjectToObject(server,"wifi");cJSON_AddStringToObject(wifi,"ssid",ssid);cJSON_AddStringToObject(wifi,"password","test-pass-1");cJSON_AddStringToObject(wifi,"url","ws://192.168.1.10:28743/device");}
    cJSON_AddItemToArray(cJSON_GetObjectItem(config,"servers"),server);assert(mt_config_valid(config));return config;
}
int main(int argc,char **argv){
    if(argc==3&&!strcmp(argv[1],"--validate")){
        FILE *file=fopen(argv[2],"rb");assert(file);char buffer[MT_CONFIG_LIMIT+4];size_t count=fread(buffer,1,sizeof(buffer)-1,file);assert(!ferror(file));fclose(file);buffer[count]=0;
        char *json=buffer;size_t offset=count>=3&&(unsigned char)buffer[0]==0xef&&(unsigned char)buffer[1]==0xbb&&(unsigned char)buffer[2]==0xbf?3:0;
        json+=offset;cJSON *input=mt_config_parse(json,count-offset+1);assert(mt_config_valid(input));
        printf("Private version 2 file validated: %d hosts; credential values suppressed.\n",cJSON_GetArraySize(cJSON_GetObjectItem(input,"servers")));cJSON_Delete(input);return 0;
    }
    cJSON *base=mt_config_load();assert(base&&mt_config_valid(base));assert(!mt_config_server_wifi(base,0));assert(cJSON_GetArraySize(cJSON_GetObjectItem(base,"servers"))==0);
    cJSON_AddStringToObject(base,"buildFlavor","test-only");assert(mt_config_valid(base));
    cJSON_ReplaceItemInObjectCaseSensitive(base,"buildFlavor",cJSON_CreateString("not a valid label"));assert(!mt_config_valid(base));
    cJSON_DeleteItemFromObjectCaseSensitive(base,"buildFlavor");
    cJSON *first=with_server("OfficeLaptop","OfficeNetwork"),*second=with_server("HomeLaptop","HomeNetwork");
    cJSON *both=mt_config_import(first,second);assert(both);
    assert(!strcmp(text(mt_config_server_wifi(both,0),"ssid"),"OfficeNetwork"));
    assert(!strcmp(text(mt_config_server_wifi(both,1),"ssid"),"HomeNetwork"));assert(!mt_config_server_wifi(both,2));
    cJSON *offer_config=with_server("HomeLaptop",NULL),*offer=cJSON_GetArrayItem(cJSON_GetObjectItem(offer_config,"servers"),0);
    cJSON *enrolled=mt_config_enroll(both,offer);assert(enrolled&&!strcmp(text(mt_config_server_wifi(enrolled,1),"ssid"),"HomeNetwork"));cJSON_Delete(enrolled);
    cJSON_AddNullToObject(offer,"wifi");assert(!mt_config_enroll(both,offer));cJSON_Delete(offer_config);
    assert(mt_config_save(both)==ESP_OK);cJSON *restored=mt_config_load();assert(restored&&mt_config_valid(restored));cJSON_Delete(restored);
    cJSON *update=with_server("HomeLaptop","NewHomeNetwork");cJSON *changed=mt_config_import(both,update);assert(changed);
    assert(cJSON_GetArraySize(cJSON_GetObjectItem(changed,"servers"))==2);
    assert(!strcmp(text(mt_config_server_wifi(changed,0),"ssid"),"OfficeNetwork"));
    assert(!strcmp(text(mt_config_server_wifi(changed,1),"ssid"),"NewHomeNetwork"));
    fail_commit=true;assert(mt_config_save(changed)!=ESP_OK);fail_commit=false;restored=mt_config_load();
    assert(!strcmp(text(mt_config_server_wifi(restored,1),"ssid"),"HomeNetwork"));cJSON_Delete(restored);
    cJSON *bluetooth=with_server("TravelLaptop",NULL),*three=mt_config_import(both,bluetooth);assert(three&&!mt_config_server_wifi(three,2));
    cJSON *fourth=with_server("SpareLaptop",NULL),*four=mt_config_import(three,fourth);assert(four);
    cJSON *fifth=with_server("FifthLaptop",NULL);assert(!mt_config_import(four,fifth));
    cJSON *dup=cJSON_Duplicate(first,true);cJSON_AddItemToArray(cJSON_GetObjectItem(dup,"servers"),cJSON_Duplicate(cJSON_GetArrayItem(cJSON_GetObjectItem(dup,"servers"),0),true));assert(!mt_config_valid(dup));cJSON_Delete(dup);
    cJSON_ReplaceItemInObjectCaseSensitive(second,"deviceId",cJSON_CreateString("different-card"));assert(!mt_config_import(first,second));
    cJSON *adopt=mt_config_import(base,second);assert(adopt&&!strcmp(text(adopt,"deviceId"),"different-card"));cJSON_Delete(adopt);
    cJSON_AddArrayToObject(first,"wifiNetworks");assert(!mt_config_valid(first));cJSON_DeleteItemFromObjectCaseSensitive(first,"wifiNetworks");
    cJSON_AddTrueToObject(first,"template");assert(!mt_config_valid(first));cJSON_DeleteItemFromObjectCaseSensitive(first,"template");
    cJSON *invalid=cJSON_GetObjectItemCaseSensitive(cJSON_GetArrayItem(cJSON_GetObjectItem(first,"servers"),0),"wifi");
    cJSON_ReplaceItemInObjectCaseSensitive(invalid,"password",cJSON_CreateString("short"));assert(!mt_config_valid(first));
    const char *nul="{\"name\":\"a\\u0000b\"}";assert(!mt_config_parse(nul,strlen(nul)+1));assert(!mt_config_parse("{}{}",5));
    const char *deep="[[[[[[[[[[[[[0]]]]]]]]]]]]]";assert(!mt_config_parse(deep,strlen(deep)+1));
    const char *escaped_text="{\"name\":\"a\\\\u0000b\"}";cJSON *escaped=mt_config_parse(escaped_text,strlen(escaped_text)+1);assert(escaped);cJSON_Delete(escaped);
    char *raw=cJSON_PrintUnformatted(second);char duplicated[MT_CONFIG_LIMIT+1];snprintf(duplicated,sizeof(duplicated),"%.*s,\"version\":2}",(int)strlen(raw)-1,raw);free(raw);
    cJSON *duplicate=mt_config_parse(duplicated,strlen(duplicated)+1);assert(duplicate&&!mt_config_valid(duplicate));cJSON_Delete(duplicate);
    mt_state_t state={.page=MT_HOME,.connected=true,.bound=true,.session_count=1};assert(!mt_can_record(&state));
    state.page=MT_PAIR_CONFIRM;assert(!mt_can_record(&state));state.page=MT_READING;assert(mt_can_record(&state));state.submitting=true;assert(!mt_can_record(&state));mt_disconnect(&state);assert(!mt_can_record(&state));
    memcpy(stored,"not-json",9);stored_size=9;assert(!mt_config_load());
    cJSON_Delete(base);cJSON_Delete(first);cJSON_Delete(second);cJSON_Delete(both);cJSON_Delete(update);cJSON_Delete(changed);cJSON_Delete(bluetooth);cJSON_Delete(three);cJSON_Delete(fourth);cJSON_Delete(four);cJSON_Delete(fifth);
    const char *receipt="Configuration round-trip, per-host Wi-Fi, ID merge, import limits, commit failure and menu record guards: PASS";
    puts(receipt);if(argc==2){FILE *file=fopen(argv[1],"wb");assert(file);assert(fputs(receipt,file)>=0);assert(fclose(file)==0);}return 0;
}
