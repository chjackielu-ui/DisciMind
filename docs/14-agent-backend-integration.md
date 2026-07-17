# Explainer and Diagnostician Backend Integration

This document records the implemented backend contract for the DisciMind Explainer and Diagnostician Dify agents.

## Routes

### Explainer

`POST /api/agent/explainer/chat`

Authenticated student endpoint. The backend derives `student_user_id` from JWT and streams a normalized SSE response.

Request:

```json
{
  "knowledgePointId": 1,
  "message": "请解释逻辑回归中的对数几率",
  "strategyHint": "auto",
  "conversationId": "",
  "learningSessionId": "session_xxx",
  "depth": "moderate"
}
```

SSE events emitted by the backend:

- `start`: request id, selected strategy, strategy source, existing conversation id.
- `delta`: incremental answer text.
- `metadata`: Dify conversation/message ids, token usage, and workflow/node metadata when available.
- `done`: terminal event with conversation/message ids.
- `error`: safe project-level error code and message.

### Diagnostician

`POST /api/agent/diagnostician/analyze`

Authenticated student/teacher/admin endpoint. Students can analyze only their own data. Teachers must be assigned to the target course.

Request:

```json
{
  "mode": "mental_model",
  "knowledgePointId": 1,
  "sessionId": 10,
  "reportPeriod": {
    "from": "2026-07-01",
    "to": "2026-07-09"
  }
}
```

Modes:

- `mental_model`
- `strategy_intervention`
- `growth_report`

The backend computes deterministic statistics first, then calls the Dify workflow with `inputs.mode`, `inputs.request_id`, `inputs.payload`, `inputs.locale`, and `inputs.debug`. The Dify response is accepted only when HTTP succeeds, `data.status === "succeeded"`, `outputs.branch_result` is parseable, and `branch_result.success === true`.

## Dify Inputs

Explainer Chatflow inputs:

- `request_id`
- `knowledge_point_id`
- `knowledge_point_name`
- `student_profile_summary`
- `strategy_hint`: `auto`, `direct`, `socratic`, `analogy`, `misconception`
- `exposure_level`
- `understanding_depth`
- `learning_style`
- `detected_misconceptions`
- `interest_tags`
- `knowledge_context_override`

Diagnostician Workflow inputs:

- `mode`
- `request_id`
- `payload`
- `locale`
- `debug`

## Persistence Mapping

- Agent run logs: `AgentRunRecord`
- Explainer Dify conversation ownership: `AgentConversation`
- Diagnostician interventions: `AgentIntervention`
- Mental models, interventions, and growth reports with statistics snapshots: `AgentDiagnosticReport`
- Trainer source data: `PracticeSession`, `AnswerRecord`, `TrainerAnswerDetail`, `StudentMasteryRecord`, `StudentPortrait`, `WrongQuestion`

## Intervention Whitelist

Trainer:

- `reduce_difficulty_and_focus`
- `insert_diagnostic_question`
- `increase_difficulty`
- `variant_pursuit`
- `skip_remaining_practice`

Explainer:

- `switch_strategy`
- `focus_misconception`
- `review_prerequisite`
- `provide_analogy`
- `summarize_and_confirm`

Orchestrator:

- `suggest_break`
- `continue_current_plan`
- `advance_to_next_stage`

Unknown actions are persisted as `ignored` and are never executed.

## Environment

```env
DIFY_EXPLAINER_ENABLED=true
DIFY_EXPLAINER_BASE_URL=http://localhost/v1
DIFY_EXPLAINER_API_KEY=
DIFY_EXPLAINER_TIMEOUT_MS=120000
DIFY_EXPLAINER_MAX_RETRIES=1
DIFY_EXPLAINER_USER_PREFIX=discimind-explainer
DIFY_EXPLAINER_DEBUG=false

DIFY_DIAGNOSTICIAN_ENABLED=true
DIFY_DIAGNOSTICIAN_BASE_URL=http://localhost/v1
DIFY_DIAGNOSTICIAN_API_KEY=
DIFY_DIAGNOSTICIAN_TIMEOUT_MS=120000
DIFY_DIAGNOSTICIAN_MAX_RETRIES=1
DIFY_DIAGNOSTICIAN_USER_PREFIX=discimind-diagnostician
DIFY_DIAGNOSTICIAN_DEBUG=false
```

## Smoke Tests

These scripts are opt-in and require a running backend, valid Dify keys, and a student access token:

```bash
RUN_DIFY_SMOKE=true DISCIMIND_ACCESS_TOKEN=... SMOKE_KNOWLEDGE_POINT_ID=1 node scripts/smoke-explainer.js
RUN_DIFY_SMOKE=true DISCIMIND_ACCESS_TOKEN=... SMOKE_KNOWLEDGE_POINT_ID=1 node scripts/smoke-diagnostician.js
```
