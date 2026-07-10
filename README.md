# calendly-mcp

MCP server para integração com Calendly API v2. Permite que qualquer instância do Claude agende, consulte e cancele reuniões no Calendly — e gere links de agendamento single-use — sem passar pelo formulário público.

**[→ Como funciona o Calendly MCP](https://ericlucianoferreira.github.io/calendly-mcp/)** — a página do projeto, com o sistema explicado visualmente.

## Tools disponíveis

| Tool | Descrição |
|------|-----------|
| `calendly_list_event_types` | Lista tipos de evento ativos, com URI, slug, duração, URL pública e perguntas do formulário |
| `calendly_list_available_slots` | Horários disponíveis em um intervalo de datas (máx. 7 dias), em UTC e horário de Brasília |
| `calendly_schedule` | Agenda uma reunião para um convidado via Scheduling API |
| `calendly_cancel` | Cancela um evento pelo UUID, com motivo registrado |
| `calendly_get_event` | Detalhes completos de um evento: status, link Zoom e dados dos convidados |
| `calendly_create_scheduling_link` | Link de agendamento single-use para um tipo de evento existente |
| `calendly_create_one_off_link` | Reunião avulsa com nome, duração (15/30/60/90 min) e datas customizadas + link single-use |

### Sobre `calendly_schedule`

A ferramenta agenda direto pela Scheduling API do Calendly (`POST /invitees`), preenchendo os campos do formulário (WhatsApp, empresa, observações). Se a API recusar o agendamento direto, retorna uma URL pré-preenchida com todos os dados do convidado — abra no navegador (ou envie ao convidado) e confirme em um clique.

## Instalação

### Pré-requisitos

- [Claude Code](https://claude.com/claude-code) instalado
- Node.js 18+ e git
- Conta Calendly **Standard ou superior** (Standard já libera a API v2)

### Setup assistido (recomendado)

Copie o prompt abaixo e cole em uma sessão do Claude Code. Ele conduz o processo inteiro — inclusive a geração do seu Personal Access Token no Calendly, navegando pelo browser por você (você só faz o login).

```text
Instale e configure o Calendly MCP (https://github.com/ericlucianoferreira/calendly-mcp) nesta máquina, conduzindo o processo inteiro comigo, etapa por etapa. Regras: nunca me peça senha ou código de verificação no chat; segredos só podem existir em arquivo de configuração local ou variável de ambiente, nunca no chat nem em commit; não declare nada pronto sem validar com uma chamada real.

1. PRÉ-REQUISITOS
   - Verifique Node.js 18+ (node --version) e git. Se faltar algo, me oriente a instalar antes de continuar.
   - Clone https://github.com/ericlucianoferreira/calendly-mcp.git em uma pasta local definitiva (fora de diretórios temporários), rode npm install e guarde o caminho absoluto do index.js.
   - Confirme comigo que minha conta Calendly é Standard ou superior (plano que libera a API v2).

2. TOKEN DO CALENDLY (etapa de navegador)
   O servidor autentica com um Personal Access Token, gerado em: calendly.com → Integrations & apps → API & webhooks → Personal access tokens (URL direta: https://calendly.com/integrations/api_webhooks).
   Antes de me mandar fazer isso manualmente, pergunte com botões (AskUserQuestion): "Essa etapa é no navegador. Quer que eu faça pra você?" com estas opções:
   a) "Faz pra mim (Playwright)" — opção DEFAULT. Se o Playwright MCP não estiver disponível, instale com: claude mcp add playwright -- npx -y @playwright/mcp@latest — e me avise se for preciso reiniciar a sessão pra ele conectar. Depois: abra https://calendly.com/login, espere EU fazer o login sozinho, navegue até Personal access tokens, gere um token com o nome "claude-mcp" e copie o valor exibido na tela direto pra configuração do passo 3 — sem repetir o valor no chat.
   b) "Faz pra mim (Chrome)" — se eu já uso a extensão Claude in Chrome, siga o mesmo roteiro usando meu Chrome, que já está logado.
   c) "Prefiro fazer manualmente" — me passe o passo a passo numerado e prepare a configuração do passo 3 com o valor vazio, me apontando o arquivo e o campo exatos onde devo colar o token (não pedir pra colar no chat).

3. REGISTRO NO CLAUDE CODE
   Registre o servidor com a env var correta. Preferência: escreva a configuração direto no arquivo (o token não passa pelo chat) — entrada "calendly" em mcpServers no ~/.claude.json (ou .mcp.json do projeto), com command "node", args ["<caminho-absoluto>/index.js"] e env {"CALENDLY_TOKEN": "<token>"}. Alternativa por CLI: claude mcp add calendly --env CALENDLY_TOKEN=<token> -- node <caminho-absoluto>/index.js. Me explique onde a configuração ficou salva.

4. VALIDAÇÃO REAL (antes de declarar pronto)
   Valide o token com uma chamada real à API v2, lendo o valor do arquivo de configuração sem nunca imprimi-lo: liste os tipos de evento (GET https://api.calendly.com/event_types) e me mostre só nomes e durações. Se vier 401, o token está errado — volte à etapa 2.

5. TESTE E2E E RESUMO
   Me peça pra reiniciar o Claude Code (pra o MCP conectar) e, na nova sessão, rode o teste de ponta a ponta: calendly_list_event_types e depois calendly_list_available_slots de um tipo de evento real nos próximos 7 dias. Termine com um resumo: o que foi instalado, onde o token está salvo, quais as 7 tools disponíveis e um exemplo de pedido que já posso fazer ("gera um link de 30 minutos pra semana que vem").
```

> Durante a etapa de navegador, o login é sempre seu: o Claude abre a página e espera você entrar na conta. O token vai direto para a configuração local da sua máquina.

### Setup manual (resumo)

1. Gere um Personal Access Token: [calendly.com/integrations/api_webhooks](https://calendly.com/integrations/api_webhooks) → **Personal access tokens** → **Generate new token** (nome sugerido: `claude-mcp`; o valor é exibido uma única vez).
2. Clone e instale:

   ```sh
   git clone https://github.com/ericlucianoferreira/calendly-mcp.git
   cd calendly-mcp
   npm install
   ```

3. Registre no Claude Code (substitua o caminho e o token):

   ```sh
   claude mcp add calendly --env CALENDLY_TOKEN=<seu-token> -- node /caminho/absoluto/calendly-mcp/index.js
   ```

   Ou adicione no `~/.claude.json` (dentro de `mcpServers`):

   ```json
   "calendly": {
     "command": "node",
     "args": ["/caminho/absoluto/calendly-mcp/index.js"],
     "env": { "CALENDLY_TOKEN": "<seu-token>" }
   }
   ```

4. Reinicie o Claude Code e valide:

   ```text
   use calendly_list_event_types
   ```

   Deve retornar a lista de tipos de evento ativos da sua conta.

## Variáveis de ambiente

| Variável | Obrigatória | Descrição |
|----------|-------------|-----------|
| `CALENDLY_TOKEN` | Sim | Personal Access Token do Calendly |

## Atualização

```sh
cd calendly-mcp
git pull
```

Reinicie o Claude Code em seguida para reconectar o MCP.

## Segurança

- O token fica **somente** na configuração local (`~/.claude.json` / `.mcp.json`) ou em variável de ambiente — nunca em commit, chat ou log.
- Se o valor vazar em texto plano, revogue o token no Calendly e gere outro.

## Licença

MIT
