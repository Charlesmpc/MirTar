#pragma once
#include <stdbool.h>
#include "cJSON.h"
#define MT_QUESTION_OPTIONS 4
typedef struct {
    bool present, blocked, locked, unknown;
    char interaction_id[37], question_id[16], session_id[64], header[65], text[2049];
    int index, count, option_count;
    struct { char label[97], description[193]; } options[MT_QUESTION_OPTIONS];
} mt_question_t;
bool mt_question_read(mt_question_t *question,const cJSON *message,const char *selected_session);
bool mt_question_resolve(mt_question_t *question,const cJSON *message,const char *selected_session);
void mt_question_clear(mt_question_t *question);
