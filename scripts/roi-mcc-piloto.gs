// Cole no Google Ads Scripts da MCC e informe o ID da planilha do piloto.
const SPREADSHEET_ID = '';
// Cada conta adicional pode usar uma planilha própria sob a mesma MCC.
const ACCOUNT_SHEETS = {'3523949327': SPREADSHEET_ID};
// Cole aqui a chave gerada no Relatório Script para cada conta.
const ACCOUNT_UPLOAD_KEYS = {};
const REPORT_ENDPOINT = 'https://app.arkaconteudo.com/apps/roi/api/script-report/ingest';
const TAB_NAME = 'ROI Ads - Piloto';
const METRIC_FIELDS = 'metrics.cost_micros, metrics.clicks, metrics.interactions, metrics.conversions, metrics.average_cpc, metrics.conversions_from_interactions_rate, metrics.cost_per_conversion';
const TRACKING_HEADERS = ['Modelo de rastreamento', 'Sufixo da URL final', 'Parâmetros personalizados (JSON)'];

function trackingFields(resource) {
  return ['tracking_url_template', 'final_url_suffix', 'url_custom_parameters']
    .map(field => resource + '.' + field).join(', ');
}

function sheetText(value) {
  const text = String(value ?? '');
  return /^\s*[=+\-@]/.test(text) ? "'" + text : text;
}

function trackingValues(resource) {
  return [sheetText(resource.trackingUrlTemplate), sheetText(resource.finalUrlSuffix),
    JSON.stringify(resource.urlCustomParameters || [])];
}

function main() {
  const accountIds = [...new Set([...Object.keys(ACCOUNT_SHEETS), ...Object.keys(ACCOUNT_UPLOAD_KEYS)])];
  if (accountIds.some(id => !/^\d{10}$/.test(id) || (!ACCOUNT_SHEETS[id] && !ACCOUNT_UPLOAD_KEYS[id]))) {
    throw new Error('Informe uma planilha ou chave de envio para cada conta configurada.');
  }
  const sheets = Object.values(ACCOUNT_SHEETS).filter(Boolean);
  if (new Set(sheets).size !== sheets.length) {
    throw new Error('Use uma planilha diferente para cada conta.');
  }
  const accounts = AdsManagerApp.accounts().withIds(accountIds).get();
  const missing = new Set(accountIds), failures = [];
  while (accounts.hasNext()) {
    const account = accounts.next();
    const accountId = account.getCustomerId().replace(/-/g, '');
    missing.delete(accountId);
    try {
      collectAccount(account, accountId, ACCOUNT_SHEETS[accountId]);
    } catch (error) {
      failures.push(accountId + ': ' + error.message);
    }
  }
  if (missing.size || failures.length) {
    throw new Error([...failures, ...Array.from(missing, id => id + ': conta indisponível na MCC')].join('\n'));
  }
}

