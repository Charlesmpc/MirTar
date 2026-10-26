#include <assert.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "question.h"
#include "state.h"
void mt_test_questions(void){
    cJSON *m=cJSON_Parse("{\"sessionId\":\"session-a\",\"interactionId\":\"11111111-1111-4111-8111-111111111111\",\"questionId\":\"q0\",\"header\":\"Question\",\"text\":\"Which color?\",\"index\":1,\"count\":2,\"status\":\"pending\",\"options\":[{\"label\":\"Blue\",\"description\":\"Test option\"}]}");
    assert(m);mt_question_t q={0};assert(mt_question_read(&q,m,"session-a"));assert(q.present&&!q.locked&&q.index==1&&q.count==2&&q.option_count==1);
    assert(!mt_question_read(&q,m,"session-b")&&!strcmp(q.text,"Which color?"));
    cJSON_ReplaceItemInObjectCaseSensitive(m,"index",cJSON_CreateNumber(1.5));assert(!mt_question_read(&q,m,"session-a")&&q.index==1);
    cJSON_ReplaceItemInObjectCaseSensitive(m,"index",cJSON_CreateNumber(1));
    char oversized[2050];memset(oversized,'x',sizeof(oversized)-1);oversized[sizeof(oversized)-1]=0;
    cJSON_ReplaceItemInObjectCaseSensitive(m,"text",cJSON_CreateString(oversized));assert(!mt_question_read(&q,m,"session-a")&&!strcmp(q.text,"Which color?"));
    cJSON_ReplaceItemInObjectCaseSensitive(m,"text",cJSON_CreateString("Which color?"));
    cJSON_ReplaceItemInObjectCaseSensitive(m,"status",cJSON_CreateString("unknown"));assert(mt_question_read(&q,m,"session-a")&&q.unknown&&q.locked);
    cJSON_ReplaceItemInObjectCaseSensitive(m,"status",cJSON_CreateString("blocked"));assert(mt_question_read(&q,m,"session-a")&&q.blocked&&q.locked);
    cJSON_ReplaceItemInObjectCaseSensitive(m,"status",cJSON_CreateString("pending"));assert(mt_question_read(&q,m,"session-a"));
    cJSON_ReplaceItemInObjectCaseSensitive(m,"questionId",cJSON_CreateString("q1"));assert(!mt_question_resolve(&q,m,"session-a")&&q.present);
    cJSON_ReplaceItemInObjectCaseSensitive(m,"questionId",cJSON_CreateString("q0"));assert(!mt_question_resolve(&q,m,"session-b"));
    cJSON_ReplaceItemInObjectCaseSensitive(m,"sessionId",cJSON_CreateString("session-b"));assert(!mt_question_resolve(&q,m,"session-b")&&q.present);
    cJSON_ReplaceItemInObjectCaseSensitive(m,"sessionId",cJSON_CreateString("session-a"));assert(mt_question_resolve(&q,m,"session-a")&&!q.present);cJSON_Delete(m);
    mt_state_t s={.page=MT_QUESTION,.connected=true,.bound=true,.submitting=true,.question_pending=true,.session_count=1};
    assert(mt_can_answer(&s)&&!mt_can_record(&s));s.page=MT_ANSWER_MENU;assert(mt_can_answer(&s));
    s.answer_submitting=true;assert(!mt_can_answer(&s));s.answer_submitting=false;s.recording=true;assert(!mt_can_answer(&s));
    s.recording=false;s.page=MT_READING;assert(!mt_can_answer(&s)&&!mt_can_record(&s));s.submitting=false;assert(!mt_can_record(&s));
    s.question_pending=false;assert(mt_can_record(&s));s.question_pending=s.answer_submitting=true;mt_disconnect(&s);assert(!s.question_pending&&!s.answer_submitting&&!mt_can_record(&s));
    puts("Question parser, session/request isolation, size limits, immutable failed updates and answer/record guards: PASS");
}
