/* ===== AniList endpoint ===== */
const endpoint = 'https://graphql.anilist.co';

/* ===== Element refs (both flows) ===== */
const els = {
  // Series -> Cast
  form: document.getElementById('search-form'),
  q: document.getElementById('q'),
  status: document.getElementById('status'),
  results: document.getElementById('results'),
  rosterToggle: document.getElementById('rosterToggle'),

  // Roles by Actor (controls section + results panel)
  actorSelect: document.getElementById('actor-select'),
  actorRun: document.getElementById('actor-run'),
  actorCopy: document.getElementById('actor-copy'),     // external Copy button (in controls)
  actorClear: document.getElementById('actor-clear'),   // NEW: Clear button (in controls)
  actorRoles: document.getElementById('actor-roles')
};

/* ===== Powell Talent roster (sample; extend freely) ===== */
const ROSTER = [
  "Aaron Roberts","Amanda Gish","Barbara Goodson","Barry Yandell","Bill Butts","Brian Beacock",
  "Brian Mathis","Brianna Roberts","Bryan Massey","Bryn Apprill","Cedric Williams","Chris Cason",
  "Chris Patton","Cristina Vee","Daman Mills","Dani Chambers","Dave Trosko","Elise Baughman",
  "Emi Lo","Emily Fajardo","Greg Dulcie","Howard Wang","Jessica Cavanagh","Jim Foronda",
  "John Gremillion","Johnny Yong Bosch","Kara Edwards","Krystal LaPorte","Lauren Landa","Leah Clark",
  "Linda Young","Lisa Ortiz","Marcus M. Mauldin","Marcus Stimac","Marisa Lenti","Macy Anne Johnson",
  "Major Attaway","Meredith McCoy","Morgan Berry","R Bruce Elliott","Sandy Fox","Shawn Gann",
  "Stephanie Young","Tyler Walker","Veronica Laux","Wendee Lee","Cynthia Cranz","Risa Mei",
  "Oscar Seung","Tom Laflin","Spencer Liles","Lee Quick","Tiffany Vollmer","Chris Cason","Wendy Powell","Lisette Diaz","Zac Loera","Branden Loera"
].sort((a,b)=>a.localeCompare(b, undefined, {sensitivity:'base'}));

/* ===== State for series->cast pagination ===== */
let last = { media: null, pageInfo: null, edges: [], pagesFetched: 0, fetchedAll: false };

/* ===== GraphQL queries ===== */
// 1) Search by series title
const QUERY_LIST = `
query ($search: String, $page: Int){
  Page(page: $page, perPage: 12){
    pageInfo{ currentPage hasNextPage }
    media(search: $search, type: ANIME, sort: POPULARITY_DESC){
      id
      title{ romaji english }
      coverImage{ large }
    }
  }
}`;

// 2) English cast for a Media (characters + voice actors in ENGLISH)
const QUERY_CAST = `
query ($id: Int, $page: Int){
  Media(id: $id){
    id
    title{ romaji english }
    coverImage{ large }
    characters(page: $page, perPage: 50){
      pageInfo{ currentPage hasNextPage }
      edges{
        role
        node{ id name{ full } }
        voiceActors(language: ENGLISH){ id name{ full } siteUrl }
      }
    }
  }
}`;

// 3) Staff (voice actor) -> roles (ANIME only)
// NOTE: no "type:" argument here; we filter by node.type === 'ANIME' in JS.
const QUERY_STAFF_ROLES = `
query ($search: String, $page: Int){
  Staff(search: $search){
    id
    siteUrl
    name{ full }
    characterMedia(page: $page, perPage: 50, sort: START_DATE_DESC){
      pageInfo{ currentPage hasNextPage }
      edges{
        node{ id type title{ english romaji } }
        characters{ id name{ full } }
      }
    }
  }
}`;

