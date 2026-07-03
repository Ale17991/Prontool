# LCP "after" — pós migração Inter via next/font/google

**Tasks**: T058, T059
**Status**: ⚠ **PENDING MANUAL CAPTURE**

## Como capturar

1. Abrir DevTools no `/login` (build atual, pós Phase 8).
2. Lighthouse → Mobile + Slow 3G + Performance.
3. Registrar **LCP** e **FCP**.
4. Repetir em `/` (dashboard).
5. **Network** (com `Disable cache` ativo) — confirmar que **zero requests** vão para `fonts.googleapis.com` durante o carregamento.

## Pending

```text
/login   LCP: ???ms   FCP: ???ms   (date: ____)
/        LCP: ???ms   FCP: ???ms   (date: ____)
fonts.googleapis.com requests: 0 esperado, ??? medido
```

## Após captura

Comparar com `baselines/lcp-before.md`. **SC-006** requer:

- LCP ≥ 100ms menor que baseline, **OU**
- Ausência confirmada de FOUT (FOIT também aceitável se < 100ms)

**SC-009** requer: zero requests a `fonts.googleapis.com`. `pnpm build` já cacheia Inter no bundle estático (next/font baixa em build-time, depois serve do mesmo domínio do app). Risco residual: zero.

## Validação automática durante build

`pnpm build` rodou com sucesso após a migração — next/font fetch + cache + serve funcionou. Output relevante:

- Routes compiled e dimensionados (login = 4.49 kB, dashboard = ~87 kB shared).
- Sem warnings de fonte.
