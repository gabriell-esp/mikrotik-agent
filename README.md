# Slot1 · Gerência MikroTik

Sistema web para centralizar o monitoramento e a administração das MikroTiks atendidas pela Slot1 Informática, acessadas pelos túneis WireGuard da MikroTik central.

```
Navegador ──HTTPS──▶ Nginx (servidor) ──▶ web (Nginx + SPA React) ──/api──▶ backend (Node/Fastify)
                                                                             │        │
                                                                     PostgreSQL     API-SSL / REST / API
                                                                   (cache, auditoria)   │  (via túneis WireGuard)
                                                                                         ▼
                                                                   MikroTik central + MikroTiks dos clientes
```

- **Toda a comunicação com os roteadores sai do backend.** O navegador nunca recebe credenciais de roteador.
- Credenciais cifradas com **AES-256-GCM**. A chave fica fora do banco (`secrets/master_key`).
- **Coleta a cada 60 s + cache.** Se um equipamento cair, o sistema mostra a última coleta, marcada como desatualizada.
- **Interface atualizada sozinha a cada 60 s, sem recarregar a tela:** só os dados visíveis são trocados, e o indicador “Atualizado às HH:MM:SS” na barra superior mostra a última sincronização (clique nele para atualizar na hora).
- **Alertas pelo WhatsApp** (WPPConnect): queda, retorno, falha de autenticação, recursos altos e túnel sem handshake.
- Detalhes de transporte, versões e preparação dos roteadores: [docs/ROUTEROS.md](docs/ROUTEROS.md).

## Estrutura

```
backend/            API (TypeScript, Fastify, PostgreSQL)
  src/routeros/     driver RouterOS: protocolo da API (8728/8729), cliente REST, gerenciador de conexões
  src/modules/      registro de módulos de consulta (sistema, interfaces, VPN, rotas, firewall, DHCP, filas, logs, PPP)
  src/services/     coleta, cache, WireGuard, PPPoE, auditoria, status de gerência, notificações (notifier.ts, whatsapp.ts)
  src/routes/       endpoints HTTP
  src/db/migrations migrações SQL versionadas (aplicadas na inicialização)
  test/             testes automatizados (simuladores de RouterOS e WPPConnect usados só pelos testes)
frontend/           SPA React + Tailwind (pt-BR, responsiva)
deploy/             exemplo de Nginx do servidor (TLS)
docs/ROUTEROS.md    integração, diferenças de versão e preparação dos equipamentos
docker-compose.yml  db + backend + web
```

## Instalação com Docker (produção)

Requisitos: Docker + Compose, e **rota do servidor para as redes dos túneis WireGuard**. O backend precisa alcançar os IPs de gerência dos clientes.

```bash
cp .env.example .env                       # ajuste POSTGRES_PASSWORD e o restante
mkdir -p secrets
openssl rand -base64 32 > secrets/master_key   # GUARDE UMA CÓPIA SEGURA: sem ela as senhas dos roteadores não são recuperáveis
chmod 600 secrets/master_key
docker compose up -d --build                      # sem WhatsApp
docker compose --profile whatsapp up -d --build   # com o WPPConnect Server (alertas no WhatsApp)
docker compose exec backend node dist/cli/create-admin.js admin "Administrador"
```

O último comando imprime uma senha temporária; a troca é obrigatória no primeiro acesso. Para definir a senha você mesmo, use `-e ADMIN_PASSWORD=...` no `docker compose exec`.

A interface fica em `http://127.0.0.1:8080` (publicada só no host). Configure o Nginx do servidor com TLS usando [deploy/nginx-slot1-mikrotik.conf](deploy/nginx-slot1-mikrotik.conf) e mantenha `COOKIE_SECURE=true`.

**Backup:** faça backup do volume `pgdata` (ex.: `docker compose exec db pg_dump -U mikrotik mikrotik > backup.sql`) **e** do arquivo `secrets/master_key`, guardados em locais separados.

### Sem Docker (Node direto no servidor)

Se preferir rodar sem Docker, o backend usa `npm --prefix backend run build && npm --prefix backend start` (com as variáveis do `.env`). O frontend pode ser servido pelo `vite preview`, que encaminha `/api` para o backend:

```bash
ALLOWED_HOSTS=mikrotik.slot1.info API_URL=http://localhost:3000 npm --prefix frontend run preview -- --host 127.0.0.1
```

- `ALLOWED_HOSTS`: domínios aceitos, separados por vírgula. O padrão é `mikrotik.slot1.info`. Sem o domínio na lista, o Vite responde *"Blocked request. This host is not allowed"*.
- `API_URL`: endereço do backend (padrão `http://localhost:3000`).
- O Nginx do servidor faz o TLS e encaminha para `http://127.0.0.1:4173`.

Para produção, o recomendado continua sendo o Docker Compose: o container `web` já serve os arquivos com Nginx e não depende do Vite.

