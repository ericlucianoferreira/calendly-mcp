# calendly-mcp — contexto para o Claude

MCP server (Node.js, stdio) que conecta o Claude à API v2 do Calendly. Todo o servidor mora em `index.js`; a única configuração é a env var `CALENDLY_TOKEN` (Personal Access Token do Calendly). Sete tools: `calendly_list_event_types`, `calendly_list_available_slots`, `calendly_schedule`, `calendly_cancel`, `calendly_get_event`, `calendly_create_scheduling_link`, `calendly_create_one_off_link`.

## Onboarding assistido (instruções para o Claude)

Se você abriu este repositório e o MCP ainda não está configurado nesta máquina (sem entrada `calendly` em `mcpServers` no `~/.claude.json`/`.mcp.json` e sem `CALENDLY_TOKEN` no ambiente), OFEREÇA ativamente conduzir o setup — não espere o usuário pedir. Sugestão de abertura: "Percebi que o Calendly MCP ainda não está configurado aqui. Quer que eu conduza a instalação agora? Eu cuido de tudo, inclusive de gerar o token no Calendly navegando pelo browser — você só faz o login."

### Protocolo (regras, na ordem)

1. **Pré-requisitos primeiro.** Verifique Node.js 18+ (`node --version`) e git. Rode `npm install` na raiz do repo. Se o repo ainda não estiver clonado num local definitivo, clone `https://github.com/ericlucianoferreira/calendly-mcp.git` e guarde o caminho absoluto do `index.js`. Confirme que a conta Calendly do usuário é Standard ou superior (plano que libera a API v2).
2. **Etapa de navegador é opt-in com botões.** Antes de mandar o usuário gerar o token manualmente, pergunte com AskUserQuestion: "Essa etapa é no navegador. Quer que eu faça pra você?" Opções, nesta ordem:
   - **Playwright MCP (default):** se não estiver disponível, instale com `claude mcp add playwright -- npx -y @playwright/mcp@latest` (avise se precisar reiniciar a sessão para conectar).
   - **Claude in Chrome:** ofereça como "se você já usa a extensão" — usa o Chrome logado do usuário.
   - **Manual:** passo a passo numerado, com a regra da etapa 5 sobre onde colar o token.
3. **Login é sempre do usuário.** NUNCA peça senha, código 2FA ou cookie no chat. Abra a página de login, aguarde o usuário entrar sozinho e só então continue navegando.
4. **Extraia o token da tela, não do chat.** Após gerar o token, copie o valor exibido na página direto para a configuração local. Não repita o valor em nenhuma resposta.
5. **Segredos só em config local.** O token só pode existir no `~/.claude.json`/`.mcp.json` (campo `env.CALENDLY_TOKEN`) ou em variável de ambiente. Nunca em commit, chat ou log. Na rota manual, prepare a entrada de configuração com o valor vazio e aponte o arquivo e o campo exatos onde o usuário deve colar — não peça para colar no chat. Se o valor aparecer em texto plano em qualquer lugar, oriente a revogação imediata no Calendly e a geração de um novo.
6. **Registro no Claude Code.** Entrada `calendly` em `mcpServers`: `command: "node"`, `args: ["<caminho-absoluto>/index.js"]`, `env: { "CALENDLY_TOKEN": "<token>" }`. Alternativa por CLI: `claude mcp add calendly --env CALENDLY_TOKEN=<token> -- node <caminho-absoluto>/index.js`. Explique ao usuário onde a configuração ficou salva.
7. **Validação real antes de declarar pronto.** Faça uma chamada real à API v2 lendo o token do arquivo de configuração sem nunca imprimi-lo (ex.: script Node que lê a config e chama `GET https://api.calendly.com/event_types?user=...` — o `user_uuid` está no payload do próprio JWT). Mostre só nomes e durações dos event types. `401` = token inválido: volte à etapa de geração.
8. **Teste E2E e resumo.** Peça ao usuário para reiniciar o Claude Code (o MCP conecta na nova sessão) e rode: `calendly_list_event_types` e `calendly_list_available_slots` de um tipo de evento real nos próximos 7 dias. Termine com um resumo: o que foi instalado, onde o token está salvo, as 7 tools disponíveis e um exemplo de pedido pronto para uso.

### Etapa de navegador — URLs exatas

1. Login (o usuário faz sozinho): `https://calendly.com/login`
2. Página de integrações/API: `https://calendly.com/integrations/api_webhooks` — caminho na interface: **calendly.com → Integrations & apps → API & webhooks**
3. Na página, abra **Personal access tokens** → **Generate new token**.
4. Nome sugerido para o token: `claude-mcp`.
5. O valor é exibido **uma única vez**: copie da tela direto para a configuração local (etapas 4-6 do protocolo).

## Regras de manutenção

- Não altere `index.js`, versão ou `package.json` durante um onboarding — setup não é pretexto para refatorar.
- A página pública do projeto é `docs/index.html` (GitHub Pages). Ao atualizá-la: self-contained (zero CDN), pt-BR com acentuação correta, e auditoria de PII/segredos antes de commitar (nunca tokens reais, telefones, e-mails pessoais, URLs de agenda reais — use `calendly.com/seu-usuario` como placeholder).
