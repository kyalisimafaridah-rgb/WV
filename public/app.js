/**
 * WiFi Voucher MVP — Frontend
 * Uses Supabase Auth for login/signup, then talks to our Fastify API with the JWT.
 */
const SUPABASE_URL = window.SUPABASE_URL || 'https://YOUR_PROJECT.supabase.co';
const SUPABASE_ANON_KEY = window.SUPABASE_ANON_KEY || 'YOUR_ANON_KEY';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let accessToken = null;
let currentOwner = null;
let routersCache = [];
let profilesCache = [];
let vouchersLimit = 50;
let sessionExpiredHandled = false;

// ---------- Helpers ----------
async function api(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;

  const res = await fetch(path, { ...options, headers });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }

  if (res.status === 401 && accessToken && !sessionExpiredHandled) {
    sessionExpiredHandled = true;
    await forceSessionExpired();
  }

  if (!res.ok) {
    const err = new Error(data?.message || data?.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

function show(el) { el.classList.remove('hidden'); }
function hide(el) { el.classList.add('hidden'); }
function $(id) { return document.getElementById(id); }

function setError(id, msg) {
  const el = $(id);
  if (!msg) { hide(el); el.textContent = ''; return; }
  el.textContent = msg;
  show(el);
}

function setBtnLoading(btn, loadingText) {
  if (!btn.dataset.originalText) btn.dataset.originalText = btn.textContent;
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span>${loadingText}`;
}
function resetBtn(btn) {
  btn.disabled = false;
  btn.textContent = btn.dataset.originalText || btn.textContent;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function hideAllScreens() {
  ['auth-screen', 'recovery-screen', 'expired-screen', 'dashboard', 'admin-screen'].forEach((id) => hide($(id)));
}

// ---------- Session expiry (mid-session token invalid/expired) ----------
async function forceSessionExpired() {
  await supabaseClient.auth.signOut();
  accessToken = null;
  currentOwner = null;
  hideAllScreens();
  show($('auth-screen'));
  showToast('Your session expired. Please log in again.', 'error');
  sessionExpiredHandled = false;
}

// ---------- Password visibility toggles ----------
document.querySelectorAll('.password-toggle').forEach((btn) => {
  btn.addEventListener('click', () => {
    const input = $(btn.dataset.toggleFor);
    if (!input) return;
    const isHidden = input.type === 'password';
    input.type = isHidden ? 'text' : 'password';
    btn.textContent = isHidden ? 'Hide' : 'Show';
  });
});

// ---------- Auth tab switching ----------
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    const isLogin = tab.dataset.tab === 'login';
    hide($('forgot-form'));
    $('login-form').classList.toggle('hidden', !isLogin);
    $('signup-form').classList.toggle('hidden', isLogin);
    setError('auth-error', null);
  });
});

$('forgot-password-link').addEventListener('click', () => {
  hide($('login-form'));
  hide($('signup-form'));
  show($('forgot-form'));
  setError('auth-error', null);
});
$('back-to-login-link').addEventListener('click', () => {
  hide($('forgot-form'));
  show($('login-form'));
  document.querySelector('.tab[data-tab="login"]').click();
});

// ---------- Auth ----------
async function handleLogin(e) {
  e.preventDefault();
  setError('auth-error', null);
  const email = $('login-email').value.trim();
  const password = $('login-password').value;
  const btn = $('login-submit-btn');

  setBtnLoading(btn, 'Logging in…');
  try {
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) {
      setError('auth-error', error.message);
      return;
    }
    accessToken = data.session.access_token;
    await enterDashboard();
  } finally {
    resetBtn(btn);
  }
}

async function handleSignup(e) {
  e.preventDefault();
  setError('auth-error', null);
  const email = $('signup-email').value.trim();
  const password = $('signup-password').value;
  const full_name = $('signup-name').value.trim();
  const btn = $('signup-submit-btn');

  setBtnLoading(btn, 'Creating account…');
  try {
    // Account creation goes through our backend (POST /auth/signup), which
    // creates the user pre-confirmed via the service-role key — this skips
    // Supabase's email confirmation step entirely rather than relying on
    // the dashboard "Confirm email" toggle. Signing in is then a normal
    // client-side call, same as the login form uses.
    try {
      await api('/auth/signup', {
        method: 'POST',
        body: JSON.stringify({ email, password, full_name: full_name || undefined }),
      });
    } catch (err) {
      if (err.status === 409) {
        setError('auth-error', 'This email is already registered — try logging in instead.');
        return;
      }
      setError('auth-error', err.data?.message || err.message || 'Signup failed');
      return;
    }

    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) {
      setError('auth-error', error.message);
      return;
    }

    accessToken = data.session.access_token;
    if (full_name) {
      try { await api('/me', { method: 'PATCH', body: JSON.stringify({ full_name }) }); } catch {}
    }
    await enterDashboard();
  } finally {
    resetBtn(btn);
  }
}

async function handleForgotPassword(e) {
  e.preventDefault();
  const email = $('forgot-email').value.trim();
  const btn = $('forgot-submit-btn');
  setBtnLoading(btn, 'Sending…');
  try {
    const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + '/index.html',
    });
    if (error) {
      showToast(error.message, 'error');
      return;
    }
    showToast('If that email has an account, a reset link was sent.', 'success', 6000);
    $('back-to-login-link').click();
  } finally {
    resetBtn(btn);
  }
}

async function handleRecoverySubmit(e) {
  e.preventDefault();
  setError('recovery-error', null);
  const password = $('recovery-password').value;
  const btn = $('recovery-submit-btn');

  setBtnLoading(btn, 'Updating…');
  try {
    const { error } = await supabaseClient.auth.updateUser({ password });
    if (error) {
      setError('recovery-error', error.message);
      return;
    }
    showToast('Password updated. You are now logged in.', 'success');
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session) {
      accessToken = session.access_token;
      await enterDashboard();
    } else {
      hideAllScreens();
      show($('auth-screen'));
    }
  } finally {
    resetBtn(btn);
  }
}

function isSubscriptionExpired(owner) {
  if (!owner) return false;
  if (owner.subscription_status === 'expired') return true;
  if (owner.subscription_status === 'trial' && owner.trial_ends_at) {
    return new Date(owner.trial_ends_at).getTime() < Date.now();
  }
  return false;
}

function renderTrialBanner(owner) {
  const el = $('trial-banner');
  el.innerHTML = '';
  if (owner.subscription_status !== 'trial' || !owner.trial_ends_at) return;

  const msRemaining = new Date(owner.trial_ends_at).getTime() - Date.now();
  const daysRemaining = Math.ceil(msRemaining / (1000 * 60 * 60 * 24));
  if (daysRemaining > 3) return;

  const div = document.createElement('div');
  div.className = 'banner warning';
  div.textContent = daysRemaining <= 1
    ? 'Your free trial ends today. Contact the app owner to keep access to your routers and vouchers.'
    : `Your free trial ends in ${daysRemaining} days. Contact the app owner to activate your subscription.`;
  el.appendChild(div);
}

async function enterDashboard() {
  let owner;
  try {
    const res = await api('/me');
    owner = res.owner;
    currentOwner = owner;
  } catch (err) {
    setError('auth-error', err.message);
    return;
  }

  hideAllScreens();

  // Admin accounts always land on the admin panel, regardless of their own
  // personal subscription status — admin access is not tied to being a paying owner.
  if (owner.role === 'admin') {
    await showAdminScreen();
    return;
  }

  if (isSubscriptionExpired(owner)) {
    show($('expired-screen'));
    return;
  }

  await showOwnerDashboard(owner);
}

async function showOwnerDashboard(owner) {
  hideAllScreens();
  show($('dashboard'));
  $('owner-email').textContent = owner.email;

  const badge = $('sub-badge');
  badge.textContent = owner.subscription_status;
  badge.className = 'badge ' + owner.subscription_status;

  $('admin-panel-btn').classList.toggle('hidden', owner.role !== 'admin');

  renderTrialBanner(owner);

  try {
    await loadRouters();
  } catch (err) {
    handleDashboardLoadError(err, 'routers-list', 'routers');
  }
  try {
    await loadProfiles();
  } catch (err) {
    handleDashboardLoadError(err, 'profiles-list', 'profiles');
  }
  try {
    await loadVouchers();
  } catch (err) {
    handleDashboardLoadError(err, 'vouchers-list', 'vouchers');
  }
  fillProfileSelect();
  updatePrerequisiteHints();
}

function handleDashboardLoadError(err, listElId, label) {
  if (err.status === 403) {
    // Subscription flipped to expired mid-session — refresh to expired screen
    enterDashboard();
    return;
  }
  const list = $(listElId);
  list.innerHTML = `<p class="hint">Could not load ${label}: ${escapeHtml(err.message)}</p>`;
  showToast(`Failed to load ${label}: ${err.message}`, 'error');
}

// ---------- Admin panel (only reachable when the logged-in account has role=admin) ----------
function renderAdminStats(stats) {
  const grid = $('admin-stats-grid');
  grid.innerHTML = '';
  const items = [
    ['Owners', stats.owners],
    ['Routers', stats.routers],
    ['Vouchers', stats.vouchers],
    ['Active vouchers', stats.active_vouchers],
  ];
  for (const [label, value] of items) {
    const el = document.createElement('div');
    el.className = 'stat-card';
    el.innerHTML = `<div class="stat-value">${value}</div><div class="stat-label">${label}</div>`;
    grid.appendChild(el);
  }
}

function renderAdminOwners(owners) {
  const body = $('admin-owners-body');
  body.innerHTML = '';

  if (!owners.length) {
    body.innerHTML = '<tr><td colspan="5" class="hint">No owners yet.</td></tr>';
    return;
  }

  for (const owner of owners) {
    const tr = document.createElement('tr');
    const trialEnds = owner.trial_ends_at ? new Date(owner.trial_ends_at).toLocaleDateString() : '—';
    tr.innerHTML = `
      <td>${escapeHtml(owner.email)}</td>
      <td>${escapeHtml(owner.full_name) || '—'}</td>
      <td><span class="badge ${owner.subscription_status}">${owner.subscription_status}</span></td>
      <td>${trialEnds}</td>
      <td></td>
    `;
    const actionCell = tr.querySelector('td:last-child');
    const select = document.createElement('select');
    ['trial', 'active', 'expired'].forEach((status) => {
      const opt = document.createElement('option');
      opt.value = status;
      opt.textContent = status;
      if (status === owner.subscription_status) opt.selected = true;
      select.appendChild(opt);
    });
    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn small';
    saveBtn.textContent = 'Save';
    saveBtn.addEventListener('click', async () => {
      setBtnLoading(saveBtn, 'Saving…');
      try {
        await api(`/admin/owners/${owner.id}/subscription`, {
          method: 'PATCH',
          body: JSON.stringify({ status: select.value }),
        });
        showToast(`Updated ${owner.email} to ${select.value}.`, 'success');
        await loadAdminData();
      } catch (err) {
        showToast(err.message, 'error');
        resetBtn(saveBtn);
      }
    });
    actionCell.appendChild(select);
    actionCell.appendChild(saveBtn);
    body.appendChild(tr);
  }
}

function renderAdminRouters(routers) {
  const body = $('admin-routers-body');
  body.innerHTML = '';

  if (!routers.length) {
    body.innerHTML = '<tr><td colspan="4" class="hint">No routers yet.</td></tr>';
    return;
  }

  for (const router of routers) {
    const tr = document.createElement('tr');
    const ownerLabel = router.owners ? (router.owners.full_name || router.owners.email) : '—';
    tr.innerHTML = `
      <td>${escapeHtml(router.label)}</td>
      <td>${escapeHtml(router.host)}</td>
      <td>${escapeHtml(ownerLabel)}</td>
      <td><span class="status-dot ${router.status}"></span>${router.status}</td>
    `;
    body.appendChild(tr);
  }
}

async function loadAdminData() {
  setError('admin-dash-error', null);
  try {
    const [stats, ownersRes, routersRes] = await Promise.all([
      api('/admin/stats'),
      api('/admin/owners'),
      api('/admin/routers'),
    ]);
    renderAdminStats(stats);
    renderAdminOwners(ownersRes.owners);
    renderAdminRouters(routersRes.routers);
  } catch (err) {
    setError('admin-dash-error', err.message);
    showToast('Failed to load admin dashboard: ' + err.message, 'error');
  }
}

async function showAdminScreen() {
  hideAllScreens();
  show($('admin-screen'));
  $('admin-email-display').textContent = currentOwner.email;
  await loadAdminData();
}

async function logout() {
  await supabaseClient.auth.signOut();
  accessToken = null;
  currentOwner = null;
  hideAllScreens();
  show($('auth-screen'));
}

// ---------- Routers ----------
async function loadRouters() {
  const { routers } = await api('/routers');
  routersCache = routers || [];
  const list = $('routers-list');
  list.innerHTML = '';

  if (!routersCache.length) {
    list.innerHTML = '<p class="hint">No routers yet. Add your first MikroTik.</p>';
    return;
  }

  for (const r of routersCache) {
    const div = document.createElement('div');
    div.className = 'list-item';
    const lastSeen = r.last_connected_at
      ? new Date(r.last_connected_at).toLocaleString()
      : 'Never';
    div.innerHTML = `
      <div>
        <strong><span class="status-dot ${r.status}"></span>${escapeHtml(r.label)}</strong>
        <div class="meta">${escapeHtml(r.host)}:${r.api_port} · ${r.status} · Last seen: ${lastSeen}</div>
      </div>
      <div class="actions">
        <button class="btn small" data-retest="${r.id}">Re-test</button>
        <button class="btn small" data-sync-vouchers="${r.id}">Sync voucher status</button>
        <button class="btn small danger" data-del-router="${r.id}">Delete</button>
      </div>
    `;
    list.appendChild(div);
  }
}

function validateRouterForm() {
  const host = $('r-host').value.trim();
  const user = $('r-user').value.trim();
  const pass = $('r-pass').value;
  if (!host || !user || !pass) {
    $('router-test-result').textContent = 'Fill in host, username, and password first.';
    $('router-test-result').className = 'hint error';
    return false;
  }
  return true;
}

async function testRouterCredentials() {
  if (!validateRouterForm()) return;

  const body = {
    label: $('r-label').value.trim() || 'test',
    host: $('r-host').value.trim(),
    api_port: Number($('r-port').value) || 8728,
    api_username: $('r-user').value.trim(),
    api_password: $('r-pass').value,
  };
  const resultEl = $('router-test-result');
  const testBtn = $('test-router-btn');
  setBtnLoading(testBtn, 'Testing…');
  resultEl.textContent = 'Testing connection…';
  resultEl.className = 'hint';

  try {
    const res = await api('/routers/test', { method: 'POST', body: JSON.stringify(body) });
    resultEl.textContent = `✅ Connected — ${res.router.identity} (RouterOS ${res.router.version})`;
    resultEl.className = 'hint success-msg';
  } catch (err) {
    resultEl.textContent = `❌ ${err.message}`;
    resultEl.className = 'hint error';
  } finally {
    resetBtn(testBtn);
  }
}

async function saveRouter(e) {
  e.preventDefault();
  if (!validateRouterForm()) return;

  const body = {
    label: $('r-label').value.trim(),
    host: $('r-host').value.trim(),
    api_port: Number($('r-port').value) || 8728,
    api_username: $('r-user').value.trim(),
    api_password: $('r-pass').value,
  };
  const resultEl = $('router-test-result');
  const saveBtn = $('save-router-btn');
  setBtnLoading(saveBtn, 'Connecting & saving…');
  resultEl.textContent = '';

  try {
    await api('/routers', { method: 'POST', body: JSON.stringify(body) });
    hide($('modal-router'));
    $('router-form').reset();
    resultEl.textContent = '';
    showToast('Router connected and saved.', 'success');
    await loadRouters();
    await loadProfiles();
    updatePrerequisiteHints();
  } catch (err) {
    resultEl.textContent = `❌ ${err.message}`;
    resultEl.className = 'hint error';
  } finally {
    resetBtn(saveBtn);
  }
}

// ---------- Profiles ----------
async function loadProfiles() {
  const { profiles } = await api('/profiles');
  profilesCache = profiles || [];
  const list = $('profiles-list');
  list.innerHTML = '';

  if (!profilesCache.length) {
    list.innerHTML = '<p class="hint">No profiles yet. Create packages like “1 Hour” or “500MB”.</p>';
    return;
  }

  for (const p of profilesCache) {
    const limits = [];
    if (p.duration_minutes) limits.push(`${p.duration_minutes} min`);
    if (p.data_limit_mb) limits.push(`${p.data_limit_mb} MB`);
    const router = routersCache.find((r) => r.id === p.router_id);

    const div = document.createElement('div');
    div.className = 'list-item';
    div.innerHTML = `
      <div>
        <strong>${escapeHtml(p.name)}</strong>
        <div class="meta">${limits.join(' · ') || 'No limits'} · ${p.price} ${escapeHtml(p.currency)}
          ${p.code_prefix ? ' · prefix: ' + escapeHtml(p.code_prefix) : ''}
          ${router ? ' · ' + escapeHtml(router.label) : ''}
        </div>
      </div>
      <button class="btn small danger" data-del-profile="${p.id}">Deactivate</button>
    `;
    list.appendChild(div);
  }
}

function fillProfileSelect() {
  const sel = $('gen-profile');
  const pSel = $('p-router');
  sel.innerHTML = '';
  pSel.innerHTML = '';

  for (const r of routersCache) {
    const opt = document.createElement('option');
    opt.value = r.id;
    opt.textContent = r.label;
    pSel.appendChild(opt);
  }

  for (const p of profilesCache) {
    const router = routersCache.find((r) => r.id === p.router_id);
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = `${p.name} (${router ? router.label : 'router'})`;
    sel.appendChild(opt);
  }
}

function updatePrerequisiteHints() {
  const hasRouters = routersCache.length > 0;
  const hasProfiles = profilesCache.length > 0;

  $('add-profile-btn').disabled = !hasRouters;
  $('profiles-empty-hint').classList.toggle('hidden', hasRouters);

  $('generate-btn').disabled = !hasProfiles;
  $('gen-profile').disabled = !hasProfiles;
  $('vouchers-empty-hint').classList.toggle('hidden', hasProfiles);
}

async function saveProfile(e) {
  e.preventDefault();
  const duration = $('p-duration').value ? Number($('p-duration').value) : null;
  const dataMb = $('p-data').value ? Number($('p-data').value) : null;

  if (!duration && !dataMb) {
    showToast('Set at least a duration or a data limit.', 'error');
    return;
  }
  if (!$('p-router').value) {
    showToast('Add a router first — profiles need one.', 'error');
    return;
  }

  const body = {
    router_id: $('p-router').value,
    name: $('p-name').value.trim(),
    duration_minutes: duration,
    data_limit_mb: dataMb,
    price: Number($('p-price').value) || 0,
    currency: $('p-currency').value.trim() || 'UGX',
    code_prefix: $('p-prefix').value.trim(),
  };

  const btn = $('save-profile-btn');
  setBtnLoading(btn, 'Saving…');
  try {
    await api('/profiles', { method: 'POST', body: JSON.stringify(body) });
    hide($('modal-profile'));
    $('profile-form').reset();
    showToast('Profile created.', 'success');
    await loadProfiles();
    fillProfileSelect();
    updatePrerequisiteHints();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    resetBtn(btn);
  }
}

// ---------- Vouchers ----------
async function loadVouchers(limit) {
  vouchersLimit = limit || vouchersLimit;
  const { vouchers } = await api(`/vouchers?limit=${vouchersLimit}`);
  const list = $('vouchers-list');
  list.innerHTML = '';

  if (!vouchers?.length) {
    list.innerHTML = '<p class="hint">No vouchers generated yet.</p>';
    hide($('load-more-vouchers'));
    return;
  }

  for (const v of vouchers) {
    const div = document.createElement('div');
    div.className = 'list-item';
    const profileName = v.profiles?.name ? escapeHtml(v.profiles.name) : '';
    div.innerHTML = `
      <div>
        <strong style="font-family:monospace">${escapeHtml(v.code)}</strong>
        <div class="meta">${v.status}${profileName ? ' · ' + profileName : ''} · ${new Date(v.created_at).toLocaleString()}</div>
      </div>
    `;
    list.appendChild(div);
  }

  const moreBtn = $('load-more-vouchers');
  if (vouchers.length >= vouchersLimit) {
    show(moreBtn);
  } else {
    hide(moreBtn);
  }
}

async function generateVouchers() {
  const profile_id = $('gen-profile').value;
  const quantity = Number($('gen-qty').value) || 1;
  if (!profile_id) {
    showToast('Create a profile first.', 'error');
    return;
  }

  const btn = $('generate-btn');
  setBtnLoading(btn, 'Connecting to router…');

  const result = $('gen-result');
  hide(result);

  try {
    const res = await api('/vouchers/generate', {
      method: 'POST',
      body: JSON.stringify({ profile_id, quantity }),
    });

    show(result);
    result.innerHTML = `
      <div class="card" style="margin-top:1rem">
        <p class="success-msg"><strong>${escapeHtml(res.message)}</strong></p>
        <div class="code-grid">
          ${(res.vouchers || []).map((v) => `<div class="code-chip">${escapeHtml(v.code)}</div>`).join('')}
        </div>
        ${res.partialFailures?.length ? `<p class="hint" style="margin-top:0.75rem">Some failed: ${res.partialFailures.length}</p>` : ''}
      </div>
    `;
    showToast(res.message, 'success');
    vouchersLimit = 50;
    await loadVouchers();
  } catch (err) {
    show(result);
    result.innerHTML = `
      <div class="card" style="margin-top:1rem">
        <p class="error"><strong>${escapeHtml(err.data?.error || 'Failed')}</strong></p>
        <p>${escapeHtml(err.message)}</p>
        ${err.data?.hint ? `<p class="hint">${escapeHtml(err.data.hint)}</p>` : ''}
      </div>
    `;
  } finally {
    resetBtn(btn);
  }
}

function exportVouchers(format) {
  fetch(`/vouchers/export?format=${format}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
    .then((r) => {
      if (!r.ok) throw new Error('Export failed');
      return r.blob();
    })
    .then((blob) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = format === 'csv' ? 'vouchers.csv' : 'vouchers.txt';
      a.click();
      URL.revokeObjectURL(a.href);
    })
    .catch((e) => showToast('Export failed: ' + e.message, 'error'));
}

/**
 * Print / PDF — opens a clean printable sheet of recent unused vouchers.
 * User can then "Save as PDF" from the browser print dialog.
 */
async function exportPdf() {
  try {
    const res = await api('/vouchers?limit=200');
    const vouchers = (res.vouchers || []).filter((v) => v.status === 'unused');

    if (vouchers.length === 0) {
      showToast('No unused vouchers to print.', 'info');
      return;
    }

    let printArea = document.getElementById('print-area');
    if (!printArea) {
      printArea = document.createElement('div');
      printArea.id = 'print-area';
      document.body.appendChild(printArea);
    }

    const cards = vouchers
      .map(
        (v) => `
      <div class="voucher-card">
        <div style="font-size:1.4rem;font-weight:bold;letter-spacing:2px">${escapeHtml(v.code)}</div>
        <div style="margin-top:0.35rem;font-size:0.9rem">
          ${escapeHtml(v.profiles?.name || 'Package')}
          ${v.status ? ' · ' + v.status : ''}
        </div>
      </div>`
      )
      .join('');

    printArea.innerHTML = `
      <h2 style="margin-bottom:1rem">WiFi Vouchers — ${new Date().toLocaleDateString()}</h2>
      <p style="margin-bottom:1rem;font-size:0.9rem">${vouchers.length} unused code(s)</p>
      ${cards}
    `;

    window.print();
  } catch (err) {
    showToast('Could not prepare print: ' + (err.message || err), 'error');
  }
}

// ---------- Events ----------
$('login-form').addEventListener('submit', handleLogin);
$('signup-form').addEventListener('submit', handleSignup);
$('forgot-form').addEventListener('submit', handleForgotPassword);
$('recovery-form').addEventListener('submit', handleRecoverySubmit);
$('logout-btn').addEventListener('click', logout);
$('expired-logout-btn').addEventListener('click', logout);
$('admin-logout-btn').addEventListener('click', logout);

$('admin-panel-btn').addEventListener('click', showAdminScreen);
$('switch-to-owner-btn').addEventListener('click', () => showOwnerDashboard(currentOwner));

document.querySelectorAll('.nav-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.panel').forEach((p) => hide(p));
    show($('panel-' + btn.dataset.panel));
  });
});

