# Quickstart — Smoke Test Manual

**Feature**: 019 — Prontuário Clínico unificado (Timeline + Quick-View)
**Audience**: Desenvolvedor validando a feature localmente antes do PR.

## Pré-requisitos

- Docker rodando (Supabase local stack)
- `pnpm install` executado
- Node 20 LTS

## Setup

```powershell
# Stack Supabase local (porta 54321)
supabase start

# Resetar DB + aplicar todas migrations
pnpm supabase:reset

# Gerar tipos (caso `Database` esteja desatualizada)
pnpm supabase:gen-types

# Iniciar dev server
pnpm dev
```

Abrir `http://localhost:3000` e fazer login com o usuário seed (verificar `.env.local` para credenciais — geralmente `admin@prontool.local`).

---

## Roteiro de validação (cenários da spec.md)

### Cenário 1 — US1 P1: contexto sempre visível

**Setup**:

1. Criar paciente "Maria Teste 1" via `/operacao/pacientes/novo`.
2. Adicionar:
   - 1 alergia "Penicilina" severidade `grave`
   - 1 antecedente "Hipertensão"
   - 1 diagnóstico CID I10 status `ativo`
   - 1 diagnóstico CID E11 status `em_acompanhamento`
   - 1 medição de sinais vitais (PA 140x90, FC 78, peso 80kg, altura 175)
   - 1 atendimento concluído com pagamento `paid`
   - 1 evolução SOAP

**Validar**:

- [ ] Abrir a ficha → layout em 2 colunas em desktop (≥768px).
- [ ] Sidebar mostra: avatar, idade, CPF, telefone com botão WhatsApp, email, plano, chip "Penicilina · Grave" vermelho, chips "I10" e "E11" (com E11 badge sutil de "Acompanhamento"), última medição vital com IMC e classificação, resumo financeiro (recebido > 0), botões de ação respeitando RBAC.
- [ ] Rolar a página até o final da timeline → sidebar permanece visível (sticky).
- [ ] CID `resolvido` (criar um terceiro: J03 resolvido) NÃO aparece na sidebar mas aparece na timeline.

### Cenário 2 — US1: bloco vazio é omitido

**Setup**: Criar paciente "João Sem Alergias" sem nenhuma alergia.

**Validar**:

- [ ] Sidebar **não** renderiza o bloco "Alergias" (não mostra "Nenhuma alergia").
- [ ] Idem para diagnósticos, vitais, financeiro.

### Cenário 3 — US1: paciente anonimizado

**Setup**: Em uma ficha existente, clicar em "Anonimizar paciente" (botão admin).

**Validar**:

- [ ] Sidebar mostra **apenas** o card de aviso de anonimização.
- [ ] Timeline mostra apenas eventos `appointment` e `payment` (não anamneses, evoluções, vitais, arquivos, textos).

### Cenário 4 — US2 P2: sheet preserva posição da timeline

**Setup**: Paciente com 10+ evoluções antigas.

**Validar**:

- [ ] Rolar até a 5ª evolução. Clicar em "Nova evolução" na sidebar.
- [ ] Sheet abre à direita; a timeline atrás **não muda de posição**.
- [ ] Preencher S e A; salvar.
- [ ] Sheet fecha. Nova evolução aparece no **topo** da timeline. Posição original de rolagem preservada.
- [ ] Abrir sheet de nova evolução. Pressionar `Esc` → sheet fecha sem salvar.
- [ ] Abrir sheet. Clicar no overlay (área cinza fora do painel) → fecha.

### Cenário 5 — US2: nova alergia atualiza sidebar sem reload

**Validar**:

- [ ] Clicar em "Nova alergia" → sheet.
- [ ] Cadastrar "Dipirona / moderada".
- [ ] Após salvar, sheet fecha e o chip "Dipirona · Moderada" aparece na sidebar sem reload (via `router.refresh()`).

### Cenário 6 — US3 P2: filtros

**Validar**:

- [ ] Timeline tem chips: Tudo, Evoluções, Anamneses, Exames/Anexos, Sinais vitais, Atendimentos, Pagamentos.
- [ ] Cada chip mostra contagem entre parênteses.
- [ ] Clicar em "Evoluções" → só evoluções SOAP visíveis.
- [ ] Clicar em "Sinais vitais" → só medições; aparece toggle "Lista | Gráfico" (R7).
- [ ] Em "Gráfico", aparece `LineChart` (reuso do componente existente).
- [ ] Aplicar filtro que resulta em 0 eventos (ex.: paciente sem anamneses) → mensagem "Nenhum evento neste filtro" + botão "Limpar filtro".

