# Quickstart — Odontograma Interativo (Fase 1)

Como validar a feature ponta a ponta em dev.

## Pré-requisitos

```bash
supabase start            # stack local :54321 (Docker)
pnpm supabase:reset       # aplica migrations incl. 0134_odontogram.sql (semeia o catálogo)
pnpm seed:demo            # dados de demonstração (tenant, paciente, atendimento)
pnpm dev
```

> ⚠️ `vitest`/`pnpm test` apagam o banco local (resetDatabase). Não rodar testes durante teste manual; re-seedar com `pnpm seed:demo` depois.

## Fluxo 1 — Registrar e visualizar (US1, P1)

1. Login como `admin` ou `profissional_saude`.
2. Abrir um paciente: `/operacao/pacientes/<id>` → aba **Odontograma**.
3. Carta dentária renderiza dentes permanentes; todos em "sem registro" (neutro).
4. Selecionar **Cárie** na paleta → clicar na face oclusal do dente 16 → a face fica vermelha imediatamente.
5. Selecionar **Ausente** → clicar no dente 38 → o dente inteiro reflete "ausente".
6. Alternar para dentição **decídua** e marcar um dente 55.
7. Recarregar a página → todas as marcações persistem com as cores corretas (SC-002).
8. Selecionar **Sem registro** → clicar na face oclusal do 16 → volta ao neutro (novo evento, histórico preservado).

## Fluxo 2 — Administrar catálogo (US2, P2)

1. Login como **super-admin** (`operations@homio.com.br` / `clinnipro@gmail.com`).
2. `/admin/catalogo/status-odontologicos`.
3. Criar status **"Mancha branca"** (scope `face`, cor `#fbbf24`) → salvar.
4. Voltar ao odontograma de um paciente → "Mancha branca" aparece na paleta de faces (sem novo deploy — SC-004).
5. Desativar **"Coroa"** → some das opções de novas marcações; marcações antigas com "Coroa" continuam exibidas (FR-013).
6. Como usuário não super-admin, acessar `/admin/catalogo/status-odontologicos` → bloqueado (FR-011).

## Fluxo 3 — Vínculo a atendimento e auditoria (US3, P3)

1. A partir de um atendimento, registrar marcação com `appointmentId`.
2. Conferir em `audit_log` (via SQL local) a entrada `entity='dental_chart_entries'`, `field='created'`, com `actor_id` e `tenant_id`.
3. Tentar `UPDATE`/`DELETE` direto em `dental_chart_entries` → rejeitado pelo trigger append-only (SC-005).

## Testes automatizados

```bash
pnpm test:contract       # imutabilidade do catálogo (code/is_system) + append-only entries
pnpm test:integration    # isolamento entre tenants + RBAC por papel
pnpm lint:auth           # rotas /api/* com requireRole/requireSuperAdmin; sem env direto
pnpm typecheck
```

Casos-chave a cobrir:

- **Tenant isolation**: paciente do tenant B não retorna marcações do tenant A (RPC + RLS).
- **RBAC**: `recepcionista` não consegue POST de marcação; não super-admin não acessa catálogo admin.
- **Append-only**: UPDATE/DELETE em `dental_chart_entries` falha (42501).
- **Escopo↔surface**: status `tooth` com `surface` preenchida → 422; status `face` sem surface → 422.
- **Catálogo desativado**: status inativo não aparece na paleta mas marcação histórica renderiza.
- **FDI inválido**: `toothFdi=99` → 400.

## Verificação visual

`pnpm dev` → odontograma renderiza nítido em diferentes zooms (SVG), faces individualmente clicáveis, foco navegável por teclado com `aria-label` (dente + face + status).
