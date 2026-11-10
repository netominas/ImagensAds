import test from 'node:test';
import assert from 'node:assert/strict';
import {reportPeriod,previousMonth,placementPeriod,validatePlacementPeriod} from '../apps/roi/public/report-period.js';
const now=new Date('2026-10-27T13:00:00Z'),url=query=>new URL('https://roi.test/apps/roi/'+query);
test('site lists open today and campaign details open seven calendar days including today',()=>{
 assert.deepEqual(reportPeriod(url('?site=example.com'),now),{preset:'today',start:'2026-10-27',end:'2026-10-27'});
 assert.deepEqual(reportPeriod(url(''),now),{preset:'today',start:'2026-10-27',end:'2026-10-27'});
 assert.deepEqual(reportPeriod(url('?account=1234567890&campaign=123&site=example.com'),now),{preset:'7',start:'2026-10-21',end:'2026-10-27'});
});
test('explicit periods remain shareable and matching defaults keep their named filter on reload',()=>{
 assert.deepEqual(reportPeriod(url('?start=2026-09-01&end=2026-09-30'),now),{preset:'last_month',start:'2026-09-01',end:'2026-09-30'});
 assert.equal(reportPeriod(url('?start=2026-10-27&end=2026-10-27'),now).preset,'today');
 assert.equal(reportPeriod(url('?account=1234567890&campaign=123&start=2026-10-21&end=2026-10-27'),now).preset,'7');
});
test('default calendar uses Sao Paulo near UTC midnight and spans month boundaries',()=>{
 assert.deepEqual(reportPeriod(url('?account=1234567890&campaign=123'),new Date('2026-11-01T01:00:00Z')),{preset:'7',start:'2026-10-25',end:'2026-10-31'});
});

 test('previous calendar month covers leap years, year boundaries and Sao Paulo midnight',()=>{
 assert.deepEqual(previousMonth(new Date('2026-11-02T13:00:00Z')),{start:'2026-10-01',end:'2026-10-31'});
 assert.deepEqual(previousMonth(new Date('2024-03-01T13:00:00Z')),{start:'2024-02-01',end:'2024-02-29'});
 assert.deepEqual(previousMonth(new Date('2026-01-15T13:00:00Z')),{start:'2025-12-01',end:'2025-12-31'});
 assert.deepEqual(previousMonth(new Date('2026-11-01T01:00:00Z')),{start:'2026-09-01',end:'2026-09-30'});
 assert.equal(reportPeriod(url('?start=2026-09-02&end=2026-09-30'),now).preset,'custom');
 });

test('placement presets follow Sao Paulo dates, include today in seven days and handle year rollover',()=>{
 const midnight=new Date('2027-01-01T01:00:00Z');
 assert.deepEqual(placementPeriod('today',midnight),{start:'2026-12-31',end:'2026-12-31'});
 assert.deepEqual(placementPeriod('yesterday',midnight),{start:'2026-12-30',end:'2026-12-30'});
 assert.deepEqual(placementPeriod('7',new Date('2027-01-02T12:00:00Z')),{start:'2026-12-27',end:'2027-01-02'});
 assert.deepEqual(validatePlacementPeriod('2026-10-01','2026-10-27',now),{start:'2026-10-01',end:'2026-10-27'});
 for(const range of [['2026-02-30','2026-03-01'],['2026-10-28','2026-10-28'],['2026-10-27','2026-10-26'],['2026-01-01','2026-10-27']])assert.throws(()=>validatePlacementPeriod(...range,now));
});
