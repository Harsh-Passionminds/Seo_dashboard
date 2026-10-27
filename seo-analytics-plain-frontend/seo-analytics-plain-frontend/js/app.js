/* Plain HTML/CSS/JS client for the SEO Analytics Express API. */
const API_BASE = (window.API_BASE || "http://localhost:5000/api").replace(/\/$/, "");
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const state = { websites: [], gsc: [], ga4: [], acquisition: [], jobs: [], currentView: "overview" };
const viewCopy = {
 overview:["Overview","Monitor organic visibility, traffic and conversions across your websites."],
 "search-console":["Search Console","Review daily Google Search Console performance."],
 analytics:["Google Analytics","Review organic sessions and conversion events from GA4."],
 acquisition:["Acquisition reports","Explore session-scoped and first-user-scoped acquisition."],
 websites:["Websites","Manage properties and keep each website's data separate."],
 sync:["Sync activity","Track historical imports and incremental updates."]
};
function esc(v){return String(v??"").replace(/[&<>\"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function fmt(v){if(v===null||v===undefined||v==="")return "—";const n=Number(v);return Number.isFinite(n)?n.toLocaleString():String(v);}
function pct(v){if(v===null||v===undefined||v==="")return "—";const n=Number(v);return Number.isFinite(n)?`${(n<=1?n*100:n).toFixed(2)}%`:"—";}
function range(){return {startDate:$("#start-date").value,endDate:$("#end-date").value};}
function siteId(){return $("#website-select").value;}
async function api(path,options={}){const r=await fetch(API_BASE+path,{...options,credentials:"include",headers:{...(options.body?{"Content-Type":"application/json"}:{}),...(options.headers||{})}});const ct=r.headers.get("content-type")||"";const d=ct.includes("json")?await r.json():await r.text();if(!r.ok)throw new Error(typeof d==="object"?(d.message||d.error||`HTTP ${r.status}`):d||`HTTP ${r.status}`);return d;}
function notice(msg,type=""){const el=$("#notice");el.textContent=msg;el.className=`notice ${type}`.trim();el.classList.remove("hidden");}
function hideNotice(){$("#notice").classList.add("hidden");}
function handleError(e){console.error(e);notice(e.message||"Unexpected error","error");}
function connection(ok,label){$(".connection-dot").classList.toggle("online",ok);$("#connection-label").textContent=label;$("#connection-sub").textContent=ok?"API reachable":"Check backend / database";}
function normSite(w){return {id:w.website_id??w.id,name:w.website_name??w.websiteName??w.name??"Website",domain:w.domain_name??w.domainName??w.domain_url??w.domainUrl??"",ga4:w.ga4_property_id??w.ga4PropertyId??"",gsc:w.gsc_property_url??w.gscPropertyUrl??""};}
function defaultDates(){const e=new Date();e.setDate(e.getDate()-1);const s=new Date(e);s.setDate(s.getDate()-27);$("#end-date").value=e.toISOString().slice(0,10);$("#start-date").value=s.toISOString().slice(0,10);}
function switchView(name){if(!viewCopy[name])return;state.currentView=name;$$(".nav-item").forEach(b=>b.classList.toggle("active",b.dataset.view===name));$$(".view").forEach(v=>v.classList.add("hidden"));$("#view-"+name).classList.remove("hidden");$("#breadcrumb-current").textContent=viewCopy[name][0];$("#page-title").textContent=viewCopy[name][0];$("#page-description").textContent=viewCopy[name][1];$("#sidebar").classList.remove("open");hideNotice();if(name==="websites")loadWebsites().catch(handleError);if(name==="sync")loadJobs().catch(handleError);if(name==="acquisition")loadAcquisition().catch(handleError);}
function renderSiteSelect(){const s=$("#website-select"),old=s.value;s.innerHTML='<option value="">Choose website…</option>'+state.websites.map(w=>`<option value="${esc(w.id)}">${esc(w.name)} — ${esc(w.domain)}</option>`).join("");if(state.websites.some(w=>String(w.id)===old))s.value=old;}
async function loadWebsites(){const d=await api("/websites");state.websites=(Array.isArray(d)?d:d.websites||d.data||[]).map(normSite);renderSiteSelect();renderSiteCards();}
function renderSiteCards(){const el=$("#website-grid");if(!state.websites.length){el.innerHTML='<div class="panel empty-state"><span class="empty-icon">◎</span><strong>No websites yet</strong><p>Add a website and configure GA4 and Search Console properties.</p><p style="margin-top:14px"><button class="button button-primary" id="empty-add-website">＋ Add website</button></p></div>';$("#empty-add-website")?.addEventListener("click",openDialog);return;}
el.innerHTML=state.websites.map(w=>`<article class="website-card"><div class="website-card-top"><div class="site-avatar">${esc(w.name[0]?.toUpperCase()||"W")}</div><div style="min-width:0"><h3>${esc(w.name)}</h3><div class="domain">${esc(w.domain)}</div></div></div><div class="website-meta"><span>GA4 property <b>${esc(w.ga4||"Not configured")}</b></span><span>Search Console <b>${esc(w.gsc||"Not configured")}</b></span></div><div class="card-actions"><button class="button button-outline" data-select-site="${esc(w.id)}">View reports</button><button class="button button-primary" data-sync-site="${esc(w.id)}">Sync now</button></div></article>`).join("");
$$("[data-select-site]").forEach(b=>b.addEventListener("click",()=>{$("#website-select").value=b.dataset.selectSite;switchView("overview");refreshReports().catch(handleError);}));$$("[data-sync-site]").forEach(b=>b.addEventListener("click",()=>startSync(b.dataset.syncSite)));}
function first(o,keys,fb=0){for(const k of keys)if(o&&o[k]!==undefined&&o[k]!==null)return o[k];return fb;}
function unwrap(d){return d?.summary||d?.overview||d?.data||d||{};}
async function refreshReports(){hideNotice();const id=siteId();if(!id){["#metric-clicks","#metric-impressions","#metric-sessions","#metric-conversions"].forEach(s=>$(s).textContent="—");$("#overview-summary").innerHTML='<div class="empty-state"><span class="empty-icon">⌁</span><strong>Select a website to load its metrics</strong><p>Choose a website above, then apply a date range.</p></div>';return;}
const r=range();if(!r.startDate||!r.endDate)throw new Error("Choose both start and end dates.");if(r.startDate>r.endDate)throw new Error("Start date must be on or before end date.");const q=new URLSearchParams(r).toString(),base="/websites/"+encodeURIComponent(id);
const results=await Promise.allSettled([api(`${base}/overview?${q}`),api(`${base}/gsc?${q}`),api(`${base}/ga4?${q}&reportType=summary`)]);
if(results[0].status==="fulfilled")renderOverview(results[0].value);
if(results[1].status==="fulfilled"){const d=results[1].value;state.gsc=Array.isArray(d)?d:d.rows||d.data||[];renderGsc();}
if(results[2].status==="fulfilled"){const d=results[2].value;state.ga4=Array.isArray(d)?d:d.rows||d.data||[];renderGa4();}
const errors=results.filter(x=>x.status==="rejected").map(x=>x.reason.message);if(errors.length)notice("Some reports could not load: "+errors.join(" · "),"error");else notice("Reports refreshed from backend.","success");if(state.currentView==="acquisition")await loadAcquisition();}
function renderOverview(raw){const d=unwrap(raw);$("#metric-clicks").textContent=fmt(first(d,["clicks","totalClicks","gsc_clicks"],null));$("#metric-impressions").textContent=fmt(first(d,["impressions","totalImpressions","gsc_impressions"],null));$("#metric-sessions").textContent=fmt(first(d,["organicSessions","organic_sessions","sessions","totalOrganicSessions"],null));$("#metric-conversions").textContent=fmt(first(d,["formSubmitConversions","form_submit_conversions","conversions","totalConversions"],null));const ctr=first(d,["ctr","clickThroughRate"],null),pos=first(d,["averagePosition","average_position","position"],null);$("#overview-summary").innerHTML=`<div style="width:100%;padding:20px"><div class="metric-grid" style="grid-template-columns:repeat(2,minmax(0,1fr));margin:0;gap:12px"><div class="website-card"><small style="color:#8d96a8">Average CTR</small><h2 style="margin:8px 0 0;font:800 24px Manrope">${ctr==null?"—":pct(ctr)}</h2></div><div class="website-card"><small style="color:#8d96a8">Average position</small><h2 style="margin:8px 0 0;font:800 24px Manrope">${pos==null?"—":Number(pos).toFixed(2)}</h2></div></div><p style="font-size:11px;color:#969eaf;margin:16px 0 0">Summary metrics come from your backend. Daily rows are available in the report tabs.</p></div>`;}
function renderGsc(){$("#gsc-table").innerHTML=state.gsc.length?state.gsc.map(r=>`<tr><td>${esc(r.date??r.report_date??"—")}</td><td>${fmt(r.clicks)}</td><td>${fmt(r.impressions)}</td><td>${pct(r.ctr)}</td><td>${r.average_position==null&&r.averagePosition==null?"—":Number(r.average_position??r.averagePosition).toFixed(2)}</td></tr>`).join(""):'<tr><td colspan="5" class="empty-cell">No Search Console rows for this date range.</td></tr>';}
function renderGa4(){$("#ga4-table").innerHTML=state.ga4.length?state.ga4.map(r=>`<tr><td>${esc(r.date??r.report_date??"—")}</td><td>${fmt(first(r,["organic_sessions","organicSessions","sessions"],null))}</td><td>${fmt(first(r,["form_submit_conversions","form_submit","formSubmitConversions"],null))}</td><td>${fmt(first(r,["from_submit_conversions","From_submit","from_submit"],null))}</td><td>${fmt(first(r,["total_conversions","total_events","totalConversions"],null))}</td></tr>`).join(""):'<tr><td colspan="5" class="empty-cell">No GA4 rows for this date range.</td></tr>';}

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
    auto: "Default channel group",
    source: "Source",
    medium: "Medium",
    sourceMedium: "Source / medium",
    campaign: "Campaign"
  };
  return labels[value] || value;
}

function renderAcquisition() {
  const type = $("#acquisition-type").value;
  const dimension = $("#acquisition-dimension").value;
  const search = $("#acquisition-search").value.trim().toLowerCase();
  const channelSelect = $("#acquisition-channel");
  const thead = $("#acquisition-thead");
  const tbody = $("#acquisition-table");

  const dimensionKeys = {
    auto: type === "user_acquisition"
      ? ["firstUserDefaultChannelGroup", "first_user_default_channel_group",
         "firstUserPrimaryChannelGroup", "first_user_primary_channel_group"]
      : ["sessionDefaultChannelGroup", "session_default_channel_group",
         "sessionPrimaryChannelGroup", "session_primary_channel_group"],
    source: type === "user_acquisition"
      ? ["firstUserSource", "first_user_source"]
      : ["sessionSource", "session_source"],
    medium: type === "user_acquisition"
      ? ["firstUserMedium", "first_user_medium"]
      : ["sessionMedium", "session_medium"],
    sourceMedium: type === "user_acquisition"
      ? ["firstUserSourceMedium", "first_user_source_medium"]
      : ["sessionSourceMedium", "session_source_medium"],
    campaign: type === "user_acquisition"
      ? ["firstUserCampaignName", "first_user_campaign"]
      : ["sessionCampaignName", "session_campaign"]
  };

  const metrics = type === "user_acquisition"
    ? [
        ["Total users", ["totalUsers", "total_users", "users"]],
        ["New users", ["newUsers", "new_users"]],
        ["Returning users", ["returningUsers", "returning_users"]],
        ["Average engagement time", ["userEngagementDuration", "average_engagement_time"]],
        ["Engaged sessions / active user", ["engagedSessionsPerUser", "engaged_sessions_per_user"]],
        ["Event count", ["eventCount", "event_count"]],
        ["Key events", ["keyEvents", "key_events", "conversions"]]
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

  const dimCandidates = dimensionKeys[dimension] || dimensionKeys.auto;

  const rows = state.acquisition.map(row => {
    const { dimensions, metrics: metricData } = acquisitionObjects(row);
    const label = acquisitionValue(row, dimCandidates) ??
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
    reportType: $("#acquisition-type").value
  }).toString();

  const d = await api(
    `/websites/${encodeURIComponent(id)}/ga4?${q}`
  );


  state.acquisition = Array.isArray(d)
    ? d
    : d.rows || d.data || [];

  renderAcquisition();
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
async function createWebsite(e){e.preventDefault();const f=e.currentTarget,v=Object.fromEntries(new FormData(f).entries()),btn=f.querySelector('[type="submit"]');btn.disabled=true;btn.textContent="Saving…";try{await api("/websites",{method:"POST",body:JSON.stringify({websiteName:v.websiteName.trim(),domainName:v.domainName.trim(),ga4PropertyId:v.ga4PropertyId.trim(),gscPropertyUrl:v.gscPropertyUrl.trim()||null})});closeDialog();f.reset();await loadWebsites();switchView("websites");notice("Website saved. A sync may have been queued by the backend.","success");}catch(e){handleError(e);}finally{btn.disabled=false;btn.textContent="Save website";}}
function exportCsv(type){const rows=type==="gsc"?state.gsc:type==="ga4"?state.ga4:state.acquisition;if(!rows?.length)return notice("There is no data to export for this report.","error");const keys=[...new Set(rows.flatMap(Object.keys))],q=v=>`"${String(typeof v==="object"&&v!==null?JSON.stringify(v):v??"").replace(/"/g,'""')}"`;const csv=[keys.map(q).join(","),...rows.map(r=>keys.map(k=>q(r[k])).join(","))].join("\\r\\n");const url=URL.createObjectURL(new Blob(["\\ufeff"+csv],{type:"text/csv;charset=utf-8;"})),a=document.createElement("a");a.href=url;a.download=`seo-analytics-${type}-${range().startDate}-to-${range().endDate}.csv`;document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);}
async function checkBackend(){try{const base=API_BASE.replace(/\/api$/,""),r=await fetch(base+"/health",{credentials:"include"});if(!r.ok)throw Error();const d=await r.json();connection(true,d.database==="connected"?"Backend connected":"Backend online");}catch{connection(false,"Backend unavailable");}}
async function boot(){defaultDates();$$(".nav-item").forEach(b=>b.addEventListener("click",()=>switchView(b.dataset.view)));$$("[data-go]").forEach(b=>b.addEventListener("click",()=>switchView(b.dataset.go)));$("#menu-button").addEventListener("click",()=>$("#sidebar").classList.toggle("open"));$("#apply-filters").addEventListener("click",()=>refreshReports().catch(handleError));$("#website-select").addEventListener("change",()=>refreshReports().catch(handleError));
$("#acquisition-type").addEventListener("change", () => {
  $("#acquisition-channel").value = "";
  loadAcquisition().catch(handleError);
});

$("#acquisition-dimension").addEventListener("change", () => {
  $("#acquisition-channel").value = "";
  renderAcquisition();
});

$("#acquisition-search").addEventListener("input", renderAcquisition);

$("#acquisition-channel").addEventListener("change", renderAcquisition);

$("#reset-acquisition-filters").addEventListener("click", () => {
  $("#acquisition-dimension").value = "auto";
  $("#acquisition-search").value = "";
  $("#acquisition-channel").value = "";
  renderAcquisition();
});
$("#open-add-website").addEventListener("click",openDialog);$("#close-website-dialog").addEventListener("click",closeDialog);$("#cancel-website").addEventListener("click",closeDialog);$("#website-form").addEventListener("submit",createWebsite);$("#refresh-jobs").addEventListener("click",()=>loadJobs().catch(handleError));$$(".export-button").forEach(b=>b.addEventListener("click",()=>exportCsv(b.dataset.export)));$("#google-login").addEventListener("click",()=>location.href=API_BASE+"/auth/google");$("#website-dialog").addEventListener("click",e=>{if(e.target===$("#website-dialog"))closeDialog();});await checkBackend();try{await api("/auth/me");await loadWebsites();if(state.websites.length){$("#website-select").value=String(state.websites[0].id);await refreshReports();}else{$("#overview-summary").innerHTML='<div class="empty-state"><span class="empty-icon">◎</span><strong>Add your first website</strong><p>Use Websites to connect your analytics properties.</p></div>';}}catch(e){if(/401|unauthorized|not authenticated/i.test(e.message))notice("Connect Google to sign in before loading private reports.");else notice(`Could not load backend data: ${e.message}. Check API status and migrations.`,"error");}}
document.addEventListener("DOMContentLoaded",boot);
