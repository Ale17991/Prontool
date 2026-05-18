# Audit — Tailwind `dark:` prefix usage

**Task**: T002
**Date**: 2026-05-18
**Command**: `Grep "\bdark:" src/`

## Result

**Zero occurrences.**

Nenhum uso de prefixo `dark:` no `src/`. Phase 8 (US6) — task T055 ("limpar usos órfãos") será **no-op**: basta remover `darkMode: ['class']` de `tailwind.config.ts` (T054).
