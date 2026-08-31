"use strict";

/* ============ дані ============ */
const DEPTS = ["P01","P02","P03","P21"];
const BASE_RATES = {
  P01:{norm:[195,224.25,253.50], b:[0.1897,0.2026,0.2128], n:[0.1436,0.1513,0.1615]},
  P02:{norm:[250,287.50,325.00], b:[0.1480,0.1580,0.1660], n:[0.1120,0.1180,0.1260]},
  P03:{norm:[315,362.25,409.50], b:[0.1175,0.1254,0.1317], n:[0.0889,0.0937,0.1000]},
  P21:{norm:[180,207.00,234.00], b:[0.2056,0.2194,0.2306], n:[0.1556,0.1639,0.1750]}
};
const TIERS = [100,115,130];
const BLEND_QTY = 3000;
const KEY = "akkord.v2";

const DEF = () => ({
  v:2,
  settings:{rate:"n", lastDept:"P01", theme:"dark"},
  rates:JSON.parse(JSON.stringify(BASE_RATES)),
  shifts:[], blends:[], penalties:[]
});

let S = load();
let ui = {tab:"shift", openDay:null, openDepts:[], month:null, sheet:null, pad:"", ctx:null};

function load(){
  try{
    const raw = localStorage.getItem(KEY) || localStorage.getItem("akkord.v1");
    if(!raw) return DEF();
    const d = JSON.parse(raw), base = DEF();
    base.settings = Object.assign(base.settings, d.settings||{});
    if(!["n","b"].includes(base.settings.rate)) base.settings.rate = "n";
    if(!["dark","light"].includes(base.settings.theme)) base.settings.theme = "dark";
    if(!DEPTS.includes(base.settings.lastDept)) base.settings.lastDept = DEPTS[0];
    for(const dep of DEPTS) if(d.rates && d.rates[dep]) base.rates[dep] = d.rates[dep];
    base.shifts = Array.isArray(d.shifts) ? d.shifts : [];
    base.blends = Array.isArray(d.blends) ? d.blends : [];
    base.penalties = Array.isArray(d.penalties) ? d.penalties : [];
    return base;
  }catch(e){ return DEF(); }
}
function save(){ try{ localStorage.setItem(KEY, JSON.stringify(S)); }catch(e){} }

/* ============ утиліти ============ */
function uid(){ return Math.random().toString(36).slice(2,9)+Date.now().toString(36).slice(-4); }
function now(){ return Date.now(); }
function pad2(n){ return String(n).padStart(2,"0"); }
function dkey(ts){ const d=new Date(ts); return d.getFullYear()+"-"+pad2(d.getMonth()+1)+"-"+pad2(d.getDate()); }
function ymOf(d){ return d.getFullYear()+"-"+pad2(d.getMonth()+1); }
function hhmm(ts){ const d=new Date(ts); return pad2(d.getHours())+":"+pad2(d.getMinutes()); }
function dur(ms){ if(!(ms>0)) ms=0; const m=Math.round(ms/60000); return Math.floor(m/60)+":"+pad2(m%60); }
const MONTHS=["Січень","Лютий","Березень","Квітень","Травень","Червень","Липень","Серпень","Вересень","Жовтень","Листопад","Грудень"];
const WD=["Нд","Пн","Вт","Ср","Чт","Пт","Сб"];
const group = s => String(s).replace(/\B(?=(\d{3})+(?!\d))/g," ");
const nf = n => group(Math.round(n));
function money(v){
  const s = Math.abs(v).toFixed(2).split(".");
  return (v<0?"−":"")+group(s[0])+","+s[1]+" zł";
}
const dec = (n,d) => Number(n).toFixed(d).replace(".",",");
const normFmt = v => Number.isInteger(v) ? String(v) : dec(v,2);
const esc = s => String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const dLabel = ds => ds.slice(8,10)+"."+ds.slice(5,7);

function toast(msg){
  const old = document.querySelector(".toast"); if(old) old.remove();
  const el = document.createElement("div"); el.className="toast"; el.textContent=msg;
  document.body.appendChild(el);
  setTimeout(()=>el.remove(), 1800);
}

/* ============ розрахунки ============ */
function rateOf(dept){ const r = S.rates[dept] || BASE_RATES.P01; return r[S.settings.rate]; }
function normOf(dept){ const r = S.rates[dept] || BASE_RATES.P01; return r.norm[0]; }
function tierIndex(pct){ return pct>=130 ? 2 : pct>=115 ? 1 : 0; }
function tone(p){ return p<100?"var(--dim)" : p<115?"var(--t100)" : p<130?"var(--t115)" : "var(--t130)"; }
function pctNum(pct){ return pct>=1000 ? "999+" : Math.round(pct); }

