# Quickstart — Smoke Test Manual

**Feature**: 023 — Financeiro robusto

## Pré-requisitos

```powershell
supabase start
pnpm supabase:reset
pnpm supabase:gen-types
pnpm dev
```

Login como `admin@prontool.local`.

## Roteiro

### Cenário 1 — Contas a Receber (US1)

**Setup**:

- Cadastrar paciente "Maria Teste" com plano Unimed.
- Registrar 3 atendimentos: ontem (paga), há 70 dias (atrasada crítica), há 5 dias (pendente).
- Os atendimentos geraram 3 parcelas via fluxo financeiro existente.

**Validar**:

- [ ] Abrir `/analise/contas-a-receber` — lista 3 parcelas ordenadas por vencimento.
- [ ] A parcela há 70 dias atrás aparece com badge vermelho "Atraso crítico".
- [ ] Filtro "Atrasadas" → só vencidas.
- [ ] Clicar "Registrar pagamento" na parcela atrasada → modal abre.
- [ ] Inserir R$ 20 (parcial de R$ 60), salvar.
- [ ] Parcela aparece com badge "Parcial — falta R$ 40,00" e contador "1 parcial registrado".
- [ ] Registrar outro R$ 20 → parcela atualiza para R$ 40 pago / R$ 20 pendente.
- [ ] Botão "Marcar inadimplência" aparece na parcela >60 dias. Confirma com motivo. Status muda.
- [ ] Login como `recepcionista` → vê a lista mas não vê "Reverter pagamento".

### Cenário 2 — Contas a Pagar (US2)

**Setup**:

- Cadastrar despesa "Aluguel" categoria aluguel, R$ 5.000, recorrente mensal, competence_date = início do mês.
- Cadastrar despesa "Material X" não-recorrente, R$ 300, vencimento daqui a 10 dias.

**Validar**:

- [ ] Abrir `/analise/contas-a-pagar` — vê aluguel atual + 3 projeções futuras (próximos 3 meses) + Material X.
- [ ] Projeções têm label "Projeção (recorrente)" e não são editáveis individualmente.
- [ ] Marcar "Material X" como paga → modal pede data + método. Salva.
- [ ] Status muda para "paga". Audit log tem entrada `expense.paid`.
- [ ] Tentar pagar 2x a mesma → mensagem "Despesa já paga".
- [ ] **Reajuste** (FR-014a): clicar "Reajustar valor" no aluguel → modal pede effective_from + novo valor + motivo. Setar para R$ 5.500 a partir de 2026-08-01.
- [ ] Verificar que despesa antiga ganhou `recurring_ends_at = 2026-07-31`, nova foi criada com `recurring_starts_at = 2026-08-01`. Antiga tem `superseded_by` apontando para a nova.
- [ ] Projeções futuras agora mostram R$ 5.000 até julho e R$ 5.500 a partir de agosto.

### Cenário 3 — Fluxo de Caixa (US3)

**Setup**:

- 10 parcelas pendentes nos próximos 30 dias (entradas).
- 5 despesas previstas nos próximos 30 dias (saídas).
- Saldo inicial não configurado (default = R$ 0).

**Validar**:

- [ ] Abrir `/analise/fluxo-caixa` — gráfico mostra curva de saldo.
- [ ] Como saldo inicial é 0 e entradas/saídas se balanceiam, valida que curva oscila.
- [ ] Trocar escala "Diária → Semanal → Mensal" — agregação acontece sem refetch.
- [ ] Tabela abaixo do gráfico lista cada evento.
- [ ] Ir em `/configuracoes/clinica`, adicionar ajuste de saldo +R$ 10.000 com effective_from = hoje.
- [ ] Voltar para `/analise/fluxo-caixa` — toda curva do hoje em diante sobe R$ 10k. Curva antes de hoje não muda (preservado).
- [ ] Adicionar mais 1000 parcelas falsas via SQL para forçar agregação automática (>200 eventos) → verificar que agregação semanal liga.

### Cenário 4 — Saldo de Caixa (FR-021)

**Validar**:

- [ ] Ir em `/configuracoes/clinica` → card "Saldo de caixa" no final.
- [ ] Saldo atual = 0.
- [ ] Clicar "Adicionar ajuste" → modal: effective_from = hoje, amount_cents = R$ 50.000, reason = "Aporte inicial do sócio".
- [ ] Salvar → saldo atual = R$ 50.000.
- [ ] Histórico mostra a entrada.
- [ ] Tentar editar/deletar a entrada → impossível (UI não permite, trigger DB bloqueia).
- [ ] Adicionar outro ajuste -R$ 10.000 com effective_from = ontem com motivo "Retirada extraordinária".
- [ ] Saldo de hoje = R$ 40.000. Saldo de ontem = -R$ 10.000 (válido para forensia).
- [ ] Login como `financeiro` → vê histórico mas botão "Adicionar ajuste" não aparece (só admin).

