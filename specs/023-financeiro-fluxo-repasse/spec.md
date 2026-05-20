# Feature Specification: Financeiro robusto — Fluxo de Caixa, Contas a Pagar/Receber e Repasse Médico

**Feature Branch**: `023-financeiro-fluxo-repasse`
**Created**: 2026-05-20
**Status**: Draft
**Input**: User description: "Construir o dia-a-dia operacional financeiro do Prontool sobre a infra de relatórios já existente (DRE mensal, relatório consolidado por período, comissões versionadas, despesas com categorias, pagamentos com parcelas). Foco em 4 workflows operacionais que faltam e que diferenciam o Feegow: fluxo de caixa temporal, contas a pagar consolidadas, contas a receber consolidadas, e repasse médico mensal em lote. Sem reescrever DRE, sem integração bancária, sem TISS, sem multi-filial. Append-only e auditado por constituição."

## Clarifications

### Session 2026-05-20

- Q: Como tratar reajuste de valor em despesa recorrente sem violar Princípio I (imutabilidade)? → A: **Versionar** — ao editar o valor, o sistema marca a despesa-mãe atual com `recurring_ends_at = data_corte` e cria nova despesa com `recurring_starts_at = data_corte + 1` e o novo `amount_cents`. Histórico íntegro; projeções respeitam a versão vigente em cada data; nenhum UPDATE em `amount_cents` existente.
- Q: Pagamento parcial de uma parcela — múltiplos parciais permitidos? → A: **Sim, via nova tabela `installment_payments` append-only**: cada parcial é uma linha com `installment_id`, `paid_at`, `amount_cents`, `method`, `actor_id`, `note?`. O `paid_amount_cents` da parcela é computado por `SUM(...)` (view ou recalculado por trigger). Sem UPDATE em coluna financeira; histórico forense completo de cada movimentação; paciente pode parcelar sem limite. Compatível com Princípios I + II.
- Q: Médico (profissional_saude) vendo seu próprio repasse — o que ele enxerga em cada atendimento? → A: **Transparência total: valor bruto + percentual de comissão + valor líquido**. Cada linha de atendimento mostra valor cobrado do paciente/convênio, taxa aplicada (de `commissions/resolve-commission`), comissão líquida resultante. Padrão dos concorrentes (Feegow, Doctoralia); reduz disputa por permitir conferência forense; sigilo de operadora não é violado porque o médico já tinha acesso ao valor pelo histórico de atendimentos.
- Q: Admin fechou repasse errado — pode reabrir? → A: **Reabertura restrita**: permitida apenas (a) nas primeiras 24h após `closed_at`, (b) se NENHUM dos repasses do mês já foi marcado como pago (`paid_at IS NULL` em todas as linhas de `monthly_payouts` daquele mês). Exige justificativa textual ≥20 caracteres e gera entrada append-only em nova tabela `monthly_payouts_reopens` para forensia. Após reabertura, o mês volta ao estado "aberto" e os cálculos passam a refletir dados ao vivo novamente. Refechamento sobrescreve a snapshot anterior **mas** preserva-a via `monthly_payouts_reopens` (mantém os valores originais para auditoria).
- Q: Saldo inicial do caixa do tenant — editável quando, com qual modelo? → A: **Histórico de ajustes append-only** via nova tabela `tenant_cash_balance_adjustments`. Cada vez que o admin edita o saldo (aporte, retirada, ajuste contábil), o sistema cria uma nova linha com `effective_from`, `amount_cents` (delta ou valor absoluto — decisão de plan), `reason`, `actor_user_id`. O gráfico de fluxo de caixa em qualquer data usa a soma dos ajustes vigentes naquele momento como baseline. Princípio I-compliant; auditoria perfeita; histórico de gráfico não muda retroativamente quando admin acrescenta um ajuste com `effective_from = hoje`.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Recepção/Financeiro vê o que receber esta semana (Priority: P1)

A recepcionista ou o financeiro abrem o Prontool pela manhã e precisam saber: "Quem deve pagar nesta semana? Quem está atrasado?". Hoje, essa informação está espalhada — cada paciente tem suas parcelas registradas, mas não há tela única que agrega. O usuário vai em `/analise/contas-a-receber`, vê a lista consolidada com paciente, plano, valor, vencimento e dias de atraso. Pode filtrar por período, status (a vencer / hoje / atrasada / inadimplência) e plano. Pode clicar em uma parcela para registrar pagamento direto, sem sair da tela.

**Why this priority**: É a tarefa diária mais frequente do financeiro de uma clínica. Sem isso, a pessoa lista paciente por paciente — perde meia manhã. ROI imediato em todas as clínicas com convênio + particular.

**Independent Test**: Em um tenant com 30+ parcelas em estados variados, abrir `/analise/contas-a-receber`. Verificar: (1) lista mostra todas as parcelas pendentes/atrasadas ordenadas por vencimento; (2) filtro "Hoje" mostra só vencidas hoje; (3) clicar em "Registrar pagamento" abre modal que persiste e remove da lista; (4) badge "Atraso crítico" aparece em parcelas com >60 dias.