const activeShift = () => S.shifts.find(s => !s.end) || null;

function blockedIn(sh, from, to, t){
  let ms = 0;
  for(const b of sh.blocks){
    const be = b.end==null ? t : b.end;
    ms += Math.max(0, Math.min(be,to) - Math.max(b.start,from));
  }
  return ms;
}

/* Зміна — тільки факти: картони, час, норма. Жодних грошей: ставка відома за місяць. */
function calc(sh, t){
  t = t || now();
  const end = sh.end || t;
  const map = new Map();
  for(const leg of sh.legs){
    const le = leg.end || end;
    const bl = blockedIn(sh, leg.start, le, t);
    const net = Math.max(0, Math.max(0, le-leg.start) - bl);
    let r = map.get(leg.dept);
    if(!r){ r = {dept:leg.dept, qty:0, workMs:0, blockMs:0}; map.set(leg.dept, r); }
    r.qty += leg.cartons.reduce((a,c)=>a+c.qty,0);
    r.workMs += net;
    r.blockMs += bl;
  }
  const rows = [...map.values()];
  let qty=0, norm=0, workMs=0, blockMs=0;
  for(const r of rows){
    r.norm = (r.workMs/3600000) * normOf(r.dept);
    r.pct = r.norm>0 ? r.qty/r.norm*100 : 0;
    qty+=r.qty; norm+=r.norm; workMs+=r.workMs; blockMs+=r.blockMs;
  }
  return {qty, norm, pct: norm>0 ? qty/norm*100 : 0, rows, workMs, blockMs,
          totalMs: Math.max(0, end-sh.start), end};
}

/* Місяць — єдине місце, де рахуються гроші.
   У кожного відділу свій відсоток, свій поріг і своя ставка. */
function monthCalc(ym){
  const list = S.shifts.filter(s=>s.end && s.date.slice(0,7)===ym).sort((a,b)=>a.start-b.start);
  const map = new Map();
  let qty=0, workMs=0, blockMs=0;
  for(const s of list){
    const c = calc(s);
    qty+=c.qty; workMs+=c.workMs; blockMs+=c.blockMs;
    for(const r of c.rows){
      let b = map.get(r.dept);
      if(!b){ b = {dept:r.dept, qty:0, norm:0, workMs:0}; map.set(r.dept, b); }
      b.qty+=r.qty; b.norm+=r.norm; b.workMs+=r.workMs;
    }
  }
  const rows = [...map.values()].sort((a,b)=>a.dept.localeCompare(b.dept));
  let pay = 0;
  for(const r of rows){
    /* Поріг за відсотком відділу, далі просто картони × ставка цього порогу.
       Усе до 115% рахується за ставкою 100%. */
    r.pct = r.norm>0 ? r.qty/r.norm*100 : 0;
    r.ti = tierIndex(r.pct);
    r.rate = rateOf(r.dept)[r.ti];
    r.pay = r.qty * r.rate;
    r.tempo = r.workMs>0 ? r.qty/(r.workMs/3600000) : 0;
    r.formula = "ставка "+TIERS[r.ti]+"% · "+nf(r.qty)+" × "+dec(r.rate,4);
    pay += r.pay;
  }
  const pen = S.penalties.filter(p=>p.date.slice(0,7)===ym).sort((a,b)=>a.date.localeCompare(b.date));
  const penSum = pen.reduce((a,p)=>a+p.amount,0);
  return {list, rows, qty, pay, pen, penSum, total: pay-penSum, workMs, blockMs};
}

/* ============ бленди ============ */
function cartonsSince(dateStr){
  let n = 0;
  for(const s of S.shifts) if(s.date >= dateStr) n += calc(s).qty;
  return n;
}
function blendRows(){
  let used = 0;
  return [...S.blends].sort((a,b)=>a.date.localeCompare(b.date)).map(bl => {
    const done = Math.min(BLEND_QTY, Math.max(0, cartonsSince(bl.date) - used));
    used += done;
    return {bl, done, closed: done>=BLEND_QTY};
  });
}