### Cenário 7 — Aba "Cadastro"

**Validar**:

- [ ] Coluna direita tem 2 abas no topo: "Clínico" (padrão) e "Cadastro".
- [ ] Clicar em "Cadastro" → URL muda para `?tab=cadastro`. Mostra `<AddressEditor>`, opt-in lembretes, plano de saúde, plano terapêutico.
- [ ] Editar endereço e salvar → permanece na aba "Cadastro".
- [ ] Botão "Editar" na sidebar (no bloco Identidade) → leva para `?tab=cadastro`.
- [ ] Recarregar a página com `?tab=cadastro` → abre direto na aba Cadastro (deep-link).

### Cenário 8 — US4 P3: mobile responsivo

**Setup**: DevTools → toggle device toolbar → iPhone 13 (375x812).

**Validar**:

- [ ] Layout single-column.
- [ ] Topo: header compacto com avatar+nome+idade.
- [ ] Botão "Ver detalhes do paciente" expande os blocos da quick-view.
- [ ] Se paciente tem alergia `grave`, o header compacto mostra ícone vermelho de alerta (R9).
- [ ] Barra fixa no rodapé com 4 botões de ação (Nova evolução, Anamnese, Vital, Imprimir).
- [ ] Rolar timeline → barra do rodapé permanece visível.

### Cenário 9 — Edge case: trocar paciente com sheet aberto

**Validar**:

- [ ] Abrir paciente A, abrir sheet "Nova evolução".
- [ ] Sem fechar o sheet, clicar em "Voltar para pacientes" → ir para paciente B.
- [ ] Sheet fechado automaticamente (não persiste entre rotas).

### Cenário 10 — Edge case: RBAC

**Setup**: Logar como `recepcionista`.

**Validar**:

- [ ] Sidebar não mostra botões "Nova evolução", "Registrar vital", "Novo diagnóstico" (FR-028).
- [ ] Botão "Imprimir prontuário" continua disponível (recepcionista pode imprimir? — validar contra `can(role, 'print.chart')`; se não tem, esconder).
- [ ] Tentar acessar endpoint diretamente (cURL com cookie de recepcionista contra `/api/pacientes/X/registros` POST) → HTTP 403 (server-side gate).

### Cenário 11 — Edge case: failures card de admin

**Setup**: Forçar erro em uma das fontes (ex.: revogar grant em `vital_signs` temporariamente).

**Validar**:

- [ ] Como admin, ver o failures card no topo com a seção que falhou.
- [ ] Outras seções continuam renderizando normalmente.
- [ ] Restaurar grant.

### Cenário 12 — A11y: navegação por teclado

**Validar**:

- [ ] `Tab` percorre: voltar → editar identidade → botões de contato (WhatsApp etc.) → chips de alergia → chips de CID → botões de ação → tabs Clínico/Cadastro → chips de filtro → itens da timeline.
- [ ] `Enter`/`Space` num item da timeline expande/colapsa.
- [ ] `Esc` num item expandido colapsa todos.
- [ ] Sheet aberto: `Tab` cicla dentro do sheet (focus trap); `Esc` fecha; foco retorna ao botão que abriu.

---

## Checks finais

```powershell
# Type-check
pnpm typecheck

# Lint (RBAC + adapters)
pnpm lint:auth

# Suite completa
pnpm test

# Apenas testes da feature
pnpm test src/lib/core/patient-timeline
pnpm test src/app/operacao/pacientes
```

**Critérios para PR-ready**:

- ✅ Todos os cenários acima passam
- ✅ `pnpm typecheck` sem erros novos
- ✅ `pnpm test` verde
- ✅ Bundle size delta razoável (`<10kb gzipped` somando os componentes novos)

---

## Como reverter

Esta feature é UX-only. Para reverter:

```powershell
git checkout master
# ou
git revert <commit-hash>
```

Não há migration para rollback. Não há configuração de feature flag necessária (a feature ativa-se com o merge porque substitui o layout — se quiser fazer rollout gradual, encapsular o novo layout atrás de uma variável de ambiente `PRONTUARIO_TIMELINE_ENABLED` é trivial e está documentado em `tasks.md` como task opcional).