**Acceptance Scenarios**:

1. **Given** 10 parcelas com vencimento entre hoje e +7 dias, **When** o usuário abre a página, **Then** todas aparecem com paciente, valor e dias até vencer.
2. **Given** filtro "Atrasadas" ativo, **When** a página carrega, **Then** só parcelas com `due_date < hoje` e status pendente aparecem; ordenadas por dias de atraso desc.
3. **Given** uma parcela atrasada >60 dias, **When** listada, **Then** badge vermelho "Atraso crítico" aparece + botão "Marcar como inadimplência".
4. **Given** usuário clica em "Registrar pagamento" numa parcela, **When** o modal salva o pagamento, **Then** a parcela some da lista de pendentes em ≤2s sem reload de página, e aparece em "Recebidas hoje".
5. **Given** paciente anonimizado por LGPD com parcela pendente, **When** a lista renderiza, **Then** mostra "[anonimizado]" no campo paciente mas o valor pendente continua visível.
6. **Given** recepcionista logado, **When** acessa a página, **Then** vê apenas dados do tenant atual; financeiro tem ações de "Marcar inadimplência" extras; admin tem ação "Reverter pagamento" com motivo.

---

### User Story 2 - Admin/Financeiro vê o que pagar este mês (Priority: P1)

O administrador da clínica precisa, no início de cada mês, planejar quais despesas vão sair: aluguel, salários, fornecedores, impostos. Hoje, despesas existem (`expenses`) mas sem visão "a vencer". O usuário vai em `/analise/contas-a-pagar`, vê todas as despesas com `competence_date` no mês atual ou futuras, agrupadas por mês, com totais. Filtra por categoria (aluguel/materiais/pessoal/etc.), por fornecedor (campo `supplier` existente), e por status (a vencer / vencidas / pagas no mês). Despesas recorrentes (já têm flag `recurring=true`) aparecem como linhas projetadas até 90 dias à frente. Pode marcar despesa como paga inserindo data de pagamento.

**Why this priority**: Mesma frequência diária/semanal. Sem isso, o admin gerencia despesas no Excel. Concorrentes (Feegow forte aqui) ganham por ter isso pronto.

**Independent Test**: Em tenant com 8 despesas categorizadas + 2 despesas `recurring=true` (aluguel + internet), abrir `/analise/contas-a-pagar`. Verificar: (1) 8 + N projeções recorrentes (uma para cada mês futuro até 90 dias); (2) total mensal calculado; (3) filtro "Vencidas" mostra só `competence_date < hoje` e `paid_at IS NULL`; (4) marcar uma despesa como paga atualiza a UI imediatamente.

**Acceptance Scenarios**:

1. **Given** 5 despesas pendentes neste mês, **When** o usuário abre a página, **Then** todas aparecem agrupadas por mês com total no header.
2. **Given** despesa `recurring=true frequency='mensal'` cadastrada em 2026-01, **When** o usuário olha `/analise/contas-a-pagar` em 2026-05, **Then** aparecem 4 projeções (jun/jul/ago/set) com valor original + label "Projeção (recorrente)".
3. **Given** usuário marca despesa como paga inserindo data e valor, **When** salva, **Then** `paid_at` e `paid_amount_cents` são persistidos sem alterar `amount_cents` original (Princípio I); audit log registra a ação.
4. **Given** despesa recorrente foi marcada como cancelada/encerrada (campo a definir ou data fim), **When** o período futuro é exibido, **Then** projeções não aparecem.
5. **Given** financeiro tenta "Reverter pagamento", **When** ação dispara, **Then** sistema exige justificativa textual e marca como reversão (não delete).
6. **Given** profissional_saude tenta acessar a página, **When** request é feito, **Then** redirect para 403 (apenas admin + financeiro têm acesso).

---

### User Story 3 - Admin vê fluxo de caixa do próximo trimestre (Priority: P2)

O dono da clínica quer responder: "Tenho caixa para investir em equipamento novo nos próximos 60 dias?". Vai em `/analise/fluxo-caixa`, vê linha do tempo de entradas (parcelas a vencer somadas com recebidas no passado) e saídas (despesas previstas + pagas), com saldo acumulado dia a dia. Pode visualizar em 3 escalas: diária (próximos 30 dias), semanal (próximas 12 semanas), mensal (próximos 6 meses). Gráfico mostra a curva projetada com pontos onde o saldo cruza zero (alerta visual).

**Why this priority**: Decisão estratégica, não diária. Mais valioso conforme a clínica cresce. Mas depende dos dados de US1 + US2 já estarem agregados.

**Independent Test**: Tenant com 20 parcelas a vencer nos próximos 60 dias + 10 despesas previstas + 2 recorrentes. Abrir `/analise/fluxo-caixa`. Verificar: (1) gráfico mostra linha de saldo acumulado nos próximos 60 dias; (2) trocar escala diário→semanal→mensal funciona sem refetch (agrega no client); (3) ponto onde saldo cai abaixo de zero é destacado em vermelho; (4) tabela abaixo do gráfico mostra detalhamento dos eventos por dia.

