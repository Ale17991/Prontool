# Spec — Portal do Paciente Modular & Configurável (proposta para revisão)

> Evolução da feature 030 (portal do paciente). Objetivo: o portal pode exibir
> **qualquer dado clínico que a clínica julgue útil**, com cada seção
> **ativável/desativável** por clínica, e algumas seções como **módulos pagos por
> plano**. Paciente continua **somente-leitura**. Inclui redesign do painel +
> dois módulos novos (treino e dieta).
>
> Status: **proposta** — revisar antes de virar branch/spec formal (`specs/032-…`).
> Fundamentado em pesquisa (deep-research 2026-06-10): Feegow (toggle por seção),
> CFM Res. 2.217/2018 Art. 88/34, Lei 13.787/2018, LGPD Art. 11 (tutela da saúde, §4º).

---

## 1. Modelo de exibição: 3 camadas de controle

Uma seção só aparece para o paciente se passar pelas três:

1. **Plano (entitlement, feature 031)** — o plano da clínica inclui o módulo?
   Reusa `hasModule()`/`requireModule()`. Ex.: `treino`/`dieta` são módulos pagos.
2. **Config da clínica** — dentro do que o plano libera, a clínica liga/desliga a
   seção (nova tabela `tenant_portal_sections`). Espelha o modelo da Feegow.
3. **Cautela clínica/legal** — seções com dado sensível nascem **OFF por padrão** e
   exigem ação explícita do profissional (CFM Art. 34/88: dado que pode causar
   dano não vai ao paciente sem mediação).

> Regra de ouro: **default seguro**. Liga-se o que se quer mostrar, não o contrário.

---

## 2. Catálogo de seções

Gating: **core** (sempre disponível, toggle simples) · **config** (toggle por
clínica) · **módulo** (pago por plano) · sensibilidade: 🟢 baixa · 🟡 média · 🔴 alta
(OFF por padrão + liberação profissional).

| Seção | Gating | Sens. | Origem do dado | Observação |
|---|---|---|---|---|
| Meus atendimentos (histórico) | core | 🟢 | `appointments_effective` | já existe (030) |
| Evolução de métricas (peso/IMC/metabólicas) | core | 🟢 | `patient_measurements` | já existe (030); semáforo + tendência |
| Orientações / plano de cuidado | config | 🟡 | nova `patient_care_notes` | texto do profissional p/ o paciente |
| Prescrições / receitas | config | 🟡 | `prescription_records` (Memed) | link/visualização, sem editar |
| Documentos (atestado, laudo, declaração) | config | 🟡 | Storage + nova `patient_documents` | upload pelo profissional |
| Resultados de exames | config | 🔴 | nova `patient_exam_results` | **nunca cru**: semáforo + faixa + resumo; liberação profissional |
| Vacinas / imunização | config | 🟢 | nova `patient_immunizations` | — |
| Faturas / pagamentos | config | 🟢 | financeiro existente | só do próprio paciente |
| **Rotina de treino** | **módulo `treino`** | 🟢 | novas tabelas (§4) | personal trainer |
| **Plano alimentar / dieta** | **módulo `dieta`** | 🟡 | novas tabelas (§4) | nutricionista; restrições/alergias |
| Teleconsulta | módulo `telemedicina` | 🟡 | (futuro) | já é módulo no 031 |
| Mensagens seguras com a equipe | módulo (futuro) | 🟡 | (futuro) | escopo posterior |

**Diagnósticos crus (psiquiátrico, oncológico, sorologia, genética)**: 🔴 — não
expor automaticamente. Ficam embutidos só em "Orientações" mediadas pelo profissional.

---

## 3. Os dois módulos novos

Novos `ModuleId` em `entitlements/plans.ts`: `'treino'` e `'dieta'`. Disponíveis
como add-on em qualquer plano. Painel admin de entitlements liga por clínica.

### 3a. Rotina de treino (`treino`)
Modelagem **aditiva** (começa leve, evolui ao completo sem migração dolorosa):

