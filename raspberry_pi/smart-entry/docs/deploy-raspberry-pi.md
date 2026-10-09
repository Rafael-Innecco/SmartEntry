# Deploy no Raspberry Pi

Este roteiro instala a web e a ponte com **fechadura simulada**. O transporte ZigBee real ainda não está implementado. Os arquivos em `deploy/` foram usados na primeira instalação em Debian 13 arm64, no Raspberry Pi 3B+.

## Primeira instalação · 9 de outubro de 2026

- Raspberry Pi 3 Model B Plus Rev 1.4, Debian 13 (trixie), `aarch64`, cerca de 1 GB de RAM e 904 MiB de swap.
- Código em `/opt/smart-entry`, dados em `/var/lib/smart-entry`, ambientes em `/etc/smart-entry` com modo 600; execução como `smart-entry`.
- Acesso em `https://raspberrypi.local` e `https://192.168.0.141`. O Caddyfile desta instalação usa esses dois endereços; o hostname do Pi foi mantido. O IP pode mudar se o roteador alterar a concessão DHCP.
- 50 testes, typecheck, lint e build passaram no Pi. Login por HTTPS, páginas de usuários/acessos, API autenticada e cookies `HttpOnly`, `Secure`, `SameSite=Strict` verificados a partir do computador.
- O painel usa a senha solicitada pelo responsável, armazenada somente como hash scrypt. A chave de sessão foi gerada para esta instalação.
- O certificado público raiz foi exportado para `/home/smentrywifi/SmartEntry-root.crt`, para instalação nos dispositivos que acessam o painel. A chave privada permanece no Pi.
- Reboot real executado: novo boot confirmado e web, ponte e Caddy voltaram automaticamente, com health respondendo.

Testes de atualização, queda de energia e integração ZigBee real continuam pendentes.

Uma [captura do painel no navegador](captura_de_tela.PNG) registra o primeiro acesso no computador. O aviso de certificado visível nessa captura indica que o navegador ainda não confiava na autoridade local do Caddy; instalar o certificado público raiz no dispositivo resolve essa etapa de confiança. A captura não substitui a validação completa do cadastro, QR e layout no celular.

## Pré-requisitos

