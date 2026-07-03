# Quickstart — Portal do Paciente + Endócrino (dev/validação)

Pré-requisitos: Docker + `supabase start`, `pnpm install`. Login staff demo: `admin@clinica-demo.test` / `demo1234`.

> ⚠️ **Não rodar `vitest`/`pnpm test` durante teste manual** — `resetDatabase()` apaga o banco local. Re-seed: `pnpm seed:demo`.

## 1. Schema e dados

```bash
pnpm supabase:reset          # aplica migrations incl. 0113_patient_portal_measurements.sql
pnpm supabase:gen-types
pnpm seed:demo               # tenant + usuários + alguns pacientes (com CPF e nascimento)
```

- Confirme que a clínica demo tem **slug** e `public_booking_enabled` (ou ajuste para o portal resolver o slug).
- Garanta um paciente com **CPF e data de nascimento** preenchidos.

## 2. Variável de ambiente

- Definir `PATIENT_SESSION_SECRET` no `.env.local` (segredo forte, só servidor) — assina o cookie de sessão do paciente.

## 3. Registrar métricas (staff)

1. Logar como `profissional_saude`/`admin`, abrir o prontuário do paciente.
2. Na seção **Métricas metabólicas**, registrar ex.: HbA1c `7.8 %` em duas datas; glicemia, circunferência, lipídios.
3. Conferir que valores fora de faixa (ex.: HbA1c `99`) são bloqueados.

## 4. Acessar como paciente

1. Abrir `/paciente/<slug-da-clinica>`.
2. Informar **CPF** + **data de nascimento (só números)** + aceitar o aviso.
3. Ver o **painel**: evolução de peso/IMC (se houver sinais vitais), gráficos das métricas metabólicas e histórico de atendimentos — **só leitura**, só do próprio paciente.
4. Testar nascimento errado → **negado com mensagem genérica**; repetir várias vezes → **bloqueio (429)**.

## 5. Testes (quando NÃO estiver testando manualmente)

```bash
pnpm test:contract      # isolamento, login (genérico+rate-limit), append-only, RBAC
pnpm test:integration   # login→bundle, staff registra métrica
pnpm typecheck && pnpm lint:auth
```

## Critérios de aceite (espelham Success Criteria)

- SC-002: paciente vê **somente** os próprios dados e da clínica certa (teste de isolamento).
- SC-003: nenhuma ação de edição exposta ao paciente.
- SC-004: tentativas repetidas são bloqueadas.
- SC-005: métrica registrada aparece e **não** pode ser apagada.
- SC-006: falha de login não revela se o CPF existe.
