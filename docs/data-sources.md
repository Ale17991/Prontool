# External data sources

Inventory of data the platform ingests from outside the repo, how it
got there, and the legal status of each source.

## TUSS — Tabela de Terminologia Unificada da Saúde Suplementar

### What it is

The TUSS "Tabela 22" (procedimentos e eventos em saúde) is a regulatory
code table published by the **Agência Nacional de Saúde Suplementar
(ANS)**, the Brazilian federal agency that regulates private health
plans. Procedures that providers bill to health plans must reference a
TUSS code.

### How we ingest it

`pnpm seed:tuss` (script at `scripts/seed-tuss.ts`) downloads the JSON
from a pinned ref of the GitHub mirror
[`charlesfgarcia/tabelas-ans`](https://github.com/charlesfgarcia/tabelas-ans),
normalizes it, and upserts into `tuss_codes` while recording a row in
`tuss_catalog_versions` (commit SHA + content hash) so every import is
auditable. The `detect-deprecated` post-step fans out alerts to
tenants whose procedures reference codes whose `valid_to` just became
non-null.

### License verification (2026-04-20)

Verified via `GET https://api.github.com/repos/charlesfgarcia/tabelas-ans/license`:

> HTTP 404 — "Not Found"

**The upstream mirror does not declare a license.** That's the literal
result `fetchLicenseInfo()` gets and the reason the seed script aborts
with the `SEED_TUSS_FORCE=1` gate.

### Legal analysis (preliminary — pending DPO / legal signoff)

- The **underlying data** (TUSS Tabela 22) is regulatory material
  issued by a federal agency. Under Brazilian Law 9.610/98 Art. 8 IV,
  "leis, decretos, regulamentos, decisões judiciais e demais atos
  oficiais" are not protected by copyright.
- The **mirror repository** is a mechanical CSV→JSON transformation
  with no apparent creative expression to attract independent
  copyright. However, Brazilian law permits database-rights claims
  even for mechanical compilations, so the absence of a license is
  not automatically harmless.
- The **operational risk** is either (a) the upstream repo becomes
  unavailable, or (b) the owner later adds a restrictive license
  retroactively. Both are mitigated by the catalog-versions table:
  we always know the exact commit SHA and content hash of every
  imported snapshot, so we can reproduce the dataset from our own
  backups if upstream disappears.

### Production seed-flag status — still gated

The script refuses to run in production without `SEED_TUSS_FORCE=1`
precisely because the upstream is unlicensed. To lift the gate:

1. Legal reviews this document and confirms the public-domain reading
   of the ANS source is acceptable.
2. Either:
   - **Path A**: Fork the mirror into the org, add an explicit
     `CC0-1.0` or `MIT` LICENSE file, and update `REPO` in
     `scripts/seed-tuss.ts` to point at the fork. The existing
     `fetchLicenseInfo` check will then accept it without `FORCE`.
   - **Path B**: Vendor the JSON into `supabase/seed/tuss/` checked
     into this repo, and replace the remote download with a local
     file read. This also removes the runtime dependency on
     GitHub's availability.
3. Once Path A or B is in place and legal signs off in writing
   (store the signoff in the legal folder, reference it from here),
   stop requiring `SEED_TUSS_FORCE=1` in the production seed runbook.

Until then, every production seed of TUSS must:
- Be run by the platform operator, not by tenants.
- Attach `SEED_TUSS_FORCE=1` explicitly.
- Include the legal justification in the change-management ticket.

**TODO for legal review**: confirm or reject the Art. 8 IV reading
above. If rejected, the next step is Path A (fork) or Path B (vendor),
and this section gets updated accordingly.

## Other external sources

None currently. Future additions (GHL API lookups beyond the webhook,
address verification, etc.) should get their own section here with the
same three headings: what, how, license.
