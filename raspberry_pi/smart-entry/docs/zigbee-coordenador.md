# Coordenador Zigbee no Raspberry Pi

Atualizado em 23 de outubro de 2026.

## Escopo implementado

- `zigbee-herdsman` fixado em 11.1.1; acesso direto pelo serviço Node, sem broker MQTT.
- Raspberry Pi como coordenador usando o NovaDigital ANT-DONGLE. Driver `zstack`, com 115200 baud e sem RTS/CTS, confirmado por resposta de versão TI/ZNP no Pi: 2.7.1, revisão 20240710. O modelo exato do chip de rádio ainda não foi identificado.
- Segredos TOTP de **32 bytes**, SHA1, seis dígitos e período de 30 s, compatíveis com `TOTP_KEYLEN` do firmware. Não altera usuários existentes nem armazena os segredos no banco.
- Ferramenta de bancada com inicialização explícita, diagnóstico, pareamento limitado ao IEEE configurado e leitura do cluster Basic.
- Identidade de rede persistida: chave de rede Zigbee aleatória de **16 bytes**, Extended PAN ID, PAN ID e canal. A chave de rede tem tamanho próprio; os 32 bytes referem-se ao segredo TOTP de cada usuário.
- Pareamento fechado ao iniciar e ao encerrar. Interrupções SIGINT/SIGTERM acionam o encerramento; falhas também tentam fechar o pareamento e parar o coordenador.
- Arquivo `coordinator.lock` impede dois processos desta ferramenta de usar o mesmo diretório de estado. Outros softwares e processos com diretórios distintos precisam ser parados antes de acessar o dongle.

O servidor HTTP aceita `SMART_ENTRY_TRANSPORT=zigbee` com opt-in adicional `SMART_ENTRY_ZIGBEE_PROTOCOL=smart-entry-v1`. O `ZigbeeLockTransport`, HMAC/contador, recuperação persistente, eventos, supervisão e time-guard estão implementados no Pi. O padrão continua `fake`, pois o ESP precisa adotar a [proposta v1](protocolo-zigbee-v1.md). Nenhum deploy real foi feito nesta etapa.

## Preparação no Pi

Requisitos: Node 22.13+, pnpm 12.4.2, dependências instaladas e dongle conectado. `@serialport/bindings-cpp` precisa executar seu script de instalação, autorizado em `pnpm-workspace.yaml`. O usuário `smart-entry` já participa de `dialout` na unidade existente.

No checkout de desenvolvimento, execute `pnpm install --frozen-lockfile`. Para o Pi, siga também o procedimento de atualização e backup de [deploy-raspberry-pi.md](deploy-raspberry-pi.md).

Identifique a serial e prepare um ambiente separado para a ferramenta:

```bash
ls -l /dev/serial/by-id/
sudo install -d -o smart-entry -g smart-entry -m 700 /var/lib/smart-entry/zigbee
sudo chgrp smart-entry /etc/smart-entry
sudo chmod 710 /etc/smart-entry
sudo install -o smart-entry -g smart-entry -m 600 /opt/smart-entry/deploy/coordinator.env.example /etc/smart-entry/coordinator.env
sudoedit /etc/smart-entry/coordinator.env
```

Não sobrescreva um ambiente já preenchido. O diretório `/etc/smart-entry` era root:root 700 na instalação inicial: modo 710 com grupo `smart-entry` permite ao serviço atravessar o diretório para ler sua chave/ambiente de bancada, sem listar o conteúdo. Os ambientes de produção root:root 600 continuam sendo lidos pelo systemd. Configure a serial real e o IEEE da fechadura. O IEEE pode ser obtido do firmware/log serial do ESP; `diagnose` também lista os dispositivos que já estão na rede. Não confunda o IEEE com o endereço curto Zigbee ou com o identificador USB do dongle.

