# Quickstart — Validar a Avaliação Nutricional (046)

Pré: stack local (`supabase start` :54321), migrations aplicadas (até `0175`), `pnpm seed:demo`, módulo `nutri_avaliacao` **ativado** para a clínica de teste no `/admin`.

## Fluxo feliz (manual)

1. **Acesso** — logar como `admin`/`profissional_saude`; abrir **Avaliação Nutricional** no menu (só aparece com o módulo ligado). Selecionar um paciente com sexo e nascimento cadastrados.
2. **Composição** — escolher um protocolo (ex.: Jackson-Pollock 3 dobras), informar as dobras exigidas + peso/altura + cintura/quadril. Conferir **ao vivo**: %gordura, massa gorda/magra, IMC + classe, RCQ + classe.
3. **Energia** — escolher a equação de TMB (ex.: Mifflin), o fator de atividade e o objetivo (ex.: déficit −500). Conferir TMB, GET, VET-meta e macros em gramas.
4. **Salvar** — a avaliação é gravada; conferir que %gordura, massa magra, IMC, TMB e GET aparecem no **histórico de medições** e nos gráficos de evolução do paciente.
5. **Imutabilidade** — não há editar/excluir; corrigir = nova avaliação (a anterior permanece).
6. **Bioimpedância** — repetir escolhendo "bioimpedância" como fonte de composição (informa %gordura direto, sem dobras).
7. **Gating** — desligar o módulo no `/admin` e confirmar que a tela some do menu e o acesso direto por URL é negado.

## Mapa de verificação (Success Criteria)

| Critério | Como validar |
|---|---|
| SC-001 (≤5 min) | Passos 2–4 num paciente já cadastrado |
| SC-002 (números batendo) | Comparar resultados com `nutri-doc/formulas-referencia.md` / cálculo manual |
| SC-003 (derivados na evolução) | Passo 4 (medições/gráficos sem passo manual) |
| SC-004 (isolamento de módulo) | Passo 7 |
| SC-005 (imutável+auditado) | Passo 5 + conferir `audit_log` |
| SC-006 (isolamento de clínica) | Tentar ler avaliação de outro tenant → vazio |
| SC-007 (cobertura de métodos) | Todos os 16 métodos de energia e 10 de composição selecionáveis |

## Testes automatizados (vitest)

- **Unidade**: cada equação de TMB e cada protocolo de dobras vs. gabarito gerado das fórmulas (`nutri-doc/formulas-referencia.md`); fronteiras plausíveis; Siri; IMC/RCQ classes.
- **Integração**: salvar avaliação → snapshot imutável + derivados lançados nas medições (`recordMeasurementsBatch`); métrica `gasto_energetico_total` presente; equação por MLG exige composição.
- **Contrato**: `nutrition_assessments` rejeita UPDATE/DELETE; isolamento de tenant; RBAC (admin/profissional_saude criam; recepcionista/financeiro não) + gate de módulo.

## Comandos

```bash
pnpm supabase:reset && pnpm supabase:gen-types   # aplica 0175 (re-seed depois: demo + bioimpedância + gasto_energetico_total)
pnpm test:contract && pnpm test:integration
pnpm lint:auth && pnpm typecheck
```

> Lembrete: `vitest` apaga o banco/seed local e o `catalog_baseline` (0170) restaura os catálogos — re-rodar o seed das métricas de nutrição após a suíte.
