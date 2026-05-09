# Quickstart — Multi-Tenant Lifecycle, GHL Binding e Filtros do Calendário

**Feature**: 010-multi-tenant-ghl-calendar
**Audience**: dev validando localmente que a feature funciona ponta-a-ponta.
**Prerequisites**: Docker rodando + `pnpm` + Supabase CLI + ambiente `.env.local` configurado.

---

## 1. Subir o stack local

```bash
supabase start
pnpm install
pnpm supabase:reset                 # aplica migrations 0001..0065
pnpm dev                            # http://localhost:3000
```

Confirme que `0065_active_tenant_and_signup.sql` apareceu no log do reset.

---

## 2. US1 — GHL 1:1 binding (P1)

Pré-requisito: dois tenants prontos (use `seedTenant` × 2 + `seedUser admin` para cada). Crie via console SQL ou via teste integration.

### Caminho feliz

1. Conecte o tenant A via OAuth manual à sub-account X (siga o fluxo da feature 008).
2. Em `/configuracoes/integracoes/ghl` (na sessão do admin de A), confirme que aparece "Conta: <nome de X> · ID: <X.location_id> · Conectada em <data>".

### Violação FR-001 (mesma clínica, segunda conexão)

3. Ainda como admin de A (já conectado a X), clique em "Conectar ao GoHighLevel" novamente.
4. Esperado: mensagem **"Esta clínica já está conectada a outra conta GoHighLevel. Desconecte primeiro."** — sem nenhum side effect na linha existente.
5. Confirme em `audit_log` (via /analise/auditoria ou SQL) uma linha com `field='connect.rejected:ghl_tenant_already_connected'`.

### Violação FR-002 (sub-account já vinculada a outra clínica)

6. Logue como admin do tenant B. Inicie OAuth para a mesma sub-account X.
7. Esperado: callback rejeita com **"Esta conta GoHighLevel já está vinculada a outra clínica no Prontool."**
8. Confirme audit em B com `field='connect.rejected:ghl_location_already_bound'`.

### Marketplace install para sub-account já vinculada

9. Simule um webhook install para a sub-account X (curl com HMAC válido) — payload finge criar uma terceira clínica.
10. Esperado: webhook responde **HTTP 409**; nenhum tenant novo é criado; audit registra a tentativa com `tenant_id=NULL`.

### Disconnect libera ambos os lados

11. Como admin de A, clique "Desconectar" em /configuracoes/integracoes/ghl.
12. Tente novamente o passo 6 (admin de B conectar a X) — agora deve passar.

---

## 3. US2 — Signup + Onboarding (P2)

### Signup

1. Vá para `/login` e clique no link "Não tem conta? Criar conta".
2. Em `/registrar`, preencha: nome `Maria Tester`, email novo `maria-test@local`, senha `senhaForte1`, confirma senha igual.
3. Confirme. Esperado: o sistema autentica e redireciona para `/onboarding`.

### Onboarding

4. Em `/onboarding`, preencha "Nome da clínica": `Clínica Sorriso`. O slug auto-preenche `clinica-sorriso`.
5. (Opcional) Preencha CNPJ `33.000.167/0001-01` e telefone.
6. Confirme. Esperado: o sistema cria o tenant, vincula você como admin, e redireciona para `/operacao/atendimentos` (semana atual, vazio).
7. Sidebar deve mostrar **"Clínica Sorriso"** no topo.

### E-mail duplicado

8. Volte a `/registrar` (deslogue) e tente cadastrar com o mesmo email `maria-test@local`.
9. Esperado: rejeição com mensagem genérica "Não foi possível criar a conta. Tente outro e-mail."

### Slug em colisão

10. Crie outra conta `joao-test@local`. No onboarding, force `slug = clinica-sorriso` (digitando manualmente).
11. Esperado: rejeição com sugestão `clinica-sorriso-2`.

### Acesso protegido sem tenant

12. Crie outra conta `paulo-test@local`. Após o signup, **antes** de completar o onboarding, tente acessar `/operacao/atendimentos` diretamente.
13. Esperado: redireciona para `/onboarding`.

---

## 4. US3 — Tenant selector + Switch + Sidebar tenant name (P3)

Pré-requisito: um usuário vinculado a 2+ tenants ativos. Use o seed:

```sql
-- supondo userId 'u1' e tenants 't1' (Clínica A) e 't2' (Clínica B)
INSERT INTO public.user_tenants(user_id, tenant_id, role, status)
VALUES ('u1', 't2', 'admin', 'active');
```

### Login multi-tenant

1. Logue como `u1`. Esperado: cai em `/selecionar-clinica`.
2. Veja dois cards: "Clínica A" e "Clínica B". Cada um mostra: logo (se houver), papel ("Administrador"), badge "GHL conectado" se aplicável, "Última usada" se houver.