/* ============ дії ============ */
function startShift(dept){
  const t = now();
  S.settings.lastDept = dept;
  S.shifts.unshift({id:uid(), date:dkey(t), start:t, end:null,
    legs:[{id:uid(), dept, start:t, end:null, cartons:[]}], blocks:[]});
  save(); render();
}
function addOrder(q){
  const sh = activeShift(); if(!sh || !(q>0)) return;
  sh.legs[sh.legs.length-1].cartons.push({id:uid(), qty:q, ts:now()});
  save(); render();
}
function delOrder(id){
  const sh = activeShift(); if(!sh) return;
  for(const leg of sh.legs){
    const i = leg.cartons.findIndex(c=>c.id===id);
    if(i>=0){ leg.cartons.splice(i,1); save(); render(); return; }
  }
}
function toggleBlock(){
  const sh = activeShift(); if(!sh) return;
  const open = sh.blocks.find(b=>b.end==null);
  if(open) open.end = now();
  else sh.blocks.push({id:uid(), start:now(), end:null});
  save(); render();
}
const isBlocked = () => { const sh = activeShift(); return !!(sh && sh.blocks.find(b=>b.end==null)); };

function switchDept(dept){
  const sh = activeShift(); if(!sh) return;
  const leg = sh.legs[sh.legs.length-1];
  if(leg.dept===dept){ closeSheet(); return; }
  if(leg.cartons.length===0 && sh.legs.length===1) leg.dept = dept;
  else { const t = now(); leg.end = t; sh.legs.push({id:uid(), dept, start:t, end:null, cartons:[]}); }
  S.settings.lastDept = dept;
  save(); closeSheet(); render();
}
function finishShift(startStr, endStr){
  const sh = activeShift(); if(!sh) return;
  if(startStr){ const ns = timeStart(sh.start, startStr); if(ns){ sh.start = ns; sh.date = dkey(ns); } }
  let e = now();
  if(endStr){ const ne = timeEnd(sh.start, endStr); if(ne) e = ne; }
  if(e < sh.start) e = sh.start;
  sh.end = e;
  for(const leg of sh.legs){ if(!leg.end) leg.end = e; if(leg.start<sh.start) leg.start = sh.start; }
  for(const b of sh.blocks) if(b.end==null) b.end = e;
  save(); closeSheet(); render();
}
function onDate(refTs, str){
  const m = /^(\d{1,2}):(\d{2})$/.exec(str||""); if(!m) return null;
  const d = new Date(refTs); d.setHours(+m[1], +m[2], 0, 0); return d.getTime();
}
function timeStart(refTs, str){
  let ts = onDate(refTs, str); if(ts==null) return null;
  if(ts > now()+60000) ts -= 86400000;
  return ts;
}
function timeEnd(startTs, str){
  let ts = onDate(startTs, str); if(ts==null) return null;
  if(ts < startTs) ts += 86400000;
  return ts;
}

/* ============ тема ============ */
function applyTheme(){
  try{ document.documentElement.dataset.theme = S.settings.theme; }catch(e){}
}

/* ============ рендер ============ */
function render(){
  document.getElementById("app").innerHTML =
    `<div class="page" id="page">` + pageHtml() + `</div>`;
  document.getElementById("dockHost").innerHTML = dockHtml();
  const page = document.getElementById("page"), dock = document.querySelector(".dock");
  requestAnimationFrame(()=>{ page.style.paddingBottom = (dock.offsetHeight + 26) + "px"; });
}

function pageHtml(){
  return ui.tab==="shift" ? viewShift()
       : ui.tab==="hist"  ? viewHist()
       : ui.tab==="month" ? viewMonth()
       : viewSettings();
}

/* ---------- Зміна ---------- */
function viewShift(){
  const sh = activeShift();
  if(!sh) return idleShift();
  const c = calc(sh);
  const dept = sh.legs[sh.legs.length-1].dept;
  const blocked = isBlocked();

  const orders = [];
  for(let i=sh.legs.length-1;i>=0;i--){
    const L = sh.legs[i];
    for(let j=L.cartons.length-1;j>=0;j--) orders.push({c:L.cartons[j], dept:L.dept});
  }

  return `
  <div class="shiftcard">
    ${blocked?`<div class="stripes"></div>`:""}
    <div class="deptline">
      <div class="cur">${dept}</div>
      ${blocked?`<div class="pill">заблоковано</div>`:""}
    </div>
    <div class="bigrow">
      <div class="bigcol">
        <div class="bignum" id="liveQty">${nf(c.qty)}</div>
        <div class="bigcap">картонів за зміну</div>
      </div>
      ${c.rows.length>1 ? `<div class="brk">
        ${c.rows.map(r=>`<div><span>${r.dept}</span><b>${nf(r.qty)}</b></div>`).join("")}
      </div>` : ""}
    </div>
    <div class="tiles">
      <button class="tile" data-act="sheet" data-v="start">
        <div class="lab">Робота</div>
        <div class="val num" id="liveWork">${dur(c.workMs)}</div>
      </button>
      <div class="tile">
        <div class="lab">Блок</div>
        <div class="val num ${c.blockMs>0?"":"off"}" id="liveBlock">${dur(c.blockMs)}</div>
      </div>
    </div>
  </div>

  <div class="orders">
    ${orders.length ? orders.map(o=>`<div class="order">
      <span class="t">${hhmm(o.c.ts)}</span>
      <span class="d">${o.dept}</span>
      <span class="q">${nf(o.c.qty)}</span>
      <button class="x" data-act="delorder" data-v="${o.c.id}" aria-label="Видалити">✕</button>
    </div>`).join("") : `<div class="blank">Замовлень ще немає</div>`}
  </div>`;
}