## Desenvolvimento local

Requisitos: Node 22+.

```bash
npm --prefix backend install
npm --prefix frontend install
```

Banco: use um PostgreSQL 14+ (`DATABASE_URL`) ou, sem Docker, o PostgreSQL embutido (PGlite, uma conexão por vez):

```bash
npm --prefix backend run dev:db
```

Crie `backend/.env` (exemplo para o PGlite):

```
DATABASE_URL=postgres://postgres@127.0.0.1:54330/postgres
DB_POOL_MAX=1
MASTER_KEY=<saída de: npm --prefix backend run gen-key>
COOKIE_SECURE=false
HOST=127.0.0.1
```

```bash
npm --prefix backend run create-admin -- admin "Administrador"
npm --prefix backend run dev
npm --prefix frontend run dev
```

A interface abre em http://localhost:5173 (o Vite encaminha `/api` para a porta 3000).

## Primeiros passos no sistema

1. Entre como administrador e troque a senha.
2. **Clientes** → cadastre os clientes.
3. **Equipamentos → Cadastrar** a MikroTik central, marcando “Esta é a MikroTik central” nas opções avançadas. Use **Testar conexão** antes de salvar.
4. **WireGuard** → os peers aparecem após a primeira leitura. Em cada peer: **Vincular** a um equipamento existente ou **+** para cadastrar o equipamento já com o IP sugerido do túnel.
5. **Usuários** → crie técnicos e escritório, definindo os clientes de cada um e as permissões extras.

## PPPoE por MikroTik de condomínio

O PPPoE é administrado nas MikroTiks dos clientes (condomínios), onde o servidor PPPoE autentica o roteador de cada apartamento. A central da Slot1 não participa: não é coletada, não aparece e não aceita operações de PPPoE.

- **PPPoE** lista as MikroTiks de clientes como cards, com usuários, online e desabilitados de cada uma. As que não têm servidor PPPoE ficam ocultas, com opção de mostrá-las.
- Ao abrir um condomínio (`/pppoe/:id`), você gerencia só aquela MikroTik: usuários (criar, editar, habilitar/desabilitar, excluir, ver senha), sessões ativas e perfis/servidores.
- A busca global (Ctrl+K) encontra um usuário PPPoE e abre direto o condomínio certo, já filtrado.

## Auditoria por equipamento

**Auditoria** mostra um card por equipamento com o total de registros, os registros dos últimos 7 dias, as falhas, as visualizações de senha e a última ação. Ao clicar, o histórico daquele equipamento (`/auditoria/:id`) é exibido com filtros por texto, ação e período. Os eventos que não pertencem a um equipamento (logins, usuários, clientes, notificações) ficam no card **Sistema**. O histórico de equipamentos excluídos fica preservado em **Equipamentos removidos**. A página de cada equipamento também tem um atalho **Auditoria**.

## Notificações pelo WhatsApp (WPPConnect)

1. Defina `WPP_SECRET_KEY` no `.env` e suba com `docker compose --profile whatsapp up -d`. O WPPConnect fica só na rede interna do Compose, sem porta publicada.
2. No sistema, abra **Notificações**, informe a URL `http://wppconnect:21465`, a sessão (ex.: `slot1`) e a mesma chave secreta, e ative o envio.
3. Clique em **Conectar WhatsApp** e leia o QR code em *WhatsApp → Aparelhos conectados*. A tela confirma sozinha. Recomenda-se um número exclusivo para o monitoramento.
4. Cadastre os **destinatários** (número com DDD ou grupo, que pode ser escolhido da lista do número conectado), os eventos de cada um e, se quiser, os clientes que ele acompanha. Use **Testar** para validar.

Funcionamento:

| Evento | Quando dispara |
|---|---|
| Equipamento inacessível | O status de gerência mudou para inacessível ou erro e se manteve pelo tempo configurado |
| Falha de autenticação | Usuário ou senha do roteador recusados |
| Equipamento normalizado | Voltou a responder após um problema já avisado (informa quanto tempo ficou fora) |
| Recurso acima do limite | CPU, memória ou armazenamento ≥ limite. Só volta a avisar depois de cair 10 pontos |
| Túnel sem handshake recente | O peer vinculado ficou sem handshake. Desligado por padrão, porque túnel ocioso pode ser normal |

- **Anti-oscilação:** um novo status só é avisado depois de durar o tempo configurado (padrão 2 min). Cada mudança gera no máximo uma mensagem.
- **Agrupamento:** vários alertas no mesmo ciclo viram uma mensagem por destinatário (ex.: a central caiu e derrubou vários túneis).
- **Confiabilidade:** até 3 tentativas por envio, e todo envio (com sucesso ou falha) fica em **Histórico de envios**. A chave secreta e o token são guardados cifrados. Ao ligar o envio, situações que já estavam em falha não geram avalanche de mensagens.
- **Escopo:** destinatário com clientes selecionados só recebe alertas desses clientes. A central só é avisada para quem acompanha todos os clientes.

