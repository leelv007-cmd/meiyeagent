# Ticket 13–16 successful browser journey

Status: **accepted for Tickets 13 and 14, accepted simulated-device evidence for
Ticket 16, and accepted image burn-in evidence for Ticket 15**.

One continuous merchant browser session performed the following operations
against real Postgres and filesystem storage:

1. Opened the existing three-platform image-text ContentPackage.
2. Appended a temporary Xiaohongshu version using its receipt-backed owned PNG.
3. Exported through the visible UI and downloaded the ZIP.
4. Verified the downloaded bytes against the persisted receipt SHA-256 and size.
5. Replayed one command key twice and observed exactly one receipt side effect.
6. Logged in through a second browser context and downloaded identical bytes.
7. Restored the pre-evidence platform version through the public rollback command.
8. Created A → B → C through two visible `做同款` actions and captured
   bidirectional lineage.
9. Edited C in the mobile surface, then reopened the same stable package address
   on desktop and in a coarse-pointer context.

The extracted `01.png` visibly contains `内容由 AI 生成` in the upper-right
corner and the store watermark in the lower-right corner. The exact ZIP,
extracted PNG, continuous video, keyframes, network correlation log, structured
package facts, and SHA-256 manifest are under `journey/`.

This run uses simulated mobile and coarse-pointer contexts. It does not claim the
Ticket 16 true-device recording requirement.
