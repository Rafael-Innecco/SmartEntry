# Proposta SmartEntry Zigbee v1

Contrato implementado no lado Raspberry em 23/10/2026, **pendente de adoção pelo firmware ESP32-H2**. O firmware atual de exemplo (`0xFF00`, `queryData`) não implementa este contrato. A ativação exige `SMART_ENTRY_TRANSPORT=zigbee` e `SMART_ENTRY_ZIGBEE_PROTOCOL=smart-entry-v1`. O transporte padrão continua sendo o simulador.

## Rede e ZCL

Raspberry/ANT-DONGLE é coordenador; ESP é dispositivo final. Perfil Home Automation `0x0104`, endpoint 1. O rádio confirmado usa `zstack`, 115200 baud, sem RTS/CTS. Rede persistente, chave Zigbee de 16 bytes aleatórios e ingresso fechado fora do procedimento administrativo de pareamento.

O cluster privado **`0xFC00`** transporta abertura, usuários, estado e eventos. Esta revisão substitui a proposta anterior de colocar autenticação no campo PIN de `unlockDoor`. Não são enviados comandos Door Lock `0x0101` nesta versão. O cluster padrão **Time `0x000A`** fornece a hora.

| Comando ZCL     | Direção                   | Conteúdo                                            |
| --------------- | ------------------------- | --------------------------------------------------- |
| `0x00 request`  | cliente Pi → servidor ESP | Um parâmetro `OCTET_STR` contendo envelope `kind=0` |
| `0x01 response` | servidor ESP → cliente Pi | Um `OCTET_STR` contendo envelope `kind=1`           |
| `0x02 event`    | servidor ESP → cliente Pi | Um `OCTET_STR` contendo envelope `kind=2`           |

Frames específicos de cluster, sem campo manufacturer-specific e sem código de fabricante nesta rede privada. Desabilitar default response. O `OCTET_STR` inclui **um byte de comprimento antes do envelope**; esse byte não participa do HMAC. O payload não é texto, JSON ou hexadecimal ASCII. O envelope mais longo tem 69 bytes (73 com cabeçalho ZCL e comprimento), para validação de tamanho/fragmentação na bancada. Número de sequência ZCL não substitui a correlação/autenticação da aplicação.

## Envelope binário

Todos os inteiros são unsigned little endian; o IEEE usado no HMAC é a exceção descrita abaixo. Tamanho exato: `37 + N` bytes, com `0 ≤ N ≤ 32`. Sem padding nem bytes adicionais.

| Offset | Bytes | Campo                                                      |
| ------ | ----- | ---------------------------------------------------------- |
| 0      | 1     | Versão, sempre `1`                                         |
| 1      | 1     | Kind: request `0`, response `1`, event `2`                 |
| 2      | 1     | Opcode do comando ou tipo do evento                        |
| 3      | 1     | Slot `0..9`, ou `0xFF` quando não se aplica                |
| 4      | 4     | Contador de comando; para eventos, sequência da sessão     |
| 8      | 8     | Desafio aleatório da sessão, bytes opacos                  |
| 16     | 4     | Deadline Unix UTC em segundos; zero para listSlots/eventos |
| 20     | 1     | `N`, tamanho dos dados                                     |
| 21     | N     | Dados                                                      |
| 21+N   | 16    | Tag HMAC                                                   |

Contadores começam em 1. Valores reservados/fora dos intervalos, formato incorreto e comprimento incompatível devem ser rejeitados antes de produzir efeitos. Respostas repetem **opcode, slot, contador, sessão e deadline do request**. A chave de aplicação tem 32 bytes aleatórios, exclusiva do vínculo Pi/fechadura, separada dos segredos TOTP e da chave da rede Zigbee.

```text
tag = primeiros 16 bytes de HMAC-SHA256(
  chave_de_aplicacao_32_bytes,
  ASCII("SmartEntry/v1") || 0x00 || IEEE_fechadura_8_bytes || envelope_sem_tag
)
```

Para `0x00124b0000000001`, o IEEE assinado é a sequência `00 12 4b 00 00 00 00 01` (ordem de exibição, big endian). O `kind` faz parte dos bytes assinados: um request não pode virar resposta ou evento. Comparar tags em tempo constante. Não responder a HMAC inválido; nunca registrar payload, chave, segredo ou tag em logs.

## Comandos e respostas

O primeiro byte dos dados de **toda resposta** é um resultado. Em sucesso, os bytes seguintes são os dados da tabela. Em falha, os dados contêm somente o resultado.

| Opcode        | Request                             | Sucesso após o resultado `0x00`                                           |
| ------------- | ----------------------------------- | ------------------------------------------------------------------------- |
| `1 listSlots` | Slot FF, deadline 0, sem dados      | 1 byte locked (`0` destravada, `1` travada), seguido de 10 bytes de slots |
| `2 setUser`   | Slot 0..9, 32 bytes de segredo TOTP | Sem dados; segredo já persistido antes do ACK                             |
| `3 clearUser` | Slot 0..9, sem dados                | Sem dados; credenciais do slot já removidas da memória persistente        |
| `4 unlock`    | Slot FF, sem dados                  | Um byte `0`, confirmando estado destravado após acionar o mecanismo       |