## Perfis e permissões

As permissões são verificadas no backend em cada endpoint, por **funcionalidade** e por **escopo de cliente/equipamento**.

| Permissão | Administrador | Técnico | Escritório |
|---|:-:|:-:|:-:|
| Dashboard, clientes, equipamentos (ver) | ✔ | ✔ | ✔ |
| PPPoE: ver secrets, profiles, sessões | ✔ | ✔ | ✔ |
| PPPoE: criar / editar / habilitar-desabilitar | ✔ | ✔ | concessão individual |
| PPPoE: desconectar sessão | ✔ | ✔ | concessão individual |
| PPPoE: excluir | ✔ | concessão individual | concessão individual |
| **PPPoE: ver senha** (auditado) | ✔ | concessão individual | concessão individual |
| WireGuard: ver peers / vincular | ✔ | ✔ | — |
| Monitoramento, logs, firewall | ✔ | ✔ | concessão individual |
| Cadastrar equipamentos/credenciais, clientes | ✔ | concessão individual | — |
| Usuários do sistema, auditoria | ✔ | — | — |
| Notificações (WhatsApp) | ✔ | concessão individual | — |

- Toda permissão pode ser concedida ou removida por usuário (exceto do administrador, que é sempre completo).
- **Escopo:** “todos os clientes” ou uma lista de clientes. A MikroTik central só é visível para quem tem acesso a todos os clientes.
- O sistema impede remover ou desativar o último administrador ativo.

## Segurança

- Sessão por cookie `HttpOnly`, `SameSite=Strict` e `Secure` (em produção). O token é guardado no banco apenas como hash SHA-256. Requisições de escrita exigem o cabeçalho `X-Requested-With` (CSRF).
- Senhas de usuários com scrypt. Bloqueio temporário após tentativas inválidas, e limite de taxa no login.
- Credenciais de roteadores cifradas (AES-256-GCM). A chave vem de `MASTER_KEY_FILE`/`MASTER_KEY` e nunca do banco.
- Senhas, chaves privadas WireGuard, PSKs e segredos IPsec/RADIUS são **removidos no backend** antes do cache e da resposta. A senha PPPoE só é lida sob demanda, com a permissão `pppoe.password`, e cada visualização é auditada.
- A auditoria registra quem, quando, IP, equipamento, cliente e diferenças das alterações (**sem senhas**), incluindo tentativas que falharam.
- Conexões com roteadores: TLS preferencial, pinning opcional de certificado, timeouts de conexão e de comando, e limite global e por equipamento de conexões simultâneas.
- Nenhuma configuração do roteador é alterada automaticamente (descoberta, teste e cadastro são somente leitura).
- Alterações PPPoE conferem o item no roteador pelo nome e pelo `.id` antes de agir, o que evita mexer em item trocado entre a consulta e a ação.

## Testes

```bash
npm --prefix backend test
```

- **Unidade:** protocolo da API (codificação/fragmentação/acentos), durações v6/v7, versões, horários de log, criptografia, hash, remoção de segredos, auditoria sem senhas, permissões, ordem de métodos.
- **Integração** (PostgreSQL embutido + servidor de teste que implementa o protocolo da API RouterOS): login/CSRF, cadastro com credencial cifrada, WireGuard sem chaves privadas, vínculo de peer, dashboard, módulos e seções indisponíveis, logs com filtros, tráfego, login por desafio MD5 (v6 antigo), PPPoE completo (listar, criar, duplicidade, validação, editar com limpeza de campo, desabilitar com desconexão, excluir e desconectar com confirmação, ver senha auditada), escopo e permissões do perfil escritório, último administrador, equipamento fora do ar (dados preservados e desatualizados) e falha de autenticação.
- **Notificações** (WPPConnect de teste): configuração sem expor a chave, QR e conexão, renovação automática do token, grupos, normalização de número, envio de teste, queda e retorno avisados uma única vez, escopo por cliente, anti-oscilação, CPU alta sem repetição, nova tentativa em falha temporária e mensagem agrupada.
- **Cliente REST** contra servidor HTTPS de teste (certificado gerado na hora): leitura, criação, alteração, erros, fingerprint divergente e senha errada.

O servidor de teste valida a implementação do protocolo e os fluxos. **Não substitui** a validação em equipamentos reais (próxima etapa).

## Adicionar novos módulos

1. Em `backend/src/modules/registry.ts`, acrescente um item com `key`, `label`, `permission`, `ttlSec` e as `sections` (caminho do menu, `minVersion` se necessário).
2. O endpoint `/api/devices/:id/modules/<key>`, o cache e a aba no equipamento passam a funcionar automaticamente.
3. Opcional: defina as colunas preferidas em `frontend/src/lib/columns.ts`. Sem isso, todas as propriedades retornadas pelo roteador aparecem.
