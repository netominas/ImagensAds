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
