import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchCgvSnapshot,sessionsToMovies} from '../src/cgv.mjs';
const now=new Date('2026-11-09T03:00:00Z');
const session={siteNo:'0113',movNo:'a',movNm:'영화 A',scnYmd:'20261110',scnsrtTm:'1300',frSeatCnt:20,cntlYn:'N'};
const response=data=>new Response(JSON.stringify({statusCode:0,data}),{headers:{'Content-Type':'application/json'}});
test('all auditoriums are combined without IMAX filters',async()=>{
  const urls=[];const snapshot=await fetchCgvSnapshot({now,pause:async()=>{},fetcher:async url=>{urls.push(String(url));return String(url).includes('BySite')?response([{scnYmd:'20261110'}]):response([{...session,scnsNm:'1관'}, {...session,scnsNm:'IMAX관'}, {...session,movNo:'b',movNm:'영화 B',scnsNm:'4DX관'}]);}});
  assert.equal(snapshot.length,2);assert.equal(snapshot[0].dates.length,1);assert.ok(urls.every(url=>url.includes('siteNo=0113')));assert.ok(urls.every(url=>!url.includes('attrCd')));
});
test('403, invalid body, wrong theater and partial failure are errors',async()=>{
  await assert.rejects(fetchCgvSnapshot({now,pause:async()=>{},fetcher:async()=>new Response('blocked',{status:403})}),/403/);
  await assert.rejects(fetchCgvSnapshot({now,pause:async()=>{},fetcher:async()=>response({})}));
  assert.throws(()=>sessionsToMovies([{...session,siteNo:'0013'}],'2026-11-10',now));
  await assert.rejects(fetchCgvSnapshot({now,pause:async()=>{},fetcher:async url=>String(url).includes('BySite')?response([{scnYmd:'20261110'}]):new Response('error',{status:500})}));
});
test('sold-out dates stay open history, controlled or ended sessions do not',()=>{
  assert.deepEqual(sessionsToMovies([{...session,frSeatCnt:0}],'2026-11-10',now)[0].dates,['2026-11-10']);
  assert.deepEqual(sessionsToMovies([{...session,frSeatCnt:0}],'2026-11-10',now)[0].bookableDates,[]);
  assert.deepEqual(sessionsToMovies([{...session,cntlYn:'Y'}],'2026-11-10',now)[0].dates,[]);
  assert.deepEqual(sessionsToMovies([{...session,scnYmd:'20261109',scnsrtTm:'1100'}],'2026-11-09',now)[0].dates,[]);
});
