# Quickstart — Sidebar enxuta + Configurações como hub

**Feature**: `014-sidebar-config-hub`
**Branch**: `014-sidebar-config-hub`
**Date**: 2026-05-18

Como rodar localmente e validar a feature na ponta — fluxo completo em ~10 minutos.

---

## Pré-requisitos

- Node 20 LTS + pnpm
- Docker rodando (para `supabase start`)
- Variáveis de ambiente locais já configuradas (`.env.local`)

---

## 1. Subir o stack local

```bash
# Em um terminal: stack local do Supabase
pnpm supabase:reset    # aplica todas as migrations e seeds
supabase start          # se ainda não estiver rodando — porta 54321

# Em outro terminal: dev server Next.js
pnpm dev                # http://localhost:3000
```

> Esta feature **não introduz migrations** — `supabase:reset` é só para garantir que o banco está consistente com `main`.

---

## 2. Validar US1 — Sidebar enxugada

1. Acesse `http://localhost:3000` e faça login com um usuário **admin** (seed padrão).
2. Olhe a sidebar (lado esquerdo no desktop; drawer no mobile via botão hamburger).
3. **Esperado**:
   - Seção **Operação**: Agenda, Pacientes, Tarefas (3 itens).
   - Seção **Análise**: Relatórios, Comissões, Despesas (3 itens, conforme feature flags ligadas).
   - Separador visual.
   - Item único **Configurações** com ícone de engrenagem (`Settings` ou `Cog`).
   - **NÃO existem mais**: Notificações, Alertas do sistema, Pendências, Auditoria.
4. Repita o login com cada outro role disponível (financeiro, recepcionista, profissional_saude) e verifique que cada um vê o subconjunto correto pelo RBAC.

---

## 3. Validar US2 — Sininho + página unificada de notificações

1. Logado como **admin**, clique no ícone de sininho na topbar (canto superior direito).
2. **Esperado**: navega para `/operacao/notificacoes`.
3. No topo da página, observe a **tab bar** com 3 abas: "Notificações", "Alertas do sistema", "Pendências".
4. Click em cada aba e confirme que:
   - URL muda para `?tab=notificacoes`, `?tab=alertas`, `?tab=dlq` respectivamente.
   - O conteúdo de cada aba é equivalente ao que existia em `/operacao/notificacoes`, `/operacao/alertas`, `/operacao/dlq` antes da feature.
   - Ações (marcar como lido, resolver alerta, reprocessar item DLQ) continuam funcionando.
5. **Logado como recepcionista**: a tab bar deve mostrar apenas "Notificações". Acesse `http://localhost:3000/operacao/notificacoes?tab=alertas` manualmente e confirme que a página renderiza a aba de notificações (fallback silencioso), sem erro 403 ou banner.
6. **Teste de rotas legadas** (qualquer role com permissão):
   - `curl -I http://localhost:3000/operacao/alertas` → deve retornar `308` com `Location: /operacao/notificacoes?tab=alertas`.
   - `curl -I http://localhost:3000/operacao/dlq` → idem para `?tab=dlq`.

---

## 4. Validar US3 — Hub de configurações

1. Logado como **admin**, clique em "Configurações" na sidebar.
2. **Esperado**: navega para `/configuracoes` (sem mais redirect automático para `/configuracoes/clinica`).
3. Veja um grid de **9 cards** na ordem fixa:
   1. Clínica
   2. Meu Perfil
   3. Usuários
   4. Procedimentos
   5. Convênios
   6. Profissionais
   7. Modelos de Anamnese
   8. Integrações
   9. Auditoria (sempre o último)