$('add-router-btn').addEventListener('click', () => {
  $('router-form').reset();
  $('router-test-result').textContent = '';
  show($('modal-router'));
});
$('cancel-router').addEventListener('click', () => hide($('modal-router')));
$('test-router-btn').addEventListener('click', testRouterCredentials);
$('router-form').addEventListener('submit', saveRouter);

$('add-profile-btn').addEventListener('click', () => {
  if ($('add-profile-btn').disabled) return;
  fillProfileSelect();
  $('profile-form').reset();
  show($('modal-profile'));
});
$('cancel-profile').addEventListener('click', () => hide($('modal-profile')));
$('profile-form').addEventListener('submit', saveProfile);

$('generate-btn').addEventListener('click', generateVouchers);
$('export-txt').addEventListener('click', () => exportVouchers('text'));
$('export-csv').addEventListener('click', () => exportVouchers('csv'));
$('export-pdf').addEventListener('click', exportPdf);
$('load-more-vouchers').addEventListener('click', async () => {
  const btn = $('load-more-vouchers');
  setBtnLoading(btn, 'Loading…');
  try {
    await loadVouchers(vouchersLimit + 50);
  } finally {
    resetBtn(btn);
  }
});

// Delegation for dynamic buttons
document.addEventListener('click', async (e) => {
  const retest = e.target.closest('[data-retest]');
  if (retest) {
    const id = retest.dataset.retest;
    retest.disabled = true;
    retest.textContent = 'Testing…';
    try {
      const res = await api(`/routers/${id}/retest`, { method: 'POST' });
      showToast('✅ ' + res.message + (res.router?.identity ? ` — ${res.router.identity}` : ''), 'success');
    } catch (err) {
      showToast('❌ ' + err.message, 'error');
    }
    retest.disabled = false;
    retest.textContent = 'Re-test';
    await loadRouters();
  }

  const syncV = e.target.closest('[data-sync-vouchers]');
  if (syncV) {
    const id = syncV.dataset.syncVouchers;
    syncV.disabled = true;
    syncV.textContent = 'Syncing…';
    try {
      const res = await api(`/vouchers/sync?router_id=${id}`, { method: 'POST' });
      showToast(res.message + (res.updated ? ` — ${res.updated} updated` : ''), 'success');
      await loadVouchers();
    } catch (err) {
      showToast('❌ ' + err.message, 'error');
    }
    syncV.disabled = false;
    syncV.textContent = 'Sync voucher status';
  }

  const delR = e.target.closest('[data-del-router]');
  if (delR && confirm('Delete this router and its profiles/vouchers?')) {
    try {
      await api(`/routers/${delR.dataset.delRouter}`, { method: 'DELETE' });
      showToast('Router deleted.', 'success');
      await loadRouters();
      await loadProfiles();
      fillProfileSelect();
      updatePrerequisiteHints();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  const delP = e.target.closest('[data-del-profile]');
  if (delP && confirm('Deactivate this profile?')) {
    try {
      await api(`/profiles/${delP.dataset.delProfile}`, { method: 'DELETE' });
      showToast('Profile deactivated.', 'success');
      await loadProfiles();
      fillProfileSelect();
      updatePrerequisiteHints();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }
});

// ---------- Init ----------
supabaseClient.auth.onAuthStateChange((event) => {
  if (event === 'PASSWORD_RECOVERY') {
    hideAllScreens();
    show($('recovery-screen'));
  }
});

// ---------- PWA install support ----------
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
      // Non-fatal — app still works fully as a normal web page without it
    });
  });
}

(async () => {
  // If this page load is a password-recovery link, show that screen immediately
  if (window.location.hash.includes('type=recovery')) {
    hideAllScreens();
    show($('recovery-screen'));
    return;
  }

  const { data: { session } } = await supabaseClient.auth.getSession();
  if (session) {
    accessToken = session.access_token;
    await enterDashboard();
  }
})();
