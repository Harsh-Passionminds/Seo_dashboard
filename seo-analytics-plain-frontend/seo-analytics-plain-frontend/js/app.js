/* Plain HTML/CSS/JS client for the SEO Analytics Express API. */
const API_BASE = (window.API_BASE || "http://localhost:5000/api").replace(/\/$/, "");
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const state = { websites: [], gsc: [], ga4: [], previousGsc: [], previousGa4: [], acquisition: [], jobs: [], keywords: [], keywordHistory: [], currentView: "overview", gscLoaded: false, ga4Loaded: false, previousGscLoaded: false, previousGa4Loaded: false };
const viewCopy = {
 overview:["Overview","Monitor organic visibility, traffic and conversions across your websites."],
 "search-console":["Search Console","Review daily Google Search Console performance."],
 analytics:["Google Analytics","Review organic sessions and conversion events from GA4."],
 acquisition:["Acquisition reports","Explore session-scoped and first-user-scoped acquisition."],
 keywords:["Keyword tracking","Manually track selected keywords and Google Search Console performance."],
 websites:["Websites","Manage properties and keep each website's data separate."],
 sync:["Sync activity","Track historical imports and incremental updates."]
};
function esc(v){return String(v??"").replace(/[&<>\"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function fmt(v){if(v===null||v===undefined||v==="")return "—";const n=Number(v);return Number.isFinite(n)?n.toLocaleString():String(v);}
function pct(v){if(v===null||v===undefined||v==="")return "—";const n=Number(v);return Number.isFinite(n)?`${(n<=1?n*100:n).toFixed(2)}%`:"—";}
function range(){return {startDate:$("#start-date").value,endDate:$("#end-date").value};}
function siteId(){return $("#website-select").value;}
async function api(path,options={}){const r=await fetch(API_BASE+path,{...options,credentials:"include",headers:{...(options.body?{"Content-Type":"application/json"}:{}),...(options.headers||{})}});const ct=r.headers.get("content-type")||"";const d=ct.includes("json")?await r.json():await r.text();if(!r.ok){const message=typeof d==="object"?(d.error?.message||d.message||d.error||`HTTP ${r.status}`):d||`HTTP ${r.status}`;throw new Error(typeof message==="string"?message:String(message));}return d;}
function notice(msg,type=""){const el=$("#notice");el.textContent=msg;el.className=`notice ${type}`.trim();el.classList.remove("hidden");}
function hideNotice(){$("#notice").classList.add("hidden");}
function handleError(e){console.error(e);notice(e.message||"Unexpected error","error");}
function connection(ok,label){$(".connection-dot").classList.toggle("online",ok);$("#connection-label").textContent=label;$("#connection-sub").textContent=ok?"API reachable":"Check backend / database";}
function normSite(w){return {id:w.website_id??w.id,name:w.website_name??w.websiteName??w.name??"Website",domain:w.domain_name??w.domainName??w.domain_url??w.domainUrl??"",ga4:w.ga4_property_id??w.ga4PropertyId??"",gsc:w.gsc_property_url??w.gscPropertyUrl??""};}
function dateString(date){return date.toISOString().slice(0,10);}
function defaultDates(days=28){const end=new Date();end.setUTCHours(0,0,0,0);end.setUTCDate(end.getUTCDate()-1);const start=new Date(end);start.setUTCDate(start.getUTCDate()-days+1);$("#end-date").value=dateString(end);$("#start-date").value=dateString(start);}
function selectedRange(){return range();}
function previousRange(current){const start=new Date(`${current.startDate}T00:00:00.000Z`),end=new Date(`${current.endDate}T00:00:00.000Z`),days=Math.round((end-start)/86400000)+1;const previousEnd=new Date(start);previousEnd.setUTCDate(previousEnd.getUTCDate()-1);const previousStart=new Date(previousEnd);previousStart.setUTCDate(previousStart.getUTCDate()-days+1);return {startDate:dateString(previousStart),endDate:dateString(previousEnd),days};}
function setPresetRange(days){defaultDates(days);$("#date-preset").value=String(days);}
function dateKey(row){return String(row.date??row.report_date??"").slice(0,10);}
function previousDateFor(currentDate,days){const date=new Date(`${currentDate}T00:00:00.000Z`);date.setUTCDate(date.getUTCDate()-days);return dateString(date);}
function switchView(name){if(!viewCopy[name])return;state.currentView=name;$$(".nav-item").forEach(b=>b.classList.toggle("active",b.dataset.view===name));$$(".view").forEach(v=>v.classList.add("hidden"));$("#view-"+name).classList.remove("hidden");$("#breadcrumb-current").textContent=viewCopy[name][0];$("#page-title").textContent=viewCopy[name][0];$("#page-description").textContent=viewCopy[name][1];$("#sidebar").classList.remove("open");hideNotice();if(name==="websites")loadWebsites().catch(handleError);if(name==="sync")loadJobs().catch(handleError);if(name==="acquisition")loadAcquisition().catch(handleError);if(name==="keywords")loadKeywords().catch(handleError);}
function renderSiteSelect(){const s=$("#website-select"),old=s.value;s.innerHTML='<option value="">Choose website…</option>'+state.websites.map(w=>`<option value="${esc(w.id)}">${esc(w.name)} — ${esc(w.domain)}</option>`).join("");if(state.websites.some(w=>String(w.id)===old))s.value=old;}
async function loadWebsites(){const d=await api("/websites");state.websites=(Array.isArray(d)?d:d.websites||d.data||[]).map(normSite);renderSiteSelect();renderSiteCards();}
function renderSiteCards(){const el=$("#website-grid");if(!state.websites.length){el.innerHTML='<div class="panel empty-state"><span class="empty-icon">◎</span><strong>No websites yet</strong><p>Add a website and configure GA4 and Search Console properties.</p><p style="margin-top:14px"><button class="button button-primary" id="empty-add-website">＋ Add website</button></p></div>';$("#empty-add-website")?.addEventListener("click",openDialog);return;}
el.innerHTML=state.websites.map(w=>`<article class="website-card"><div class="website-card-top"><div class="site-avatar">${esc(w.name[0]?.toUpperCase()||"W")}</div><div style="min-width:0"><h3>${esc(w.name)}</h3><div class="domain">${esc(w.domain)}</div></div></div><div class="website-meta"><span>GA4 property <b>${esc(w.ga4||"Not configured")}</b></span><span>Search Console <b>${esc(w.gsc||"Not configured")}</b></span></div><div class="card-actions"><button class="button button-outline" data-select-site="${esc(w.id)}">View reports</button><button class="button button-primary" data-sync-site="${esc(w.id)}">Sync now</button></div></article>`).join("");
$$("[data-select-site]").forEach(b=>b.addEventListener("click",()=>{$("#website-select").value=b.dataset.selectSite;switchView("overview");refreshReports().catch(handleError);}));$$("[data-sync-site]").forEach(b=>b.addEventListener("click",()=>startSync(b.dataset.syncSite)));}
function first(o,keys,fb=0){for(const k of keys)if(o&&o[k]!==undefined&&o[k]!==null)return o[k];return fb;}
async function refreshReports(){hideNotice();const id=siteId();if(!id){state.gsc=[];state.ga4=[];state.previousGsc=[];state.previousGa4=[];state.gscLoaded=false;state.ga4Loaded=false;state.previousGscLoaded=false;state.previousGa4Loaded=false;["#metric-clicks","#metric-impressions","#metric-sessions","#metric-conversions"].forEach(s=>$(s).textContent="—");["#compare-clicks","#compare-impressions","#compare-sessions","#compare-conversions"].forEach(s=>$(s).textContent="Google data");$("#overview-summary").innerHTML='<div class="empty-state"><span class="empty-icon">⌁</span><strong>Select a website to load its metrics</strong><p>Choose a website above, then apply a date range.</p></div>';renderGsc();renderGa4();return;}
const r=selectedRange();if(!r.startDate||!r.endDate)throw new Error("Choose both start and end dates.");if(r.startDate>r.endDate)throw new Error("Start date must be on or before end date.");const comparing=$("#compare-period").checked,previous=comparing?previousRange(r):null,base="/websites/"+encodeURIComponent(id),query=range=>new URLSearchParams(range).toString();
state.gsc=[];state.ga4=[];state.previousGsc=[];state.previousGa4=[];state.gscLoaded=false;state.ga4Loaded=false;state.previousGscLoaded=false;state.previousGa4Loaded=false;
const requests=[api(`${base}/gsc?${query(r)}`),api(`${base}/ga4?${query(r)}&reportType=summary`)];
if(comparing){requests.push(api(`${base}/gsc?${query(previous)}`),api(`${base}/ga4?${query(previous)}&reportType=summary`));}
const results=await Promise.allSettled(requests);
if(results[0].status==="fulfilled"){const d=results[0].value;state.gsc=Array.isArray(d)?d:d.rows||d.data||[];state.gscLoaded=true;}
if(results[1].status==="fulfilled"){const d=results[1].value;state.ga4=Array.isArray(d)?d:d.rows||d.data||[];state.ga4Loaded=true;}
if(comparing&&results[2].status==="fulfilled"){const d=results[2].value;state.previousGsc=Array.isArray(d)?d:d.rows||d.data||[];state.previousGscLoaded=true;}
if(comparing&&results[3].status==="fulfilled"){const d=results[3].value;state.previousGa4=Array.isArray(d)?d:d.rows||d.data||[];state.previousGa4Loaded=true;}
renderOverview(r,previous);renderGsc(previous);renderGa4(previous);
const errors=results.filter(x=>x.status==="rejected").map(x=>x.reason.message);if(errors.length)notice("Some reports could not load: "+errors.join(" · "),"error");else notice(comparing?"Reports refreshed with previous-period comparison.":"Reports refreshed from backend.","success");if(state.currentView==="acquisition")await loadAcquisition();}
function sumField(rows,keys){return rows.reduce((total,row)=>{const value=first(row,keys,null);return total+(value==null?0:Number(value)||0);},0);}
function totals(rows,gsc){if(gsc){const clicks=sumField(rows,["clicks"]),impressions=sumField(rows,["impressions"]);const weightedPosition=rows.reduce((total,row)=>total+(Number(row.average_position??row.averagePosition)||0)*(Number(row.impressions)||0),0);return {clicks,impressions,ctr:impressions?clicks/impressions:null,position:impressions?weightedPosition/impressions:null};}
const conversions=rows.reduce((total,row)=>{const stored=first(row,["total_form_conversions","totalFormConversions"],null);return total+(stored==null?sumField([row],["form_submit_conversions","from_submit_conversions"]):Number(stored)||0);},0);return {sessions:sumField(rows,["organic_sessions","organicSessions"]),conversions};}
function changeLabel(current,previous,previousLoaded){if(!previousLoaded)return "Previous data unavailable";if(previous==null)return "No comparison data";if(previous===0)return current===0?"0% vs previous":"New vs previous";const change=(current-previous)/Math.abs(previous)*100;const sign=change>0?"+":"";return `${sign}${change.toFixed(1)}% vs previous`;}
function setMetric(id,comparisonId,value,previous,loaded,compare,previousLoaded){$(id).textContent=loaded?fmt(value):"—";const label=$(comparisonId);label.textContent=compare?(loaded?changeLabel(value,previous,previousLoaded):"Current data unavailable"):(id==="#metric-clicks"?"Google Search Console":id==="#metric-impressions"?"Search visibility":id==="#metric-sessions"?"Google Analytics 4":"GA4 event count");label.className=compare?"comparison-text":"metric-caption";}
function renderOverview(currentRange,previous){const currentGsc=totals(state.gsc,true),oldGsc=totals(state.previousGsc,true),currentGa4=totals(state.ga4,false),oldGa4=totals(state.previousGa4,false),compare=Boolean(previous);
setMetric("#metric-clicks","#compare-clicks",currentGsc.clicks,oldGsc.clicks,state.gscLoaded,compare,state.previousGscLoaded);
setMetric("#metric-impressions","#compare-impressions",currentGsc.impressions,oldGsc.impressions,state.gscLoaded,compare,state.previousGscLoaded);
setMetric("#metric-sessions","#compare-sessions",currentGa4.sessions,oldGa4.sessions,state.ga4Loaded,compare,state.previousGa4Loaded);
setMetric("#metric-conversions","#compare-conversions",currentGa4.conversions,oldGa4.conversions,state.ga4Loaded,compare,state.previousGa4Loaded);
$("#summary-range-label").textContent=compare?`${currentRange.startDate} to ${currentRange.endDate} compared with ${previous.startDate} to ${previous.endDate}`:`${currentRange.startDate} to ${currentRange.endDate}`;
const ctr=currentGsc.ctr,pos=currentGsc.position;$("#overview-summary").innerHTML=`<div style="width:100%;padding:20px"><div class="metric-grid" style="grid-template-columns:repeat(2,minmax(0,1fr));margin:0;gap:12px"><div class="website-card"><small style="color:#8d96a8">Average CTR</small><h2 style="margin:8px 0 0;font:800 24px Manrope">${ctr==null?"—":pct(ctr)}</h2></div><div class="website-card"><small style="color:#8d96a8">Average position</small><h2 style="margin:8px 0 0;font:800 24px Manrope">${pos==null?"—":Number(pos).toFixed(2)}</h2></div></div><p style="font-size:11px;color:#969eaf;margin:16px 0 0">${state.gscLoaded&&state.ga4Loaded?"Summary metrics are calculated from stored API rows.":"Some current-period data could not be loaded."} Daily rows are available in the report tabs.</p></div>`;}
function previousRowMap(rows){return new Map(rows.map(row=>[dateKey(row),row]));}
function renderGsc(previous){const comparing=Boolean(previous),byDate=previousRowMap(state.previousGsc),duration=previous?previous.days:0,thead=$("#gsc-thead");thead.innerHTML=comparing?"<tr><th>Date</th><th>Clicks</th><th>Previous clicks</th><th>Impressions</th><th>Previous impressions</th><th>CTR</th><th>Previous CTR</th><th>Average position</th><th>Previous position</th></tr>":"<tr><th>Date</th><th>Clicks</th><th>Impressions</th><th>CTR</th><th>Average position</th></tr>";
$("#gsc-table").innerHTML=state.gsc.length?state.gsc.map(row=>{const old=byDate.get(previousDateFor(dateKey(row),duration));const position=row.average_position??row.averagePosition,oldPosition=old?.average_position??old?.averagePosition;return `<tr><td>${esc(dateKey(row))}</td><td>${fmt(row.clicks)}</td>${comparing?`<td>${old?fmt(old.clicks):"—"}</td>`:""}<td>${fmt(row.impressions)}</td>${comparing?`<td>${old?fmt(old.impressions):"—"}</td>`:""}<td>${pct(row.ctr)}</td>${comparing?`<td>${old?pct(old.ctr):"—"}</td>`:""}<td>${position==null?"—":Number(position).toFixed(2)}</td>${comparing?`<td>${old&&oldPosition!=null?Number(oldPosition).toFixed(2):"—"}</td>`:""}</tr>`;}).join(""):`<tr><td colspan="${comparing?9:5}" class="empty-cell">${state.gscLoaded?"No Search Console rows for this date range.":"Search Console data could not be loaded."}</td></tr>`;}
function renderGa4(previous){const comparing=Boolean(previous),byDate=previousRowMap(state.previousGa4),duration=previous?previous.days:0,thead=$("#ga4-thead");thead.innerHTML=comparing?"<tr><th>Date</th><th>Organic sessions</th><th>Previous sessions</th><th>form_submit</th><th>Previous form_submit</th><th>From_submit</th><th>Previous From_submit</th><th>Total conversions</th><th>Previous conversions</th></tr>":"<tr><th>Date</th><th>Organic sessions</th><th>form_submit</th><th>From_submit</th><th>Total conversions</th></tr>";
$("#ga4-table").innerHTML=state.ga4.length?state.ga4.map(row=>{const old=byDate.get(previousDateFor(dateKey(row),duration)),sessions=["organic_sessions","organicSessions","sessions"],form=["form_submit_conversions","form_submit","formSubmitConversions"],from=["from_submit_conversions","From_submit","from_submit"],total=["total_form_conversions","totalFormConversions","total_conversions","total_events","totalConversions"];return `<tr><td>${esc(dateKey(row))}</td><td>${fmt(first(row,sessions,null))}</td>${comparing?`<td>${old?fmt(first(old,sessions,null)):"—"}</td>`:""}<td>${fmt(first(row,form,null))}</td>${comparing?`<td>${old?fmt(first(old,form,null)):"—"}</td>`:""}<td>${fmt(first(row,from,null))}</td>${comparing?`<td>${old?fmt(first(old,from,null)):"—"}</td>`:""}<td>${fmt(first(row,total,null))}</td>${comparing?`<td>${old?fmt(first(old,total,null)):"—"}</td>`:""}</tr>`;}).join(""):`<tr><td colspan="${comparing?9:5}" class="empty-cell">${state.ga4Loaded?"No GA4 rows for this date range.":"GA4 data could not be loaded."}</td></tr>`;}

function parseObject(value) {
  if (value && typeof value === "object") return value;
  if (typeof value === "string") {
    try { return JSON.parse(value); } catch { return {}; }
  }
  return {};
}

function acquisitionObjects(row) {
  return {
    dimensions: parseObject(
      row.dimensions_json ?? row.dimensions
    ),
    metrics: parseObject(
      row.metrics_json ?? row.metrics
    )
  };
}

function acquisitionValue(row, candidates) {
  const { dimensions, metrics } = acquisitionObjects(row);
  const all = { ...dimensions, ...metrics, ...row };

  for (const candidate of candidates) {
    const key = Object.keys(all).find(
      k => k.toLowerCase() === candidate.toLowerCase()
    );
    if (key && all[key] != null) return all[key];
  }
  return null;
}

function acquisitionDimensionLabel(value) {
  const labels = {
    default_channel_group: "Default channel group",
    source_medium: "Source / medium"
  };
  return labels[value] || value;
}

function aggregateUserAcquisition(rows) {
  const grouped = new Map();
  for (const row of rows) {
    const label = String(
      acquisitionValue(row, ["dimensionValue", "dimension_value"]) ?? "Unspecified"
    );
    const { metrics } = acquisitionObjects(row);
    const aggregate = grouped.get(label) ?? {
      dimensionValue: label,
      metrics: {},
      engagementRateDays: 0,
      sessionDurationDays: 0
    };

    for (const key of ["totalUsers", "newUsers", "activeUsers", "engagedSessions", "conversions", "totalRevenue"]) {
      if (metrics[key] == null || metrics[key] === "") continue;
      const value = Number(metrics[key]);
      if (Number.isFinite(value)) {
        aggregate.metrics[key] = (aggregate.metrics[key] || 0) + value;
      }
    }

    if (metrics.engagementRate != null && metrics.engagementRate !== "") {
      const engagementRate = Number(metrics.engagementRate);
      if (Number.isFinite(engagementRate)) {
        aggregate.metrics.engagementRate = (aggregate.metrics.engagementRate || 0) + engagementRate;
        aggregate.engagementRateDays += 1;
      }
    }

    if (metrics.averageSessionDuration != null && metrics.averageSessionDuration !== "") {
      const sessionDuration = Number(metrics.averageSessionDuration);
      if (Number.isFinite(sessionDuration)) {
        aggregate.metrics.averageSessionDuration =
          (aggregate.metrics.averageSessionDuration || 0) + sessionDuration;
        aggregate.sessionDurationDays += 1;
      }
    }

    grouped.set(label, aggregate);
  }

  return [...grouped.values()].map((aggregate) => {
    if (aggregate.engagementRateDays) {
      aggregate.metrics.engagementRate /= aggregate.engagementRateDays;
    }
    if (aggregate.sessionDurationDays) {
      aggregate.metrics.averageSessionDuration /= aggregate.sessionDurationDays;
    }
    return {
      dimensionValue: aggregate.dimensionValue,
      metrics: aggregate.metrics
    };
  });
}

function renderAcquisition() {
  const type = $("#acquisition-type").value;
  const dimension = $("#acquisition-dimension").value;
  const search = $("#acquisition-search").value.trim().toLowerCase();
  const channelSelect = $("#acquisition-channel");
  const thead = $("#acquisition-thead");
  const tbody = $("#acquisition-table");
  $("#acquisition-channel-label").textContent = `Filter by ${acquisitionDimensionLabel(dimension)}`;

  const metrics = type === "user_acquisition"
    ? [
        ["Total users (daily sum)", ["totalUsers"]],
        ["New users", ["newUsers"]],
        ["Active users (daily sum)", ["activeUsers"]],
        ["Engaged sessions", ["engagedSessions"]],
        ["Avg. engagement rate", ["engagementRate"]],
        ["Avg. session duration (seconds)", ["averageSessionDuration"]],
        ["Conversions", ["conversions"]],
        ["Revenue", ["totalRevenue"]]
      ]
    : [
        ["Sessions", ["sessions"]],
        ["Engaged sessions", ["engagedSessions", "engaged_sessions"]],
        ["Engagement rate", ["engagementRate", "engagement_rate"]],
        ["Average engagement time", ["averageSessionDuration", "average_engagement_time_per_session"]],
        ["Events per session", ["eventsPerSession", "events_per_session"]],
        ["Event count", ["eventCount", "event_count"]],
        ["Key events", ["keyEvents", "key_events", "conversions"]]
      ];

  const dimensionKeys = type === "user_acquisition"
    ? {
        default_channel_group: ["firstUserDefaultChannelGroup", "first_user_default_channel_group"],
        source_medium: ["firstUserSourceMedium", "first_user_source_medium"]
      }
    : {
        default_channel_group: ["sessionDefaultChannelGroup", "session_default_channel_group"],
        source_medium: ["sessionSourceMedium", "session_source_medium"]
      };
  const dimCandidates = dimensionKeys[dimension] || dimensionKeys.default_channel_group;

  const reportRows = type === "user_acquisition"
    ? aggregateUserAcquisition(state.acquisition)
    : state.acquisition;
  const rows = reportRows.map(row => {
    const { dimensions, metrics: metricData } = acquisitionObjects(row);
    const label = acquisitionValue(row, ["dimensionValue", "dimension_value"]) ??
      acquisitionValue(row, dimCandidates) ??
      Object.values(dimensions)[0] ?? "Unspecified";

    return {
      row,
      label: String(label),
      dimensions,
      metricData
    };
  });

  const channels = [...new Set(rows.map(r => r.label))]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));

  const oldChannel = channelSelect.value;
  channelSelect.innerHTML = '<option value="">All channels</option>' +
    channels.map(c =>
      `<option value="${esc(c)}">${esc(c)}</option>`
    ).join("");

  if (channels.includes(oldChannel)) channelSelect.value = oldChannel;

  const selectedChannel = channelSelect.value;
  const filtered = rows.filter(item => {
    const text = JSON.stringify(item.row).toLowerCase();
    return (!search || text.includes(search)) &&
      (!selectedChannel || item.label === selectedChannel);
  });

  thead.innerHTML = `<tr>
    <th>${esc(acquisitionDimensionLabel(dimension))}</th>
    ${metrics.map(m => `<th>${esc(m[0])}</th>`).join("")}
  </tr>`;

  tbody.innerHTML = filtered.length ? filtered.map(item => {
    const cells = metrics.map(([label, keys]) => {
      const value = acquisitionValue(item.row, keys);
      if (value == null) return "<td>—</td>";

      const isRate = /rate/i.test(label);
      const display = isRate ? pct(value) : fmt(value);
      return `<td>${esc(display)}</td>`;
    }).join("");

    return `<tr><td>${esc(item.label)}</td>${cells}</tr>`;
  }).join("") : `<tr><td colspan="${metrics.length + 1}"
    class="empty-cell">No acquisition rows match these filters.</td></tr>`;

  $("#acquisition-count").textContent =
    `Showing ${filtered.length} of ${rows.length} rows`;
}

async function loadAcquisition() {
  const id = siteId();

  if (!id) {
    state.acquisition = [];
    $("#acquisition-thead").innerHTML = "";
    $("#acquisition-table").innerHTML =
      '<tr><td class="empty-cell">Select a website to view acquisition data.</td></tr>';
    $("#acquisition-count").textContent = "";
    return;
  }

  const q = new URLSearchParams({
    ...range(),
    reportType: $("#acquisition-type").value,
    dimensionType: $("#acquisition-dimension").value
  }).toString();

  const d = await api(
    `/websites/${encodeURIComponent(id)}/ga4?${q}`
  );


  state.acquisition = Array.isArray(d)
    ? d
    : d.rows || d.data || [];

  renderAcquisition();
}


async function loadKeywords() {
  const id = siteId();
  if (!id) {
    state.keywords = [];
    state.keywordHistory = [];
    $("#keywords-table").innerHTML = '<tr><td colspan="3" class="empty-cell">Select a website to load keywords.</td></tr>';
    $("#keyword-select").innerHTML = '<option value="">Select keyword…</option>';
    return;
  }
  const data = await api(`/websites/${encodeURIComponent(id)}/gsc/keywords`);
  state.keywords = data.keywords || [];
  $("#keywords-table").innerHTML = state.keywords.length
    ? state.keywords.map(keyword => `<tr>
        <td>${esc(keyword.keyword)}</td>
        <td>${esc(String(keyword.created_at || "").replace("T", " ").slice(0, 19))}</td>
        <td><button class="button button-outline keyword-delete" type="button" data-keyword-id="${esc(keyword.keyword_id)}">Delete</button></td>
      </tr>`).join("")
    : '<tr><td colspan="3" class="empty-cell">No keywords tracked for this website.</td></tr>';
  const selected = $("#keyword-select").value;
  $("#keyword-select").innerHTML = '<option value="">Select keyword…</option>' +
    state.keywords.map(keyword => `<option value="${esc(keyword.keyword_id)}">${esc(keyword.keyword)}</option>`).join("");
  if (state.keywords.some(keyword => String(keyword.keyword_id) === String(selected))) {
    $("#keyword-select").value = selected;
  } else {
    state.keywordHistory = [];
    $("#keyword-history-table").innerHTML = '<tr><td colspan="5" class="empty-cell">Select a keyword and sync its history.</td></tr>';
  }
  $$(".keyword-delete").forEach(button => button.addEventListener("click", () => deleteKeyword(button.dataset.keywordId)));
}

async function addKeyword(event) {
  event.preventDefault();
  const id = siteId();
  const keyword = $("#keyword-input").value.trim();
  if (!id) return notice("Select a website first.", "error");
  if (!keyword) return notice("Enter a keyword.", "error");
  try {
    const saved = await api(`/websites/${encodeURIComponent(id)}/gsc/keywords`, {
      method: "POST",
      body: JSON.stringify({ keyword })
    });
    $("#keyword-input").value = "";
    await loadKeywords();
    if (saved.keyword?.keyword_id) {
      $("#keyword-select").value = String(saved.keyword.keyword_id);
      await loadKeywordHistory().catch(handleError);
      await syncKeywordHistory();
    }
    notice("Keyword added.", "success");
  } catch (error) {
    handleError(error);
  }
}

async function deleteKeyword(keywordId) {
  const id = siteId();
  if (!id || !keywordId || !confirm("Delete this tracked keyword and its stored history?")) return;
  try {
    await api(`/websites/${encodeURIComponent(id)}/gsc/keywords/${encodeURIComponent(keywordId)}`, {
      method: "DELETE"
    });
    if ($("#keyword-select").value === String(keywordId)) $("#keyword-select").value = "";
    await loadKeywords();
    state.keywordHistory = [];
    renderKeywordHistory();
    notice("Keyword deleted.", "success");
  } catch (error) {
    handleError(error);
  }
}

async function loadKeywordHistory() {
  const websiteId = siteId();
  const keywordId = $("#keyword-select").value;
  if (!websiteId || !keywordId) {
    state.keywordHistory = [];
    renderKeywordHistory();
    return;
  }
  const currentRange = range();
  const query = new URLSearchParams(currentRange).toString();
  const data = await api(`/websites/${encodeURIComponent(websiteId)}/gsc/keywords/${encodeURIComponent(keywordId)}/history?${query}`);
  state.keywordHistory = data.rows || [];
  renderKeywordHistory();
}

async function syncKeywordHistory() {
  const websiteId = siteId();
  const keywordId = $("#keyword-select").value;
  if (!websiteId || !keywordId) return notice("Select a website and keyword first.", "error");
  try {
    const currentRange = range();
    await api(`/websites/${encodeURIComponent(websiteId)}/gsc/keywords/${encodeURIComponent(keywordId)}/history/sync`, {
      method: "POST",
      body: JSON.stringify(currentRange)
    });
    await loadKeywordHistory();
    notice("Keyword history synchronized.", "success");
  } catch (error) {
    handleError(error);
  }
}

function renderKeywordHistory() {
  const rows = state.keywordHistory || [];
  $("#keyword-history-table").innerHTML = rows.length
    ? rows.map(row => `<tr>
        <td>${esc(row.report_date)}</td>
        <td>${fmt(row.clicks)}</td>
        <td>${fmt(row.impressions)}</td>
        <td>${pct(row.ctr)}</td>
        <td>${fmt(row.average_position)}</td>
      </tr>`).join("")
    : '<tr><td colspan="5" class="empty-cell">No stored data for the selected date range.</td></tr>';

  if (!rows.length) {
    $("#keyword-chart").innerHTML = '<div class="empty-state"><strong>No keyword history in this date range</strong></div>';
    $("#keyword-summary").innerHTML = '<article class="metric-card"><div class="metric-top"><span>Clicks</span></div><strong>—</strong></article><article class="metric-card"><div class="metric-top"><span>Impressions</span></div><strong>—</strong></article><article class="metric-card"><div class="metric-top"><span>CTR</span></div><strong>—</strong></article><article class="metric-card"><div class="metric-top"><span>Latest position</span></div><strong>—</strong></article>';
    return;
  }

  const clicks = rows.reduce((sum, row) => sum + Number(row.clicks || 0), 0);
  const impressions = rows.reduce((sum, row) => sum + Number(row.impressions || 0), 0);
  const ctr = impressions ? clicks / impressions : 0;
  const latest = Number(rows[rows.length - 1].average_position);
  $("#keyword-summary").innerHTML = `<article class="metric-card"><div class="metric-top"><span>Clicks</span></div><strong>${fmt(clicks)}</strong></article><article class="metric-card"><div class="metric-top"><span>Impressions</span></div><strong>${fmt(impressions)}</strong></article><article class="metric-card"><div class="metric-top"><span>CTR</span></div><strong>${pct(ctr)}</strong></article><article class="metric-card"><div class="metric-top"><span>Latest position</span></div><strong>${fmt(latest)}</strong></article>`;

  const width = 760;
  const height = 260;
  const left = 52;
  const right = 18;
  const top = 18;
  const bottom = 38;
  const positions = rows.map(row => Number(row.average_position)).filter(Number.isFinite);
  const maxPosition = Math.max(1, ...positions);
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const y = value => top + (Math.min(maxPosition, Math.max(1, value)) - 1) / Math.max(1, maxPosition - 1) * plotHeight;
  const x = index => rows.length === 1 ? left + plotWidth / 2 : left + index / (rows.length - 1) * plotWidth;
  const points = rows.map((row, index) => `${x(index)},${y(Number(row.average_position))}`).join(" ");
  const firstLabel = rows[0]?.report_date || "";
  const lastLabel = rows[rows.length - 1]?.report_date || "";
  $("#keyword-chart").innerHTML = `<svg class="position-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Google Search Console average position chart">
    <line x1="${left}" y1="${y(1)}" x2="${width-right}" y2="${y(1)}" class="chart-grid"/>
    <line x1="${left}" y1="${y(maxPosition)}" x2="${width-right}" y2="${y(maxPosition)}" class="chart-grid"/>
    <text x="${left-38}" y="${y(1)+4}" class="chart-axis">1</text>
    <text x="${left-38}" y="${y(maxPosition)+4}" class="chart-axis">${esc(maxPosition.toFixed(1))}</text>
    <polyline points="${points}" class="position-line"/>
    ${rows.map((row, index) => `<circle cx="${x(index)}" cy="${y(Number(row.average_position))}" r="3" class="position-dot"><title>${esc(row.report_date)}: ${esc(row.average_position)}</title></circle>`).join("")}
    <text x="${left}" y="${height-8}" class="chart-axis">${esc(firstLabel)}</text>
    <text x="${width-right}" y="${height-8}" text-anchor="end" class="chart-axis">${esc(lastLabel)}</text>
    <text x="14" y="${top+plotHeight/2}" text-anchor="middle" class="chart-axis" transform="rotate(-90 14 ${top+plotHeight/2})">Average position</text>
  </svg>`;
}

function exportKeywordHistory() {
  if (!state.keywordHistory.length) return notice("There is no keyword history to export.", "error");
  const keys = ["report_date", "clicks", "impressions", "ctr", "average_position"];
  const quote = value => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const csv = [keys.join(","), ...state.keywordHistory.map(row => keys.map(key => quote(row[key])).join(","))].join("\r\n");
  const url = URL.createObjectURL(new Blob(["\ufeff"+csv], { type: "text/csv;charset=utf-8;" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `keyword-history-${range().startDate}-to-${range().endDate}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function loadJobs() {
  const d = await api("/sync-jobs");
  state.jobs = Array.isArray(d) ? d : d.jobs || d.data || [];

  $("#jobs-table").innerHTML = state.jobs.length
    ? state.jobs.map(j => {
        const status = String(j.status || "unknown").toLowerCase();
        const cssClass = status === "failed"
          ? "failed"
          : status === "completed"
            ? "completed"
            : "pending";

        const type = [
          j.sync_type,
          j.source,
          j.report_type
        ].filter(Boolean).join(" / ");

        const progress = j.rows_fetched ?? j.rowsFetched ??
          j.progress ?? j.progress_percent ?? "—";

        return `<tr>
          <td>${esc(j.job_id ?? j.id ?? "—")}</td>
          <td>${esc(j.website_name ?? j.websiteName ?? j.website_id ?? "—")}</td>
          <td>${esc(type || "—")}</td>
          <td><span class="status-chip ${cssClass}">${esc(status)}</span></td>
          <td>${esc(progress)}</td>
          <td>${esc(j.created_at ?? j.createdAt ?? "—")}</td>
        </tr>`;
      }).join("")
    : '<tr><td colspan="6" class="empty-cell">No sync jobs found.</td></tr>';
}

async function startSync(id=siteId()){if(!id)return notice("Select a website first.","error");try{const d=await api(`/websites/${encodeURIComponent(id)}/sync`,{method:"POST",body:JSON.stringify({})});notice(`Sync request submitted. ${d.jobId||d.job_id?`Job ID: ${d.jobId||d.job_id}`:""}`,"success");switchView("sync");await loadJobs();}catch(e){handleError(e);}}
function openDialog(){const d=$("#website-dialog");if(d.showModal)d.showModal();else d.setAttribute("open","");}
function closeDialog(){const d=$("#website-dialog");if(d.close)d.close();else d.removeAttribute("open");}
async function createWebsite(e){e.preventDefault();const f=e.currentTarget,v=Object.fromEntries(new FormData(f).entries()),btn=f.querySelector('[type="submit"]');btn.disabled=true;btn.textContent="Saving…";const payload={websiteName:v.websiteName.trim(),domainName:v.domainName.trim(),ga4PropertyId:v.ga4PropertyId.trim(),timezone:"UTC"};const gscPropertyUrl=v.gscPropertyUrl.trim();if(gscPropertyUrl)payload.gscPropertyUrl=gscPropertyUrl;try{await api("/websites",{method:"POST",body:JSON.stringify(payload)});closeDialog();f.reset();await loadWebsites();switchView("websites");notice("Website saved. A sync may have been queued by the backend.","success");}catch(e){handleError(e);}finally{btn.disabled=false;btn.textContent="Save website";}}
function exportCsv(type){const rows=type==="gsc"?state.gsc:type==="ga4"?state.ga4:state.acquisition;if(!rows?.length)return notice("There is no data to export for this report.","error");const keys=[...new Set(rows.flatMap(Object.keys))],q=v=>`"${String(typeof v==="object"&&v!==null?JSON.stringify(v):v??"").replace(/"/g,'""')}"`;const csv=[keys.map(q).join(","),...rows.map(r=>keys.map(k=>q(r[k])).join(","))].join("\\r\\n");const url=URL.createObjectURL(new Blob(["\\ufeff"+csv],{type:"text/csv;charset=utf-8;"})),a=document.createElement("a");a.href=url;a.download=`seo-analytics-${type}-${range().startDate}-to-${range().endDate}.csv`;document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);}
async function checkBackend(){try{const base=API_BASE.replace(/\/api$/,""),r=await fetch(base+"/health",{credentials:"include"});if(!r.ok)throw Error();const d=await r.json();connection(true,d.database==="connected"?"Backend connected":"Backend online");}catch{connection(false,"Backend unavailable");}}
async function boot(){defaultDates(28);$$(".nav-item").forEach(b=>b.addEventListener("click",()=>switchView(b.dataset.view)));$$("[data-go]").forEach(b=>b.addEventListener("click",()=>switchView(b.dataset.go)));$("#menu-button").addEventListener("click",()=>$("#sidebar").classList.toggle("open"));$("#apply-filters").addEventListener("click",()=>refreshReports().catch(handleError));$("#website-select").addEventListener("change",()=>refreshReports().catch(handleError));$("#date-preset").addEventListener("change",event=>{if(event.target.value!=="custom")setPresetRange(Number(event.target.value));});$("#start-date").addEventListener("change",()=>$("#date-preset").value="custom");$("#end-date").addEventListener("change",()=>$("#date-preset").value="custom");$("#compare-period").addEventListener("change",()=>refreshReports().catch(handleError));
$("#apply-filters").addEventListener("click", () => {
  if (state.currentView === "keywords") loadKeywordHistory().catch(handleError);
});
$("#website-select").addEventListener("change", () => {
  if (state.currentView === "keywords") loadKeywords().catch(handleError);
});
$("#keyword-form").addEventListener("submit", addKeyword);
$("#keyword-select").addEventListener("change", () => loadKeywordHistory().catch(handleError));
$("#sync-keyword-history").addEventListener("click", syncKeywordHistory);
$("#export-keyword-history").addEventListener("click", exportKeywordHistory);
$("#acquisition-type").addEventListener("change", () => {
  $("#acquisition-channel").value = "";
  loadAcquisition().catch(handleError);
});

$("#acquisition-dimension").addEventListener("change", () => {
  $("#acquisition-channel").value = "";
  loadAcquisition().catch(handleError);
});

$("#acquisition-search").addEventListener("input", renderAcquisition);

$("#acquisition-channel").addEventListener("change", renderAcquisition);

$("#reset-acquisition-filters").addEventListener("click", () => {
  $("#acquisition-dimension").value = "default_channel_group";
  $("#acquisition-search").value = "";
  $("#acquisition-channel").value = "";
  renderAcquisition();
});
$("#open-add-website").addEventListener("click",openDialog);$("#close-website-dialog").addEventListener("click",closeDialog);$("#cancel-website").addEventListener("click",closeDialog);$("#website-form").addEventListener("submit",createWebsite);$("#refresh-jobs").addEventListener("click",()=>loadJobs().catch(handleError));$$(".export-button").forEach(b=>b.addEventListener("click",()=>exportCsv(b.dataset.export)));$("#google-login").addEventListener("click",()=>location.href=API_BASE+"/auth/google");$("#website-dialog").addEventListener("click",e=>{if(e.target===$("#website-dialog"))closeDialog();});await checkBackend();try{await api("/auth/me");await loadWebsites();if(state.websites.length){$("#website-select").value=String(state.websites[0].id);await refreshReports();}else{$("#overview-summary").innerHTML='<div class="empty-state"><span class="empty-icon">◎</span><strong>Add your first website</strong><p>Use Websites to connect your analytics properties.</p></div>';}}catch(e){if(/401|unauthorized|not authenticated/i.test(e.message))notice("Connect Google to sign in before loading private reports.");else notice(`Could not load backend data: ${e.message}. Check API status and migrations.`,"error");}}
document.addEventListener("DOMContentLoaded",boot);
