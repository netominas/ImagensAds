import test from 'node:test';
import assert from 'node:assert/strict';
import {reportPeriod} from '../apps/roi/public/report-period.js';
const now=new Date('2026-10-27T13:00:00Z'),url=query=>new URL('https://roi.test/apps/roi/'+query);
test('site lists open today and campaign details open seven calendar days including today',()=>{
 assert.deepEqual(reportPeriod(url('?site=example.com'),now),{preset:'today',start:'2026-10-27',end:'2026-10-27'});
 assert.deepEqual(reportPeriod(url(''),now),{preset:'today',start:'2026-10-27',end:'2026-10-27'});
 assert.deepEqual(reportPeriod(url('?account=1234567890&campaign=123&site=example.com'),now),{preset:'7',start:'2026-10-21',end:'2026-10-27'});
});
test('explicit periods remain shareable and matching defaults keep their named filter on reload',()=>{
 assert.deepEqual(reportPeriod(url('?start=2026-09-01&end=2026-09-30'),now),{preset:'custom',start:'2026-09-01',end:'2026-09-30'});
 assert.equal(reportPeriod(url('?start=2026-10-27&end=2026-10-27'),now).preset,'today');
 assert.equal(reportPeriod(url('?account=1234567890&campaign=123&start=2026-10-21&end=2026-10-27'),now).preset,'7');
});
test('default calendar uses Sao Paulo near UTC midnight and spans month boundaries',()=>{
 assert.deepEqual(reportPeriod(url('?account=1234567890&campaign=123'),new Date('2026-11-01T01:00:00Z')),{preset:'7',start:'2026-10-25',end:'2026-10-31'});
});
