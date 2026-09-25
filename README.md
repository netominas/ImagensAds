# AdStudio AI

Estúdio de criativos para Google Ads e Meta: Gemini, OpenAI (ChatGPT) e Grok, biblioteca de prompts editável, 1–4 imagens por lote, galeria local e recorte com download em tamanho exato.

## Executar localmente

Requer Node.js 22 ou superior. Não é necessário instalar dependências para o servidor local:

```sh
node scripts/create-admin.mjs
node server.mjs
```

O primeiro comando pede e-mail e senha sem exibir a senha. Ele cria um `.env` ignorado pelo Git contendo apenas o e-mail e o hash scrypt da senha. Abra http://localhost:8888, entre e, em **Configurações**, informe a chave e o modelo da IA desejada. O uso real das APIs é cobrado pelo provedor. O servidor local mantém trabalhos e sessões temporários em memória.

```sh
node --test
node scripts/build.mjs
```

## Publicar na Netlify

1. Envie este projeto para um repositório Git e importe esse repositório na Netlify.
2. A configuração `netlify.toml` define o comando `npm run build`, a pasta pública `dist` e as funções `netlify/functions`. A Netlify instala as dependências automaticamente.
3. Use um plano/conta com **Background Functions** e **Netlify Blobs** habilitados. Não use apenas o upload estático de `dist`: as funções são necessárias para gerar imagens.
4. Em **Project configuration → Environment variables**, importe o `.env` gerado pelo script. As variáveis `ADMIN_EMAIL` e `ADMIN_PASSWORD_HASH` precisam estar disponíveis no escopo **Functions** e no contexto de produção. Ao colar o hash individualmente, não inclua as aspas delimitadoras do arquivo `.env`.
5. Faça um novo deploy após configurar as variáveis. Sem elas, o sistema bloqueia o acesso por padrão. Não existe senha padrão nem cadastro público.
6. Após publicar, faça login, informe as chaves em Configurações e valide uma geração de cada provedor com acesso na sua conta.

Não há chaves de IA embutidas nem chamadas pagas automáticas. As chaves ficam apenas na memória da aba e são enviadas na solicitação POST de geração. Não são salvas no localStorage, no IndexedDB ou nos Blobs pela aplicação. Os nomes dos modelos e os prompts ficam no localStorage. Configurações e galeria não sincronizam entre dispositivos.

## Login e armazenamento

O login é de administrador único, sem registro aberto. O HTML do estúdio fica fora da pasta pública e é servido por uma função que valida a sessão. As funções de geração e consulta também validam a sessão no servidor. JavaScript, CSS e presets de fábrica são arquivos públicos e não contêm credenciais ou dados privados.

| Dado | Onde fica |
| --- | --- |
| E-mail e hash da senha do administrador | Variáveis de ambiente da Netlify, no servidor; `.env` no desenvolvimento |
| Sessão | Cookie HttpOnly, Secure em HTTPS e SameSite=Strict, com expiração de 8 horas; no Netlify Blobs fica apenas o hash do identificador, versão das credenciais e validade |
| Chaves de Gemini, OpenAI e Grok | Memória da aba; enviadas ao backend e ao respectivo provedor durante a geração |
| Prompts personalizados e modelos selecionados | localStorage deste navegador e domínio |
| Imagens e metadados da galeria | IndexedDB deste navegador e domínio |
| Lote em acompanhamento | sessionStorage: identificador, tema, formato, provedor e quantidade; sem chave de IA |
| Imagens em processamento/concluídas no servidor | Netlify Blobs por até 24 horas de acesso; limpeza diária, retenção física aproximada de até 48 horas |
| Controle de tentativas | Slots atômicos temporários no Netlify Blobs: hash do IP e validade; limpeza diária |

Login limita tentativas por IP no servidor e possui uma regra adicional de rate limiting da Netlify. A sessão é revogada ao sair. Trocar e-mail ou hash da senha nas variáveis e fazer novo deploy invalida as sessões anteriores. O navegador redireciona ao login quando detecta sessão expirada. Jobs já iniciados podem terminar após o logout; novas consultas exigem login.

