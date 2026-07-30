# Research — Rótulo Nutricional de Produto (052)

Decisões técnicas antes do design. As decisões de produto já fechadas com o usuário estão marcadas **[decidido]**.

## D1 — A norma: números conferidos contra fonte, não contra a planilha

**Decisão**: os valores diários de referência (VDR), os limites da rotulagem frontal e as regras de arredondamento vêm da **IN 75/2020** e da **RDC 429/2020**, transcritos abaixo e conferidos em duas fontes independentes na fase de pesquisa.

### VDR — IN 75/2020, Anexo II

| Nutriente | VDR |
|---|---|
| Valor energético | 2.000 kcal |
| Carboidratos | 300 g |
| Açúcares totais | **sem VDR** — declara sem %VD |
| Açúcares adicionados | 50 g |
| Proteínas | 50 g |
| Gorduras totais | 65 g |
| Gorduras saturadas | 20 g |
| Gorduras trans | 2 g |
| Fibra alimentar | 25 g |
| Sódio | 2.000 mg |

### Limites da rotulagem frontal — RDC 429/2020

| Nutriente | Sólidos (por 100 g) | Líquidos (por 100 mL) |
|---|---|---|
| Açúcares adicionados | ≥ 15 g | ≥ 7,5 g |
| Gorduras saturadas | ≥ 6 g | ≥ 3 g |
| Sódio | ≥ 600 mg | ≥ 300 mg |

### Arredondamento — IN 75/2020, Anexo III

- **≥ 10**: arredonda pela 1ª decimal, expressa em inteiro.
- **1 a < 10**: arredonda pela 2ª decimal; se a 1ª decimal for 0, expressa inteiro, senão 1 decimal.
- **< 1 em gramas**: arredonda pela 2ª decimal, expressa com 1 decimal.
- **< 1 em mg/µg**: arredonda pela 3ª decimal; se a 2ª for 0, 1 decimal, senão 2 decimais.

### Quantidades não significativas — IN 75/2020, Anexo IV

Declara-se **0** quando: energia ≤ 4 kcal · carboidratos ≤ 0,5 g · açúcares totais ≤ 0,5 g · proteínas ≤ 0,5 g · gorduras totais ≤ 0,5 g · gorduras saturadas ≤ 0,1 g · gorduras trans ≤ 0,1 g · fibras ≤ 0,5 g · sódio ≤ 5 mg.

**Este zero é declaratório e NÃO é o mesmo que dado desconhecido** (D5). São dois estados diferentes que a tela precisa distinguir.

### O que a planilha de origem tem de errado

A aba "Rótulos Nutricionais" do `AF..xlsm` usa referências que **não são as da IN 75/2020** — várias coincidem com a revogada RDC 360/2003:

| Nutriente | Planilha | IN 75/2020 | RDC 360/2003 (revogada) |
|---|---|---|---|
| Energia | 1956,25 | 2.000 | 2.000 |
| Proteínas | 75,37 | **50** | 75 |
| Gorduras totais | 52,22 | **65** | 55 |
| Gorduras saturadas | 23,33 | **20** | 22 |
| Sódio | 2633,33 | **2.000** | 2.400 |
| Açúcares adicionados | **300** | **50** | não existia |
| Carboidratos | 300 | 300 | 300 |
| Fibra | 25 | 25 | 25 |

O caso grave é o açúcar adicionado: referência de 300 g em vez de 50 g faz um produto doce declarar **1/6** do %VD real. A planilha também **não tem** rotulagem frontal, que é obrigatória desde a RDC 429/2020.

**Pendência de implementação**: mesmo com duas fontes concordando, os números MUST ser conferidos contra o texto oficial publicado pela ANVISA antes do merge — é dado que vai para embalagem comercial. Mesmo tratamento dado às equações de gasto energético na feature 048. Ponto de atenção específico: o VDR de gorduras trans (2 g) merece conferência, porque a norma anterior não estabelecia valor diário para trans.

## D2 — Onde os números vivem: catálogo TS, não tabela

**Decisão**: `src/lib/core/nutrition/labeling/reference.ts` — constantes TS com os VDR, os limites da lupa, as regras de arredondamento e as quantidades não significativas, mais uma constante `NORMATIVE_VERSION = 'IN 75/2020 + RDC 429/2020'`.

**Rationale**: são ~25 números fixados em norma federal, iguais para todas as clínicas, que **nenhuma clínica pode editar**. Não é dado de aplicação — é regra. Em TS eles ficam versionados no git, revisáveis em code review e cobertos por teste unitário, que é exatamente o que se quer de um número que vai para embalagem. Mesmo padrão de `micronutrients.ts` (049) e `labs/catalog.ts` (050).

**Alternativa rejeitada**: tabela global no banco (padrão `dietary_reference_intakes`/`lab_reference_ranges`). Faz sentido quando o dado é volumoso (397 DRIs, 99 faixas) ou semeado de planilha. Aqui seriam 25 linhas imutáveis, e o banco perderia a revisão por PR sem ganhar nada.

**FR-021 (rastreabilidade)**: o rótulo salvo grava a string de `NORMATIVE_VERSION` usada. Quando a norma mudar, um rótulo antigo continua explicável, e a tela pode avisar que foi calculado sob norma anterior.

## D3 — Motor de cálculo: soma com rastreio de completude

**Decisão**: `labeling/compose.ts` — puro, sem I/O. Recebe os ingredientes (alimento + gramas), o rendimento total e a porção; devolve, por nutriente, o valor por 100 g/mL, por porção, o %VD e um **estado de completude** (`completo` | `incompleto` | `sobrescrito`), mais a lista de ingredientes que faltaram naquele nutriente.

