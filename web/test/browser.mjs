import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/snap/bin/chromium',headless:true});
await mkdir('/tmp/cgv-verification',{recursive:true});
const errors=[];
const page=await browser.newPage({viewport:{width:1280,height:1000},locale:'ko-KR'});
page.on('pageerror',e=>errors.push(e.message));
let preferences=[],registered=false,putCount=0,deleteCount=0;
await page.addInitScript(()=>{
  const sub={toJSON:()=>({endpoint:'https://fcm.googleapis.com/fcm/send/test',keys:{p256dh:btoa('x'.repeat(65)).replace(/=/g,''),auth:btoa('a'.repeat(16)).replace(/=/g,'')}}),unsubscribe:async()=>true};
  const registration={pushManager:{getSubscription:async()=>null,subscribe:async()=>sub}};
  Object.defineProperty(navigator,'serviceWorker',{value:{register:async()=>registration,ready:Promise.resolve(registration)}});
  Object.defineProperty(window,'Notification',{value:{permission:'default',requestPermission:async()=>'granted'}});
  Object.defineProperty(window,'PushManager',{value:function(){}});
});
await page.route('**/api/movies',route=>route.fulfill({json:{status:'ok',lastCheckedAt:Date.now(),pushReady:true,publicKey:Buffer.alloc(65,1).toString('base64url'),movies:[
{id:'one',title:'새로운 영화',dates:['2026-12-01','2026-12-02'],bookableDates:['2026-12-01','2026-12-02']},
{id:'two',title:'두 번째 영화',dates:['2026-12-01'],bookableDates:['2026-12-01']},
{id:'three',title:'매진된 영화',dates:['2026-12-01'],bookableDates:[]},
]}}));
await page.route('**/api/subscription',async route=>{
  const method=route.request().method();
  if(method==='PUT'){preferences=route.request().postDataJSON().movieIds;registered=true;putCount++;}
  if(method==='DELETE'){preferences=[];registered=false;deleteCount++;}
  await route.fulfill({json:{active:registered,movieIds:preferences}});
});
await page.goto('http://127.0.0.1:4173/');
await page.waitForSelector('.movie-card');
assert.equal(await page.locator('.movie-card').count(),2);
await page.getByRole('button',{name:'새로운 영화 알림 선택',exact:true}).click();
assert.equal(await page.locator('#selected-count').innerText(),'1');
await page.locator('#enable').click();
await page.waitForFunction(()=>document.querySelector('#feedback').textContent.includes('저장했어요'));
assert.equal(putCount,1);assert.deepEqual(preferences,['one']);
await page.reload();await page.waitForFunction(()=>document.querySelector('#disable').hidden===false);
assert.equal(await page.locator('.movie-card.selected').count(),1);
await page.locator('#search').fill('두 번째');assert.equal(await page.locator('.movie-card').count(),1);
await page.locator('#search').clear();
await page.screenshot({path:'/tmp/cgv-verification/desktop.png',fullPage:true});
await page.locator('#disable').click();await page.waitForFunction(()=>document.querySelector('#disable').hidden===true);assert.equal(deleteCount,1);
await page.setViewportSize({width:390,height:844});
assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
await page.screenshot({path:'/tmp/cgv-verification/mobile.png',fullPage:true});
await page.unroute('**/api/movies');
await page.route('**/api/movies',route=>route.fulfill({json:{status:'unverified',message:'CGV 조회 실패 (HTTP 403).',lastCheckedAt:null,pushReady:true,movies:[]}}));
await page.locator('#refresh').click();await page.waitForFunction(()=>document.querySelector('#connection-text').textContent.includes('403'));
assert.equal(await page.locator('.movie-card').count(),0);assert.equal(await page.locator('#enable').isDisabled(),true);
assert.deepEqual(errors,[]);
console.log('Browser QA passed: movie selection, subscription persistence, search, unsubscribe, mobile layout, truthful source failure. Push delivery was mocked.');
await browser.close();