Raspberry Pi OS/Debian 64-bit, acesso SSH e Node 22.13+ disponível em `/usr/bin/node`. Confira `uname -m` (esperado: `aarch64`), `node --version` e `command -v node`. Se o Node estiver em outro caminho, ajuste `ExecStart` nas duas unidades. Instale uma versão compatível de Node seguindo a [distribuição oficial](https://nodejs.org/en/download), sem copiar `node_modules` do Windows.

No Debian 13 deste Pi, o pacote padrão era Node 20. A instalação foi feita com Node 22 pelo repositório [NodeSource](https://github.com/nodesource/distributions/blob/master/DEV_README.md), usando `setup_22.x`, seguido de `apt install nodejs`. Versões verificadas: Node 22.23.3, npm 10.9.9 e pnpm 12.4.2.

No Pi:

```bash
sudo apt update
sudo apt install build-essential python3 rsync sqlite3 caddy avahi-daemon
sudo npm install -g pnpm@12.4.2
pnpm --version
sudo useradd --system --user-group --home-dir /var/lib/smart-entry --no-create-home --shell /usr/sbin/nologin smart-entry
sudo usermod -aG dialout smart-entry
sudo install -d -o root -g root -m 700 /etc/smart-entry
sudo install -d -o smart-entry -g smart-entry -m 700 /var/lib/smart-entry
```

Execute `useradd` apenas na primeira instalação. O grupo `dialout` será necessário para o dongle. O hostname usado pelo Caddy é `smartentry.local`: configure esse nome no Pi com `sudo hostnamectl set-hostname smartentry` e reinicie o `avahi-daemon`, ou troque o endereço no Caddyfile pelo IP/nome que seus clientes conseguem resolver.

## Código e build

Os comandos abaixo partem de um checkout atualizado de `raspberry_pi/smart-entry` no Pi. Na primeira instalação, copie o conteúdo para `/opt/smart-entry`; mantenha dados e segredos fora desse diretório:

```bash
sudo install -d -o "$(id -un)" -g "$(id -gn)" -m 755 /opt/smart-entry
rsync -a --exclude=node_modules --exclude=.next --exclude=.turbo --exclude=.git --exclude='.env*' --exclude=data ./ /opt/smart-entry/
cd /opt/smart-entry
pnpm install --frozen-lockfile
pnpm run test
pnpm run typecheck
pnpm run lint
pnpm exec turbo run build --filter=zigbee
SMART_ENTRY_LOW_MEMORY_BUILD=1 NODE_OPTIONS=--max-old-space-size=512 pnpm --dir apps/web run build:pi
```

Mantenha as dependências de desenvolvimento nesta primeira versão: elas são usadas no build e nos checks. `apps/zigbee` roda o TypeScript diretamente com `tsx` (dependência de execução); seu `build` valida tipos sem emitir JavaScript. Os pacotes compartilhados também exportam TypeScript. A web usa `next build --webpack` no Pi (`build:pi`) e `next start`. A variável `SMART_ENTRY_LOW_MEMORY_BUILD=1` limita o build a um worker e ativa as otimizações de memória do Webpack; o build padrão e o desenvolvimento continuam disponíveis.

No Pi 3B+ com 905 MiB de RAM e 904 MiB de swap, o primeiro build com Turbopack foi encerrado pelo OOM killer (código 137), mesmo com limite de heap. Por isso o roteiro usa Webpack e um worker. Se ainda faltar memória, ajuste a memória/swap disponível antes de tentar novamente. O binário de `better-sqlite3` deve ser instalado ou compilado no próprio Linux arm64.

## Segredos e serviços

Gere a senha interativamente, sem colocá-la na linha de comando:

```bash
cd /opt/smart-entry/apps/web
pnpm hash-password
sudo install -o root -g root -m 600 /opt/smart-entry/deploy/web.env.example /etc/smart-entry/web.env
sudo install -o root -g root -m 600 /opt/smart-entry/deploy/zigbee.env.example /etc/smart-entry/zigbee.env
sudoedit /etc/smart-entry/web.env
```

Cole `ADMIN_PASSWORD_HASH` e `SESSION_SECRET` gerados no arquivo. Os exemplos vazios não funcionam como credenciais. O systemd lê os arquivos como root e entrega o ambiente aos processos; o usuário do serviço não precisa ler `/etc/smart-entry`.

```bash
sudo chown -R root:root /opt/smart-entry
sudo chown -R smart-entry:smart-entry /opt/smart-entry/apps/web/.next
sudo install -o root -g root -m 644 /opt/smart-entry/deploy/smart-locker-web.service /etc/systemd/system/smart-locker-web.service
sudo install -o root -g root -m 644 /opt/smart-entry/deploy/smart-locker-zigbee.service /etc/systemd/system/smart-locker-zigbee.service
sudo systemd-analyze verify /etc/systemd/system/smart-locker-web.service /etc/systemd/system/smart-locker-zigbee.service
sudo systemctl daemon-reload
sudo systemctl enable --now smart-locker-zigbee smart-locker-web
```

Antes de substituir uma configuração existente do Caddy, guarde uma cópia e incorpore o bloco do SmartEntry se o Pi já hospeda outros sites. Em um Pi dedicado:

```bash
sudo install -o root -g root -m 644 /opt/smart-entry/deploy/Caddyfile /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl enable --now caddy
sudo systemctl reload caddy
```

`tls internal` emite certificados pela autoridade local do Caddy. Instale **apenas o certificado público raiz** nos dispositivos usados para acessar o painel; não copie a chave privada. Na instalação padrão do serviço, o certificado fica em `/var/lib/caddy/.local/share/caddy/pki/authorities/local/root.crt`. Confira o caminho no Pi e transfira por SSH. A confiança precisa ser configurada também no celular, conforme seu sistema. Referência: [TLS do Caddy](https://caddyserver.com/docs/caddyfile/directives/tls).

## Verificação no Pi

```bash
systemctl is-active smart-locker-web smart-locker-zigbee caddy
curl --fail http://127.0.0.1:4000/health
curl --fail --cacert /caminho/para/root.crt https://smartentry.local/login
sudo ss -tlnp
sudo stat -c '%a %U:%G %n' /etc/smart-entry/*.env /var/lib/smart-entry
sudo journalctl -u smart-locker-web -u smart-locker-zigbee -n 100 --no-pager
```

Esperado: web em `127.0.0.1:3000`, ponte em `127.0.0.1:4000`, Caddy em 443 e 80 (redirecionamento para HTTPS); ambientes com modo 600 e dados em diretório 700. O Caddy pode ter uma porta administrativa em loopback. Substitua o caminho do certificado no `curl` pelo local onde o copiou.

No navegador: login, cadastro e leitura do QR, renomeação, remoção, sync, destravamento e acessos. Confira os cookies `HttpOnly`, `Secure` e `SameSite=Strict`. Reinicie com `sudo reboot` e confirme que tudo volta sem login SSH.

Se um cadastro/remoção exceder o timeout, aguarde o comando terminar e faça sync. Um cadastro confirmado tarde não entrega QR: remova o slot encontrado e cadastre novamente. Enquanto a operação ainda estiver pendente, alterações e sync retornam conflito. Leituras continuam disponíveis. Um transporte real deverá garantir que uma promessa encerrada não possa executar um comando mais tarde e impor um limite ao tempo de vida dos comandos.

## Atualização e recuperação

Esta primeira versão usa atualização com uma janela de indisponibilidade. Não execute outro processo da ponte contra o mesmo banco.

1. Registre a revisão em execução (`git rev-parse HEAD` no checkout de origem) e mantenha o código dessa revisão para rollback.
2. Pare `smart-locker-web` e `smart-locker-zigbee` com `sudo systemctl stop smart-locker-web smart-locker-zigbee`.
3. Faça backup consistente do SQLite antes da atualização:

   ```bash
   sudo install -d -o root -g root -m 700 /var/backups/smart-entry
   sudo sqlite3 /var/lib/smart-entry/smart-entry.sqlite3 ".backup '/var/backups/smart-entry/before-update.sqlite3'"
   sudo chmod 600 /var/backups/smart-entry/before-update.sqlite3
   ```

   Guarde também uma cópia protegida de `/etc/smart-entry` e da configuração/autoridade do Caddy. Preserve o backup anterior antes de reutilizar esse nome.
4. Libere a árvore de código para o usuário de deploy (`sudo chown -R "$(id -un):$(id -gn)" /opt/smart-entry`), atualize o código e execute install, checks e build. Evite sobrepor arquivos removidos: use um checkout limpo da revisão desejada. Preserve `/var/lib/smart-entry` e `/etc/smart-entry`.
5. Reaplique os proprietários e arquivos systemd/Caddy como na instalação, sem sobrescrever os ambientes preenchidos. Inicie os serviços e repita as verificações.
6. Se falhar, volte ao código anterior e reinstale/build. **Não restaure automaticamente um banco antigo:** o contador HMAC pode regredir quando o transporte real existir. Migrações também podem impedir rollback do código; avalie a compatibilidade antes de atualizar.

Sync recupera ocupação dos slots e indicadores TOTP/RFID, mas não recupera nomes, histórico ou contador HMAC. Se o banco for perdido, o transporte real exigirá um procedimento acordado de re-pareamento/ressincronização de contador; um backup antigo sozinho não resolve isso.

Para validar queda de energia, use um cenário de teste com backup, registre a revisão e o estado anterior, provoque a queda durante sync e confira integridade (`PRAGMA integrity_check`), usuários, inicialização dos serviços e contador. Não considere esse item concluído apenas porque um reboot normal funcionou.
