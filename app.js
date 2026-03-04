// 
// STATE
// 
var STORE_KEY    = 'kw_tasks_v3';
var SETTINGS_KEY = 'kw_settings_v3';
var FOCUS_KEY    = 'kw_focus_v3';
var PENDING_KEY  = 'kw_pending_v3';
var NOTES_KEY    = 'kw_notes_v3';
var NOTES_MONO_KEY = 'kw_notes_mono_v3';
var DASH_KEY     = 'kw_dash_v1';
var PROJ_KEY     = 'kw_proj_v1';
var BEL_KEY      = 'kw_bel_v1';

var CAT_LABEL = { manuscript:'manuscript', lab:'lab ops', phd:'phd apps', conf:'conference', bel:'bel ♡', personal:'personal', hobby:'hobby' };

var state = { 
  tasks:[], 
  projects:[], 
  settings:{ghUser:'',ghRepo:'',ghToken:''}, 
  focus:null, filter:'all', editingId:null, activeProjectId:null, 
  pendingSync:false, sha:null, focusMode:false, notesOpen:false, 
  scratchpad:'', collapsed:{}, _shaLoaded:true 
};

var belState = { annivDate: '', giftsList: [], datesList: [], favs: '', love: '' };

// POMODORO STATE
var pomo = { timer: null, timeLeft: 25 * 60, mode: 'work', running: false, cycles: 0 };

function loadLocal() {
  try { var r=localStorage.getItem(STORE_KEY); if(r) state.tasks=JSON.parse(r); } catch(e){}
  try { var pr=localStorage.getItem(PROJ_KEY); if(pr) state.projects=JSON.parse(pr); } catch(e){}
  try { var b=localStorage.getItem(BEL_KEY); if(b) belState=JSON.parse(b); } catch(e){}
  try { var s=localStorage.getItem(SETTINGS_KEY); if(s) state.settings=JSON.parse(s); } catch(e){}
  try { var f=localStorage.getItem(FOCUS_KEY); if(f) state.focus=f; } catch(e){}
  try { var p=localStorage.getItem(PENDING_KEY); if(p) state.pendingSync=JSON.parse(p); } catch(e){}
  try { var n=localStorage.getItem(NOTES_KEY); if(n!==null) state.scratchpad=n; } catch(e){}
  try { var col=localStorage.getItem('kw_collapsed_v1'); if(col) state.collapsed=JSON.parse(col); } catch(e){}
  
  if(!state.tasks) state.tasks = [];
  if(!state.projects) state.projects = [];
  if(state.settings.ghToken && state.settings.ghUser && state.settings.ghRepo) state._shaLoaded=false;
  
  state.tasks.forEach(function(t){ 
    if(t.section === 'today') t.pinnedToday = true; 
    if(t.category && !t.categories) t.categories = [t.category];
    delete t.section; delete t.category;
  });

  if(!belState.giftsList) belState.giftsList = [];
  if(typeof belState.gifts === 'string' && belState.gifts) { belState.giftsList.push({id:uid(), text:belState.gifts, done:false}); delete belState.gifts; }
  if(!belState.datesList) belState.datesList = [];
  if(typeof belState.dates === 'string' && belState.dates) { belState.datesList.push({id:uid(), text:belState.dates, done:false}); delete belState.dates; }
  
  loadDash();
}

function saveLocal() {
  localStorage.setItem(STORE_KEY, JSON.stringify(state.tasks));
  localStorage.setItem(PROJ_KEY, JSON.stringify(state.projects));
  localStorage.setItem(FOCUS_KEY, state.focus||'');
  localStorage.setItem(NOTES_KEY, state.scratchpad||'');
}

function saveBel(sync) {
  try { localStorage.setItem(BEL_KEY, JSON.stringify(belState)); } catch(e){}
  if(sync) ghPush();
}

function savePending(v) { state.pendingSync=v; localStorage.setItem(PENDING_KEY,JSON.stringify(v)); }
function uid() { return Date.now().toString(36)+Math.random().toString(36).slice(2,6); }

// GITHUB
var GH_API='https://api.github.com';
function ghHeaders(){ return {'Authorization':'token '+state.settings.ghToken,'Content-Type':'application/json','Accept':'application/vnd.github.v3+json','X-GitHub-Api-Version':'2022-11-28'}; }
function ghPath(){ return GH_API+'/repos/'+state.settings.ghUser+'/'+state.settings.ghRepo+'/contents/tasks.json'; }

function ghFetch(retries){
  if(!state.settings.ghToken||!state.settings.ghUser||!state.settings.ghRepo) return;
  retries = retries || 0;
  fetch(ghPath(),{headers:ghHeaders()})
    .then(function(r){
      if(r.status===404){ state._shaLoaded=true; ghPush(); return null; }
      if(r.status===401||r.status===403){ state._shaLoaded=true; showSync('error','Auth failed — check token'); return null; }
      if(!r.ok) throw new Error(r.status);
      return r.json();
    })
    .then(function(d){
      if(!d) return;
      state.sha=d.sha;
      state._shaLoaded=true;
      var dec=JSON.parse(decodeURIComponent(escape(atob(d.content.replace(/\n/g,'')))));
      
      state.tasks = dec.tasks || dec;
      if(!state.tasks) state.tasks = [];
      if(dec.projects) state.projects = dec.projects;
      if(!state.projects) state.projects = [];
      
      if(dec.bel) belState = dec.bel;
      if(dec.scratchpad !== undefined) state.scratchpad=dec.scratchpad;
      if(dec.shop !== undefined){ shopItems=dec.shop; try{localStorage.setItem(SHOP_KEY,JSON.stringify(shopItems));}catch(e){} }
      if(dec.dash !== undefined){ Object.assign(dState, dec.dash); saveDash(false); }
      
      state.tasks.forEach(function(t){ 
        if(t.category && !t.categories) t.categories = [t.category];
        delete t.category;
      });
      
      saveLocal(); saveBel(false);
      var sp=document.getElementById('scratchpad');
      if(sp && document.activeElement !== sp) sp.value=state.scratchpad;
      
      var bClass = document.body.classList;
      if(bClass.contains('dash-mode')) renderDashFull();
      else if(bClass.contains('projects-mode')) renderProjects();
      else if(bClass.contains('projects-detail-mode')) renderProjectTasks();
      else if(bClass.contains('bel-mode')) renderBel();
      else render();
      
      if(ghPushQueued){ ghPush(); } else { savePending(false); }
    })
    .catch(function(){
      state._shaLoaded=true;
      if(retries < 1 && navigator.onLine){ setTimeout(function(){ ghFetch(1); }, 3000); }
      else { showSync(navigator.onLine?'error':'offline', navigator.onLine?'Sync failed':'Offline — saved locally'); }
    });
}

var ghPushQueued = false;
function ghPush(){
  if(!state.settings.ghToken||!state.settings.ghUser||!state.settings.ghRepo){ savePending(true); return; }
  if(!navigator.onLine){ savePending(true); showSync('offline','Offline — will sync when reconnected'); return; }
  if(!state._shaLoaded){ ghPushQueued = true; return; }
  ghPushQueued = false;
  showSync('syncing','Saving to GitHub…');
  var payload={tasks:state.tasks, projects:state.projects, bel:belState, scratchpad:state.scratchpad, shop:shopItems, dash:dState, updated:new Date().toISOString()};
  var content=btoa(unescape(encodeURIComponent(JSON.stringify(payload,null,2))));
  var body={message:'Update tasks '+new Date().toLocaleTimeString(),content:content};
  if(state.sha) body.sha=state.sha;
  fetch(ghPath(),{method:'PUT',headers:ghHeaders(),body:JSON.stringify(body)})
    .then(function(r){
      if(r.status===409||r.status===422){
        return fetch(ghPath(),{headers:ghHeaders()})
          .then(function(r2){ return r2.json(); })
          .then(function(d2){
            state.sha=d2.sha;
            body.sha=state.sha;
            return fetch(ghPath(),{method:'PUT',headers:ghHeaders(),body:JSON.stringify(body)});
          })
          .then(function(r3){ if(!r3.ok) throw new Error(r3.status); return r3.json(); });
      }
      if(!r.ok) throw new Error(r.status);
      return r.json();
    })
    .then(function(d){ state.sha=d.content.sha; savePending(false); showSync('success','Saved'); })
    .catch(function(){ savePending(true); showSync('error','Save failed — stored locally'); });
}

function testGhConnection(){
  var s=state.settings;
  if(!s.ghToken||!s.ghUser||!s.ghRepo) return Promise.resolve(false);
  return fetch(GH_API+'/repos/'+s.ghUser+'/'+s.ghRepo,{headers:ghHeaders()}).then(function(r){return r.ok;}).catch(function(){return false;});
}

window.addEventListener('online', function(){ if(state.pendingSync) ghPush(); });

function showSync(type,msg){
  if(type==='syncing'||type==='success') return;
  var bar=document.getElementById('syncBar');
  bar.className='sync-bar show '+type;
  document.getElementById('syncMsg').textContent=msg;
  if(syncTimer) clearTimeout(syncTimer);
  syncTimer=setTimeout(function(){ bar.classList.remove('show'); },4000);
}
var syncTimer=null;

// RENDER & TIME LOGIC
function isActuallyDueToday(t){
  if(t.done) return false;
  if(t.pinnedToday) return true;
  if(!t.due) return false;
  var today=new Date(); today.setHours(0,0,0,0);
  var d=new Date(t.due+'T00:00:00');
  if(isNaN(d)) return false;
  return Math.round((d-today)/86400000) === 0;
}

function dueClass(due){
  if(!due) return '';
  var today = new Date(); today.setHours(0,0,0,0);
  var d = new Date(due + 'T00:00:00');
  if(isNaN(d)) return '';
  var diff = Math.round((d - today) / 86400000);
  if(diff < 0)  return 'overdue';
  if(diff === 0) return 'today';
  if(diff <= 3)  return 'soon';
  return '';
}

function formatDate(){
  var d=new Date();
  var days=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  var months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  document.getElementById('dateDisplay').textContent=days[d.getDay()]+', '+months[d.getMonth()]+' '+d.getDate();

  var overdueCount = state.tasks.filter(function(t){ return !t.done && t.due && dueClass(t.due)==='overdue' && !t.pinnedToday; }).length;
  var todayCount   = state.tasks.filter(function(t){ return !t.done && isActuallyDueToday(t); }).length;
  var doneToday    = state.tasks.filter(function(t){ return t.done && t.completedAt && (new Date(t.completedAt).toDateString()===new Date().toDateString()); }).length;
  var blockedCount = state.tasks.filter(function(t){ return !t.done && (t.status==='blocked'||t.status==='waiting'); }).length;

  var parts=[];
  if(overdueCount>0) parts.push('<span class="sub-overdue">'+overdueCount+' overdue</span>');
  if(todayCount>0)   parts.push(todayCount+' today');
  if(blockedCount>0) parts.push('<span class="sub-blocked">'+blockedCount+' blocked</span>');
  if(doneToday>0)    parts.push('<span class="sub-done">'+doneToday+' done</span>');
  var sub = parts.length ? parts.join(' · ') : 'All clear ✓';
  document.getElementById('dateSub').innerHTML = sub;
  document.title = overdueCount > 0 ? '(' + overdueCount + ') Tasks' : 'Tasks';
}

