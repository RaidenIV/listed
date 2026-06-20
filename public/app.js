/* Listed. — frontend app logic
   Talks to the Express API, renders listings, and drives the Sell / Save / Detail flows.
   The nav sliding-pill and heart micro-interaction are carried over from the prototype. */

(() => {
  'use strict';

  /* ── Anonymous visitor id (so saves persist per-browser without accounts) ── */
  const CLIENT_KEY = 'listed_client_id';
  let clientId = localStorage.getItem(CLIENT_KEY);
  if (!clientId) {
    clientId = (crypto.randomUUID && crypto.randomUUID()) ||
      'c_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem(CLIENT_KEY, clientId);
  }

  async function api(path, options = {}) {
    const res = await fetch(path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'x-client-id': clientId,
        ...(options.headers || {}),
      },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || 'Request failed.');
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  /* ── App state ── */
  const state = {
    view: 'explore',          // 'explore' | 'saved'
    category: 'all',
    location: 'Columbus, OH',
    q: '',
    sort: 'newest',
    user: null,
    profileComplete: false,
  };

  const CATEGORY_LABELS = {
    all: 'All', vehicles: 'Vehicles', apparel: 'Apparel', electronics: 'Electronics',
    free: 'Free', home: 'Home', tools: 'Tools', music: 'Music',
    office: 'Office supplies', pets: 'Pet supplies', toys: 'Toys & games',
  };

  /* ── DOM refs ── */
  const $ = (id) => document.getElementById(id);
  const gridMain = $('gridMain');
  const gridPreferred = $('gridPreferred');
  const gridPro = $('gridPro');
  const sectionPreferred = $('sectionPreferred');
  const sectionPro = $('sectionPro');
  const toolbarTitle = $('toolbarTitle');
  const toolbarSub = $('toolbarSub');

  /* ── Helpers ── */
  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const money = (n) =>
    Number(n) === 0 ? 'Free' : '$' + Number(n).toLocaleString('en-US');


  function avatarMarkup(profile = {}) {
    const url = String(profile.avatar_url || '').trim();
    return url
      ? `<img src="${esc(url)}" alt="Profile photo" onerror="this.parentElement.innerHTML='<i class=&quot;ti ti-user&quot;></i>'">`
      : '<i class="ti ti-user"></i>';
  }

  function syncUserAvatar() {
    const html = avatarMarkup(state.user?.profile || {});
    const navAvatar = $('navProfileAvatar');
    const modalAvatar = $('profileModalAvatar');
    if (navAvatar) navAvatar.innerHTML = html;
    if (modalAvatar) modalAvatar.innerHTML = html;
  }

  function cardHTML(l) {
    const proBadge = l.tier === 'pro'
      ? '<div class="l-vbadge-pro">Pro Seller</div>' : '';
    const heartCls = l.saved ? 'ti-heart-filled' : 'ti-heart';
    return `
      <div class="lcard" data-id="${esc(l.id)}">
        <div class="limg">
          <img src="${esc(l.image_url)}" alt="${esc(l.title)}" loading="lazy"
               onerror="this.src='https://images.unsplash.com/photo-1607082348824-0a96f2a4b9da?w=480&h=360&fit=crop&auto=format'">
          <div class="l-save" data-save="${esc(l.id)}" data-saved="${l.saved ? '1' : '0'}">
            <i class="ti ${heartCls}"></i>
          </div>
          ${proBadge}
        </div>
        <div class="linfo">
          <div class="lprice">${esc(money(l.price))}</div>
          <div class="ltitle">${esc(l.title)}</div>
          <div class="lloc"><i class="ti ti-map-pin"></i>${esc(l.location)}</div>
        </div>
      </div>`;
  }

  function skeletons(n = 8) {
    return Array.from({ length: n }).map(() => `
      <div class="skeleton">
        <div class="sk-img"></div>
        <div class="sk-line mid"></div>
        <div class="sk-line short"></div>
      </div>`).join('');
  }

  function stateBlock({ icon, title, text, actionLabel, actionId }) {
    const btn = actionLabel
      ? `<button class="state-action" id="${actionId}">${esc(actionLabel)}</button>` : '';
    return `<div class="state">
      <i class="ti ${icon}"></i>
      <h3>${esc(title)}</h3>
      <p>${esc(text)}</p>${btn}
    </div>`;
  }

  function queryString() {
    const p = new URLSearchParams();
    if (state.category && state.category !== 'all') p.set('category', state.category);
    if (state.location) p.set('location', state.location);
    if (state.q) p.set('q', state.q);
    if (state.sort) p.set('sort', state.sort);
    return p.toString() ? '?' + p.toString() : '';
  }

  /* ── Data loading + rendering ── */
  let loadToken = 0;

  async function load() {
    const token = ++loadToken;
    const isDefaultExplore =
      state.view === 'explore' && state.category === 'all' && !state.q;

    // Loading state
    sectionPreferred.hidden = true;
    sectionPro.hidden = true;
    gridMain.innerHTML = skeletons();
    toolbarSub.textContent = 'Loading listings…';

    try {
      const endpoint = state.view === 'saved' ? '/api/saved' : '/api/listings';
      const { listings } = await api(endpoint + queryString());
      if (token !== loadToken) return; // a newer request superseded this one

      const cityShort = state.location.split(',')[0];
      const catLabel = CATEGORY_LABELS[state.category] || 'All';

      if (state.view === 'saved') {
        toolbarTitle.innerHTML = `Saved <span>·</span> ${esc(cityShort)}`;
        renderFlat(listings, {
          icon: 'ti-heart',
          title: 'No saved listings yet',
          text: 'Tap the heart on any listing to keep it here for later.',
          actionLabel: 'Browse listings',
          actionId: 'emptyBrowse',
        });
        toolbarSub.textContent = `${listings.length} saved listing${listings.length === 1 ? '' : 's'}`;
      } else if (isDefaultExplore) {
        toolbarTitle.innerHTML = `All listings <span>·</span> ${esc(cityShort)}`;
        renderSectioned(listings);
        toolbarSub.textContent = `${listings.length} listing${listings.length === 1 ? '' : 's'} nearby`;
      } else {
        const titleLeft = state.q ? `Results for “${esc(state.q)}”` : `${esc(catLabel)} listings`;
        toolbarTitle.innerHTML = `${titleLeft} <span>·</span> ${esc(cityShort)}`;
        renderFlat(listings, {
          icon: 'ti-mood-empty',
          title: 'Nothing matches yet',
          text: state.q
            ? `No listings for “${state.q}” in ${cityShort}. Try a different search or location.`
            : `No ${catLabel.toLowerCase()} listings in ${cityShort} right now. Be the first to list one.`,
          actionLabel: 'List an item',
          actionId: 'emptySell',
        });
        toolbarSub.textContent = `${listings.length} result${listings.length === 1 ? '' : 's'}`;
      }
    } catch (err) {
      if (token !== loadToken) return;
      sectionPreferred.hidden = true;
      sectionPro.hidden = true;
      gridMain.innerHTML = stateBlock({
        icon: 'ti-cloud-off',
        title: 'Could not load listings',
        text: err.message + ' Check your connection and try again.',
        actionLabel: 'Retry',
        actionId: 'emptyRetry',
      });
      toolbarSub.textContent = 'Offline';
    }
  }

  function renderSectioned(listings) {
    const preferred = listings.filter((l) => l.tier === 'preferred');
    const pro = listings.filter((l) => l.tier === 'pro');
    const rest = listings.filter((l) => l.tier !== 'preferred' && l.tier !== 'pro');

    sectionPreferred.hidden = preferred.length === 0;
    sectionPro.hidden = pro.length === 0;
    gridPreferred.innerHTML = preferred.map(cardHTML).join('');
    gridPro.innerHTML = pro.map(cardHTML).join('');

    if (listings.length === 0) {
      gridMain.innerHTML = stateBlock({
        icon: 'ti-building-store',
        title: 'No listings here yet',
        text: `Nothing is listed in ${state.location.split(',')[0]} right now. List something to get things started.`,
        actionLabel: 'List an item',
        actionId: 'emptySell',
      });
    } else {
      gridMain.innerHTML = rest.map(cardHTML).join('');
    }
  }

  function renderFlat(listings, empty) {
    sectionPreferred.hidden = true;
    sectionPro.hidden = true;
    gridMain.innerHTML = listings.length
      ? listings.map(cardHTML).join('')
      : stateBlock(empty);
  }

  /* ── Save / unsave ── */
  async function toggleSave(id, el) {
    const icon = el.querySelector('.ti');
    try {
      const { saved } = await api(`/api/listings/${id}/save`, { method: 'POST' });
      el.dataset.saved = saved ? '1' : '0';
      icon.classList.toggle('ti-heart-filled', saved);
      icon.classList.toggle('ti-heart', !saved);
      el.animate(
        [{ transform: 'scale(1)' }, { transform: 'scale(1.35)' }, { transform: 'scale(1)' }],
        { duration: 200, easing: 'ease-out' }
      );
      // If we're on the Saved view and just unsaved, drop it from the list.
      if (state.view === 'saved' && !saved) {
        const card = el.closest('.lcard');
        if (card) card.remove();
      }
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  /* ── Listing detail ── */
  async function openDetail(id) {
    const overlay = $('detailOverlay');
    const body = $('detailBody');
    const img = $('detailImg');
    body.innerHTML = '<p style="color:var(--text-tertiary);font-size:13px">Loading…</p>';
    img.removeAttribute('src');
    overlay.classList.add('open');

    try {
      const { listing: l } = await api(`/api/listings/${id}`);
      $('detailTitle').textContent = l.title;
      img.src = l.image_url;
      img.alt = l.title;

      const tierBadge =
        l.tier === 'pro' ? '<span class="detail-tier pro">Pro Seller</span>'
        : l.tier === 'preferred' ? '<span class="detail-tier preferred">★ Preferred Seller</span>'
        : '';
      const desc = l.description
        ? `<div class="detail-desc">${esc(l.description)}</div>`
        : '';

      body.innerHTML = `
        <div class="detail-price">${esc(money(l.price))}</div>
        <div class="detail-title">${esc(l.title)}</div>
        <div class="detail-meta">
          <span><i class="ti ti-map-pin"></i>${esc(l.location)}</span>
          <span><i class="ti ti-user"></i>${esc(l.seller_name)}</span>
          <span><i class="ti ti-tag"></i>${esc(CATEGORY_LABELS[l.category] || l.category)}</span>
        </div>
        ${tierBadge}
        ${desc}
        <div class="detail-actions">
          <button class="btn btn-primary" id="detailMessage"><i class="ti ti-message"></i> Message seller</button>
          <button class="btn btn-ghost" id="detailSave" data-saved="${l.saved ? '1' : '0'}">
            <i class="ti ${l.saved ? 'ti-heart-filled' : 'ti-heart'}"></i> ${l.saved ? 'Saved' : 'Save'}
          </button>
        </div>`;

      $('detailMessage').addEventListener('click', () =>
        toast('Messaging is coming soon.', 'info'));

      $('detailSave').addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        try {
          const { saved } = await api(`/api/listings/${id}/save`, { method: 'POST' });
          btn.dataset.saved = saved ? '1' : '0';
          btn.innerHTML = `<i class="ti ${saved ? 'ti-heart-filled' : 'ti-heart'}"></i> ${saved ? 'Saved' : 'Save'}`;
          // keep the matching grid card in sync
          const gridSave = document.querySelector(`.l-save[data-save="${CSS.escape(id)}"]`);
          if (gridSave) {
            gridSave.dataset.saved = saved ? '1' : '0';
            const gi = gridSave.querySelector('.ti');
            gi.classList.toggle('ti-heart-filled', saved);
            gi.classList.toggle('ti-heart', !saved);
          }
          if (state.view === 'saved' && !saved) load();
        } catch (err) { toast(err.message, 'error'); }
      });
    } catch (err) {
      body.innerHTML = `<p style="color:#c0392b;font-size:14px">${esc(err.message)}</p>`;
    }
  }

  /* ── Toasts ── */
  function toast(message, kind = 'success') {
    const wrap = $('toastWrap');
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    const icon = kind === 'success' ? 'ti-circle-check'
      : kind === 'error' ? 'ti-alert-circle' : 'ti-info-circle';
    el.innerHTML = `<i class="ti ${icon}"></i>${esc(message)}`;
    wrap.appendChild(el);
    setTimeout(() => {
      el.style.transition = 'opacity .3s, transform .3s';
      el.style.opacity = '0';
      el.style.transform = 'translateY(8px)';
      setTimeout(() => el.remove(), 320);
    }, 2600);
  }

  /* ── Modals (open/close) ── */
  function openModal(which) { $(which + 'Overlay').classList.add('open'); }
  function closeModal(which) {
    if (which === 'profile' && !state.profileComplete) return;
    $(which + 'Overlay').classList.remove('open');
  }

  document.querySelectorAll('[data-close]').forEach((btn) =>
    btn.addEventListener('click', () => closeModal(btn.dataset.close)));

  ['sellOverlay', 'detailOverlay', 'profileOverlay'].forEach((id) =>
    $(id).addEventListener('click', (e) => {
      if (e.target.id === id && (id !== 'profileOverlay' || state.profileComplete)) e.target.classList.remove('open');
    }));

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal-overlay.open, .loc-modal-overlay.open')
        .forEach((m) => {
          if (m.id !== 'profileOverlay' || state.profileComplete) m.classList.remove('open');
        });
    }
  });

  /* ── Profile gate ── */
  function fillProfileForm(profile = {}) {
    $('p-display-name').value = profile.display_name || '';
    $('p-city').value = profile.city || state.location || 'Columbus, OH';
    $('p-avatar').value = profile.avatar_url || '';
    $('p-bio').value = profile.bio || '';
  }

  function openProfile({ required = false } = {}) {
    $('profileTitle').textContent = required ? 'Create your profile' : 'Your Profile';
    $('profileIntro').textContent = required
      ? 'Create a profile to access the marketplace.'
      : 'Update how you appear to buyers and sellers.';
    $('profileClose').hidden = required;
    $('profileLogout').hidden = false;
    $('profileEmail').textContent = state.user?.email ? `Verified email: ${state.user.email}` : '';
    $('profileEmail').hidden = !state.user?.email;
    $('profileError').hidden = true;
    fillProfileForm(state.user?.profile || {});
    syncUserAvatar();
    openModal('profile');
    setTimeout(() => $('p-display-name').focus(), 60);
  }

  async function saveProfile() {
    const btn = $('profileSubmit');
    const errBox = $('profileError');
    const payload = {
      display_name: $('p-display-name').value,
      city: $('p-city').value,
      avatar_url: $('p-avatar').value,
      bio: $('p-bio').value,
    };

    btn.disabled = true;
    btn.textContent = 'Saving…';
    errBox.hidden = true;
    try {
      const { user, profileEmail } = await api('/api/profile', {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      state.user = user;
      syncUserAvatar();
      state.profileComplete = !!user.profileComplete;
      state.location = user.profile?.city || state.location;
      syncUserAvatar();
      setLocBtn(state.location);
      markLocOption(state.location);
      $('profileOverlay').classList.remove('open');
      if (profileEmail?.sent) toast('Profile saved. Confirmation email sent.', 'success');
      else if (profileEmail?.dev) toast('Profile saved. Email is not configured for local development.', 'info');
      else toast('Profile saved.', 'success');
      await load();
    } catch (err) {
      errBox.textContent = err.message;
      errBox.hidden = false;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Save profile';
    }
  }

  async function logout() {
    try { await api('/api/auth/logout', { method: 'POST' }); }
    finally { location.href = '/login'; }
  }

  /* ── Sell flow ── */
  function openSell() {
    $('sellError').hidden = true;
    // default the city in the form to the current location
    const citySel = $('f-city');
    [...citySel.options].forEach((o) => { o.selected = o.value === state.location; });
    openModal('sell');
    setTimeout(() => $('f-title').focus(), 60);
  }

  async function submitSell() {
    const btn = $('sellSubmit');
    const errBox = $('sellError');
    const payload = {
      title: $('f-title').value,
      price: $('f-price').value === '' ? NaN : Number($('f-price').value),
      category: $('f-category').value,
      city: $('f-city').value,
      location: $('f-location').value,
      seller_name: $('f-seller').value || state.user?.profile?.display_name || '',
      image_url: $('f-image').value,
      description: $('f-desc').value,
    };

    btn.disabled = true;
    btn.textContent = 'Publishing…';
    errBox.hidden = true;
    try {
      const { listing } = await api('/api/listings', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      closeModal('sell');
      // reset form
      ['f-title', 'f-price', 'f-location', 'f-seller', 'f-image', 'f-desc']
        .forEach((id) => { $(id).value = ''; });
      toast('Your listing is live.', 'success');

      // Jump to where the new listing will appear and refresh.
      switchView('explore');
      state.category = 'all';
      state.q = '';
      $('searchInput').value = '';
      $('cats').querySelectorAll('.cat-pill').forEach((p) =>
        p.classList.toggle('active', p.dataset.cat === 'all'));
      state.location = listing.city;
      setLocBtn(listing.city);
      markLocOption(listing.city);
      await load();
    } catch (err) {
      errBox.textContent = err.message;
      errBox.hidden = false;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Publish listing';
    }
  }

  /* ── View switching ── */
  function switchView(view) {
    state.view = view;
    document.querySelectorAll('.nav-item[data-view]').forEach((n) =>
      n.classList.toggle('active', n.dataset.view === view));
    const active = document.querySelector('.nav-item.active');
    if (active) setNavHover(active);
  }

  /* ── Grid + global click delegation ── */
  document.querySelector('.main').addEventListener('click', (e) => {
    const saveBtn = e.target.closest('[data-save]');
    if (saveBtn) {
      e.stopPropagation();
      toggleSave(saveBtn.dataset.save, saveBtn);
      return;
    }
    const card = e.target.closest('.lcard');
    if (card) {
      openDetail(card.dataset.id);
      return;
    }
    const sell = e.target.closest('#emptySell');
    if (sell) { openSell(); return; }
    const browse = e.target.closest('#emptyBrowse');
    if (browse) { switchView('explore'); load(); return; }
    const retry = e.target.closest('#emptyRetry');
    if (retry) { load(); return; }
  });

  /* ── Category pills ── */
  $('cats').addEventListener('click', (e) => {
    const pill = e.target.closest('.cat-pill');
    if (!pill) return;
    $('cats').querySelectorAll('.cat-pill').forEach((p) => p.classList.remove('active'));
    pill.classList.add('active');
    state.category = pill.dataset.cat;
    load();
  });

  /* ── Search (debounced) ── */
  let searchTimer;
  $('searchInput').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    const val = e.target.value;
    searchTimer = setTimeout(() => {
      state.q = val.trim();
      load();
    }, 280);
  });

  /* ── Sort ── */
  $('sortSelect').addEventListener('change', (e) => {
    state.sort = e.target.value;
    load();
  });

  /* ── Sell buttons ── */
  $('sellBtn').addEventListener('click', openSell);
  $('sellSubmit').addEventListener('click', submitSell);
  $('profileSubmit').addEventListener('click', saveProfile);
  $('profileLogout').addEventListener('click', logout);

  /* ── Nav items: views, sell, "coming soon" stubs ── */
  document.querySelectorAll('.nav-item').forEach((link) => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      if (link.dataset.view) { switchView(link.dataset.view); load(); }
      else if (link.dataset.action === 'sell') openSell();
      else if (link.dataset.action === 'profile') openProfile();
      else if (link.dataset.action === 'logout') logout();
      else if (link.dataset.action === 'soon') toast(`${link.dataset.label} is coming soon.`, 'info');
    });
  });

  /* ── Location picker ── */
  const locBtn = $('locBtn');
  const locOverlay = $('locOverlay');

  function setLocBtn(loc) {
    locBtn.innerHTML = `<i class="ti ti-map-pin"></i><span>${esc(loc)}</span>`;
  }
  function markLocOption(loc) {
    document.querySelectorAll('.loc-option').forEach((o) =>
      o.classList.toggle('selected', o.dataset.loc === loc));
  }

  locBtn.addEventListener('click', () => locOverlay.classList.add('open'));
  locOverlay.addEventListener('click', (e) => {
    if (e.target === locOverlay) locOverlay.classList.remove('open');
  });
  document.querySelectorAll('.loc-option').forEach((opt) => {
    opt.addEventListener('click', () => {
      state.location = opt.dataset.loc;
      setLocBtn(state.location);
      markLocOption(state.location);
      locOverlay.classList.remove('open');
      load();
    });
  });

  /* ════ Nav sliding pill (carried over from the prototype) ════ */
  const navList = document.querySelector('.topnav-nav');
  const navLinks = [...document.querySelectorAll('.topnav-nav .nav-item')];
  const padX = 0, padY = 0;

  function setNavHover(link) {
    if (!navList || !link) return;
    const navRect = navList.getBoundingClientRect();
    const linkRect = link.getBoundingClientRect();
    navList.style.setProperty('--nav-hover-x', (linkRect.left - navRect.left - padX) + 'px');
    navList.style.setProperty('--nav-hover-y', (linkRect.top - navRect.top - padY) + 'px');
    navList.style.setProperty('--nav-hover-w', (linkRect.width + padX * 2) + 'px');
    navList.style.setProperty('--nav-hover-h', (linkRect.height + padY * 2) + 'px');
    navList.style.setProperty('--nav-hover-opacity', '1');
    navList.style.setProperty('--nav-hover-bg', link.classList.contains('nav-logout') ? 'rgba(217,45,32,0.12)' : 'var(--brand-light)');
  }
  window.setNavHover = setNavHover;

  let clearNavTimer = null;
  function clearNavHover() {
    clearTimeout(clearNavTimer);
    clearNavTimer = setTimeout(() => {
      const active = document.querySelector('.topnav-nav .nav-item.active');
      if (active) setNavHover(active);
    }, 800);
  }
  function cancelClearNav() { clearTimeout(clearNavTimer); }

  navLinks.forEach((link) => {
    link.addEventListener('pointerenter', () => { cancelClearNav(); setNavHover(link); });
    link.addEventListener('focus', () => { cancelClearNav(); setNavHover(link); });
  });
  if (navList) {
    navList.addEventListener('pointermove', (e) => {
      cancelClearNav();
      const link = e.target.closest('.nav-item');
      if (link && navList.contains(link)) setNavHover(link);
    });
    navList.addEventListener('pointerleave', clearNavHover);
    navList.addEventListener('focusout', (e) => {
      if (!navList.contains(e.relatedTarget)) clearNavHover();
    });
  }
  const defaultNav = document.querySelector('.topnav-nav .nav-item.active') || navLinks[0];
  if (defaultNav) setNavHover(defaultNav);
  window.addEventListener('resize', () => {
    const active = document.querySelector('.topnav-nav .nav-item.active') || defaultNav;
    if (active) setNavHover(active);
  });

  async function initApp() {
    try {
      const { user } = await api('/api/auth/me');
      if (!user) { location.href = '/login'; return; }
      state.user = user;
      syncUserAvatar();
      state.profileComplete = !!user.profileComplete;
      if (user.profile?.city) {
        state.location = user.profile.city;
        setLocBtn(state.location);
        markLocOption(state.location);
      }
      if (!state.profileComplete) {
        sectionPreferred.hidden = true;
        sectionPro.hidden = true;
        gridMain.innerHTML = '';
        toolbarSub.textContent = 'Profile required';
        openProfile({ required: true });
        return;
      }
      await load();
    } catch (err) {
      if (err.status === 401) location.href = '/login';
      else toast(err.message, 'error');
    }
  }

  /* ── Go ── */
  initApp();
})();
