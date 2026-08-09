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
  const TOKEN_KEY = "jasmin_capture_token";
  const fields = ["title","description","start_at","end_at","recurrence_frequency","recurrence_until","expires_at","location_name","category_id","status_id","source_url","image_url","featured","editor_note"];
  const timestampFields = ["start_at","end_at","recurrence_until","expires_at"];
  let token = sessionStorage.getItem(TOKEN_KEY) || "";
  let state = { events: [], categories: [], statuses: [], filter: "draft", current: null };
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

  function setOptions(selector, items) { $(selector).innerHTML = items.map(item=>'<option value="'+item.id+'">'+escapeHtml(item.name)+'</option>').join(""); }
  function render() {
    const choices=[["draft","Brouillons"],["published","Publiés"],["archived","Archivés"],["all","Tous"]];
    $("[data-ja-filters]").innerHTML=choices.map(([slug,label])=>'<button type="button" class="ja-filter '+(state.filter===slug?'active':'')+'" data-filter="'+slug+'">'+label+' ('+(slug==="all"?state.events.length:state.events.filter(event=>status(event)===slug).length)+')</button>').join("");
    const items=state.events.filter(event=>state.filter==="all"||status(event)===state.filter);
    $("[data-ja-list]").innerHTML=items.length?items.map(event=>'<article class="ja-card" tabindex="0" data-id="'+event.id+'"><span class="ja-badge">'+escapeHtml(event.categories?.name||"Sans catégorie")+' · '+escapeHtml(event.statuses?.name||"")+'</span><h2>'+escapeHtml(event.title)+'</h2><p class="ja-meta">'+escapeHtml(dateLabel(event.start_at))+(event.location_name?' · '+escapeHtml(event.location_name):'')+'</p></article>').join(""):'<p>Aucun événement dans cette rubrique.</p>';
  }
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
  async function signIn(candidate){token=candidate;await load();sessionStorage.setItem(TOKEN_KEY,token);$("[data-ja-login]").hidden=true;$("[data-ja-app]").hidden=false;}

  $("[data-ja-login-form]").addEventListener("submit",async event=>{event.preventDefault();const message=$("[data-ja-login-message]");message.textContent="Connexion…";try{await signIn($("#ja-token").value);message.textContent="";}catch(error){token="";message.textContent="Code incorrect ou connexion impossible.";}});
  $("[data-ja-logout]").addEventListener("click",()=>{sessionStorage.removeItem(TOKEN_KEY);location.reload();});
  $("[data-ja-filters]").addEventListener("click",event=>{const button=event.target.closest("[data-filter]");if(button){state.filter=button.dataset.filter;render();}});
  $("[data-ja-list]").addEventListener("click",event=>{const card=event.target.closest("[data-id]");if(card)openEditor(card.dataset.id);});
  $("[data-ja-close]").addEventListener("click",()=>$("[data-ja-editor]").close());
  $("[data-ja-form]").addEventListener("submit",event=>{event.preventDefault();save();});
  $("#ja-source_url").addEventListener("input",event=>{$("[data-ja-open-source]").href=event.target.value||"#";$("[data-ja-open-source]").hidden=!event.target.value;});
  $("#ja-recurrence_frequency").addEventListener("change",updateRecurrenceFields);
  $("[data-ja-archive]").addEventListener("click",()=>{const archived=state.statuses.find(item=>item.slug==="archived");if(archived){$("#ja-status_id").value=archived.id;save();}});
  if(token) signIn(token).catch(()=>sessionStorage.removeItem(TOKEN_KEY));
})();
</script>