**Rationale**: o motor de soma da 047/049 (`diet/totals.ts`) já escala por regra de três e já trata micro ausente como chave ausente (não zero). O que ele **não** faz é dizer *quais* itens faltaram — e isso é requisito central aqui (FR-011). Envolver o motor existente em vez de reescrevê-lo mantém a garantia de que plano e rótulo somam igual.

**Os quatro nutrientes de rótulo já existem na base** como micronutrientes importados na 049: `ag_saturados_g`, `ag_trans_g`, `acucar_total_g`, `acucar_adicao_g`. **Sem migration de schema para nutriente.**

## D4 — Os três estados de um valor (o coração da feature)

**Decisão**: cada nutriente do rótulo está em exatamente um destes estados, e a tela nunca os confunde:

| Estado | Significa | Como aparece |
|---|---|---|
| **Calculado** | todos os ingredientes tinham o dado | valor normal |
| **Incompleto** | ao menos um ingrediente não tinha o dado | marcado, com a lista de quais faltam; **nunca** exibido como 0 |
| **Sobrescrito** | a nutricionista informou o valor | valor com marca de origem manual, desfazível |
| **Zero declarado** | calculado e abaixo do limite do Anexo IV | exibido como `0`, que é a declaração correta |

**Rationale**: é a diferença entre "não sei" e "é zero". Num rótulo comercial, imprimir 0 para um dado desconhecido é declaração falsa. Com 7% de cobertura de açúcares adicionados na base, o estado *incompleto* é o caso comum, não a exceção.

## D5 — Lupa inconclusiva

**Decisão**: a avaliação da rotulagem frontal devolve, por nutriente, `aplica` | `não aplica` | `inconclusivo`. É `inconclusivo` quando o nutriente relevante está incompleto.

**Rationale**: concluir "não precisa de lupa" a partir de dado faltante é o erro mais caro que esta feature pode cometer — leva um produto irregular à prateleira. Melhor dizer que não dá para concluir.

## D6 — Rendimento informado, nunca deduzido [decidido]

**Decisão**: o rendimento total é campo obrigatório de entrada. O sistema **não** o infere da soma dos ingredientes.

**Rationale**: a perda por cocção é real e grande — 1.400 g de massa crua viram ~1.200 g de bolo. Deduzir da soma erraria todos os valores por porção em ~15%, na direção de subdeclarar. A planilha de origem já faz assim.

## D7 — O rótulo não pertence a paciente

**Decisão**: tabelas próprias (`nutrition_labels` + `nutrition_label_ingredients`), com `tenant_id`, **sem** `patient_id`. Tela própria em Operação (`/operacao/rotulo-nutricional`), item de menu gated `nutri_rotulo`. Cliente e produto são campos de texto no rótulo — **sem** entidade "cliente" nova.

**Rationale**: um rótulo descreve um produto vendido por um cliente da clínica, não a alimentação de um paciente. Pendurá-lo no prontuário seria modelar errado. Reusar `diet_plans` seria pior: plano tem refeições, prescrição, meta do paciente e entrega no portal — nada disso se aplica. Criar entidade "cliente da clínica" é escopo que ninguém pediu; dois campos de texto resolvem o v1 e não impedem a evolução.

**Consequência**: item novo na sidebar → o teste `dashboard-shell-sections` que crava a contagem de Operação vai precisar de atualização (hoje são 8 itens).

## D8 — Exportação

**Decisão**: PDF via `@react-pdf/renderer`, já em uso no projeto (receituário, relatórios). Sem nova dependência.

**Rationale**: o cliente leva o documento para a gráfica ou para o designer. PDF é o formato que sobrevive a esse caminho. Rótulo incompleto MUST sair com marca d'água ou tarja inequívoca de "não utilizável" (FR-018).

## Faseamento

1. **US1 + US2 juntas** — referência TS + motor + tela com os três estados. As duas são P1 e a US1 sozinha não entrega rótulo utilizável (7% de cobertura de açúcares adicionados).
2. **US3** — lupa, sobre a composição já calculada.
3. **US4** — salvar e exportar.

## Riscos

- **Responsabilidade técnica**: o resultado vai para embalagem comercial. A tela MUST deixar explícito que a responsabilidade é da nutricionista, e o PDF incompleto MUST ser inequívoco. O sistema calcula; não emite parecer.
- **Norma muda.** Por isso `NORMATIVE_VERSION` fica gravada no rótulo (FR-021) e os números vivem num arquivo só, fácil de auditar.
- **Cobertura da base**: saturadas 86%, sódio 91%, mas trans 18%, açúcares totais 18%, açúcares adicionados 7% dos 6.575 alimentos AF. A entrada manual não é conveniência — é o caminho principal.
- **Arredondamento só na apresentação**: arredondar antes de somar ou antes de gravar propaga erro. Valor bruto no banco, arredondamento na exibição e no PDF.

## Fontes

- [IN nº 75/2020 — texto e anexos](https://in75.tabelanutricional.com.br/)
- [Rotulagem nutricional obrigatória — guia ANVISA](https://rotuloconforme.com.br/informacao-nutricional-obrigatoria)
- [RDC nº 429/2020 — AnvisaLegis](https://anvisalegis.datalegis.net/action/ActionDatalegis.php?acao=abrirTextoAto&tipo=RDC&numeroAto=00000429&seqAto=000&valorAno=2020&orgao=RDC%2FDC%2FANVISA%2FMS&codTipo=&desItem=&desItemFim=&cod_menu=1696&cod_modulo=134&pesquisa=true)
- [Rotulagem nutricional — ANVISA](https://www.gov.br/anvisa/pt-br/assuntos/alimentos/rotulagem/rotulagem-nutricional)