function idleShift(){
  return `
  <div class="h1">Нова зміна</div>
  <div class="grid2">
    ${DEPTS.map(d=>`<button class="chip ${S.settings.lastDept===d?"on":""}" data-act="pickdept" data-v="${d}">
      <div class="id">${d}</div><div class="sub">${normOf(d)}/год</div>
    </button>`).join("")}
  </div>`;
}

/* ---------- нижня панель ---------- */
/* Свої іконки, бо ⏸ і ▶ на Android малюються кольоровими емодзі. */
const I_PAUSE = '<svg class="gi" viewBox="0 0 12 12" aria-hidden="true"><rect x="2" y="1.5" width="3" height="9" rx=".8"/><rect x="7" y="1.5" width="3" height="9" rx=".8"/></svg>';
const I_PLAY  = '<svg class="gi" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 1.6 10.4 6 3 10.4z"/></svg>';

function dockHtml(){
  const sh = activeShift();
  let actions = "";
  if(ui.tab==="shift"){
    if(!sh){
      actions = `<div class="actions">
        <button class="mainbtn start" data-act="startshift">Почати · ${hhmm(now())}</button>
      </div>`;
    } else {
      const blocked = isBlocked();
      actions = `<div class="actions">
        <button class="mainbtn ${blocked?"hold":""}" data-act="${blocked?"block":"sheet"}" data-v="order">
          ${blocked?"Продовжити роботу":"+ Замовлення"}</button>
        <div class="subrow">
          <button class="subbtn" data-act="sheet" data-v="dept">Відділ</button>
          <button class="subbtn" data-act="block">${blocked?I_PLAY+"Продовжити":I_PAUSE+"Блокування"}</button>
          <button class="subbtn" data-act="sheet" data-v="finish">Завершити</button>
        </div>
      </div>`;
    }
  }
  const tabs = [["shift","Зміна"],["hist","Історія"],["month","Статистика"],["rates","Налаштування"]];
  return `<div class="dock">${actions}
    <div class="tabs">
      ${tabs.map(([id,label])=>`<button class="tab" data-act="tab" data-v="${id}"
        aria-current="${ui.tab===id}"><span>${label}</span><i></i></button>`).join("")}
    </div>
  </div>`;
}

/* ---------- Історія ---------- */
function viewHist(){
  const done = S.shifts.filter(s=>s.end).sort((a,b)=>b.start-a.start);
  if(!done.length) return `<div class="h1">Історія</div><div class="blank">Завершених змін ще немає</div>`;
  const byMonth = {};
  for(const s of done){ const k=s.date.slice(0,7); (byMonth[k]=byMonth[k]||[]).push(s); }
  return `<div class="h1">Історія</div>` + Object.keys(byMonth).sort().reverse().map(k=>{
    const arr = byMonth[k];
    const q = arr.reduce((a,s)=>a+calc(s).qty,0);
    const [y,m] = k.split("-");
    return `<div class="mgroup">
      <div class="mgroup-head"><span>${MONTHS[+m-1]} ${y}</span><b>${nf(q)} карт.</b></div>
      ${arr.map(dayRow).join("")}
    </div>`;
  }).join("");
}

function dayRow(s){
  const c = calc(s);
  const d = new Date(s.date+"T12:00:00");
  return `<div class="srow">
    <button data-act="openday" data-v="${s.id}">
      <span class="s-left">
        <span class="s-dow">${WD[d.getDay()]}</span>
        <span class="s-date">${dLabel(s.date)}</span>
      </span>
      <span class="s-right">
        <span class="s-qty">${nf(c.qty)}</span>
        <span class="s-meta">картонів</span>
      </span>
    </button>
    ${ui.openDay===s.id?dayDetail(s,c):""}
  </div>`;
}

