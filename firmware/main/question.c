#include "question.h"
#include <string.h>
#include <stdlib.h>
static const char *field(const cJSON *o,const char *key){const cJSON *v=cJSON_GetObjectItemCaseSensitive(o,key);return cJSON_IsString(v)?v->valuestring:NULL;}
static bool copy(char *to,size_t size,const char *from,bool empty){if(!from||(!empty&&!*from)||strlen(from)>=size)return false;memcpy(to,from,strlen(from)+1);return true;}
void mt_question_clear(mt_question_t *q){if(q)memset(q,0,sizeof(*q));}
bool mt_question_read(mt_question_t *q,const cJSON *m,const char *session){
    const char *id=field(m,"sessionId"),*status=field(m,"status");
    if(!q||!session||!id||strcmp(session,id)||!status||
       (strcmp(status,"pending")&&strcmp(status,"blocked")&&strcmp(status,"responding")&&strcmp(status,"unknown")))return false;
    /* Never expose half an update or add a 4 KB temporary to the ESP task stack. */
    mt_question_t *next=calloc(1,sizeof(*next));if(!next)return false;
    bool ok=copy(next->session_id,sizeof(next->session_id),id,false)&&
        copy(next->interaction_id,sizeof(next->interaction_id),field(m,"interactionId"),false)&&
        copy(next->question_id,sizeof(next->question_id),field(m,"questionId"),false)&&
        copy(next->header,sizeof(next->header),field(m,"header"),true)&&copy(next->text,sizeof(next->text),field(m,"text"),false);
    const cJSON *index=cJSON_GetObjectItemCaseSensitive(m,"index"),*count=cJSON_GetObjectItemCaseSensitive(m,"count"),*options=cJSON_GetObjectItemCaseSensitive(m,"options");
    ok=ok&&cJSON_IsNumber(index)&&cJSON_IsNumber(count)&&index->valuedouble==index->valueint&&count->valuedouble==count->valueint&&
        count->valueint>=1&&count->valueint<=3&&index->valueint>=1&&index->valueint<=count->valueint&&cJSON_IsArray(options)&&cJSON_GetArraySize(options)<=MT_QUESTION_OPTIONS;
    if(ok){
        next->index=index->valueint;next->count=count->valueint;next->option_count=cJSON_GetArraySize(options);
        for(int i=0;i<next->option_count&&ok;i++){
            const cJSON *option=cJSON_GetArrayItem(options,i);
            ok=copy(next->options[i].label,sizeof(next->options[i].label),field(option,"label"),false)&&
                copy(next->options[i].description,sizeof(next->options[i].description),field(option,"description"),true);
        }
    }
    if(ok){next->present=true;next->blocked=!strcmp(status,"blocked");next->locked=strcmp(status,"pending")!=0;next->unknown=!strcmp(status,"unknown");*q=*next;}
    memset(next,0,sizeof(*next));free(next);return ok;
}
bool mt_question_resolve(mt_question_t *q,const cJSON *m,const char *session){
    const char *id=field(m,"sessionId"),*interaction=field(m,"interactionId"),*question=field(m,"questionId");
    if(!q||!q->present||!session||strcmp(q->session_id,session)||!id||strcmp(session,id)||!interaction||strcmp(q->interaction_id,interaction)||!question||strcmp(q->question_id,question))return false;
    mt_question_clear(q);return true;
}
