# Quickstart — Validação Local da Feature 025

**Feature**: 025-agenda-sheet-modal
**Status**: Phase 1 complete
**Date**: 2026-05-25

> **Por que existe**: o incidente do commit revertido `f1c08c4` provou que `pnpm typecheck` + `pnpm lint:auth` passam mas a app quebra em produção. Esta checklist é a defesa mínima antes de qualquer push para `master`.

## Pré-requisitos

```powershell
# 1. Supabase local de pé (Docker)
supabase start

# 2. Migrations aplicadas
pnpm supabase:reset

# 3. Tipos do banco regenerados (caso migrations novas)
pnpm supabase:gen-types

# 4. Dev server
pnpm dev
```

Login com um usuário admin de teste para ter acesso a todas as ações.

## Roteiro de validação manual

Antes de mergear, rode estes 8 fluxos em sequência. Marque cada um.

### 1. Abrir painel a partir da lista

- [ ] Acessar `http://localhost:3000/operacao/atendimentos`
- [ ] Aplicar um filtro (profissional + período) e rolar a página
- [ ] Clicar numa linha de atendimento
- [ ] **Esperado**: painel lateral desliza da direita; loading aparece em <300ms; dados completos chegam em <2s; URL **não muda**

### 2. Fechar painel preserva filtros e scroll

- [ ] Com o painel da etapa 1 aberto, fechar via X
- [ ] **Esperado**: filtros aplicados continuam ativos, scroll vertical inalterado
- [ ] Repetir com tecla ESC → mesmo comportamento
- [ ] Repetir com click no overlay (área escura) → mesmo comportamento

### 3. Confirmar agendamento

- [ ] Abrir painel de um atendimento status `agendado`
- [ ] Clicar "Confirmar agendamento"
- [ ] **Esperado**: status no painel muda para "confirmado" (sem fechar o painel); badge da linha na agenda subjacente também atualiza; sem F5 manual

### 4. Cancelar com motivo

- [ ] Abrir painel de um atendimento status `ativo` ou `confirmado`
- [ ] Selecionar motivo + digitar observação
- [ ] Clicar "Cancelar atendimento"
- [ ] **Esperado**: painel mostra novo status; agenda atualiza; painel permanece aberto

### 5. Guard de formulário sujo — fechar

- [ ] Abrir painel de um atendimento `ativo`
- [ ] Digitar texto na observação de cancelamento (sem enviar)
- [ ] Apertar ESC
- [ ] **Esperado**: `window.confirm("Descartar alterações não salvas?")` aparece
- [ ] Cancelar o confirm → painel permanece aberto com o texto digitado
- [ ] Apertar ESC de novo + aceitar o confirm → painel fecha

### 6. Guard de formulário sujo — trocar atendimento

- [ ] Repetir setup da etapa 5 (texto digitado, sem enviar)
- [ ] Clicar em OUTRO atendimento na lista (sem fechar o painel atual)
- [ ] **Esperado**: confirm aparece; ao cancelar, painel atual permanece; ao aceitar, painel troca para o novo atendimento

### 7. Não-regressão de rotas literais irmãs

- [ ] Acessar `http://localhost:3000/operacao/atendimentos/novo` direto na barra de URL
- [ ] **Esperado**: abre o form de criação de atendimento (sem erro 500, sem mensagem "Atendimento não encontrado")
- [ ] Acessar `http://localhost:3000/operacao/atendimentos/bloquear` direto
- [ ] **Esperado**: abre form de bloqueio de horário
- [ ] Acessar `http://localhost:3000/operacao/atendimentos/calendar` direto
- [ ] **Esperado**: abre visualização de calendário

### 8. Deep-link da página standalone

- [ ] Copiar um UUID de atendimento da agenda
- [ ] Acessar `http://localhost:3000/operacao/atendimentos/<UUID>` direto na barra
- [ ] **Esperado**: abre a página standalone tradicional, full-width, com botão "Voltar"
- [ ] F5 nessa página
- [ ] **Esperado**: dados recarregam sem erro

### 9. Calendário também abre o painel

- [ ] Acessar `/operacao/atendimentos/calendar` (ou alternar para visualização calendário)
- [ ] Clicar num bloco de atendimento
- [ ] **Esperado**: painel abre exatamente como na lista, mesmos dados

### 10. Middle-click / Ctrl+click respeitados

- [ ] Na lista, segurar Ctrl e clicar num atendimento
- [ ] **Esperado**: abre nova aba na URL `/operacao/atendimentos/<UUID>` (página standalone)
- [ ] Mesma coisa com middle-click do mouse → nova aba

### 11. Mobile fullscreen

- [ ] DevTools → Toggle device toolbar → iPhone SE (375px)
- [ ] Clicar num atendimento da lista
- [ ] **Esperado**: painel ocupa a tela inteira; ao fechar, volta para a lista

## Validações automatizadas (rodar antes do push)

```powershell
pnpm typecheck         # 0 errors
pnpm lint              # 0 errors
pnpm lint:auth         # OK
pnpm test              # suites passam (especificamente atendimentos-*)
```

## Se algo quebrar

- **Application error: a server-side exception**: olhe os runtime logs da Vercel filtrados por `level:error`. Procure por:
  - `supabase-service.ts may only be imported from...` → algum componente do painel está importando `createSupabaseServiceClient` indevidamente. Revisar tudo em `_components/` — só `fetch` permitido.
  - `invalid input syntax for type uuid: "novo"` → algum lugar está tratando `/novo`/`/bloquear` como UUID. Verificar se algum loader server-side foi adicionado erroneamente nessas rotas.
- **Painel não abre**: verificar `data-appointment-id` nos `<Link>`s da lista/calendar e o event listener do `AppointmentDetailHost`.
- **Agenda não atualiza após ação**: verificar se os forms ainda chamam `router.refresh()`.

## Critério de aceite para merge

Todas as 11 etapas marcadas + os 4 comandos automatizados verdes.