function esc(s){ return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function fmtDue(due){
  if(!due) return '';
  var today = new Date(); today.setHours(0,0,0,0);
  var d = new Date(due + 'T00:00:00');
  if(isNaN(d)) return due;
  var diff = Math.round((d - today) / 86400000);
  if(diff < 0)  return 'Overdue (' + fmtShort(d) + ')';
  if(diff === 0) return 'Today';
  if(diff === 1) return 'Tomorrow';
  if(diff <= 6)  return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()];
  return fmtShort(d);
}

function fmtShort(d){
  var months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return months[d.getMonth()] + ' ' + d.getDate();
}

function catCls(cat){ var m={manuscript:'cat-manuscript',lab:'cat-lab',phd:'cat-phd',conf:'cat-conf',bel:'cat-bel',personal:'cat-personal',hobby:'cat-hobby'}; return m[cat]||''; }

function makeTaskWrap(t, delay) {
  var wrap = document.createElement('div');
  wrap.className = 'task-wrap entering';
  wrap.dataset.id = t.id;
  wrap.style.animationDelay = (delay||0)+'ms';

  var bgDefer = document.createElement('div');
  bgDefer.className = 'swipe-bg-defer';
  bgDefer.innerHTML = '<svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/><polyline points="15 18 21 12 15 6"/></svg><span>defer</span>';
  wrap.appendChild(bgDefer);

  var bg = document.createElement('div');
  bg.className = 'swipe-bg';
  bg.innerHTML = '<svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>';
  wrap.appendChild(bg);

  var el = document.createElement('div');
  el.className = 'task '+(t.priority||'md')+(t.done?' done':'')+(((t.status==='blocked'||t.status==='waiting')&&!t.done)?' dimmed':'');
  el.dataset.id = t.id;

  var catArray = t.categories || [];
  var catHtml = catArray.map(function(c) {
      return '<span class="cat '+catCls(c)+'">'+esc(CAT_LABEL[c]||c)+'</span>';
  }).join('');
  
  var statusMap={waiting:'waiting on',blocked:'blocked',review:'in review'};
  var statusHtml=(t.status&&t.status!=='active')?'<span class="status '+t.status+'">'+esc(statusMap[t.status]||t.status)+'</span>':'';
  var dc=dueClass(t.due);
  var dueHtml=t.due?'<span class="due '+dc+'">'+esc(fmtDue(t.due))+'</span>':'';
  var noteHtml=t.note?'<div class="note'+(t.noteIsMono?' note-mono':'')+'">'+esc(t.note)+'</div>':'';
  
  var projHtml = '';
  if(t.projectId) {
    var p = (state.projects||[]).find(function(x){ return x.id === t.projectId; });
    if(p) projHtml = '<span class="proj-link-label">⛌ '+esc(p.title)+'</span>';
  }

  el.innerHTML=
    '<div class="cb">'+(t.done?'':'')+'</div>'+
    '<div class="task-body">'+
      '<div class="task-title">'+esc(t.title)+'</div>'+
      '<div class="task-row">'+catHtml+statusHtml+projHtml+dueHtml+'</div>'+
      noteHtml+
    '</div>';
    
  el.querySelector('.cb').addEventListener('click', function(e){
    e.stopPropagation();
    animateCheck(t.id, el);
  });
  el.addEventListener('click', function(){ openEdit(t.id); });

  wrap.appendChild(el);
  attachSwipe(wrap, el, bg, t.id);
  addDragHandles(wrap, t.id);

  return wrap;
}

function makeArchiveWrap(t, delay) {
  var wrap = document.createElement('div');
  wrap.className = 'task-wrap entering';
  wrap.style.animationDelay = (delay||0)+'ms';

  var el = document.createElement('div');
  el.className = 'task '+(t.priority||'md')+' done archived';
  
  var catArray = t.categories || [];
  var catHtml = catArray.map(function(c) { return '<span class="cat '+catCls(c)+'">'+esc(CAT_LABEL[c]||c)+'</span>'; }).join('');
  
  var completedStr='';
  if(t.completedAt){
    var cd=new Date(t.completedAt);
    completedStr='Completed '+fmtShort(cd);
  }
  var noteHtml=t.note?'<div class="note'+(t.noteIsMono?' note-mono':'')+'">'+esc(t.note)+'</div>':'';

  el.innerHTML=
    '<div class="cb"></div>'+
    '<div class="task-body">'+
      '<div class="task-title">'+esc(t.title)+'</div>'+
      '<div class="task-row">'+catHtml+'</div>'+
      (completedStr?'<div class="archive-meta">'+completedStr+'</div>':'')+
      noteHtml+
      '<div style="margin-top:6px;display:flex;gap:12px;">'+
        '<span class="restore-btn" data-id="'+t.id+'">↺ Restore</span>'+
        '<span class="restore-btn" style="color:#ff7070;" data-del="'+t.id+'">🗑 Delete</span>'+
      '</div>'+
    '</div>';
    
  el.querySelector('[data-id]').addEventListener('click', function(e){ e.stopPropagation(); restoreTask(t.id); });
  el.querySelector('[data-del]').addEventListener('click', function(e){ e.stopPropagation(); if(confirm('Permanently delete "'+t.title+'"?')) deleteTask(t.id); });
  wrap.appendChild(el); return wrap;
}

function restoreTask(id){
  for(var i=0;i<state.tasks.length;i++){
    if(state.tasks[i].id===id){
      state.tasks[i].done=false; delete state.tasks[i].completedAt; break;
    }
  }
  saveLocal(); render(); ghPush(); showToast('Task restored');
}

function deferTask(id){
  for(var i=0;i<state.tasks.length;i++){
    if(state.tasks[i].id===id){
      var t=state.tasks[i]; var tomorrow=new Date(); tomorrow.setDate(tomorrow.getDate()+1);
      var tStr=tomorrow.toISOString().split('T')[0];
      if(t.due){ var d=new Date(t.due+'T00:00:00'); d.setDate(d.getDate()+1); t.due=d.toISOString().split('T')[0]; } else { t.due=tStr; }
      t.pinnedToday=false; break;
    }
  }
  saveLocal(); render(); ghPush(); showToast('Deferred to tomorrow');
}

function attachSwipe(wrap, el, bg, id) {
  var bgDefer = wrap.querySelector('.swipe-bg-defer');
  var startX=0, startY=0, currentX=0, dragging=false, maybeSwipe=false;
  var THRESHOLD = 80;

  el.addEventListener('touchstart', function(e){ startX = e.touches[0].clientX; startY = e.touches[0].clientY; dragging = false; maybeSwipe = true; currentX = 0; }, {passive:true});
  el.addEventListener('touchmove', function(e){
    if(!maybeSwipe) return;
    var dx = e.touches[0].clientX - startX; var dy = e.touches[0].clientY - startY;
    if(!dragging && Math.abs(dy) > Math.abs(dx) + 5){ maybeSwipe=false; return; }
    dragging = true; currentX = dx;
    var clamped = Math.max(-120, Math.min(120, dx)); el.style.transform = 'translateX('+clamped+'px)';
    var pct = Math.min(Math.abs(dx)/THRESHOLD, 1);
    if(dx < 0){ bg.style.opacity = pct; if(bgDefer) bgDefer.style.opacity = 0; } else { if(bgDefer) bgDefer.style.opacity = pct; bg.style.opacity = 0; }
    e.preventDefault();
  }, {passive:false});
  
  el.addEventListener('touchend', function(){
    if(!dragging){ maybeSwipe=false; return; }
    maybeSwipe=false; dragging=false;
    if(currentX <= -THRESHOLD){
      wrap.classList.add('removing'); setTimeout(function(){ deleteTask(id); }, 200);
    } else if(currentX >= THRESHOLD){
      el.style.transition = 'transform 0.2s ease'; el.style.transform = 'translateX(0)';
      if(bgDefer) bgDefer.style.opacity = 0; setTimeout(function(){ el.style.transition=''; deferTask(id); }, 150);
    } else {
      el.style.transition = 'transform 0.2s ease'; el.style.transform = 'translateX(0)';
      bg.style.opacity = 0; if(bgDefer) bgDefer.style.opacity = 0; setTimeout(function(){ el.style.transition=''; }, 200);
    }
  }, {passive:true});
}

function animateCheck(id, el) {
  var cb = el.querySelector('.cb'); cb.classList.add('popping');
  setTimeout(function(){ cb.classList.remove('popping'); }, 300); toggleDone(id);
}

function filterTask(t){
  var f=state.filter;
  if(state.focusMode) return isActuallyDueToday(t) && !t.done;
  if(f==='archive') return t.done;
  if(t.done) return false;
  if(f==='all') return true;
  if(f==='today') return isActuallyDueToday(t);
  if(f==='blocked') return t.status==='blocked'||t.status==='waiting';
  var catArray = t.categories || []; return catArray.indexOf(f) !== -1;
}

function searchMatch(t,q){
  if(!q) return true; var ql=q.toLowerCase(); return (t.title||'').toLowerCase().indexOf(ql)!==-1||(t.note||'').toLowerCase().indexOf(ql)!==-1;
}