function dayDetail(s,c){
  return `<div class="detail">
    <div class="tblwrap"><table class="tbl">
      <thead><tr><th>Відділ</th><th>Карт</th><th>Час</th><th>%</th></tr></thead>
      <tbody>
        ${c.rows.filter(r=>r.qty>0||r.workMs>60000).map(r=>`<tr>
          <td>${r.dept}</td><td>${nf(r.qty)}</td><td>${dur(r.workMs)}</td>
          <td style="color:${tone(r.pct)}">${r.norm>0?pctNum(r.pct)+"%":"—"}</td></tr>`).join("")}
      </tbody>
    </table></div>
    <div class="dmeta"><span>${hhmm(s.start)}–${hhmm(s.end)}</span><span>блок ${dur(c.blockMs)}</span></div>
    <button class="delbtn" data-act="ask" data-v="shift:${s.id}">Видалити зміну</button>
  </div>`;
}

/* ---------- Статистика ---------- */
function viewMonth(){
  if(!ui.month) ui.month = ymOf(new Date());
  const [y,m] = ui.month.split("-").map(Number);
  const M = monthCalc(ui.month);
  const bl = blendRows();
  const marks = [[66.7,"100"],[76.7,"115"],[86.7,"130"]];

  return `
  <div class="monthnav">
    <button data-act="mon" data-v="${shiftMonth(ui.month,-1)}">‹</button>
    <div class="title">${MONTHS[m-1]} ${y}</div>
    <button data-act="mon" data-v="${shiftMonth(ui.month,1)}">›</button>
  </div>

  <div class="stats3">
    <div><div class="lab">Картони</div><div class="val num">${nf(M.qty)}</div></div>
    <div><div class="lab">Робота</div><div class="val num">${dur(M.workMs)}</div></div>
    <div><div class="lab">Блок</div><div class="val num off">${dur(M.blockMs)}</div></div>
  </div>

  <div class="dcards">
    ${M.rows.length ? M.rows.map(r=>`
    <div class="dcard">
      <button class="dc-head" data-act="opendept" data-v="${r.dept}">
        <span class="dc-left">
          <span class="dc-id">${r.dept}</span>
          <span class="dc-qty num">${nf(r.qty)} карт.</span>
        </span>
        <span class="dc-money num">${money(r.pay)}</span>
      </button>
      ${ui.openDepts.includes(r.dept) ? `<div class="dc-more">
        <div class="stats3">
          <div><div class="lab">Темп</div><div class="val num">${Math.round(r.tempo)}<i>/год</i></div></div>
          <div><div class="lab">Час</div><div class="val num">${dur(r.workMs)}</div></div>
          <div><div class="lab">Норма</div><div class="val num" style="color:${tone(r.pct)}">${r.norm>0?pctNum(r.pct)+"%":"—"}</div></div>
        </div>
        <div class="dc-bar"><span style="width:${Math.min(100, r.norm>0?r.pct/150*100:0).toFixed(1)}%;background:${tone(r.pct)}"></span></div>
        <div class="dc-marks">${marks.map(([at,l])=>`<span style="left:${at}%">${l}</span>`).join("")}</div>
        <div class="dc-formula">${r.formula}</div>
      </div>` : ""}
    </div>`).join("") : `<div class="blank">За цей місяць змін немає</div>`}
  </div>

  <div class="sect">
    <div class="sect-head"><span>Бленди</span><button data-act="sheet" data-v="blend">+ Бленд</button></div>
    ${bl.map(r=>`<div class="brow">
      <div class="line">
        <span class="date">${dLabel(r.bl.date)}${r.bl.note?" · "+esc(r.bl.note):""}</span>
        <span class="line" style="gap:10px">
          <span class="prog num">${nf(r.done)} / ${nf(BLEND_QTY)}</span>
          <button class="rowx" data-act="delblend" data-v="${r.bl.id}" aria-label="Видалити">✕</button>
        </span>
      </div>
      <div class="bar"><span class="${r.closed?"done":""}" style="width:${(r.done/BLEND_QTY*100).toFixed(1)}%"></span></div>
    </div>`).join("")}
  </div>

  <div class="sect">
    <div class="sect-head"><span>Карти бленду</span><button data-act="sheet" data-v="pen">+ Штраф</button></div>
    ${M.pen.map(p=>`<div class="prow">
      <span class="date">${dLabel(p.date)}${p.note?" · "+esc(p.note):""}</span>
      <span class="line" style="display:flex;align-items:baseline;gap:10px">
        <span class="amt num">${money(-p.amount)}</span>
        <button class="rowx" data-act="delpen" data-v="${p.id}" aria-label="Видалити">✕</button>
      </span>
    </div>`).join("")}
  </div>

  <div class="payout">
    <div class="lab">До виплати</div>
    <div class="val num">${money(M.total)}</div>
    <div class="sub">${S.settings.rate==="n"?"netto":"brutto"}${M.penSum?" · мінус "+money(M.penSum):""}</div>
  </div>`;
}
function shiftMonth(ym,delta){
  const [y,m] = ym.split("-").map(Number);
  return ymOf(new Date(y, m-1+delta, 1));
}

