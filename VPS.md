# Instalação na VPS

O processo Node deve rodar como usuário da aplicação, escutando somente em 127.0.0.1. O OpenLiteSpeed encaminha o domínio por HTTPS. Nunca exponha o repositório inteiro como arquivos estáticos: o servidor Node mantém uma lista explícita de arquivos públicos.

Use Node 24 LTS e `npm ci`. Execute `node server.mjs` com o diretório de trabalho na raiz do projeto. Supervisor mantém o processo em execução.

Variáveis privadas em `.env` (permissão 600):

- `APP_ORIGIN=https://app.arkaconteudo.com`
- `PORT=18888`
- `DATA_DIR`: pasta persistente fora de public_html e do repositório.
- `STORAGE_SECRET`: 32 bytes aleatórios em hexadecimal, necessários para decifrar chaves de API. Faça backup desta variável separado do código.
- `SETUP_TOKEN`: 32 bytes aleatórios em hexadecimal para a primeira ativação.

Abra `/activate.html#TOKEN` para definir o administrador. A ativação só funciona enquanto não existe um administrador. O token vai no fragmento da URL, não no log HTTP. Senhas são armazenadas como hash scrypt; sessões usam cookie HttpOnly, Secure e SameSite=Strict. A conta inicial é única; não há cadastro público.

SQLite guarda prompts, modelos, sessões, chaves criptografadas AES-256-GCM, imagens binárias e metadados. A galeria funciona entre dispositivos. Exclusão remove imagem e metadados do banco ativo; backups mantêm cópias até sua retenção expirar. As chaves nunca são devolvidas pelo endpoint de configurações.

Pedidos de geração são processados em segundo plano, no máximo dois lotes simultâneos. Imagens são persistidas no servidor assim que recebidas, mesmo que a aba seja fechada. Após reinício, pedidos interrompidos são marcados como concluídos com aviso; não são reenviados automaticamente para evitar cobrança duplicada. O histórico de imagens não expira. Consultas temporárias do lote expiram em 24 horas.

Use backup consistente de SQLite (API de backup, não cópia do arquivo aberto sem WAL) e proteja as cópias. Um backup no mesmo disco protege contra exclusões, mas não contra perda da VPS. Dados do navegador antigo não são migrados automaticamente; imagens podem ser importadas e prompts copiados pela biblioteca.

Após atualizar pelo Git, execute `npm ci`, testes e `supervisorctl restart adstudio`. Não apagar DATA_DIR nem trocar STORAGE_SECRET. A configuração de proxy deve permanecer no include personalizado do domínio para evitar sobrescrita pelo painel.

Verificação: `node --test`. Os testes usam imagens e provedores simulados, sem chamadas pagas.

## Aplicação Google Ads

Rotas privadas: `/apps/google-ads/` (análise) e `/apps/google-ads/criar` (criação assistida). Ambas reutilizam a sessão do workspace. As APIs `/apps/google-ads/api/*` exigem sessão e os POSTs exigem a origem da aplicação. Apenas cinco arquivos JS/CSS da nova aplicação são públicos; HTML privado, módulos do servidor e credenciais não são servidos.

Adicione a `runtime.env` existente, preservando todas as variáveis:

```sh
GOOGLE_ADS_CREDENTIALS_FILE=/home/YSS5v8CvMVTud6Ve/apparkaconteudocom/google-ads-service-account.json
GOOGLE_ADS_API_VERSION=v25
```

Transfira o JSON da conta de serviço por SSH/SFTP para esse caminho, fora de `public_html`, com proprietário do usuário da aplicação e permissão 600. Nunca o envie ao Git. A conta de serviço precisa ter acesso às contas/MCCs no Google Ads. Não troque `STORAGE_SECRET`; as chaves de IA existentes são reutilizadas pelo cofre criptografado.

A aplicação cria apenas as tabelas `google_ads_drafts`, `google_ads_assets`, `google_ads_jobs` e `google_ads_settings` no SQLite existente. Rascunhos, revisões, imagens e resultados persistem; relatórios são consultados via API com cache em memória de cinco minutos e contas de dez minutos. O botão Atualizar ignora o cache do relatório. Não existe coleta histórica automática.

A análise apresenta campanha, orçamento, custo, taxa de conversão, custo por conversão e CPC. O criador suporta Pesquisa com anúncios responsivos e Display com dois formatos de imagem. Performance Max, Demand Gen e criação por chat ainda não estão implementados. O fluxo salva, gera opcionalmente por IA, permite edição, valida sem criar recursos e cria a campanha **pausada** após a ação explícita do usuário. Uma resposta incerta durante o envio bloqueia repetição automática; confira o Google Ads antes de criar outro rascunho. A revisão de políticas ocorre no Google após a criação.

Gerações utilizam os provedores e as chaves já configurados no estúdio. Briefing e conteúdo público da URL, quando a leitura estiver selecionada, são enviados ao provedor escolhido. A leitura valida DNS e cada redirecionamento para bloquear endereços privados. Dados de desempenho e a credencial Google não são enviados à IA.

## Atualizar a instalação existente

1. Confira `git status --short`, `git rev-parse HEAD` e a versão do Node na VPS; preserve alterações locais e não force a atualização.
2. Execute `/usr/local/sbin/adstudio-backup` antes de alterar banco, configuração ou código instalado.
3. Confira trabalhos em execução no escopo `jobs` da tabela `entries`, na tabela `copies` e, após a instalação, em `google_ads_jobs`; aguarde sua conclusão antes de reiniciar. O endpoint autenticado `/apps/google-ads/api/health` informa gerações ativas desta aplicação.
4. Após commit e push para `main`, no diretório do projeto execute `runuser -u YSS5v8CvMVTud6Ve -- git pull --ff-only origin main`.
5. Execute `npm ci` como usuário da aplicação, com `/opt/adstudio-node/bin` no PATH, pois o recorte de imagens usa `sharp`.
6. Execute `supervisorctl restart adstudio` e `supervisorctl status adstudio`.
7. Confira login, dashboard, Google Ads e estúdio; sem sessão, páginas privadas redirecionam ao login e APIs retornam 401. Confirme que histórico, prompts e chaves existentes continuam disponíveis.

Não altere o proxy, a porta 18888, outros programas do Supervisor nem outros sites da VPS.