/* ===== Utilities ===== */
function setBusy(el, busy){ if(el) el.setAttribute('aria-busy', busy ? 'true' : 'false'); }
function seriesTitle(m){ return m?.title?.english || m?.title?.romaji || 'Series'; }
function byRosterOnly(name){
  return ROSTER.some(r => r.localeCompare(name, undefined, {sensitivity:'base'}) === 0);
}
function copyText(text){
  if(navigator.clipboard && window.isSecureContext){
    return navigator.clipboard.writeText(text);
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch(e){}
  document.body.removeChild(ta);
  return ok ? Promise.resolve() : Promise.reject(new Error('Clipboard not available'));
}

/* =========================================================================
   Series -> English Cast flow
   ========================================================================= */
if (els.form && els.q && els.results && els.status) {

  // Submit: search series
  els.form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const search = (els.q.value || '').trim();
    if(!search){ return; }
    els.status.textContent = 'Loading…';
    setBusy(els.results, true);
    els.results.innerHTML = '';

    try{
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ query: QUERY_LIST, variables: { search, page: 1 } })
      });
      const json = await res.json();
      if(!res.ok || json.errors){
        throw new Error((json.errors?.[0]?.message) || (res.status + ' ' + res.statusText));
      }

      const items = json.data.Page?.media || [];
      els.results.innerHTML = items.map(m => `
        <div class="col-12 col-sm-6 col-lg-3">
          <div class="card h-100">
            <img class="cover" src="${m.coverImage?.large || ''}"
                 alt="${seriesTitle(m)} cover image">
            <div class="card-body d-flex flex-column">
              <h2 class="h5 mb-3">${seriesTitle(m)}</h2>
              <button class="btn btn-primary mt-auto js-cast-btn"
                      type="button"
                      data-id="${m.id}"
                      data-title="${seriesTitle(m)}"
                      aria-label="Show the English cast for ${seriesTitle(m)}">
                Show English Cast
              </button>
            </div>
          </div>
        </div>
      `).join('') || '<p>No matching series.</p>';

      els.status.textContent = `${items.length} result(s)`;
    }catch(err){
      els.results.innerHTML = `<div class="alert alert-danger" role="alert">Error: ${err.message || err}</div>`;
      els.status.textContent = 'Error';
    } finally {
      setBusy(els.results, false);
    }
  });

  // Event delegation for result buttons (Show English Cast / pagination / copy / back / show-all)
  document.addEventListener('click', async (ev) => {
    const castBtn = ev.target.closest('.js-cast-btn');
    const prevBtn = ev.target.id === 'prev';
    const nextBtn = ev.target.id === 'next';
    const backBtn = ev.target.id === 'back';
    const copyRosterBtn = ev.target.id === 'copy-roster';
    const showAllBtn = ev.target.id === 'show-all-roster';

    // Back to search results
    if(backBtn){
      els.results.innerHTML = last.searchHTML || '';
      els.status.textContent = last.searchStatus || 'Idle';
      return;
    }

    // Copy visible roster matches
    if(copyRosterBtn){
      const items = [...document.querySelectorAll('#cast-list li .va')].map(el => el.textContent.trim()).filter(Boolean);
      const text = items.join('\n');
      if(!text){
        els.status.textContent = 'Nothing to copy.';
        return;
      }
      copyText(text)
        .then(()=> els.status.textContent = 'Copied roster matches to clipboard.')
        .catch(()=> els.status.textContent = 'Failed to copy.');
      return;
    }

    // Show all roster matches (across all character pages)
    if(showAllBtn && last.media?.id){
      await loadAllCastPages(last.media.id);
      return;
    }

    // Pagination
    if(prevBtn && last.media?.id){
      await fetchAndRenderCast(last.media.id, Math.max(1, (last.pageInfo?.currentPage || 1) - 1));
      return;
    }
    if(nextBtn && last.media?.id){
      await fetchAndRenderCast(last.media.id, (last.pageInfo?.currentPage || 1) + 1);
      return;
    }

    // Show English Cast for a series
    if(castBtn){
      const id = Number(castBtn.getAttribute('data-id'));
      const title = castBtn.getAttribute('data-title');
      // stash current results for "Back"
      last.searchHTML = els.results.innerHTML;
      last.searchStatus = els.status.textContent;
      await fetchAndRenderCast(id, 1, title);
    }
  });

  async function fetchCastPage(id, page){
    const res = await fetch(endpoint, {
      method:'POST',
      headers: { 'Content-Type':'application/json', 'Accept':'application/json' },
      body: JSON.stringify({ query: QUERY_CAST, variables: { id, page } })
    });
    const json = await res.json();
    if(!res.ok || json.errors){ throw new Error((json.errors?.[0]?.message) || (res.status + ' ' + res.statusText)); }
    const media = json.data?.Media || null;
    const info = media?.characters?.pageInfo || { currentPage: page, hasNextPage: false };
    const edges = media?.characters?.edges || [];
    return { media, pageInfo: info, edges };
  }

  async function fetchAndRenderCast(id, page = 1, forceTitle){
    els.status.textContent = 'Loading cast…';
    setBusy(els.results, true);
    try{
      const pack = await fetchCastPage(id, page);
      last = { media: pack.media, pageInfo: pack.pageInfo, edges: pack.edges, pagesFetched: 1, fetchedAll: false };
      renderCast(pack.media, pack.edges, pack.pageInfo, { titleOverride: forceTitle, singlePage: false });
    }catch(err){
      els.results.innerHTML = `<div class="alert alert-danger" role="alert">Error: ${err.message || err}</div>`;
      els.status.textContent = 'Error';
    } finally {
      setBusy(els.results, false);
    }
  }

  async function loadAllCastPages(id){
    els.status.textContent = 'Loading all pages for roster…';
    setBusy(els.results, true);
    try{
      const MAX_PAGES = 40;
      let page = 1;
      let allEdges = [];
      let media = null;
      let pageInfo = { currentPage: 1, hasNextPage: false };

      do {
        const pack = await fetchCastPage(id, page);
        if(!media) media = pack.media;
        pageInfo = pack.pageInfo;
        allEdges = allEdges.concat(pack.edges || []);
        page += 1;
        if(page > MAX_PAGES) break;
      } while(pageInfo.hasNextPage);

      last = { media, pageInfo: { currentPage: 1, hasNextPage: false }, edges: allEdges, pagesFetched: page-1, fetchedAll: true };
      renderCast(media, allEdges, last.pageInfo, { singlePage: true });
    }catch(err){
      els.results.innerHTML = `<div class="alert alert-danger" role="alert">Error: ${err.message || err}</div>`;
      els.status.textContent = 'Error';
    } finally {
      setBusy(els.results, false);
    }
  }

  function renderCast(media, edges, pageInfo, { titleOverride = null, singlePage = false } = {}){
    const title = titleOverride || seriesTitle(media);
    const rowsRaw = (edges || []).flatMap(e => {
      const charName = e?.node?.name?.full || '';
      const vas = e?.voiceActors || [];
      return vas.map(va => ({
        va: va?.name?.full || '',
        vaUrl: va?.siteUrl || '',
        character: charName
      }));
    });

    const rows = (els.rosterToggle && els.rosterToggle.checked)
      ? rowsRaw.filter(r => byRosterOnly(r.va))
      : rowsRaw;

    const list = rows.map(r => `
      <li class="list-group-item d-flex align-items-start">
        <span class="va fw-semibold">${r.va}</span>
        <span class="ms-2" style="font-size:.8rem; padding-top:3px;">as ${r.character}</span>
        ${r.vaUrl ? `<a class="ms-auto small" href="${r.vaUrl}" target="_blank" rel="noopener">AniList</a>` : ``}
      </li>
    `).join('') || '<li class="list-group-item">No matching entries.</li>';

    els.results.innerHTML = `
      <div class="col-12">
        <div class="card">
          <div class="card-body">
            <div class="d-flex gap-3 align-items-start flex-wrap">
              <img class="cover" src="${media?.coverImage?.large || ''}" alt="${title} cover image" style="max-width:120px">
              <div class="flex-grow-1">
                <h2 class="h5 mb-2">${title}</h2>
                <div class="small text-secondary">${singlePage ? 'All roster matches combined' : `Page ${pageInfo.currentPage}`}</div>
              </div>
            </div>

            <hr class="my-3"/>

            <h3 class="h6 mb-2">
              ${els.rosterToggle && els.rosterToggle.checked ? 'Powell roster matches' : 'English cast'}
              <span class="visually-hidden">—</span>
              <small class="text-secondary">(${rows.length})</small>
            </h3>

            <ul id="cast-list" class="list-group" aria-label="English cast list">${list}</ul>

            <div class="mt-3 d-flex gap-2 flex-wrap">
              <button class="btn btn-outline-secondary" id="copy-roster" type="button" aria-label="Copy visible roster matches as text">Copy Roster Matches</button>
              <button class="btn btn-outline-secondary" id="back" type="button">Back to results</button>
              ${ singlePage
                  ? ''
                  : `
                    <button class="btn btn-outline-secondary" id="prev" type="button" ${!(pageInfo.currentPage>1) ? 'disabled' : ''} aria-disabled="${!(pageInfo.currentPage>1)}">Prev</button>
                    <button class="btn btn-outline-secondary" id="next" type="button" ${!pageInfo.hasNextPage ? 'disabled' : ''} aria-disabled="${!pageInfo.hasNextPage}">Next</button>
                    ${ els.rosterToggle && els.rosterToggle.checked ? `<button class="btn btn-outline-secondary" id="show-all-roster" type="button">Show All Roster Matches</button>` : '' }
                  `
                }
            </div>
          </div>
        </div>
      </div>
    `;

    els.status.textContent = singlePage
      ? `Cast · ${rows.length} roster match(es) (all pages combined)`
      : `Cast · Page ${pageInfo.currentPage} · ${rows.length} entry(ies)`;
  }
}

