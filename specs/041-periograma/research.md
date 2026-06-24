# Research — Periograma (Fase 3)

Phase 0 do `/speckit.plan`. Resolve as decisões técnicas. As 3 ambiguidades de produto já foram resolvidas em `/speckit.clarify` (ver `spec.md → Clarifications`); aqui ficam as decisões de implementação.

## D1 — Modelo do exame: snapshot datado vs. estado corrente

**Decisão**: Exame datado (header `perio_exams`) + medições filhas, com ciclo `rascunho → finalizado`. Editável só em rascunho; congelado ao finalizar.

**Rationale**: O requisito de comparação ao longo do tempo (US2) exige snapshots imutáveis por data. Reaproveita o padrão de ciclo/congelamento de `treatment_budgets` (migration 0160), já validado no projeto. Diferente do odontograma (0134), que é "último registro por posição" (append-only sem header) — lá não há conceito de exame de boca toda.

**Alternativas consideradas**: (a) append-only por posição como o odontograma — rejeitado: não modela "exame de boca toda numa data" nem permite comparar dois estados completos de forma limpa. (b) JSONB único por exame — rejeitado: dificulta consultas por sítio/indicadores e validação por coluna.

## D2 — Convenção de margem/recessão e cálculo do CAL

**Decisão**: Guardar **recessão com sinal** (`recession_mm`, inteiro): positivo = recessão (margem apical à JCE), negativo = margem coronal/hiperplasia. **CAL = probing_depth_mm + recession_mm**. (Clarification 2026-06-23.)

**Rationale**: Um único campo com sinal torna o CAL uma soma trivial, sem ambiguidade de referência. Evita armazenar simultaneamente margem e recessão (redundância que diverge).

**Alternativas**: armazenar posição da margem relativa à JCE e derivar recessão — equivalente mas com passo extra; rejeitado por simplicidade.

## D3 — Sítios: enum próprio (6) vs. reuso das faces do odontograma

**Decisão**: Enum **próprio** de 6 sítios periodontais, distinto das 5 faces do odontograma (`teeth.ts SURFACES`). Sítios: `db, b, mb` (vestibular: disto/centro/mésio) e `dl, l, ml` (lingual/palatina: disto/centro/mésio). Persistidos como TEXT com CHECK.

**Rationale**: Faces do odontograma (mesial/distal/oclusal/vestibular/lingual + cervical/raiz) descrevem superfícies do dente; sítios periodontais são pontos de sondagem (6 por dente) — semântica e cardinalidade diferentes. Misturar quebraria validação e indicadores. Reusa-se `teeth.ts` apenas para a **lista de dentes/dentição FDI**, não para os sítios.

**Alternativas**: reusar `SURFACES` — rejeitado: cardinalidade (5/7 vs 6) e significado divergem.

## D4 — Congelamento ao finalizar (imutabilidade)

**Decisão**: `perio_exams.status` com CHECK (`rascunho`,`finalizado`); trigger `BEFORE UPDATE` em `perio_exams` permite só a transição `rascunho→finalizado` (carimba `finalized_at/by`) e bloqueia mudança de núcleo; trigger `BEFORE INSERT/UPDATE/DELETE` em `perio_site_measurements` e `perio_tooth_findings` rejeita escrita quando o exame-pai não está em rascunho. Espelha `enforce_treatment_budget_update` (0160).

**Rationale**: Mantém a regra de imutabilidade no banco (defesa última), independente da app. Consistente com Princípio I por analogia.

**Alternativas**: validar só na app — rejeitado: viola defesa-em-camadas do projeto.

## D5 — Único rascunho por paciente

**Decisão**: Índice único parcial `UNIQUE (tenant_id, patient_id) WHERE status = 'rascunho'`. (Clarification 2026-06-23.)

**Rationale**: Garante a regra no schema (padrão já usado no projeto, ex.: `doctors (tenant_id, user_id) WHERE user_id IS NOT NULL`). A app retorna erro amigável ao tentar criar 2º rascunho.

## D6 — Persistência da grade: linha-por-sítio vs. lote

**Decisão**: Tabela `perio_site_measurements` com 1 linha por (exame, dente, sítio); a app salva em **lote** (PATCH com array de células alteradas) via upsert `ON CONFLICT (exam_id, tooth_fdi, site)`. Achados por dente em `perio_tooth_findings` (1 linha por exame×dente), idem upsert.

**Rationale**: Linha-por-sítio permite consultas/índices para indicadores e comparação por sítio. O upsert em lote reduz round-trips na digitação rápida. UNIQUE natural `(exam_id, tooth_fdi, site)` evita duplicidade.

**Alternativas**: 1 linha por dente com 6 colunas×N campos — rejeitado: rígido e ruim para comparação por sítio; JSONB — ver D1.

## D7 — Indicadores: RPC vs. cálculo na app

**Decisão**: Cálculo **puro** em `sites.ts` (testável sem banco) usado pela UI/serviço; **RPC `perio_exam_indicators`** (DEFINER, com guarda de tenant) para leituras server-side eficientes (lista de exames, comparação) sem trazer todas as medições. Ambos seguem a mesma fórmula.

**Rationale**: A UI precisa recalcular ao vivo no rascunho (cliente); listas/comparação se beneficiam de agregação no banco. Fórmula única documentada evita divergência.

**Faixas/cálculo**: BOP% = sítios com sangramento / sítios medidos (dentes presentes); bolsas ≥4 mm = contagem de `probing_depth_mm >= 4`; CAL médio = média de `(probing_depth_mm + recession_mm)` nos sítios medidos. Validação: `probing_depth_mm` 0–15; `recession_mm` −5..+15 (CHECK no banco + Zod na rota).

## D8 — UI da grade

**Decisão**: Grade em **tabela HTML/React** (não SVG): colunas = dentes (na ordem anatômica de `teeth.ts`), grupos de linhas por arcada (vestibular/lingual), linhas PD / recessão / BOP; inputs numéricos com navegação por teclado (setas/Tab/Enter avançam sítio). **Sem novas deps.** Gráfico de evolução na comparação é opcional via `recharts` (já no projeto).

**Rationale**: Periograma é tabular por natureza; tabela dá densidade e navegação por teclado melhor que SVG. O odontograma continua SVG; são telas distintas dentro do Odonto-Space.

## D9 — Numeração da migration

**Decisão**: `0161_perio_chart.sql` (última na master é `0160_treatment_budgets_and_dental_position.sql`). Idempotente (`IF NOT EXISTS`, `DO $$ … duplicate_object`).

**Rationale**: próximo número livre; segue convenção do projeto.
