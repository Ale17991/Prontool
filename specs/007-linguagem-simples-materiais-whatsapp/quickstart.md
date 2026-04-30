# Quickstart — Validação manual da Feature 007

**Date**: 2026-04-30
**Branch**: `007-linguagem-simples-materiais-whatsapp`

Roteiro de smoke test após implementação. Cobrir os 3 fluxos (Materiais P1, Linguagem P2, WhatsApp P3) e as gates de qualidade do projeto.

---

## Setup

```bash
# Reset do banco local com a nova migration aplicada
pnpm supabase:reset

# Confirmar que a migration 0061 está incluída no log
# Esperado: "Applied 0061_appointment_materials.sql"

# Sanity check do catálogo TUSS tabela 19
psql "$SUPABASE_DB_URL" -c "SELECT count(*) FROM public.tuss_codes WHERE tuss_table='19' AND valid_to IS NULL"
# Esperado: > 1000 códigos

# Subir o app
pnpm dev
# → http://localhost:3000
```

Login com usuário admin de tenant de teste (ver `supabase/seed.sql` ou similar).

---

## Fluxo 1 — Materiais (caminho feliz, US1)

1. Acessar `/operacao/atendimentos/novo`.
2. Preencher os campos obrigatórios: paciente, profissional, procedimento, plano (ou "Particular"), data/hora.
3. Localizar a seção **"Materiais utilizados (opcional)"** abaixo do procedimento. Confirmar que está **colapsada** por padrão.
4. Expandir a seção. Clicar em **"+ Adicionar material"**.
5. No typeahead, digitar `gaze`. Esperar resultados da TUSS tabela 19. Selecionar um item (ex.: `70000010 — GAZE ESTERIL 7,5x7,5cm`).
6. Confirmar que o item aparece na lista local com código, descrição e campo de quantidade (default `1`).
7. Alterar quantidade para `3`.
8. Clicar **"+ Adicionar material"** novamente, buscar `seringa`, selecionar `70000028 — SERINGA DESCARTAVEL 5ML` com quantidade `1`.
9. Clicar **Salvar**.
10. Esperar redirect ou toast de sucesso.
11. Abrir o atendimento criado (timeline do paciente ou link direto).
12. **Confirmar visualização**: card do atendimento mostra sub-bloco **"Materiais utilizados"** com:
    - `70000010 — GAZE ESTERIL 7,5x7,5cm — Qtd 3`
    - `70000028 — SERINGA DESCARTAVEL 5ML — Qtd 1`
13. Gerar PDF do prontuário (botão "Imprimir prontuário" em `/operacao/pacientes/[id]`).
14. **Confirmar PDF**: o atendimento aparece com sub-seção de materiais listando os dois itens.
15. **Audit log**: acessar `/operacao/auditoria` (admin) e confirmar 2 entradas `appointment_material.created` com timestamp recente.

✅ **Esperado**: tudo persistido, exibido em UI e PDF, com audit trail.

---

## Fluxo 2 — Materiais (caminho vazio)

1. Acessar `/operacao/atendimentos/novo`.
2. Preencher campos obrigatórios. **Não** expandir ou interagir com a seção de materiais.
3. Salvar.
4. Abrir o atendimento criado.
5. **Confirmar**: nenhuma sub-seção "Materiais utilizados" aparece (não exibir título com lista vazia).

Repetir o cenário expandindo a seção mas sem adicionar nenhum material. Mesmo resultado esperado.

✅ **Esperado**: sub-seção totalmente ausente quando o atendimento não tem materiais.

---

## Fluxo 3 — Materiais via etapa de plano

1. Em `/operacao/pacientes/[id]`, criar um plano de tratamento com uma etapa pendente para um procedimento qualquer.
2. Iniciar o fluxo de finalização da etapa (botão "Finalizar etapa" — observar que rotulo mudou de "Concluir etapa", parte da Feature 3).
3. Na tela/modal de confirmação, expandir "Materiais utilizados (opcional)" e adicionar 1 material.
4. Confirmar a finalização.
5. Verificar que o atendimento gerado pela etapa tem o material vinculado (passo 12 do Fluxo 1).