### Selecionar clínica

3. Clique no card de "Clínica A". Esperado: cai em `/operacao/atendimentos` da Clínica A; sidebar mostra "Clínica A" no topo.

### Trocar clínica sem deslogar

4. No rodapé da sidebar (ao lado do bloco do usuário), veja o botão **"Trocar clínica"**.
5. Clique. Esperado: volta a `/selecionar-clinica`, agora com "Clínica A" destacada como atual.
6. Selecione "Clínica B". Esperado: redireciona ao dashboard da Clínica B sem reautenticar; sidebar atualiza para "Clínica B".
7. Abra DevTools → Network: verifique que `POST /api/auth/switch-tenant` retornou 200 e que houve um `refreshSession`. **Não há request a /auth/v1/token?grant_type=password**.

### Login single-tenant

8. Logue como um usuário com **apenas uma** clínica ativa. Esperado: cai direto no dashboard, sem passar pelo seletor.

### Edição do nome da clínica reflete na sidebar

9. Como admin da Clínica A, vá em `/configuracoes/clinica`, edite "Nome de exibição" para "Clínica A — Reformada", salve.
10. Esperado: sidebar reflete o novo nome no próximo SSR (próxima navegação).

### "Última clínica" sobrevive a relogin

11. Faça logout e login novamente como `u1` (multi-tenant).
12. Esperado: o seletor pré-marca a última clínica usada (ex.: a B se foi a última).

---

## 5. US4 — Calendário avançado (P4)

Pré-requisito: 30+ atendimentos espalhados em datas diferentes (use seed ou crie no /atendimentos).

### Mini-calendário

1. Em `/operacao/atendimentos`, veja o mini-calendário no canto esquerdo do header do calendário.
2. Dias com atendimento devem ter um marcador visual (ponto).
3. Clique em um dia. Esperado: o calendário principal navega para esse dia.

### Visualização Mês

4. No header, clique no botão "Mês".
5. Esperado: grid 7×5 (ou ×6); cada dia mostra até 3 chips de atendimento.
6. Em um dia com 4+ atendimentos, veja o chip "+N mais". Clique. Esperado: vai para `?view=dia&date=...`.

### Atalhos de período

7. Clique "Esta semana" → URL vira `?view=semana&date=hoje`.
8. Clique "Próximo mês" → URL `?view=mes&date=hoje+1mês`; calendário navega.

### Seleção de período por clique

9. Volte para `?view=mes`. Clique em um dia (digamos 03/05). Clique em outro (digamos 12/05).
10. Esperado: dias 03–12 ficam destacados (`bg-primary/10`); URL vira `?from=2026-05-03&to=2026-05-12`.

### Filtros combinados

11. Adicione `doctor=<UUID>` (via select), `status=cancelado` (via select), `patient=Mar` (via input).
12. Esperado: a contagem reduz consistente; URL reflete todos os filtros (query string com 5+ params).

### Compartilhamento via URL

13. Copie a URL atual. Cole em outra janela (incognito, mesmo usuário). Esperado: vê a mesma visão filtrada.

### Limpar filtros

14. Clique "Limpar". Esperado: URL volta a `/operacao/atendimentos`; calendário volta à semana atual sem filtros.

### Alternar Calendário ↔ Lista mantém filtros

15. Aplique filtros (ex.: `status=agendado`). Alterne para Lista. Esperado: filtros preservados.

---

## 6. Cross-cutting validations

- **RLS isolation**: relogue entre dois tenants; nenhuma página mostra dados do outro tenant em momento algum.
- **Auditoria**: depois das stories acima, em `/analise/auditoria` deve aparecer: signup do Maria, onboarding (criação de Clínica Sorriso), tenant_switch (várias), connect.rejected (US1).
- **Performance**: medir TTI da view Mês com 500 atendimentos seed: alvo < 1 s p95 (SC-007).

---

## 7. Comandos úteis

```bash
pnpm test                                # vitest full
pnpm test tests/integration/ghl-binding-rule.spec.ts
pnpm test tests/integration/signup-onboarding-flow.spec.ts
pnpm test tests/integration/switch-tenant-no-reauth.spec.ts
pnpm test tests/integration/auth-hook-active-tenant.spec.ts
pnpm test tests/unit/slug-generation.spec.ts
pnpm test tests/unit/calendar-filter-state.spec.tsx
pnpm typecheck
pnpm lint:auth
```

---

## 8. Rollback (dev)

```bash
pnpm supabase:reset
```

A migration 0065 é puramente aditiva e idempotente. Em produção, dropar a tabela `user_active_tenant` apaga preferências de "última clínica" mas não quebra nenhum fluxo (auth_hook cai no fallback "primeiro tenant ativo").
