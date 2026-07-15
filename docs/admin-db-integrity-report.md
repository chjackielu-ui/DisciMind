# Admin DB Integrity Result

- **Outcome:** READY WITH WARNINGS
- **Checks:** 76 pass, 2 warning, 0 failure, 0 skipped
- **Data handling:** aggregate counts and schema/migration metadata only; no row samples, credentials, tokens, hashes, or secret values are rendered.

## Scope and safety

This result was produced by `scripts/admin_db_integrity_check.py`. Its database bridge accepts only a fixed allow-list of `SELECT` statements, inspects `INFORMATION_SCHEMA`, and disconnects without calling any mutation API. Warnings do not change the default exit code; any critical failure returns exit code 1, and harness failure returns exit code 2.

## Redacted environment readiness

| Setting | Readiness (value withheld) |
| --- | --- |
| Database configuration | configured |
| JWT signing secret | configured |
| AI encryption key | configured and structurally usable |
| DB-backed AI config | default (enabled) |
| AI environment fallback | default (enabled) |

## Environment readiness

| Status | Severity | Check | Observed | Expected | ID |
| --- | --- | --- | --- | --- | --- |
| PASS | warning | Database configuration is explicit | configured | DATABASE_URL or split DB settings configured | `env.database` |
| PASS | warning | JWT signing secret is not a development fallback | configured | non-placeholder JWT secret configured | `env.jwt` |
| PASS | warning | AI encryption key can service encrypted provider records | configured and structurally usable | usable key configured when encrypted records exist | `env.ai_encryption` |

## Schema readiness

| Status | Severity | Check | Observed | Expected | ID |
| --- | --- | --- | --- | --- | --- |
| PASS | critical | Required Prisma models | 0 missing | all 23 models present | `schema.models` |
| PASS | critical | Required Prisma table mappings | 0 missing | all model/table mappings match | `schema.maps` |
| PASS | critical | Required Prisma fields | 0 missing | all recovery-critical fields present | `schema.fields` |
| PASS | critical | Prisma datasource is MySQL | mysql | provider = mysql | `schema.datasource` |
| PASS | critical | Prisma schema validates | exit 0 | validation command succeeds | `schema.prisma_validate` |

## Database readiness

| Status | Severity | Check | Observed | Expected | ID |
| --- | --- | --- | --- | --- | --- |
| PASS | critical | Database is reachable with the backend configuration | connected | SELECT-only connection succeeds | `db.connectivity` |
| PASS | critical | A database is selected | selected | selected database present | `db.selected` |
| PASS | critical | Required admin database tables | 0 missing | all 26 required tables present | `db.tables` |
| PASS | critical | Required admin database columns | 0 missing | all recovery-critical columns present | `db.columns` |

## Migration integrity

| Status | Severity | Check | Observed | Expected | ID |
| --- | --- | --- | --- | --- | --- |
| PASS | critical | Migration directories contain migration.sql | 0 missing | every migration directory has SQL | `migrations.files` |
| PASS | critical | Filesystem migrations are applied | 0 | 0 unapplied migrations | `migrations.unapplied` |
| PASS | critical | Applied migrations exist on disk | 0 | 0 DB-only active migrations | `migrations.missing_file` |
| PASS | critical | Applied migration checksums match | 0 | 0 checksum mismatches | `migrations.checksum` |
| PASS | critical | No migration is left unfinished | 0 | 0 unfinished migrations | `migrations.unfinished` |
| PASS | critical | Migration names have one active application | 0 | 0 duplicate active histories | `migrations.duplicate_active` |
| WARN | warning | Rolled-back migration history | 20260709193000_add_explainer_diagnostician_agents, 20260710000000_add_learning_workflow_system, 20260711010000_add_learning_narration_assets, 20260711120000_add_learning_goals, 20260714222000_resource_distribution_and_versions | review any historical rollbacks | `migrations.rolled_back` |
| WARN | warning | Applied migration checksum differs only by line endings | 20260701021559_add_ai_chat, 20260701090000_add_smart_answering_system, 20260701100000_require_question_correct_answer, 20260701113000_add_practice_sessions, 20260708120000_add_trainer_agent_integration, 20260708132432_add_missing_wrong_question_columns, 20260711170000_add_agent_marketplace, 20260711173000_add_agent_version_operation_id, 20260711223000_add_async_tasks, 20260711233000_add_async_task_worker_leases, 20260711243000_add_marketplace_generation_state, 20260712010000_add_file_generator_agent_type, 20260712023000_add_generated_artifacts, 20260712050000_add_learning_flow_resources_preloads, 20260712100000_add_artifact_exports_learning_context_system_agents | 0 newline-only checksum differences | `migrations.line_endings` |
| PASS | warning | Applied migration files are version-controlled | 0 untracked | all active migration files tracked | `migrations.version_control` |

