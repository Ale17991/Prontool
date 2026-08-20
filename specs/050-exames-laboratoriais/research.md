# Research — Exames Laboratoriais (050)

Decisões técnicas antes do design. As decisões de produto tomadas com o usuário nesta sessão estão marcadas como **[decidido pelo usuário]**.

## D1 — Persistência do resultado: motor de medições vs tabela dedicada

**Decisão [decidido pelo usuário]**: reusar o **motor de medições da feature 030**. Cada exame = uma linha em `public.patient_metric_types` com `specialty='laboratorio'`; cada resultado = uma linha append-only em `public.patient_measurements`. **Zero DDL** nessas tabelas.

**Rationale**: é o precedente literal, não uma analogia — a migration `0113` já semeou **7 exames laboratoriais** nesse motor (`glicemia_jejum`, `hba1c`, `colesterol_total`, `ldl`, `hdl`, `triglicerides` + `circunferencia_abdominal`). Criar uma tabela `lab_results` faria "glicemia" morar em dois lugares, com duas telas e duas séries temporais para o mesmo analito. O reuso herda pronto:

| O que se herda                                                                | Onde já existe                                                             |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Lançamento em lote atômico (um laudo, uma data, valida tudo antes de inserir) | `recordMeasurementsBatch` em `src/lib/core/patient-portal/measurements.ts` |
| Append-only garantido por trigger (correção = novo registro)                  | `enforce_append_only_columns('')` na 0113                                  |
| Validação anti-typo por faixa plausível                                       | trigger `validate_patient_measurement` (0113, redefinida na 0123)          |
| Exame próprio da clínica                                                      | `patient_metric_types.tenant_id` (0123) + namespacing `c<tenant8>_<slug>`  |
| Ligar/desligar exame por clínica                                              | `tenant_patient_metric_settings` (0114)                                    |
| Gráfico de evolução                                                           | `MetricEvolutionChart`                                                     |
| Metas por analito                                                             | `patient_metric_goals` (0120)                                              |
| Entrega no portal                                                             | seção `metricas` do portal, já implementada                                |

**Consequências aceitas**: (a) resultado é **append-only** — corrigir um valor digitado errado significa lançar um novo registro, não editar; (b) os exames aparecem junto das demais métricas na seção "Minha evolução" do portal (além da seção `exames` dedicada da US3); (c) metadados de laudo (laboratório emissor, data de coleta vs. liberação, método, PDF anexo) **não têm campo** — só `notes` (≤2000). Fora do escopo v1; se virar requisito, o precedente é `nutrition_assessments` (0175): tabela própria append-only que lança os derivados no motor via `recordMeasurementsBatch`.

**Alternativa rejeitada**: tabela `lab_results` dedicada com campos de laudo — reimplementaria evolução, portal, metas e lote do zero e fragmentaria o histórico de analitos que já está no motor.

## D2 — Discriminador "é exame laboratorial"

**Decisão**: usar `patient_metric_types.specialty = 'laboratorio'`. Sem coluna nova.

**Rationale**: `specialty` já é o agrupador do motor (`endocrino` na 0113, `nutricao` na 0174, `gasto_energetico_total` na 0175) e já é parâmetro de filtro em `listMetricTypes`/`listEnabledMetricTypesForTenant`. A UI já usa esse padrão: `metabolic-metrics-section.tsx:49` filtra `specialty === 'nutricao'` para montar o painel de bioimpedância. A seção de exames faz o simétrico com `'laboratorio'`.

**Ponto de atenção**: os 7 exames da 0113 estão marcados como `specialty='endocrino'`. **Não serão remarcados** — `patient_metric_types` é append-only nas linhas globais (trigger `enforce_append_only` quando `tenant_id IS NULL`), e mudar a especialidade de uma métrica em produção mexeria em séries já existentes. A seção de exames seleciona por uma **lista explícita de analitos** (união de `specialty='laboratorio'` com os 7 legados da 0113), resolvida no catálogo TS. Ver D3.

## D3 — Catálogo de exames: TS ou tabela?

