<script type="text/javascript">
(function initialiseJasminAdmin() {
  const root = document.querySelector("#jasmin-admin");
  if (!root) {
    window.setTimeout(initialiseJasminAdmin, 250);
    return;
  }
  if (root.dataset.ready) return;
  root.dataset.ready = "true";

  const robots = document.createElement("meta");
  robots.name = "robots";
  robots.content = "noindex,nofollow";
  document.head.appendChild(robots);

  const API = "https://jrluybdxwzyyrinfrbly.supabase.co/functions/v1/manage-events";
  const CAPTURE_API = "https://jrluybdxwzyyrinfrbly.supabase.co/functions/v1/capture-event";
  const TOKEN_KEY = "jasmin_capture_token";
  const fields = ["title","description","start_at","end_at","recurrence_frequency","recurrence_until","expires_at","location_name","category_id","status_id","source_url","image_url","featured","editor_note"];
  const timestampFields = ["start_at","end_at","recurrence_until","expires_at"];
  let token = localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY) || "";
  let state = { events: [], categories: [], statuses: [], sources: [], filter: "draft", current: null, currentSource: null, section: "events" };
  const $ = selector => root.querySelector(selector);
  const escapeHtml = value => String(value ?? "").replace(/[&<>'"]/g, character => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"})[character]);
  const status = event => event.statuses?.slug || "";
  const toLocal = value => { if (!value) return ""; const date = new Date(value), pad = number => String(number).padStart(2,"0"); return date.getFullYear()+"-"+pad(date.getMonth()+1)+"-"+pad(date.getDate())+"T"+pad(date.getHours())+":"+pad(date.getMinutes()); };
  const toIso = value => value ? new Date(value).toISOString() : null;
  const dateLabel = value => value ? new Intl.DateTimeFormat("fr-FR",{dateStyle:"medium",timeStyle:"short"}).format(new Date(value)) : "Date à préciser";
  const showToast = text => { const toast=$("[data-ja-toast]"); toast.textContent=text; toast.classList.add("show"); setTimeout(()=>toast.classList.remove("show"),2400); };

  async function api(path, options={}) {
    const response = await fetch(API+path, {...options, headers:{"Content-Type":"application/json","X-Capture-Token":token,...(options.headers||{})}});
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Une erreur est survenue");
    return data;
  }

  async function capturePrefill() {
    const params=new URLSearchParams(location.hash.replace(/^#/,""));if(params.get("capture")!=="1")return;
    const payload={source_url:params.get("source_url")||"",title:params.get("title")||"",description:params.get("description")||"",image_url:params.get("image_url")||"",start_at:params.get("start_at")||"",end_at:params.get("end_at")||"",location_name:params.get("location_name")||""};
    if(!payload.source_url)return;
    showToast("Création du brouillon…");
    const response=await fetch(CAPTURE_API,{method:"POST",headers:{"Content-Type":"application/json","X-Capture-Token":token},body:JSON.stringify(payload)});
    const data=await response.json();if(!response.ok)throw new Error(data.error||"Impossible de créer le brouillon");
    history.replaceState({},document.title,location.pathname+location.search);
    await load();state.filter="draft";render();openEditor(data.id);showToast(data.duplicate?"Ce lien existait déjà.":"Brouillon créé.");
  }

  function desktopCaptureBookmarklet(){
    const editor="https://npreview-jasmin-cottage-montayral.lodgify.com/fr/gestion-agenda";
    const meta=selector=>document.querySelector(selector)?.content?.trim()||"";
    const selection=getSelection()?.toString().trim().slice(0,3000)||"";
    const anchor=getSelection()?.anchorNode;
    const element=anchor?.nodeType===1?anchor:anchor?.parentElement;
    const article=element?.closest('[role="article"],article')||document.querySelector('[role="article"],article')||document.body;
    const links=[...article.querySelectorAll("a[href]")].map(link=>link.href);
    const postPattern=/\/groups\/[^/]+\/(?:posts|permalink)\/|\/posts\/\d+|permalink\.php|story_fbid=/i;
    const source=postPattern.test(location.href)?location.href:links.find(link=>postPattern.test(link))||location.href;
    const media=[...new Set(article.querySelectorAll('[data-visualcompletion="media-vc-image"],img[src*="scontent"],img[src]'))];
    const images=media.map(image=>({source:image.currentSrc||image.src,area:Math.max(image.naturalWidth,image.width)*Math.max(image.naturalHeight,image.height),width:Math.max(image.naturalWidth,image.width),height:Math.max(image.naturalHeight,image.height),preferred:image.matches('[data-visualcompletion="media-vc-image"],img[src*="scontent"]')})).filter(image=>/^https?:/i.test(image.source)&&image.width>=120&&image.height>=120).sort((left,right)=>(Number(right.preferred)-Number(left.preferred))||(right.area-left.area));
    const backgrounds=[...article.querySelectorAll('[style*="background-image"]')].map(node=>getComputedStyle(node).backgroundImage.match(/url\(["']?(https?:[^"')]+)/i)?.[1]).filter(Boolean);
    const normalized=selection.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
    const months={janvier:0,fevrier:1,mars:2,avril:3,mai:4,juin:5,juillet:6,aout:7,septembre:8,octobre:9,novembre:10,decembre:11};
    const dateMatch=normalized.match(/(?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)?\s*(\d{1,2})(?:er)?\s+(janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)(?:\s+(\d{4}))?/i);
    const timeMatch=normalized.match(/(?:\ba\s+)?(\d{1,2})\s*(?:h|:)\s*(\d{0,2})/i);
    let start="";
    if(dateMatch){const now=new Date(),year=dateMatch[3]?Number(dateMatch[3]):now.getFullYear(),date=new Date(year,months[dateMatch[2]],Number(dateMatch[1]),timeMatch?Number(timeMatch[1]):0,timeMatch&&timeMatch[2]?Number(timeMatch[2]):0);if(!dateMatch[3]&&date<new Date(now.valueOf()-14*86400000))date.setFullYear(year+1);start=date.toISOString()}
    const selectedTitle=selection.split(/\r?\n/).map(line=>line.trim()).find(Boolean)||"";
    const params=new URLSearchParams({capture:"1",source_url:source,title:(selectedTitle||meta('meta[property="og:title"]')||meta('meta[name="twitter:title"]')||document.title).slice(0,200),description:(selection||meta('meta[property="og:description"]')||meta('meta[name="description"]')||meta('meta[name="twitter:description"]')).slice(0,3000),image_url:images[0]?.source||backgrounds[0]||meta('meta[property="og:image"]')||meta('meta[name="twitter:image"]'),start_at:start});
    open(editor+"#"+params,"jasmin-capture","popup=yes,width=760,height=900,resizable=yes,scrollbars=yes");
  }

  function setOptions(selector, items) { $(selector).innerHTML = items.map(item=>'<option value="'+item.id+'">'+escapeHtml(item.name)+'</option>').join(""); }
  function render() {
    const choices=[["draft","Brouillons"],["published","Publiés"],["archived","Archivés"],["all","Tous"]];
    $("[data-ja-filters]").innerHTML=choices.map(([slug,label])=>'<button type="button" class="ja-filter '+(state.filter===slug?'active':'')+'" data-filter="'+slug+'">'+label+' ('+(slug==="all"?state.events.length:state.events.filter(event=>status(event)===slug).length)+')</button>').join("");
    const items=state.events.filter(event=>state.filter==="all"||status(event)===state.filter);
    $("[data-ja-list]").innerHTML=items.length?items.map(event=>'<article class="ja-card" tabindex="0" data-id="'+event.id+'"><span class="ja-badge">'+escapeHtml(event.categories?.name||"Sans catégorie")+' · '+escapeHtml(event.statuses?.name||"")+'</span><h2>'+escapeHtml(event.title)+'</h2><p class="ja-meta">'+escapeHtml(dateLabel(event.start_at))+(event.location_name?' · '+escapeHtml(event.location_name):'')+'</p></article>').join(""):'<p>Aucun événement dans cette rubrique.</p>';
  }
  const sourceTypeLabels={facebook_group:"Groupe Facebook",facebook_page:"Page Facebook",mairie:"Mairie",tourist_office:"Office de tourisme",organiser:"Organisateur",local_press:"Presse locale",other:"Autre"};
  const priorityLabels={high:"Haute",normal:"Normale",low:"Basse"};
  function renderSources(){
    $("[data-ja-source-list]").innerHTML=state.sources.length?state.sources.map(source=>'<article class="ja-source-card '+(source.is_active?'':'inactive')+'" tabindex="0" data-source-id="'+source.id+'"><div><span class="ja-badge">'+escapeHtml(sourceTypeLabels[source.source_type]||source.source_type)+(source.area?' · '+escapeHtml(source.area):'')+'</span><h2>'+escapeHtml(source.name)+'</h2><p>'+escapeHtml(source.notes||source.url)+'</p></div><span class="ja-priority">'+escapeHtml(priorityLabels[source.priority]||source.priority)+'</span></article>').join(""):'<p>Aucune source enregistrée.</p>';
  }
  async function loadSources(){const data=await api("/api/sources");state.sources=data.sources;$("[data-ja-sources-loading]").hidden=true;renderSources();}
  function showSection(section){state.section=section;$("[data-ja-events-panel]").hidden=section!=="events";$("[data-ja-sources-panel]").hidden=section!=="sources";root.querySelectorAll("[data-ja-section]").forEach(button=>button.classList.toggle("active",button.dataset.jaSection===section));if(section==="sources"&&state.sources.length===0)loadSources().catch(error=>showToast(error.message));}
  function openSourceEditor(id){
    const source=id?state.sources.find(item=>item.id===id):null;state.currentSource=source||null;
    $("[data-ja-source-title]").textContent=source?source.name:"Ajouter une source";
    $("#ja-source-name").value=source?.name||"";$("#ja-source-link").value=source?.url||"";$("#ja-source-type").value=source?.source_type||"other";$("#ja-source-priority").value=source?.priority||"normal";$("#ja-source-area").value=source?.area||"";$("#ja-source-notes").value=source?.notes||"";$("#ja-source-access-notes").value=source?.access_notes||"";$("#ja-source-added-by").value=source?.added_by||"Nigel";$("#ja-source-active").checked=source?.is_active!==false;$("[data-ja-source-message]").textContent="";$("[data-ja-source-editor]").showModal();
  }
  function sourcePayload(){return{name:$("#ja-source-name").value.trim(),url:$("#ja-source-link").value.trim(),source_type:$("#ja-source-type").value,priority:$("#ja-source-priority").value,area:$("#ja-source-area").value.trim(),notes:$("#ja-source-notes").value.trim(),access_notes:$("#ja-source-access-notes").value.trim(),added_by:$("#ja-source-added-by").value.trim(),is_active:$("#ja-source-active").checked,last_checked_at:state.currentSource?.last_checked_at||null,last_useful_at:state.currentSource?.last_useful_at||null};}
  async function saveSource(){const message=$("[data-ja-source-message]");message.textContent="Enregistrement…";try{const path=state.currentSource?"/api/sources/"+state.currentSource.id:"/api/sources";const data=await api(path,{method:state.currentSource?"PATCH":"POST",body:JSON.stringify(sourcePayload())});message.textContent="";$("[data-ja-source-editor]").close();showToast(data.message);await loadSources();}catch(error){message.textContent=error.message;}}
  async function load() {
    const data=await api("/api/events"); state={...state,...data};
    setOptions("#ja-category_id",state.categories); setOptions("#ja-status_id",state.statuses);
    $("[data-ja-loading]").hidden=true; render();
  }
  function openEditor(id) {
    const event=state.events.find(item=>item.id===id); if(!event)return; state.current=event;
    $("[data-ja-form-title]").textContent=event.title;
    fields.forEach(name=>{const element=$("#ja-"+name);if(name==="featured")element.checked=!!event[name];else if(timestampFields.includes(name))element.value=toLocal(event[name]);else if(name==="recurrence_frequency")element.value=event[name]||"none";else element.value=event[name]??"";});
    updateRecurrenceFields();
    $("[data-ja-open-source]").href=event.source_url||"#"; $("[data-ja-open-source]").hidden=!event.source_url; $("[data-ja-form-message]").textContent=""; $("[data-ja-editor]").showModal();
  }
  function payload(){const data={};fields.forEach(name=>{const element=$("#ja-"+name);data[name]=name==="featured"?element.checked:timestampFields.includes(name)?toIso(element.value):element.value.trim();});if(data.recurrence_frequency==="none")data.recurrence_until=null;return data;}
  function updateRecurrenceFields(){const weekly=$("#ja-recurrence_frequency").value==="weekly";$("[data-ja-recurrence-until]").hidden=!weekly;$("#ja-recurrence_until").required=weekly;}
  async function save(){const message=$("[data-ja-form-message]");message.textContent="Enregistrement…";try{const data=await api("/api/events/"+state.current.id,{method:"PATCH",body:JSON.stringify(payload())});message.textContent="";$("[data-ja-editor]").close();showToast(data.message);await load();}catch(error){message.textContent=error.message;}}
  async function signIn(candidate){token=candidate;await load();if($("#ja-remember")?.checked)localStorage.setItem(TOKEN_KEY,token);else sessionStorage.setItem(TOKEN_KEY,token);$("[data-ja-login]").hidden=true;$("[data-ja-app]").hidden=false;capturePrefill().catch(error=>showToast(error.message));}

  $("[data-ja-login-form]").addEventListener("submit",async event=>{event.preventDefault();const message=$("[data-ja-login-message]");message.textContent="Connexion…";try{await signIn($("#ja-token").value);message.textContent="";}catch(error){token="";message.textContent="Code incorrect ou connexion impossible.";}});
  $("[data-ja-logout]").addEventListener("click",()=>{localStorage.removeItem(TOKEN_KEY);sessionStorage.removeItem(TOKEN_KEY);location.reload();});
  $("[data-ja-filters]").addEventListener("click",event=>{const button=event.target.closest("[data-filter]");if(button){state.filter=button.dataset.filter;render();}});
  root.querySelectorAll("[data-ja-section]").forEach(button=>button.addEventListener("click",()=>showSection(button.dataset.jaSection)));
  $("[data-ja-new-source]").addEventListener("click",()=>openSourceEditor());
  $("[data-ja-source-list]").addEventListener("click",event=>{const card=event.target.closest("[data-source-id]");if(card)openSourceEditor(card.dataset.sourceId);});
  $("[data-ja-source-close]").addEventListener("click",()=>$("[data-ja-source-editor]").close());
  $("[data-ja-source-form]").addEventListener("submit",event=>{event.preventDefault();saveSource();});
  $("[data-ja-list]").addEventListener("click",event=>{const card=event.target.closest("[data-id]");if(card)openEditor(card.dataset.id);});
  $("[data-ja-close]").addEventListener("click",()=>$("[data-ja-editor]").close());
  $("[data-ja-form]").addEventListener("submit",event=>{event.preventDefault();save();});
  $("#ja-source_url").addEventListener("input",event=>{$("[data-ja-open-source]").href=event.target.value||"#";$("[data-ja-open-source]").hidden=!event.target.value;});
  $("#ja-recurrence_frequency").addEventListener("change",updateRecurrenceFields);
  $("[data-ja-bookmarklet]").href="javascript:("+desktopCaptureBookmarklet.toString()+")()";
  $("[data-ja-archive]").addEventListener("click",()=>{const archived=state.statuses.find(item=>item.slug==="archived");if(archived){$("#ja-status_id").value=archived.id;save();}});
  if(token) signIn(token).catch(()=>{localStorage.removeItem(TOKEN_KEY);sessionStorage.removeItem(TOKEN_KEY);});
})();
</script>
