#include "bond_store.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "esp_random.h"
#include "nvs.h"

#define STAGING "mtb_pending"
#define META "profile"
// No pointers or native integers: versioned, reproducible binary format.
typedef struct {
    uint8_t magic[4], sdk[3];
    char server_id[41];
    uint8_t address[6], bank;
} profile_t;
_Static_assert(sizeof(profile_t)==55,"Unexpected profile layout");
static char active_namespace[16], active_server[41];
static bool staging;

static bool valid_id(const char *id) {
    if(!id||!*id||strlen(id)>40)return false;
    for(const unsigned char *p=(const unsigned char *)id;*p;p++)
        if(!((*p>='a'&&*p<='z')||(*p>='A'&&*p<='Z')||(*p>='0'&&*p<='9')||*p=='-'||*p=='_'))return false;
    return true;
}
bool mt_bond_namespace(const char *id,char output[16]) {
    if(!valid_id(id)||!output)return false;
    // This hash is a storage index, not authentication. Full IDs are checked too.
    uint64_t hash=UINT64_C(14695981039346656037);
    for(const unsigned char *p=(const unsigned char *)id;*p;p++){hash^=*p;hash*=UINT64_C(1099511628211);}
    snprintf(output,16,"mi_%012llx",(unsigned long long)(hash&UINT64_C(0xffffffffffff)));
    return true;
}
static void new_profile(profile_t *p,const char *id) {
    memset(p,0,sizeof(*p));memcpy(p->magic,"MBT1",4);
    p->sdk[0]=5;p->sdk[1]=5;p->sdk[2]=6;
    if(id)snprintf(p->server_id,sizeof(p->server_id),"%s",id);
    do {
        esp_fill_random(p->address,6);p->address[5]=(p->address[5]&0x3f)|0xc0;
    } while((!p->address[0]&&!p->address[1]&&!p->address[2]&&!p->address[3]&&!p->address[4]&&p->address[5]==0xc0)||
            (p->address[0]==0xff&&p->address[1]==0xff&&p->address[2]==0xff&&p->address[3]==0xff&&p->address[4]==0xff&&p->address[5]==0xff));
}
static esp_err_t read_profile(nvs_handle_t handle,profile_t *p,const char *id) {
    size_t size=sizeof(*p);esp_err_t rc=nvs_get_blob(handle,META,p,&size);
    if(rc!=ESP_OK)return rc;
    if(size!=sizeof(*p)||memcmp(p->magic,"MBT1",4)||p->sdk[0]!=5||p->sdk[1]!=5||p->sdk[2]!=6||
       !memchr(p->server_id,0,sizeof(p->server_id))||strcmp(p->server_id,id?id:"")||p->bank>1||(p->address[5]&0xc0)!=0xc0)return ESP_ERR_INVALID_STATE;
    return ESP_OK;
}
static void bank_namespace(const char *root,uint8_t bank,char output[16]){snprintf(output,16,"%s",root);output[1]=bank?'b':'a';}
static esp_err_t erase_bank(const char *space){
    nvs_handle_t h;esp_err_t rc=nvs_open(space,NVS_READWRITE,&h);if(rc!=ESP_OK)return rc;
    rc=nvs_erase_all(h);if(rc==ESP_OK)rc=nvs_commit(h);nvs_close(h);return rc;
}
esp_err_t mt_bond_prepare(const char *id,uint8_t address[6]) {
    char space[16];if(!address||(id&&!mt_bond_namespace(id,space)))return ESP_ERR_INVALID_ARG;
    if(!id)snprintf(space,sizeof(space),"%s",STAGING);
    nvs_handle_t handle;esp_err_t rc=nvs_open(space,NVS_READWRITE,&handle);if(rc!=ESP_OK)return rc;
    profile_t p;
    if(!id){rc=nvs_erase_all(handle);if(rc==ESP_OK){new_profile(&p,NULL);rc=nvs_set_blob(handle,META,&p,sizeof(p));if(rc==ESP_OK)rc=nvs_commit(handle);}}
    else {
        rc=read_profile(handle,&p,id);
        if(rc==ESP_ERR_NVS_NOT_FOUND){
            new_profile(&p,id);char bank[16];bank_namespace(space,p.bank,bank);rc=erase_bank(bank);
            if(rc==ESP_OK)rc=nvs_set_blob(handle,META,&p,sizeof(p));
            if(rc==ESP_OK)rc=nvs_commit(handle);
        }
    }
    nvs_close(handle);
    if(rc==ESP_OK){
        if(id)bank_namespace(space,p.bank,active_namespace);else snprintf(active_namespace,sizeof(active_namespace),"%s",space);
        snprintf(active_server,sizeof(active_server),"%s",id?id:"");staging=!id;memcpy(address,p.address,6);
    }
    return rc;
}
bool mt_bond_matches(const char *id){return valid_id(id)&&!staging&&active_namespace[0]&&!strcmp(active_server,id);}