**Decisão**: **catálogo TS** (`src/lib/core/labs/catalog.ts`) declarando quais `metric_type` são exames laboratoriais (`key`, `label`, `unit`, `group`), + as linhas correspondentes semeadas em `patient_metric_types` pela migration. O TS é a fonte da verdade de "o que é exame e em que painel aparece"; o banco é a fonte da verdade de "existe, tem unidade e faixa plausível".

**Rationale**: mesmo padrão de `micronutrients.ts` (049) — catálogo estável, sem I/O, usado no servidor e no cliente, com `driKey`/`rangeKey` ligando à tabela de faixas. Resolve o problema do D2 (incluir os 7 legados `endocrino` sem migrar dados) e dá o agrupamento por painel (ex.: "Perfil lipídico", "Hemograma") que a `specialty` sozinha não expressa.

## D4 — Tabela de faixas de referência

**Decisão**: `public.lab_reference_ranges`, catálogo **global** (`tenant_id` ausente, RLS `SELECT USING (true)`, GRANT só de SELECT), espelhando `dietary_reference_intakes` (0182):

`analyte_key`, `sex` (`M`/`F`/`any`), `age_min_years`, `age_max_years`, `state` (`padrao`/`gestante`/…), `ref_min NUMERIC NULL`, `ref_max NUMERIC NULL`, `unit`, `source_label`. UNIQUE natural `(analyte_key, sex, age_min_years, age_max_years, state)`; índice `(analyte_key, sex, state)`.

**Diferença material frente à DRI**: a DRI tem um `value` (alvo único, e a adequação é um **percentual**). Exame tem **dois limites absolutos** e a classificação é posicional. Por isso `ref_min`/`ref_max` são **NULL-áveis independentes**: existe exame só-com-teto (colesterol LDL, triglicerídeos: "abaixo de X"), só-com-piso (HDL: "acima de X") e com os dois (glicemia, hemoglobina). Um exame com ambos nulos = sem referência.

**Lookup** (`reference-ranges.ts`): cópia do algoritmo de `listDRIsForPatient` — uma query com filtro amplo (`age_min ≤ idade ≤ age_max`, `sex IN (informado,'any')`, `state IN (informado,'padrao')`) e desempate em memória por score (estado informado peso 2 > `padrao`; sexo específico peso 1 > `any`). Sem match na idade → analito sem faixa → `sem_referencia`.

## D5 — Motor de classificação

**Decisão**: `src/lib/core/labs/classify.ts`, puro/isomórfico, sem I/O — análogo direto de `adequacy.ts` (049):

```ts
export type LabClass = 'baixo' | 'normal' | 'alto' | 'sem_referencia'
export interface LabResultItem {
  analyteKey: string
  label: string
  unit: string
  value: number
  measuredAt: string
  refMin: number | null
  refMax: number | null
  class: LabClass
}
export interface LabPanelResult {
  items: LabResultItem[]
  low: number
  high: number
}
export function classifyLabResults(
  results: ReadonlyArray<{ analyteKey: string; value: number; unit: string; measuredAt: string }>,
  ranges: Map<string, LabRange>,
): LabPanelResult
```

Regra: `refMin != null && value < refMin → 'baixo'`; `refMax != null && value > refMax → 'alto'`; senão `'normal'`; ambos nulos ou analito ausente do Map → `'sem_referencia'`. Comparação inclusiva nos limites (valor **igual** ao limite é normal), coerente com como laboratório publica faixa fechada.

**Rationale**: leitura **derivada, não persistida** — mesma postura da adequação (049). Corrigir uma faixa de referência reclassifica todo o histórico sem reescrever nenhum resultado, o que é o comportamento certo e preserva o append-only.

## D6 — Sexo/idade ausentes

**Decisão**: não bloquear. A rota resolve idade da `birth_date` e sexo do cadastro via `rpc('get_patient_for_tenant')`, aceita override por query param, e quando falta qualquer um responde **200** com `{ results, classified: null, need: { age, sex } }` — a UI oferece informar na hora.

**Rationale**: cópia literal do comportamento já em produção em `src/app/api/pacientes/[id]/adequacao/route.ts:88-93`, que atende ao mesmo edge case na 049. Consistência de comportamento entre as duas telas.