**Acceptance Scenarios**:

1. **Given** saldo inicial hoje = R$ 5.000, parcelas a receber +R$ 8.000 e despesas a pagar -R$ 6.500 nos próximos 30 dias, **When** o gráfico renderiza, **Then** saldo final mostra R$ 6.500 com curva fluindo dia a dia.
2. **Given** projeção entra em negativo no dia 18, **When** o gráfico renderiza, **Then** o ponto é marcado em vermelho com tooltip "Saldo negativo a partir de 18/05".
3. **Given** usuário troca escala "Diária" para "Mensal", **When** clica, **Then** gráfico re-renderiza agrupando por mês sem nova query ao servidor.
4. **Given** tenant sem nenhuma entrada nem saída futura, **When** abre a página, **Then** mostra mensagem "Sem movimentação prevista" + sugestão de ações.
5. **Given** projeção tem >500 eventos em 90 dias, **When** página carrega, **Then** agrega em buckets semanais automaticamente para manter performance ≥30fps de scroll.
6. **Given** apenas admin/financeiro acessam, **When** profissional_saude tenta, **Then** 403.

---

### User Story 4 - Admin fecha o repasse médico do mês (Priority: P2)

No início do mês, o admin precisa pagar cada médico pelo que ele faturou no mês anterior. Vai em `/analise/repasse-medico/2026-04` (mês passado), vê lista de cada médico ativo com: faturamento bruto gerado pelos atendimentos do mês, comissão devida (já calculada por atendimento via `appointments_effective.net_commission_cents`), pagamentos fixos do médico no mês (já em `monthly_fixed_pay_lines`), pagamentos liberais (médicos que recebem por atendimento via assistant), total a pagar consolidado, status do repasse. Admin clica "Fechar mês" para congelar os valores numa snapshot `monthly_payouts` (append-only). Depois marca cada repasse individual como "pago" inserindo nota de pagamento (valor, data, método). Médico (profissional_saude) pode ver seu próprio repasse — não os dos outros.

**Why this priority**: Workflow crítico mas mensal (não diário). Pode esperar após US1+US2 estarem em produção e validarem demanda. Mas é o mais valorizado pelo lado-administrativo da clínica.

**Independent Test**: Tenant com 3 médicos ativos (1 comissionado, 1 fixo, 1 liberal) + 50 atendimentos no mês de teste. Abrir `/analise/repasse-medico/2026-04`. Verificar: (1) cada médico aparece com seus 3 componentes (comissão/fixo/liberal) calculados; (2) totais por médico batem com o que `computeOperatingResult` daquele mês mostra; (3) clicar "Fechar mês" persiste snapshot em `monthly_payouts` e bloqueia novas edições daquele mês; (4) marcar um médico como pago insere `paid_at` na snapshot; (5) profissional_saude logado vê apenas o próprio repasse.

**Acceptance Scenarios**:

1. **Given** mês ainda não fechado, **When** o admin abre, **Then** vê valores calculados em tempo real (podem mudar se atendimentos forem estornados).
2. **Given** admin clica "Fechar mês", **When** confirma dupla validação, **Then** snapshot é gravada em `monthly_payouts` (uma linha por médico) e o mês entra em estado "fechado".
3. **Given** mês fechado, **When** algum atendimento daquele mês é estornado depois, **Then** o repasse original não muda; o estorno aparece como ajuste no próximo repasse com label "Ajuste do mês anterior".
4. **Given** admin marca um médico como pago, **When** insere data + método + valor + nota opcional, **Then** snapshot atualiza só os campos de pagamento (não o valor calculado); audit log registra.
5. **Given** médico (profissional_saude) com `user_id` vinculado a `doctors`, **When** acessa a página, **Then** vê apenas a linha do próprio repasse, sem totais consolidados de outros.
6. **Given** mês sem nenhum atendimento, **When** abre a página, **Then** mostra "Sem repasses neste mês" sem erro.
7. **Given** mês fechado, **When** admin tenta editar valor (não data de pagamento), **Then** sistema bloqueia: "Valores de meses fechados são imutáveis. Para corrigir, gere um ajuste no próximo mês."

---

### User Story 5 - Dashboard executivo financeiro (Priority: P3)

O dono quer um "raio-x" rápido ao abrir a tela financeira. Em `/analise/dashboard` (ou no topo de `/analise/relatorios`), vê KPIs visuais: ticket médio do mês, margem operacional %, receita do dia/semana/mês com comparativo (% vs período anterior), tempo até break-even (saldo projetado x ponto de equilíbrio), 3 alertas (parcelas atrasadas, despesas vencidas, saldo projetado negativo). Reusa dados de `computeOperatingResult` + dos workflows acima.

**Why this priority**: Polimento que eleva percepção do produto mas não desbloqueia uso. Pode vir depois de US1-US4.

**Independent Test**: Abrir `/analise/dashboard`. Verificar: (1) 5-6 cards de KPIs renderizam com valores reais; (2) percentual de comparativo aparece em verde (cresceu) ou vermelho (caiu); (3) clique em cada card navega para a página detalhada correspondente; (4) alertas só aparecem quando há condição real (não mostra "0 atrasadas" forçadamente).

