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

## Dashboard de ROI

Páginas privadas: `/apps/roi/`, `/apps/roi/sites` e `/apps/roi/vinculos`. As APIs `/apps/roi/api/*` usam a sessão existente; POST e DELETE exigem a origem correta. Os arquivos públicos são autorizados explicitamente no servidor: `app.js`, `style.css`, `campaign-report.js`, `gam-metrics.js`, `ads-metrics.js` e `brand.svg`.

A credencial usa `GOOGLE_AD_MANAGER_CREDENTIALS_FILE` quando configurada ou reutiliza `GOOGLE_ADS_CREDENTIALS_FILE`. Autorize o e-mail como usuário de **conta de serviço** em cada rede do Ad Manager, habilitando acesso à API e relatórios. A API SOAP usa `v202608` por padrão, configurável por `AD_MANAGER_API_VERSION`. Não é necessário alterar `STORAGE_SECRET` nem as chaves do estúdio.

A sincronização consulta contas e redes selecionadas, até 93 dias por execução. O Ad Manager gera relatório de receita **Ad Exchange** por data, domínio e `utm_campaign`; outras receitas não estão incluídas. Somente linhas da chave `utm_campaign` são somadas, evitando contar novamente os valores das demais chaves do mesmo relatório. Valores monetários do CSV_DUMP e Google Ads são convertidos de micros uma única vez.

O custo autoritativo por campanha e dia é conciliado com anúncios e grupos de recursos PMax. Os detalhes não são somados novamente ao total da campanha. Destinos múltiplos ou detalhamentos divergentes ficam sem site atribuído. O vínculo da receita usa domínio registrável e o ID ou a UTM resolvida nas URLs, com precedência anúncio → grupo → campanha → conta. Mudanças históricas nas URLs podem exigir vínculo manual. Subdomínios são agrupados no mesmo site.

A coluna **URL final** preserva as URLs configuradas em `ad_group_ad.ad.final_urls` e `asset_group.final_urls` (Performance Max), coletadas na sincronização. URLs são deduplicadas por campanha e site, sem multiplicar custos ou receitas. Apenas endereços HTTP/HTTPS sem credenciais são exibidos como links. Campanhas com vários endereços permitem expandir a lista, e o CSV inclui todas as URLs. Relatórios anteriores à funcionalidade exigem nova sincronização para obter os endereços; os snapshots existentes não são reescritos. Na PMax, a expansão de URL pode direcionar para outra página: esta coluna representa a configuração coletada, não o relatório das páginas efetivamente visitadas.

Uma UTM compartilhada por campanhas diferentes não é rateada: exige conciliação manual. As regras são exclusivas por rede, domínio e UTM e ficam registradas na configuração de cada relatório salvo. Receita sem custo correspondente e custo sem receita vinculada não geram lucro ou ROI artificial. Falhas de coleta, falta de câmbio e fusos incompatíveis impedem o cálculo correspondente. Os indicadores abrangem somente vínculos confirmados; pendências aparecem separadamente.

Lucro de mídia = receita estimada Ad Exchange − custo Google Ads. ROI = lucro de mídia / custo; quando custo é zero, ROI é indefinido. Impostos, taxas de parceiros e outros custos operacionais não estão incluídos. USD é convertido para BRL por dia de cada registro usando PTAX de venda do Banco Central; finais de semana e feriados usam a última cotação publicada. A data e a taxa utilizadas ficam no relatório. Falha no BCB deixa os valores em USD pendentes, sem cotação inventada.

As tabelas próprias `roi_runs`, `roi_links` e `roi_settings` preservam resultados, escopo, regras, cotações e histórico no SQLite existente. Os relatórios atuais consultam as tabelas diárias locais; os snapshots antigos permanecem disponíveis na seleção de visualização. A coleta automática é habilitada por `ROI_AUTO_SYNC=true`, sem cron nem chamadas de IA. Após recarregar a página, o usuário pode acompanhar uma coleta em andamento. Reinícios preservam os dados válidos e registram a interrupção para nova tentativa automática. Verifique também `roi_runs.status = 'running'` antes de reiniciar o serviço nas futuras publicações.

Validação: `node --test`. Os testes de ROI cobrem conversão, duplicidade entre redes, ambiguidade, conciliação de custos PMax, isolamento das tabelas existentes e autenticação/CSRF. Consultas reais adicionais devem usar credenciais externas ao repositório.

O ROI permite abrir o nome de uma campanha em um relatório individual por conta + ID, preservando o site e o snapshot na URL. A tabela diária usa os registros originais do relatório salvo e o câmbio de cada dia; filtros de conciliação e lucro/prejuízo afetam cartões, gráfico, totais e CSV. Datas diferentes consultam o banco; períodos ainda ausentes são importados em segundo plano. As fontes completas são preservadas para não eliminar possíveis ambiguidades de UTM ao consultar apenas uma conta. Sem conciliação ou coleta completa, lucro e ROI continuam indisponíveis.