Cada byte de slot tem bit 0 ocupado, bit 1 TOTP, bit 2 RFID; demais bits zero. Slot vazio é `0`. Ocupado precisa ter pelo menos um fator: `3` TOTP, `5` RFID, `7` ambos. Não retornar nomes nem segredos em listSlots. `setUser` recusa slots ocupados. RFID não tem comando de cadastro nesta revisão.

| Resultado | Significado                        |
| --------- | ---------------------------------- |
| 0         | Sucesso                            |
| 1         | Slot ocupado                       |
| 2         | Slot vazio                         |
| 3         | Relógio da fechadura não confiável |
| 4         | Comando vencido/deadline inválido  |
| 5         | Contador repetido/antigo           |
| 6         | Payload/argumento incompatível     |
| 7         | Falha de persistência/mecanismo    |

Sucesso de abertura significa o estado que o firmware consegue confirmar. Sem sensor de posição, não afirmar que houve comprovação física da porta. Definir/validar esse limite na bancada. O rádio confirmar a entrega não é sucesso da operação. Não duplicar eventos de acesso remoto: o Pi registra essas tentativas.

## Ordem de execução e recuperação

O firmware deve serializar os comandos. Não executar um comando antigo em paralelo depois de responder a um mais novo.

1. Validar versão, campos, comprimentos, origem autorizada e HMAC.
2. Exigir contador maior que o último persistido. Para duplicata exata, pode devolver resposta final já armazenada, sem repetir efeito. Sem resposta em cache, responder replay e nunca repetir a operação.
3. Para alterações/abertura, exigir relógio confiável e `agora < deadline ≤ agora + 10 segundos`. O Pi gera deadline `hora_NTP + 8 segundos`. A diferença entre os relógios deve ser limitada a 2 s; se o firmware não puder garantir essa precisão, deve recusar alterações e solicitar hora.
4. Persistir o contador **antes do efeito e antes de qualquer resposta de sucesso**. Revalidar o deadline imediatamente antes de iniciar o efeito. Um comando expirado não pode acionar a porta, inclusive se ficou em fila Zigbee ou aguardando flash.
5. Persistir a alteração solicitada, ou acionar/confirmar abertura, e só então enviar a resposta autenticada. Em erro de flash, não confirmar sucesso.

`listSlots` também exige HMAC e contador novo, mas não exige hora válida. O firmware persiste esse contador antes de tirar o snapshot; assim, um sync posterior impede um comando anterior de executar depois dele. Só após aceitar o contador, adotar a sessão recebida para os próximos eventos.

O Pi reserva contador no SQLite antes de transmitir, com WAL e `synchronous=FULL`. Nunca reutiliza valores em falhas. O contador uint32 não faz wrap: após `4294967295`, o vínculo precisa de novo provisionamento. Backup antigo, perda do banco ou troca da chave exigem recuperação presencial coordenada dos dois lados; não zerar unilateralmente o contador nem aceitar no firmware um contador menor para "recuperar".

Antes de setUser/clearUser, o Pi persiste `lock_recovery.sync_required=1`. A marca só é limpa depois de a réplica ter sido gravada após confirmação, ou de um sync confirmado ter sido aplicado. Na inicialização/reconexão é obrigatório sincronizar; usuário já criado sem QR precisa ser removido e cadastrado novamente. O segredo não é recuperável do Pi.

Um request tem timeout próprio de 12 s; o limite HTTP continua 15 s. Não há retry de aplicação. Falha de envio, perda de confirmação ou desconexão depois de iniciar transmissão são resultados incertos. A promessa se encerra e a réplica exige sync para cadastros/remoções; deadline/contador **implementados no ESP** são necessários para impedir efeitos tardios. Um timer Node não cancela um frame já transmitido.

## Eventos e presença

Cada listSlots usa um desafio de 8 bytes novo; ele define a sessão corrente na fechadura e reinicia a sequência de eventos em 1. O Pi só aceita eventos após o listSlots autenticado correspondente. Os eventos têm deadline 0, contador crescente da sessão e HMAC da mesma chave, com kind 2.

| Tipo       | Slot                          | Dados                                                               |
| ---------- | ----------------------------- | ------------------------------------------------------------------- |
| `1 status` | FF                            | Um byte locked: 0 ou 1                                              |
| `2 access` | 0..9, ou FF para desconhecido | Dois bytes: método (0 TOTP, 1 RFID), resultado (0 sucesso, 1 falha) |

Descartar sequência repetida/menor, sessão antiga, endpoint/IEEE inesperado ou pacote inválido. Um reboot da fechadura invalida a sessão de eventos até o próximo listSlots. O Pi sincroniza no início/reconexão e a cada 30 s, impedindo que um reboot silencioso mantenha a sequência antiga indefinidamente. Eventos e logs usam horário de recebimento no Pi; não representam um timestamp assinado da ocorrência.

Conexão só é anunciada após evidência autenticada; fica desatualizada após 90 s sem resposta/evento válido. Presença do dongle ou entrada no banco herdsman não basta. O estado da porta na API é a última observação; verificar também a conectividade.