**Acceptance Scenarios**:

1. **Given** mês atual com R$ 50k faturado e mês anterior R$ 42k, **When** dashboard carrega, **Then** card "Faturamento do mês" mostra R$ 50k em verde com badge "+19% vs. anterior".
2. **Given** 3 parcelas atrasadas, **When** dashboard carrega, **Then** alerta "3 parcelas atrasadas" aparece com link para contas-a-receber filtrada.
3. **Given** tenant novo sem dados históricos, **When** dashboard carrega, **Then** mostra "Sem histórico para comparar — comece registrando atendimentos".

---

### Edge Cases

- **Despesa marcada como paga acidentalmente**: a reversão exige role `admin` e justificativa textual (mínimo 10 caracteres). Audit log registra com `reason`. Sem delete físico — entrada é marcada como `reversed_at` + `reversed_reason`.
- **Repasse fechado de um mês e depois atendimento daquele mês é estornado**: o snapshot original do mês não é alterado (Princípio I). O estorno gera linha automática `monthly_payouts_adjustments` que aparece como crédito/débito no próximo repasse com referência ao atendimento original.
- **Médico com `payment_terms` alterando no meio do mês**: cálculo usa o termo vigente no momento de cada atendimento — já é como funciona via `commissions/resolve-commission`. Spec só herda esse comportamento.
- **Despesa recorrente com período encerrado**: usuário seta `recurring_ends_at` na despesa-mãe sem criar versão nova (`superseded_by` permanece NULL). Projeções a partir dessa data param de aparecer.
- **Admin fechou repasse errado**: pode reabrir nas primeiras 24h **se** nenhum repasse já foi marcado como pago (FR-032a). Justificativa obrigatória ≥20 caracteres; audit completo via `monthly_payouts_reopens`. Após 24h ou se houver pagamento já registrado, correção só por ajuste no próximo mês (FR-034).
- **Despesa recorrente com reajuste de valor**: tratado por versionamento (FR-014a) — antiga é encerrada em `recurring_ends_at`, nova é criada com `recurring_starts_at` = corte. Audit log registra a linhagem. UI mostra "Reajuste aplicado em DD/MM" no card da despesa nova com link para a versão anterior.
- **Parcela atrasada >60 dias**: badge "Atraso crítico" + ação "Marcar como inadimplência" (insere `status='inadimplencia'`, não delete; sai do fluxo "a receber" mas continua visível na ficha do paciente).
- **Projeção de fluxo de caixa em 90 dias com >500 linhas**: agregação automática para semanal quando o range exceder 60 dias E quantidade exceder 200 eventos.
- **Tenant sem nenhuma parcela ou despesa**: cada página mostra estado vazio com call-to-action específico (link para registrar primeira despesa, primeira parcela, etc.).
- **Conciliação de pagamento parcial**: parcela do paciente acumula entradas em `installment_payments` (FR-005); enquanto `SUM(installment_payments.amount_cents) < amount_cents`, badge "Parcial — falta R$ X" + número de pagamentos parciais já registrados. Modal de pagamento mostra histórico dos parciais anteriores.
- **Múltiplas moedas**: não suportado. Tudo em centavos BRL.
- **Fuso horário**: respeitar `tenant-tz` — "hoje" depende do tenant; relatório mensal usa boundaries no fuso do tenant (já é como `computeOperatingResult` faz).

## Requirements *(mandatory)*

### Functional Requirements

#### Contas a Receber (US1)

- **FR-001**: O sistema MUST oferecer página `/analise/contas-a-receber` acessível a `admin`, `financeiro` e `recepcionista`.
- **FR-002**: A página MUST listar todas as `payment_installments` do tenant com `status IN ('pendente', 'atrasado', 'inadimplencia', 'parcial')` ordenadas por `due_date` ascendente (mais próximas primeiro).
- **FR-003**: Cada linha MUST exibir: paciente (ou "[anonimizado]" se aplicável), plano de saúde, valor original, valor pago (se parcial), valor pendente, data de vencimento, dias até vencer ou em atraso, status com badge colorido.
- **FR-004**: Filtros disponíveis MUST incluir: período de vencimento (hoje / esta semana / este mês / customizado), status, plano de saúde, paciente.
- **FR-005**: Ação "Registrar pagamento" inline MUST abrir modal com campos valor, data, método de pagamento, nota opcional. Persistência cria nova linha em `installment_payments` (append-only) referenciando a parcela; o `paid_amount_cents` da parcela é derivado por `SUM(installment_payments.amount_cents)` (via view materializada OU trigger que atualiza coluna cacheada). UI atualiza sem reload. Valor de cada parcial MUST ser >0 e ≤ valor pendente naquele momento.
- **FR-006**: Parcelas com `due_date < hoje - 60 dias` MUST exibir badge "Atraso crítico" e oferecer ação "Marcar como inadimplência" (apenas `admin` + `financeiro`).
- **FR-007**: Ação "Marcar como inadimplência" MUST atualizar `status='inadimplencia'` sem alterar `amount_cents`; audit log com motivo opcional.
- **FR-008**: Apenas `admin` MUST ver ação "Reverter pagamento" que registra reversão (não delete) com justificativa obrigatória.

