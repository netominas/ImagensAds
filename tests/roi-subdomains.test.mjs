import test from 'node:test';
import assert from 'node:assert/strict';
import {attribution,campaignSite,reconcile,site} from '../apps/roi/model.mjs';
import {gridPeriod} from '../apps/roi/roi-grid.mjs';
import {placementTaxContext} from '../apps/roi/placement-model.mjs';
const date='2026-11-24',zone='America/Sao_Paulo';
const cost=(campaign,host,utm=campaign)=>({account:'1234567890',campaign,name:campaign,site:'umonic.com',date,currency:'BRL',timezone:zone,cost:10,utm,final_urls:['https://'+host+'/landing?utm_campaign='+utm]});
const revenue=(utm,amount=20)=>({date,site:'umonic.com',network:'1',utm,currency:'BRL',timezone:zone,revenue:amount,impressions:100});
test('placement profit tax keeps the combined daily tax when campaign destinations span subdomains',()=>{
 const days=[{date,site:'finance.umonic.com',gross_revenue:100,revenue_share:0,company_tax:10,tax_rate:.1},{date,site:'en.umonic.com',gross_revenue:300,revenue_share:0,company_tax:0,tax_rate:0}];
 assert.equal(placementTaxContext(days,date,'umonic.com').tax_rate,.025);assert.equal(placementTaxContext(days,date,'finance.umonic.com').tax_rate,.1);assert.equal(placementTaxContext([...days,{...days[0],tax_rate:null}],date,'umonic.com'),null);
});
test('campaign destinations preserve subdomains while GAM domain normalization stays registrable',()=>{
 assert.equal(campaignSite('https://www.finance.umonic.com/a'),'finance.umonic.com');assert.equal(campaignSite('https://EN.umonic.com/a'),'en.umonic.com');assert.equal(site('en.umonic.com'),'umonic.com');
 assert.equal(attribution('https://finance.umonic.com/a?utm_campaign=42',{id:'42'}).site,'finance.umonic.com');
 assert.equal(gridPeriod('finance.umonic.com',date).site,'finance.umonic.com');assert.equal(campaignSite('http://localhost/'),'');assert.equal(campaignSite('https://user:pass@finance.umonic.com/'),'');
});
test('legacy final URLs separate root and subdomain rows without changing facts or duplicating GAM revenue',()=>{
 const costs=[cost('1','umonic.com'),cost('2','finance.umonic.com'),cost('3','en.umonic.com')],revenues=costs.map(c=>revenue(c.utm)),before=JSON.stringify({costs,revenues});
 const result=reconcile(costs,revenues,{});assert.deepEqual(result.rows.map(r=>r.site).sort(),['en.umonic.com','finance.umonic.com','umonic.com']);assert.equal(result.totals.cost,30);assert.equal(result.totals.revenue,60);assert.equal(result.totals.profit,30);assert.equal(result.pending.length,0);assert.equal(JSON.stringify({costs,revenues}),before);
});
test('shared UTM across campaigns in different subdomains stays ambiguous',()=>{
 const result=reconcile([cost('1','finance.umonic.com','shared'),cost('2','en.umonic.com','shared')],[revenue('shared')],{});
 assert.equal(result.pending[0].status,'ambiguous');assert.equal(result.totals.revenue,0);assert.ok(result.rows.every(r=>r.profit===null));
});
test('one campaign with the same UTM on several hosts never gets an invented revenue split',()=>{
 const result=reconcile([cost('1','finance.umonic.com'),cost('1','en.umonic.com')],[revenue('1')],{});assert.equal(result.pending[0].status,'ambiguous');assert.equal(result.totals.revenue,0);assert.equal(result.coverage.cost_pending,20);
 const combined=cost('1','finance.umonic.com');combined.final_urls.push('https://en.umonic.com/');const old=reconcile([combined],[revenue('1')],{});assert.equal(old.rows[0].site,'');assert.equal(old.rows[0].profit,null);
});
test('distinct UTMs in a multi-host campaign keep their own revenue and daily subdomain moves stay independent',()=>{
 const result=reconcile([cost('1','finance.umonic.com','finance'),cost('1','en.umonic.com','en')],[revenue('finance',25),revenue('en',35)],{});assert.equal(result.rows.find(r=>r.site==='finance.umonic.com').revenue,25);assert.equal(result.rows.find(r=>r.site==='en.umonic.com').revenue,35);
 const moved={...cost('1','en.umonic.com'),date:'2026-11-23'};const days=reconcile([cost('1','finance.umonic.com'),moved],[revenue('1'),{...revenue('1',30),date:moved.date}],{});assert.equal(days.rows.find(r=>r.site==='finance.umonic.com').revenue,20);assert.equal(days.rows.find(r=>r.site==='en.umonic.com').revenue,30);
});
