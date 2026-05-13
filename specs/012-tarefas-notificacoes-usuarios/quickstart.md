# Quickstart — Tarefas, Notificações e Cadastro Manual de Usuário (012)

> Passo-a-passo para colocar a feature de pé localmente, aplicar a migration, rodar smoke tests e validar manualmente cada user story.

---

## Pré-requisitos

- Docker rodando (Supabase local). Confirme via `docker ps`.
- Node 20 LTS + `pnpm`.
- Branch atual: `012-tarefas-notificacoes-usuarios`.

## Setup inicial

```powershell
# 1) Aplica a migration nova + todas anteriores
pnpm supabase:reset

# 2) Regenera tipos (Database type passa a incluir tasks, notifications, doctors.user_id)
pnpm supabase:gen-types

# 3) Sanity checks
pnpm typecheck
pnpm lint:auth
pnpm test  # full suite — incluindo os tests novos da 012
```

---

## Validação por user story (smoke)

### US1 — Tarefas

1. `pnpm dev` e logue como admin.
2. Sidebar: clique em **Tarefas** (novo item em Operação).
3. Cadastrar tarefa:
   - Título: `Ligar para paciente João`
   - Responsável: outra pessoa do tenant (ex.: "Ana")
   - Data limite: amanhã
   - Prioridade: `alta`
4. **Esperado**: tarefa aparece com status `pendente`; audit_log ganha linha (`entity='tasks'`, `reason='task-created'`).
5. Logue como Ana → tela mostra a tarefa atribuída a ela.
6. Ana clica em **Concluir** → status muda para `concluida`, `completed_at`/`completed_by` preenchidos. Audit `task-completed`.
7. Admin clica em **Reabrir** → status volta a `pendente`. Audit `task-reopened`.
8. Filtro `?status=atrasada` → exige uma task com `due_date` no passado e status `pendente`; aparece em vermelho.
9. Como recepcionista, criar nova tarefa: campo `assigned_to` é forçado para "Eu" (sem opção).

```sql
SELECT t.title, t.status, t.due_date, u.email AS responsavel
FROM public.tasks t
JOIN auth.users u ON u.id = t.assigned_to
WHERE t.tenant_id = '<tenantId>' ORDER BY t.created_at DESC LIMIT 10;

SELECT field, reason, old_value, new_value
FROM public.audit_log
WHERE entity = 'tasks' ORDER BY timestamp_utc DESC LIMIT 10;
```

### US2 — Notificações

1. Pré-condições: 1 atendimento agendado para hoje + 1 tarefa com `due_date=hoje` minha + 1 tarefa com `due_date=ontem` minha + 1 paciente com `birth_date` no mês corrente.
2. Logue, abra qualquer página do dashboard.
3. **Esperado** (sininho na topbar): badge com número de não lidas; **vermelho** porque há `tarefa_atrasada`.
4. Clique no sininho → vai para `/operacao/notificacoes`. Vê 4 itens:
   - "Atendimento às HH:MM com Dr. ..."
   - "Lembrete: 'minha task de hoje' precisa ser concluída hoje"
   - "Atenção: 'minha task de ontem' está pendente desde ..."
   - "Aniversariantes de [mês]: João (dia 15), ..."
5. Clica num item não lido com `reference_type='appointment'` → marca como lido + navega para o atendimento.
6. Botão **Marcar todas como lidas** → todos viram lidas; sininho some o badge.
7. Recarregue a página → **não duplica** notificações (idempotência via RPC).

```sql
SELECT type, title, body, is_read, created_at
FROM public.notifications
WHERE user_id = '<userId>' ORDER BY created_at DESC LIMIT 20;

-- Confirma idempotência:
SELECT tenant_id, user_id, type, reference_key, count(*) AS dupes
FROM public.notifications
GROUP BY 1,2,3,4 HAVING count(*) > 1;
-- Esperado: 0 rows.
```

### US3 — Cadastro manual de usuário

1. Como admin em `/configuracoes/usuarios`, clique em **Cadastrar usuário** (botão novo ao lado de "Convidar").
2. Preencher:
   - Nome: `Dra. Ana`
   - Email: `ana@example.com`
   - Senha: `senha12345` (≥ 8)
   - Telefone: opcional
   - Função: `profissional_saude`
   - **Vincular a profissional**: marcar; selecionar a Dra. Ana (do tenant).
3. Salvar → usuário aparece na listagem com coluna "Profissional vinculado: Dra. Ana".
4. Logout, login com `ana@example.com` + `senha12345` → entra direto (sem etapa de confirmar email).
5. Volte como admin → cadastre outro usuário sem marcar vínculo: usuário aparece, mas listagem mostra aviso sutil "Sem profissional vinculado" se função = `profissional_saude`.

```sql
SELECT u.email, ut.role, d.full_name AS profissional_vinculado
FROM auth.users u
JOIN public.user_tenants ut ON ut.user_id = u.id
LEFT JOIN public.doctors d ON d.user_id = u.id AND d.tenant_id = ut.tenant_id
WHERE ut.tenant_id = '<tenantId>' ORDER BY ut.created_at DESC LIMIT 10;

-- Verifica unicidade do vínculo:
SELECT tenant_id, user_id, count(*) FROM public.doctors
WHERE user_id IS NOT NULL GROUP BY 1,2 HAVING count(*) > 1;
-- Esperado: 0 rows.
```

---

## Rollback (somente dev)

```sql
DROP TRIGGER IF EXISTS tasks_audit ON public.tasks;
DROP TRIGGER IF EXISTS tasks_immutable_columns ON public.tasks;
DROP TRIGGER IF EXISTS tasks_no_physical_delete ON public.tasks;
DROP FUNCTION IF EXISTS public.audit_tasks_change();
DROP FUNCTION IF EXISTS public.enforce_tasks_mutation();

DROP TRIGGER IF EXISTS notifications_immutable_columns ON public.notifications;
DROP TRIGGER IF EXISTS notifications_no_physical_delete ON public.notifications;
DROP FUNCTION IF EXISTS public.enforce_notifications_mutation();
DROP FUNCTION IF EXISTS public.generate_user_notifications(UUID, UUID);

DROP TRIGGER IF EXISTS doctors_user_link_audit ON public.doctors;
DROP FUNCTION IF EXISTS public.audit_user_doctor_link();
DROP INDEX IF EXISTS public.doctors_user_id_unique_idx;
ALTER TABLE public.doctors DROP COLUMN IF EXISTS user_id;

DROP TABLE IF EXISTS public.notifications;
DROP TABLE IF EXISTS public.tasks;
```

> **NÃO** aplicar em ambiente de produção; viola Constitution §"Migrações de banco".

---

## Critério de pronto

- [ ] Migration `0078_tasks_notifications_user_link.sql` aplica e remove (em dev) sem erro.
- [ ] `pnpm typecheck` ✅
- [ ] `pnpm lint:auth` ✅ (rotas novas usam `requireRole`)
- [ ] `pnpm test` ✅ (todos os arquivos listados em `plan.md > tests/`)
- [ ] Smoke manual de US1, US2, US3 reproduzível com os passos acima.
- [ ] Sininho exibe badge vermelho quando há atrasada; azul quando não.
- [ ] Sidebar mostra "Notificações" em vez de "Alertas"; `/operacao/alertas` continua acessível via sub-item ou link.
- [ ] Usuário criado manualmente loga imediato sem confirmar email.
- [ ] RLS verificável: tenants/usuários distintos não veem dados de outros (testes de isolamento verdes).