/* ---------- Налаштування ---------- */
function viewSettings(){
  const t = S.settings.rate;
  return `
  <div class="h1">Налаштування</div>

  <div class="sect-lab">Ставка</div>
  <div class="seg">
    <button class="segbtn ${t==="n"?"on":""}" data-act="ratetype" data-v="n">Netto</button>
    <button class="segbtn ${t==="b"?"on":""}" data-act="ratetype" data-v="b">Brutto</button>
  </div>

  <div class="sect-lab" style="margin-top:30px">Тема</div>
  <div class="seg">
    <button class="segbtn ${S.settings.theme==="dark"?"on":""}" data-act="theme" data-v="dark">Темна</button>
    <button class="segbtn ${S.settings.theme==="light"?"on":""}" data-act="theme" data-v="light">Світла</button>
  </div>

  <div class="sect-lab" style="margin-top:30px">Норми та ставки</div>
  <div class="rcards">
    ${DEPTS.map(d=>{
      const r = S.rates[d];
      return `<div class="rcard">
        <div class="id">${d}</div>
        <div class="rhead"><span>Поріг</span><span>Карт/год</span><span>zł/карт</span></div>
        ${TIERS.map((tier,i)=>`<div class="rrow">
          <span class="rt">${tier}%</span>
          ${i===0
            ? `<input inputmode="decimal" data-rate="${d}" data-f="norm" data-i="0" value="${normFmt(r.norm[0])}">`
            : `<span class="rfix num">${normFmt(r.norm[i])}</span>`}
          <input inputmode="decimal" data-rate="${d}" data-f="${t}" data-i="${i}" value="${dec(r[t][i],4)}">
        </div>`).join("")}
      </div>`;
    }).join("")}
  </div>

  <div class="sect-lab" style="margin-top:30px">Резервна копія</div>
  <div class="bkbtns">
    <button class="bkbtn" data-act="export">Зберегти файл</button>
    <button class="bkbtn" data-act="sheet" data-v="restore">Відновити з копії</button>
    <button class="bkbtn neg" data-act="ask" data-v="wipe:">Стерти всі дані</button>
  </div>`;
}

/* ============ шторки ============ */
const SHEET_TITLES = {order:"Замовлення", dept:"Відділ", start:"Початок зміни",
  finish:"Завершити зміну", blend:"Бленд", pen:"Карта бленду", restore:"Відновити з копії"};

function openSheet(kind){
  ui.sheet = kind; ui.pad = "";
  const title = kind==="confirm"
    ? (ui.ctx && ui.ctx.type==="wipe" ? "Стерти всі дані?" : "Видалити зміну?")
    : SHEET_TITLES[kind] || "";
  document.getElementById("sheetHost").innerHTML =
    `<div class="scrim" data-act="scrim"><div class="sheet">
      <div class="sheet-head">
        <div class="sheet-title">${title}</div>
        <button class="sheet-close" data-act="closesheet" aria-label="Закрити">✕</button>
      </div>
      ${sheetBody(kind)}
    </div></div>`;
}
function closeSheet(){ ui.sheet=null; ui.pad=""; document.getElementById("sheetHost").innerHTML=""; }

