# Ticket 15 rights withdrawal journey

Status: **accepted for the image rights-revocation path**.

The browser recording starts with an authorized real Product asset and an
accepted ContentPackage that already has successful and failed export receipts.
The merchant withdraws the asset in the asset library. The same package then
appears as `需处理`, shows `引用素材已撤回授权`, and disables both export
and reuse in the visible detail surface.

Direct command checks returned `RIGHTS_REVOKED` and `REUSE_SOURCE_REVOKED`
with HTTP 409. The package kept all 13 prior receipts and both base versions;
no export artifact, receipt, version, or reuse child was added by the blocked
commands.

The first two keyframes and the continuous video come from the uncut withdrawal
run. The final two screenshots were captured in the same authenticated browser
after the UI status label differed from the harness's initial exact-text wait.