#### Contas a Pagar (US2)

- **FR-009**: O sistema MUST oferecer página `/analise/contas-a-pagar` acessível a `admin` e `financeiro` (não recepcionista).
- **FR-010**: A página MUST listar todas as `expenses` ativas (não soft-deleted) do tenant agrupadas por mês de `competence_date`, ordenadas por mês ascendente.
- **FR-011**: Cada linha MUST exibir: descrição, fornecedor, categoria, valor, data de competência, status (a vencer / vencida / paga), comprovante anexo se houver (link).
- **FR-012**: Despesas com `recurring=true` e `frequency=mensal|semanal|anual` MUST gerar projeções até 90 dias à frente, marcadas com label "Projeção (recorrente)".
- **FR-013**: Projeções recorrentes NÃO MUST ser persistidas — são geradas em runtime ao listar. Não podem ser editadas individualmente; alterações precisam vir da despesa-mãe (e respeitam FR-014a).
- **FR-014**: Despesas recorrentes MUST suportar versionamento via duas colunas: `recurring_starts_at` (DATE, default = `competence_date`) e `recurring_ends_at` (DATE nullable). Projeções de uma despesa-mãe só são geradas para datas no intervalo `[recurring_starts_at, recurring_ends_at)` (exclusivo no fim para evitar overlap).
- **FR-014a**: Reajuste de valor em despesa recorrente MUST ser tratado por versionamento (não UPDATE em `amount_cents`): ao editar o valor, o sistema (a) atualiza `recurring_ends_at` da despesa-mãe atual para a data de corte informada pelo usuário; (b) cria nova despesa com mesmos campos (categoria, descrição, fornecedor, frequência), novo `amount_cents` e `recurring_starts_at` = data de corte; (c) ambas as despesas referenciam-se via nova coluna nullable `superseded_by` (FK para a despesa nova) na despesa antiga, formando linhagem; (d) audit log registra "expense.recurring.versioned" com os dois IDs. Comportamento consistente com Princípio I e com o pattern de versionamento de comissões/preços já estabelecido.
- **FR-014b**: Encerramento simples (sem reajuste) de despesa recorrente MUST permitir setar `recurring_ends_at` sem criar versão nova; nesse caso `superseded_by` permanece NULL.
- **FR-015**: Filtros disponíveis MUST incluir: período, categoria, fornecedor (text autocomplete), status (a vencer / vencida / paga).
- **FR-016**: Ação "Marcar como paga" MUST inserir colunas `paid_at` (timestamp) e `paid_amount_cents` (int) na despesa SEM alterar `amount_cents`; audit log registra a ação. Coluna nova `paid_at` em `expenses`.
- **FR-017**: Pagamento parcial de despesa MUST ser permitido (`paid_amount_cents < amount_cents`); UI mostra "Parcial". Diferente das parcelas de paciente (que usam `installment_payments` — FR-005), despesas mantêm `paid_at`/`paid_amount_cents` direto na linha por simplicidade — múltiplos parciais em uma despesa são casos raros e podem ser tratados em iteração futura criando uma despesa de ajuste se necessário.
- **FR-018**: Apenas `admin` MUST ter ação "Reverter pagamento" com justificativa textual obrigatória (mínimo 10 caracteres).

#### Fluxo de Caixa (US3)

- **FR-019**: O sistema MUST oferecer página `/analise/fluxo-caixa` acessível a `admin` e `financeiro`.
- **FR-020**: A página MUST renderizar gráfico de saldo acumulado ao longo do tempo, integrando: entradas (parcelas com `paid_at` no passado e parcelas pendentes `due_date` futuras) e saídas (despesas com `paid_at` no passado e despesas pendentes com `competence_date` futuras).
- **FR-021**: O saldo de caixa do tenant MUST ser modelado como uma sequência append-only de ajustes em nova tabela `tenant_cash_balance_adjustments` — cada ajuste tem `effective_from` (date), `amount_cents` (int, com sinal — positivo = aporte, negativo = retirada/saída extraordinária), `reason` (text), `actor_user_id`, `created_at`. Saldo em qualquer data D é `SUM(amount_cents) WHERE effective_from <= D`. Default sem ajustes = R$ 0,00.
- **FR-021a**: A página `/configuracoes/clinica` MUST ganhar um card "Saldo de caixa" mostrando: saldo atual (soma vigente hoje), histórico dos últimos 10 ajustes, botão "Adicionar ajuste" (modal pede `effective_from`, valor com sinal, motivo). Apenas `admin` pode adicionar ajustes; sem edição/delete de ajustes históricos.
- **FR-021b**: O gráfico de fluxo de caixa (FR-020) MUST usar o saldo derivado de `tenant_cash_balance_adjustments` como **baseline** em cada ponto do tempo. Acrescentar um ajuste com `effective_from = hoje` NÃO altera o gráfico em datas anteriores — princípio de "valor vigente em cada data" preservado.
- **FR-022**: Visualizações MUST suportar 3 escalas: diária (últimos 30 dias + próximos 30 dias), semanal (últimas 12 + próximas 12 semanas), mensal (últimos 6 + próximos 6 meses).
- **FR-023**: Troca de escala MUST agregar dados no client (sem refetch do servidor).
- **FR-024**: Pontos onde o saldo cruza zero ou cai abaixo MUST ser destacados visualmente (cor vermelha, anotação no gráfico).
- **FR-025**: Tabela complementar abaixo do gráfico MUST listar cada evento individual no período visualizado (data, descrição, tipo entrada/saída, valor, saldo após).
- **FR-026**: Quando o conjunto excede 200 eventos no range visível, agregação semanal automática MUST ativar.

