# calendly-mcp

MCP server para integração com Calendly API v2. Permite que qualquer instância do Claude agende, consulte e cancele eventos no Calendly sem passar pelo formulário público.

## Tools disponíveis

| Tool | Descrição |
|------|-----------|
| `calendly_list_event_types` | Lista tipos de evento ativos (diagnóstico, apresentação etc.) |
| `calendly_list_available_slots` | Lista horários disponíveis em um intervalo de datas (máx. 7 dias) |
| `calendly_schedule` | Agenda uma reunião para um convidado |
| `calendly_cancel` | Cancela um evento pelo UUID |
| `calendly_get_event` | Retorna detalhes completos de um evento, incluindo link Zoom e dados do convidado |

### Sobre `calendly_schedule`

A ferramenta tenta agendamento direto via endpoint interno do Calendly (o mesmo que a página de agendamento usa). Se o endpoint rejeitar o Bearer token, retorna uma URL pré-preenchida com todos os dados do convidado — abre no Chrome e confirma em um clique.

## Pré-requisitos

- Node.js 18+
- Conta Calendly Standard ou superior (Standard já libera API v2)
- Personal Access Token (PAT) do Calendly

## 1. Gerar o PAT no Calendly

1. Acesse: https://calendly.com/integrations/api_webhooks
2. Clique em **Personal Access Tokens**
3. Clique em **Generate New Token**
4. Nome sugerido: `claude-mcp`
5. Copie o token gerado (exibido uma única vez)

## 2. Salvar no 1Password

Crie um novo item no vault **Agentes Eric** (ID `dw75mcc3tt223zd4yeo6ym2aqm`):

- **Título**: `CALENDLY_TOKEN`
- **Campo**: `credential` com o valor do PAT

Via CLI:
```sh
op item create \
  --vault "Agentes Eric" \
  --title "CALENDLY_TOKEN" \
  --category "API Credential" \
  credential="<SEU_PAT_AQUI>"
```

## 3. Adicionar ao tokens-manifest.yaml

Em `claude-sync/secrets-bootstrap/tokens-manifest.yaml`, adicione na seção correspondente:

```yaml
- name: CALENDLY_TOKEN
  op_path: "op://Agentes Eric/CALENDLY_TOKEN/credential"
  targets: [pc, notebook, vps-claude-code, vps-claude-code-backup]
```

Depois rode `setup-secrets.ps1` no PC e notebook, e o script equivalente nas VPS para propagar o token.

## 4. Instalar o MCP

### PC e Notebook (Windows)

```sh
cd C:\repos
git clone https://github.com/ericlucianoferreira/calendly-mcp.git
cd calendly-mcp
npm install
```

Adicionar no `~/.claude.json` (dentro de `mcpServers`):

```json
"calendly": {
  "command": "node",
  "args": ["C:/repos/calendly-mcp/index.js"],
  "env": {
    "CALENDLY_TOKEN": "<token ou deixar vazio se setup-secrets já propagou via env var>"
  }
}
```

Se o `setup-secrets.ps1` já injetou `CALENDLY_TOKEN` nas variáveis de ambiente do Windows, o `env` no `.claude.json` pode ser omitido — o processo filho herda.

### VPS (containers claude-code e claude-code-backup)

Os dois containers compartilham `/data-shared`, então edite o `~/.claude.json` uma única vez:

```sh
cd /workspace/mcps
git clone https://github.com/ericlucianoferreira/calendly-mcp.git
cd calendly-mcp
npm install
```

Adicionar no `~/.claude.json` (dentro de `mcpServers`):

```json
"calendly": {
  "command": "node",
  "args": ["/workspace/mcps/calendly-mcp/index.js"],
  "env": {
    "CALENDLY_TOKEN": ""
  }
}
```

Preencher o valor do token via `op read "op://Agentes Eric/CALENDLY_TOKEN/credential"` ou via `/etc/environment.d/expert.conf` se já propagado.

## 5. Reiniciar o Claude Code

Após editar o `.claude.json`, reiniciar o Claude Code para reconectar os MCPs.

## Validação rápida

Com o MCP ativo, rode no Claude:

```
use calendly_list_event_types
```

Deve retornar a lista de event types (incluindo "diagnóstico").

## Atualização

```sh
cd C:\repos\calendly-mcp
git pull
# nas VPS:
cd /workspace/mcps/calendly-mcp && git pull
```

## Variáveis de ambiente

| Variável | Obrigatória | Descrição |
|----------|-------------|-----------|
| `CALENDLY_TOKEN` | Sim | Personal Access Token do Calendly |
