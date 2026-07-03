# Quickstart — Feature 013: Modalidades de pagamento + Profissional assistente

Guia rápido para desenvolver, validar localmente e fazer smoke test por User Story.

---

## Pré-requisitos

- Node 20 LTS + pnpm 9
- Docker rodando (para `supabase start`)
- `.env.local` apontando para Supabase local (porta 54321) com `PATIENT_DATA_ENCRYPTION_KEY` e Service Role key configurados
- Demo tenant seedado (`pnpm seed:demo` — credenciais: `admin@clinica-demo.test` / `demo1234`)

---

## Setup local

```powershell
# Subir stack Supabase local + aplicar migrations (inclui a 0084)
pnpm supabase:reset

# Verificar que migration 0084 aplicou
pnpm exec supabase --workdir . migration list | Select-String '0084'

# Gerar types TS atualizados
pnpm supabase:gen-types

# Subir Next.js
pnpm dev
```

A app sobe em `http://localhost:3000`. Login: `admin@clinica-demo.test` / `demo1234`.

---

## Smoke test por User Story

> Cada story deve ser testável independentemente. Faça em ordem (US1 → US2 → US3) porque há dependência de dados, mas o código de cada story é independente.

### US1 — Cadastrar profissional com modalidade (P1)

1. Navegue para `/configuracoes/profissionais`.
2. Clique em "Novo profissional".
3. Preencha nome, CRM, role.
4. No seletor "Modalidade", escolha **Fixo**. Confirme que aparecem os campos "Valor mensal" e "Dia de faturamento" e somem os campos de comissão.
5. Preencha "Valor mensal" `R$ 8.000,00` e "Dia de faturamento" `5`. Informe `reason` mínimo de 3 chars.
6. Salve.
7. Volte à listagem. Confirme:
   - Badge "Fixo" no profissional recém-criado.
   - Coluna "Valor" mostra "R$ 8.000,00 / mês (dia 5)".
8. Edite o profissional. Mude para **Liberal**. Confirme campos dinâmicos. Preencha valor padrão R$ 350,00 + reason. Salve.
9. Volte à listagem. Badge agora é "Liberal" e valor é "R$ 350,00 / participação".
10. Abra o histórico via `GET /api/medicos/[id]/payment-terms` (curl ou DevTools). Confirme **2 versões**:
    - A inicial (Fixo).
    - A nova (Liberal).
11. Repita o teste com modalidade **Comissionado** — preencha `Comissão %` (preserva comportamento atual).
12. **Backfill**: verifique que profissionais existentes antes do deploy aparecem como "Comissionado" sem qualquer ação.

✅ **US1 OK quando**: cadastro e edição funcionam para as 3 modalidades, badge na listagem reflete, histórico tem 1 row por mudança, e profissionais legados aparecem como comissionados.

---

### US2 — Adicionar assistente em atendimento (P2)

**Pré-requisito**: ter pelo menos 1 profissional Liberal e 1 Comissionado/Fixo cadastrados (faça via US1).

1. Navegue para `/operacao/atendimentos/novo`.
2. No formulário, selecione "Profissional principal" — confirme que **apenas Comissionados e Fixos** aparecem (Liberais não).
3. Preencha paciente, procedimento, etc.
4. Role para baixo e veja o campo "Profissional assistente" (opcional). Clique em "Adicionar assistente".
5. No multi-select, confirme que **apenas Liberais** aparecem. Selecione um. Valor padrão é preenchido (do cadastro). Edite para R$ 350,00.
6. Clique em "Adicionar outro assistente" e selecione outro Liberal (se houver) com valor diferente.
7. Tente selecionar o mesmo Liberal duas vezes — UI deve bloquear.
8. Salve o atendimento.
9. Abra a página de detalhe do atendimento. Confirme:
   - Profissional principal listado normalmente.
   - Bloco "Assistentes" abaixo com os 2 liberais e valores congelados.
10. Navegue para `/operacao/agenda` (ou calendário). Encontre o bloco do atendimento — deve mostrar **"(+ 2 assistentes)"** abaixo do nome do profissional principal.
11. Volte ao detalhe e clique "Remover" num assistente. Confirme que ele some da listagem ativa. `removed_assistants_count` aumenta em 1.
12. Audite via `audit_log`:

    ```sql
    SELECT entity, field, new_value, created_at
    FROM audit_log
    WHERE entity='appointment_assistants'
    ORDER BY created_at DESC LIMIT 5;
    ```

    Deve haver `added` (×2) e `removed` (×1).

13. **Mudança retroativa de modalidade não retroage**: altere o profissional Liberal para Comissionado. Volte ao detalhe do atendimento — o assistente passado **continua aparecendo** com o valor congelado (histórico imutável).

✅ **US2 OK quando**: multi-select filtra liberais, valor congelado é preservado, audit captura adição/remoção, calendário mostra contagem, mudança de modalidade não retroage.

---

### US3 — Relatórios refletem fixos e liberais (P3)

**Pré-requisito**: US1 + US2 com pelo menos 1 Fixo (com dia >= dia atual − 5) e 1 atendimento com 1 assistente Liberal.

1. **Relatório mensal** — `/analise/relatorios/mensal?month=YYYY-MM` (mês corrente):
   - Confirme que aparece uma seção "Pagamentos fixos" com 1 linha por Fixo cadastrado (só se data atual >= billing_day).
   - Total geral inclui `fixed_payments_cents`.