## Users and RBAC

| Status | Severity | Check | Observed | Expected | ID |
| --- | --- | --- | --- | --- | --- |
| PASS | critical | Active administrator exists | 0 | zero missing-admin markers | `users.active_admin` |
| PASS | critical | Usernames are nonblank | 0 | 0 invalid rows | `users.blank_username` |
| PASS | critical | Normalized usernames are unique | 0 | 0 duplicate groups | `users.duplicate_username` |
| PASS | critical | Normalized nonblank emails are unique | 0 | 0 duplicate groups | `users.duplicate_email` |
| PASS | critical | Normalized nonblank phones are unique | 0 | 0 duplicate groups | `users.duplicate_phone` |
| PASS | critical | User role and status values are valid | 0 | 0 invalid rows | `users.invalid_state` |
| PASS | critical | Profiles reference existing users | 0 | 0 orphan rows | `users.orphan_profile` |
| PASS | critical | Profile class links resolve | 0 | 0 orphan rows | `users.orphan_profile_class` |
| PASS | critical | Admin-role assignments reference users | 0 | 0 orphan rows | `rbac.orphan_user_role_user` |
| PASS | critical | Admin-role assignments reference roles | 0 | 0 orphan rows | `rbac.orphan_user_role_role` |
| PASS | critical | Role-permission assignments resolve | 0 | 0 orphan rows | `rbac.orphan_role_permission` |
| PASS | critical | Role codes are present, normalized-unique, and valid | 0 | 0 invalid or duplicate groups | `rbac.role_identity` |
| PASS | critical | Permission keys are present, normalized-unique, and valid | 0 | 0 invalid or duplicate groups | `rbac.permission_identity` |
| PASS | critical | RBAC assignments are unique | 0 | 0 duplicate groups | `rbac.duplicate_assignments` |
| PASS | warning | Active admins have an enabled, unexpired RBAC role | 0 | 0 uncovered admins | `rbac.admin_without_assignment` |
| PASS | warning | Unexpired assignments do not target disabled roles | 0 | 0 disabled-role assignments | `rbac.disabled_role_assignment` |
| PASS | warning | At least one admin role is enabled | 0 | zero missing-catalog markers | `rbac.enabled_role_catalog` |
| PASS | warning | Admin permission catalog is populated | 0 | zero missing-catalog markers | `rbac.permission_catalog` |

## Courses and classes

| Status | Severity | Check | Observed | Expected | ID |
| --- | --- | --- | --- | --- | --- |
| PASS | critical | Courses have names and codes | 0 | 0 invalid rows | `courses.blank_identity` |
| PASS | critical | Normalized course codes are unique | 0 | 0 duplicate groups | `courses.duplicate_code` |
| PASS | critical | Course status values are valid | 0 | 0 invalid rows | `courses.invalid_state` |
| PASS | critical | Course-teacher relations resolve | 0 | 0 orphan rows | `courses.orphan_teacher_relation` |
| PASS | warning | Course teachers have teacher/admin role | 0 | 0 semantic mismatches | `courses.non_teacher_relation` |
| PASS | critical | Teaching-class references resolve | 0 | 0 orphan rows | `classes.orphan_teaching_class` |
| PASS | warning | Primary teaching-class teachers have teacher/admin role | 0 | 0 semantic mismatches | `classes.non_teacher_primary` |
| PASS | warning | Class status values use the supported lifecycle | 0 | 0 uncommon rows | `classes.invalid_state` |
| PASS | critical | Administrative-class references resolve | 0 | 0 orphan rows | `classes.orphan_admin_class` |
| PASS | warning | Class advisors have teacher/admin role | 0 | 0 semantic mismatches | `classes.non_teacher_advisor` |
| PASS | critical | Teaching/admin-class links resolve | 0 | 0 orphan rows | `classes.orphan_links` |
| PASS | critical | Enrollment references resolve | 0 | 0 orphan rows | `classes.orphan_enrollment` |
| PASS | critical | Enrollment course matches its teaching class | 0 | 0 inconsistent rows | `classes.enrollment_course_mismatch` |
| PASS | warning | Enrolled users have student role | 0 | 0 semantic mismatches | `classes.non_student_enrollment` |
| PASS | critical | Class topology rows are unique | 0 | 0 duplicate groups | `classes.duplicate_topology` |

