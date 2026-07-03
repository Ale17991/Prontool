# Quickstart — Periograma (Fase 3)

## Pré-requisitos

- Stack local: `supabase start` (:54321). Aplicar migrations: `pnpm supabase:reset` (⚠️ apaga dados locais — re-seed com `pnpm seed:demo`).
- Demo: `admin@clinica-demo.test / demo1234`.

## Fluxo de validação manual

1. Abrir um paciente → aba **Odonto-Space** → sub-seção **Periograma**.
2. **Criar exame** (botão "Novo exame"). Confirmar que cria em rascunho e que tentar criar outro avisa que já há rascunho.
3. Na **grade**, preencher profundidade de sondagem e recessão de alguns sítios; marcar sangramento. Conferir:
   - CAL do sítio = PD + recessão, atualiza ao vivo.
   - Painel de indicadores (% BOP, bolsas ≥4 mm, CAL médio) recalcula.
   - Navegação por teclado entre sítios (setas/Tab/Enter).
   - Valor fora da faixa (ex.: PD 20) é rejeitado.
4. Marcar um dente como **ausente** → seus sítios saem dos indicadores.
5. **Finalizar** o exame → vira somente-leitura; tentar editar não é permitido.
6. Criar um 2º exame em outra data, finalizar, e abrir **Comparar** → ver variação de PD por sítio e deltas dos indicadores.
7. Logar com papel **recepcionista** → consegue ver, não consegue editar.

## Validação automatizada

```bash
pnpm typecheck
pnpm lint:auth
pnpm test:contract   # imutabilidade, único rascunho, validação de faixa
pnpm test:integration # tenant isolation + RBAC
pnpm test            # inclui unit/perio-calc (CAL e indicadores)
```

## Critérios de aceite (do spec)

- SC-001: exame permanente completo registrado e finalizado em < 10 min.
- SC-002: indicadores batem com cálculo manual (100% dos casos de teste).
- SC-003: comparar dois exames e ver variação de PD por sítio em < 1 min.
- SC-004: 100% das edições pós-finalização bloqueadas.
- SC-005: nenhum vazamento entre clínicas.
