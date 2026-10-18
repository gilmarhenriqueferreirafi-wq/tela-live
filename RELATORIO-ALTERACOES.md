# Tela Live — relatório das alterações

Este documento resume o que foi alterado no Tela Live desde o início da correção do transmissor de tela.

## Objetivo do projeto

Aplicação local Node.js/Express para compartilhar a tela entre amigos, com:

- login por conta e senha;
- usuários `admin`, `host` e `viewer`;
- transmissão de tela e áudio;
- acesso pelo navegador no computador e no telefone;
- armazenamento local, sem banco de dados online;
- comunicação de mídia em tempo real usando WebRTC.

## Arquivos alterados

### `server.js`

- Consolidado o fluxo de contas em `contas.json`.
- Removido o fluxo antigo baseado somente em `config.json`.
- A criação inicial de `contas.json` usa os dados administrativos do `config.json` quando disponíveis.
- Criada a conta administrativa inicial:

  - usuário: `gilmar`;
  - senha inicial: `gil18092010`;
  - papel: `admin`;
  - transmissão: habilitada.

- Senhas armazenadas com hash SHA-256 usando o prefixo interno do projeto.
- Adicionado limite de 8 tentativas de login por IP em uma janela de 1 minuto.
- Mantidos logs locais em `log-acessos.csv`.
- Removida a dependência `csv-writer`.
- CSV gravado diretamente com `fs.appendFile`.
- Mantidos os tipos de mensagem de controle do servidor:

  - `login`, `login-ok`, `login-fail`;
  - `state`, `status`, `notice`, `denied`;
  - `take-broadcast`, `start`, `stop`, `release`;
  - `frame`, compatibilidade antiga;
  - `kick`, `set-permission`, `create-user`;
  - mensagens de sinalização WebRTC.

- Permissão de transmissão pode ser alterada por administradores e hosts.
- A lista da sala informa quem pode transmitir.
- Adicionado roteamento de ofertas, respostas e candidatos ICE do WebRTC.

### `public/app.js`

- Substituído o código incorreto de servidor Node.js por JavaScript de navegador.
- Login realizado por WebSocket em `/live`.
- Exibição de erros de senha e conta.
- Login lembrado no `localStorage` do dispositivo.
- Bloqueio de tentativas duplicadas enquanto o WebSocket ainda está conectando.
- Botão de logout que:

  - encerra a transmissão;
  - fecha conexões WebRTC;
  - remove o login salvo;
  - retorna para a tela de login.

- Compartilhamento de tela iniciado diretamente pelo clique do usuário, permitindo que o navegador mostre a janela de seleção.
- Transmissão migrada de JPEG via WebSocket para WebRTC.
- Áudio e vídeo enviados pelo mesmo fluxo WebRTC para melhorar a sincronização.
- Ajustes de baixa latência:

  - `playoutDelayHint = 0` quando suportado;
  - `jitterBufferTarget = 0` quando suportado;
  - prioridade para manter a taxa de quadros;
  - bitrate de vídeo configurado;
  - captura ideal de até 60 FPS e largura de até 1920 pixels.

- Botão para ativar áudio no telefone quando o navegador bloqueia autoplay com som.
- Botão de tela cheia usando modo interno da página para evitar o aviso visual do Android/Chrome.
- Botões `Sim/Não` ao lado dos usuários da sala para alternar permissão de transmissão.

### `public/index.html`

- Adicionada opção “lembrar login neste dispositivo”.
- Adicionado botão de logout.
- Adicionado botão de tela cheia.
- Adicionado botão “Ativar áudio”.
- Mantidos controles de qualidade, FPS, largura e áudio do sistema.
- Mantido o painel de usuários conectados.

### `public/style.css`

- Criado estilo completo para a tela de login.
- Corrigido o problema em que o formulário permanecia visível depois do login.
- Corrigido o ícone quebrado e o texto duplicado da tela compartilhada.
- Adaptação visual para telas de telefone.
- Layout responsivo para o painel do host e a tela de transmissão.
- Estilos para permissões `Sim/Não`, logout, áudio e tela cheia.

### `usuarios.js`