#### Repasse Médico (US4)

- **FR-027**: O sistema MUST oferecer página `/analise/repasse-medico/[mes]` (formato YYYY-MM) acessível a `admin`, `financeiro` e `profissional_saude`.
- **FR-028**: Para cada médico ativo do tenant, a página MUST calcular: faturamento bruto gerado por atendimentos do mês (de `appointments_effective`), comissão devida (de `net_commission_cents` por atendimento), pagamentos fixos do médico no mês (de `monthly_fixed_pay_lines`), pagamentos liberais (de `appointment_assistants`).
- **FR-029**: O total consolidado por médico MUST ser a soma de comissão + fixo + liberal, descontando ajustes do mês anterior (ver FR-034).
- **FR-030**: O cálculo enquanto o mês NÃO está fechado MUST refletir os dados ao vivo de `appointments_effective` (pode mudar se houver estornos).
- **FR-031**: Ação "Fechar mês" disponível apenas a `admin` MUST exigir confirmação dupla e persistir snapshot em nova tabela `monthly_payouts` (uma linha por médico × mês × tenant, com colunas para cada componente calculado).
- **FR-032**: Após "Fechar mês", o estado do mês MUST ser `fechado`; novos atendimentos/estornos daquele mês NÃO alteram os valores da snapshot. Os valores são imutáveis exceto pela janela de reabertura definida em FR-032a.
- **FR-032a**: Ação "Reabrir mês" disponível apenas a `admin` MUST permitir reverter o fechamento sob TODAS estas condições: (a) `now() - monthly_payouts.closed_at <= 24 horas`; (b) NENHUMA linha em `monthly_payouts` daquele mês × tenant tem `paid_at IS NOT NULL`; (c) justificativa textual obrigatória ≥20 caracteres. Reabertura cria linha append-only em nova tabela `monthly_payouts_reopens` (preservando snapshot dos valores originais antes da reabertura) e zera `closed_at`/`closed_by` na linha de `monthly_payouts` — o mês volta a recalcular ao vivo. Refechamento posterior sobrescreve `closed_at`/`closed_by` com novos valores.
- **FR-032b**: Quando uma das condições de FR-032a não é satisfeita, o sistema MUST exibir mensagem específica explicando: "Janela de 24h expirada — use ajuste no próximo mês" OU "X repasses já marcados como pagos — reabertura bloqueada para preservar auditoria".
- **FR-033**: Marcar um repasse como pago MUST inserir `paid_at`, `paid_amount_cents`, `payment_method`, `payment_note` na snapshot SEM alterar os valores calculados. Apenas `admin` ou `financeiro`. Audit log.
- **FR-034**: Estornos de atendimentos cujo mês já está fechado MUST gerar linha automática em `monthly_payouts_adjustments` (nova tabela append-only) referenciando o atendimento original; essa linha aparece como dedução/crédito no próximo repasse não fechado.
- **FR-035**: Profissional_saude com `user_id` vinculado a um `doctor` ativo MUST ver apenas o próprio repasse (RLS por `doctor.user_id`); demais médicos invisíveis.
- **FR-036**: A view do médico individual MUST mostrar, para cada atendimento do mês: data + paciente + procedimento + status (ativo/estornado) + **valor bruto cobrado** + **percentual de comissão aplicado** (e a vigência do termo, se aplicável) + **valor líquido da comissão**. Transparência total permite ao médico conferir e contestar antes do fechamento. Atendimentos estornados aparecem riscados, com motivo do estorno se disponível.
- **FR-037**: Snapshots em `monthly_payouts` MUST ser append-only — sem UPDATE de valores calculados, somente UPDATE em campos de pagamento (`paid_at`, etc.). Trigger DB enforce.

#### Dashboard Executivo (US5)

- **FR-038**: O sistema MAY oferecer página `/analise/dashboard` acessível a `admin` e `financeiro`, com KPIs visuais agregados.
- **FR-039**: KPIs disponíveis MUST incluir: faturamento do mês (com comparativo % vs. mês anterior), margem operacional (de `computeOperatingResult`), parcelas atrasadas (contagem + valor), despesas vencidas (contagem + valor), saldo projetado dos próximos 30 dias.
- **FR-040**: Cada KPI MUST ser clicável para navegar à página detalhada correspondente.
- **FR-041**: Alertas (saldo projetado negativo, +5 parcelas atrasadas, +3 despesas vencidas) MUST aparecer apenas quando a condição é verdadeira — sem mostrar "0" forçadamente.

