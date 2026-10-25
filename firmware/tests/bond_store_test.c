#include <assert.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "bond_store.h"
#include "nvs.h"
#include "esp_random.h"
#define NS_MAX 24
#define KEY_MAX 24
typedef struct {char name[16];size_t size;unsigned char value[4096];} entry_t;
typedef struct {char name[16];entry_t keys[KEY_MAX];} space_t;
typedef struct {bool used;unsigned index;space_t pending;} handle_t;
static space_t spaces[NS_MAX];static unsigned space_count;
static handle_t handles[8];
static const char *fail_set_key,*fail_commit_space;
static unsigned random_seed;
struct test_iterator {unsigned space,key;};
esp_err_t __wrap_nvs_open(const char *,nvs_open_mode_t,nvs_handle_t *);
esp_err_t __real_nvs_open(const char *,nvs_open_mode_t,nvs_handle_t *);
void esp_fill_random(void *buffer,size_t length){unsigned char *p=buffer;for(size_t i=0;i<length;i++)p[i]=(unsigned char)(++random_seed*37);}
static entry_t *entry(space_t *s,const char *key,bool create){
    entry_t *empty=NULL;
    for(unsigned i=0;i<KEY_MAX;i++){if(!strcmp(s->keys[i].name,key))return &s->keys[i];if(!s->keys[i].name[0]&&!empty)empty=&s->keys[i];}
    if(create&&empty){snprintf(empty->name,sizeof(empty->name),"%s",key);return empty;}return NULL;
}
esp_err_t __real_nvs_open(const char *name,nvs_open_mode_t mode,nvs_handle_t *out){
    unsigned index=0;while(index<space_count&&strcmp(spaces[index].name,name))index++;
    if(index==space_count){if(mode==NVS_READONLY)return ESP_ERR_NVS_NOT_FOUND;assert(space_count<NS_MAX);snprintf(spaces[index].name,16,"%s",name);space_count++;}
    for(unsigned i=0;i<8;i++)if(!handles[i].used){handles[i]=(handle_t){.used=true,.index=index,.pending=spaces[index]};*out=i;return ESP_OK;}abort();
}
esp_err_t nvs_open(const char *name,nvs_open_mode_t mode,nvs_handle_t *out){return __real_nvs_open(name,mode,out);}
esp_err_t nvs_get_blob(nvs_handle_t h,const char *key,void *out,size_t *size){
    assert(handles[h].used);entry_t *e=entry(&handles[h].pending,key,false);if(!e)return ESP_ERR_NVS_NOT_FOUND;
    if(!out){*size=e->size;return ESP_OK;}if(*size<e->size){*size=e->size;return ESP_ERR_NVS_INVALID_LENGTH;}
    memcpy(out,e->value,e->size);*size=e->size;return ESP_OK;
}
esp_err_t nvs_set_blob(nvs_handle_t h,const char *key,const void *data,size_t size){
    assert(handles[h].used);if(fail_set_key&&!strcmp(fail_set_key,key))return ESP_FAIL;
    entry_t *e=entry(&handles[h].pending,key,true);assert(e&&size<=sizeof(e->value));memcpy(e->value,data,size);e->size=size;return ESP_OK;
}
esp_err_t nvs_commit(nvs_handle_t h){assert(handles[h].used);if(fail_commit_space&&!strcmp(fail_commit_space,handles[h].pending.name))return ESP_FAIL;spaces[handles[h].index]=handles[h].pending;return ESP_OK;}
esp_err_t nvs_erase_all(nvs_handle_t h){assert(handles[h].used);memset(handles[h].pending.keys,0,sizeof(handles[h].pending.keys));return ESP_OK;}
void nvs_close(nvs_handle_t h){assert(handles[h].used);memset(&handles[h],0,sizeof(handles[h]));}
esp_err_t nvs_entry_find(const char *partition,const char *name,nvs_type_t type,nvs_iterator_t *it){
    assert(!strcmp(partition,"nvs")&&type==NVS_TYPE_ANY);*it=NULL;
    unsigned s=0;while(s<space_count&&strcmp(spaces[s].name,name))s++;if(s==space_count)return ESP_ERR_NVS_NOT_FOUND;
    for(unsigned k=0;k<KEY_MAX;k++)if(spaces[s].keys[k].name[0]){*it=malloc(sizeof(**it));assert(*it);**it=(struct test_iterator){s,k};return ESP_OK;}
    return ESP_ERR_NVS_NOT_FOUND;
}
esp_err_t nvs_entry_next(nvs_iterator_t *it){for(unsigned k=(*it)->key+1;k<KEY_MAX;k++)if(spaces[(*it)->space].keys[k].name[0]){(*it)->key=k;return ESP_OK;}free(*it);*it=NULL;return ESP_ERR_NVS_NOT_FOUND;}
void nvs_entry_info(nvs_iterator_t it,nvs_entry_info_t *info){snprintf(info->namespace_name,16,"%s",spaces[it->space].name);snprintf(info->key,16,"%s",spaces[it->space].keys[it->key].name);info->type=NVS_TYPE_BLOB;}
void nvs_release_iterator(nvs_iterator_t it){free(it);}
static void write_at(const char *space,const char *key,const char *value){nvs_handle_t h;assert(nvs_open(space,NVS_READWRITE,&h)==ESP_OK);assert(nvs_set_blob(h,key,value,strlen(value)+1)==ESP_OK);assert(nvs_commit(h)==ESP_OK);nvs_close(h);}
static void read_at(const char *space,const char *key,const char *value){nvs_handle_t h;assert(nvs_open(space,NVS_READONLY,&h)==ESP_OK);char out[100];size_t size=sizeof(out);assert(nvs_get_blob(h,key,out,&size)==ESP_OK&&!strcmp(out,value));nvs_close(h);}
static void sdk_write(const char *value){nvs_handle_t h;assert(__wrap_nvs_open("nimble_bond",NVS_READWRITE,&h)==ESP_OK);assert(strcmp(handles[h].pending.name,"nimble_bond"));assert(nvs_set_blob(h,"our_sec_1",value,strlen(value)+1)==ESP_OK);assert(nvs_commit(h)==ESP_OK);nvs_close(h);}
static void sdk_read(const char *expected){nvs_handle_t h;assert(__wrap_nvs_open("nimble_bond",NVS_READONLY,&h)==ESP_OK);char out[100];size_t size=sizeof(out);esp_err_t rc=nvs_get_blob(h,"our_sec_1",out,&size);if(expected)assert(rc==ESP_OK&&!strcmp(expected,out));else assert(rc==ESP_ERR_NVS_NOT_FOUND);nvs_close(h);}
static void sdk_extra(const char *key,const char *value,bool write){
    nvs_handle_t h;assert(__wrap_nvs_open("nimble_bond",write?NVS_READWRITE:NVS_READONLY,&h)==ESP_OK);
    if(write){assert(nvs_set_blob(h,key,value,strlen(value)+1)==ESP_OK&&nvs_commit(h)==ESP_OK);}
    else{char out[100];size_t bytes=sizeof(out);assert(nvs_get_blob(h,key,out,&bytes)==ESP_OK&&!strcmp(out,value));}
    nvs_close(h);
}
int main(int argc,char **argv){
    nvs_handle_t h;assert(__wrap_nvs_open("nimble_bond",NVS_READWRITE,&h)==ESP_ERR_INVALID_STATE);
    write_at("mirtar","config","private-configuration-test");write_at("nimble_bond","our_sec_1","legacy-unassigned-test");
    assert(__wrap_nvs_open("mirtar",NVS_READONLY,&h)==ESP_OK);char config[64];size_t config_size=sizeof(config);
    assert(nvs_get_blob(h,"config",config,&config_size)==ESP_OK&&!strcmp(config,"private-configuration-test"));nvs_close(h);
    uint8_t a[6],b[6],again[6],fresh[6],stage[6];char root[16];
    assert(mt_bond_prepare("HostA",a)==ESP_OK&&(a[5]&0xc0)==0xc0);sdk_write("bond-A");
    assert(mt_bond_prepare("HostB",b)==ESP_OK&&memcmp(a,b,6));sdk_write("bond-B");sdk_extra("cccd_sec_1","notify-B",true);sdk_extra("local_irk_1","irk-B",true);
    assert(mt_bond_prepare("HostA",again)==ESP_OK&&!memcmp(a,again,6));sdk_read("bond-A");
    assert(mt_bond_reset("HostB")==ESP_ERR_INVALID_STATE);sdk_read("bond-A");
    assert(mt_bond_reset("HostA")==ESP_OK);assert(mt_bond_prepare("HostA",fresh)==ESP_OK&&memcmp(a,fresh,6));sdk_read(NULL);
    assert(mt_bond_prepare("HostB",again)==ESP_OK&&!memcmp(b,again,6));sdk_read("bond-B");
    sdk_extra("cccd_sec_1","notify-B",false);sdk_extra("local_irk_1","irk-B",false);
    read_at("mirtar","config","private-configuration-test");read_at("nimble_bond","our_sec_1","legacy-unassigned-test");
    assert(mt_bond_prepare(NULL,stage)==ESP_OK);sdk_write("enrolled-C");assert(mt_bond_promote("HostC")==ESP_OK);assert(!mt_bond_matches("HostC"));
    assert(mt_bond_prepare("HostC",again)==ESP_OK&&!memcmp(stage,again,6));sdk_read("enrolled-C");
    assert(mt_bond_prepare(NULL,fresh)==ESP_OK&&memcmp(stage,fresh,6));sdk_read(NULL);sdk_write("replacement-C");
    fail_set_key="our_sec_1";assert(mt_bond_promote("HostC")!=ESP_OK);fail_set_key=NULL;
    assert(mt_bond_prepare("HostC",again)==ESP_OK&&!memcmp(stage,again,6));sdk_read("enrolled-C");
    assert(mt_bond_namespace("HostC",root));fail_commit_space=root;assert(mt_bond_reset("HostC")!=ESP_OK);fail_commit_space=NULL;
    assert(mt_bond_prepare("HostC",again)==ESP_OK&&!memcmp(stage,again,6));sdk_read("enrolled-C");
    assert(mt_bond_prepare("HostB",again)==ESP_OK&&!memcmp(b,again,6));sdk_read("bond-B");
    assert(mt_bond_prepare("",again)==ESP_ERR_INVALID_ARG);assert(!mt_bond_namespace("bad id",root));
    assert(mt_bond_namespace("HostB",root));assert(nvs_open(root,NVS_READWRITE,&h)==ESP_OK);
    unsigned char metadata[55];size_t bytes=sizeof(metadata);assert(nvs_get_blob(h,"profile",metadata,&bytes)==ESP_OK);unsigned char saved=metadata[7];metadata[7]='X';
    assert(nvs_set_blob(h,"profile",metadata,sizeof(metadata))==ESP_OK&&nvs_commit(h)==ESP_OK);nvs_close(h);
    assert(mt_bond_prepare("HostB",again)==ESP_ERR_INVALID_STATE);metadata[7]=saved;
    assert(nvs_open(root,NVS_READWRITE,&h)==ESP_OK);assert(nvs_set_blob(h,"profile",metadata,sizeof(metadata))==ESP_OK&&nvs_commit(h)==ESP_OK);nvs_close(h);
    assert(mt_bond_prepare("HostB",again)==ESP_OK);sdk_read("bond-B");
    assert(nvs_open(root,NVS_READWRITE,&h)==ESP_OK);metadata[4]=6;
    assert(nvs_set_blob(h,"profile",metadata,sizeof(metadata))==ESP_OK&&nvs_commit(h)==ESP_OK);nvs_close(h);
    assert(mt_bond_prepare("HostB",again)==ESP_ERR_INVALID_STATE);metadata[4]=5;
    assert(nvs_open(root,NVS_READWRITE,&h)==ESP_OK);assert(nvs_set_blob(h,"profile",metadata,sizeof(metadata))==ESP_OK&&nvs_commit(h)==ESP_OK);nvs_close(h);
    assert(mt_bond_prepare("HostB",again)==ESP_OK);sdk_extra("cccd_sec_1","notify-B",false);sdk_extra("local_irk_1","irk-B",false);
    assert(mt_bond_prepare(NULL,stage)==ESP_OK);sdk_write("replacement-C");assert(mt_bond_promote("HostC")==ESP_OK);
    assert(mt_bond_prepare("HostC",again)==ESP_OK&&!memcmp(stage,again,6));sdk_read("replacement-C");
    assert(mt_bond_prepare("HostB",again)==ESP_OK&&!memcmp(b,again,6));sdk_read("bond-B");sdk_extra("cccd_sec_1","notify-B",false);
    const char *receipt="PASS: server-ID bond isolation, stable/random identities, scoped reset, enrollment promotion, failed copy/commit, collision guard and untouched config/legacy stores";
    puts(receipt);if(argc==2){FILE *f=fopen(argv[1],"wb");assert(f);assert(fputs(receipt,f)>=0&&fclose(f)==0);}return 0;
}