Pare Zigbee2MQTT, ZHA ou qualquer outro consumidor da mesma serial. A ponte atual com simulador não acessa o dongle.

Os comandos abaixo são executados em `/opt/smart-entry/apps/zigbee`, como `smart-entry`, usando o Node da instalação:

```bash
cd /opt/smart-entry/apps/zigbee
sudo -u smart-entry /usr/bin/node --env-file=/etc/smart-entry/coordinator.env --import tsx src/coordinator-cli.ts init 15
sudo -u smart-entry /usr/bin/node --env-file=/etc/smart-entry/coordinator.env --import tsx src/coordinator-cli.ts diagnose
sudo -u smart-entry /usr/bin/node --env-file=/etc/smart-entry/coordinator.env --import tsx src/coordinator-cli.ts pair 60
sudo -u smart-entry /usr/bin/node --env-file=/etc/smart-entry/coordinator.env --import tsx src/coordinator-cli.ts probe
```

- `init <canal>`: cria apenas a identidade local; exige diretório vazio. O exemplo usa canal 15 para bancada, que precisa estar incluído na busca da fechadura. Não execute em dongle que pertença a uma rede em uso sem planejar a migração: iniciar o coordenador aplica a identidade configurada ao rádio.
- `diagnose`: inicia o rádio, mantém pareamento fechado e mostra versão do firmware, parâmetros públicos e endpoints/clusters dos dispositivos; encerra o coordenador em seguida. Não é uma operação puramente passiva sobre um dongle ainda não configurado.
- `pair <1..180>`: abre uma janela limitada, aceita somente o IEEE configurado e informa se a entrevista terminou com sucesso. Coloque o ESP em modo de entrada na rede durante a janela. Cada execução mantém o coordenador ativo até o fim da janela, mesmo se o ESP entrar antes.
- `probe`: envia leitura de `manufacturerName` e `modelId` ao cluster Basic do endpoint 1, com timeout de 10 s. Valida requisição e resposta reais, sem acionar a porta. Os dados retornados não comprovam abertura nem persistência de usuários.

Em desenvolvimento, os mesmos subcomandos estão disponíveis por `pnpm run coordinator ...` dentro de `apps/zigbee`, com as variáveis exportadas no ambiente. No Windows a serial é uma porta como `COM3`.

## Estado e recuperação

Preserve todo `/var/lib/smart-entry/zigbee`, incluindo `network.json`, `database.db`, `database.db.backup` e `coordinator-backup.json`, junto aos backups existentes do SQLite da aplicação. Os arquivos do coordenador também contêm material sensível. No Linux, o diretório novo é criado com modo 700 e `network.json` com 600; mantenha essas permissões se criar/copiar os arquivos manualmente.

O processo nunca regenera `network.json` durante diagnóstico, pareamento ou probe. Se faltar ou estiver inválido, restaure a identidade. `init` recusa diretórios com arquivos existentes.

Após encerramento abrupto, `coordinator.lock` pode permanecer. Verifique o PID gravado e confirme que nenhum consumidor está usando a serial antes de remover **somente esse arquivo**. Não remova o diretório de dados para resolver um lock.

## Contrato proposto e ativação real

O commit `8e81312` integrou o Zigbee ao `app_main` por meio de `vCommTask`, resolvendo a duplicação anterior. O exemplo ainda define o ESP como coordenador, endpoint 1 e cluster `0xFF00` com dados sintéticos. Precisa assumir papel de dispositivo final e implementar o contrato v1.

A [proposta v1 completa](protocolo-zigbee-v1.md) define mensagens, confirmação, HMAC, contador uint32, sessão, eventos, prazo e recuperação. Foi implementada no Pi e testada com um peer simulado; ainda não foi confirmada pelo time ESP. Esta revisão usa `0xFC00` para todos os comandos e eventos, inclusive abertura, e `0x000A` para hora. Não usa PIN de Door Lock para autenticação.

