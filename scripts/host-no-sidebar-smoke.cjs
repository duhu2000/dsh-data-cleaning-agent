const {chromium}=require(process.env.DCQ_PLAYWRIGHT);
const fs=require('node:fs');
const root=process.env.DCQ_SMOKE_ROOT;
if(!root || !/^\/(private\/)?tmp\//.test(root)) throw Error('DCQ_SMOKE_ROOT must be an isolated tmp directory');
(async()=>{
 const url=fs.readFileSync(root+'/host.log','utf8').match(/http:\/\/127\.0\.0\.1:43279\/\?token=\S+/)?.[0];
 if(!url)throw Error('Isolated Host not ready on port 43279');
 const browser=await chromium.launch({headless:true});
 const page=await browser.newPage(); const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.addLocatorHandler(page.getByRole('button',{name:/^(Continue|继续)$/}),l=>l.click());
 await page.addLocatorHandler(page.getByRole('button',{name:/^(稍后配置|Configure later|Set up later)$/i}),l=>l.click());
 try {
 await page.goto(url);await page.getByRole('button',{name:'数据清洗补全',exact:true}).waitFor();
 const result=await page.evaluate(async root=>{const method='workspace/create';return (await (await fetch('/api/'+method,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'client-request',rpcId:crypto.randomUUID(),method,payload:{args:{request:{path:root}}}})})).json()).result;},root);
 if(!result?.ok)throw Error('Workspace creation failed');
 console.log('workspace',JSON.stringify(result));
 await page.reload();await page.getByRole('button',{name:'数据清洗补全',exact:true}).click();
 await page.getByRole('button',{name:'导入名单',exact:true}).waitFor();
 await page.getByRole('button',{name:'导入名单',exact:true}).click();
 await page.waitForTimeout(1500);

 const text=await page.locator('body').innerText();
 if(!/请安装或升级兼容的 dsh-better-sidebar/.test(text))throw Error('Missing workbench guidance');
 const composer=page.locator('[data-composer-card] textarea, [data-composer-card] [contenteditable="true"]').first();
 await composer.fill('合成手写草稿保留，不发送');
 await page.getByRole('button',{name:'导入名单',exact:true}).click();
 if(await composer.evaluate(el=>el.value??el.textContent)!=='合成手写草稿保留，不发送')throw Error('Draft lost');
 if(await page.getByLabel('选择数据文件',{exact:true}).count())throw Error('Unexpected workbench');
 if(errors.length)throw Error(errors.join(';'));
 console.log(JSON.stringify({withoutSidebar:true,guidance:true,draftPreserved:true,pageErrors:errors}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