#### Constituição e LGPD

- **FR-042**: Toda operação que registra pagamento, fechamento de mês, ou ajuste MUST gerar entrada em `audit_log` com `tenant_id`, `actor_id`, `event_type`, `entity`, `entity_id`, payload (valores anterior/novo quando aplicável).
- **FR-043**: Nenhuma operação MUST permitir UPDATE em colunas de valor calculado (`amount_cents`, `net_commission_cents`, etc.) — apenas inserção de novos registros relacionados ou colunas de pagamento.
- **FR-044**: Triggers de banco SHOULD impedir UPDATE/DELETE direto em `monthly_payouts` exceto via path autorizado.
- **FR-045**: Pacientes anonimizados LGPD MUST aparecer como "[anonimizado]" em contas a receber mas o valor pendente continua visível.
- **FR-046**: Médico profissional_saude MUST ver apenas o próprio repasse (filtro server-side por `doctor.user_id`); profissionais nunca veem totais consolidados do tenant.

### Key Entities

- **Payment Installment** (existente, `payment_installments`): parcela individual com `due_date`, `amount_cents`, `status`, `paid_at`, `paid_amount_cents`, `payment_method`. Esta feature mantém o schema mas **desloca o `paid_amount_cents` para ser derivado** da nova tabela de pagamentos (trigger ou view materializada — decisão de plano).
- **Installment Payment** (nova, `installment_payments`): registro append-only de cada pagamento parcial ou total de uma parcela. Colunas: `id`, `tenant_id`, `installment_id` (FK), `paid_at` (timestamptz), `amount_cents` (int >0), `payment_method` (text), `note` (text nullable), `actor_user_id` (FK), `created_at`. Trigger DB IMPEDE UPDATE/DELETE — para reverter, admin insere linha de **estorno** com `amount_cents` negativo + nota obrigatória, mantendo trilha forense.
- **Expense** (existente, `expenses`): despesa com `category`, `description`, `supplier`, `amount_cents`, `competence_date`, `recurring`, `frequency`. **Acréscimos** desta feature: `paid_at` (timestamptz nullable), `paid_amount_cents` (int nullable), `payment_method` (text nullable), `recurring_starts_at` (date nullable; default = `competence_date`), `recurring_ends_at` (date nullable), `superseded_by` (UUID nullable, FK → `expenses.id`, marca a versão substituta em reajustes recorrentes).
- **Monthly Payout** (nova, `monthly_payouts`): snapshot mensal por médico do tenant. Colunas: `id`, `tenant_id`, `doctor_id`, `month` (YYYY-MM), `closed_at` (timestamptz, quando admin fechou), `closed_by` (user_id), `gross_revenue_cents`, `commission_cents`, `fixed_payment_cents`, `liberal_payment_cents`, `adjustments_cents` (de ajustes do mês anterior), `total_due_cents`, `paid_at` (nullable), `paid_amount_cents` (nullable), `payment_method` (nullable), `payment_note` (nullable), `created_at`. UNIQUE `(tenant_id, doctor_id, month)`. Append-only via trigger.
- **Monthly Payout Adjustment** (nova, `monthly_payouts_adjustments`): ajustes gerados automaticamente quando atendimento de mês fechado é estornado. Colunas: `id`, `tenant_id`, `doctor_id`, `original_appointment_id`, `original_month` (YYYY-MM), `applied_month` (YYYY-MM, mês onde o ajuste será aplicado), `delta_cents` (positivo = crédito, negativo = débito), `reason`, `created_at`. Append-only.
- **Monthly Payout Reopen** (nova, `monthly_payouts_reopens`): registro forense de cada reabertura de mês (FR-032a). Colunas: `id`, `tenant_id`, `month` (YYYY-MM), `reopened_at`, `reopened_by` (user_id), `reason` (text, ≥20 chars), `snapshot_before` (JSONB com cópia dos valores de `monthly_payouts` daquele mês imediatamente antes da reabertura), `created_at`. Append-only via trigger.
- **Tenant Cash Balance Adjustment** (nova, `tenant_cash_balance_adjustments`): ajustes do saldo de caixa do tenant (FR-021). Colunas: `id`, `tenant_id`, `effective_from` (date), `amount_cents` (int com sinal — positivo = aporte/crédito, negativo = retirada/débito), `reason` (text), `actor_user_id` (FK), `created_at`. Append-only via trigger. Saldo vigente em qualquer data D = `SUM(amount_cents) WHERE tenant_id=$1 AND effective_from <= D`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A recepcionista consegue ver todas as parcelas a receber da semana em ≤3 segundos a partir do clique no menu (incluindo SSR + render inicial).
- **SC-002**: A ação "Registrar pagamento" de uma parcela em `/analise/contas-a-receber` salva e atualiza a UI em ≤2 segundos (round-trip + refresh).
- **SC-003**: O admin consegue planejar o caixa do próximo trimestre (entradas + saídas projetadas) sem sair de uma única página, em ≤30 segundos de navegação.
- **SC-004**: Em uma clínica com 100 parcelas/mês e 50 despesas/mês, a página de fluxo de caixa renderiza o gráfico em ≤4 segundos em conexão 3G boa.
- **SC-005**: O fechamento de repasse mensal completo (5-10 médicos) leva ≤3 minutos do clique inicial em "Fechar mês" até o último médico marcado como pago.
- **SC-006**: 100% dos valores calculados nas snapshots `monthly_payouts` MUST bater (paridade absoluta) com os valores que `computeOperatingResult` mostra para o mesmo período — verificado por teste de paridade.
- **SC-007**: Zero operações UPDATE em colunas de valor calculado de `monthly_payouts` — verificado por teste de constituição + trigger DB.
- **SC-008**: Em uma pesquisa qualitativa com 3+ administradores de clínica reais, ≥80% MUST descrever as 3 páginas (contas a pagar / contas a receber / fluxo de caixa) como "claras e suficientes para o uso diário".
- **SC-009**: Suite de regressão (acceptance scenarios das 5 user stories + edge cases) passa 100% antes do merge.
- **SC-010**: Zero regressão em `computeOperatingResult` e `buildFinancialReport` — verificado pela suite atual de testes desses módulos.