Depois de implementar o firmware e validar em bancada, configure as variáveis comentadas em `deploy/zigbee.env.example`. Provisione uma chave de aplicação exclusiva de 32 bytes brutos nos dois lados, por canal físico confiável; no Pi, arquivo legível apenas por `smart-entry`, modo 600. O caminho é `SMART_ENTRY_LOCK_HMAC_KEY_PATH`. Não há distribuição automática da chave pelo rádio.

O serviço mantém pareamento fechado e faz sync no início/reconexão e a cada 30 s. O status de conexão exige resposta/evento autenticado nos últimos 90 s. Sem NTP confirmado, alterações são bloqueadas e a hora Time é inválida; sync continua disponível. O serviço e a CLI interceptam o comportamento automático de hora do herdsman. Logs do driver que poderiam conter credenciais são suprimidos.

Antes de usar `pair`, `probe` ou `diagnose` na mesma serial, pare o serviço real. Para voltar ao simulador, use `SMART_ENTRY_TRANSPORT=fake`. Não copie dados de coordenador para um diretório novo para contornar um lock.

## Validação

Testes locais cobrem identidade persistente, recusa de sobrescrita, validação da configuração, exclusão de processos concorrentes, encerramento em erros e TOTP/cadastro com 32 bytes. Typecheck e lint devem passar para `zigbee` e suas dependências.

Validação em 23/10/2026, com Node 22.23.4 no Windows: **61 testes passaram** (45 em `zigbee`, 16 em `db`), além de typecheck e lint sem warnings de `zigbee`, `db` e `shared`. Inclui peer simulado v1, vetor HMAC independente, expiração/replay, recuperação do SQLite, eventos, NTP, serialização ZCL e reconexão. O smoke da CLI confirmou criação da identidade, recusa de inicialização duplicada, exigência de IEEE no probe e preservação do arquivo de rede. O smoke do processo HTTP confirmou inicialização fake, health, cadastro/QR de 32 bytes e recusa do modo real sem opt-in do protocolo. A suíte web não foi executada nesta etapa; shutdown por sinal e integração física ainda precisam de validação no Linux/Pi.

Na instalação local, o pnpm tentou recompilar `better-sqlite3` e falhou por ausência do Windows SDK. O pacote 13.0.3 já inclui binário precompilado, que funcionou nos testes acima. A instalação completa em um ambiente Windows limpo não foi validada; a instalação e os scripts nativos no Pi também precisam ser conferidos na próxima atualização.

Identificação física concluída para serial, protocolo, versão do firmware, baud e permissões. Validação física pendente: inicialização pelo herdsman, abertura da rede, entrevista do ESP como dispositivo final, leitura Basic, reconexão USB e reinício com a mesma identidade. Registrar os resultados antes de considerar a comunicação Zigbee validada.