## Hora e TOTP

Segredo por usuário: 32 bytes, HMAC-SHA1, seis dígitos, período 30 s. Teclado proposto: `<slot><código>#`, tolerância ±1 período, com proteção contra reutilização do mesmo código por slot no firmware. Essa proteção e o teclado ainda precisam ser implementados/validados pelo time ESP.

Fechadura lê diretamente do coordenador endpoint 1, cluster `0x000A`, atributos `time` (0, UTC) e `timeStatus` (1, bitmap8), no boot e periodicamente para manter a precisão requerida. A frequência definitiva depende de medir a deriva do relógio; iniciar bancada com leitura a cada 5 minutos e após falha de relógio. Não aceitar hora inválida nem saltos grandes sem procedimento definido de recuperação.

O Pi consulta `timedatectl show --property=NTPSynchronized --value`, com timeout de 1,5 s, sem cache positivo. Só `yes` habilita hora válida e requests de alteração. Hora ZCL é `Unix - 946684800`; sem NTP, retorna `time=0xFFFFFFFF`, `timeStatus=0`. Com NTP, `timeStatus=3` (master + synchronized). Falta do comando, falha, sistema não Linux ou epoch fora do intervalo também desabilitam hora/alterações.

O herdsman responde hora automaticamente por padrão. O serviço e a CLI instalam `customReadResponse` antes do handler padrão, inclusive em dispositivos carregados do banco e no primeiro evento `message`. Falhas nunca voltam à hora automática. O cluster Time depende da autenticação da própria rede Zigbee; ele não recebe a assinatura deste envelope. A segurança do ingresso e da chave de rede continua necessária.

## Provisionamento e ativação

Provisionar a chave de aplicação em bancada por um canal físico confiável para a NVS do ESP e para um arquivo de 32 bytes brutos no Pi, modo 600, legível apenas por `smart-entry`. Não é um segredo TOTP e não é derivada do IEEE ou de senha humana. O procedimento físico exato é responsabilidade conjunta com o firmware; não há distribuição automática dessa chave pelo rádio nesta revisão.

Para criar uma chave nova no Pi sem mostrá-la no terminal e sem sobrescrever arquivo existente, depois de preparar as permissões de diretório de `zigbee-coordenador.md`:

```bash
sudo /usr/bin/node --input-type=module -e 'import {randomBytes} from "node:crypto"; import {writeFileSync} from "node:fs"; writeFileSync("/etc/smart-entry/lock-hmac.key", randomBytes(32), {flag:"wx", mode:0o600})'
sudo chown smart-entry:smart-entry /etc/smart-entry/lock-hmac.key
```

Se já existir uma chave, preserve-a. Rotação exige provisionar ambos os lados e combinar a recuperação do contador. Transferir a chave para o ESP pelo procedimento físico acordado, sem colocá-la em código versionado ou logs. Esses comandos não provisionam o ESP nem ativam o transporte.

Inicializar a identidade da rede e parear usando as ferramentas de [zigbee-coordenador.md](zigbee-coordenador.md). O serviço real mantém ingresso fechado; parar o serviço antes de executar a CLI na mesma serial. Configurações em `deploy/zigbee.env.example` descrevem o opt-in. Chave e contador da aplicação precisam existir nos dois lados antes do primeiro sync.

O supervisor fecha o controlador anterior antes de reconectar, com espera inicial de 1 s e limite de 30 s. Falha de cleanup ou startup incompleto encerra o processo para recuperação pelo systemd; não abre outro controlador sobre recursos incertos. Após SIGINT/SIGTERM, recusa novas conexões HTTP, encerra o rádio e limita a finalização a 10 s. Queda abrupta pode deixar `coordinator.lock`; verificar que não há processo usando a serial e remover somente esse arquivo antes de reiniciar. Não há recuperação automática de lock abandonado nesta revisão.

## Vetor de interoperabilidade

O arquivo [`lock-protocol-v1.json`](../apps/zigbee/src/fixtures/lock-protocol-v1.json) usa **chave fixa de teste**, calculada também com Python `hmac`, `hashlib` e `struct`. O teste TypeScript exige igualdade byte a byte. Usar esse vetor em um teste C antes de ligar o mecanismo.

Parâmetros: kind 0, setUser (2), slot 3, contador `0x01020304`, sessão `a0a1a2a3a4a5a6a7`, deadline Unix `1800000008`, dados `20..3f` hexadecimal. A tag esperada é `ee9f1c3bf6230f3faa327b61055d0a21`. O fixture inclui chave, IEEE e envelope completo. Nunca usar essa chave em uma instalação.

Validação simulada cobre autenticação, adulteração de todos os bytes, correlação, replay, prazo, ACK perdido, persistência/reabertura do SQLite, sync, eventos, NTP, serialização ZCL real do herdsman e supervisão. Ela não comprova implementação do firmware, comportamento das filas do rádio, precisão do relógio, consumo em sleep, tempo da flash ou atuação física. Esses itens exigem os testes de bancada com a rede estabilizada.