function render(){
  formatDate();
  var searchQ = document.getElementById('searchInput').value.trim();

  var ft=null;
  if(state.focus){ for(var i=0;i<state.tasks.length;i++){ if(state.tasks[i].id===state.focus&&!state.tasks[i].done){ft=state.tasks[i];break;} } }
  
  if(ft){
    document.getElementById('focusTitle').textContent=ft.title;
    document.getElementById('pomoTaskLabel').textContent=ft.title;
    var parts=[]; 
    if(ft.categories && ft.categories.length) parts.push(CAT_LABEL[ft.categories[0]]||ft.categories[0]); 
    if(ft.due) parts.push(ft.due);
    document.getElementById('focusSub').textContent=parts.join(' · ')||'Pinned';
  } else {
    state.focus=null;
    document.getElementById('focusTitle').textContent='No task pinned';
    document.getElementById('pomoTaskLabel').textContent='No task pinned';
    document.getElementById('focusSub').textContent='Open a task and tap Set as Focus';
  }
  
  var focusEyeEl = document.querySelector('.focus-eye'); if (focusEyeEl) focusEyeEl.textContent = 'Current Focus';

  var list=document.getElementById('taskList'); list.innerHTML='';
  var isArchive = state.filter==='archive';
  var delayBase=0;

  if(isArchive){
    var archived = state.tasks.filter(function(t){ return t.done && searchMatch(t,searchQ); });
    archived.sort(function(a,b){ return (b.completedAt||'') > (a.completedAt||'') ? 1 : -1; });
    if(archived.length===0){
      list.innerHTML='<div class="empty-state"><div class="empty-icon">📁</div><div>Nothing archived yet</div></div>';
    } else {
      var section=document.createElement('div'); section.className='section';
      var header=document.createElement('div'); header.className='sec-header';
      header.innerHTML='<div class="sec-title">Completed</div><div class="sec-count">'+archived.length+'</div>';
      section.appendChild(header);
      archived.forEach(function(t,i){ section.appendChild(makeArchiveWrap(t, i*25)); });
      list.appendChild(section);
    }
  } else {
    var timeGroups = { overdue: [], today: [], tomorrow: [], week: [], later: [] };
    
    state.tasks.forEach(function(t){
      if(t.done || !searchMatch(t,searchQ)) return;
      if(!filterTask(t)) return;
      if(isActuallyDueToday(t)) { timeGroups.today.push(t); }
      else if(!t.due) { timeGroups.later.push(t); }
      else {
        var today = new Date(); today.setHours(0,0,0,0);
        var d = new Date(t.due+'T00:00:00');
        var diff = Math.round((d - today) / 86400000);
        if(diff < 0) timeGroups.overdue.push(t);
        else if(diff === 1) timeGroups.tomorrow.push(t);
        else if(diff <= 7) timeGroups.week.push(t);
        else timeGroups.later.push(t);
      }
    });

    var groupOrder = [
      { id: 'overdue', label: 'Overdue', color: '#ff3a30' },
      { id: 'today', label: 'Today', color: '' },
      { id: 'tomorrow', label: 'Tomorrow', color: '' },
      { id: 'week', label: 'This Week', color: '' },
      { id: 'later', label: 'Later', color: '' }
    ];

    if(state.focusMode) groupOrder = [{ id: 'today', label: 'Today', color: '' }];
    var anyVisible = false;

    groupOrder.forEach(function(g) {
      var tasks = timeGroups[g.id];
      if(tasks.length === 0) return;
      anyVisible = true;
      tasks.sort(function(a,b){
        var po={hi:0,md:1,lo:2}; var pa=po[a.priority||'md']||1, pb=po[b.priority||'md']||1;
        if(pa!==pb) return pa-pb;
        var da=a.due?new Date(a.due+'T00:00:00').getTime():Infinity; var db=b.due?new Date(b.due+'T00:00:00').getTime():Infinity;
        return da-db;
      });

      var isCollapsed = state.collapsed['grp_'+g.id];
      var section = document.createElement('div');
      section.className = 'section' + (isCollapsed ? ' collapsed' : '');
      section.dataset.sec = g.id;

      var header = document.createElement('div');
      header.className = 'sec-header'; header.style.cursor = 'pointer';
      var titleColor = g.color ? 'color:'+g.color+';' : '';
      header.innerHTML = '<div style="display:flex;align-items:center;gap:7px;"><div class="sec-title" style="'+titleColor+'">'+g.label+'</div><div class="sec-count">'+tasks.length+'</div></div><div class="sec-toggle">⌄</div>';
      
      header.addEventListener('click', function(){
        state.collapsed['grp_'+g.id] = !state.collapsed['grp_'+g.id];
        try { localStorage.setItem('kw_collapsed_v1', JSON.stringify(state.collapsed)); } catch(e){}
        section.classList.toggle('collapsed', state.collapsed['grp_'+g.id]);
      });
      section.appendChild(header);

      var tasksWrap = document.createElement('div'); tasksWrap.className = 'sec-tasks';
      tasks.forEach(function(t,i){ tasksWrap.appendChild(makeTaskWrap(t, isCollapsed ? 0 : delayBase + i*30)); });
      section.appendChild(tasksWrap); delayBase += tasks.length * 30 + 50; list.appendChild(section);
    });
    
    if(!anyVisible){ list.innerHTML='<div class="empty-state"><div class="empty-icon">✓</div><div>'+(state.focusMode?'Nothing due today':'No tasks match this filter')+'</div></div>'; }
  }

  document.getElementById('focusBanner').style.display = state.focusMode ? 'flex' : 'none';
  document.getElementById('focusBtnLabel').textContent = state.focusMode ? 'Exit Focus' : 'Focus';
  var focusDoneBtn = document.getElementById('focusDoneBtn'); if(focusDoneBtn) focusDoneBtn.style.display = (ft && !state.focusMode) ? 'block' : 'none';
}

// POMODORO TIMER LOGIC
function formatTime(sec) {
  var m = Math.floor(sec / 60); var s = sec % 60; return m.toString().padStart(2, '0') + ':' + s.toString().padStart(2, '0');
}
function updatePomoUI() {
  document.getElementById('pomoDisplay').textContent = formatTime(pomo.timeLeft);
  var statusTxt = 'Work Session';
  if(pomo.mode === 'shortBreak') statusTxt = 'Short Break (5m)';
  if(pomo.mode === 'longBreak') statusTxt = 'Long Break (15m)';
  document.getElementById('pomoStatus').textContent = statusTxt + ' • ' + pomo.cycles + ' completed';
  document.getElementById('pomoStartBtn').textContent = pomo.running ? 'Pause' : 'Start';
}
function tickPomo() {
  pomo.timeLeft--;
  if (pomo.timeLeft <= 0) {
    clearInterval(pomo.timer); pomo.running = false;
    if (pomo.mode === 'work') {
      pomo.cycles++;
      if(state.focus) { var t = state.tasks.find(function(x) { return x.id === state.focus; }); if(t) { t.pomodoros = (t.pomodoros || 0) + 1; saveLocal(); ghPush(); } }
      pomo.mode = (pomo.cycles % 4 === 0) ? 'longBreak' : 'shortBreak';
      pomo.timeLeft = (pomo.mode === 'longBreak') ? 15 * 60 : 5 * 60; showToast('Session complete! Take a break.');
    } else {
      pomo.mode = 'work'; pomo.timeLeft = 25 * 60; showToast('Break over! Ready to focus?');
    }
  }
  updatePomoUI();
}
document.getElementById('pomoStartBtn').addEventListener('click', function(){
  if(pomo.running) { clearInterval(pomo.timer); pomo.running = false; } 
  else { pomo.running = true; pomo.timer = setInterval(tickPomo, 1000); }
  updatePomoUI();
});
document.getElementById('pomoSkipBtn').addEventListener('click', function(){
   clearInterval(pomo.timer); pomo.running = false;
   if (pomo.mode === 'work') { pomo.mode = 'shortBreak'; pomo.timeLeft = 5 * 60; showToast('Session skipped.'); } 
   else { pomo.mode = 'work'; pomo.timeLeft = 25 * 60; showToast('Break skipped.'); }
   updatePomoUI();
});

function toggleDone(id){
  for(var i=0;i<state.tasks.length;i++){
    if(state.tasks[i].id===id){
      state.tasks[i].done=!state.tasks[i].done;
      if(state.tasks[i].done){ state.tasks[i].completedAt=new Date().toISOString(); } else { delete state.tasks[i].completedAt; }
      break;
    }
  }
  saveLocal(); if(document.body.classList.contains('projects-detail-mode')) renderProjectTasks(); else render(); ghPush();
}

var undoBuffer = null; var undoTimer = null; var UNDO_MS = 4000;
function deleteTask(id){
  var t = null; for(var i=0;i<state.tasks.length;i++){ if(state.tasks[i].id===id){ t=state.tasks[i]; break; } }
  if(!t) return;
  if(undoTimer) clearTimeout(undoTimer);
  undoBuffer = { task: JSON.parse(JSON.stringify(t)), focusWas: state.focus===id };
  state.tasks = state.tasks.filter(function(t){ return t.id!==id; });
  if(state.focus===id) state.focus=null;
  saveLocal(); formatDate();
  if(state.focus===null){
    document.getElementById('focusTitle').textContent='No task pinned'; document.getElementById('pomoTaskLabel').textContent='No task pinned'; document.getElementById('focusSub').textContent='Open a task and tap Set as Focus';
  }
  showUndoToast(t.title);
  if(document.body.classList.contains('projects-detail-mode')) renderProjectTasks(); else render();
}
function showUndoToast(title){
  var el = document.getElementById('toastUndo'); var msg = document.getElementById('toastUndoMsg');
  var display = title.length > 28 ? title.slice(0,26)+'…' : title;
  msg.textContent = '“'+display+'” deleted'; el.classList.add('show');
  if(undoTimer) clearTimeout(undoTimer);
  undoTimer = setTimeout(function(){ el.classList.remove('show'); undoBuffer = null; ghPush(); }, UNDO_MS);
}
function commitUndo(){
  if(!undoBuffer) return;
  clearTimeout(undoTimer); undoTimer = null; state.tasks.push(undoBuffer.task);
  if(undoBuffer.focusWas) state.focus = undoBuffer.task.id;
  undoBuffer = null; document.getElementById('toastUndo').classList.remove('show');
  saveLocal(); if(document.body.classList.contains('projects-detail-mode')) renderProjectTasks(); else render(); ghPush(); showToast('Restored');
}
document.getElementById('toastUndoBtn').addEventListener('click', commitUndo);

function populateTaskProjectSelect() {
  var sel = document.getElementById('taskProjectInput'); if(!sel) return;
  sel.innerHTML = '<option value="">None</option>';
  (state.projects||[]).forEach(function(p){ var opt = document.createElement('option'); opt.value = p.id; opt.textContent = p.title; sel.appendChild(opt); });
}

function openEdit(id){
  var t=null; for(var i=0;i<state.tasks.length;i++){ if(state.tasks[i].id===id){t=state.tasks[i];break;} }
  if(!t) return;
  state.editingId=id; populateTaskProjectSelect();
  document.getElementById('addSheetTitle').textContent='Edit Task';
  document.getElementById('saveTaskBtn').textContent='Save Changes';
  document.getElementById('deleteTaskBtn').style.display='block';
  document.getElementById('focusPinBtn').style.display='block';
  document.getElementById('focusPinBtn').textContent=state.focus===id?'Unpin Focus':'Set as Focus';
  document.getElementById('taskTitleInput').value=t.title||'';
  var projInp = document.getElementById('taskProjectInput'); if(projInp) projInp.value = t.projectId || '';
  
  var pomoEl = document.getElementById('pomoCountDisplay');
  if (pomoEl) { if (t.pomodoros && t.pomodoros > 0) { pomoEl.style.display = 'block'; pomoEl.textContent = '🍅 ' + t.pomodoros + ' focus session' + (t.pomodoros > 1 ? 's' : '') + ' completed'; } else { pomoEl.style.display = 'none'; } }

  var noteEl=document.getElementById('taskNoteInput'); noteEl.value=t.note||''; noteEl.style.fontFamily=t.noteIsMono?"'DM Mono',monospace":"'DM Sans',sans-serif";
  document.getElementById('monoToggle').textContent=t.noteIsMono?'mono on':'mono off';
  document.getElementById('taskDueInput').value=t.due||'';
  
  var catArray = t.categories || [];
  document.querySelectorAll('#catRow .s-chip').forEach(function(c){ c.classList.toggle('active', catArray.indexOf(c.dataset.val) !== -1); });
  setChip('statusRow',t.status||'active'); setChip('priRow',t.priority||'md');
  var pinChip=document.getElementById('pinTodayChip'); if(pinChip) pinChip.classList.toggle('active',!!(t.pinnedToday));
  openSheet('addSheet');
}