✅ **Esperado**: materiais ficam vinculados ao `appointment_id` que a etapa gerou; visíveis na visualização do atendimento.

---

## Fluxo 4 — Edge cases de Materiais

### 4.1. Quantidade inválida

1. Em `/operacao/atendimentos/novo`, adicionar um material e mudar quantidade para `0`.
2. Tentar salvar.
3. **Esperado**: validação inline "Quantidade deve ser um número inteiro maior que zero". Salvamento bloqueado.

### 4.2. Material duplicado

1. Adicionar duas vezes o mesmo código TUSS (ex.: gaze quantidade 2 e gaze quantidade 1).
2. Salvar.
3. **Esperado**: 2 linhas distintas em `appointment_materials`, exibidas separadamente na visualização.

### 4.3. Atendimento já cancelado não aceita materiais

1. Cancelar um atendimento existente (botão "Cancelar atendimento" — antes "Reverter atendimento").
2. Via `curl` direto:
   ```bash
   curl -X POST http://localhost:3000/api/atendimentos/{id}/materiais \
     -H "Cookie: sb-..." \
     -H "Content-Type: application/json" \
     -d '{"materiais":[{"tuss_code":"70000010","tuss_description":"...","quantity":1}]}'
   ```
3. **Esperado**: HTTP 409 com `{ error: { code: "APPOINTMENT_REVERSED", ... } }`.

### 4.4. RLS bloqueia tenant cruzado

1. Logar como usuário de tenant A.
2. Tentar GET para `/api/atendimentos/{id-de-tenant-B}/materiais`.
3. **Esperado**: HTTP 404 (não 403 — não vazar existência).

---

## Fluxo 5 — WhatsApp (US3)

### 5.1. Paciente com telefone

1. Acessar `/operacao/pacientes/[id]` de um paciente com telefone `(11) 98765-4321`.
2. Confirmar que o **botão verde "WhatsApp"** está visível ao lado dos dados de contato.
3. Clicar.
4. **Esperado**: nova aba abre com URL exata `https://wa.me/5511987654321`.

### 5.2. Paciente sem telefone

1. Acessar a ficha de um paciente sem telefone.
2. **Esperado**: botão "WhatsApp" visível mas **desabilitado** (aparência cinza).
3. Hover no botão.
4. **Esperado**: tooltip "Sem telefone cadastrado".
5. Clicar (mesmo desabilitado).
6. **Esperado**: nada acontece (nenhuma aba abre).

### 5.3. Telefone com prefixo internacional

1. Cadastrar paciente com telefone `+1 (415) 555-1234`.
2. Acessar a ficha.
3. Clicar no botão WhatsApp.
4. **Esperado**: URL `https://wa.me/14155551234` (sem `55` adicional, sem `+`).

---

## Fluxo 6 — Linguagem (US2)

### 6.1. Cancelar atendimento

1. Em `/operacao/atendimentos/`, abrir um atendimento ativo.
2. Abrir o menu de ações.
3. **Esperado**: item rotulado **"Cancelar atendimento"** (não "Reverter atendimento").
4. Cancelar.
5. **Esperado**: badge no atendimento mostra **"Cancelado"** (não "Estornado" nem "Revertido").

### 6.2. Atendimento agendado → realizado

1. Localizar um atendimento agendado.
2. Abrir menu de ações.
3. **Esperado**: ação **"Confirmar atendimento"** (não "Marcar como realizado").

### 6.3. Etapa de plano

1. Plano com etapa em aberto.
2. **Esperado**: botão **"Finalizar etapa"** (não "Concluir etapa").

### 6.4. Sem alergias

1. Paciente sem alergias cadastradas.
2. Abrir ficha.
3. **Esperado**: texto principal **"Sem alergias conhecidas"**. Tooltip ou texto secundário pode mencionar "NKDA" para profissionais.

### 6.5. Erro genérico

