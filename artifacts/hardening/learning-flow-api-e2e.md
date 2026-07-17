# Learning Flow Live API E2E

- Result: **PASS**
- Marker: `CODEX-HARDENING-53cfdf0c-fee9-4936-b812-4bfa41b71d0c`
- Cleanup: `{"attempted": true, "matched_ids": [], "remaining": 0}`

| Check | Result | HTTP | ms | Detail |
|---|---:|---:|---:|---|
| health | PASS | 200 | 24 | backend health endpoint |
| anonymous_rejected | PASS | None | 30 | templates require authentication |
| login | PASS | 200 | 132 | test account authenticated |
| course_scope | PASS | 200 | 39 | available_courses=1 |
| knowledge_point_scope | PASS | 200 | 16 | available_points=10 |
| create | PASS | 200 | 56 | template_id=84 |
| save_position | PASS | 200 | 53 | position={'x': 360, 'y': 240} |
| reload_position | PASS | 200 | 20 | position={'x': 360, 'y': 240} |
| reject_cycle | PASS | None | 30 | self-loop rejected |
| version_integrity | PASS | 200 | 11 | versions=2 |
| delete | PASS | 200 | 40 | {"deletedCount": 1, "archivedCount": 0, "deletedPermanently": 1} |
| cleanup_verified | PASS | 200 | 24 | remaining=0 |
