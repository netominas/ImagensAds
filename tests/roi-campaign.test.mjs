import test from 'node:test';
import assert from 'node:assert/strict';
import {campaignRows,dailyReport} from '../apps/roi/public/campaign-report.js';
const fact=(date,amount,currency='BRL')=>({date,amount,currency});
const row={account:'100',campaign:'200',site:'exemplo.com.br',comparable:true,revenue:45,cost_original:[fact('2026-10-23',10),fact('2026-10-24',20)],revenue_original:[fact('2026-10-23',3,'USD'),fact('2026-10-24',30)]};
test('campaign drilldown uses account, campaign and selected site, without mixing names or accounts',()=>{
 const result={rows:[row,{...row,account:'101'},{...row,campaign:'201'},{...row,site:'outro.com.br'}]};
 assert.deepEqual(campaignRows(result,{account:'100',campaign:'200',site:'exemplo.com.br'}),[row]);
 assert.equal(campaignRows(result,{account:'100',campaign:'200'}).length,2);
 assert.equal(campaignRows(result,{account:'999',campaign:'200'}).length,0);
});
test('daily report reconciles totals, combines network revenue and applies each day exchange rate once',()=>{
 const input=[row,{...row,cost_original:[],revenue_original:[fact('2026-10-24',2,'USD')]}],before=JSON.stringify(input);
 const days=dailyReport(input,{'2026-10-23':{rate:5},'2026-10-24':{rate:6}},'2026-10-23','2026-10-24');
 assert.deepEqual(days.map(d=>[d.cost,d.revenue,d.profit]),[[10,15,5],[20,42,22]]);
 assert.equal(days.reduce((s,d)=>s+d.profit,0),27);assert.equal(days[0].roi,.5);assert.equal(JSON.stringify(input),before);
});
test('unconfirmed attribution, missing FX and zero cost never fabricate profit or ROI',()=>{
 const pending=dailyReport([{...row,comparable:false,revenue:null}],{},'2026-10-23','2026-10-24');
 assert.ok(pending.every(d=>d.profit===null&&d.roi===null&&d.revenue===null));
 const missing=dailyReport([row],{},'2026-10-23','2026-10-24');assert.equal(missing[0].revenue,null);assert.equal(missing[0].profit,null);assert.equal(missing[1].profit,10);
 const zero=dailyReport([{...row,cost_original:[],revenue_original:[fact('2026-10-24',7)]}],{},'2026-10-24','2026-10-24');assert.equal(zero[0].profit,7);assert.equal(zero[0].roi,null);
 assert.deepEqual(dailyReport([],{},'2026-10-23','2026-10-24'),[]);
});