function saveTask(){
  var title=document.getElementById('taskTitleInput').value.trim(); if(!title){ showToast('Enter a task title'); return; }
  var categories = []; document.querySelectorAll('#catRow .s-chip.active').forEach(function(c){ categories.push(c.dataset.val); });
  var status=getChip('statusRow')||'active'; var priority=getChip('priRow')||'md';
  var pinnedToday=!!(document.getElementById('pinTodayChip')&&document.getElementById('pinTodayChip').classList.contains('active'));
  var note=document.getElementById('taskNoteInput').value.trim(); var due=document.getElementById('taskDueInput').value; 
  var projInp = document.getElementById('taskProjectInput'); var projectId= projInp ? projInp.value : '';
  var noteIsMono=document.getElementById('taskNoteInput').style.fontFamily.indexOf('Mono')!==-1;
  
  if(state.editingId){
    for(var i=0;i<state.tasks.length;i++){
      if(state.tasks[i].id===state.editingId){
        var currentPomo = state.tasks[i].pomodoros || 0;
        Object.assign(state.tasks[i],{title:title,categories:categories,status:status,priority:priority,pinnedToday:pinnedToday,note:note,due:due,projectId:projectId,noteIsMono:noteIsMono, pomodoros: currentPomo}); break;
      }
    }
    showToast('Task updated');
  } else {
    state.tasks.push({id:uid(),title:title,categories:categories,status:status,priority:priority,pinnedToday:pinnedToday,note:note,due:due,projectId:projectId,noteIsMono:noteIsMono,done:false, pomodoros:0});
    showToast('Task added');
  }
  closeSheets(); saveLocal(); if(document.body.classList.contains('projects-detail-mode')) renderProjectTasks(); else render(); ghPush();
}

document.getElementById('focusPinBtn').addEventListener('click', function(){
  if(!state.editingId) return;
  state.focus = (state.focus===state.editingId) ? null : state.editingId;
  document.getElementById('focusPinBtn').textContent = state.focus===state.editingId ? 'Unpin Focus' : 'Set as Focus';
  saveLocal(); showToast(state.focus ? 'Focus set' : 'Focus cleared'); closeSheets(); render();
});
document.getElementById('focusArr').addEventListener('click', function(){ if(state.focus){ openEdit(state.focus); } else { showToast('Long-press a task to pin it as focus'); } });
document.getElementById('focusDoneBtn').addEventListener('click', function(e){ e.stopPropagation(); if(state.focus){ var id = state.focus; state.focus = null; animateCheck(id, document.querySelector('[data-id="'+id+'"] .task') || document.createElement('div')); saveLocal(); render(); ghPush(); showToast('Focus completed ✓'); } });
document.getElementById('focusModeBtn').addEventListener('click', function(){ state.focusMode = !state.focusMode; document.body.classList.toggle('focus-mode', state.focusMode); render(); showToast(state.focusMode ? 'Focus mode on — Timer ready' : 'Showing all tasks'); });

// SHEETS & SCROLL LOCK
function openSheet(id){ 
  document.getElementById(id).classList.add('open'); 
  document.getElementById('overlay').classList.add('open'); 
  document.body.style.overflow = 'hidden'; 
}
function closeSheets(){
  document.querySelectorAll('.sheet').forEach(function(s){
    s.style.bottom = ''; s.style.maxHeight = ''; s.style.height = ''; s.classList.remove('open');
    s.style.webkitTransform = ''; s.style.transform = ''; s.style.webkitTransition = ''; s.style.transition = '';
  });
  document.getElementById('overlay').classList.remove('open');
  document.body.style.overflow = '';
  state.editingId=null;
  var tTitle = document.getElementById('addSheetTitle'); if(tTitle) tTitle.textContent='New Task';
  var saveTBtn = document.getElementById('saveTaskBtn'); if(saveTBtn) saveTBtn.textContent='Add Task';
  var delTBtn = document.getElementById('deleteTaskBtn'); if(delTBtn) delTBtn.style.display='none';
  var focPBtn = document.getElementById('focusPinBtn'); if(focPBtn) focPBtn.style.display='none';
  var tInput = document.getElementById('taskTitleInput'); if(tInput) tInput.value='';
  var tnInput = document.getElementById('taskNoteInput'); if(tnInput) { tnInput.value=''; tnInput.style.fontFamily="'DM Sans',sans-serif"; }
  var mtog = document.getElementById('monoToggle'); if(mtog) mtog.textContent='mono off';
  var tdInput = document.getElementById('taskDueInput'); if(tdInput) tdInput.value='';
  var tpInput = document.getElementById('taskProjectInput'); if(tpInput) tpInput.value='';
  var pomoEl = document.getElementById('pomoCountDisplay'); if (pomoEl) pomoEl.style.display = 'none';
  document.querySelectorAll('#catRow .s-chip').forEach(function(c){c.classList.remove('active');});
  setChip('statusRow','active'); setChip('priRow','md');
  var pinChip = document.getElementById('pinTodayChip'); if(pinChip) pinChip.classList.remove('active');
  var pTitle = document.getElementById('projectSheetTitle'); if(pTitle) pTitle.textContent='New Project';
  var savePBtn = document.getElementById('saveProjBtn'); if(savePBtn) savePBtn.textContent='Save Project';
  var delPBtn = document.getElementById('deleteProjBtn'); if(delPBtn) delPBtn.style.display='none';
  var ptInput = document.getElementById('projTitleInput'); if(ptInput) ptInput.value='';
  var pdInput = document.getElementById('projDueInput'); if(pdInput) pdInput.value='';
  var pnInput = document.getElementById('projNoteInput'); if(pnInput) pnInput.value='';
  setChip('projStageRow', 'Planning');
}

// Block overlay scroll bubbling
document.getElementById('overlay').addEventListener('touchmove', function(e) { e.preventDefault(); }, {passive: false});

function openAddSheet(){
  state.editingId=null; closeSheets(); populateTaskProjectSelect();
  var qw=document.getElementById('quickAddWrap'); if(qw) { qw.classList.remove('open'); document.getElementById('quickAddInput').value=''; }
  if(document.body.classList.contains('projects-detail-mode') && state.activeProjectId) { var pInp = document.getElementById('taskProjectInput'); if(pInp) pInp.value = state.activeProjectId; }
  setTimeout(function(){ openSheet('addSheet'); },10);
}

function getChip(rowId){ var a=document.querySelector('#'+rowId+' .s-chip.active'); return a?a.dataset.val:null; }
function setChip(rowId,val){ document.querySelectorAll('#'+rowId+' .s-chip').forEach(function(c){c.classList.toggle('active',c.dataset.val===val);}); }

document.getElementById('addSheet').addEventListener('click', function(e){ var pin = e.target.closest('#pinTodayChip'); if(pin) pin.classList.toggle('active'); });
document.getElementById('catRow').addEventListener('click', function(e){ var chip=e.target.closest('.s-chip'); if(!chip) return; chip.classList.toggle('active'); });

['statusRow','priRow','projStageRow'].forEach(function(rowId){
  var el = document.getElementById(rowId);
  if(el) { el.addEventListener('click',function(e){ var chip=e.target.closest('.s-chip'); if(!chip) return; document.querySelectorAll('#'+rowId+' .s-chip').forEach(function(c){c.classList.remove('active');}); chip.classList.add('active'); }); }
});

// PROJECTS LOGIC
function renderProjects() {
  var list = document.getElementById('projectsList'); if(!list) return; list.innerHTML = '';
  if(!state.projects || state.projects.length === 0) { list.innerHTML = '<div class="empty-state"><div class="empty-icon">📁</div><div>No active projects yet</div></div>'; return; }
  
  var sorted = state.projects.slice().sort(function(a,b) {
    var stageOrder = { 'Active':1, 'Planning':2, 'Review':3, 'Waiting':4, 'Done':5 };
    var sa = stageOrder[a.stage] || 9; var sb = stageOrder[b.stage] || 9;
    if(sa !== sb) return sa - sb;
    var da = a.due ? new Date(a.due).getTime() : Infinity; var db = b.due ? new Date(b.due).getTime() : Infinity;
    return da - db;
  });
  
  sorted.forEach(function(p) {
    var card = document.createElement('div'); card.className = 'project-card'; card.dataset.id = p.id;
    var dStr = p.due ? '<span style="font-family:var(--font-mono); margin-left:8px;">📅 ' + fmtDue(p.due) + '</span>' : '';
    var tHTML = ''; var pTasks = state.tasks.filter(function(t){ return t.projectId === p.id && !t.done; });
    if(pTasks.length > 0) {
      tHTML += '<div class="project-tasks">';
      pTasks.slice(0,3).forEach(function(pt) { tHTML += '<div class="project-task-item"><div class="project-task-dot"></div>' + esc(pt.title) + '</div>'; });
      if(pTasks.length > 3) tHTML += '<div class="project-task-item" style="opacity:0.5; font-style:italic;">+ '+(pTasks.length-3)+' more</div>';
      tHTML += '</div>';
    }
    card.innerHTML = '<div class="project-header"><div class="project-title">' + esc(p.title) + '</div><div class="project-stage ' + esc(p.stage) + '">' + esc(p.stage) + '</div></div><div class="project-meta" style="margin-bottom:0;">' + pTasks.length + ' active task' + (pTasks.length!==1?'s':'') + dStr + '</div>' + tHTML;
    card.addEventListener('click', function(){ openProjectDetail(p.id); });
    list.appendChild(card);
  });
}

var newProjBtn = document.getElementById('newProjectBtn');
if(newProjBtn) { newProjBtn.addEventListener('click', function() { state.editingProjId = null; closeSheets(); setTimeout(function(){ openSheet('projectSheet'); }, 10); }); }

var saveProjBtn = document.getElementById('saveProjBtn');
if(saveProjBtn) {
  saveProjBtn.addEventListener('click', function() {
    var title = document.getElementById('projTitleInput').value.trim(); if(!title) { showToast('Enter project title'); return; }
    var stage = getChip('projStageRow') || 'Planning'; var due = document.getElementById('projDueInput').value; var note = document.getElementById('projNoteInput').value.trim();
    state.projects.push({ id:uid(), title:title, stage:stage, due:due, note:note }); showToast('Project created');
    closeSheets(); saveLocal(); renderProjects(); ghPush();
  });
}

function openProjectDetail(id) {
  var p = state.projects.find(function(x){ return x.id === id; }); if(!p) return;
  state.activeProjectId = id;
  document.getElementById('pdTitleInput').value = p.title || ''; document.getElementById('pdDueInput').value = p.due || ''; document.getElementById('pdNotesInput').innerHTML = p.note || ''; setChip('pdStageRow', p.stage || 'Planning');
  renderProjectTasks(); switchTab('projects-detail');
}

function saveProjectDetail() {
  if(!state.activeProjectId) return;
  var p = state.projects.find(function(x){ return x.id === state.activeProjectId; });
  if(p) {
     p.title = document.getElementById('pdTitleInput').value.trim() || 'Untitled Project'; p.stage = getChip('pdStageRow') || 'Planning'; p.due = document.getElementById('pdDueInput').value; p.note = document.getElementById('pdNotesInput').innerHTML;
     saveLocal(); ghPush();
  }
}

