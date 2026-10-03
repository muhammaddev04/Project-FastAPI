# P00 acceptance ? 2026-10-03

Local implementation and acceptance checks are complete. Formal part status: PARTIAL,
awaiting the required green remote CI run for these commits. The owner performs the push.
No `part-00-done` tag is created while that gate is unverified.

| Gate | Verified evidence |
|---|---|
| Backend | 738 tests passed in the full PostgreSQL/Redis/S3 suite; final foundation checks: 19 passed, including four additional cases (742 distinct passing backend cases in total) |
| Typing and lint | Strict mypy: 68 app files; backend/scripts Ruff lint and format passed |
| Transactions | UnitOfWork commit/rollback, event and audit atomicity, concurrent outbox/idempotency and append-only triggers passed |
| Rate limits | Atomic Redis Lua admission; 40 parallel requests admit exactly five with a limit of five |
| Migrations | Test sessions downgrade base and upgrade head; alembic check reports no new operations |
| Runtime | All seven isolated P00 services healthy: PostgreSQL, Redis, S3, API, worker, Beat, frontend |
| Health | Real isolated Redis stop: ready=503, live=200; restart: ready=200 |
| Frontend | 347 unit/component tests; ESLint, TypeScript, Prettier and production build passed |
| Browser | Four real authenticated areas, widths 390/768/1440, RU/TG switching and persistence, visible keyboard focus, WCAG AA automated checks, 403/404 |
| API contract | Every operation has tags, summary and error-envelope responses; generated TypeScript declarations; local and clean-image contracts identical |
| Locales | Every TZ error catalog code exists in backend/frontend tg/ru/en; future-module codes have localized fallback messages |
| Tooling | Portable Make/Python commands, development-only repeatable seed, EditorConfig, LF attributes and installed commit hooks |
| Traceability | All 35 P00 IDs mapped to 114 test references; missing requirements and renamed tests fail the gate |
| Git | Local Conventional Commits only; no .env files in tracked history (only .env.example); no push |
| Remote CI | Workflow enforces strict typing, migrations, backend/frontend tests, generated types, full P00 traceability and browser acceptance; current remote run awaits owner push |

## Reproduction

Start backend test dependencies with `docker compose -f docker-compose.test.yml up -d`.
Run `.venv/Scripts/python.exe scripts/dev.py verify` on Windows (or `make verify`).
Run `.venv/Scripts/python.exe -m unittest discover -s scripts -p 'test_*.py'`.
Run `.venv/Scripts/python.exe -m pre_commit run --all-files`.
Run `.venv/Scripts/python.exe scripts/sync_error_catalog.py`.

Start the isolated browser stack with
`docker compose -p tezfarmo-p00 -f docker-compose.p00.yml up -d --build --wait`.
Install Chromium once using `cd frontend` then `npx playwright install chromium`.
Run `make fe-e2e`, or run the portable Python runner with `fe-e2e` from the repository root.
Open http://127.0.0.1:15174; API http://127.0.0.1:18001.
Demo accounts: `p00-{company,store,courier,admin}@example.tj`, password `P00Demo2026!`.
`seed` refuses non-development environments and does not reset existing account passwords.
The acceptance database is disposable and separate from development/test data.

## Boundaries

Automated axe checks cover the four area home pages and do not replace a complete manual
accessibility audit. Existing optional dark mode remains supported; P00 checks the MVP light theme.
Sentry reports sanitized bug codes only when SENTRY_DSN is configured; local acceptance sends no
external reports. Metrics are restricted by the application and a supplied Nginx template;
production deployment and a monitoring collector are separate operations.
Async subscription/notification business consumers belong to P03/P11. Until registered,
those event types retry and eventually remain FAILED without deleting their payloads.
The consumer registry, dispatch/retry behavior and transaction invariants are tested in P00.

## Requirement ? tests

