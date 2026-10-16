# Integração com RouterOS

## Escolha do transporte

| Método | Porta padrão | Versões | Criptografia | Observações |
|---|---|---|---|---|
| **API-SSL** (binária sobre TLS) | 8729 | v6 e v7 | Sim | **Padrão do sistema.** É o único transporte cifrado comum a todas as versões. |
| **REST** (HTTPS) | 443 (`www-ssl`) | v7.1+ | Sim | Usado quando o api-ssl não responde. Exige `www-ssl` habilitado com certificado. |
| **API** (binária, texto puro) | 8728 | v6 e v7 | **Não** | Só é usada se “permitir API sem criptografia” estiver marcado no equipamento. Aceitável apenas dentro do túnel WireGuard. |

O método **Automático** tenta, nesta ordem: API-SSL → REST → API (se liberada). O último método que funcionou é memorizado e tentado primeiro na próxima conexão. Também é possível fixar um método por equipamento.

**Por que não usar só REST?** Ele só existe a partir do v7.1. Como o parque tem versões diferentes, a API é a base comum. O REST tem a vantagem de ser HTTP padrão, e o sistema o usa quando o api-ssl estiver fechado.

### Diferenças entre versões tratadas pelo sistema

- **Login:** o RouterOS anterior ao 6.43 usa desafio MD5. O sistema detecta e responde automaticamente.
- **WireGuard:** existe só no v7. A central precisa ser v7. Em clientes v6, a aba VPN informa “Requer RouterOS 7.0”.
- **Durações:** v6 usa `1w2d03:04:05`, v7 usa `1w2d3h4m5s`. Os dois formatos são interpretados.
- **Data do log/relógio:** v6 `jan/02/2024`, v7.10+ `2024-01-02`. Os dois formatos são normalizados nos filtros de período.
- **BGP:** v6 em `/routing/bgp/peer`, v7 em `/routing/bgp/session`. A seção certa é escolhida pela versão.
- **Menus ausentes:** quando um pacote não está instalado (ex.: ipv6 no v6), o menu não existe. A seção mostra “indisponível” com o motivo, sem valores inventados.
- **Texto com acentos:** a API trafega bytes. O sistema lê UTF-8 quando válido e, caso contrário, Windows-1252/latin1 (padrão do Winbox). Ao gravar, usa latin1 sempre que possível, para manter compatibilidade com o Winbox.
- **api-ssl sem certificado:** o RouterOS negocia cifras anônimas (ADH). O sistema aceita para manter a conexão cifrada, mas sem autenticar o servidor. Recomenda-se instalar certificado e cadastrar o fingerprint.

## Preparação de cada MikroTik (fazer manualmente)

> O sistema **não altera** firewall, rotas, VPN, serviços ou usuários dos equipamentos durante a descoberta ou o cadastro. Os comandos abaixo são sugestões para você aplicar.

### 1. Grupo e usuário dedicados

RouterOS v7:

```routeros
/user group add name=slot1-gerencia policy=read,write,api,rest-api,sensitive,!local,!telnet,!ssh,!ftp,!reboot,!policy,!winbox,!password,!web,!sniff,!test,!romon
/user add name=slot1-api group=slot1-gerencia password="SENHA-FORTE" address=10.200.0.1/32 comment="Sistema Slot1"
```

RouterOS v6 (não tem a política `rest-api`):

```routeros
/user group add name=slot1-gerencia policy=read,write,api,sensitive,!local,!telnet,!ssh,!ftp,!reboot,!policy,!winbox,!password,!web,!sniff,!test,!romon
/user add name=slot1-api group=slot1-gerencia password="SENHA-FORTE" address=10.200.0.1/32 comment="Sistema Slot1"
```

