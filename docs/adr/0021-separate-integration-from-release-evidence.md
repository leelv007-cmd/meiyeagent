# Separate integration state from release evidence

The project records implementation completion, local production-path verification, required-CI verification, and release readiness as separate states tied to an exact integration SHA. Local merges, focused tests, PostgreSQL/DBOS runs, Chromium journeys, pushed branches, and pull requests each provide useful evidence, but none may substitute for the protected branch's required same-SHA workflow; dated reviews and handoffs therefore remain immutable historical snapshots while one current-status document owns the latest release boundary.