1. Forçar um erro (ex.: stop do supabase local + reload de uma página).
2. **Esperado**: tela de erro mostra:
   - Mensagem **"Algo deu errado. Tente novamente em alguns segundos."**
   - **Sem** `digest: ...`
   - **Sem** menção a "RPC", "API", "webhook", "schema cache", "tenant"
3. Conferir log do servidor (`pnpm dev` console ou Pino output): o `digest` técnico **está** presente no log do servidor.

### 6.6. Pendências (antes "DLQ")

1. Como admin, acessar a tela de pendências de integrações (ex.: `/operacao/dlq` — URL pode permanecer técnica internamente).
2. **Esperado**: título da página **"Pendências"** (ou "Fila de reprocessamento"). **Sem** "DLQ", "Dead Letter Queue".
3. Item rotulado **"Pendência"** ou **"Item em fila de reprocessamento"** — não "fila de erros".

### 6.7. Configurações

1. Acessar `/configuracoes` (admin).
2. **Esperado**: nenhuma menção a "tenant" — sempre "clínica" no que for visível.

### 6.8. Auditoria

1. Acessar `/operacao/auditoria`.
2. **Esperado**: ações exibidas em linguagem clara:
   - `appointment.reversed` → renderizado como **"Cancelamento de atendimento"**
   - `appointment_material.created` → **"Material adicionado"**
3. Audit_log no banco continua usando `appointment.reversed` (verificar via `psql`).

### 6.9. Grep de smoke

```bash
# Strings que NUNCA devem aparecer em arquivos de UI
grep -rn -E "(Estornar|Estornado|Revertido|NKDA|DLQ|Dead Letter|tenant\b|Schema cache|digest:|Erro inesperado|Concluir etapa|Marcar como realizado)" \
  src/app/\(dashboard\)/ \
  src/app/error.tsx \
  src/app/**/error.tsx \
  src/lib/core/patient-medical/ \
  src/lib/core/reports/ \
  --include='*.tsx' --include='*.ts' \
  | grep -v -E "(// |/\*|\* |@ts-|reverse\.ts|appointment_reversals|process-ghl-event|webhooks/|integrations/)"
```

**Esperado**: zero output (ou apenas false positives em comentários/docstrings, que devem ser revisados manualmente).

---

## Fluxo 7 — Gates de qualidade

```bash
pnpm typecheck
# Esperado: 0 errors

pnpm lint:auth
# Esperado: 0 violations (todos os endpoints novos têm requireRole)

pnpm test
# Esperado: todos os testes passam (incluindo novos contract/integration tests da feature)

pnpm test:integration
# Esperado: incluindo testes de RLS de appointment_materials
```

---

## Critérios de aceite (Success Criteria do spec)

Mapear cada SC para um passo:

| SC | Validado por |
|---|---|
| SC-001 (atomicidade) | Fluxo 4.1 + teste de integração explícito |
| SC-002 (sub-seção ausente quando vazio) | Fluxo 2 |
| SC-003 (zero termos proibidos) | Fluxo 6.9 |
| SC-004 (botão WhatsApp em todos pacientes) | Fluxo 5.1 + 5.2 |
| SC-005 (WhatsApp em ≤ 2 segundos) | Fluxo 5 (subjetivo, observação) |
| SC-006 (zero tickets em 30 dias) | Métrica de produção pós-deploy |
| SC-007 (PDF mostra materiais) | Fluxo 1 passo 14 |
| SC-008 (RLS) | Fluxo 4.4 |

---

## Rollback plan (caso necessário)

Se algum fluxo falhar em prod:
- **Migration 0061** é trivialmente reversível em dev (`DROP TABLE appointment_materials CASCADE; DROP FUNCTION ...`). Em prod, segue regra do projeto: dados existentes ficam órfãos mas seguros (FK ON DELETE RESTRICT impede limpeza acidental).
- **UI rollback**: `git revert` do commit que tocou os arquivos de UI; a migration pode ficar — tabela vazia não causa dano.
- **Linguagem rollback**: `git revert` dos arquivos de UI específicos. Banco intocado.
- **WhatsApp rollback**: `git revert` do `page.tsx` do paciente; helper pode ficar (não é importado se o botão não estiver lá).