## Assumptions

- **A-001**: A migration nova introduzirá as colunas `paid_at`, `paid_amount_cents`, `payment_method`, `recurring_ends_at` em `expenses` e criará tabelas `monthly_payouts` + `monthly_payouts_adjustments`. Nenhuma alteração em `payment_installments` (já tem `paid_at`).
- **A-002**: As funções existentes `computeOperatingResult` e `buildFinancialReport` permanecem como fonte canônica de cálculos consolidados. Esta feature consome — não duplica.
- **A-003**: O endpoint atual de registrar pagamento na ficha do paciente (`/api/pacientes/[id]/financeiro` ou similar) é reusado pela ação "Registrar pagamento" em contas-a-receber. Não criamos novo endpoint.
- **A-004**: Saldo de caixa (FR-021) é modelado como tabela append-only `tenant_cash_balance_adjustments` (decidido em /speckit.clarify Q5). A página `/configuracoes/clinica` (feature 009) ganha um novo card com histórico de ajustes e botão "Adicionar ajuste" — sem edição/delete de linhas históricas.
- **A-005**: Profissionais de saúde com vínculo a `doctors.user_id` foi entregue pela feature 012; esta feature pressupõe esse vínculo já existir para o RLS do repasse médico funcionar.
- **A-006**: Despesas recorrentes (já em schema com `recurring=true, frequency`) não têm coluna `ends_at` hoje — será acrescentado por esta feature.
- **A-007**: O design 016 (paleta + tokens) é seguido. Cores semânticas: success-text/bg para entradas/pagos, alert para vencidos, warning para "a vencer breve".
- **A-008**: Recharts já em uso (features 019 e VitalSignsSection) — reusado para o gráfico de fluxo de caixa sem nova dependência.
- **A-009**: Migrations seguem o padrão do projeto (NNNN_descricao.sql); próxima livre é provavelmente 0095+ (atual mais alta no repo é ~0094 feature 018).
- **A-010**: O export Excel/PDF dessas novas páginas reusa os helpers existentes em `lib/core/reports/export-*` — sem novo formato.

## Out of Scope (não-objetivos explícitos)

- **OS-001**: Reescrita de `computeOperatingResult` ou `buildFinancialReport` — apenas consumo.
- **OS-002**: Novo modelo de comissão; o motor existente em `lib/core/commissions/` fica intacto.
- **OS-003**: Integração bancária (Open Finance, débito automático, conciliação direta com extrato bancário). Escopo de feature futura específica.
- **OS-004**: Multi-filial / centro de custo — despesas continuam com 1:1 `tenant_id`.
- **OS-005**: Cadastro estruturado de fornecedores — campo `supplier` continua texto livre.
- **OS-006**: TISS XML para convênios — escopo da Onda 2 do roadmap, feature própria.
- **OS-007**: Previsão estatística sofisticada (ML, sazonalidade) — projeção é determinística (parcelas conhecidas + despesas recorrentes conhecidas).
- **OS-008**: Suporte a múltiplas moedas — tudo em centavos BRL.
- **OS-009**: Nota fiscal eletrônica (NF-e) — integração com SEFAZ é feature própria futura.
- **OS-010**: Cobrança automática (boleto/PIX) — gera link de pagamento ou QR code é escopo futuro (feature de "Cobranças automáticas").
- **OS-011**: Permitir editar valor calculado de repasse já fechado — bloqueado por constituição. Correções via ajuste no próximo mês.
- **OS-012**: Dashboard executivo (US5 — P3) pode ser deferido para iteração seguinte caso US1-US4 consumam tempo.
