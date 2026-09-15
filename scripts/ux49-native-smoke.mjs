// Real, isolated DSH. No credentials, model submissions or business tool calls.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:net';
import { createHash } from 'node:crypto';

const bin = process.env.DCQ_DSH_BIN;
assert.ok(bin, 'Set DCQ_DSH_BIN to an installed DSH bin.js; never use a production profile');
const root = process.cwd();
const testRoot = await mkdtemp(join(tmpdir(), 'cleaning-ux49-native-'));
const profile = join(testRoot, 'profiles/web'), workspace = join(testRoot, 'workspace'), probe = join(testRoot, 'probe');
await mkdir(profile, {recursive:true}); await mkdir(workspace); await mkdir(probe);
const env = {PATH:process.env.PATH, DSH_HOME:testRoot, TMPDIR:tmpdir(), NO_COLOR:'1'};
const hostVersion = execFileSync(process.execPath,[bin,'--version'],{env,encoding:'utf8'}).trim();
const { initProfile } = await import(pathToFileURL(resolve(bin,'../../node_modules/@deepseek-ai/dsh-app-boot/lib/index.js')));
initProfile(profile, ['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app']);
execFileSync('npm',['pack','--ignore-scripts','--pack-destination',testRoot,'--cache',join(testRoot,'npm-cache')],{cwd:root,stdio:'pipe'});
const pkg = JSON.parse(await readFile(join(root,'package.json'),'utf8'));
const tarball=join(testRoot,`${pkg.name}-${pkg.version}.tgz`);
const products={'dsh-tender-workbench':'0.5.11','dsh-pre-duediligence':'0.1.35','dsh-form-fill-agent':'0.2.30'};
await writeFile(join(probe,'package.json'),JSON.stringify({name:'cleaning-ux49-probe',version:'0.0.0',type:'module',main:'index.js',exports:{'.':'./index.js','./client':'./client.js','./package.json':'./package.json'},dsh:{bundle:{patch:'./cordis.patch.yml'},client:{platform:'web',inject:[]}}}));
await writeFile(join(probe,'index.js'),`export const inject=[]; export function apply(){}`);
await writeFile(join(probe,'client.js'),`window.__ModuleLoader__.load({id:'cleaning-ux49-probe',factory:()=>({inject:['conversation','sessions','workspaces'],apply(ctx){window.__ux49=ctx;}})});`);
await writeFile(join(probe,'cordis.patch.yml'),'- insert:\n    - name: cleaning-ux49-probe\n');
await writeFile(join(profile,'package.json'),JSON.stringify({name:'cleaning-ux49-profile',private:true,type:'module',version:'0.0.0',dependencies:{...products,'dsh-better-sidebar':'0.18.1',[pkg.name]:'file:'+tarball,'cleaning-ux49-probe':'file:'+probe},dsh:{profile:{bundles:['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app','dsh-better-sidebar',...Object.keys(products),pkg.name,'cleaning-ux49-probe']}}}));
console.log('Installing isolated profile', testRoot);
execFileSync(process.execPath,[bin,'plugin','--profile','web','install','--ignore-scripts','--store-dir',join(testRoot,'pnpm-store')],{cwd:workspace,env,stdio:'pipe'});
const reserve=createServer(); await new Promise(ok=>reserve.listen(0,'127.0.0.1',ok));
const port=reserve.address().port; await new Promise(ok=>reserve.close(ok)); assert.notEqual(port,3080);
const origin=`http://127.0.0.1:${port}`;
const child=spawn(process.execPath,[bin,'--profile','web','--port',String(port),'--no-open'],{cwd:workspace,env,stdio:['ignore','pipe','pipe']});
let output='',browser,page;
child.stdout.on('data',b=>{output+=b;}); child.stderr.on('data',b=>{output+=b;});
const report={testRoot,hostVersion,products,sidebar:'0.18.1',package:pkg.name,version:pkg.version,
  tarballSha256:createHash('sha256').update(await readFile(tarball)).digest('hex'),
  clientSha256:createHash('sha256').update(await readFile(join(root,'lib/client.js'))).digest('hex'),
  realMcp:'NOT_CALLED',realModel:'NOT_SUBMITTED',checks:[]};
