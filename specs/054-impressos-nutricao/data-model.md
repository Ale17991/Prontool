# Data Model — Impressos da consulta de nutrição

## Nenhuma tabela nova

Esta feature **não cria, não altera e não remove tabela alguma**. Não há
migration. O impresso é uma **saída**, recomposta a cada emissão a partir do que
já está gravado.

Isso está dito aqui de forma explícita porque a leitura natural de "gerar
documento" é criar uma tabela de documentos gerados — e seria errado por dois
motivos: criaria cópia de dado sensível fora do banco (LGPD) e congelaria um PDF
que ficaria desatualizado assim que a avaliação fosse corrigida.

## De onde cada impresso lê

| Impresso                      | Fonte                                                                            | Feature     |
| ----------------------------- | -------------------------------------------------------------------------------- | ----------- |
| Plano alimentar               | `diet_plans`, `diet_meals`, `diet_meal_items`, `food_equivalence_lists`, `foods` | 047         |
| Antropometria / bioimpedância | `nutrition_assessments` (snapshot imutável)                                      | 046         |
| Recordatório                  | `food_recalls`, `food_recall_items`                                              | 049         |
| Exames laboratoriais          | `patient_measurements` + `lab_reference_ranges`                                  | 050 · 030   |
| Avaliação infantil            | `vital_signs` + `growth_percentiles` + `patients.birth_date/sex`                 | 0190        |
| Avaliação gestacional         | `nutrition_assessments` + `vital_signs`                                          | 046         |
| Orientações                   | `patient_care_notes`                                                             | 032         |
| Anamnese                      | `clinical_records` + `anamnesis_templates`                                       | 0029 · 0030 |
| Cabeçalho de todos            | `tenant_clinic_profile`, `patients`                                              | 009         |

## Estruturas em memória

Existem só durante a renderização; nenhuma é persistida.

### `PrintoutHeader`

Identificação repetida em todo documento e em toda página.

| Campo                             | Origem                  | Observação                         |
| --------------------------------- | ----------------------- | ---------------------------------- |
| `clinicName`, `logoUrl`           | `tenant_clinic_profile` | logo por URL assinada de TTL curto |
| `patientName`, `birthDate`, `age` | `patients`              | PII decifrada pela RPC existente   |
| `professionalName`                | sessão                  | quem emitiu                        |
| `issuedAt`                        | servidor                | dia civil da clínica, não UTC cru  |

### `EvolutionColumn`

Uma coluna do layout de evolução. Até três por documento.

| Campo        | Tipo                                              | Observação                                                  |
| ------------ | ------------------------------------------------- | ----------------------------------------------------------- |
| `assessedAt` | data                                              | rótulo da coluna                                            |
| `protocol`   | texto                                             | **obrigatório** — protocolos diferentes não são comparáveis |
| `rows`       | lista de `{ label, value, unit, classification }` | `value` nulo = sem dado                                     |

**Regra**: `value` nulo imprime travessão. Nunca zero. Mesma distinção que o
rótulo nutricional (052) estabeleceu entre "é zero" e "não sei".

### `PlanPrintout`

| Campo              | Observação                                                  |
| ------------------ | ----------------------------------------------------------- |
| `meals[]`          | nome, horário, `targetPct` quando houver                    |
| `meals[].items[]`  | nome, gramas, medida caseira                                |
| `meals[].groups[]` | **alternativas**, com a marca "ou" — nunca somadas ao total |
| `totals`           | energia e macros do dia, vindos de `diet/totals`            |
| `isDraft`          | dispara a tarja de rascunho                                 |

## Invariantes

1. **Nada é recalculado no PDF.** Os componentes recebem números prontos.
2. **Ausência é ausência.** `null` vira travessão; zero só aparece quando o valor
   é de fato zero.
3. **Grupo é alternativa.** No plano, as opções de um grupo contam uma vez, não
   uma por opção.
4. **Coluna exige protocolo.** Um valor de composição corporal sem o método que o
   produziu não pode ser impresso ao lado de outro.
5. **Escopo de clínica.** Toda leitura filtra por `tenant_id` da sessão.
