#include "server_delete.h"
#include "runtime_config.h"
#include "bond_store.h"
#include "nvs.h"
#include <string.h>

#define JOURNAL "mt_delete"
#define KEY "pending"
typedef struct { char magic[4], id[41]; } intent_t;

static esp_err_t read_intent(intent_t *intent,bool *present) {
    *present=false;
    nvs_handle_t handle;esp_err_t rc=nvs_open(JOURNAL,NVS_READONLY,&handle);
    if(rc==ESP_ERR_NVS_NOT_FOUND)return ESP_OK;
    if(rc!=ESP_OK)return rc;
    size_t bytes=sizeof(*intent);rc=nvs_get_blob(handle,KEY,intent,&bytes);nvs_close(handle);
    if(rc==ESP_ERR_NVS_NOT_FOUND)return ESP_OK;
    if(rc!=ESP_OK)return rc;
    char space[16];
    if(bytes!=sizeof(*intent)||memcmp(intent->magic,"MDL1",4)||
       !memchr(intent->id,0,sizeof(intent->id))||!mt_bond_namespace(intent->id,space))return ESP_ERR_INVALID_STATE;
    *present=true;return ESP_OK;
}
esp_err_t mt_server_delete_recover(void) {
    intent_t intent;bool present;esp_err_t rc=read_intent(&intent,&present);
    if(rc!=ESP_OK||!present)return rc;
    cJSON *base=mt_config_load();if(!base)return ESP_ERR_INVALID_STATE;
    bool found=false;const cJSON *server;
    cJSON_ArrayForEach(server,cJSON_GetObjectItemCaseSensitive(base,"servers")) {
        const cJSON *id=cJSON_GetObjectItemCaseSensitive(server,"id");
        if(!strcmp(id->valuestring,intent.id)){found=true;break;}
    }
    cJSON *next=found?mt_config_remove_server(base,intent.id):NULL;
    if(found&&!next){cJSON_Delete(base);return ESP_ERR_NO_MEM;}
    // Each step can be repeated after power loss. Keep the durable intent until
    // BOTH Bluetooth generations and the entire server config have been erased.
    rc=mt_bond_forget(intent.id);
    if(rc==ESP_OK&&found)rc=mt_config_save(next);
    cJSON_Delete(next);cJSON_Delete(base);
    if(rc!=ESP_OK)return rc;
    nvs_handle_t handle;rc=nvs_open(JOURNAL,NVS_READWRITE,&handle);
    if(rc==ESP_OK){rc=nvs_erase_all(handle);if(rc==ESP_OK)rc=nvs_commit(handle);nvs_close(handle);}
    return rc;
}
esp_err_t mt_server_delete(const char *id) {
    char space[16];if(!mt_bond_namespace(id,space))return ESP_ERR_INVALID_ARG;
    intent_t intent;bool present;esp_err_t rc=read_intent(&intent,&present);
    if(rc!=ESP_OK)return rc;
    if(present)return !strcmp(intent.id,id)?mt_server_delete_recover():ESP_ERR_INVALID_STATE;
    cJSON *base=mt_config_load();if(!base)return ESP_ERR_INVALID_STATE;
    bool found=false;const cJSON *server;
    cJSON_ArrayForEach(server,cJSON_GetObjectItemCaseSensitive(base,"servers"))
        if(!strcmp(cJSON_GetObjectItemCaseSensitive(server,"id")->valuestring,id)){found=true;break;}
    if(!found){cJSON_Delete(base);return ESP_ERR_NOT_FOUND;}
    cJSON *next=mt_config_remove_server(base,id);cJSON_Delete(base);
    if(!next)return ESP_ERR_NO_MEM;
    cJSON_Delete(next);
    memset(&intent,0,sizeof(intent));memcpy(intent.magic,"MDL1",4);memcpy(intent.id,id,strlen(id));
    nvs_handle_t handle;rc=nvs_open(JOURNAL,NVS_READWRITE,&handle);
    if(rc==ESP_OK){rc=nvs_set_blob(handle,KEY,&intent,sizeof(intent));if(rc==ESP_OK)rc=nvs_commit(handle);nvs_close(handle);}
    if(rc!=ESP_OK)return rc;
    return mt_server_delete_recover();
}
