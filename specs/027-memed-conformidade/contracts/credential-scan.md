# Contract: Script `scan-bundle-for-memed-keys`

Script Node executado **após** `next build` que faz grep recursivo nos artefatos buildados em busca de credenciais Memed escapadas. Falha CI se encontrar.

Implementado em `tools/scripts/scan-bundle-for-memed-keys.ts`.

## Input

Diretório `.next/static/` gerado por `next build` (padrão Next.js 14 App Router).

Opcional: env vars

- `SCAN_EXTRA_PATTERNS` — patterns regex adicionais separados por `|` (default: vazio)
- `SCAN_PATH` — sobrescreve `.next/static/` (default usado)

## Patterns padrão verificados (case-insensitive)

1. **Chaves prefixadas** — regex `mk_[A-Za-z0-9]{20,}` (formato típico de chave Memed observado em integradores)
2. **Strings literais MEMED** — regex `MEMED[_-]?(API|SECRET)[_-]?KEY` (cobre `MEMED_API_KEY`, `MEMED-API-KEY`, `MEMEDAPIKEY`)
3. **Env names em texto** — regex `process\.env\.MEMED` (algumas builds preservam strings de `process.env.X` se não puderam ser substituídas em compile-time)
4. **Patterns customizados** — todo conteúdo de `SCAN_EXTRA_PATTERNS`

## Output

- **Exit 0** se nenhum match: mensagem `[scan-bundle] OK — 0 ocorrências de credenciais Memed em .next/static/`
- **Exit 1** se ≥ 1 match:
  ```
  [scan-bundle] FAIL — credencial Memed encontrada em arquivo(s) buildado(s):
    .next/static/chunks/abc123.js:1234 — match "mk_xxxxxxxxxx" (mascarado)
    .next/static/chunks/def456.js:567 — match "MEMED_API_KEY"
  Refatore o código para NUNCA referenciar chaves Memed em código de front-end.
  Apenas o backend pode ler env vars começando com MEMED_.
  ```
- Sempre **mascara** o match na saída — mostra os primeiros 4 e últimos 4 caracteres do segredo encontrado (ex.: `mk_x****abcd`). Nunca printa a chave completa.

## Performance

- Skip de arquivos `.map` (source maps; tipicamente não vão pra produção)
- Skip de arquivos > 50 MB (defensivo)
- Paralelizado com `worker_threads` (default 4 workers)
- Tempo alvo: ≤ 30s para bundle típico de 100MB

## Comportamento esperado em CI

```yaml
- name: Build
  run: pnpm build
- name: Scan bundle for Memed keys
  run: pnpm scan:memed-keys
```

Script package.json:

```json
{
  "scripts": {
    "scan:memed-keys": "tsx tools/scripts/scan-bundle-for-memed-keys.ts"
  }
}
```

## Não-objetivos

- **NÃO** previne via runtime — script roda em build-time apenas. Defesa runtime é responsabilidade do lint rule (FR-013) e dos testes de integração/E2E.
- **NÃO** verifica `node_modules/` — assume que libs terceiros não embedam nossas chaves (revisado manualmente).
- **NÃO** verifica `.env*` — esses não vão pro bundle; verificação separada em `tools/scripts/audit-env.ts` (já existente no projeto, supostamente).