| Requirement | Test references |
|---|---|
| FND-000 | `scripts/test_p00_tooling.py::test_foundation_hooks_and_git_hygiene` |
| FND-001 | `scripts/test_dev.py::test_migration_name_is_one_argument`; `scripts/test_dev.py::test_invalid_command_and_missing_name` |
| FND-002 | `backend/tests/core/test_errors.py::test_fnd_002_production_refuses_insecure_defaults` |
| FND-003 | `backend/tests/core/test_foundation_contracts.py::test_fnd_003_settings_are_shared` |
| FND-004 | `backend/tests/core/test_unit_of_work.py::test_fnd_004_uow_commits_events_and_audit`; `backend/tests/core/test_unit_of_work.py::test_fnd_004_uow_exception_rolls_back` |
| FND-005 | `backend/tests/core/test_foundation_contracts.py::test_fnd_005_ids_are_unique_uuid7` |
| FND-006 | `backend/tests/core/test_money.py::test_fnd_006_money_rounding_half_up`; `backend/tests/core/test_money.py::test_fnd_006_quantity_rounding_half_up`; `backend/tests/core/test_money.py::test_fnd_006_money_and_quantity_are_strings_in_json`; `backend/tests/core/test_money.py::test_fnd_006_server_side_decimals_are_accepted`; `backend/tests/core/test_money.py::test_fnd_006_invalid_values_are_rejected`; `backend/tests/core/test_money.py::test_fnd_006_boundaries_are_accepted`; `backend/tests/core/test_money.py::test_fnd_006_api_contract_and_validation_error_envelope`; `backend/tests/core/test_money.py::test_fnd_006_openapi_declares_strings` |
| FND-007 | `backend/tests/core/test_foundation_contracts.py::test_fnd_007_clock_is_aware_utc` |
| FND-008 | `backend/tests/core/test_monitoring.py::test_fnd_008_monitoring_optional_and_excludes_request_data`; `backend/tests/core/test_errors.py::test_fnd_008_integrity_error_mapping`; `backend/tests/core/test_errors.py::test_fnd_008_app_error_format`; `backend/tests/core/test_errors.py::test_fnd_008_default_language_is_tajik`; `backend/tests/core/test_errors.py::test_fnd_008_validation_error_fields`; `backend/tests/core/test_errors.py::test_fnd_008_internal_error_hides_details` |
| FND-009 | `backend/tests/core/test_pagination.py::test_fnd_009_default_page_and_envelope`; `backend/tests/core/test_pagination.py::test_fnd_009_count_ignores_the_page_but_respects_filters`; `backend/tests/core/test_pagination.py::test_fnd_009_offset_past_the_end_is_an_empty_page`; `backend/tests/core/test_pagination.py::test_fnd_009_last_partial_page`; `backend/tests/core/test_pagination.py::test_fnd_009_max_limit_is_accepted`; `backend/tests/core/test_pagination.py::test_fnd_009_pagination_limits`; `backend/tests/core/test_pagination.py::test_fnd_009_validation_messages_exist_in_every_language`; `backend/tests/core/test_pagination.py::test_fnd_009_ties_keep_one_order_across_pages`; `backend/tests/core/test_pagination.py::test_fnd_009_ordering_ascending_and_descending`; `backend/tests/core/test_pagination.py::test_fnd_009_unknown_ordering_is_a_validation_error` |
| FND-010 | `backend/tests/core/test_events.py::test_fnd_010_outbox_immutable`; `backend/tests/core/test_audit.py::test_fnd_010_audit_logs_update_and_delete_forbidden` |
| FND-011 | `backend/tests/core/test_filtering.py::test_fnd_011_no_filter_returns_everyone`; `backend/tests/core/test_filtering.py::test_fnd_011_member_filters`; `backend/tests/core/test_filtering.py::test_fnd_011_member_search`; `backend/tests/core/test_filtering.py::test_fnd_011_search_only_covers_the_listed_fields`; `backend/tests/core/test_filtering.py::test_fnd_011_search_and_filters_combine`; `backend/tests/core/test_filtering.py::test_fnd_011_sql_in_search_is_only_text`; `backend/tests/core/test_filtering.py::test_fnd_011_invalid_member_query_is_a_validation_error`; `backend/tests/core/test_filtering.py::test_fnd_011_every_invalid_parameter_is_reported`; `backend/tests/core/test_filtering.py::test_fnd_011_validation_messages_are_translated`; `backend/tests/core/test_filtering.py::test_fnd_011_filter_then_page`; `backend/tests/core/test_filtering.py::test_fnd_011_filters_never_cross_the_organization`; `backend/tests/core/test_filtering.py::test_fnd_011_authorization_is_checked_before_filters`; `backend/tests/core/test_filtering.py::test_fnd_011_queue_filters`; `backend/tests/core/test_filtering.py::test_fnd_011_queue_filter_with_ordering_and_pages_is_stable`; `backend/tests/core/test_filtering.py::test_fnd_011_invalid_queue_query`; `backend/tests/core/test_filtering.py::test_fnd_011_whitelists_must_match_the_declared_fields`; `backend/tests/core/test_filtering.py::test_fnd_011_query_models_forbid_unknown_fields` |
| FND-012 | `backend/tests/core/test_events.py::test_fnd_012_publish_is_transactional`; `backend/tests/core/test_events.py::test_fnd_012_handler_failure_rolls_back` |
| FND-013 | `backend/tests/core/test_events.py::test_fnd_013_retry_and_failed_after_eight`; `backend/tests/core/test_events.py::test_fnd_013_concurrent_workers_do_not_duplicate`; `backend/tests/core/test_events.py::test_fnd_013_dispatch_once`; `backend/tests/core/test_events.py::test_fnd_013_missing_consumer_retries` |
| FND-014 | `backend/tests/organizations/test_events.py::test_org_idempotent_replay_does_not_publish_again`; `backend/tests/core/test_idempotency.py::test_fnd_014_first_request_is_claimed_in_progress_in_a_committed_transaction`; `backend/tests/core/test_idempotency.py::test_fnd_014_success_becomes_completed_with_the_response`; `backend/tests/core/test_idempotency.py::test_fnd_014_same_key_same_body_returns_cached`; `backend/tests/core/test_idempotency.py::test_fnd_014_same_key_different_body_409`; `backend/tests/core/test_idempotency.py::test_fnd_014_parallel_same_key_one_executes`; `backend/tests/core/test_idempotency.py::test_fnd_014_parallel_claims_of_one_key_have_one_owner`; `backend/tests/core/test_idempotency.py::test_fnd_014_in_progress_key_returns_request_in_progress`; `backend/tests/core/test_idempotency.py::test_fnd_014_failed_attempt_releases_the_key`; `backend/tests/core/test_idempotency.py::test_fnd_014_error_response_releases_the_key`; `backend/tests/core/test_idempotency.py::test_fnd_014_commit_failure_leaves_no_false_completed_result`; `backend/tests/core/test_idempotency.py::test_fnd_014_route_commits_business_change_only_with_completed_result`; `backend/tests/core/test_idempotency.py::test_fnd_014_business_change_and_completed_result_are_atomic`; `backend/tests/core/test_idempotency.py::test_fnd_014_rollback_leaves_the_claim_in_progress`; `backend/tests/core/test_idempotency.py::test_fnd_014_lost_claim_cannot_be_completed`; `backend/tests/core/test_idempotency.py::test_fnd_014_missing_key_400`; `backend/tests/core/test_idempotency.py::test_fnd_014_malformed_key_is_a_validation_error`; `backend/tests/core/test_idempotency.py::test_fnd_014_unauthenticated_request_claims_nothing`; `backend/tests/core/test_idempotency.py::test_fnd_014_requires_idempotent_route`; `backend/tests/core/test_idempotency.py::test_fnd_014_scope_is_user_method_and_route`; `backend/tests/core/test_idempotency.py::test_fnd_014_another_user_never_gets_a_stored_result`; `backend/tests/core/test_idempotency.py::test_fnd_014_ttl_is_24_hours_and_7_days_for_offline_sync`; `backend/tests/core/test_idempotency.py::test_fnd_014_expired_key_no_longer_binds`; `backend/tests/core/test_idempotency.py::test_fnd_014_cleanup_removes_only_expired_records`; `backend/tests/core/test_idempotency.py::test_fnd_014_request_body_is_stored_only_as_its_hash`; `backend/tests/core/test_idempotency.py::test_fnd_014_replay_of_an_empty_body_has_no_content` |
| FND-015 | `backend/tests/core/test_audit.py::test_fnd_015_audit_redacts_sensitive_fields` |
| FND-016 | `backend/tests/core/test_rate_limit.py::test_fnd_016_parallel_requests_obey_limit`; `backend/tests/core/test_rate_limit.py::test_fnd_016_rate_limit_429_retry_after` |
| FND-017 | `backend/tests/files/test_files.py::test_ver_002_upload_stores_private_file_with_hash` |
| FND-018 | `backend/tests/core/test_errors.py::test_fnd_008_default_language_is_tajik` |
| FND-019 | `backend/tests/core/test_request_actor.py::test_fnd_019_actor_context_isolated_and_reset`; `backend/tests/core/test_errors.py::test_fnd_019_unsafe_request_id_is_replaced` |
| FND-020 | `backend/tests/core/test_health.py::test_fnd_020_s3_unavailable_returns_503`; `backend/tests/core/test_health.py::test_fnd_020_health_and_meta`; `backend/tests/core/test_health.py::test_fnd_020_ready_503_when_redis_down` |
| FND-021 | `backend/tests/core/test_metrics.py::test_fnd_021_metrics_internal_only` |
| FND-022 | `backend/tests/core/test_foundation_contracts.py::test_fnd_022_worker_queues_and_recovery_configuration` |
| FND-023 | `backend/tests/core/test_openapi.py::test_fnd_023_openapi_error_contract` |
| FND-024 | `backend/tests/core/test_sequences.py::test_fnd_024_first_value_is_one_then_increments`; `backend/tests/core/test_sequences.py::test_fnd_024_scopes_and_keys_are_independent`; `backend/tests/core/test_sequences.py::test_fnd_024_sequence_concurrent_unique`; `backend/tests/core/test_sequences.py::test_fnd_024_value_is_used_only_when_the_callers_transaction_commits` |
| FND-030 | `scripts/test_p00_tooling.py::test_frontend_tooling_contract` |
| FND-031 | `frontend/src/app/router.test.tsx::renders a 404 page for unknown paths`; `frontend/src/app/router.test.tsx::renders a 403 page` |
| FND-032 | `frontend/src/app/shell/shells.test.tsx::shows the owner console with live team size and honest empty panels` |
| FND-033 | `frontend/src/shared/i18n/i18n.test.ts::persists the switch and updates the document language` |
| FND-034 | `frontend/src/shared/api/client.test.ts::sends language, request id, bearer token and org header`; `frontend/src/shared/api/client.test.ts::parses the API-001 error envelope` |
| FND-035 | `frontend/src/shared/ui/ui.test.tsx::ErrorState offers a retry action (FE-001)` |
| FND-036 | `frontend/src/shared/lib/money.test.ts::rounds half up like the backend q2, without float error` |
| FND-037 | `frontend/src/shared/i18n/i18n.test.ts::has identical keys in tg, ru and en`; `scripts/test_p00_tooling.py::test_error_catalog_covers_every_language` |
| FND-038 | `frontend/e2e/foundation.spec.ts::P00 ${area} area works against the real API` |
| FND-040 | `scripts/test_p00_tooling.py::test_ci_enforces_foundation_gates` |
