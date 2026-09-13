const path = require('path');
const fs = require('fs'), vm = require('vm'), assert = require('assert/strict');
const source = fs.readFileSync(path.join(__dirname,'Code.gs'),'utf8');
const ctx = vm.createContext({console}); vm.runInContext(source,ctx);
let passed = 0;
function test(name, fn) { fn(); passed++; console.log('PASS',name); }
const m = {internalDate:'2000',labelIds:['L'],payload:{headers:[{name:'From',value:'Tetiana <tetiana.bura@cru.org>'},{name:'Subject',value:'Молитовний лист'}]}};
const copy = x => JSON.parse(JSON.stringify(x));
test('exact sender and subject',()=>assert.equal(ctx.eligible_(m,'L',1000),true));
for(const [name, change] of [
 ['foreign sender',x=>x.payload.headers[0].value='other@cru.org'],
 ['sender lookalike',x=>x.payload.headers[0].value='tetiana.bura@cru.org.attacker.test'],
 ['display-name spoof',x=>x.payload.headers[0].value='tetiana.bura@cru.org <other@cru.org>'],
 ['reply subject',x=>x.payload.headers[1].value='Re: Молитовний лист'],
 ['different subject',x=>x.payload.headers[1].value='Молитовний лист інше'],
 ['unlabelled',x=>x.labelIds=[]],['sent',x=>x.labelIds.push('SENT')],
 ['duplicate From',x=>x.payload.headers.push(x.payload.headers[0])],
 ['old message',x=>x.internalDate='999']]) test(name,()=>{const x=copy(m);change(x);assert.equal(ctx.eligible_(x,'L',1000),false)});
test('no main ref writes',()=>assert.throws(()=>ctx.gh_('post','/git/refs',{ref:'refs/heads/main'},{}),/Forbidden branch/));
test('no merge endpoint',()=>assert.throws(()=>ctx.gh_('put','/pulls/1/merge',{},{}),/Forbidden/));
test('no ref updates',()=>assert.throws(()=>ctx.gh_('patch','/git/refs/heads/main',{},{}),/Forbidden/));
test('draft required',()=>assert.throws(()=>ctx.gh_('post','/pulls',{draft:false,base:'main'},{}),/Draft/));
const records=ctx.parseRecords_(fs.readFileSync(path.join(__dirname,'../../letters.js'),'utf8'));
const originalCount = records.length;
test('existing letters preserved',()=>assert.ok(originalCount > 0));
const next=ctx.renderCatalog_(records);
test('catalog round-trip',()=>assert.equal(JSON.stringify(ctx.parseRecords_(next)),JSON.stringify(records)));
const pair={uk:'<script>alert("x")</script>',en:'English & "quotes"'};
const d={title:pair,description:pair,sections:[{heading:pair,paragraphs:[pair]}],prayers:[pair]};
const rendered=ctx.renderLetter_(d,'2026-09',['letters/assets/test.jpg']);
test('letter HTML escaped',()=>{assert.ok(!rendered.includes('<script>alert'));assert.ok(rendered.includes('&lt;script&gt;'));assert.ok(rendered.includes('data-language="en" lang="en" hidden'));});
test('valid AI structure',()=>ctx.validateLetter_(d));
test('incomplete translation rejected',()=>assert.throws(()=>ctx.validateLetter_({...d,title:{uk:'only'}})));
test('fake photo rejected',()=>assert.equal(ctx.validImage_([60,104,116,109,108],'image/png'),false));
test('png signature',()=>assert.equal(ctx.validImage_([137,80,78,71,13,10,26,10],'image/png'),true));
const withSeptember=[{slug:'2026-09',title:pair,description:pair,cover:'letters/assets/test.jpg'},...records];
const element={innerHTML:''};
const browser=vm.createContext({document:{documentElement:{lang:'uk'},getElementById:()=>element}});
vm.runInContext(ctx.renderCatalog_(withSeptember),browser);
test('new month card and all archived cards',()=>{assert.ok(element.innerHTML.includes('Вересень 2026'));assert.equal((element.innerHTML.match(/class="letter-card"/g)||[]).length,originalCount + 1);assert.ok(!element.innerHTML.includes('<script>'));});
let writes=0;
ctx.PropertiesService={getScriptProperties:()=>({getProperty:()=>null})};
ctx.UrlFetchApp={fetch:()=>{writes++;throw Error('must not call')}};
test('disabled polling makes no external call',()=>{ctx.pollTanyaLetters();assert.equal(writes,0)});
console.log(passed+' tests passed');
const properties = new Map();
ctx.PropertiesService={getScriptProperties:()=>({getProperty:k=>properties.get(k),setProperty:(k,v)=>properties.set(k,v),deleteProperty:k=>properties.delete(k)})};
let prPosts=0;
ctx.gh_=(method,path,body)=> {
  if(path.startsWith('/pulls?')) return [{number:42}];
  throw Error('Unexpected call');
};
test('existing PR does not call AI or recreate branch',()=>{ctx.processMessage_('id','abc',{});assert.equal(properties.get('DONE_abc'),'42')});
ctx.gh_=(method,path,body)=>{
  if(path.startsWith('/pulls?')) return [];
  if(path.startsWith('/git/ref/heads/')) return {object:{sha:'committed'}};
  if(path==='/pulls' && method==='post') {assert.equal(body.draft,true);prPosts++;return {number:43,html_url:'mock PR'};}
  throw Error('Unexpected call');
};
test('committed branch recovery creates only draft PR',()=>{ctx.processMessage_('id','def',{});assert.equal(prPosts,1);assert.equal(properties.get('DONE_def'),'43')});
console.log(passed+' total tests passed');