var pdTimer = null;
function queuePdSave() { if(pdTimer) clearTimeout(pdTimer); pdTimer = setTimeout(saveProjectDetail, 800); }
var pdTitle = document.getElementById('pdTitleInput'); if(pdTitle) pdTitle.addEventListener('input', queuePdSave);
var pdDue = document.getElementById('pdDueInput'); if(pdDue) pdDue.addEventListener('change', saveProjectDetail);
var pdNotes = document.getElementById('pdNotesInput'); if(pdNotes) pdNotes.addEventListener('input', queuePdSave);
var pdStageRow = document.getElementById('pdStageRow'); 
if(pdStageRow) { pdStageRow.addEventListener('click', function(e) { var chip = e.target.closest('.s-chip'); if(!chip) return; document.querySelectorAll('#pdStageRow .s-chip').forEach(function(c){ c.classList.remove('active'); }); chip.classList.add('active'); saveProjectDetail(); }); }

function renderProjectTasks() {
  var list = document.getElementById('pdTasksList'); if(!list) return; list.innerHTML = '';
  var pTasks = state.tasks.filter(function(t){ return t.projectId === state.activeProjectId && !t.done; });
  if(pTasks.length === 0) { list.innerHTML = '<div style="font-size:12px; color:var(--text-muted); font-style:italic; padding: 12px 0;">No active tasks linked.</div>'; return; }
  
  pTasks.forEach(function(t) {
    var el = document.createElement('div'); el.className = 'task ' + (t.priority||'md');
    var catHtml = (t.categories||[]).map(function(c) { return '<span class="cat '+catCls(c)+'">'+esc(CAT_LABEL[c]||c)+'</span>'; }).join('');
    var dc = dueClass(t.due); var dueHtml = t.due ? '<span class="due '+dc+'">'+esc(fmtDue(t.due))+'</span>' : '';
    el.innerHTML = '<div class="cb"></div><div class="task-body"><div class="task-title">'+esc(t.title)+'</div><div class="task-row">'+catHtml+dueHtml+'</div></div>';
    el.querySelector('.cb').addEventListener('click', function(e){ e.stopPropagation(); toggleDone(t.id); });
    el.addEventListener('click', function() { openEdit(t.id); });
    list.appendChild(el);
  });
}

var pdAdd = document.getElementById('pdAddTaskBtn'); if(pdAdd) { pdAdd.addEventListener('click', function(){ openAddSheet(); }); }

var pdDel = document.getElementById('delProjectDetailBtn');
if(pdDel) {
  pdDel.addEventListener('click', function() {
    if(!state.activeProjectId) return;
    if(confirm('Delete this project? Tasks inside will NOT be deleted, just unlinked.')) {
      state.projects = state.projects.filter(function(p){ return p.id !== state.activeProjectId; });
      state.tasks.forEach(function(t) { if(t.projectId === state.activeProjectId) delete t.projectId; });
      saveLocal(); ghPush(); switchTab('projects'); showToast('Project deleted');
    }
  });
}

// BEL TAB LOGIC
function renderBel() {
  if(!belState) belState = { annivDate:'', giftsList:[], datesList:[], favs:'', love:'' };
  var f = document.getElementById('belFavs'); if(f) f.innerHTML = belState.favs || '';
  var l = document.getElementById('belLove'); if(l) l.innerHTML = belState.love || '';
  renderBelList('belGiftsList', 'giftsList'); renderBelList('belDatesList', 'datesList'); updateBelTime();
}

function renderBelList(listId, dataKey) {
  var list = document.getElementById(listId); if(!list) return; var items = belState[dataKey] || []; list.innerHTML = '';
  if(items.length === 0) { list.innerHTML = '<div style="font-size:12px; color:#888; font-style:italic; padding-bottom:8px;">List is empty.</div>'; return; }
  items.forEach(function(item) {
      var row = document.createElement('div'); row.className = 'bel-item'; row.dataset.id = item.id; row.dataset.key = dataKey;
      row.innerHTML = '<div class="bel-cb '+(item.done?'checked':'')+'" data-action="check"></div><div class="bel-text '+(item.done?'checked':'')+'" data-action="check">'+esc(item.text)+'</div><div class="bel-del" data-action="del">&#x2715;</div>';
      list.appendChild(row);
  });
}

function addBelItem(listKey, inputId, listId) {
  var inp = document.getElementById(inputId); if(!inp) return; var text = inp.value.trim(); if(!text) return;
  if(!belState[listKey]) belState[listKey] = [];
  belState[listKey].push({ id: uid(), text: text, done: false }); inp.value = ''; saveBel(true); renderBelList(listId, listKey);
}

var bga = document.getElementById('belGiftAddBtn'); if(bga) bga.addEventListener('click', function(){ addBelItem('giftsList', 'belGiftInput', 'belGiftsList'); });
var bda = document.getElementById('belDateAddBtn'); if(bda) bda.addEventListener('click', function(){ addBelItem('datesList', 'belDateInput', 'belDatesList'); });
var bgi = document.getElementById('belGiftInput'); if(bgi) bgi.addEventListener('keydown', function(e){ if(e.key==='Enter') addBelItem('giftsList', 'belGiftInput', 'belGiftsList'); });
var bdi = document.getElementById('belDateInput'); if(bdi) bdi.addEventListener('keydown', function(e){ if(e.key==='Enter') addBelItem('datesList', 'belDateInput', 'belDatesList'); });

['belGiftsList', 'belDatesList'].forEach(function(listId) {
  var l = document.getElementById(listId); if(!l) return;
  l.addEventListener('click', function(e) {
      var action = e.target.dataset.action; var row = e.target.closest('.bel-item'); if(!row || !action) return;
      var id = row.dataset.id; var key = row.dataset.key;
      if(action === 'check') { var items = belState[key]; for(var i=0; i<items.length; i++) { if(items[i].id===id) items[i].done = !items[i].done; } }
      if(action === 'del') { belState[key] = belState[key].filter(function(i){ return i.id !== id; }); }
      saveBel(true); renderBelList(listId, key);
  });
});

function updateBelTime() {
  var countEl = document.getElementById('belTimeCount'); var annivEl = document.getElementById('belNextAnniv'); if(!countEl || !annivEl) return;
  if(!belState.annivDate) { countEl.textContent = '--'; annivEl.textContent = 'Tap Edit Date below to start'; return; }
  var start = new Date(belState.annivDate + 'T00:00:00'); var now = new Date(); now.setHours(0,0,0,0);
  if(start > now) { countEl.textContent = '--'; annivEl.textContent = 'Date is in the future!'; return; }
  var yrs = now.getFullYear() - start.getFullYear(); var mos = now.getMonth() - start.getMonth(); var days = now.getDate() - start.getDate();
  if(days < 0) { mos--; var prevMonth = new Date(now.getFullYear(), now.getMonth(), 0); days += prevMonth.getDate(); }
  if(mos < 0) { yrs--; mos += 12; }
  var str = []; if(yrs > 0) str.push(yrs + ' yr' + (yrs>1?'s':'')); if(mos > 0) str.push(mos + ' mo' + (mos>1?'s':'')); str.push(days + ' d');
  countEl.textContent = str.join(', ');
  var nextAnniv = new Date(start); nextAnniv.setFullYear(now.getFullYear());
  if(nextAnniv < now) nextAnniv.setFullYear(now.getFullYear() + 1);
  var diff = Math.round((nextAnniv - now) / 86400000);
  if(diff === 0) annivEl.textContent = "It's today! Happy Anniversary! ❤️"; else annivEl.textContent = diff + " days until next anniversary";
}

var belTimer = null;
['belFavs', 'belLove'].forEach(function(id) {
  var el = document.getElementById(id); if(!el) return;
  el.addEventListener('input', function() {
    if(!belState) belState = {}; belState[id.replace('bel','').toLowerCase()] = this.innerHTML;
    if(belTimer) clearTimeout(belTimer); belTimer = setTimeout(function(){ saveBel(true); }, 1000);
  });
});

var ebd = document.getElementById('editBelDateBtn');
if(ebd) { ebd.addEventListener('click', function() { var wrap = document.getElementById('belDateEditWrap'); wrap.style.display = wrap.style.display === 'flex' ? 'none' : 'flex'; if(wrap.style.display === 'flex') { document.getElementById('belAnnivInput').value = belState.annivDate || ''; } }); }
var sbd = document.getElementById('saveBelDateBtn');
if(sbd) { sbd.addEventListener('click', function() { var d = document.getElementById('belAnnivInput').value; if(!belState) belState = {}; belState.annivDate = d; document.getElementById('belDateEditWrap').style.display = 'none'; saveBel(true); updateBelTime(); }); }

// SETTINGS
function loadSettingsUI(){ document.getElementById('ghUser').value=state.settings.ghUser||''; document.getElementById('ghRepo').value=state.settings.ghRepo||''; document.getElementById('ghToken').value=state.settings.ghToken||''; updateGhUI(!!state.settings.ghToken); }
function updateGhUI(connected){ var el=document.getElementById('ghStatus'), txt=document.getElementById('ghStatusText'); if(connected){ el.className='settings-status connected'; txt.textContent='Connected: '+state.settings.ghUser+'/'+state.settings.ghRepo; } else { el.className='settings-status'; txt.textContent='Not connected to GitHub'; } }
document.getElementById('saveSettingsBtn').addEventListener('click',function(){
  var u=document.getElementById('ghUser').value.trim(); var r=document.getElementById('ghRepo').value.trim(); var t=document.getElementById('ghToken').value.trim();
  state.settings={ghUser:u,ghRepo:r,ghToken:t}; localStorage.setItem(SETTINGS_KEY,JSON.stringify(state.settings)); document.getElementById('saveSettingsBtn').textContent='Testing…';
  testGhConnection().then(function(ok){ document.getElementById('saveSettingsBtn').textContent='Save & Test Connection'; if(ok){ updateGhUI(true); showToast('Connected! Fetching tasks…'); state.sha=null; ghFetch(); } else { updateGhUI(false); showToast('Connection failed — check token & repo'); } });
});
document.getElementById('clearDataBtn').addEventListener('click',function(){ if(!confirm('Clear all local data? Cannot be undone.')) return; localStorage.clear(); state.tasks=[]; state.focus=null; state.projects=[]; belState={}; render(); closeSheets(); showToast('Local data cleared'); });

// SEARCH & FILTERS
document.getElementById('searchTrigger').addEventListener('click',function(){ var wrap=document.getElementById('searchWrap'); wrap.classList.toggle('open'); if(wrap.classList.contains('open')) document.getElementById('searchInput').focus(); else { document.getElementById('searchInput').value=''; render(); } });
document.getElementById('searchInput').addEventListener('input',render);
document.getElementById('filterRow').addEventListener('click',function(e){ var chip=e.target.closest('.chip'); if(!chip) return; document.querySelectorAll('#filterRow .chip').forEach(function(c){c.classList.remove('active');}); chip.classList.add('active'); state.filter=chip.dataset.filter; render(); });

