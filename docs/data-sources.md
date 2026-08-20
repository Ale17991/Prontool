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

We ingest four of ANS's tables into `tuss_codes`:

|  Table | Name                              | Rows (ANS 202607) |
| -----: | --------------------------------- | ----------------: |
| **22** | Procedimentos e eventos em saúde  |             5.967 |
| **19** | Materiais e OPME                  |         1.497.220 |
| **20** | Medicamentos                      |            44.574 |
| **18** | Diárias, taxas e gases medicinais |             3.596 |

The `tuss_codes.tuss_table` discriminator tells the app which table a
given code came from. Collision testing (`pnpm check:tuss-collision`)
confirmed that at ANS version 202607 the four tables' code sets are
disjoint (prefixes: 1–5/8 for 22, 6 for 18, 7 and 1000000xx for 19, 9
for 20), so `UNIQUE(code)` is kept global and no composite key is
required in `procedures.tuss_code`. The seed re-checks the same
invariant in-process on a `--table all` run and aborts before writing
if it ever breaks.

Table 63 (grupos de procedimentos para envio à ANS) and the ~60 small
domain tables shipped in "TUSS - Demais terminologias" are **not** in
`tuss_codes` — the domain tables live in `tiss_domain_tables`, seeded
separately by `pnpm seed:tiss-domains` and `pnpm seed:tuss-38`.

### How we ingest it

`pnpm seed:tuss:22 | :19 | :20 | :18 | :all` (script at
`scripts/seed-tuss.ts`, source reader shared with the collision check in
`scripts/tuss-ans-source.ts`) downloads the official ANS package:

```
https://www.ans.gov.br/arquivos/extras/tiss/
  Padrao_TISS_Representacao_de_Conceitos_em_Saude_<AAAAMM>.zip
```

The version is pinned in `ANS_VERSION_DEFAULT` (currently **202607**) and
overridable with `--version AAAAMM` or `TUSS_ANS_VERSION`. The ~410 MB zip
is cached under `.cache/tuss/` (gitignored) and the extracted `.xlsx`
sheets under `.cache/tuss/sheets/`; neither is re-downloaded if present.
`TUSS_ANS_ZIP=/path/local.zip` skips the download entirely.

Parsing is by **header label**, never by column index — ANS moves columns
between versions (table 19 gained "Classe de Risco" and "Nome Técnico"
along the way) and the header row sits on a different line in each file.
Table 19 ships split across two workbooks and is read as one logical
table. Each import records one row per table in `tuss_catalog_versions`
(`source_ref = tabela_<N>@ANS-<AAAAMM>`, plus a content hash) so every
import is auditable. The `detect-deprecated` post-step runs once at the
end across all tables.

`gov.br` and `ans.gov.br` reject clients without a browser User-Agent,
so the downloader sends one — same note as `seed-tuss-38.ts`.

### Vigência — `valid_to` is real now

The official spreadsheets carry **Data de início** and **Data de fim de
vigência**. Before ANS became the source, `valid_from` was a hardcoded
`2008-01-01` marker and `valid_to` was always NULL, which meant the
retirement machinery — the `enforce_tuss_code_active_on_procedure`
trigger (0024) and `detect-deprecated` — had nothing to act on. From the
0194 import onward both columns come from the publication.

**Version 202607 retires almost nothing**: 2 codes in total, both in
table 18. Do not let the raw spreadsheet fool you — 205.561 of table
19's rows have the end-of-vigência cell filled with an **empty string**
rather than left blank, so a "cell is not null" count reports 205 k
phantom retirements. The parser reads a _date_, which is why it gets 0.
Expect few or no `tuss_deprecated` alerts on the first prod run; that is
the source being accurate, not the scan being broken.

### 130 codes prod carries that ANS no longer publishes