/* =========================================================================
   Roles by Actor flow
   ========================================================================= */
if (els.actorSelect && els.actorRun && els.actorCopy && els.actorRoles) {

  // Populate select
  (function initActorSelect(){
    const frag = document.createDocumentFragment();
    const opt0 = document.createElement('option');
    opt0.value = '';
    opt0.textContent = '— Select an actor —';
    frag.appendChild(opt0);

    ROSTER.forEach(name => {
      const o = document.createElement('option');
      o.value = name;
      o.textContent = name;
      frag.appendChild(o);
    });
    els.actorSelect.innerHTML = '';
    els.actorSelect.appendChild(frag);

    // initial disabled states
    els.actorRun.disabled = true;
    els.actorCopy.disabled = true;
  })();

  // Helper: full reset for the Roles by Actor UI
  function resetActorUI() {
    els.actorRoles.innerHTML = '';
    els.status.textContent = 'Ready.';
    els.actorSelect.value = '';
    els.actorRun.disabled = true;
    if (els.actorCopy) els.actorCopy.disabled = true;
  }

  // Enable/disable Run button on selection change
  els.actorSelect.addEventListener('change', ()=>{
    els.actorRun.disabled = !els.actorSelect.value;
  });

  // Clear button: full reset without opening a list
  if (els.actorClear) {
    els.actorClear.addEventListener('click', resetActorUI);
  }

  // Fetch roles when Run is clicked
  els.actorRun.addEventListener('click', async ()=>{
    const actorName = els.actorSelect.value;
    if(!actorName){ return; }
    els.status.textContent = `Loading roles for “${actorName}”…`;
    setBusy(els.actorRoles, true);
    els.actorRoles.innerHTML = '';

    try{
      const { roles, staffUrl, notFound } = await fetchActorRoles(actorName);
      renderActorRoles(actorName, roles, { staffUrl, notFound });
      els.status.textContent = notFound
        ? `No AniList Staff found for “${actorName}”.`
        : `Loaded ${roles.length} role(s) for “${actorName}”.`;
      els.actorCopy.disabled = !!notFound;
    }catch(err){
      els.actorRoles.innerHTML = `<div class="alert alert-danger" role="alert">Error: ${err.message || err}</div>`;
      els.status.textContent = 'Error';
      els.actorCopy.disabled = true;
    } finally {
      setBusy(els.actorRoles, false);
    }
  });

  // External Copy button (in controls)
  if (els.actorCopy) {
    els.actorCopy.addEventListener('click', async ()=>{
      const lines = [...document.querySelectorAll('#actor-roles-list li')]
        .map(li => li.innerText.trim())
        .filter(Boolean)
        .join('\n');

      if(!lines){
        els.status.textContent = 'Nothing to copy.';
        return;
      }
      try{
        await copyText(lines);
        els.status.textContent = 'Copied actor roles to clipboard.';
      }catch{
        els.status.textContent = 'Failed to copy.';
      }
    });
  }

  // In-card Back and Copy (event delegation; avoids duplicate IDs with external Copy)
  els.actorRoles.addEventListener('click', async (e)=>{
    if (e.target && e.target.id === 'actor-back') {
      resetActorUI();
      return;
    }

    if (e.target && e.target.id === 'actor-copy-in-card') {
      const lines = [...document.querySelectorAll('#actor-roles-list li')]
        .map(li => li.innerText.trim())
        .filter(Boolean)
        .join('\n');

      if(!lines){
        els.status.textContent = 'Nothing to copy.';
        return;
      }
      try{
        await copyText(lines);
        els.status.textContent = 'Copied actor roles to clipboard.';
      }catch{
        els.status.textContent = 'Failed to copy.';
      }
    }
  });

  async function fetchActorRoles(actorName){
    let page = 1;
    let roles = [];
    let staffUrl = '';
    let pageInfo = { currentPage: 1, hasNextPage: false };

    const MAX_PAGES = 60;

    do {
      const res = await fetch(endpoint, {
        method:'POST',
        headers: { 'Content-Type':'application/json', 'Accept':'application/json' },
        body: JSON.stringify({ query: QUERY_STAFF_ROLES, variables: { search: actorName, page } })
      });
      const json = await res.json();
      if(!res.ok || json.errors){ throw new Error((json.errors?.[0]?.message) || (res.status + ' ' + res.statusText)); }

      const staff = json.data?.Staff || null;
      if(!staff){
        return { roles: [], staffUrl: '', notFound: true };
      }
      if(!staffUrl) staffUrl = staff.siteUrl || '';

      pageInfo = staff.characterMedia?.pageInfo || { currentPage: page, hasNextPage: false };
      const edges = staff.characterMedia?.edges || [];

      // Filter to ANIME (client-side) and flatten
      const part = edges
        .filter(e => (e?.node?.type === 'ANIME'))
        .flatMap(e => {
          const series = e?.node?.title?.english || e?.node?.title?.romaji || 'Unknown';
          const chars = e?.characters || [];
          return (chars.length ? chars : [null]).map(c => ({
            series,
            character: c?.name?.full || '—'
          }));
        });

      roles = roles.concat(part);
      page += 1;
      if(page > MAX_PAGES) break;
    } while(pageInfo.hasNextPage);

    // De-dupe “Series|Character”
    const seen = new Set();
    roles = roles.filter(r => {
      const key = (r.series + '|' + r.character).toLowerCase();
      if(seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Sort by Series, then Character
    roles.sort((a,b)=>{
      const s = a.series.localeCompare(b.series, undefined, {sensitivity:'base'});
      return s !== 0 ? s : a.character.localeCompare(b.character, undefined, {sensitivity:'base'});
    });

    return { roles, staffUrl, notFound: false };
  }

  function renderActorRoles(actorName, roles, { staffUrl = '', notFound = false } = {}){
    if(notFound){
      els.actorRoles.innerHTML = `
        <div class="alert alert-warning" role="alert">
          Couldn’t find “${actorName}” on AniList. Try an alternate spelling or another roster entry.
        </div>`;
      return;
    }

    const count = roles.length;
    const list = roles.map(r => `
      <li class="list-group-item d-flex">
        <span class="fw-semibold flex-shrink-0">${r.series}</span>
        <span class="ms-2" style="font-size:.8rem; padding-top:3px;">as ${r.character}</span>
      </li>
    `).join('') || '<li class="list-group-item">No roles found.</li>';

    els.actorRoles.innerHTML = `
      <div class="card">
        <div class="card-body">
          <h3 class="h6 mb-2">
            Roles for ${ staffUrl
              ? `<a href="${staffUrl}" target="_blank" rel="noopener">${actorName}</a>`
              : actorName }
            <small class="text-secondary">(${count})</small>
          </h3>
          <ul id="actor-roles-list" class="list-group" aria-label="Roles list for ${actorName}">${list}</ul>
        </div>
        <div class="card-footer d-flex gap-2">
          <button class="btn btn-outline-secondary" id="actor-copy-in-card" type="button">Copy Roles</button>
          <button class="btn btn-outline-secondary" id="actor-back" type="button">Back</button>
        </div>
      </div>
    `;

    // Enable external Copy (if present)
    els.actorCopy && (els.actorCopy.disabled = false);
  }
}

/* ===== Defensive init logging (helps if IDs change) ===== */
(function sanityCheck(){
  const okSeries = (els.form && els.q && els.results && els.status);
  const okActor = (els.actorSelect && els.actorRun && els.actorCopy && els.actorRoles);
  if(!okSeries){
    console.warn('[Series->Cast] UI not found: require #search-form, #q, #results, #status');
  }
  if(!okActor){
    const someActorBits = ['actorSelect','actorRun','actorCopy','actorRoles'].some(k => !!els[k]);
    if(someActorBits){
      console.warn('[Roles by Actor] UI incomplete: require #actor-select, #actor-run, #actor-copy, #actor-roles');
    }
  }
})();