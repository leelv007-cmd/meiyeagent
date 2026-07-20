# Ticket 13–16 runtime checkpoint

Status: **failed export isolated; storage-root fix requires a fresh Core process**.

This is a real browser run against the shared development stack. The merchant
opened the existing three-platform ContentPackage, prepared a new Xiaohongshu
version that referenced only its receipt-backed owned PNG, and exported from
the visible detail screen. The export still produced an `export_adapter_failed`
receipt because the listening Core process had been launched from the repository
root while the durable bytes had been written under `apps/core/.data/p1-assets`.

The evidence run did not alter runtime configuration or restart a service. It
restored the previous three-image Xiaohongshu version through the public rollback
command. The package kept its base versions, all three platform variants, active
rights, and both failed receipts; it is visibly `needs_attention` and retryable.

The code fix anchors the default asset-storage directory to the Core package
instead of `process.cwd()`. Its regression test passes, but the direct Core
process on port 4100 has not loaded that change because restarting was outside
this run's authority.

## Files

- `journey/a27d05e34bca412482be64ced2ad2eea.webm`: uncut failed export run.
- `journey/keyframes/01-source-package-before-export.png`: real source package.
- `journey/keyframes/01b-owned-export-version.png`: receipt-backed owned-image version.
- `journey/keyframes/02-export-receipt-and-download.png`: user-visible failed receipt and retry state.
- `journey/keyframes/03-platform-version-restored.png`: three-image platform version restored through the public command.
- `journey/failure-evidence.json`: redacted aggregate and rollback facts.
- `journey/run-manifest.json`: checks and SHA-256 inventory.