2. **Antes do dia de faturamento**: se hoje for dia 3 e o Fixo tem dia 5, a linha NÃO deve aparecer no mês corrente (só a partir do dia 5).

3. **Relatório por profissional (Fixo)** — `/analise/relatorios/por-profissional/[doctor_fixo_id]?from=...&to=...`:
   - Header mostra "Pagamento fixo: R$ X / mês (dia 5)".
   - Sem campo "Comissão %".
   - Atendimentos do mês listados (para fins de produtividade).

4. **Relatório por profissional (Liberal)** — `/analise/relatorios/por-profissional/[doctor_liberal_id]?from=...&to=...`:
   - Header mostra "Total em participações no período: R$ Y".
   - Lista as participações com data, paciente, valor congelado.

5. **Relatório por profissional (Comissionado — regressão)**: confirme que o shape atual está **idêntico** ao pré-deploy. Compare com snapshot anterior se possível.

6. **Resultado operacional** — `/analise/relatorios/resultado-operacional?month=YYYY-MM`:
   - Vê a fórmula: gross_revenue − commissions − fixed − liberal − taxes − operating = net_profit.
   - Drill-downs funcionam (clique em "Comissões" → vai pra `/por-profissional?payment_mode=comissionado`).

7. **Atendimento estornado**: estorne o atendimento com assistente. Recarregue o relatório do Liberal — a participação some do total.

✅ **US3 OK quando**: linhas de fixo aparecem no dia certo, relatórios por profissional mostram shapes diferentes por modalidade, comissionados sem regressão, resultado operacional bate manualmente, estorno propaga para o relatório do Liberal.

---

## Comandos úteis durante o dev

```powershell
# Type check
pnpm typecheck

# Lint de autenticação (verifica requireRole em handlers)
pnpm lint:auth

# Vitest — só arquivos da feature
pnpm test specs/013

# Vitest — integration tests da feature
pnpm test tests/integration/doctor-create-with-payment-mode.spec.ts
pnpm test tests/integration/appointment-create-with-assistants.spec.ts

# Inspecionar o estado do head-of-chain
pnpm exec supabase --workdir . db psql -c "SELECT doctor_id, payment_mode, valid_from, monthly_amount_cents, liberal_default_cents FROM doctor_payment_terms_current;"

# Inspecionar linhas de pagamento fixo do mês corrente
pnpm exec supabase --workdir . db psql -c "SELECT * FROM monthly_fixed_pay_lines WHERE date_trunc('month', month_start) = date_trunc('month', CURRENT_DATE);"

# Verificar que o backfill rodou (cada doctor tem >=1 row em history)
pnpm exec supabase --workdir . db psql -c "SELECT d.id, COUNT(h.id) FROM doctors d LEFT JOIN doctor_payment_terms_history h ON h.doctor_id = d.id GROUP BY d.id HAVING COUNT(h.id) = 0;"
# ↑ Espera-se 0 linhas — todos os doctors têm pelo menos 1 row em history
```

---

## Troubleshooting

- **"ASSISTANT_NOT_LIBERAL"**: o doctor selecionado como assistente não tem `payment_mode='liberal'` na `doctor_payment_terms_current`. Verifique o head-of-chain ou troque a modalidade dele.
- **"LIBERAL_AS_PRINCIPAL"**: o doctor selecionado como principal é Liberal. Liberais só podem ser assistentes — escolha Comissionado ou Fixo.
- **"VALID_FROM_FUTURE"**: a UI deve ter capturado um `valid_from > hoje`. No MVP, mudança de modalidade vale a partir de hoje.
- **Linha de pagamento fixo não aparece no mês corrente**: confirme que `billing_day <= dia atual`. Antes do dia configurado, a linha não é incluída (FR-020).
- **Histórico de modalidades vazio para um doctor**: o backfill da migration deve ter criado 1 row inicial. Se faltou, rode o passo de backfill manualmente (consultar `0084_payment_modes_and_assistants.sql > seção BACKFILL`).
- **`payment_mode_change` em PATCH bloqueado**: confirme que o ator tem `role='admin'`.

---

## Critérios de aceitação consolidados

A feature 013 está PRONTA para merge quando:

| Check                                                        | Como validar                                                                     |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| Todos os profissionais existentes aparecem como Comissionado | Query SQL em `doctor_payment_terms_current` agrupada por mode                    |
| Cadastro com 3 modalidades funciona                          | Smoke US1 (passos 4–11)                                                          |
| Assistente liberal funciona em atendimento novo + edição     | Smoke US2 (passos 4–12)                                                          |
| Calendário mostra "(+ N assistentes)"                        | Smoke US2 (passo 10)                                                             |
| Relatório mensal tem `fixed_pay_lines` no dia correto        | Smoke US3 (passos 1–2)                                                           |
| Relatório por profissional diferencia shape por modalidade   | Smoke US3 (passos 3–5)                                                           |
| Resultado operacional mostra fórmula completa                | Smoke US3 (passo 6)                                                              |
| Estorno propaga em todos os relatórios                       | Smoke US3 (passo 7)                                                              |
| Audit log captura todas as mudanças                          | Smoke US1+US2 + `SELECT * FROM audit_log WHERE entity IN (...)`                  |
| 0 regressões em comissões existentes (SC-006)                | Snapshot diff de `/relatorios/por-profissional/[comissionado_id]` antes e depois |
| `pnpm typecheck`, `pnpm lint:auth`, `pnpm test` verdes       | CI pipeline                                                                      |
