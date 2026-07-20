# Ticket 05 closure evidence

This bundle records one continuous administrator session against the real
local PostgreSQL runtime.

1. The stored model execution mode begins at `direct`, with both the HTTP and
   job-worker boot snapshots effective at revision 1.
2. The administrator records `recorded` through `/admin/models`; the page
   immediately and honestly reports restart pending.
3. Both Core processes are restarted while the browser recording remains
   continuous. The page then reports `recorded` effective for both processes
   at revision 2.
4. The administrator uses the visible history action to roll back to revision
   1. The rollback appends revision 3 and again reports restart pending.
5. Both processes restart a second time. The final page and SQL snapshot show
   `direct` effective for HTTP and job-worker from DB revision 3.

`config-version-chain.sql.txt` is a read-only PostgreSQL capture of the three
immutable revisions and the final two process snapshots. The evidence contains
no provider credentials or cookies.