// Interpose only the SDK's NimBLE namespace. MirTar config and all other NVS
// callers pass through unchanged. The active profile changes only with host off.
esp_err_t __real_nvs_open(const char *,nvs_open_mode_t,nvs_handle_t *);
esp_err_t __wrap_nvs_open(const char *,nvs_open_mode_t,nvs_handle_t *);
esp_err_t __wrap_nvs_open(const char *space,nvs_open_mode_t mode,nvs_handle_t *handle) {
    if(space&&!strcmp(space,"nimble_bond")){
        if(!active_namespace[0])return ESP_ERR_INVALID_STATE;
        return __real_nvs_open(active_namespace,mode,handle);
    }
    return __real_nvs_open(space,mode,handle);
}
esp_err_t mt_bond_promote(const char *id) {
    char space[16];if(!staging||strcmp(active_namespace,STAGING)||!mt_bond_namespace(id,space))return ESP_ERR_INVALID_STATE;
    nvs_handle_t source,target,root;esp_err_t rc=nvs_open(STAGING,NVS_READONLY,&source);if(rc!=ESP_OK)return rc;
    profile_t p;rc=read_profile(source,&p,NULL);if(rc!=ESP_OK){nvs_close(source);return rc;}
    rc=nvs_open(space,NVS_READWRITE,&root);if(rc!=ESP_OK){nvs_close(source);return rc;}
    profile_t old;rc=read_profile(root,&old,id);bool exists=rc==ESP_OK;
    if(!exists&&rc!=ESP_ERR_NVS_NOT_FOUND){nvs_close(source);nvs_close(root);return rc;}
    p.bank=exists?1-old.bank:0;char target_space[16];bank_namespace(space,p.bank,target_space);
    rc=nvs_open(target_space,NVS_READWRITE,&target);if(rc!=ESP_OK){nvs_close(source);nvs_close(root);return rc;}
    rc=nvs_erase_all(target);
    nvs_iterator_t it=NULL;
    esp_err_t scan=rc==ESP_OK?nvs_entry_find("nvs",STAGING,NVS_TYPE_ANY,&it):rc;
    unsigned entries=0;
    while(rc==ESP_OK&&scan==ESP_OK){
        nvs_entry_info_t info;nvs_entry_info(it,&info);
        if(info.type!=NVS_TYPE_BLOB||++entries>64){rc=ESP_ERR_INVALID_STATE;break;}
        if(strcmp(info.key,META)){
            size_t bytes=0;rc=nvs_get_blob(source,info.key,NULL,&bytes);
            if(rc==ESP_OK&&(!bytes||bytes>4096))rc=ESP_ERR_INVALID_SIZE;
            size_t allocated=bytes;void *data=rc==ESP_OK?malloc(bytes):NULL;if(rc==ESP_OK&&!data)rc=ESP_ERR_NO_MEM;
            if(rc==ESP_OK)rc=nvs_get_blob(source,info.key,data,&bytes);
            if(rc==ESP_OK)rc=nvs_set_blob(target,info.key,data,bytes);
            if(data){memset(data,0,allocated);free(data);}
        }
        if(rc==ESP_OK)scan=nvs_entry_next(&it);
    }
    nvs_release_iterator(it);
    if(rc==ESP_OK&&scan!=ESP_ERR_NVS_NOT_FOUND)rc=scan;
    if(rc==ESP_OK)rc=nvs_commit(target);
    // Publish a fully copied generation through one atomic metadata blob. A
    // failed copy/commit leaves the prior server generation selected.
    if(rc==ESP_OK){snprintf(p.server_id,sizeof(p.server_id),"%s",id);rc=nvs_set_blob(root,META,&p,sizeof(p));}
    if(rc==ESP_OK)rc=nvs_commit(root);
    nvs_close(source);nvs_close(target);nvs_close(root);
    if(rc==ESP_OK&&exists){char old_space[16];bank_namespace(space,old.bank,old_space);erase_bank(old_space);}
    // Keep the live enrollment link on staging until normal host shutdown. The
    // next connection selects its persisted server ID and the same local identity.
    return rc;
}
esp_err_t mt_bond_reset(const char *id) {
    char space[16];if(!mt_bond_matches(id)||!mt_bond_namespace(id,space))return ESP_ERR_INVALID_STATE;
    nvs_handle_t handle;esp_err_t rc=nvs_open(space,NVS_READWRITE,&handle);if(rc!=ESP_OK)return rc;
    profile_t old,p;rc=read_profile(handle,&old,id);
    if(rc==ESP_OK){
        do{new_profile(&p,id);}while(!memcmp(p.address,old.address,6));
        p.bank=1-old.bank;char fresh[16];bank_namespace(space,p.bank,fresh);rc=erase_bank(fresh);
        if(rc==ESP_OK)rc=nvs_set_blob(handle,META,&p,sizeof(p));
    }
    if(rc==ESP_OK)rc=nvs_commit(handle);
    nvs_close(handle);
    if(rc==ESP_OK){char old_space[16];bank_namespace(space,old.bank,old_space);rc=erase_bank(old_space);}
    return rc;
}