4. Click em cada card e confirme que leva à página correta (mesma página de antes, exceto Auditoria que agora mora em `/configuracoes/auditoria`).
5. **Logado como recepcionista** (ou outro role não-admin): abra `/configuracoes` e confirme que vê **apenas** os cards permitidos pelo RBAC (no mínimo "Meu Perfil"). Nenhum card de área restrita aparece.
6. **Responsividade**: redimensione a janela do browser:
   - Largura <md (≈ <768 px): grid em 1 coluna.
   - md (≥768 px e <lg): grid em 2 colunas.
   - lg+ (≥1024 px): grid em 3 colunas.

---

## 5. Validar US4 — Rotas legadas continuam funcionando

```bash
# Auditoria: rota antiga vira 308 para a nova
curl -I http://localhost:3000/analise/auditoria
# Esperado: HTTP/1.1 308 Permanent Redirect
#           Location: /configuracoes/auditoria

# Auditoria com query string preservada
curl -I 'http://localhost:3000/analise/auditoria?from=2026-01-01&to=2026-01-31'
# Esperado: HTTP/1.1 308
#           Location: /configuracoes/auditoria?from=2026-01-01&to=2026-01-31

# Alertas
curl -I http://localhost:3000/operacao/alertas
# Esperado: HTTP/1.1 308
#           Location: /operacao/notificacoes?tab=alertas

# DLQ
curl -I http://localhost:3000/operacao/dlq
# Esperado: HTTP/1.1 308
#           Location: /operacao/notificacoes?tab=dlq
```

> No PowerShell substitua `curl -I` por `Invoke-WebRequest -Method HEAD <url> -MaximumRedirection 0`.

---

## 6. Rodar a suíte de testes

```bash
pnpm typecheck                                   # zero erros TS
pnpm test                                        # vitest completo
pnpm test tests/unit/dashboard-shell-sections    # sidebar role × itens
pnpm test tests/integration/configuracoes-hub    # hub RBAC
pnpm test tests/integration/notificacoes-tabs    # tabs por permissão
pnpm test tests/integration/legacy-route-redirects  # 308 redirects
pnpm lint:auth                                   # adapters sem env direto + requireRole em /api/*
```

**Esperado**: tudo verde.

---

## 7. Smoke test final (manual, dashboard completo)

Como admin:
- Login → ver sidebar enxuta → clicar em Agenda, Pacientes, Tarefas, Relatórios, Comissões, Despesas, Configurações.
- No hub, clicar em cada um dos 9 cards e confirmar carga sem erro.
- Voltar via "Trocar clínica" se for multi-tenant.
- Click no sininho → tab bar → cada aba.
- Verificar console do browser: zero warnings/errors novos.

---

## Troubleshooting

- **Vejo a sidebar antiga ainda**: hard refresh (Ctrl+Shift+R) — o Next.js pode estar com cache do RSC payload. Em último caso, limpe `.next/`.
- **Card "Auditoria" não aparece para admin**: confirme que o role do seed admin tem `audit.read` via `pnpm supabase:reset`. RBAC é a fonte da verdade.
- **`/analise/auditoria` retorna 200 em vez de 308**: o Next.js dev server às vezes serve a página antes do redirect compilar; reinicie `pnpm dev`.
- **Tabs em `/operacao/notificacoes` não trocam ao clicar**: verifique que cada tab é um `<Link>` (não `<a>` puro) — Next.js precisa do `Link` para SSR correto.

---

## Definition of Done (resumo)

- [ ] Sidebar mostra exatamente 3 + 3 + 1 itens para admin.
- [ ] Sininho → `/operacao/notificacoes` com tab bar RBAC-filtered.
- [ ] `/configuracoes` é hub com 9 cards (admin); ordem fixa; auditoria por último.
- [ ] `/configuracoes/auditoria` existe e renderiza auditoria.
- [ ] `/analise/auditoria`, `/operacao/alertas`, `/operacao/dlq` → 308 com query strings preservadas.
- [ ] Testes vitest verdes; `typecheck` limpo; `lint:auth` limpo.
- [ ] Smoke test manual completo sem warnings/errors no console.

Pronto para PR.
