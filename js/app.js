const endpoint = 'https://graphql.anilist.co';
    const els = {
      form: document.getElementById('search-form'),
      q: document.getElementById('q'),
      status: document.getElementById('status'),
      results: document.getElementById('results'),
      rosterToggle: document.getElementById('rosterToggle')
    };

    // Powell roster list (normalized for case/spacing)
    const ROSTER = [
      "Aaron Roberts","Amanda Gish","Barbara Goodson","Barry Yandell","Bill Butts","Brian Beacock",
      "Brian Mathis","Brianna Roberts","Bryan Massey","Bryn Apprill","Cedric Williams","Chris Cason",
      "Chris Patton","Cristina Vee","Daman Mills","Dani Chambers","Dave Trosko","Elise Baughman",
      "Emi Lo","Emily J. Fajardo","Emily Fajardo","Greg Dulcie","Howard Wang","Jessica Cavanagh","Jim Foronda",
      "John Gremillion","Johnny Yong Bosch","Kara Edwards","Krystal LaPorte","Lauren Landa","Leah Clark",
      "Lee Quick","Lex Lang","Linda Young","Lisa Ortiz","Lisette Monique Diaz","Macy Anne Johnson","Major Attaway",
      "Marcus D. Stimac","Marcus M. Mauldin","Marisa Lenti","Meredith McCoy","Morgan Berry","Natalie Rose",
      "Oscar Seung","R. Bruce Elliott","Risa Mei","Sandy Fox","Stephanie Young","Tiffany Vollmer",
      "Tom Laflin","Tyson Rinehart","Veronica Laux","Wendee Lee","Wendy Powell","Zac Loera","Branden Loera","Spencer Liles"
    ];
    const _norm = s => (s||'').toLowerCase().replace(/\s+/g,' ').trim();
    const ROSTER_SET = new Set(ROSTER.map(_norm));

    // Remember last state so we can re-render on toggle
    let last = { media: null, pageInfo: null, edges: [], pagesFetched: 0, fetchedAll: false };

    // GraphQL
    const QUERY_LIST = `query ($search: String, $page: Int){
      Page(page: $page, perPage: 12){
        pageInfo{ currentPage hasNextPage }
        media(search: $search, type: ANIME, sort: POPULARITY_DESC){
          id
          title{ romaji english }
          coverImage{ large }
        }
      }
    }`;

    const QUERY_CAST = `query ($id: Int, $page: Int){
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

    // ARIA busy helper
    function setBusy(el, busy){
      el.setAttribute('aria-busy', busy ? 'true' : 'false');
    }

    // Search
  els.form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const search = (els.q.value || '').trim();
      if(!search){ return; }
      els.status.textContent = 'Loading…';
      setBusy(els.results, true);
      els.results.innerHTML = '';
  // retryBtn removed
      try{
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify({ query: QUERY_LIST, variables: { search, page: 1 } })
        });
        const json = await res.json();
        if(!res.ok || json.errors){ throw new Error((json.errors?.[0]?.message) || (res.status + ' ' + res.statusText)); }
        const items = json.data.Page?.media || [];
        els.results.innerHTML = items.map(m => `
          <div class="col-12 col-sm-6 col-lg-3">
            <div class="card h-100">
              <img class="cover" src="${m.coverImage?.large || ''}" alt="${(m.title?.english || m.title?.romaji || 'Series') + ' cover image'}">
              <div class="card-body d-flex flex-column">
                <h2 class="h5 mb-3">${m.title?.english || m.title?.romaji || 'Series'}</h2>
                <button class="btn btn-primary mt-auto js-cast-btn" data-id="${m.id}" aria-label="Show English cast for ${m.title?.english || m.title?.romaji || 'this series'}">Show English Cast</button>
              </div>
            </div>
          </div>
        `).join('') || '<p>No matching series.</p>';
        els.status.textContent = `${items.length} result(s)`;
      }catch(err){
        els.results.innerHTML = `<div class="alert alert-danger" role="alert">Error: ${err.message || err}</div>`;
        els.status.textContent = 'Error';
  // retryBtn removed
      } finally {
        setBusy(els.results, false);
      }
  // retryBtn removed
    });

    // Event delegation (buttons inside results)
    document.addEventListener('click', async (ev) => {
      const castBtn = ev.target.closest('.js-cast-btn');
      if(castBtn){
        const id = parseInt(castBtn.dataset.id, 10);
        if(Number.isInteger(id)) await loadCastFor(id, 1);
        return;
      }

      const copyBtn = ev.target.closest('#copy-roster');
      if(copyBtn){
        // Collect visible rows (actor — character [MAIN])
        const items = [...els.results.querySelectorAll('ul.list-group li')]
          .map(li => li.innerText.trim())
          .filter(Boolean)
          .join('\n');
        if(items){
          navigator.clipboard.writeText(items)
            .then(() => { els.status.textContent = 'Copied roster matches to clipboard.'; })
            .catch(() => { els.status.textContent = 'Failed to copy.'; });
        }else{
          els.status.textContent = 'Nothing to copy.';
        }
        return;
      }

      const prevBtn = ev.target.closest('#cast-prev');
      const nextBtn = ev.target.closest('#cast-next');
      if(prevBtn && last.media && last.pageInfo){
        await loadCastFor(last.media.id, last.pageInfo.currentPage - 1);
        return;
      }
      if(nextBtn && last.media && last.pageInfo){
        await loadCastFor(last.media.id, last.pageInfo.currentPage + 1);
        return;
      }
      const backBtn = ev.target.closest('#back');
      if(backBtn){
        els.form.dispatchEvent(new Event('submit')); // back to results
      }
    });

    // Toggle behavior
    els.rosterToggle.addEventListener('change', async () => {
      if(!last.media) return;
      if(els.rosterToggle.checked && !last.fetchedAll){
        await loadAllCastPages(last.media.id);
        return;
      }
      renderCast(last.media, last.edges, last.pageInfo, { singlePage: els.rosterToggle.checked });
    });

    // Fetch helpers
    async function fetchCastPage(id, page){
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ query: QUERY_CAST, variables: { id, page } })
      });
      const json = await res.json();
      if(!res.ok || json.errors){ throw new Error((json.errors?.[0]?.message) || (res.status + ' ' + res.statusText)); }
      const media = json.data.Media;
      const pageInfo = media.characters?.pageInfo || { currentPage: page, hasNextPage: false };
      const edges = media.characters?.edges || [];
      return { media, pageInfo, edges };
    }

    async function loadCastFor(id, page=1){
      els.status.textContent = 'Loading cast…';
      setBusy(els.results, true);
      try{
        if(els.rosterToggle.checked){
          await loadAllCastPages(id); // single-page roster
        }else{
          const { media, pageInfo, edges } = await fetchCastPage(id, page);
          last = { media, pageInfo, edges, pagesFetched: 1, fetchedAll: !pageInfo.hasNextPage };
          renderCast(media, edges, pageInfo, { singlePage: false });
        }
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
        let page = 1;
        let allEdges = [];
        let media = null;
        let pageInfo = { currentPage: 1, hasNextPage: false };
        const MAX_PAGES = 40; // safety cap

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

    // Render (badge only for MAIN roles; mains first)
    function renderCast(media, edges, pageInfo, opts){
      const singlePage = !!opts?.singlePage;
      const title = media.title?.english || media.title?.romaji || 'Series';

      const rows = [];
      edges.forEach(e => {
        const char = e.node?.name?.full || 'Unknown Character';
        const role = e.role || ''; // "MAIN" or "SUPPORTING"
        (e.voiceActors || []).forEach(v => {
          const name = v.name?.full || 'Unknown Actor';
          if(els.rosterToggle.checked && !ROSTER_SET.has(_norm(name))) return;
          const url = v.siteUrl || ('https://anilist.co/staff/' + v.id);
          rows.push({ actor: name, char, role, url });
        });
      });

      // Sort: MAIN roles first (grouped), then alphabetical; within each group, sort by actor
      rows.sort((a, b) => {
        const ar = a.role === 'MAIN' ? 0 : 1;
        const br = b.role === 'MAIN' ? 0 : 1;
        if (ar !== br) return ar - br;
        return a.actor.localeCompare(b.actor, undefined, { sensitivity: 'base' });
      });

      const list = rows.map((r) => `
        <li class="list-group-item d-flex align-items-center">
          <div class="flex-fill">
            <a class="link-primary" href="${r.url}" target="_blank" rel="noopener">${r.actor}</a>
            <span> — ${r.char}</span>
            ${r.role === 'MAIN' ? ` <span class="badge badge-variant ms-1" aria-label="Main role">MAIN</span>` : ''}
          </div>
        </li>
      `).join('') || '<li class="list-group-item">No matches. Try turning off the roster filter or pick a different series.</li>';

      const filterBadge = els.rosterToggle.checked
        ? (singlePage ? 'Powell Talent Roster only (all pages)' : 'Powell Talent Roster only')
        : 'All actors';

      els.results.innerHTML = `
        <div class="col-12">
          <div class="card" aria-label="Cast list card">
            <div class="card-body">
              <div class="d-flex align-items-center gap-3 mb-3">
                <img class="cover" src="${media.coverImage?.large || ''}" alt="Cover image for ${title}" style="max-width:120px;" />
                <div>
                  <h2 class="h4 mb-1">${title}</h2>
                  <div class="small">
                    English Voice Cast <span class="badge badge-variant ms-1">${filterBadge}</span>
                  </div>
                </div>
              </div>

              <h3 class="h6 mb-2">
                ${els.rosterToggle.checked ? 'Powell roster matches' : 'English cast'}
                <span class="visually-hidden">—</span>
                <small class="text-secondary">(${rows.length})</small>
              </h3>

              <ul class="list-group" aria-label="English cast list">${list}</ul>

              <div class="mt-3 d-flex gap-2 flex-wrap">
                <button class="btn btn-outline-secondary" id="copy-roster" type="button" aria-label="Copy visible roster matches as text">Copy Roster Matches</button>
                <button class="btn btn-outline-secondary" id="back" type="button">Back to results</button>
                ${
                  singlePage
                  ? ''
                  : `
                    <button class="btn btn-outline-secondary" id="cast-prev" type="button" ${pageInfo.currentPage>1?'':'disabled'} aria-disabled="${!(pageInfo.currentPage>1)}">Prev</button>
                    <button class="btn btn-outline-secondary" id="cast-next" type="button" ${pageInfo.hasNextPage?'':'disabled'} aria-disabled="${!pageInfo.hasNextPage}">Next</button>
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