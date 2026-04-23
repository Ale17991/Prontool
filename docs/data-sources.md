# External data sources

Inventory of data the platform ingests from outside the repo, how it
got there, and the legal status of each source.

## TUSS — Tabela de Terminologia Unificada da Saúde Suplementar

### What it is

TUSS is a family of regulatory code tables published by the
**Agência Nacional de Saúde Suplementar (ANS)**, the Brazilian federal
agency that regulates private health plans. Providers billing health
plans must reference TUSS codes for procedures, materials and
medication.

We ingest three of ANS's tables into `tuss_codes`:

| Table | Name | Rows (as of 2026-04-23) |
|------:|------|---:|
| **22** | Procedimentos e eventos em saúde | 5.851 |
| **19** | Materiais e OPME | 38.553 |
| **20** | Medicamentos | 1.114 |

The `tuss_codes.tuss_table` discriminator tells the app which table a
given code came from. Collision testing (`scripts/check-tuss-collision.mjs`)
confirmed that at the pinned upstream commit the three tables' code
sets are disjoint, so `UNIQUE(code)` is kept global and no composite key
is required in `procedures.tuss_code`. If a future reseed detects
collision, the script exits non-zero and the schema must be migrated
before the seed proceeds.

Tables 18 (diárias/taxas/gases), 63 (OPME) and all remaining ANS
tables are **not** supported — the upstream mirror does not publish
them. If a clinic needs those, expect either a new upstream source or a
direct ANS FTP/XLSX ingestion path, which is out of scope today.

### How we ingest it

`pnpm seed:tuss:22 | :19 | :20 | :all` (script at `scripts/seed-tuss.ts`)
downloads the JSON from a pinned ref of the GitHub mirror
[`charlesfgarcia/tabelas-ans`](https://github.com/charlesfgarcia/tabelas-ans),
normalizes it per-table shape (22 uses `procedimento`; 19 and 20 use
`descricao` + `fabricante`), and upserts into `tuss_codes` while
recording one row per table in `tuss_catalog_versions`
(`source_ref = tabela_<N>@<sha>`, plus content hash) so every import is
auditable. The `detect-deprecated` post-step runs once at the end and
fans out alerts to tenants whose procedures reference codes whose
`valid_to` just became non-null — works across all three tables.

Before any reseed, run `node scripts/check-tuss-collision.mjs` to
re-verify that the disjoint-codes invariant still holds at the current
upstream commit.

### Staleness — mirror may lag ANS

The upstream mirror is a community project with no declared update
cadence. ANS revises the rolling `Rol de Procedimentos` every few
years and publishes terminology updates more frequently. Treat the
mirror as **best-effort recency**:

- Our `tuss_catalog_versions` row records the exact commit SHA we
  imported, so we always know which snapshot is in play per tenant.
- The production runbook should include a periodic check against the
  official ANS publication (sensitive dates: Jan/Jul of each year) to
  decide whether to reseed.
- If the mirror falls behind ANS, the failure mode is **not** data
  corruption — it's a benign lag: newly-published codes won't appear
  in the typeahead until the next reseed, and existing codes keep
  working. Detect-deprecated only flags things when a reseed actually
  reveals a retired code upstream.

### Reimport plan

1. Watch the ANS publication page (or a downstream tracker) for a new
   Rol or terminology update.
2. Bump `TUSS_REPO_REF` (or the ref embedded in `scripts/seed-tuss.ts`)
   to the mirror commit that reflects the new publication.
3. Run `node scripts/check-tuss-collision.mjs` — must exit 0.
4. Run `pnpm seed:tuss:all` in a staging tenant first; confirm
   `tuss_catalog_versions` row count increments and `detect-deprecated`
   alerts look sane.
5. Promote to production with `SEED_TUSS_FORCE=1` (see License section
   below — the force-flag remains a legal gate, not a technical one).

### License verification (2026-04-20)

Verified via `GET https://api.github.com/repos/charlesfgarcia/tabelas-ans/license`:

> HTTP 404 — "Not Found"

**The upstream mirror does not declare a license.** That's the literal
result `fetchLicenseInfo()` gets and the reason the seed script aborts
with the `SEED_TUSS_FORCE=1` gate.

### Legal analysis (preliminary — pending DPO / legal signoff)

- The **underlying data** (TUSS tables 22, 19 and 20) is regulatory
  material issued by a federal agency. Under Brazilian Law 9.610/98
  Art. 8 IV, "leis, decretos, regulamentos, decisões judiciais e
  demais atos oficiais" are not protected by copyright.
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