The first official import (2026-08-10) left table 22 in production at
6.097 rows against the official 5.967. The extra 130 are real TUSS
procedure codes inherited from the old mirror that the 202607
publication has dropped — obsolete lab work ("Células LE",
"Mucoproteínas"), superseded numbering ("Traqueostomia" 30801095, since
renumbered). **None of them is referenced by any tenant's procedures**,
checked at import time.

Decision (2026-08-10): **leave them alone**. The seed never deletes —
`procedures.tuss_code` is a FK with ON DELETE RESTRICT, so removal is
not on the table anyway — and retiring them would mean inventing a
`valid_to` the ANS never published. The cost is that the typeahead can
still offer a code that cannot be billed today; the count is small,
nothing uses them, and the alternative risks hiding a code that is
merely restructured rather than dead. Revisit if a clinic ever reports
a glosa traced to one of them.

Note this is the difference between _retired_ and _absent_: retirement
is published as `valid_to` and the product acts on it; absence is
silent, and the seed leaves the last known state untouched.

### Why not the community mirror any more

Until 2026-08 the source was the GitHub mirror
[`charlesfgarcia/tabelas-ans`](https://github.com/charlesfgarcia/tabelas-ans).
It stopped tracking ANS: 5.851 procedures against the official 5.967, and
1.114 medications against 44.574. Codes published after the mirror's last
commit simply did not exist in the product — `30310172` (cirurgia
antiglaucomatosa via angular, IN 65/2021) and `20101406` (acompanhamento
pós-cirurgia fistulizante) were the two that surfaced in real use, both
ophthalmology. The mirror also never published the vigência columns.

### License

The data is issued by a federal agency and downloaded from that agency's
own site. Under Brazilian Law 9.610/98 Art. 8 IV, "leis, decretos,
regulamentos, decisões judiciais e demais atos oficiais" are not
protected by copyright. Going direct to ANS also removes the database-
rights question the unlicensed mirror raised — which is why the old
`SEED_TUSS_FORCE=1` gate is gone from the seed script. Nothing about the
production run is legally gated now; it is just an operator task.

### Reimport plan

1. Check the ANS publication page for a newer package (ANS publishes
   every other month; sensitive dates are Jan/Mar/May/Jul/Sep/Nov):
   <https://www.gov.br/ans/pt-br/assuntos/prestadores/padrao-para-troca-de-informacao-de-saude-suplementar-2013-tiss>
2. Bump `ANS_VERSION_DEFAULT` in `scripts/tuss-ans-source.ts` in a PR —
   the version is deliberately pinned rather than auto-discovered so the
   change is reviewable and the seed reproducible.
3. Run `pnpm check:tuss-collision` — must exit 0.
4. Run `pnpm seed:tuss:all` against local/staging first; confirm
   `tuss_catalog_versions` gained one row per table and that the
   `detect-deprecated` alerts look sane.
5. Promote with `pnpm seed:tuss:prod:all`. Budget time: the table 19
   upsert alone is ~750 batched requests (~35 min against the local
   stack; longer over the internet). Transient transport errors are
   retried with backoff — a local run did hit one `TypeError: fetch
failed` at 53% before that was added. The upsert is idempotent, so a
   run that dies for another reason can simply be started again.

### Operational note — table 19 is large

Table 19 at full fidelity is ~1,5 M rows and dominates the database
footprint of `tuss_codes` (order of 1 GB with indexes). Two things
follow, both handled in migration 0194:

- The typeahead cannot use `or=(code.ilike,description.ilike,
manufacturer.ilike)` at that scale — there is no index that serves it.
  Search goes through the `search_tuss_codes` RPC, backed by one GIN
  trigram index over the concatenated, unaccented, lowercased triple.
- `detect-deprecated` no longer pulls the full retired-code list (it
  would silently truncate at PostgREST's 1000-row cap); it looks up only
  the codes actually referenced by procedures.

## Other external sources

None currently. Future additions (GHL API lookups beyond the webhook,
address verification, etc.) should get their own section here with the
same three headings: what, how, license.