## D7 — Banda de referência no gráfico (US2)

**Decisão**: estender `MetricEvolutionChart` (`src/components/patient-portal/evolution-chart.tsx`) com props opcionais `refMin?`/`refMax?` que renderizam um `<ReferenceArea>` do recharts, e ajustar o `domain` do `YAxis` para englobar a faixa.

**Rationale**: `ReferenceArea` já vem no recharts instalado (hoje o arquivo importa só `CartesianGrid/Legend/Line/LineChart/ResponsiveContainer/Tooltip/XAxis/YAxis`) — **sem nova dependência**. Props opcionais mantêm todos os usos atuais intactos.

**Ponto de atenção**: o componente vive em `src/components/patient-portal/` mas já é importado pelo dashboard da equipe (`metabolic-metrics-section.tsx:17`). Mover para `src/components/charts/` seria mais limpo, mas é churn de import sem ganho funcional — **não fazer** nesta feature.

## D8 — Portal (US3)

**Decisão**: ligar a seção `'exames'` que **já existe** em `src/lib/core/patient-portal/sections.ts:104` (hoje `implemented: false`, `defaultEnabled: false`, `sensitivity: 'alta'`, sem `requiredModule`). Mudanças: `implemented: true` e `requiredModule: 'exames_lab'`, o que exige incluir `'exames_lab'` no union `PortalSectionModule` (hoje `'treino' | 'dieta' | 'telemedicina'`).

**Rationale**: a infraestrutura de gate em 3 camadas (módulo do plano → override da clínica → cautela clínica) já está pronta e `resolvePortalSections` já resolve `requiredModule` via `hasModule`. `defaultEnabled: false` permanece: resultado de exame é dado sensível e a clínica precisa optar por expor. A descrição da seção já registra a postura certa ("Resultados com interpretação (nunca o valor cru isolado)") — o card mostra valor + data + **normal/alterado**, sem alarmismo, conforme SC-003.

## D9 — Origem real dos dados (levantamento das planilhas)

O spec (FR-003) aponta as abas `BD EXAMES` (AF) e `BD_Exames` (Evonut) como gabarito. O levantamento **corrige essa premissa**:

| Achado                                                                                                                                                                                                                                                                                           | Consequência                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Não existe aba `BD EXAMES` no AF. As abas reais (ocultas) são `BD EXAMES_1` (catálogo), `BD EXAMES_2` (transacional), `BD EXAMES_3` (pedidos).                                                                                                                                                   | Corrigir a referência do spec.                                                                                                                                    |
| No AF, as colunas `Unidade`, `Ref Min`, `Ref Max`, `Observação` existem no cabeçalho mas estão **100% vazias** (272 linhas). O nutricionista digita a faixa à mão na tela.                                                                                                                       | **O AF não é gabarito de faixas.** Serve só como fonte de sinônimos de nome e da lista canônica de 37 unidades (`Unid_Exames`).                                   |
| `Evonut.xlsm` → `BD_Exames` (nome com underscore, `veryHidden`), header na **linha 3**, dados nas linhas 4–322 = **319 linhas**. Colunas: `Cod Exame`, `Desc Exame`, `Grupo Exame`, `Unidade`, `Ref Min H`, `Ref Max H`, `Ref Min M`, `Ref Max M`.                                               | **Fonte de verdade única das faixas.**                                                                                                                            |
| Das 319 linhas: **119 têm unidade**, **115 têm alguma faixa**; **204 (64%) não têm faixa nem unidade** — são exames qualitativos (Sorologia, Parasitológico, Exame de Urina descritivo) mais 22 pseudo-exames "(Completo)" do grupo `Exames Completos`, que são atalhos de painel, não analitos. | Ver D10 (escopo).                                                                                                                                                 |
| O recorte é **apenas por sexo**, materializado em 4 colunas (H/M × min/max). **Não há faixa etária, não há estado (gestante)** em nenhuma das duas planilhas.                                                                                                                                    | Ver D11.                                                                                                                                                          |
| Faixas abertas de um lado são comuns: **24 linhas só com máximo** (ex.: Ácido úrico ≤ 4,9), **15 só com mínimo** (ex.: Apo A-I ≥ 130).                                                                                                                                                           | Confirma `ref_min`/`ref_max` **nullable independentes** (D4). Nunca usar 0 como sentinela.                                                                        |
| **22 linhas divergem entre H e M** (Hemoglobina, Hematócrito, Hemácias, Ferritina, HDL, Cobre, GGT, TGO, TGP, Testosterona, Estradiol, Progesterona, SHBG, Ácido úrico…). Nas outras 93 com faixa, H e M são idênticos.                                                                          | Justifica o eixo `sex` como recorte real, não decorativo.                                                                                                         |
| Nomes repetem entre grupos com faixa idêntica (`Ácido úrico` em 3 grupos, `Potássio` em 4, `HDL` em 2). A chave da planilha é `(nome, grupo)`.                                                                                                                                                   | O importador **deduplica por nome normalizado**; o grupo vira metadado de painel, não parte da identidade do analito.                                             |
| Unidades estão **sujas**: espaços (`" U/L"`, `"mg/dL "`, `" g/dL"`) e duplicatas por grafia (`mcg/dL` vs `µg/dL`, `mcg/mL` vs `mcg/Ml`, `mUI/L` vs `mcUI/mL`). 33 strings distintas nos dados.                                                                                                   | Importador aplica `TRIM` + tabela de normalização contra as 37 unidades canônicas do AF.                                                                          |
| O enum de resultado das planilhas é **Baixo / Normal / Elevado**.                                                                                                                                                                                                                                | Confirma a classificação de 3 estados do motor (D5).                                                                                                              |
| A planilha resolve a faixa pelo sexo no momento do pedido e **snapshota** `Ref (Min)`/`Ref (Max)` na linha do resultado (`BD_PedidoExames`).                                                                                                                                                     | Padrão diferente do nosso: **não snapshotamos** — a classificação é derivada (D5), o que reclassifica o histórico quando a faixa é corrigida. Escolha consciente. |

## D10 — Escopo do catálogo: só exames quantitativos

**Decisão**: semear **apenas os exames quantitativos com unidade e ao menos um limite** (~115 linhas da planilha, ~100 analitos distintos após dedupe). Ficam **fora do v1**:

- **Exames qualitativos** (~180 linhas: cor da urina, parasitológico, sorologias reagente/não-reagente). O motor de medições exige `value NUMERIC` — não há valor numérico a registrar nem faixa a comparar. Não é limitação do desenho, é incompatibilidade de natureza do dado.
- **Os 22 pseudo-exames "(Completo)"** do grupo `Exames Completos` — são templates de pedido (expandem para um grupo inteiro), não analitos. Cabem na feature de _pedido_ de exames (`exam_requests`, 0149), que está explicitamente fora do escopo v1 do spec.

**Rationale**: cobertura total sobre o que a feature sabe fazer (classificar número contra faixa), em vez de cobertura nominal com dois terços do catálogo inerte. Satisfaz FR-001 com folga — os 19 exames "comuns" listados no spec estão todos entre os quantitativos.

**Chaves (`metric_type`)**: o formato do catálogo é `^[a-z][a-z0-9_]{1,63}$`. Analitos novos usam prefixo `lab_` (`lab_ferritina`, `lab_tsh`). **Os 7 exames já semeados na 0113 reusam as chaves existentes** (`glicemia_jejum`, `hba1c`, `colesterol_total`, `ldl`, `hdl`, `triglicerides`) — o importador **não** pode criar duplicata deles; o catálogo TS os declara com a chave legada. Ver D2.

## D11 — Eixo de idade sem dado de origem

**Decisão**: manter as colunas `age_min_years`/`age_max_years`/`state` na tabela (como exige FR-002) e **semear tudo como `0–130` / `padrao`**, já que a fonte só recorta por sexo.

**Rationale**: o lookup por idade fica implementado, testado e pronto; quando entrar uma fonte pediátrica ou obstétrica, é só inserir linhas mais específicas — o desempate por score (D4) já prefere a faixa mais específica sem mudar uma linha de código. O alternativo (omitir as colunas agora) exigiria migration + reescrita do lookup depois, por nenhum ganho hoje.

