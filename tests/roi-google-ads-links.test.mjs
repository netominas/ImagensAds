import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createGoogleAdsLinks,ocidFromGoogleURL} from '../apps/roi/google-ads-links.mjs';
test('OCID extraction accepts official Google URLs and rejects untrusted destinations',()=>{
 assert.equal(ocidFromGoogleURL('https://adwords.google.com/aw/recommendations?ocid=6471109110&authuser=2'),'6471109110');
 for(const url of ['https://ads.google.com.evil.test/?ocid=1','http://ads.google.com/?ocid=1','https://user@ads.google.com/?ocid=1','https://ads.google.com:444/?ocid=1','javascript:alert(1)','https://ads.google.com/?ocid=abc','https://ads.google.com/'])assert.equal(ocidFromGoogleURL(url),null);
});
test('Google Ads links resolve per account, cache across resolver instances and never forward user-specific URL parameters',async()=>{
 const db=new DatabaseSync(':memory:');let calls=0;const google={async search(id){calls++;await Promise.resolve();return [{customer:{id},metrics:{optimizationScoreUrl:'https://adwords.google.com/aw/recommendations?ocid='+(id==='1234567890'?'77':'88')+'&euid=private&authuser=4'}}];}};
 try{const link=createGoogleAdsLinks(db,google),a={id:'1234567890',mcc:'1111111111'};
  const results=await Promise.all([link(a,'111'),link(a,'222')]);assert.equal(calls,1);
  const u=new URL(results[0]);assert.equal(u.origin,'https://ads.google.com');assert.equal(u.pathname,'/aw/campaigns');assert.deepEqual([...u.searchParams],[['campaignId','111'],['ocid','77']]);
  assert.equal(new URL(await link({id:'0987654321'},'111')).searchParams.get('ocid'),'88');assert.equal(calls,2);
  const restored=createGoogleAdsLinks(db,{search(){throw Error('Should use stored mapping');}});assert.equal(new URL(await restored(a,'333')).searchParams.get('ocid'),'77');
  await assert.rejects(link(a,'123&ocid=999'),e=>e.status===400);
 }finally{db.close();}
});
test('an account mismatch or missing OCID never creates an invented account link',async()=>{
 const db=new DatabaseSync(':memory:');try{const link=createGoogleAdsLinks(db,{search:async()=>[{customer:{id:'9999999999'},metrics:{optimizationScoreUrl:'https://ads.google.com/?ocid=1'}}]});await assert.rejects(link({id:'1234567890'},'111'),e=>e.status===422);assert.equal(db.prepare('SELECT count(*) AS n FROM roi_google_ads_accounts').get().n,0);}finally{db.close();}
});
