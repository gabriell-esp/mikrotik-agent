# Integração UniFi (Cloud Key / UniFi Network Application)

O sistema acessa a API do **UniFi Network Application** de cada controladora:

| Tipo | Endereço no cadastro | Observação |
|---|---|---|
| **UniFi OS** (Cloud Key Gen2, Gen2 Plus, UDM, UDR…) | `https://IP` (porta 443) | Login em `/api/auth/login`; dados em `/proxy/network/...` |
| **Controlador clássico** (software antigo, porta 8443) | `https://IP:8443` | Login em `/api/login` |

O tipo é **detectado automaticamente** no primeiro login e lembrado. A sessão é reaproveitada entre as leituras, para não gerar um login por consulta, e renovada sozinha quando expira.

## Formas de acesso

No cadastro você escolhe entre duas formas de acesso:

| | **Usuário e senha** | **API key** (API oficial) |
|---|---|---|
| Requisito | Usuário **local**, sem verificação em duas etapas | UniFi Network **9.0+** (redes Wi-Fi: **10.0+**) |
| Ver antenas, clientes, firmware, uptime | ✔ | ✔ (inclui CPU e memória) |
| Sinal, SSID e velocidade de cada cliente | ✔ | — |
| Reiniciar antena | ✔ | ✔ |
| Localizar (LED) e atualizar firmware | ✔ | — |
| Reconectar / bloquear / desbloquear cliente | ✔ | — |
| Ver e ativar/desativar redes Wi-Fi | ✔ | ✔ (Network 10+) |

A tela de cada controladora mostra somente as ações disponíveis na forma de acesso usada. Se precisar das ações completas numa controladora cadastrada por API key, edite o cadastro e troque para usuário e senha.

**Para criar a API key:** no UniFi Network da controladora, abra *Settings → Control Plane → Integrations* (em versões anteriores: *Settings → System → Integrations*) e clique em **Create API Key**. Copie a chave na hora, porque ela só é exibida uma vez. A chave fica com as permissões do administrador que a criou. Ela é guardada cifrada, como as senhas.

Pela API key o sistema usa a *UniFi Network Integration API* (`/proxy/network/integration/v1` no UniFi OS ou `/integration/v1` no controlador instalado em servidor), com o cabeçalho `X-API-KEY`.

## O que o sistema faz

- **Leitura (a cada 60 s, `UNIFI_POLL_INTERVAL_SEC`):** sites, dispositivos (antenas, switches, gateways), clientes conectados, clientes bloqueados, redes Wi-Fi e saúde. Se a controladora cair, a última leitura continua visível, marcada como desatualizada.
- **Ações** (permissão "Controlar UniFi"; sempre com confirmação e registradas na auditoria):
  - **Antena:** localizar (piscar o LED), reiniciar, atualizar firmware.
  - **Cliente:** reconectar (kick), bloquear, desbloquear.
  - **Rede Wi-Fi:** ativar ou desativar.
- **Segurança:** a senha ou a API key da controladora fica cifrada (AES-256-GCM, chave fora do banco). **Senhas de Wi-Fi e chaves dos dispositivos não são lidas nem armazenadas**, porque os campos `x_*` são descartados no backend. O cadastro e o teste de conexão são somente leitura.

## Preparação de cada controladora

1. **Credencial.** Use uma API key (ver acima) ou **crie um usuário local dedicado** na controladora. Em UniFi OS: *Settings → Admins & Users → Add Admin*, marque **Restrict to Local Access Only**, dê um nome (ex.: `slot1-sistema`) e uma senha forte.
   - Função **Site Admin** (ou Super Admin) para usar as ações. Com **View Only** o sistema só consegue ler, e as ações retornam "sem permissão".
   - **Não use conta Ubiquiti (SSO) com verificação em duas etapas.** O login automático não consegue responder ao MFA.
2. **Endereço acessível pelo servidor.** O caminho é o mesmo das MikroTiks, pelo túnel WireGuard. Use uma das opções:
   - **Rota para a rede do cliente:** inclua a rede local do condomínio (ex.: `192.168.10.0/24`) no `allowed-address` do peer na central e, no peer da central dentro da MikroTik do cliente, a origem do servidor (ou o NAT da central, ver [ROUTEROS.md](ROUTEROS.md)). Cadastre o IP local da Cloud Key (ex.: `https://192.168.10.5`).
   - **Encaminhamento de porta na MikroTik do cliente:** `dst-nat` do IP do túnel para a Cloud Key. Por exemplo, `https://10.200.0.5:8443` encaminhado para `192.168.10.5:443`. Restrinja a origem ao IP do servidor/central.
   ```routeros
   /ip firewall nat add chain=dstnat in-interface=wg-slot1 dst-address=10.200.0.5 protocol=tcp dst-port=8443 src-address=10.200.0.1 action=dst-nat to-addresses=192.168.10.5 to-ports=443 comment="Slot1 -> Cloud Key"
   ```
3. **(Opcional) Fingerprint:** a Cloud Key usa certificado autoassinado. Para fixá-lo, copie o SHA-256 do certificado (no navegador: cadeado → certificado → impressão digital SHA-256) para o campo "Fingerprint" do cadastro.

## Solução de problemas

| Mensagem | Causa provável |
|---|---|
| "Usuário ou senha recusados" | Credencial errada ou conta não local. |
| "A conta exige verificação em duas etapas" | Conta SSO com MFA. Crie um usuário **local**. |
| "Muitas tentativas de login" | A controladora bloqueou por excesso de tentativas. Aguarde alguns minutos. |
| "Conexão recusada" / "inalcançável" | Rota, porta ou NAT até a Cloud Key. Teste do servidor com `curl -k https://IP/`. |
| "Não respondeu como uma controladora UniFi" | URL ou porta errada (UniFi OS usa 443, o controlador clássico usa 8443). |
| "O usuário da controladora não tem permissão" | O usuário é View Only. Use Site Admin para as ações. |
| "API key recusada pela controladora" | Chave copiada errada, revogada ou criada por um administrador sem permissão. Crie outra. |
| "Não respondeu à Integration API" | UniFi Network anterior à 9.0 (atualize ou use usuário e senha), ou URL/porta errada. |
| "Esta ação não está disponível no acesso por API key" | Localizar, atualizar firmware e bloquear clientes exigem usuário e senha. |