function sheetBody(kind){
  const sh = activeShift();
  if(kind==="order"){
    const keys = ["1","2","3","4","5","6","7","8","9","00","0","⌫"];
    return `<div class="draft" id="padout">0</div>
      <div class="keys">${keys.map(k=>`<button class="key" data-act="padkey" data-v="${k}">${k}</button>`).join("")}</div>
      <button class="accbtn" data-act="padok">Додати · ${sh?sh.legs[sh.legs.length-1].dept:""}</button>`;
  }
  if(kind==="dept"){
    const cur = sh ? sh.legs[sh.legs.length-1].dept : S.settings.lastDept;
    return `<div class="grid2">
      ${DEPTS.map(d=>`<button class="chip ${cur===d?"on":""}" data-act="setdept" data-v="${d}">
        <div class="id">${d}</div><div class="sub">${normOf(d)}/год</div></button>`).join("")}
    </div>`;
  }
  if(kind==="start"){
    return `<label class="field"><input type="time" class="big" id="fA" value="${hhmm(sh.start)}"></label>
      <button class="accbtn sm" data-act="savestart">Зберегти</button>`;
  }
  if(kind==="finish"){
    const c = calc(sh);
    return `<div class="finhead">
        <div class="n">${nf(c.qty)}</div>
        <div class="c">картонів<br>робота ${dur(c.workMs)} · блок ${dur(c.blockMs)}</div>
      </div>
      <div class="frow">
        <label class="field"><div class="lab">Початок</div><input type="time" class="mid" id="fA" value="${hhmm(sh.start)}"></label>
        <label class="field"><div class="lab">Кінець</div><input type="time" class="mid" id="fB" value="${hhmm(now())}"></label>
      </div>
      <button class="accbtn sm" data-act="dofinish">Завершити зміну</button>`;
  }
  if(kind==="blend"){
    return `<label class="field"><div class="lab">Дата</div><input type="date" id="fDate" value="${dkey(now())}"></label>
      <label class="field"><div class="lab">Примітка</div><input type="text" id="fNote"></label>
      <button class="accbtn sm" data-act="doblend">Додати бленд</button>`;
  }
  if(kind==="pen"){
    return `<label class="field"><div class="lab">Сума, zł</div><input class="money" inputmode="decimal" id="fAmount"></label>
      <label class="field"><div class="lab">Дата</div><input type="date" id="fDate" value="${dkey(now())}"></label>
      <label class="field"><div class="lab">Примітка</div><input type="text" id="fNote"></label>
      <button class="accbtn sm" data-act="dopen">Додати штраф</button>`;
  }
  if(kind==="restore"){
    return `<label class="field"><textarea id="fNote" rows="6"></textarea></label>
      <button class="accbtn sm" data-act="doimport">Відновити</button>`;
  }
  if(kind==="confirm"){
    return `<div class="confirm">
      <button class="cancel" data-act="closesheet">Скасувати</button>
      <button class="yes" data-act="doconfirm">Видалити</button>
    </div>`;
  }
  return "";
}

/* ============ події ============ */
document.addEventListener("click", ev => {
  const el = ev.target.closest("[data-act]");
  if(!el) return;
  const a = el.dataset.act, v = el.dataset.v;
  if(a==="scrim" && ev.target!==el) return;

  switch(a){
    case "theme": S.settings.theme=v; save(); applyTheme(); render(); break;
    case "tab": ui.tab=v; ui.openDay=null; ui.openDepts=[]; render(); window.scrollTo(0,0); break;
    case "pickdept": S.settings.lastDept=v; save(); render(); break;
    case "startshift": startShift(S.settings.lastDept); break;
    case "delorder": delOrder(v); break;
    case "block": toggleBlock(); break;
    case "setdept": switchDept(v); break;
    case "sheet": openSheet(v); break;
    case "closesheet": case "scrim": closeSheet(); break;

    case "savestart": {
      const sh=activeShift(), ns=timeStart(sh.start, document.getElementById("fA").value);
      if(ns && ns<=now() && now()-ns < 20*3600000){
        sh.start=ns; sh.date=dkey(ns);
        sh.legs[0].start=Math.min(sh.legs[0].start, ns);
        for(const b of sh.blocks) if(b.start<ns) b.start=ns;
        save(); closeSheet(); render();
      } else toast("Некоректний час");
      break;
    }
    case "dofinish": finishShift(document.getElementById("fA").value, document.getElementById("fB").value); break;

    case "padkey": {
      if(v==="⌫") ui.pad = ui.pad.slice(0,-1);
      else if(ui.pad.length<6) ui.pad = (ui.pad+v).replace(/^0+(?=\d)/,"");
      const out = document.getElementById("padout");
      out.textContent = ui.pad ? nf(parseInt(ui.pad,10)) : "0";
      out.classList.toggle("on", !!ui.pad);
      break;
    }
    case "padok": { const n=parseInt(ui.pad||"0",10); closeSheet(); addOrder(n); break; }

    case "openday": ui.openDay = ui.openDay===v ? null : v; render(); break;
    case "opendept": ui.openDepts = ui.openDepts.includes(v) ? ui.openDepts.filter(x=>x!==v) : ui.openDepts.concat(v); render(); break;
    case "ask": { const [type,id]=v.split(":"); ui.ctx={type,id}; openSheet("confirm"); break; }
    case "doconfirm": {
      const c = ui.ctx || {};
      if(c.type==="shift") S.shifts = S.shifts.filter(s=>s.id!==c.id);
      else if(c.type==="wipe") S = DEF();
      ui.ctx=null; ui.openDay=null; save(); applyTheme(); closeSheet(); render();
      break;
    }
    case "mon": ui.month=v; ui.openDepts=[]; render(); break;

    case "doblend": {
      const d=document.getElementById("fDate").value;
      if(!d){ toast("Вкажи дату"); break; }
      S.blends.push({id:uid(), date:d, note:document.getElementById("fNote").value.trim()});
      save(); closeSheet(); render(); break;
    }
    case "delblend": S.blends=S.blends.filter(b=>b.id!==v); save(); render(); break;
    case "dopen": {
      const amt=parseFloat(String(document.getElementById("fAmount").value).replace(",","."));
      const d=document.getElementById("fDate").value;
      if(!(amt>0) || !d){ toast("Вкажи суму й дату"); break; }
      S.penalties.push({id:uid(), date:d, amount:amt, note:document.getElementById("fNote").value.trim()});
      save(); closeSheet(); render(); break;
    }
    case "delpen": S.penalties=S.penalties.filter(p=>p.id!==v); save(); render(); break;

    case "ratetype": S.settings.rate=v; save(); render(); break;
    case "export": doExport(); break;
    case "doimport": {
      try{
        const d = JSON.parse(document.getElementById("fNote").value);
        if(!d || !Array.isArray(d.shifts)) throw new Error("bad");
        localStorage.setItem(KEY, JSON.stringify(d));
        S = load(); save(); applyTheme(); closeSheet(); render();
        toast("Відновлено: "+S.shifts.length+" змін");
      }catch(e){ toast("Це не схоже на копію"); }
      break;
    }
  }
});