**Honestidade do escopo**: na prática, o v1 classifica por **sexo**, não por idade. Isso atende SC-002 ("faixa da sua faixa etária/sexo") apenas na dimensão sexo. Registrado como limitação conhecida a validar com o profissional.

## D12 — Forma do seed

**Decisão**: seed em **duas partes**, seguindo os dois precedentes da casa conforme a natureza do dado:

1. **Catálogo de exames** (poucas dezenas de linhas, estáveis) → `INSERT ... ON CONFLICT DO NOTHING` **dentro da migration** + bloco `DO $$` replicando em `catalog_baseline.patient_metric_types` (padrão 0174/0175). Necessário porque `patient_metric_types` **é** truncada e restaurada do baseline no reset dos testes (gotcha 0170).
2. **Faixas de referência** (volume maior, extraídas de planilha) → script `scripts/build-lab-ranges-seed.ts` no molde de `scripts/build-dris-seed.ts`: `tsx` com `ExcelJS.stream.xlsx.WorkbookReader` (streaming — os `.xlsm` de ~7 MB estouram heap no `readFile`), `createClient` com service_role, `delete + insert` em chunks, idempotente, `DRY=1` para conferir a contagem antes de gravar. `lab_reference_ranges` fica **fora** do `catalog_baseline` (mesma escolha explícita da 0182): o seed é re-executável e os testes inserem as próprias faixas, self-contained.

**Gabarito**: `nutri-doc/Evonut.xlsm` → aba `BD_Exames` (ver D9). Gotchas do importador: os `.xlsm` têm ~7 MB e estouram heap no `readFile` → `ExcelJS.stream.xlsx.WorkbookReader`; header na **linha 3** (dados a partir da 4); `tsx` roda em CJS (sem top-level await → `main().catch()`).

## Faseamento (pré-requisitos)

1. **US1 — Registro + flag** (P1): migration (tabela de faixas + seed do catálogo) → catálogo TS → lookup → motor de classificação → rota → seção no prontuário. Pré-requisito das demais.
2. **US2 — Evolução** (P2): estender `MetricEvolutionChart` com a banda de referência e plugar na seção.
3. **US3 — Portal** (P3): ligar a seção `exames`, estender o bundle e renderizar o card.

## Riscos / validação

- **Fidelidade clínica das faixas**: as faixas vêm de **uma** planilha (Evonut), sem fonte citada, e laboratórios publicam faixas próprias por método. É gabarito de partida, não verdade auditada. **Validar amostra com o profissional** antes de tratar como definitivo (polish, análogo ao T047 da 047). O `source_label` de cada linha torna a origem rastreável na tela.
- **Classificação só por sexo no v1** (D11): a fonte não tem recorte etário. Um valor normal para criança pode ser sinalizado como alterado contra a faixa adulta. O aviso na tela deve deixar a referência explícita (faixa exibida ao lado do valor, como exige FR-001/cenário 1) para o profissional julgar.
- **Unidades sujas na origem**: 33 grafias distintas com espaços e duplicatas (`µg/dL` vs `mcg/dL`). O importador normaliza contra as 37 unidades canônicas do AF e deve **falhar ruidosamente** em unidade desconhecida, não gravar variante nova silenciosamente. Sem conversão (mg/dL ↔ mmol/L) no v1 — a faixa e o valor assumem a unidade do catálogo.
- **Faixa plausível vs faixa de referência**: `min_plausible`/`max_plausible` do catálogo são **anti-typo** e precisam ser bem mais largas que a faixa de referência, senão um resultado legitimamente muito alterado é **rejeitado no INSERT** (`MEASUREMENT_OUT_OF_RANGE`, 422). Dimensionar com folga generosa no seed — é a armadilha mais provável desta feature.
- **Append-only**: usuário que digitar errado não consegue editar. A UI precisa deixar claro que a correção é um novo lançamento (mesmo texto já usado na seção de métricas metabólicas).