- Em versões v7 que ainda não têm a política `rest-api`, o comando retorna erro de política inválida: remova-a. Se o REST responder “Autenticação recusada” com a senha correta, troque `!web` por `web` (versões iniciais do v7 exigiam `web` para o REST) ou mantenha somente o api-ssl.
- `address=` limita o login ao IP do servidor do sistema no túnel (ajuste para o seu).
- `sensitive` é necessário para **ver senhas PPPoE**. Sem ele, o campo não é retornado e a função mostra erro.
- `write` é necessário para criar/editar/remover secrets e derrubar sessões. O RouterOS não tem permissão por menu: um usuário com `write` pode alterar qualquer configuração. As restrições finas ficam no sistema (perfis e permissões).
- Para equipamentos que só serão **monitorados**, use um grupo sem `write` e sem `sensitive`. As operações de escrita retornarão “sem permissão” de forma clara.

### 2. Certificado e serviços cifrados

```routeros
/certificate add name=slot1-api common-name=slot1-api days-valid=3650 key-usage=digital-signature,key-encipherment,tls-server
/certificate sign slot1-api
/ip service set api-ssl certificate=slot1-api disabled=no address=10.200.0.1/32
# REST (somente v7.1+):
/ip service set www-ssl certificate=slot1-api disabled=no address=10.200.0.1/32
```

Para **fixar o certificado** (pinning), copie o fingerprint SHA-256 (`/certificate print detail`, campo `fingerprint` no v7) para o campo “Fingerprint SHA-256” do cadastro do equipamento.

### 3. Firewall

Se o firewall de input bloqueia por padrão, libere as portas de gerência **apenas a partir do servidor**, pela interface do túnel:

```routeros
/ip firewall filter add chain=input in-interface=wg-slot1 src-address=10.200.0.1 protocol=tcp dst-port=8729,443 action=accept comment="Slot1 gerencia" place-before=0
```

## Central WireGuard

A central é cadastrada como equipamento com “Esta é a MikroTik central” marcado. O sistema lê `/interface/wireguard` e `/interface/wireguard/peers` (somente leitura) a cada `WG_POLL_INTERVAL_SEC`. As chaves privadas e as PSK são descartadas no backend e nunca saem dele.

**Estado do peer × gerência:** o handshake indica atividade do túnel visto pela central. Sem keepalive, um túnel ocioso pode ficar sem handshake recente e continuar funcional. Por isso o status de gerência (“Gerenciável / Inacessível / Falha de autenticação”) vem **só** da tentativa real de conexão à API do equipamento.

## Endereço de gerência

Ao cadastrar a partir de um peer, o sistema sugere o primeiro IP `/32` do `allowed-address` do peer. Confirme se é o IP da MikroTik do cliente dentro do túnel. O servidor onde o backend roda precisa ter rota para essa rede (ex.: rota estática no servidor apontando para a central).

## Solução de problemas

### "SSL alert number 40" / "handshake failure" / "o roteador recusou a conexão TLS"

O RouterOS recusou a negociação TLS. Na grande maioria das vezes, o serviço `api-ssl` (ou `www-ssl`) está habilitado **sem certificado**. Corrija na MikroTik:

```routeros
/certificate add name=slot1-api common-name=slot1-api days-valid=3650 key-usage=digital-signature,key-encipherment,tls-server
/certificate sign slot1-api
/ip service set api-ssl certificate=slot1-api disabled=no
# opcional, para o REST (v7.1+):
/ip service set www-ssl certificate=slot1-api disabled=no
```

Confira com `/ip service print detail where name~"ssl"`. O campo `certificate` deve mostrar `slot1-api`. A assinatura (`sign`) pode levar alguns segundos. Aguarde aparecer a flag `K` (chave privada) em `/certificate print` antes de testar.

Se ainda falhar, verifique:
- **Versão do TLS** (v7): o padrão aceita TLS 1.2. Não restrinja a uma versão mais antiga.
- **Origem permitida:** o campo `address=` do serviço precisa incluir o IP do servidor. Se o IP não estiver liberado, o erro costuma ser de conexão recusada, não de TLS.
- **Teste sem TLS, só dentro de rede confiável:** no cadastro do equipamento, marque "Permitir API sem criptografia" para confirmar que usuário e senha estão corretos pela porta 8728. Volte para a API-SSL depois de configurar o certificado.
