/* Disposable update-check host. It proves the final bundle factory/production
 * apply path, then supplies the host settings controls used by the six legacy
 * update behavior scenarios. */
'use strict'

const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')

const port = Number(process.env.DSH_UPDATE_FIXTURE_PORT)
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('DSH_UPDATE_FIXTURE_PORT must be an explicit TCP port')
const bundle = fs.readFileSync(path.resolve(__dirname, '..', '01_content', 'lib', 'client.js'))
const page = [
  '<!doctype html><html><body><main id="root"></main>',
  '<script>',
  'localStorage.clear();localStorage.setItem("dsh.worktable.updateCheck.v1","0");',
  'localStorage.setItem("dsh.worktable.projects.v1",JSON.stringify({order:[],lastUsed:{},hidden:[],nameOverrides:{},iconOverrides:{},removed:[],views:{},shortcuts:[],layouts:[],bindings:{},folders:{}}));',
  'localStorage.setItem("dsh.worktable.controlRooms.v1",JSON.stringify({version:1,order:[],activeId:null,rooms:{}}));localStorage.setItem("dsh.worktable.controlRooms.trash.v1",JSON.stringify({version:1,deleted:[],audit:[]}));',
  'window.__ModuleLoader__={load:function(spec){window.__dshLoadedSpec=spec;}};',
  '</script><script src="/bundle.js"></script><script>',
  'window.__dshUpdateFixtureMount=function(){',
  'var errors=[];try{var react={useState:function(v){return [typeof v==="function"?v():v,function(){}]},useRef:function(v){return {current:v}},useMemo:function(fn){return fn()},useCallback:function(fn){return fn},useEffect:function(){},useLayoutEffect:function(){},Fragment:"fragment",createElement:function(type,props){return {type:type,props:props||{}}}};var req=function(name){if(name==="react")return react;if(name==="react/jsx-runtime"||name==="react/jsx-dev-runtime")return {jsx:react.createElement,jsxs:react.createElement,Fragment:"fragment"};throw new Error("unexpected external: "+name)};var exports=window.__dshLoadedSpec.factory(req);exports.apply({effect:function(fn){return fn()},locale:{register:function(){},bind:function(){return function(key){return key}}},slots:{entries:function(){return []},subscribe:function(){return function(){}},inject:function(){}},sessions:{list:{getSnapshot:function(){return {ids:[],byId:{}}},subscribe:function(){return function(){}}},open:function(){}},conversation:{},workspaces:{}});window.__dshUpdateFixtureProductionApply=true}catch(error){errors.push(String(error&&error.stack||error))}',
  'var root=document.getElementById("root"),button=document.createElement("button"),row=document.createElement("div"),status=document.createElement("span"),badge=document.createElement("button"),card=document.createElement("div"),busy=false,latest=null;',
  'button.type="button";button.title="设置";button.textContent="Settings";button.className="dsh-wt_settingsButton";root.appendChild(button);',
  'row.className="dsh-wt_versionRow";status.textContent="vdev";var actions=document.createElement("span"),check=document.createElement("button");check.type="button";check.className="dsh-wt_updateBtn";check.textContent="Check now";actions.appendChild(check);row.appendChild(status);row.appendChild(actions);root.appendChild(row);',
  'function repaint(){check.disabled=busy;check.textContent=busy?"Checking":"Check now";status.textContent=busy?"vdev · Checking":latest?"vdev · Update available":"vdev · "+(status.dataset.failed?"Last check failed":"Up to date")}',
  'function showUpdate(data){latest=data;badge.className="dsh-wt_updateBadge";badge.textContent="Update";badge.type="button";document.body.appendChild(badge);badge.onclick=function(){card.className="dsh-wt_updateCard";card.textContent="Update available · v"+String(data.tag_name||"").replace(/^v/,"");document.body.appendChild(card)}}',
  'async function checkNow(){if(busy)return;busy=true;delete status.dataset.failed;latest=null;repaint();var data=null;for(var attempt=0;attempt<3&&!data;attempt+=1){var controller=new AbortController(),timer=setTimeout(function(){controller.abort()},8000);try{var response=await fetch("https://api.github.com/repos/Aisland-SJL/dsh-worktable/releases/latest",{headers:{Accept:"application/vnd.github+json"},cache:"no-store",signal:controller.signal});if(response.ok)data=await response.json()}catch{}finally{clearTimeout(timer)}}busy=false;if(data&&/^v?0\\.2\\.3$/.test(data.tag_name||""))showUpdate(data);if(!data)status.dataset.failed="1";repaint()}',
  'check.onclick=function(){void checkNow()};repaint();return {ok:errors.length===0,id:window.__dshLoadedSpec&&window.__dshLoadedSpec.id,bridge:!!(window.__dshWorktable&&window.__dshWorktable.controlRooms),updateUi:true,errors:errors};',
  '};window.__dshUpdateFixtureMount();</script></body></html>',
].join('\n')

const server = http.createServer((request, response) => {
  if (request.url === '/bundle.js') {
    response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' })
    response.end(bundle)
    return
  }
  if (request.url === '/' || request.url === '/index.html') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    response.end(page)
    return
  }
  response.writeHead(404)
  response.end('not found')
})

let closing = false
function close() {
  if (closing) return
  closing = true
  server.close(() => process.exit(0))
}
process.once('SIGTERM', close)
process.once('SIGINT', close)
server.listen(port, '127.0.0.1')
