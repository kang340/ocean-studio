const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const root = __dirname;
const base = process.env.OCEAN_STUDIO_URL || 'http://127.0.0.1:8018/ocean-studio.html';
const chrome = process.env.HYPERFRAMES_BROWSER_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const out = path.join(root, 'assets');
fs.mkdirSync(out, {recursive:true});
(async()=>{
 const browser=await chromium.launch({executablePath:chrome,headless:true,args:['--disable-dev-shm-usage','--enable-webgl','--ignore-gpu-blocklist']});
 const page=await browser.newPage({viewport:{width:1600,height:900},deviceScaleFactor:1});
 const errors=[]; page.on('pageerror', e=>errors.push(e.message));
 async function scene(query){
  await page.goto(base+'?'+query,{waitUntil:'networkidle'});
  if(await page.getByTitle('深色主题',{exact:true}).count()) await page.getByTitle('深色主题',{exact:true}).click();
  await page.waitForTimeout(3000);
 }
 async function record(name,seconds,action){
  const ff=spawn(process.env.HYPERFRAMES_FFMPEG_PATH,['-y','-loglevel','error','-f','image2pipe','-vcodec','mjpeg','-framerate','15','-i','pipe:0','-an','-c:v','libx264','-preset','fast','-crf','18','-pix_fmt','yuv420p','-movflags','+faststart',path.join(out,name+'.mp4')]);
  const done=new Promise((res,rej)=>{ff.on('error',rej);ff.on('exit',c=>c===0?res():rej(new Error('ffmpeg '+c)))});
  ff.stderr.on('data',d=>process.stderr.write(d));
  for(let i=0;i<seconds*15;i++){
   if(action) await action(i/(seconds*15-1),i);
   const frame=await page.screenshot({type:'jpeg',quality:91});
   if(!ff.stdin.write(frame)) await new Promise(r=>ff.stdin.once('drain',r));
   if(i===Math.floor(seconds*7.5)) await page.screenshot({path:path.join(out,name+'.png')});
  }
  ff.stdin.end();await done;console.log('CAPTURED',name,seconds);
 }
 await scene('el=wind&src=gfs&view=globe&t=2026-10-15T12:00:00Z');
 await record('wind',7,async(p,i)=>{if(i===15){await page.mouse.move(1050,460);await page.mouse.down()}if(i>=15&&i<75)await page.mouse.move(1050-(i-15)*1.8,460);if(i===75)await page.mouse.up()});
 await scene('el=waves&src=copernicus&cmp=wavewatch&cv=swipe&t=2026-10-15T00:00:00Z');
 const swipe=await page.getByRole('button',{name:'拖动卷帘分隔线'}).boundingBox();
 await page.mouse.move(swipe.x+swipe.width/2,swipe.y+swipe.height/2);await page.mouse.down();
 await record('waves',7,async p=>{await page.mouse.move(960+370*Math.sin(p*Math.PI*2),swipe.y+swipe.height/2)});await page.mouse.up();
 await scene('mode=obs&obs=osmc-20261015');
 await record('observations',5);
 await scene('mode=fusion&obs=osmc-20261015');
 await page.locator('.os-sugs button').nth(1).click();
 await page.getByRole('button',{name:'运行时空匹配',exact:true}).click();
 await page.getByRole('button',{name:/查看结果：/}).waitFor({timeout:120000});
 await page.waitForTimeout(1500);
 await record('matching',7);
 fs.writeFileSync(path.join(out,'capture-report.json'),JSON.stringify({capturedAt:new Date().toISOString(),pageErrors:errors,matchingText:(await page.locator('body').innerText()).slice(-14000)},null,2));
 console.log('ERRORS',JSON.stringify(errors));
 await browser.close();
})();