- `workout_plans` (tenant, patient, título, objetivo, vigência, criado_por, status)
- `workout_sessions` (plan_id, ordem, nome — ex. "Treino A", dia/semana p/ periodização futura)
- `workout_exercises` (session_id, ordem, **base**: nome, séries, repetições, carga_kg, descanso_seg, obs, video_url; **avançado nullable**: intensidade_pct_1rm, rir, tempo) ← colunas avançadas já criadas nullable, UI revela quando o módulo "completo" chegar.

> Base = sets×reps×carga (suficiente p/ MVP). Avançado (%1RM/RIR/periodização) é
> só preencher colunas que já existem — sem migração. Fonte: Renaissance/NASM.

### 3b. Plano alimentar / dieta (`dieta`)
Modelagem **conservadora** (macro-por-LBM foi derrubado na pesquisa → opcional):

- `diet_plans` (tenant, patient, título, objetivo, restrições/alergias, vigência, criado_por, status)
- `diet_meals` (plan_id, ordem, nome — "Café da manhã", horário sugerido, obs)
- `diet_meal_items` (meal_id, ordem, alimento, quantidade, unidade, substituições; **macros nullable**: kcal, proteína_g, carbo_g, gordura_g) ← macros opcionais desde já.

Append-only com versão (correção = nova versão do plano), igual ao motor de medições.

---

## 4. Redesign do painel (UX)

- **Mobile-first** real (alvos de toque ≥44px), não desktop encolhido.
- **Linguagem simples** (reusa direção da feature 007), sem jargão; glossário on-demand.
- Painel = **cards por seção** (só os ligados aparecem), ordem clínica → estilo de vida.
- Métricas/exames: **semáforo + faixa + tendência** (recharts já em uso); **nunca número cru** sem interpretação (reduz ansiedade/ligações — JMIR 2024).
- Acessibilidade alvo **WCAG 2.1 AA** (boa prática; no Brasil eMAG/LBI são a referência).

---

## 5. Conformidade LGPD / CFM (checklist)

- [ ] Base legal documentada: **tutela da saúde** (LGPD Art. 11, II) — consentimento não é a única base; manter o aviso LGPD atual como transparência.
- [ ] **Não compartilhar/vender** dado de saúde entre controladores p/ vantagem econômica (LGPD §4º). Cobrar a clínica pelo módulo é OK; vender o dado, não.
- [ ] Seções sensíveis 🔴 **OFF por padrão** + liberação explícita do profissional (CFM Art. 34/88, risco ao paciente).
- [ ] Retenção do prontuário **≥20 anos** (Lei 13.787/2018 Art. 6).
- [ ] Auditoria de acesso do paciente já existe (`patient_portal_access_log`) — estender p/ "qual seção foi vista".
- [ ] PII decifrada só no servidor; RLS por `tenant_id`; sessão HMAC só-leitura (já no 030).

---

## 6. Faseamento sugerido

- **Fase 1 (MVP)**: tabela `tenant_portal_sections` + gating 3-camadas + redesign do painel + seção "Orientações" + ligar/desligar as seções já existentes (atendimentos, métricas).
- **Fase 2**: módulos `treino` e `dieta` (modelagem leve) + telas de autoria no painel + cards no portal.
- **Fase 3**: exames com semáforo, documentos, prescrições, vacinas, faturas.
- **Fase 4**: evolução "completa" de treino/dieta (preencher colunas avançadas) p/ personais e nutricionistas; mensagens seguras.

---

## 7. Questões em aberto (precisam de você / mais pesquisa)

1. **Empacotamento**: `treino`/`dieta` em quais planos como add-on? Preço? (pesquisa não confirmou padrão de concorrentes BR).
2. **Exames**: liberação automática com atraso (ex.: 24h p/ o profissional revisar) ou só manual? (CFM não prescreve prazo — fica a critério).
3. **Autoria**: criar papéis `personal`/`nutricionista` ou usar `profissional_saude` existente com escopo?
4. **Schema de dieta**: validar campos com fluxo real de nutricionista BR (CFN, Dietbox/WebDiet) antes da Fase 4.