// NOTES / SCRATCHPAD
var notesSyncTimer = null;
function openNotes(){ state.notesOpen = true; document.body.classList.add('notes-mode'); var sp = document.getElementById('scratchpad'); sp.value = state.scratchpad || ''; var isMono = localStorage.getItem(NOTES_MONO_KEY) === 'true'; sp.classList.toggle('mono', isMono); document.getElementById('notesMonoToggle').textContent = isMono ? 'mono on' : 'mono off'; document.getElementById('notesMonoToggle').classList.toggle('mono-active', isMono); document.getElementById('notesBtn').style.background = 'rgba(139,158,255,0.12)'; document.getElementById('notesBtn').style.borderColor = 'rgba(139,158,255,0.3)'; document.getElementById('notesBtn').querySelector('svg').style.stroke = '#8b9eff'; }
function closeNotes(){ state.notesOpen = false; document.body.classList.remove('notes-mode'); document.getElementById('notesBtn').style.background = ''; document.getElementById('notesBtn').style.borderColor = ''; document.getElementById('notesBtn').querySelector('svg').style.stroke = ''; render(); }
document.getElementById('notesBtn').addEventListener('click', function(){ if(state.notesOpen) closeNotes(); else openNotes(); });
document.getElementById('scratchpad').addEventListener('input', function(){ state.scratchpad = this.value; localStorage.setItem(NOTES_KEY, state.scratchpad); document.getElementById('notesSyncStatus').textContent = 'unsaved'; if(notesSyncTimer) clearTimeout(notesSyncTimer); notesSyncTimer = setTimeout(function(){ ghPush(); document.getElementById('notesSyncStatus').textContent = ''; }, 1500); });
document.getElementById('notesMonoToggle').addEventListener('click', function(){ var sp = document.getElementById('scratchpad'); var isMono = !sp.classList.contains('mono'); sp.classList.toggle('mono', isMono); this.textContent = isMono ? 'mono on' : 'mono off'; this.classList.toggle('mono-active', isMono); localStorage.setItem(NOTES_MONO_KEY, isMono ? 'true' : 'false'); });
document.getElementById('monoToggle').addEventListener('click', function(){ var noteEl = document.getElementById('taskNoteInput'); var isMono = noteEl.style.fontFamily.indexOf('Mono') !== -1; isMono = !isMono; noteEl.style.fontFamily = isMono ? "'DM Mono',monospace" : "'DM Sans',sans-serif"; this.textContent = isMono ? 'mono on' : 'mono off'; });
document.getElementById('closeAddSheet').addEventListener('click', closeSheets);
var cps = document.getElementById('closeProjectSheet'); if(cps) cps.addEventListener('click', closeSheets);
document.getElementById('closeSettingsSheet').addEventListener('click', closeSheets);

document.querySelectorAll('.sheet').forEach(function(sheet) {
  var startY = 0, dragging = false;
  sheet.addEventListener('touchstart', function(e) { if (sheet.scrollTop > 0) return; startY = e.touches[0].clientY; dragging = true; }, { passive: true });
  sheet.addEventListener('touchmove', function(e) { if (!dragging) return; var dy = e.touches[0].clientY - startY; if (dy > 0) { sheet.style.transform = 'translateY(' + dy + 'px)'; sheet.style.transition = 'none'; } }, { passive: true });
  sheet.addEventListener('touchend', function(e) { if (!dragging) return; dragging = false; var dy = e.changedTouches[0].clientY - startY; sheet.style.transition = ''; if (dy > 80) { closeSheets(); } else { sheet.style.transform = ''; } }, { passive: true });
});

// QUICK ADD
function toggleQuickAdd(){ var wrap = document.getElementById('quickAddWrap'); var inp = document.getElementById('quickAddInput'); wrap.classList.toggle('open'); if(wrap.classList.contains('open')){ inp.focus(); } else { inp.value=''; } }
function submitQuickAdd(){ var inp = document.getElementById('quickAddInput'); var title = inp.value.trim(); if(!title) return; var newTask = { id: Date.now().toString(), title: title, categories: ['personal'], status: 'active', priority: 'md', note: '', due: new Date().toISOString().split('T')[0], noteIsMono: false, pinnedToday: true, done: false, pomodoros: 0 }; state.tasks.push(newTask); saveLocal(); if(document.body.classList.contains('projects-mode')) renderProjects(); else render(); ghPush(); showToast('Pinned to Today'); inp.value = ''; document.getElementById('quickAddWrap').classList.remove('open'); }
document.getElementById('quickAddInput').addEventListener('keydown', function(e){ if(e.key === 'Enter'){ e.preventDefault(); submitQuickAdd(); } if(e.key === 'Escape'){ toggleQuickAdd(); } });
document.getElementById('quickAddSend').addEventListener('click', submitQuickAdd);
document.getElementById('fab').addEventListener('click', toggleQuickAdd);
(function(){ var pressTimer; document.getElementById('fab').addEventListener('touchstart', function(e){ pressTimer = setTimeout(function(){ toggleQuickAdd(); openAddSheet(); }, 600); }, {passive:true}); document.getElementById('fab').addEventListener('touchend', function(){ clearTimeout(pressTimer); }, {passive:true}); document.getElementById('fab').addEventListener('contextmenu', function(e){ e.preventDefault(); }); })();

document.getElementById('overlay').addEventListener('click',closeSheets);
document.getElementById('saveTaskBtn').addEventListener('click',saveTask);
document.getElementById('deleteTaskBtn').addEventListener('click',function(){ if(state.editingId) deleteTask(state.editingId); closeSheets(); });
document.getElementById('settingsBtn').addEventListener('click',function(){ loadSettingsUI(); openSheet('settingsSheet'); });
document.addEventListener('keydown',function(e){ if(e.key==='Escape'){ closeSheets(); return; } var tag = (document.activeElement||{}).tagName||''; var inInput = tag==='INPUT'||tag==='TEXTAREA'||document.activeElement.isContentEditable; if(inInput) return; if(e.key==='n'||e.key==='N'){ e.preventDefault(); openAddSheet(); } if(e.key==='/'){ e.preventDefault(); var wrap=document.getElementById('searchWrap'); wrap.classList.add('open'); document.getElementById('searchInput').focus(); } });

// TOAST
var toastTimer; function showToast(msg){ var el=document.getElementById('toast'); el.textContent=msg; el.classList.add('show'); if(toastTimer) clearTimeout(toastTimer); toastTimer=setTimeout(function(){el.classList.remove('show');},2000); }

// TAB NAVIGATION
function switchTab(tab) {
  document.body.classList.remove('dash-mode', 'projects-mode', 'projects-detail-mode', 'bel-mode');
  if (tab === 'projects-detail') { document.body.classList.add('projects-mode', 'projects-detail-mode'); } else if (tab !== 'tasks') { document.body.classList.add(tab + '-mode'); }
  document.querySelectorAll('.tab-btn').forEach(function(b) { b.classList.remove('active'); });
  var tBtn = document.getElementById('tab' + tab.charAt(0).toUpperCase() + tab.slice(1)); if(tBtn) tBtn.classList.add('active');
  if (tab === 'dash') { renderDashFull(); if (!weatherLoaded) loadWeather(); if (!clockTimer) clockTimer = setInterval(updateClock, 1000); } else { if (clockTimer) { clearInterval(clockTimer); clockTimer = null; } }
  if (tab === 'tasks') render(); if (tab === 'projects') renderProjects(); if (tab === 'bel') renderBel();
}
document.getElementById('tabTasks').addEventListener('click', function() { switchTab('tasks'); });
document.getElementById('tabDash').addEventListener('click',  function() { switchTab('dash'); });
var tpBtn = document.getElementById('tabProjects'); if(tpBtn) tpBtn.addEventListener('click', function() { switchTab('projects'); });

// Secret Routing Buttons
var sbt = document.getElementById('secretBelTrigger'); if(sbt) sbt.addEventListener('click', function() { switchTab('bel'); });
var cbb = document.getElementById('closeBelBtn'); if(cbb) cbb.addEventListener('click', function() { switchTab('tasks'); });
var cpd = document.getElementById('closeProjectDetailBtn'); if(cpd) cpd.addEventListener('click', function() { switchTab('projects'); });

// DASHBOARD LOGIC
var QUOTES = [
  { text: "The cost of a thing is the amount of what I will call life which is required to be exchanged for it.", attr: "Thoreau" },
  { text: "Do not seek to have events happen as you want them to, but instead want them to happen as they do happen, and your life will go well.", attr: "Epictetus" },
  { text: "You have power over your mind, not outside events. Realize this, and you will find strength.", attr: "Marcus Aurelius" },
  { text: "Simplicity is the ultimate sophistication.", attr: "Leonardo da Vinci" },
  { text: "The impediment to action advances action. What stands in the way becomes the way.", attr: "Marcus Aurelius" },
  { text: "We suffer more in imagination than in reality.", attr: "Seneca" },
  { text: "Be curious, not judgmental.", attr: "Walt Whitman" },
  { text: "The unexamined life is not worth living.", attr: "Socrates" },
  { text: "To know what you know and what you do not know — that is true knowledge.", attr: "Confucius" },
  { text: "Between stimulus and response there is a space. In that space is our power to choose our response.", attr: "Viktor Frankl" },
  { text: "Hard choices, easy life. Easy choices, hard life.", attr: "Jerzy Gregorek" },
  { text: "Most of what we say and do is not essential. Ask yourself at every moment: Is this necessary?", attr: "Marcus Aurelius" },
  { text: "The mind that is not baffled is not employed. The impeded stream is the one that sings.", attr: "Wendell Berry" },
  { text: "Perfectionism is the enemy of the good.", attr: "Voltaire" },
  { text: "A year from now you will wish you had started today.", attr: "Karen Lamb" },
];

var PROMPTS = [
  "What's one thing you're avoiding that you already know the answer to?",
  "What's the one task that, if done today, would make everything else easier?",
  "What does the best version of today look like?",
  "What would finishing strong today actually require?",
  "What are you pretending not to know?",
  "What's the most important thing, and are you doing it first?",
  "What would you do if you had half the time you think you need?",
  "What's cluttering your mental space right now?",
  "If you could only accomplish three things today, what would they be?"
];

var HABITS = [
  { id: 'sleep',  label: 'Slept 7h+',  bad: false },
  { id: 'read',   label: 'Read',       bad: false },
  { id: 'lift',   label: 'Lifted',     bad: false },
  { id: 'doom',   label: 'Doom scrolled', bad: true  },
];

var dState = { intention: '', intentionWeek: '', quoteIdx: 0, countdown: { name: '', date: '' }, reflection: '', reflectionDate: '', book: null, habits: {}, moods: {} };

function getISOWeek(d) { var date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); var day = date.getUTCDay() || 7; date.setUTCDate(date.getUTCDate() + 4 - day); var yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1)); var weekNo = Math.ceil((((date - yearStart) / 86400000) + 1) / 7); return date.getUTCFullYear() + '-W' + String(weekNo).padStart(2,'0'); }
function getWeekStart(d) { var date = new Date(d); var day = date.getDay(); var diff = (day === 0 ? -6 : 1 - day); date.setDate(date.getDate() + diff); return date; }
function getTodayStr() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); }
function getDayOfWeek() { var d = new Date().getDay(); return d === 0 ? 6 : d - 1; }

function loadDash() { try { var raw = localStorage.getItem(DASH_KEY); if (raw) dState = JSON.parse(raw); } catch(e) {} }
function saveDash(sync) { try { localStorage.setItem(DASH_KEY, JSON.stringify(dState)); } catch(e) {} if (sync) ghPush(); }