try {
  let ready=false;
  for(let i=0;i<160;i++){try{ready=(await fetch(origin)).status<500;}catch{} if(ready||child.exitCode!==null)break; await new Promise(ok=>setTimeout(ok,250));}
  assert.ok(ready,'Host startup failed: '+output.replace(/https?:\/\/\S+/g,'[url]').slice(-3000));
  const {chromium}=await import(pathToFileURL(process.env.DCQ_PLAYWRIGHT));
  browser=await chromium.launch({headless:true,executablePath:process.env.DCQ_CHROME});
  page=await browser.newPage({viewport:{width:1440,height:900}});
  const mutations=[],errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{if(r.method()==='POST'&&new URL(r.url()).pathname.startsWith('/data-cleaning/api/'))mutations.push(new URL(r.url()).pathname);});
  await page.addLocatorHandler(page.getByRole('button',{name:/^(Continue|继续)$/}),l=>l.click());
  await page.addLocatorHandler(page.getByRole('button',{name:/^(稍后配置|Configure later|Set up later)$/i}),l=>l.click());
  const url=output.match(/http:\/\/127\.0\.0\.1:\d+\/\?token=\S+/)?.[0] || origin;
  await page.goto(url);
  await page.waitForFunction(()=>Boolean(window.__ux49));
  await page.evaluate(async path=>{
    const method='workspace/create';
    const response=await fetch('/api/'+method,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'client-request',rpcId:crypto.randomUUID(),method,payload:{args:{request:{path}}}})});
    const result=(await response.json()).result;if(!result?.ok)throw Error('Workspace creation failed');
  },workspace);
  await page.reload();
  await page.waitForFunction(()=>Boolean(window.__ux49));
  await page.evaluate(()=>{
    const input=window.__ux49.conversation.input, original=input.shell.bind(input);
    window.__ux49FocusChecks=[];
    const wrapped=new WeakSet();
    input.shell=id=>{
      const shell=original(id);
      if(String(id).startsWith('session-dsh-data-cleaning-agent-')&&!wrapped.has(shell)) {
        wrapped.add(shell);const set=shell.setDraft.bind(shell);
        shell.setDraft=text=>{const before=document.activeElement;const result=set(text);
          if(text.includes('例如：补全【企业名单】'))window.__ux49FocusChecks.push(before===document.activeElement);
          return result;};
      }
      return shell;
    };
  });
  await page.getByRole('button',{name:'数据清洗补全',exact:true}).click();
  await page.getByRole('button',{name:'导入名单',exact:true}).waitFor();
  const snapshot=()=>page.evaluate(()=>{const ctx=window.__ux49,id=ctx.sessions.list.getSnapshot().current; return {id,input:ctx.conversation.input.shell(id).snapshot};});
  const first=await snapshot();
  assert.match(first.id,/^session-dsh-data-cleaning-agent-/);
  assert.match(first.input.draft,/例如：补全【企业名单】/);
  assert.equal(first.input.imageIds.length,0);
  assert.deepEqual(await page.evaluate(()=>window.__ux49FocusChecks),[true], 'native template write does not move focus');
  await page.getByText('数据清洗补全智能体',{exact:true}).first().waitFor();
  report.checks.push('new business Session: exact native template + restored hero title');
  const composer=page.locator('[data-composer-card] [contenteditable="true"], [data-composer-card] textarea').first();
  await composer.fill('');
  await page.getByRole('button',{name:'数据清洗补全',exact:true}).click();
  assert.equal((await snapshot()).input.draft,'');
  await page.reload();await page.waitForFunction(()=>Boolean(window.__ux49));
  assert.equal((await snapshot()).input.draft,'');
  report.checks.push('explicit clearing + reentry + refresh: not replenished');
  await composer.fill('用户修改：保留这份清洗草稿，不发送');
  await page.reload();await page.waitForFunction(()=>Boolean(window.__ux49));
  assert.equal((await snapshot()).input.draft,'用户修改：保留这份清洗草稿，不发送');
  report.checks.push('edited native draft persisted across refresh');
  await page.getByRole('button',{name:/^(新会话|新建会话|New Session)$/}).first().click();
  await page.waitForTimeout(300);
  assert.equal(await page.getByRole('button',{name:'导入名单',exact:true}).count(),0);
  await composer.fill('普通会话草稿，不发送');
  const ordinary=await snapshot();
  await page.getByRole('button',{name:'数据清洗补全',exact:true}).click();
  await page.getByRole('button',{name:'导入名单',exact:true}).waitFor();
  const second=await snapshot();assert.notEqual(second.id,first.id);
  assert.match(second.input.draft,/例如：补全【企业名单】/);
  await page.evaluate(id=>window.__ux49.sessions.open(id),ordinary.id);
  await page.waitForTimeout(300);
  assert.equal((await snapshot()).input.draft,'普通会话草稿，不发送');
  await page.evaluate(id=>window.__ux49.sessions.open(id),first.id);
  await page.waitForTimeout(300);
  assert.equal((await snapshot()).input.draft,'用户修改：保留这份清洗草稿，不发送');
  report.checks.push('A/B + ordinary Session drafts isolated with four products installed');
  assert.deepEqual(mutations,[],'initial guide must not create workflow/OCR/MCP requests');
  assert.equal(await page.locator('.dcAgentWorkbenchContent:visible').count(),0,'draft does not open workbench');
  assert.deepEqual(errors,[]);
  report.checks.push('zero business API mutations, zero visible workbench, zero browser exceptions');
  report.status='PASS';
  await page.screenshot({path:join(testRoot,'ux49-native.png')});
} catch(error) {report.status='FAIL';report.error=error.message;throw error;}
finally {
  if(report.status==='FAIL') {
    console.log(output.replace(/https?:\/\/\S+/g,'[url]').slice(-6000));
    if(page) { console.log((await page.locator('body').innerText()).slice(0,4000)); await page.screenshot({path:join(testRoot,'failure.png')}); }
  }
  await writeFile(join(testRoot,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));await browser?.close();child.kill('SIGTERM');
}
