# A2 — Direct-copy authorization evidence (written instrument)

- **Recorded:** 2026-07-19 (Asia/Shanghai)
- **Updated:** 2026-07-19 — dual grantors + written instrument path attached
- **Gate:** A2 written-scope delivery gate for Pro Studio direct copies from Vozeb
- **Evidence class:** Written Git-repo development authorization + product-owner confirmation that **both** rights-relevant authors confirmed
- **Does not claim:** Court-grade legal opinion, AGPL dual-license counsel memo, or empty-copy conformance pass

## 1. Attestation

| Field | Value |
| --- | --- |
| Grantors (授权方) | **`csyqlz`** and **`basketikun`** (both confirmed) |
| Grantee (被授权方) | `legacy-origin-a` |
| Confirmation channel | **Written instrument** (see §2) + product-owner confirmation both authors agreed |
| Confirmation date (as recorded) | 2026-07-19 |
| Recorded by | Product owner (repository operator) |
| Upstream repository | `https://github.com/csyqlz/vozeb` |
| Pinned engineering baseline | `a2c52c7aacf68d825563b7455efa9c34f3db0123` (`v1.0.0`) |
| Related technical upstream | `basketikun/infinite-canvas` (inheritance fact; grantors include `basketikun`) |

## 2. Written instrument

| Item | Path / value |
| --- | --- |
| Source path (as filed by product owner) | `docs/design/# Git 仓库开发授权书.md` |
| Stable evidence copy | `docs/evidence/pro-studio/git-repo-dev-authorization-instrument.md` |
| SHA-256 (both files, byte-identical at archive time) | `6858087ea56a8bf54ae1f88dacf2deb831bb18eeb11c88b3999458508805e40d` |
| Title | Git 仓库开发授权书 |
| Stated purpose | **商业开发及复制** (commercial development and copy) |
| Term language in instrument | 「长期有效，直至授权方书面撤销」 (checkbox not marked in the markdown form; treat as intended long-term until written revocation unless grantors correct) |

Instrument §三 restricts destructive/history/security abuse of the **upstream Git repo** and forbids leaking source to **unrelated** third parties. That is read as repo-governance / anti-leak, not as a ban on the grantee’s authorized **商业开发及复制** into the 美业内容2 product under §一.

Instrument §五 requires the grantee not to introduce unlicensed third-party IP; open-source dependencies must follow their own licenses — this is the A3 seam (see `a3-authorization-2026-07-19.md`).

## 3. Product implementation scope (what we will exact-copy)

Legal instrument purpose is commercial development and copy of the named Vozeb repository. **Engineering policy for exact-copy rows remains narrower** (product decision / ADR-0012):

| Dimension | In scope for `copies[]` | Out of scope (still do not exact-copy) |
| --- | --- | --- |
| Modules | Canvas / render / retouch **core** for Pro Studio advanced canvas | Vozeb backend/business runtime, arbitrary proxy, Points/billing, local Agent bridge, admin/auth shells |
| Baseline | Files at pinned commit `a2c52c7` unless a new A2 addendum names another SHA | Unpinned `main` drift |
| Use | Commercial use; closed-source SaaS / hosted service for 美业内容2; supporting internal tools | Wholesale rebrand/relicense of Vozeb as a competing open product under the Vozeb brand |
| Operations | Copy, modify, merge, create derivatives, deploy as part of our product | Automatic sublicense of third-party rights (A3) |
| Branding | May remove VOZEB product chrome from embedded UI | No claim to VOZEB trademarks as our brand |

Each concrete `copies[]` row must still list `source`, `target`, `sha256`, `authorizationStatus: authorized`, and point at:

- A2: this file
- A3: `docs/evidence/pro-studio/a3-authorization-2026-07-19.md`

## 4. Rights subjects

| Identity | Role in this record |
| --- | --- |
| `csyqlz` | Co-grantor on written instrument; Vozeb repo owner / majority public commits |
| `basketikun` | Co-grantor on written instrument; technical upstream / infinite-canvas author |
| `legacy-origin-a` | Named grantee on written instrument |

Dual-author residual from the earlier oral-only draft is **closed** for grantor identity.

## 5. What this unlocks / does not unlock

**Unlocks**

- A2 evidence path for Pro Studio copy-manifest and future exact-copy rows.
- Dual grantor confirmation (`csyqlz` + `basketikun`) on a written instrument with content hash.

**Does not unlock**

- `pnpm pro-studio:conformance` copy gate while `copies: []` or sha256 mismatches.
- A3 clearance of fonts/icons/media/prompt corpora/npm packages (see A3).
- Production sale gates (N2, security matrix production drill, pricing/upsell).

## 6. Residuals (honest)

1. Markdown form checkbox for term is unchecked (`□`); if a wet-ink or digitally signed PDF supersedes, re-hash and attach.
2. Instrument is a **repo development / commercial copy** grant, not a full dual-license counsel opinion on AGPL network-use edge cases.
3. No exact-copy file set is authorized by silence — only by hashed `copies[]` rows under this A2 + A3.