function collectAccount(account, accountId, spreadsheetId) {
  AdsManagerApp.select(account);

  const timezone = account.getTimeZone();
  const end = Utilities.formatDate(new Date(), timezone, 'yyyy-MM-dd');
  const startDate = new Date(end + 'T00:00:00Z');
  startDate.setUTCDate(startDate.getUTCDate() - 6);
  const start = startDate.toISOString().slice(0, 10);
  const capturedAt = new Date().toISOString();
  const report = AdsApp.search(`
    SELECT segments.date, campaign.id, campaign.name,
      campaign.advertising_channel_type, ${trackingFields('campaign')}, ${METRIC_FIELDS}
    FROM campaign
    WHERE segments.date BETWEEN '${start}' AND '${end}'
  `);

  const rows = [['Data', 'Conta', 'Campanha ID', 'Campanha', 'Tipo',
    'Moeda', 'Custo', 'Cliques', 'Interações', 'Conversões', 'Fuso', 'Coletado em (UTC)',
    ...TRACKING_HEADERS, 'Custo (micros)', 'CPC médio (micros)', 'Taxa de conversão', 'Custo por conversão (micros)']];
  const currency = account.getCurrencyCode();
  const campaignIds = new Set();
  const pmaxIds = new Set();
  for (const row of report) {
    campaignIds.add(String(row.campaign.id));
    if (row.campaign.advertisingChannelType === 'PERFORMANCE_MAX') pmaxIds.add(String(row.campaign.id));
    rows.push([row.segments.date, accountId, String(row.campaign.id),
      sheetText(row.campaign.name),
      row.campaign.advertisingChannelType, currency, Number(row.metrics.costMicros) / 1e6,
      Number(row.metrics.clicks), Number(row.metrics.interactions),
      Number(row.metrics.conversions), timezone, capturedAt, ...trackingValues(row.campaign),
      Number(row.metrics.costMicros || 0), Number(row.metrics.averageCpc || 0),
      Number(row.metrics.conversionsFromInteractionsRate || 0), Number(row.metrics.costPerConversion || 0)]);
  }

  const accountsReport = AdsApp.search('SELECT customer.id, customer.tracking_url_template, customer.final_url_suffix FROM customer');
  if (!accountsReport.hasNext()) throw new Error('Configuração de rastreamento da conta indisponível.');
  const customer = accountsReport.next().customer;
  const accountRows = [['Conta', 'Moeda', 'Fuso', 'Coletado em (UTC)', ...TRACKING_HEADERS, 'Início', 'Fim'],
    [accountId, currency, timezone, capturedAt, ...trackingValues(customer), start, end]];
  const detailHeader = ['Data', 'Conta', 'Campanha ID', 'Recurso', 'Recurso ID', 'Grupo de anúncios ID',
    'URLs finais (JSON)', 'Modelo do anúncio', 'Sufixo do anúncio', 'Parâmetros do anúncio (JSON)',
    'Modelo do grupo', 'Sufixo do grupo', 'Parâmetros do grupo (JSON)', 'Coletado em (UTC)'];
  const daily = [[...detailHeader, 'Custo (micros)', 'Cliques', 'Interações', 'Conversões',
    'CPC médio (micros)', 'Taxa de conversão', 'Custo por conversão (micros)']];
  const configured = [detailHeader];
  const dateFilter = `segments.date BETWEEN '${start}' AND '${end}'`;
  const adFields = `campaign.id, ad_group.id, ad_group_ad.ad.id, ad_group_ad.ad.final_urls,
    ${trackingFields('ad_group_ad.ad')}, ${trackingFields('ad_group')}`;
  const assetFields = 'campaign.id, asset_group.id, asset_group.final_urls';
  const collect = (query, resource, output, withMetrics) => {
    for (const row of AdsApp.search(query)) {
      const unit = resource === 'Anúncio' ? row.adGroupAd.ad : row.assetGroup;
      const group = row.adGroup;
      const values = [row.segments?.date || '', accountId, String(row.campaign.id), resource,
        String(unit.id), String(group?.id || ''), JSON.stringify(unit.finalUrls || []),
        ...trackingValues(unit), ...trackingValues(group || {}), capturedAt];
      if (withMetrics) {
        const m = row.metrics;
        values.push(...[m.costMicros, m.clicks, m.interactions, m.conversions,
          m.averageCpc, m.conversionsFromInteractionsRate, m.costPerConversion].map(value => Number(value || 0)));
      }
      output.push(values);
    }
  };
  if (campaignIds.size) {
    collect(`SELECT ${adFields}, segments.date, ${METRIC_FIELDS} FROM ad_group_ad WHERE ${dateFilter}`, 'Anúncio', daily, true);
    collect(`SELECT ${adFields} FROM ad_group_ad WHERE campaign.id IN (${[...campaignIds].join(',')})`, 'Anúncio', configured, false);
  }
  if (pmaxIds.size) {
    collect(`SELECT ${assetFields}, segments.date, ${METRIC_FIELDS} FROM asset_group WHERE ${dateFilter}`, 'Grupo PMax', daily, true);
    collect(`SELECT ${assetFields} FROM asset_group WHERE campaign.id IN (${[...pmaxIds].join(',')})`, 'Grupo PMax', configured, false);
  }

  const token = ACCOUNT_UPLOAD_KEYS[accountId];
  if (token) {
    const batch = {campaigns: rows, account: accountRows, daily, destinations: configured};
    const payload = Object.fromEntries(Object.entries(batch).map(([key, table]) => [
      key, table.map(row => row.map(value => '"' + String(value ?? '').replace(/"/g, '""') + '"').join(',')).join('\n')
    ]));
    const response = UrlFetchApp.fetch(REPORT_ENDPOINT, {
      method: 'post', contentType: 'application/json', headers: {Authorization: 'Bearer ' + token},
      payload: JSON.stringify(payload), muteHttpExceptions: true, followRedirects: false
    });
    if (response.getResponseCode() !== 200) {
      throw new Error('O painel recusou a importação (HTTP ' + response.getResponseCode() + ').');
    }
  }
  if (spreadsheetId) {
    const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
    writeReport(spreadsheet, TAB_NAME, rows, 3);
    writeReport(spreadsheet, 'ROI Ads - Conta', accountRows, 1);
    writeReport(spreadsheet, 'ROI Ads - Detalhe diario', daily, 6);
    writeReport(spreadsheet, 'ROI Ads - Destinos', configured, 6);
  }
  console.log(`Conta ${accountId}: ${rows.length - 1} totais, ${daily.length - 1} linhas de detalhe e ${configured.length - 1} destinos configurados. Período: ${start} a ${end} (${timezone}).`);
}

function writeReport(spreadsheet, name, rows, textColumns) {
  const sheet = spreadsheet.getSheetByName(name) || spreadsheet.insertSheet(name);
  const oldLastRow = sheet.getLastRow();
  if (rows.length > sheet.getMaxRows()) {
    sheet.insertRowsAfter(sheet.getMaxRows(), rows.length - sheet.getMaxRows());
  }
  sheet.getRange(1, 1, rows.length, textColumns).setNumberFormat('@');
  sheet.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
  if (oldLastRow > rows.length) {
    sheet.getRange(rows.length + 1, 1, oldLastRow - rows.length, rows[0].length).clearContent();
  }
}
