#include <assert.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "nvs.h"
#include "nvs_memory.h"
#define NS_MAX 48
#define KEY_MAX 24
typedef struct {char name[16];size_t size;unsigned char value[4096];} entry_t;
typedef struct {char name[16];entry_t keys[KEY_MAX];} space_t;
typedef struct {bool used;unsigned index;space_t pending;} handle_t;
static space_t spaces[NS_MAX];static unsigned space_count;
static handle_t handles[8];
const char *fail_set_key,*fail_commit_space;
unsigned fail_commit_skip;
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
esp_err_t nvs_commit(nvs_handle_t h){assert(handles[h].used);if(fail_commit_space&&!strcmp(fail_commit_space,handles[h].pending.name)){if(fail_commit_skip)fail_commit_skip--;else return ESP_FAIL;}spaces[handles[h].index]=handles[h].pending;return ESP_OK;}
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
const char *test_nvs_namespace(nvs_handle_t h){assert(handles[h].used);return handles[h].pending.name;}