document.addEventListener("change", ev => {
  const el = ev.target.closest("[data-rate]");
  if(!el) return;
  const val = parseFloat(String(el.value).replace(",","."));
  const r = S.rates[el.dataset.rate], f = el.dataset.f, i = +el.dataset.i;
  if(!isFinite(val) || val<=0){
    el.value = f==="norm" ? normFmt(r.norm[i]) : dec(r[f][i],4);
    toast("Потрібне число більше нуля"); return;
  }
  r[f][i] = val;
  if(f==="norm"){                    /* 115% і 130% похідні від базової норми */
    r.norm[1] = +(val*1.15).toFixed(2);
    r.norm[2] = +(val*1.30).toFixed(2);
    save(); render(); return;        /* перемалювати, щоб оновились похідні */
  }
  save();
});

async function doExport(){
  const data = JSON.stringify(S, null, 2);
  const filename = "akkord-"+dkey(now())+".json";
  /* Звичайне завантаження файла — працює в браузері й на телефоні. */
  try{
    const url = URL.createObjectURL(new Blob([data], {type:"application/json"}));
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url), 1000);
    toast(filename);
    return;
  }catch(e){}
  /* Усередині перегляду артефакта claude.ai завантаження блокується — там свій шлях. */
  try{
    const dl = window.claude && window.claude.use ? await window.claude.use("downloads") : null;
    if(dl){ await dl.save({filename, data}); toast("Збережено"); return; }
  }catch(e){}
  toast("Не вдалось зберегти");
}

/* ============ годинники ============
   Оновлюються тільки два числа — час роботи й час блокування. */
function tick(){
  const sh = activeShift();
  if(!sh || ui.tab!=="shift" || ui.sheet) return;
  const c = calc(sh);
  const w = document.getElementById("liveWork"); if(w) w.textContent = dur(c.workMs);
  const b = document.getElementById("liveBlock");
  if(b){ b.textContent = dur(c.blockMs); b.classList.toggle("off", !(c.blockMs>0)); }
}
setInterval(tick, 1000);
setInterval(()=>{ if(activeShift()) save(); }, 30000);
document.addEventListener("visibilitychange", ()=>{ if(!document.hidden && !ui.sheet) render(); });

/* ============ ширина екрана ============
   Якщо в браузері увімкнено «Версія для ПК», сторінка малюється у ~980px
   і на телефоні стискається до нечитабельного. Тоді компенсуємо масштабом. */
let zoomApplied = 1;
function fitViewport(){
  try{
    const de = document.documentElement;
    const sw = window.screen && window.screen.width;
    if(!sw) return;
    const real = de.clientWidth * zoomApplied;   /* ширина без нашого масштабу */
    const r = real / sw;
    const z = r > 1.5 ? Math.round(r*100)/100 : 1;
    if(z !== zoomApplied){
      zoomApplied = z;
      de.style.zoom = z===1 ? "" : z;
    }
  }catch(e){}
}
window.addEventListener("resize", fitViewport);
window.addEventListener("orientationchange", fitViewport);

fitViewport();
applyTheme();
render();