Os relatórios ROI (campanhas, sites e diário individual) incluem eCPM/CPC Ad Exchange e PMR por UTM; a coluna Conciliação foi removida, mas a validação e os filtros permanecem. CPC e eCPM nativos são ponderados por cliques/impressões e convertidos pela moeda/data de cada fato; PMR usa PROGRAMMATIC_RESPONSES_SERVED / TOTAL_PROGRAMMATIC_ELIGIBLE_AD_REQUESTS, não o match rate exclusivo do AdX. As bases e métricas são guardadas em gam_original no snapshot. Sem base, clique ou cotação, a respectiva métrica fica indisponível. Histórico anterior não é reescrito; sincronizar novamente.

Campanhas ROI e relatórios diários incluem Taxa de conversão e Custo por conversão do Google Ads. As consultas de campaign/ad_group_ad/asset_group solicitam conversões, interações, conversions_from_interactions_rate e cost_per_conversion; dias com interações/conversões e custo zero são preservados. ads_original guarda as bases por data/moeda. Taxas nativas são ponderadas por interações ou conversões fracionadas, com conversão monetária por dia. Se a soma das bases do detalhamento não reconciliar com a campanha, preserva-se o custo e deixa-se a métrica de conversão indisponível, sem rateio. Histórico anterior exige nova sincronização.

O dashboard ROI usa tema administrativo azul inspirado na referência: sidebar escura, superfícies brancas, fundo cinza, toolbar de filtros e tabelas com linhas alternadas. O CSS fica concentrado em apps/roi/public/style.css, com adaptação responsiva. O bloco superior mostra apenas quantidades reais do catálogo, sem simular estado de conexão ou ações do servidor. Menus, filtros, snapshots, ordem das colunas, CSV e Fontes de dados no final permanecem funcionais.

O ID da campanha na tabela ROI abre /apps/roi/api/google-ads-link?account=...&campaign=... em outra aba. A rota exige sessão, valida IDs e acesso à conta no catálogo e consulta metrics.optimization_score_url para extrair o OCID da URL oficial Google Ads. CID e OCID são identificadores diferentes. O mapeamento é guardado em roi_google_ads_accounts (TTL 30 dias), com deduplicação de consultas simultâneas. O redirecionamento vai exclusivamente para https://ads.google.com/aw/campaigns com campaignId e ocid; parâmetros de usuário e URLs arbitrárias não são repassados. Se o Google não fornecer OCID, o painel informa a indisponibilidade em vez de inventar um identificador. O nome da campanha continua abrindo o relatório interno e o ícone ao lado continua sendo o destino final do anúncio. Snapshots financeiros não são alterados.

## Armazenamento diário e atualização automática do ROI

Habilite `ROI_AUTO_SYNC=true` em runtime.env para a instalação VPS. O agendador roda no processo Node existente, inclusive sem navegador aberto, e inicia cinco segundos após o servidor estar disponível. Há apenas uma coleta simultânea. O primeiro carregamento importa os últimos 30 dias incluindo hoje, respeitando as contas e redes já selecionadas em roi_settings. A cada 30 minutos revisita os últimos sete dias incluindo hoje; uma vez por dia, após 03h de São Paulo, revisita 30 dias para incorporar ajustes. Falhas usam nova tentativa após cinco minutos e preservam os últimos valores válidos. A atualização depende também da disponibilidade e do atraso de publicação dos provedores.

As tabelas próprias roi_daily_facts (fatos brutos por fonte/data), roi_source_days (cobertura, tentativas e falhas), roi_fx_days (PTAX por data) e roi_metadata (catálogo, revisão e estado do agendador) são criadas automaticamente no SQLite existente. Cada lote bem-sucedido substitui atomicamente sua fonte/período, inclusive dias confirmados sem atividade; falhas não apagam fatos nem inventam zeros. Não se somam snapshots entre si. A conciliação é recalculada sobre os fatos do período e mantém conversões fracionadas e métricas ponderadas. O câmbio usa os registros diários armazenados, sem aplicar a cotação atual a todo o histórico.

GET /report e /catalog leem o banco após a inicialização do catálogo. Alterar datas dentro da cobertura não faz consultas Google. POST /ensure importa somente dias ausentes, com intervalo de segurança nas novas tentativas. O botão Atualizar agora força uma coleta opcional e salva uma versão histórica; as coletas automáticas guardam apenas um resumo de execução em roi_runs. O seletor Dados atuais (banco de dados) é a visualização padrão. Relatórios legados são preservados sem conversão aproximada em fatos; os dados diários são importados das fontes oficiais. Períodos de até 93 dias podem ser solicitados; fora dos 30 dias iniciais, a primeira consulta importa os dias faltantes.

