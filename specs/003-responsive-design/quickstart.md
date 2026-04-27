# Quickstart — Validação da Responsividade

Este documento descreve **como verificar** que a feature está completa e
correta. Combina inspeção manual com testes automatizados.

## Pré-requisitos

- Branch `003-responsive-design` checked out
- `pnpm dev` rodando em http://localhost:3000
- Supabase local stack rodando (`pnpm supabase:start`) ou apontando pra prod

## Passo 1 — Validação manual em 3 viewports

Abrir DevTools (Chromium recomendado) e testar nos viewports abaixo. Cada
linha é um cenário derivado dos User Stories da spec.

### Viewport 360×640 (iPhone SE 1ª gen)

- [ ] **US1 #1** — Logar e abrir `/operacao/pacientes`. Sidebar **NÃO** ocupa espaço horizontal — conteúdo usa 100% da largura.
- [ ] **US1 #2** — Botão hamburger (ícone de 3 linhas) visível no canto esquerdo do header.
- [ ] **US1 #3** — Tocar no hamburger: drawer desliza da esquerda cobrindo até 80% da viewport, com overlay semi-transparente atrás.
- [ ] **US1 #4** — Tocar fora do drawer (na área overlay): drawer fecha.
- [ ] **US1 #5** — Reabrir drawer + tocar em "Cadastros" → drawer fecha automaticamente e navega.
- [ ] **US1 #6** — Em `/cadastros/precos` (categoria com 6 abas: Tabelas / Procedimentos / Planos / Profissionais / Despesas / Modelos de Anamnese), tab bar permite scroll horizontal por swipe — nenhuma aba cortada.
- [ ] **US1 #7** — Em `/cadastros/anamnese`, a aba "Modelos de Anamnese" (a ativa) está visível ao carregar a página, sem precisar scrollar manualmente.
- [ ] **US1 #8** — Em `/operacao/pacientes/novo`, todos os campos do form ficam empilhados em coluna única, ocupando 100% da largura.
- [ ] **FR-013** — Em `/operacao/pacientes/[id]`, abrir modal "Limpar dados". Modal não escapa da viewport. Botões Cancelar/Confirmar visíveis sem precisar scrollar fora.
- [ ] **FR-018** — Header da ficha do paciente: botões Voltar / Imprimir / Limpar dados visíveis (empilhados ou wrap), nenhum cortado.

### Viewport 768×1024 (iPad portrait)

- [ ] **US3 #1** — Sidebar permanente visível à esquerda (256px). Sem hamburger.
- [ ] **US2 #1** — Abrir modal "Imprimir prontuário" em uma ficha de paciente com muitos dados. Conteúdo do modal scrolla internamente; background não scrolla.
- [ ] **FR-016** — Em `/operacao/atendimentos`, tabela exibe scroll horizontal se conteúdo exceder largura.
- [ ] **FR-017** — Quando há scroll horizontal disponível, gradient/sombra visível na borda direita (e à esquerda quando scrolla para o meio).

### Viewport 1280×720 (desktop padrão)

- [ ] **US3 #1** — Layout idêntico ao estado anterior à feature. Comparação lado-a-lado de screenshots não mostra diferenças visuais perceptíveis.
- [ ] **US3 #2** — Tabelas largas (até 7 colunas) cabem sem scroll horizontal.
- [ ] **US3 #3** — Dashboards (`/analise/relatorios`) mostram grids de 3-4 colunas como antes.
- [ ] **FR-022** — Smoke test (`tests/e2e/smoke-flow.spec.ts`) passa sem mudanças.

## Passo 2 — Testes automatizados

```bash
# Lint + typecheck (regression rápida)
pnpm typecheck
pnpm lint
pnpm lint:auth

# Smoke flow (não-regressão funcional)
pnpm test:e2e tests/e2e/smoke-flow.spec.ts

# Snapshots de regressão visual @ 1280×720
pnpm test:e2e tests/e2e/responsive-snapshots.spec.ts
```

**Esperado**: smoke flow passa; snapshots @1280px batem com baseline (zero
diffs além de threshold de antialiasing).

## Passo 3 — Validação de acessibilidade básica

- [ ] **FR-020** — Botão hamburger tem `aria-label` ("Abrir menu" ou similar). Verificar via DevTools → Accessibility tree.
- [ ] **FR-021** — Com drawer aberto, pressionar Tab: foco fica preso dentro do drawer (não vai para conteúdo atrás). Pressionar Esc: drawer fecha + foco volta para o botão hamburger.
- [ ] Teste com leitor de tela (opcional): NVDA/VoiceOver anuncia "Navegação, modal, aberto" ao abrir o drawer.

## Passo 4 — Cross-browser (sanity)

- [ ] Chrome/Edge — desktop e DevTools mobile emulation
- [ ] Firefox — desktop
- [ ] Safari iOS (real device ou Simulator) — drawer + scroll de tabs
- [ ] (Opcional) Samsung Internet em Android — gesture de swipe

## Critérios de pronto

A feature está pronta para merge quando:

1. Todos os checkboxes deste documento estão marcados.
2. `pnpm typecheck && pnpm lint && pnpm lint:auth` retorna 0.
3. Smoke flow passa.
4. Snapshots de regressão visual @1280×720 batem com baseline (zero diffs).
5. SC-001..SC-008 da spec verificáveis manualmente.
6. PR review por pelo menos 1 mantenedor (constituição §3 — Revisão).

## Rollback

Se qualquer regressão crítica aparecer em produção:

```bash
git revert <merge-commit-sha>
git push origin master
```

Como a feature é puramente de UI (sem migrations, sem mudanças de banco,
sem APIs novas), rollback é trivial e seguro a qualquer momento.