### Cenário 5 — Repasse Médico — Fechar (US4)

**Setup**:

- 3 médicos: Dr. A (comissionado 60%), Dr. B (fixo R$ 5.000/mês), Dr. C (liberal).
- 30 atendimentos no mês 2026-04 distribuídos.
- 1 atendimento estornado.

**Validar**:

- [ ] Login como admin. Abrir `/analise/repasse-medico/2026-04`.
- [ ] Cada médico aparece com gross + commission + fixed + liberal calculados ao vivo.
- [ ] Estorno está refletido (`gross_revenue_cents` exclui estornado).
- [ ] Clicar "Fechar mês" → confirmação dupla.
- [ ] Após fechar: status muda para "fechado", botão some, valores ficam congelados.
- [ ] **Paridade SC-006**: rodar `pnpm test paridade` → totais batem com `computeOperatingResult('2026-04')`.

### Cenário 6 — Repasse Médico — Estorno pós-fechamento (FR-034)

**Pré-requisito**: cenário 5 executado.

**Validar**:

- [ ] Estornar outro atendimento de 2026-04 (mês fechado).
- [ ] Verificar via SQL: nova linha em `monthly_payouts_adjustments` com `applied_month = '2026-05'`, `delta_cents` negativo.
- [ ] Abrir `/analise/repasse-medico/2026-05` (ainda aberto) — médico afetado mostra "Ajustes: -R$ X" no card.

### Cenário 7 — Repasse Médico — Reabrir (FR-032a)

**Pré-requisito**: cenário 5 executado, NENHUM repasse marcado como pago.

**Validar**:

- [ ] Imediatamente após fechar: botão "Reabrir mês" disponível.
- [ ] Clicar → modal pede motivo. Escrever "Esqueci de incluir atendimento atrasado" (≥20 chars).
- [ ] Salvar → mês volta a "aberto", cálculos voltam a ser ao vivo.
- [ ] Verificar via SQL: linha em `monthly_payouts_reopens` com `snapshot_before` populado em JSONB.
- [ ] Marcar 1 repasse como pago. Tentar reabrir → erro "X repasses já marcados como pagos".
- [ ] Avançar relógio (em dev) +25h. Tentar reabrir → erro "Janela de 24h expirada".

### Cenário 8 — Repasse Médico — Médico vê só o próprio (FR-035)

**Validar**:

- [ ] Vincular `doctors.user_id` de Dr. A a um auth.users com role `profissional_saude`.
- [ ] Login como Dr. A → abrir `/analise/repasse-medico/2026-04`.
- [ ] Vê apenas a própria linha + detalhamento dos atendimentos do mês com valor bruto + comissão + percentual (FR-036).
- [ ] Total agregado do tenant não aparece.
- [ ] Dr. B/C não aparecem.

### Cenário 9 — RBAC e tenant isolation (FR-027/28/29)

**Validar**:

- [ ] Login como `recepcionista` → vê contas-a-receber OK, mas contas-a-pagar/repasse/fluxo retornam 403 ou redirect.
- [ ] Tentar acessar `/api/financeiro/repasse-medico/2026-04` direto com cookie de outro tenant → 403/404.
- [ ] Profissional_saude tenta `POST /repasse-medico/2026-04/close` → 403.

### Cenário 10 — LGPD: paciente anonimizado em contas a receber (FR-045)

**Validar**:

- [ ] Anonimizar um paciente com parcela pendente.
- [ ] `/analise/contas-a-receber` mostra "[anonimizado]" no campo paciente, mas o valor pendente continua visível.
- [ ] Modal de pagamento ainda permite registrar (entrada pertence ao tenant, não ao PII).

## Checks finais

```powershell
pnpm typecheck
pnpm lint:auth
pnpm test  # cobre contract + unit + integration
```

**Paridade SC-006**: `pnpm test paridade` deve passar com igualdade campo-a-campo entre `close_monthly_payout` e `computeOperatingResult` em fixture de 5 médicos × 50 atendimentos.

**Constitution Check final**: zero UPDATEs em colunas calculadas (`pnpm test append-only`).