Referências: [API do zigbee-herdsman](https://koenkk.github.io/zigbee-herdsman/), [adaptadores zStack](https://www.zigbee2mqtt.io/guide/adapters/zstack.html).

## Inspeção por SSH em 23/10/2026

Inspeção do Pi já instalado, sem deploy do código novo e sem formar uma rede Zigbee:

- Acesso SSH inicialmente funcionou pelo mDNS `raspberrypi.local`, resolvido para IPv6 link-local `fe80::d4a2:2a1:8c05:7add` (o escopo depende da interface do computador cliente). Naquele momento o Pi não tinha IPv4 nem rota para a internet; `wlan0` estava desativada.
- Node **22.23.3**, pnpm **12.4.2**, Python **3.13.5**, arquitetura `aarch64`.
- USB **10c4:ea60**, interface **CP2102N**, driver Linux `cp210x`, serial `/dev/ttyUSB0`.
- Caminho estável confirmado: `/dev/serial/by-id/usb-Silicon_Labs_CP2102N_USB_to_UART_Bridge_Controller_1e47e42fc528f111a0b245adfa551895-if00-port0`.
- Usuário `smart-entry` pertence ao grupo `dialout`; leitura e escrita na serial verificadas como esse usuário. Nenhum processo foi identificado usando a serial no momento da consulta.
- `smart-locker-web`, `smart-locker-zigbee` e Caddy estavam ativos após o boot. `/health` respondeu `{"ok":true,"lockConnected":true}` usando a instalação anterior com simulador; isso não comprova conexão Zigbee real. O herdsman ainda não estava instalado no serviço do Pi.
- O relógio do Pi marcava **16/10/2026**, com `NTPSynchronized=no` e serviço NTP ativo, sem conectividade externa. A data de referência desta sessão é **23/10/2026**. Não se deve usar esse relógio para sincronizar o TOTP da fechadura até o NTP ser validado.
- A consulta de versão TI/ZNP não recebeu resposta válida em 115200, 230400 ou 460800 baud sem RTS/CTS. Isso **não identifica o chipset** e não basta para descartar ZNP: ainda precisamos investigar protocolo, inicialização e eventual bootloader. CP2102N é a ponte USB/serial, não o rádio Zigbee.
- A conexão SSH foi interrompida durante a tentativa de identificar o protocolo Silicon Labs ASH. O resultado dessa tentativa não foi obtido. Nome mDNS e IPv6 deixaram de responder nas tentativas seguintes.

Após restabelecer acesso e aguardar três segundos de inicialização da serial, a consulta **SYS_VERSION** recebeu resposta válida, com checksum verificado: `transportrev=2`, `product=1` (família ZStack3x0 na enumeração do herdsman), `majorrel=2`, `minorrel=7`, `maintrel=1`, `revision=20240710`. Isso confirma **TI ZNP, driver zstack, 115200 baud e RTS/CTS desativado**. A ausência de resposta nas primeiras tentativas não comprovava incompatibilidade; o atraso antes da consulta resolveu a identificação. A consulta não comprova o modelo exato do rádio nem a formação de rede.

Pendente: instalar/validar as ferramentas de bancada no Pi e testar com o ESP como dispositivo final. Não foi alterada a configuração dos serviços, a identidade persistida da rede, o firmware ou o banco da aplicação.

### Logs após reinício solicitado pelo responsável

O SSH voltou após o reinício. O journal só possui o boot atual, pois `/usr/lib/systemd/journald.conf.d/40-rpi-volatile-storage.conf` define `Storage=volatile`; os logs do boot anterior não foram preservados.

No boot observado, o link Ethernet estava ativo a **1000 Mb/s full duplex**, MAC `b8:27:eb:e5:81:69`. O NetworkManager iniciou DHCP aos 27 s de uptime e falhou aos 73 s com `ip-config-unavailable` e `Activation: failed`. Uma nova tentativa falhou aos 118 s, com `state changed no lease`. A interface permaneceu sem IPv4/gateway, apenas com IPv6 link-local. O responsável confirmou conexão a um roteador/switch.

Essas tentativas e reativações explicam uma hipótese concreta para a perda do IPv6/mDNS/SSH: a rede não entrega configuração IP, e o NetworkManager alterna entre tentativa e falha. Não há logs anteriores para provar que essa foi a causa de toda a interrupção anterior. Conferir servidor DHCP, porta/VLAN e eventual cadastro do MAC; um switch sozinho não fornece DHCP.

O Wi-Fi está bloqueado por software (`rfkill`: soft blocked, sem bloqueio físico). Não foi reativado durante o diagnóstico. `vcgencmd get_throttled` retornou `0x0`; havia cerca de 500 MiB de memória disponível, swap sem uso e 21 GiB livres no cartão. Nos logs disponíveis não foram encontrados OOM, erros de cartão, subtensão ou desconexões/reset de USB. Os três serviços da aplicação permaneciam ativos. Não foram modificados o perfil de rede nem a configuração do journal.