var clockTimer = null;
function updateClock() { var d = new Date(); var h = d.getHours(); var m = d.getMinutes(); var ampm = h >= 12 ? 'pm' : 'am'; var h12 = h % 12 || 12; document.getElementById('dClock').childNodes[0].textContent = h12 + ':' + String(m).padStart(2,'0'); document.getElementById('dAmpm').textContent = ampm; var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; document.getElementById('dDateSmall').textContent = months[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear(); }

var weatherLoaded = false;
function fetchWeatherAt(lat, lon, cityHint, regionHint) {
  var url = 'https://api.open-meteo.com/v1/forecast?latitude='+lat+'&longitude='+lon+'&current=temperature_2m,weathercode,windspeed_10m,relativehumidity_2m&daily=temperature_2m_max,temperature_2m_min&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto&forecast_days=1';
  fetch(url).then(function(r){ return r.json(); }).then(function(d) {
      weatherLoaded = true; var cur = d.current; var daily = d.daily;
      document.getElementById('dWeatherTemp').textContent = Math.round(cur.temperature_2m) + '°';
      document.getElementById('dWeatherDesc').textContent = weatherDesc(cur.weathercode);
      document.getElementById('dWeatherHigh').textContent = 'H: ' + Math.round(daily.temperature_2m_max[0]) + '°';
      document.getElementById('dWeatherLow').textContent  = 'L: ' + Math.round(daily.temperature_2m_min[0]) + '°';
      if (cityHint) { document.getElementById('dWeatherLabel').textContent = cityHint + (regionHint ? ', ' + regionHint : ''); } 
      else { fetch('https://nominatim.openstreetmap.org/reverse?format=json&lat='+lat+'&lon='+lon).then(function(r){ return r.json(); }).then(function(geo) { var city = (geo.address && (geo.address.city || geo.address.town || geo.address.village)) || ''; var st = (geo.address && geo.address.state) || ''; if (city) document.getElementById('dWeatherLabel').textContent = city + (st ? ', ' + st : ''); }).catch(function(){}); }
    }).catch(function() { document.getElementById('dWeatherDesc').textContent = 'Unavailable'; });
}

function loadWeather() {
  if (weatherLoaded) return; if (!navigator.geolocation) { document.getElementById('dWeatherDesc').textContent = 'Location unavailable'; return; }
  navigator.geolocation.getCurrentPosition(
    function(pos) { fetchWeatherAt(pos.coords.latitude.toFixed(4), pos.coords.longitude.toFixed(4)); },
    function() { document.getElementById('dWeatherDesc').textContent = 'Locating…'; fetch('https://ipapi.co/json/').then(function(r){ return r.json(); }).then(function(d){ if (d && d.latitude && d.longitude) { fetchWeatherAt(d.latitude.toFixed(4), d.longitude.toFixed(4), d.city, d.region); } else { document.getElementById('dWeatherDesc').textContent = 'Location unavailable'; } }).catch(function(){ document.getElementById('dWeatherDesc').textContent = 'Unavailable'; }); }, { timeout: 8000 }
  );
}

function weatherDesc(code) {
  if (code === 0) return 'Clear sky'; if (code <= 2) return 'Partly cloudy'; if (code === 3) return 'Overcast'; if (code <= 9) return 'Fog'; if (code <= 19) return 'Drizzle'; if (code <= 29) return 'Rain'; if (code <= 39) return 'Snow'; if (code <= 49) return 'Fog'; if (code <= 59) return 'Drizzle'; if (code <= 69) return 'Rain'; if (code <= 79) return 'Snow'; if (code <= 84) return 'Rain showers'; if (code <= 94) return 'Snow showers'; return 'Thunderstorm';
}

function renderIntention() {
  var now = new Date(); var week = getISOWeek(now); var ws = getWeekStart(now);
  var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  document.getElementById('dWeekMeta').textContent = 'Week of ' + months[ws.getMonth()] + ' ' + ws.getDate() + '  ·  ' + week;
  if (dState.intentionWeek !== week) { dState.intention = ''; dState.intentionWeek = week; saveDash(true); }
  document.getElementById('dIntention').value = dState.intention || '';
}
document.getElementById('dIntention').addEventListener('input', function() { dState.intention = this.value; saveDash(true); });

function renderDashTasks() {
  var todayTasks = state.tasks.filter(function(t) { return !t.done && isActuallyDueToday(t); }).slice(0, 5);
  var list = document.getElementById('dTaskList'); list.innerHTML = '';
  if (todayTasks.length === 0) { list.innerHTML = '<div style="font-size:12px;color:#333;padding:4px 0;">Nothing due today</div>'; } 
  else { todayTasks.forEach(function(t) { var row = document.createElement('div'); row.className = 'd-task-row'; var dc = dueClass(t.due); var dueStr = t.due ? fmtDue(t.due) : ''; row.innerHTML = '<div class="d-task-dot '+(t.priority||'md')+'"></div><div class="d-task-name">' + esc(t.title) + '</div>' + (dueStr ? '<div class="d-task-due '+dc+'">'+esc(dueStr)+'</div>' : ''); list.appendChild(row); }); }
  var open = state.tasks.filter(function(t){ return !t.done; }).length; var openText = document.getElementById('dOpenTasks'); openText.textContent = open + ' open task' + (open !== 1 ? 's' : '') + '  switch to Tasks'; openText.onclick = function() { switchTab('tasks'); };
}

function renderCountdown() {
  var cd = dState.countdown;
  if (!cd || !cd.date) { document.getElementById('dCountdownNum').textContent = '—'; document.getElementById('dCountdownUnit').textContent = ''; document.getElementById('dCountdownEvent').textContent = 'No event set'; return; }
  var today = new Date(); today.setHours(0,0,0,0); var target = new Date(cd.date + 'T00:00:00'); var diff = Math.round((target - today) / 86400000);
  if (diff < 0) { document.getElementById('dCountdownNum').textContent = Math.abs(diff); document.getElementById('dCountdownUnit').textContent = 'days ago'; } 
  else if (diff === 0) { document.getElementById('dCountdownNum').textContent = 'Today'; document.getElementById('dCountdownUnit').textContent = ''; } 
  else { document.getElementById('dCountdownNum').textContent = diff; document.getElementById('dCountdownUnit').textContent = diff === 1 ? 'day away' : 'days away'; }
  document.getElementById('dCountdownEvent').textContent = cd.name || cd.date;
}
document.getElementById('dCountdownSetBtn').addEventListener('click', function() { var edit = document.getElementById('dCountdownEdit'); edit.classList.toggle('open'); if (edit.classList.contains('open')) { document.getElementById('dCountdownName').value = dState.countdown.name || ''; document.getElementById('dCountdownDate').value = dState.countdown.date || ''; } });
document.getElementById('dCountdownSave').addEventListener('click', function() { var name = document.getElementById('dCountdownName').value.trim(); var date = document.getElementById('dCountdownDate').value; if (!date) return; dState.countdown = { name: name, date: date }; saveDash(true); renderCountdown(); document.getElementById('dCountdownEdit').classList.remove('open'); });

function renderQuote() { var q = QUOTES[dState.quoteIdx % QUOTES.length]; document.getElementById('dQuoteText').textContent = '“' + q.text + '”'; document.getElementById('dQuoteAttr').textContent = '— ' + q.attr; document.getElementById('dQuoteIdx').textContent = (dState.quoteIdx % QUOTES.length + 1) + ' / ' + QUOTES.length; }
document.getElementById('dQuotePrev').addEventListener('click', function() { dState.quoteIdx = (dState.quoteIdx - 1 + QUOTES.length) % QUOTES.length; saveDash(true); renderQuote(); });
document.getElementById('dQuoteNext').addEventListener('click', function() { dState.quoteIdx = (dState.quoteIdx + 1) % QUOTES.length; saveDash(true); renderQuote(); });

function renderReflection() {
  var today = getTodayStr(); if (dState.reflectionDate !== today) { dState.reflection = ''; dState.reflectionDate = today; saveDash(true); }
  var doy = Math.floor((new Date() - new Date(new Date().getFullYear(), 0, 0)) / 86400000); var prompt = PROMPTS[doy % PROMPTS.length];
  document.getElementById('dPrompt').textContent = prompt; document.getElementById('dReflect').value = dState.reflection || '';
}
var reflectTimer = null;
document.getElementById('dReflect').addEventListener('input', function() { dState.reflection = this.value; if (reflectTimer) clearTimeout(reflectTimer); reflectTimer = setTimeout(saveDash, 800); });

// MOOD TRACKER
function renderMood() {
  if (!dState.moods) dState.moods = {}; var today = getTodayStr(); var todayMood = dState.moods[today];
  document.querySelectorAll('.mood-btn').forEach(function(btn) { var val = parseInt(btn.dataset.val); btn.classList.toggle('active', val === todayMood); });
  var heatmap = document.getElementById('dMoodHeatmap'); heatmap.innerHTML = '';
  var colors = {1:'#ff3b30', 2:'#ff9500', 3:'#ffcc00', 4:'#a2d952', 5:'#30d158'};
  var sum = 0, count = 0;
  for(var i=13; i>=0; i--) { var d = new Date(); d.setDate(d.getDate() - i); var dStr = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); var val = dState.moods[dStr]; var cell = document.createElement('div'); cell.className = 'mood-cell'; if(val) { cell.style.background = colors[val]; sum += val; count++; } heatmap.appendChild(cell); }
  var avgEl = document.getElementById('dMoodAvg'); if(count > 0) { avgEl.textContent = '14-day avg: ' + (sum/count).toFixed(1); } else { avgEl.textContent = ''; }
}
document.getElementById('dMoodSelect').addEventListener('click', function(e) { var btn = e.target.closest('.mood-btn'); if(!btn) return; var val = parseInt(btn.dataset.val); var today = getTodayStr(); if(!dState.moods) dState.moods = {}; if(dState.moods[today] === val) { delete dState.moods[today]; } else { dState.moods[today] = val; } saveDash(true); renderMood(); });

function renderHabits() {
  var now = new Date(); var week = getISOWeek(now); var todayDow = getDayOfWeek(); var dayLabels = ['M','T','W','T','F','S','S'];
  if (!dState.habits[week]) { dState.habits[week] = {}; } var habitsDirty = false;
  HABITS.forEach(function(h) { if (!dState.habits[week][h.id]) { dState.habits[week][h.id] = [false,false,false,false,false,false,false]; habitsDirty = true; } });
  var weeks = Object.keys(dState.habits).sort(); while (weeks.length > 2) { delete dState.habits[weeks.shift()]; habitsDirty = true; }
  if (habitsDirty) saveDash(false);
  var labelRow = document.getElementById('dHabitDayLabels'); labelRow.innerHTML = '';
  dayLabels.forEach(function(l, i) { var el = document.createElement('div'); el.className = 'd-day-label' + (i === todayDow ? ' today-col' : ''); el.textContent = l; labelRow.appendChild(el); });
  var rowsEl = document.getElementById('dHabitRows'); rowsEl.innerHTML = '';
  HABITS.forEach(function(h) {
    var checks = dState.habits[week][h.id] || [false,false,false,false,false,false,false]; var row = document.createElement('div'); row.className = 'd-habit-row'; var label = document.createElement('div'); label.className = 'd-habit-label'; label.textContent = h.label; row.appendChild(label); var checksEl = document.createElement('div'); checksEl.className = 'd-habit-checks';
    checks.forEach(function(checked, i) {
      var cb = document.createElement('div'); var isBad = h.bad; cb.className = 'd-habit-cb' + (checked ? (isBad ? ' checked-bad' : ' checked') : '') + (i === todayDow ? ' today-col' : '') + (i > todayDow ? ' future' : ''); cb.dataset.habit = h.id; cb.dataset.day = i;
      cb.addEventListener('click', function() { if (!dState.habits[week][h.id]) dState.habits[week][h.id] = [false,false,false,false,false,false,false]; dState.habits[week][h.id][i] = !dState.habits[week][h.id][i]; var isNowChecked = dState.habits[week][h.id][i]; saveDash(true); if (h.bad) { cb.classList.toggle('checked-bad', isNowChecked); cb.classList.remove('checked'); } else { cb.classList.toggle('checked', isNowChecked); cb.classList.remove('checked-bad'); } });
      checksEl.appendChild(cb);
    });
    row.appendChild(checksEl); rowsEl.appendChild(row);
  });
}

