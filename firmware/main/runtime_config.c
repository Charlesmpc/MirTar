#include "runtime_config.h"
#include <string.h>
#include <stdlib.h>
#include <ctype.h>
#include "nvs.h"

static const char defaults[] = "{\"version\":2,\"deviceId\":\"mirtar-new\",\"skin\":\"reading\",\"allowLanPlaintext\":true,\"servers\":[]}";
cJSON *mt_config_empty(void) { return cJSON_Parse(defaults); }
static const char *field(const cJSON *o, const char *key) {
    const cJSON *v=cJSON_GetObjectItemCaseSensitive(o,key); return cJSON_IsString(v)?v->valuestring:NULL;
}
static bool identifier(const char *s,size_t max) {
    if(!s||!*s||strlen(s)>max)return false;
    for(const unsigned char *p=(const unsigned char *)s;*p;p++)if(!isalnum(*p)&&*p!='_'&&*p!='-')return false;
    return true;
}
cJSON *mt_config_parse(const char *json,size_t length) {
    if(!json||!length||length>MT_CONFIG_LIMIT+1||json[length-1])return NULL;
    int depth=0;bool quoted=false;
    for(size_t i=0;i+1<length;i++) {
        if(!json[i])return NULL;
        if(json[i]=='\\') { if(i+5<length&&!memcmp(json+i+1,"u0000",5))return NULL; i++; }
        else if(json[i]=='"')quoted=!quoted;
        else if(!quoted&&(json[i]=='{'||json[i]=='[')){if(++depth>12)return NULL;}
        else if(!quoted&&(json[i]=='}'||json[i]==']'))depth--;
    }
    return cJSON_ParseWithLengthOpts(json,length,NULL,true);
}
static bool unique_keys(const cJSON *object) {
    const cJSON *a,*b;
    if(cJSON_IsObject(object)) {
        cJSON_ArrayForEach(a,object) {
            for(b=a->next;b;b=b->next)if(!strcmp(a->string,b->string))return false;
            if(!unique_keys(a))return false;
        }
    } else if(cJSON_IsArray(object)) { cJSON_ArrayForEach(a,object)if(!unique_keys(a))return false; }
    return true;
}
static bool wifi_valid(const cJSON *wifi) {
    if(!wifi||cJSON_IsNull(wifi))return true;
    const char *ssid=field(wifi,"ssid"),*password=field(wifi,"password"),*url=field(wifi,"url");
    if(!cJSON_IsObject(wifi)||!ssid||!*ssid||strlen(ssid)>32||!password||
       (*password&&(strlen(password)<8||strlen(password)>63))||!url||strncmp(url,"ws://",5)||strlen(url)<8||strlen(url)>=200||strchr(url,'@'))return false;
    for(const unsigned char *p=(const unsigned char *)url;*p;p++)if(*p<=32||*p==127)return false;
    return true;
}
bool mt_config_valid(const cJSON *config) {
    const cJSON *version=cJSON_GetObjectItemCaseSensitive(config,"version"),*servers=cJSON_GetObjectItemCaseSensitive(config,"servers");
    const char *skin=field(config,"skin");
    const cJSON *flavor=cJSON_GetObjectItemCaseSensitive(config,"buildFlavor");
    if(flavor&&!identifier(field(config,"buildFlavor"),20))return false;
    if(!cJSON_IsObject(config)||!unique_keys(config)||!cJSON_IsNumber(version)||version->valuedouble!=2||
       !identifier(field(config,"deviceId"),40)||!skin||(strcmp(skin,"reading")&&strcmp(skin,"terminal"))||
       !cJSON_IsTrue(cJSON_GetObjectItemCaseSensitive(config,"allowLanPlaintext"))||
       cJSON_IsTrue(cJSON_GetObjectItemCaseSensitive(config,"template"))||
       cJSON_GetObjectItemCaseSensitive(config,"wifiNetworks")||cJSON_GetObjectItemCaseSensitive(config,"targets")||
       !cJSON_IsArray(servers)||cJSON_GetArraySize(servers)>4)return false;
    const cJSON *s,*other;
    cJSON_ArrayForEach(s,servers) {
        const char *name=field(s,"name"),*secret=field(s,"secret");
        if(!identifier(field(s,"id"),40)||!name||!*name||strlen(name)>40||!identifier(field(s,"bluetoothName"),20)||
           !secret||strlen(secret)<32||strlen(secret)>128||!strncmp(secret,"REPLACE_WITH_",13)||!strncmp(secret,"FILL_LOCALLY",12)||!strncmp(secret,"SAME_LOCAL_",11)||
           cJSON_GetObjectItemCaseSensitive(s,"url")||cJSON_GetObjectItemCaseSensitive(s,"wifiNetworks")||
           !wifi_valid(cJSON_GetObjectItemCaseSensitive(s,"wifi")))return false;
        for(const unsigned char *p=(const unsigned char *)name;*p;p++)if(*p<32||*p==127)return false;
        for(other=s->next;other;other=other->next) {
            const char *id=field(other,"id"),*bt=field(other,"bluetoothName");
            if((id&&!strcmp(field(s,"id"),id))||(bt&&!strcmp(field(s,"bluetoothName"),bt)))return false;
        }
    }
    char *text=cJSON_PrintUnformatted(config); bool ok=text&&strlen(text)<=MT_CONFIG_LIMIT;free(text);return ok;
}
cJSON *mt_config_load(void) {
    nvs_handle_t handle;esp_err_t result=nvs_open("mirtar",NVS_READONLY,&handle);
    if(result==ESP_ERR_NVS_NOT_FOUND)return mt_config_empty();
    if(result!=ESP_OK)return NULL;
    size_t bytes=0;result=nvs_get_blob(handle,"config",NULL,&bytes);
    if(result==ESP_ERR_NVS_NOT_FOUND){nvs_close(handle);return mt_config_empty();}
    if(result!=ESP_OK||bytes<2||bytes>MT_CONFIG_LIMIT+1){nvs_close(handle);return NULL;}
    char *text=malloc(bytes);if(!text){nvs_close(handle);return NULL;}
    result=nvs_get_blob(handle,"config",text,&bytes);nvs_close(handle);
    cJSON *config=result==ESP_OK?mt_config_parse(text,bytes):NULL;free(text);
    if(!mt_config_valid(config)){cJSON_Delete(config);return NULL;}return config;
}
esp_err_t mt_config_save(const cJSON *config) {
    if(!mt_config_valid(config))return ESP_ERR_INVALID_ARG;
    char *text=cJSON_PrintUnformatted(config);if(!text)return ESP_ERR_NO_MEM;
    nvs_handle_t handle;esp_err_t result=nvs_open("mirtar",NVS_READWRITE,&handle);
    if(result==ESP_OK){result=nvs_set_blob(handle,"config",text,strlen(text)+1);if(result==ESP_OK)result=nvs_commit(handle);nvs_close(handle);}
    memset(text,0,strlen(text));free(text);return result;
}
cJSON *mt_config_import(const cJSON *base,const cJSON *incoming) {
    if(!mt_config_valid(base)||!mt_config_valid(incoming))return NULL;
    const cJSON *items=cJSON_GetObjectItemCaseSensitive(incoming,"servers");
    if(!cJSON_GetArraySize(items))return NULL;
    bool existing=cJSON_GetArraySize(cJSON_GetObjectItemCaseSensitive(base,"servers"))>0;
    if(existing&&strcmp(field(base,"deviceId"),field(incoming,"deviceId")))return NULL;
    cJSON *merged=cJSON_Duplicate(base,true);if(!merged)return NULL;
    const char *keys[]={"deviceId","skin","allowLanPlaintext"};
    for(unsigned i=0;i<sizeof(keys)/sizeof(keys[0]);i++) {
        cJSON *copy=cJSON_Duplicate(cJSON_GetObjectItemCaseSensitive(incoming,keys[i]),true);
        if(!copy||!cJSON_ReplaceItemInObjectCaseSensitive(merged,keys[i],copy)){cJSON_Delete(copy);cJSON_Delete(merged);return NULL;}
    }
    cJSON *list=cJSON_GetObjectItemCaseSensitive(merged,"servers");const cJSON *item;
    cJSON_ArrayForEach(item,items) {
        int index=-1;
        for(int i=0;i<cJSON_GetArraySize(list);i++)if(!strcmp(field(cJSON_GetArrayItem(list,i),"id"),field(item,"id"))){index=i;break;}
        cJSON *copy=cJSON_Duplicate(item,true);
        if(!copy||(index<0&&cJSON_GetArraySize(list)>=4)){cJSON_Delete(copy);cJSON_Delete(merged);return NULL;}
        bool ok=index<0?cJSON_AddItemToArray(list,copy):cJSON_ReplaceItemInArray(list,index,copy);
        if(!ok){cJSON_Delete(copy);cJSON_Delete(merged);return NULL;}
    }
    if(!mt_config_valid(merged)){cJSON_Delete(merged);return NULL;}return merged;
}
const cJSON *mt_config_server_wifi(const cJSON *config,int index) {
    const cJSON *s=cJSON_GetArrayItem(cJSON_GetObjectItemCaseSensitive(config,"servers"),index);
    const cJSON *wifi=cJSON_GetObjectItemCaseSensitive(s,"wifi");return cJSON_IsObject(wifi)?wifi:NULL;
}
cJSON *mt_config_enroll(const cJSON *base,const cJSON *server) {
    if(!mt_config_valid(base)||!cJSON_IsObject(server)||cJSON_GetObjectItemCaseSensitive(server,"wifi"))return NULL;
    cJSON *incoming=cJSON_Duplicate(base,true),*list=cJSON_CreateArray(),*copy=cJSON_Duplicate(server,true);
    if(!incoming||!list||!copy){cJSON_Delete(incoming);cJSON_Delete(list);cJSON_Delete(copy);return NULL;}
    const char *id=field(server,"id");const cJSON *saved;
    cJSON_ArrayForEach(saved,cJSON_GetObjectItemCaseSensitive(base,"servers")) {
        if(id&&!strcmp(field(saved,"id"),id)) {
            const cJSON *wifi=cJSON_GetObjectItemCaseSensitive(saved,"wifi");
            if(wifi){cJSON *profile=cJSON_Duplicate(wifi,true);if(!profile||!cJSON_AddItemToObject(copy,"wifi",profile)){cJSON_Delete(profile);cJSON_Delete(copy);cJSON_Delete(list);cJSON_Delete(incoming);return NULL;}}
            break;
        }
    }
    cJSON_AddItemToArray(list,copy);cJSON_ReplaceItemInObjectCaseSensitive(incoming,"servers",list);
    cJSON *result=mt_config_import(base,incoming);cJSON_Delete(incoming);return result;
}
