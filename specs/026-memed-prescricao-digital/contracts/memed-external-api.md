# Contrato — API externa Memed (consumida pela cápsula `memed/`)

Somente server-side. `Accept: application/vnd.api+json`. `api-key`/`secret-key` na query string. Timeout 5s (`AbortSignal.timeout(5000)`).

Base URL por ambiente:

- Homologação: `https://integrations.api.memed.com.br/v1` (chaves públicas fixas da doc)
- Produção: `https://api.memed.com.br/v1`

## Prescritor

### POST `/sinapse-prescricao/usuarios` — cadastra prescritor

Body (JSON:API):

```json
{
  "data": {
    "type": "usuarios",
    "attributes": {
      "external_id": "<doctor.id UUID>",
      "nome": "<derivado de full_name>",
      "sobrenome": "<derivado de full_name>",
      "cpf": "<11 dígitos>",
      "board": {
        "board_code": "<council_name>",
        "board_number": "<council_number>",
        "board_state": "<council_state UF>"
      },
      "data_nascimento": "<dd/mm/YYYY>",
      "email": "<opcional>",
      "telefone": "<opcional>",
      "sexo": "<M|F opcional>",
      "especialidade": "<memed_specialty_id opcional>",
      "cidade": "<id cidade opcional>"
    }
  }
}
```

Resposta 200: `data.attributes.token` (JWT), `nome`, `sobrenome`, `cpf`, `uf`, `crm`.

### GET `/sinapse-prescricao/usuarios/{id}` — busca prescritor + token fresco

`{id}` aceita: CPF (11 díg.), `external_id`, ou registro+UF (ex.: `12345SP`). Resposta inclui `attributes.token` (sempre recuperar o último válido antes de carregar o front).

### PATCH `/sinapse-prescricao/usuarios/{external_id}` — atualiza prescritor

### DELETE `/sinapse-prescricao/usuarios/{id}` — remove prescritor

## Catálogos (leitura)

- GET especialidades — lista `{id, nome}` para o de-para (FR-020).
- GET cidades — id de cidade (opcional no cadastro).

## Frontend (script + MdHub)

- Script: `https://integrations.memed.com.br/modulos/plataforma.sinapse-prescricao/build/sinapse-prescricao.min.js` com atributo `data-token=<token do prescritor>`.
- Evento `core:moduleInit` → libera os comandos do MdHub.
- Comandos: `MdHub.command.send('setPaciente', { … })`, `MdHub.module.show('plataforma.prescricao')`, `MdHub.command.send('logout')`.
- Eventos a capturar: `prescricaoImpressa` (emissão), `prescricaoExcluida` (exclusão).

### `setPaciente` — payload (campos do paciente, decifrados server-side)

`{ external_id, nome, cpf, sexo (M/F), data_nascimento, telefone, email, endereco{...} }`.

## Mapa de erros

- 4xx de validação → `ValidationError` (mensagem amigável; apontar campo).
- timeout/5xx/network → `UpstreamError` (mensagem "Memed indisponível, tente novamente"); nunca vazar chaves nos logs (PII/segredos mascarados).