function renderBook() {
  var b = dState.book; var content = document.getElementById('dBookContent'); var btn = document.getElementById('dBookSetBtn');
  if (!b || !b.title) { content.innerHTML = '<div class="d-book-empty">No book set — tap to add one</div>'; btn.textContent = '+ set book'; return; }
  btn.textContent = 'Update progress';
  var pct = (b.total && b.current) ? Math.round((b.current / b.total) * 100) : 0; var pctClamped = Math.min(100, Math.max(0, pct)); var pagesLeft = (b.total && b.current) ? (b.total - b.current) : null;
  content.innerHTML = '<div class="d-book-title">' + esc(b.title) + '</div>' + (b.author ? '<div class="d-book-author">' + esc(b.author) + '</div>' : '') + (b.total ? '<div class="d-book-prog-wrap"><div class="d-book-prog-fill" style="width:'+pctClamped+'%"></div></div><div class="d-book-pct">' + pct + '% · ' + (pagesLeft !== null ? pagesLeft + ' pages left' : '') + '</div>' : '');
}
document.getElementById('dBookSetBtn').addEventListener('click', function() { var edit = document.getElementById('dBookEdit'); edit.classList.toggle('open'); if (edit.classList.contains('open') && dState.book) { document.getElementById('dBookTitle').value = dState.book.title || ''; document.getElementById('dBookAuthor').value = dState.book.author || ''; document.getElementById('dBookCurrent').value = dState.book.current || ''; document.getElementById('dBookTotal').value = dState.book.total || ''; setTimeout(function() { document.getElementById('dBookCurrent').focus(); }, 50); } });
document.getElementById('dBookSave').addEventListener('click', function() { var title = document.getElementById('dBookTitle').value.trim(); var author = document.getElementById('dBookAuthor').value.trim(); var current = parseInt(document.getElementById('dBookCurrent').value) || 0; var total = parseInt(document.getElementById('dBookTotal').value) || 0; if (!title) return; if (!dState.book) dState.book = {}; dState.book = { title: title, author: author, current: current, total: total }; saveDash(true); renderBook(); document.getElementById('dBookEdit').classList.remove('open'); });

function renderDashFull() { updateClock(); renderIntention(); renderDashTasks(); renderCountdown(); renderQuote(); renderReflection(); renderMood(); renderHabits(); renderBook(); }

// THEME SYSTEM
var THEME_KEY = 'kw_theme_v2'; var THEMES = ['neon','newsprint','ios26'];
function applyTheme(name) {
  THEMES.forEach(function(t){ document.body.classList.remove('theme-' + t); });
  if (name) document.body.classList.add('theme-' + name);
  var htmlBg = { neon:'#0d0810', newsprint:'#f8f6f0', ios26:'#e8eaf0' };
  document.documentElement.style.background = htmlBg[name] || '#e8eaf0';
  document.querySelectorAll('.theme-swatch').forEach(function(sw){ sw.classList.toggle('active', sw.dataset.theme === (name || 'ios26')); });
  try { localStorage.setItem(THEME_KEY, name || 'ios26'); } catch(e){}
}
function loadTheme() { var saved = 'ios26'; try { saved = localStorage.getItem(THEME_KEY) || 'ios26'; } catch(e){} applyTheme(saved); }
document.getElementById('settingsSheet').addEventListener('click', function(e){ var sw = e.target.closest('.theme-swatch'); if (!sw) return; applyTheme(sw.dataset.theme); render(); });

// SHOPPING LIST
var SHOP_KEY = 'kw_shop_v1'; var shopItems = [];
function loadShop() { try { shopItems = JSON.parse(localStorage.getItem(SHOP_KEY) || '[]'); } catch(e) { shopItems = []; } }
function saveShop() { try { localStorage.setItem(SHOP_KEY, JSON.stringify(shopItems)); } catch(e) {} ghPush(); }
function renderShop() {
  var list = document.getElementById('shopList'); if (!list) return;
  var active = shopItems.filter(function(i){ return !i.done; }); var done = shopItems.filter(function(i){ return i.done; }); var ordered = active.concat(done);
  if (ordered.length === 0) { list.innerHTML = '<div class="shop-empty">List is empty. Add something above.</div>'; return; }
  list.innerHTML = '';
  ordered.forEach(function(item) {
    var row = document.createElement('div'); row.className = 'shop-item'; row.dataset.id = item.id;
    row.innerHTML = '<div class="shop-cb' + (item.done ? ' checked' : '') + '" data-action="check"></div><div class="shop-item-text' + (item.done ? ' checked' : '') + '" data-action="check">' + esc(item.text) + '</div><div class="shop-del" data-action="del">&#x2715;</div>';
    list.appendChild(row);
  });
}
function shopAddItem(text) { text = text.trim(); if (!text) return; shopItems.push({ id: Date.now() + Math.random(), text: text, done: false }); saveShop(); renderShop(); }
function shopToggle(id) { shopItems = shopItems.map(function(i){ return i.id == id ? Object.assign({}, i, {done: !i.done}) : i; }); saveShop(); renderShop(); }
function shopDelete(id) { shopItems = shopItems.filter(function(i){ return i.id != id; }); saveShop(); renderShop(); }
function shopClearDone() { shopItems = shopItems.filter(function(i){ return !i.done; }); saveShop(); renderShop(); }

document.getElementById('shopBtn').addEventListener('click', function() { renderShop(); openSheet('shopSheet'); });
document.getElementById('shopAddBtn').addEventListener('click', function() { var inp = document.getElementById('shopInput'); shopAddItem(inp.value); inp.value = ''; inp.focus(); });
document.getElementById('shopInput').addEventListener('keydown', function(e) { if (e.key === 'Enter') { shopAddItem(this.value); this.value = ''; } });
document.getElementById('shopList').addEventListener('click', function(e) { var action = e.target.dataset.action; var row = e.target.closest('.shop-item'); if (!row || !action) return; var id = row.dataset.id; if (action === 'check') shopToggle(id); if (action === 'del') shopDelete(id); });
document.getElementById('shopClearDone').addEventListener('click', shopClearDone);
loadShop();

// DRAG TO REORDER
var dragState = null;
function addDragHandles(wrap, taskId) {
  var handle = wrap.querySelector('.task'); if(!handle) return;
  function onPointerDown(e) {
    if(e.button && e.button !== 0) return;
    var longPressTimer = setTimeout(function() { startDrag(e, wrap, taskId); }, 350);
    function cancelLong(ev) { var dx = Math.abs(ev.clientX - e.clientX); var dy = Math.abs(ev.clientY - e.clientY); if(dx > 8 || dy > 8) { clearTimeout(longPressTimer); } }
    function cleanup() { clearTimeout(longPressTimer); handle.removeEventListener('pointermove', cancelLong); handle.removeEventListener('pointerup', cleanup); handle.removeEventListener('pointercancel', cleanup); }
    handle.addEventListener('pointermove', cancelLong); handle.addEventListener('pointerup', cleanup); handle.addEventListener('pointercancel', cleanup);
  }
  handle.addEventListener('pointerdown', onPointerDown, {passive: true});
}

function startDrag(e, wrap, taskId) {
  if(dragState) return; if(navigator.vibrate) navigator.vibrate(30);
  var list = wrap.parentNode; var rect = wrap.getBoundingClientRect(); var offsetY = e.clientY - rect.top;
  var ghost = wrap.cloneNode(true); ghost.style.cssText = 'position:fixed;left:'+rect.left+'px;top:'+rect.top+'px;width:'+rect.width+'px;opacity:0.85;pointer-events:none;z-index:9999;transition:none;box-shadow:0 8px 30px rgba(0,0,0,0.4);border-radius:14px;';
  document.body.appendChild(ghost); wrap.style.opacity = '0.3';
  dragState = { taskId: taskId, wrap: wrap, ghost: ghost, list: list, offsetY: offsetY };
  document.addEventListener('pointermove', onDragMove, {passive: false}); document.addEventListener('pointerup', onDragEnd); document.addEventListener('pointercancel', onDragEnd);
}

function onDragMove(e) {
  if(!dragState) return; e.preventDefault();
  var ghost = dragState.ghost; ghost.style.top = (e.clientY - dragState.offsetY) + 'px';
  var overEl = null; var siblings = dragState.list.querySelectorAll('.task-wrap');
  siblings.forEach(function(sib) { if(sib === dragState.wrap) return; var r = sib.getBoundingClientRect(); if(e.clientY >= r.top && e.clientY <= r.bottom) overEl = sib; sib.classList.remove('drag-over'); });
  if(overEl) overEl.classList.add('drag-over');
}

function onDragEnd(e) {
  if(!dragState) return;
  document.removeEventListener('pointermove', onDragMove); document.removeEventListener('pointerup', onDragEnd); document.removeEventListener('pointercancel', onDragEnd);
  var overEl = dragState.list.querySelector('.task-wrap.drag-over');
  dragState.list.querySelectorAll('.task-wrap').forEach(function(s){ s.classList.remove('drag-over'); });
  dragState.ghost.remove(); dragState.wrap.style.opacity = '';
  if(overEl && overEl !== dragState.wrap) {
    var srcId = dragState.taskId; var dstId = overEl.dataset.id; var tasks = state.tasks;
    var srcIdx = tasks.findIndex ? tasks.findIndex(function(t){return t.id===srcId;}) : -1;
    var dstIdx = tasks.findIndex ? tasks.findIndex(function(t){return t.id===dstId;}) : -1;
    if(srcIdx === -1){ for(var i=0;i<tasks.length;i++){if(tasks[i].id===srcId){srcIdx=i;break;}} }
    if(dstIdx === -1){ for(var j=0;j<tasks.length;j++){if(tasks[j].id===dstId){dstIdx=j;break;}} }
    if(srcIdx !== -1 && dstIdx !== -1) {
      var moved = tasks.splice(srcIdx, 1)[0]; var newDst = 0;
      for(var k=0;k<tasks.length;k++){if(tasks[k].id===dstId){newDst=k;break;}}
      tasks.splice(newDst, 0, moved); saveLocal(); 
      if(document.body.classList.contains('projects-detail-mode')) renderProjectTasks(); else render(); ghPush();
    }
  }
  dragState = null;
}

// INIT
loadTheme(); loadLocal(); render(); loadSettingsUI();
setTimeout(function(){ if(state.settings.ghToken) ghFetch(); }, 400);
