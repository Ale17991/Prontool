# Research — Micronutrientes, DRIs, Adequação e Recordatório (049)

Decisões técnicas para resolver os pontos em aberto antes do design. As escolhas de produto já resolvidas estão em `spec.md` → Clarifications.

## D1 — Como armazenar os micronutrientes no alimento

**Decisão**: coluna `micronutrients JSONB` em `public.foods` (mapa `nutrient_key → valor por porção de referência`), somada a um **catálogo TS** dos ~37 micros (`src/lib/core/nutrition/micronutrients.ts`) com `key`, `label`, `unit` e `driKey`.

**Rationale**: são ~37 campos **esparsos** (muitos nulos por alimento) que a soma percorre genericamente; JSONB evita migration de 37 colunas + churn futuro se a lista mudar, e o motor de soma itera as chaves sem código por-nutriente. A validação de plausibilidade fica no TS (como o Atwater do 047). Não precisamos filtrar/indexar por micronutriente no banco (a soma é no app), então colunas dedicadas não trazem ganho.

**Alternativas**: (a) ~37 colunas numéricas — rígido, verboso, queryável (não necessário); (b) tabela `food_micronutrients` (food_id, key, value) — normalizada mas cara pra ler (join/pivot em toda busca). Rejeitadas.

## D2 — Estratégia da base de micronutrientes (decidido no clarify)

**Decisão**: importar a `BD ALIMENTOS` da AF (6570 alimentos, energia+macros+micros por 100 g) como **base global autoritativa de micros** (`tenant_id NULL`), **coexistindo** com a base TACO/POF atual. Tag de origem (`source`) distingue.

**Rationale**: é a base própria da nutricionista e já é referenciada pelas listas de equivalência importadas; traz os micros prontos por 100 g. Coexistir preserva planos/alimentos existentes. Import via script tsx idempotente (padrão dos importadores da 047: `createClient` service + `.env.production.local`, streaming do `.xlsm` com `ExcelJS.stream.xlsx.WorkbookReader`), upsert por `(source, external_code)`/nome.

**Alternativas**: mesclar micros na base atual por nome (nomes divergem, baixa taxa de casamento) ou substituir a base (mexe no que está em uso). Rejeitadas no clarify.

**Gotcha**: `catalog_baseline` (migration 0170) — os alimentos globais sobrevivem ao reset via baseline; ao adicionar a coluna/dados, refazer o snapshot como nas 0174/0176.

## D3 — Tabela de DRIs

**Decisão**: tabela global `public.dietary_reference_intakes` (`tenant_id NULL`, read-only pela clínica) com: `nutrient_key`, `sex` (`M`/`F`/`any`), `age_min_years`, `age_max_years`, `state` (`padrao`/`gestante`/`lactante`), `value NUMERIC`, `unit`. Seed a partir da `BD_DRIs` (Evonut) como gabarito. Lookup por (nutriente, sexo, faixa etária, estado) escolhe a linha aplicável.

**Rationale**: espelha o padrão de catálogo global do projeto (como `food_groups`/`patient_metric_types`), com RLS read-only e sobrevivência via `catalog_baseline`. Chave de negócio `(nutrient_key, sex, age_min, age_max, state)` única.

## D4 — Motor de soma estendido a micros (isomórfico)

**Decisão**: estender `FoodRef` e o tipo de nutrientes do `diet/totals.ts` para carregar um mapa `micros: Record<string, number>`; `itemNutrients` escala os micros por regra de três junto de energia/macros. Ausência de um micro num alimento = chave ausente (não zero forçado); a soma acumula só o que existe e a apresentação sinaliza "pode estar subestimado" quando algum item não tinha o dado.

**Rationale**: mantém a garantia SC-002 (mesma função tela/servidor) já usada no 047 — só passa a incluir micros. Sem novo motor.

## D5 — Motor de adequação

**Decisão**: `src/lib/core/nutrition/adequacy.ts` puro: entra `{ totals (energia+macros+micros), patient: {ageYears, sex, state} }` e a tabela de DRIs (carregada por `dri/read.ts`); sai, por nutriente, `{ total, dri, unit, pct, class: 'abaixo'|'adequado'|'acima'|'sem_referencia' }`. Faixa: `<90% abaixo`, `90–110% adequado`, `>110% acima` (constantes ajustáveis). Idade derivada da data de nascimento (helper já criado na tela de avaliação), sexo do cadastro, ambos ajustáveis na tela.

**Rationale**: leitura derivada, não persistida (recalculável a qualquer momento a partir do plano/recordatório + DRIs). Não-bloqueante, só informa (espírito dos avisos da 046).

## D6 — Recordatório (R24h)

**Decisão**: tabelas `public.food_recalls` (tenant_id, patient_id, recall_date, notes, created_by) + `public.food_recall_items` (recall_id, tenant_id, meal_name, position, food_id, grams, measure_label, measure_qty) — espelhando `diet_meals`/`diet_meal_items` mas mais simples (um dia, sem prescrição/snapshot). Tela `/operacao/recordatorio` (page RSC + client), gated `nutri_recordatorio`, reusando `FoodSearch`, medidas caseiras e o motor de soma; roda a adequação sobre os totais. Histórico por paciente.

**Rationale**: R24h é registro editável de consumo real de um dia — não precisa da maquinaria de versão/prescrição imutável do plano. Reuso máximo do 047.

**Alternativa**: reusar `diet_plans` com um flag "tipo=recordatorio" — rejeitado: polui o modelo do plano (prescrição, active, equivalências) com um conceito diferente.

## Faseamento (pré-requisitos)

1. **US1 — Micros na base**: migration da coluna + catálogo TS + importação AF + soma estendida + exibição/cadastro. Pré-requisito das demais.
2. **US2 — DRIs + Adequação**: tabela + seed DRIs + motor de adequação + painel no plano.
3. **US3 — Recordatório**: tabelas + tela + reuso da soma/adequação.

## Riscos / validação

- **Valores clínicos** (micros e DRIs) dependem da fidelidade da extração das planilhas — validar amostras contra a fonte (polish com a nutricionista, análogo ao T047).
- **Licença dos dados** da base AF: é material próprio da nutricionista/planilha; confirmar uso comercial antes de expor a clínicas terceiras (mesma ressalva registrada na 047 sobre fontes).
- **Volume de busca**: base global cresce ~+6570 alimentos; a RPC de busca (trigram) já suporta; conferir performance com a base maior.