Antes de publicar: backup, aguardar gerações e roi_runs em execução, git pull como usuário da aplicação, testes e reinício do programa adstudio. Não é necessário novo banco, serviço, domínio ou dependência. Verifique o estado autenticado em /apps/roi/api/status e a cobertura em /apps/roi/api/report. Os testes cobrem idempotência, falhas preservando dados, ausência de zeros fictícios, consultas sem chamadas externas e agendamento sem sobreposição.

## Histórico manual por campanha

O relatório individual de campanha inclui Histórico de alterações após os resultados diários. Tipo, descrição (até 4.000 caracteres) e data do evento ficam em roi_campaign_changes, isolados pela conta Google Ads e ID da campanha. O histórico abrange todas as datas, independentemente do período financeiro e do site selecionado; registros podem ser editados. Trata-se de documentação manual dos ajustes realizados nas plataformas, sem operações de alteração no Google Ads ou Ad Manager. As APIs autenticadas GET/POST /apps/roi/api/campaign-changes validam escopo e conta no catálogo; POST exige mesma origem. IDs enviados pelo formulário tornam a repetição do mesmo envio idempotente. O módulo servidor não é público; campaign-changes.js é autorizado explicitamente como arquivo público. A tabela preserva created/updated e oferece remoção lógica via API, sem apagar o registro original do banco. Não se modificam snapshots, métricas, regras ou o agendador.

## Edição de orçamento no ROI

Os botões Orçamento na lista de campanhas e Alterar orçamento no relatório individual abrem orçamento atual consultado diretamente no Google Ads. Valor absoluto ou aumento percentual (arredondado a centavos) é validado no servidor, na moeda original da conta. DAILY altera somente amount_micros; CUSTOM_PERIOD altera somente total_amount_micros. Nenhuma mudança de lance, CPA, anúncio, status ou URL é enviada. A revisão usa validateOnly=true; o envio real exige uma segunda ação explícita na interface. Os valores atuais e todas as campanhas não removidas vinculadas ao mesmo recurso são consultados novamente antes de enviar. Mudanças desde a revisão ou confirmação expirada (10 minutos) exigem nova revisão. Orçamento compartilhado exige confirmação de todas as campanhas listadas e gera um registro automático no histórico de cada campanha afetada.

roi_budget_operations guarda revisão, valor anterior/novo em micros, moeda, modo, campanhas afetadas, estado e timestamps. Um índice exclusivo impede envios simultâneos para o mesmo orçamento; a confirmação é idempotente por operação. Antes da chamada real o estado SENDING é persistido. Resposta incerta, timeout ou reinício durante envio preserva UNKNOWN e bloqueia novos envios naquele orçamento, sem repetição automática. Conferir o histórico e orçamento no Google Ads antes de resolver administrativamente uma operação UNKNOWN. Erros definitivos ficam FAILED. O sucesso confirmado e os registros de auditoria são gravados na mesma transação local. roi_campaign_changes recebe source=google_ads e budget_operation; esses registros não podem ser editados ou removidos pelo formulário/API manual. Valores e câmbio dos relatórios financeiros permanecem históricos.

Rotas autenticadas: GET /budget, GET /budget-operation, POST /budget-preview e POST /budget-apply sob /apps/roi/api. Escritas exigem mesma origem. Recursos, moeda, valores e campanhas afetadas são determinados pelo servidor, sem aceitar resourceName do navegador. budget-editor.js é público na allowlist; budgets.mjs permanece privado. Antes de reiniciar, também verificar roi_budget_operations.status IN (CHECKING,SENDING), além dos trabalhos anteriores. Testes usam Google simulado para aplicar; conferência real de produção deve se limitar à leitura e validação enquanto nenhum valor real foi autorizado pelo usuário.

## Card de alterações recentes

Na lista geral de campanhas ROI, o ícone i ao lado do nome abre por mouse, foco de teclado ou toque um card com registros dos últimos sete dias de calendário, incluindo hoje em America/Sao_Paulo. O recorte usa a data da alteração, independente do filtro financeiro atual. A consulta autenticada GET /apps/roi/api/campaign-changes?account=...&campaign=...&recent=7 lê somente SQLite, respeita conta/campanha, exclui registros removidos e futuros e não chama APIs Google. Conteúdo é inserido como texto, preservando proteção contra HTML em descrições. O card usa a camada superior do navegador para não ser cortado pela tabela, fecha por Escape ou clique externo e permite passar o cursor para ler seu conteúdo. Cache em memória de 30 segundos por campanha é invalidado ao registrar ou aplicar alterações no painel. Registros manuais e source=google_ads são exibidos; o card não importa alterações feitas externamente ao painel. recent-changes.js foi adicionado à allowlist pública.
