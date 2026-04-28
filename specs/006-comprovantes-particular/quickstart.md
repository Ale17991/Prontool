# Quickstart — Feature 006 (Comprovantes 1:N + Atendimento particular)

**Branch**: `006-comprovantes-particular`

## Pré-requisitos

- Node 20 LTS, pnpm
- Docker Desktop em execução (Supabase local)
- Conta admin no tenant de dev
- Conta financeiro no tenant de dev (para testar o split de RBAC)

## Setup

```bash
git fetch origin
git checkout 006-comprovantes-particular

pnpm install                # nenhuma dep nova
pnpm supabase start         # se ja nao estava
pnpm supabase:reset         # aplica todas as migrations + 0059
pnpm supabase:gen-types
```

## Validação manual — Feature 1 (Comprovantes 1:N)

1. `pnpm dev` → http://localhost:3000 → login admin.
2. Vá em `/cadastros/despesas`.
3. **Cadastrar com 3 anexos**: clique em "Nova despesa", preencha. No campo "Comprovantes", selecione 3 arquivos (PDF + PDF + JPG). Salve. **Esperado**: despesa criada com clipe + contagem `3` na lista.
4. **Expandir**: clique no clipe (ou na linha). **Esperado**: lista mostra os 3 arquivos com nome + tamanho + uploaded_by + botões "Visualizar" + "Baixar".
5. **Visualizar PDF**: clique em "Visualizar" no PDF. **Esperado**: nova aba abre o PDF (URL assinada de 60 s).
6. **Baixar JPG**: clique em "Baixar" no JPG. **Esperado**: download inicia.
7. **Adicionar mais 1**: clique em "+ Adicionar comprovante" na despesa existente. Suba mais um. **Esperado**: contagem vira `4`.
8. **Mesmo nome**: tente subir outro arquivo chamado igual a um já existente. **Esperado**: subiu com sufixo `-1` no nome (ex.: `boleto-1.pdf`).
9. **Tipo não suportado**: tente subir `.docx` ou imagem `.gif`. **Esperado**: erro inline antes de submit.
10. **Tamanho > 10 MB**: tente subir arquivo > 10 MB. **Esperado**: erro client-side.
11. **Soft-delete (admin)**: como admin, clique no ícone de lixeira em um item. Confirme. **Esperado**: item some da lista; contagem decresce.
12. **Audit**: SQL `SELECT * FROM audit_log WHERE entity='expense_receipts' ORDER BY timestamp_utc DESC LIMIT 5;` deve mostrar uploads + soft_delete.
13. **RBAC — financeiro**: logar como `financeiro@tenant.test`. **Esperado**: pode anexar (sim), pode remover (não — botão lixeira não aparece).
14. **RBAC — recepcionista**: logar como `recepcionista@tenant.test`. **Esperado**: vê os comprovantes (sim) + baixar/visualizar (sim) + anexar (não) + remover (não).

## Validação manual — Feature 2 (Atendimento particular)

### Caso A: paciente sem plano cadastrado
1. Logar como recepcionista.
2. Ir em `/operacao/atendimentos/novo`.
3. Selecionar paciente "Júlia" (sem `plan_id`). **Esperado**: checkbox "Atendimento particular" vem **marcado**, select de plano oculto, valor pré-preenchido com `default_amount_cents` do procedimento.
4. Selecionar procedimento. **Esperado**: valor atualiza com base em `default_amount_cents`.
5. Salvar. **Esperado**: atendimento criado com `plan_id = NULL`.
6. Abrir o detalhe do atendimento. **Esperado**: badge "Particular" visível.
7. Voltar à lista de atendimentos. **Esperado**: linha do atendimento mostra badge "Particular".
8. No calendário (`/operacao/atendimentos?view=cal`), o bloco do atendimento mostra badge.

### Caso B: paciente com plano
1. Selecionar paciente "Pedro" (com plano Unimed). **Esperado**: checkbox **desmarcado**, select de plano visível pré-selecionado em Unimed.
2. Marcar manualmente o checkbox. **Esperado**: select de plano se esconde, valor recalcula via `default_amount_cents`.
3. Desmarcar de novo. **Esperado**: select reaparece, valor via `price_versions`.

### Caso C: procedimento não coberto por plano
1. Cadastrar um procedimento novo com `covered_by_plan = false`.
2. Em "Novo atendimento", selecionar Pedro (com plano) + esse procedimento. **Esperado**: checkbox **forçado a marcado** (desabilitado), com nota "Procedimento não coberto por plano".

### Caso D: procedimento sem `default_amount_cents`
1. Cadastrar procedimento novo sem valor particular.
2. Em "Novo atendimento", marcar particular + selecionar esse procedimento. **Esperado**: aviso "Valor particular não cadastrado para este procedimento". Campo de valor em branco; salvar bloqueado até preencher manualmente.

### Caso E: nova etapa do plano de tratamento
1. Ir em `/operacao/pacientes/[id]` de Júlia (sem plano). Aba "Plano de tratamento".
2. "+ Nova etapa". **Esperado**: checkbox auto-marcado.
3. Salvar etapa. **Esperado**: appointment auto-criado com `plan_id = NULL`; etapa exibe badge "Particular".

## Testes automatizados

```bash
pnpm typecheck
pnpm lint:auth
pnpm test
pnpm test:integration
pnpm test:contract
```

Específicos da feature:
- `tests/integration/expense-receipts.spec.ts` — N uploads, listar, soft-delete admin, audit log.
- `tests/integration/particular-appointment.spec.ts` — INSERT com plan_id NULL passa o trigger; INSERT com plan_id NULL + source_price_version_id SET falha com `APPOINTMENT_PARTICULAR_NO_PRICE_VERSION`.
- `tests/unit/particular-detection.spec.ts` — matriz `(paciente.plan_id, procedimento.covered_by_plan)` → estado inicial.

## Troubleshooting

- **Erro `column "deleted_at" does not exist` em queries de receipt**: re-rodar `pnpm supabase:gen-types` após `pnpm supabase migration up`.
- **`null value in column "plan_id" violates not-null constraint`**: a migration 0059 não aplicou; rodar `pnpm supabase migration up` e conferir `\d appointments` no psql.
- **Backfill skipped 0 rows na 0059**: esperado se não houver receipts no schema legado em prod ainda. NOTICE no log confirma.
- **Trigger `enforce_appointment_preconditions` rejeita atendimento particular**: conferir que o trigger foi recriado pela 0059 (`SELECT pg_get_functiondef('public.enforce_appointment_preconditions'::regproc)`).