- Corrigido o uso inválido de `return` no nível do módulo.
- Usuários `viewer` agora são criados sem permissão de transmissão.
- Usuários criados com `host` ou `transmitir` recebem permissão de transmissão.
- O utilitário também usa os dados do `config.json` ao criar a conta inicial.

### `iniciar.bat`

- Continua sendo o inicializador oficial do projeto.
- Verifica Node.js e dependências.
- Mostra os endereços locais.
- Antes de iniciar, encerra somente uma instância anterior do `node` escutando na porta `3000`.
- Mantém a abertura da porta 3000 no firewall.

## Contas e permissões

Criar viewer:

```bat
node usuarios.js add maria senha123 viewer
```

Criar host:

```bat
node usuarios.js add joao senha123 host
```

Listar contas:

```bat
node usuarios.js list
```

Trocar senha:

```bat
node usuarios.js pass gilmar NOVA_SENHA
```

Permitir ou negar transmissão:

```bat
node usuarios.js allow maria
node usuarios.js deny maria
```

Bloquear ou desbloquear conta:

```bat
node usuarios.js block maria
node usuarios.js unblock maria
```

## Arquivos locais gerados

### `contas.json`

Armazena localmente as contas, hashes de senha, papéis, permissões e status ativo.

### `log-acessos.csv`

Armazena localmente:

- data e hora;
- conta;
- IP;
- porta;
- papel;
- login aceito ou recusado;
- motivo;
- tempo conectado.

Pode ser aberto no Excel ou em outro editor de planilhas.

## Como iniciar

Recomendado:

```bat
iniciar.bat
```

Ou diretamente:

```bat
node server.js
```

No computador do proprietário:

```text
http://localhost:3000
```

Na rede local, usar o IP do computador:

```text
http://192.168.3.13:3000
```

## Tailscale

Para acessar de outra cidade sem abrir portas diretamente no roteador:

1. Instalar Tailscale no computador Windows.
2. Instalar Tailscale nos telefones.
3. Colocar os dispositivos na mesma tailnet.
4. Ativar a VPN do Tailscale no telefone.
5. Conferir no PC:

```powershell
tailscale status
```

6. Abrir no telefone o IP Tailscale do PC:

```text
http://100.92.100.33:3000
```

O telefone deve aparecer no comando `tailscale status`. Se aparecer somente o computador, o telefone ainda não entrou na mesma tailnet.

O aplicativo Tailscale deve estar na tela principal e conectado. A seção “Mullvad exit nodes” não é necessária.

Também foi liberada a porta local no Firewall do Windows:

```powershell
New-NetFirewallRule -DisplayName "Tela Live Tailscale" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 3000 -Profile Any
```

## Testes realizados

- Verificação sintática de `server.js`.
- Verificação sintática de `usuarios.js`.
- Verificação sintática de `public/app.js`.
- Criação inicial de `contas.json`.
- Confirmação de senha armazenada com hash.
- Criação de viewer sem permissão de transmissão.
- Criação de host com permissão de transmissão.
- Login com senha errada retornando `login-fail`.
- Login correto retornando `login-ok`.
- Administrador assumindo a transmissão.
- Geração local de `log-acessos.csv`.
- Teste inicial de acesso pelo IP local.

## Observações importantes

- O áudio do sistema depende do navegador e da fonte selecionada na janela de compartilhamento. No Chrome/Edge, compartilhar uma aba ou uma fonte que ofereça “compartilhar áudio” costuma ser mais confiável.
- Em cidades diferentes, o Tailscale precisa estar conectado nos dois dispositivos. O WebRTC não funcionará entre redes distintas se os dispositivos não conseguirem alcançar um ao outro.
- Para acesso público sem Tailscale, seria necessário configurar STUN/TURN, redirecionamento de portas e, para `getDisplayMedia`, considerar HTTPS.
- O `localStorage` guarda o usuário e a senha localmente no dispositivo quando “lembrar login” está marcado. Para remover, use o botão **Sair**.
- A transmissão é P2P via WebRTC entre host e viewer; o servidor Node.js funciona como servidor local, autenticação e sinalização.