Os dados locais anteriores são preservados. O login protege o acesso remoto ao aplicativo e às APIs; não criptografa o perfil do navegador. Uma pessoa com acesso ao mesmo perfil do computador ainda pode inspecionar localStorage/IndexedDB. Limpar dados do site apaga a biblioteca/galeria local. Não use navegador compartilhado para guardar material privado. A política de retenção dos provedores de IA é independente da aplicação.

Para redefinir o acesso, gere um novo hash com o script em uma pasta local sem `.env` existente (ou preserve/renomeie o arquivo anterior), substitua as variáveis na Netlify e faça novo deploy. Não envie a senha pelo chat, pelo Git ou pelo código-fonte.

## Fluxo

- A função `generate-background` executa um lote sequencial de até quatro chamadas, com timeout de três minutos por imagem. Um identificador aleatório de 256 bits dá acesso ao trabalho. Uma gravação condicional evita executar o mesmo lote duas vezes, inclusive nas repetições da plataforma.
- O navegador consulta `job` e recupera imagens individualmente por respostas em streaming. Sucessos parciais ficam disponíveis quando outra imagem falha. O identificador do lote em andamento fica no sessionStorage para permitir acompanhamento ao recarregar a aba.
- Imagens recebidas ficam no IndexedDB do navegador. Faça download para preservá-las fora desse navegador.
- Os resultados no servidor expiram em 24 horas; a função agendada `cleanup` remove os objetos expirados diariamente (retenção física de até aproximadamente 48 horas). Ela só executa automaticamente no deploy de produção. Não armazena chaves nem prompts.
- A geração usa uma proporção próxima aceita pela IA. O canvas faz o recorte e redimensionamento exato, com zoom e posição ajustáveis. Exportação em JPG, PNG e WebP; controle de qualidade nos formatos com perdas e indicação do peso final.
- As dimensões são presets de trabalho, não uma garantia de aceitação do anúncio: revise o conteúdo e o limite de arquivo no posicionamento escolhido. O estilo “alto CTR” é uma direção criativa, sem promessa de desempenho.

## Limites desta primeira versão

- Workspace privado com um administrador; ainda não há contas de equipe, recuperação por e-mail, sincronização em nuvem dos prompts ou cofre persistente de chaves. Para oferecer contas separadas, implementar identidade e isolamento dos dados por usuário.
- Modelos são editáveis em Configurações: disponibilidade e permissão dependem da conta de API.
- Chamadas reais e deploy precisam ser validados com credenciais do proprietário; os testes automatizados usam respostas simuladas.
- Interrupção definitiva de uma função pode deixar um trabalho incompleto. A aplicação não repete chamadas pagas automaticamente. Confira o consumo no provedor antes de iniciar outro lote.

## Referências das integrações

- [OpenAI: geração de imagens](https://developers.openai.com/api/docs/guides/image-generation)
- [Gemini: Generate Content para imagens](https://ai.google.dev/gemini-api/docs/generate-content/image-generation)
- [Grok: geração de imagens](https://docs.x.ai/developers/model-capabilities/images/generation)
- [Netlify: Background Functions](https://docs.netlify.com/build/functions/background-functions/)
- [Netlify: Blobs](https://docs.netlify.com/build/data-and-storage/netlify-blobs/)

## Central de agentes

Na instalação VPS, a página inicial reúne o gerador de imagens e o gerador de copys. A biblioteca de textos inclui Facebook/Instagram, campanhas de pesquisa Google Ads, push e conteúdo personalizado. Prompts e modelos de texto são independentes dos prompts e modelos de imagem; as chaves de API são compartilhadas.

Textos são gerados em segundo plano e armazenados no SQLite do servidor. O histórico permite abrir, editar, copiar, baixar TXT e excluir resultados. Pedidos interrompidos por reinício do servidor não são cobrados novamente por uma repetição automática. Os limites de tamanho dos anúncios são instruções para a IA e devem ser revisados antes da publicação.