## Notifications

| Status | Severity | Check | Observed | Expected | ID |
| --- | --- | --- | --- | --- | --- |
| PASS | critical | Notification sender/receiver references resolve | 0 | 0 orphan rows | `notifications.orphan_user` |
| PASS | critical | Notification idempotency keys are unique | 0 | 0 duplicate groups | `notifications.duplicate_idempotency` |
| PASS | critical | Notification titles are nonblank | 0 | 0 invalid rows | `notifications.blank_title` |
| PASS | warning | Read flags and timestamps agree | 0 | 0 inconsistent rows | `notifications.read_state` |

## Operation logs

| Status | Severity | Check | Observed | Expected | ID |
| --- | --- | --- | --- | --- | --- |
| PASS | critical | Operation-log user references resolve | 0 | 0 orphan rows | `logs.orphan_user` |
| PASS | critical | Operation types are nonblank | 0 | 0 invalid rows | `logs.blank_operation` |
| PASS | warning | Action status values are recognized | 0 | 0 uncommon rows | `logs.invalid_state` |
| PASS | warning | Failed operations record a reason | 0 | 0 incomplete rows | `logs.failed_without_reason` |

## AI configuration

| Status | Severity | Check | Observed | Expected | ID |
| --- | --- | --- | --- | --- | --- |
| PASS | critical | AI provider codes are present and unique | 0 | 0 invalid or duplicate groups | `ai.provider_identity` |
| PASS | warning | Provider state values are recognized | 0 | 0 uncommon rows | `ai.provider_state` |
| PASS | critical | Encrypted provider secret tuples are complete | 0 | 0 incomplete rows | `ai.secret_tuple` |
| PASS | warning | Provider secret metadata is structurally plausible | 0 | 0 suspicious rows | `ai.secret_metadata` |
| PASS | critical | AI model provider references resolve | 0 | 0 orphan rows | `ai.model_orphan_provider` |
| PASS | critical | AI models have usable identifiers | 0 | 0 invalid rows | `ai.model_identity` |
| PASS | critical | Provider/model-code pairs are unique | 0 | 0 duplicate groups | `ai.model_duplicate` |
| PASS | warning | Model type, usage, and flags are recognized | 0 | 0 uncommon rows | `ai.model_state` |
| PASS | warning | Each provider/model type has at most one enabled default | 0 | 0 ambiguous groups | `ai.multiple_default_model` |
| PASS | critical | AI agent provider/model references resolve | 0 | 0 orphan rows | `ai.agent_orphan_binding` |
| PASS | critical | Agent and bound model use the same provider | 0 | 0 inconsistent rows | `ai.agent_provider_mismatch` |
| PASS | warning | Published/enabled agents have stable keys | 0 | 0 incomplete rows | `ai.agent_publish_identity` |
| PASS | warning | Agent state and runtime values are recognized | 0 | 0 uncommon rows | `ai.agent_state` |
| PASS | critical | Agent versions reference existing agents | 0 | 0 orphan rows | `ai.version_orphan` |
| PASS | critical | Agent version numbers are unique per agent | 0 | 0 duplicate groups | `ai.version_duplicate` |
| PASS | warning | Agent-version states are recognized | 0 | 0 uncommon rows | `ai.version_state` |

## Reproduce

From the repository root:

```powershell
python scripts/admin_db_integrity_check.py --output docs/admin-db-integrity-result.md
```

Use `--strict-warnings` only when a warning must fail CI. The report is intentionally deterministic: it contains no run timestamp, row samples, or volatile connection details.
