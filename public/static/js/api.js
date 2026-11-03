// ============================================================================
// Utilitaires frontend communs : appels API, toasts, formatage, auth guard
// ============================================================================

const Api = {
  async request(method, path, body) {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include'
    }
    if (body !== undefined) opts.body = JSON.stringify(body)
    const res = await fetch(path, opts)
    let data = null
    try {
      data = await res.json()
    } catch {
      data = null
    }
    if (!res.ok) {
      const message = (data && data.error) || `Erreur ${res.status}`
      throw new Error(message)
    }
    return data
  },
  get(path) {
    return this.request('GET', path)
  },
  post(path, body) {
    return this.request('POST', path, body)
  },
  patch(path, body) {
    return this.request('PATCH', path, body)
  },
  put(path, body) {
    return this.request('PUT', path, body)
  },
  del(path) {
    return this.request('DELETE', path)
  }
}

function toast(message, type = 'info') {
  let container = document.getElementById('toast-container')
  if (!container) {
    container = document.createElement('div')
    container.id = 'toast-container'
    document.body.appendChild(container)
  }
  const el = document.createElement('div')
  el.className = `toast toast-${type}`
  el.textContent = message
  container.appendChild(el)
  setTimeout(() => el.remove(), 3500)
}

function fmtMoney(n, currency = 'CDF') {
  const num = Number(n || 0)
  return num.toLocaleString('fr-FR', { maximumFractionDigits: 2 }) + ' ' + currency
}

function fmtDate(dateStr) {
  if (!dateStr) return '—'
  const d = new Date(dateStr + (dateStr.length === 10 ? 'T00:00:00' : ''))
  if (isNaN(d.getTime())) return dateStr
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

function escapeHtml(str) {
  if (str === null || str === undefined) return ''
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Vérifie la session et redirige vers login si absente ; vérifie aussi le rôle attendu. */
async function guardAuth(expectedRoles) {
  try {
    const data = await Api.get('/api/auth/me')
    if (expectedRoles && !expectedRoles.includes(data.user.role)) {
      redirectByRole(data.user.role)
      return null
    }
    return data
  } catch (e) {
    window.location.href = '/static/index.html'
    return null
  }
}

function redirectByRole(role) {
  const map = {
    super_admin: '/static/superadmin.html',
    admin: '/static/admin.html',
    percepteur: '/static/percepteur.html',
    enseignant: '/static/enseignant.html',
    classe: '/static/classe.html'
  }
  window.location.href = map[role] || '/static/index.html'
}

async function doLogout() {
  try {
    await Api.post('/api/auth/logout')
  } catch {}
  window.location.href = '/static/index.html'
}

/* ----------------------------------------------------------------------------
   RECHERCHE GÉNÉRALE D'ÉLÈVES (percepteur + admin)
   Nécessite sur la page : showPayModal(), showStudentReceipts(), categoryBadge()
   et un <select> de trimestre dont l'id est passé en paramètre.
---------------------------------------------------------------------------- */
function setupStudentSearch({ inputId, resultsId, trimesterSelectId }) {
  const input = document.getElementById(inputId)
  const resultsBox = document.getElementById(resultsId)
  if (!input || !resultsBox) return
  let timer = null

  const hide = () => { resultsBox.classList.add('hidden'); resultsBox.innerHTML = '' }

  input.addEventListener('input', () => {
    clearTimeout(timer)
    const q = input.value.trim()
    if (q.length < 2) { hide(); return }
    timer = setTimeout(async () => {
      try {
        const { students } = await Api.get(`/api/perception/search-students?q=${encodeURIComponent(q)}`)
        if (!students.length) {
          resultsBox.innerHTML = '<div class="p-4 text-sm text-slate-400 text-center">Aucun élève trouvé</div>'
          resultsBox.classList.remove('hidden')
          return
        }
        const trimesterId = document.getElementById(trimesterSelectId)?.value || ''
        resultsBox.innerHTML = students.map(s => `
          <div class="search-result-item">
            <div class="min-w-0">
              <p class="font-semibold text-slate-800 text-sm truncate">${escapeHtml(s.nom)} ${escapeHtml(s.post_nom)} ${escapeHtml(s.prenom || '')}</p>
              <p class="text-xs text-slate-500">${escapeHtml(s.class_name)}${s.class_option ? ' — ' + escapeHtml(s.class_option) : ''} ${typeof categoryBadge === 'function' ? categoryBadge(s.categorie) : ''}</p>
            </div>
            <div class="flex gap-1.5 shrink-0">
              <button onclick="hideStudentSearch('${resultsId}'); showStudentReceipts(${s.id}, '${escapeHtml(s.nom)} ${escapeHtml(s.post_nom)}', ${trimesterId})" class="bg-slate-100 hover:bg-slate-200 text-slate-700 px-2.5 py-1.5 rounded text-xs font-semibold" title="Situation & reçus"><i class="fas fa-receipt"></i></button>
              <button onclick="hideStudentSearch('${resultsId}'); showPayModal(${s.id}, '${escapeHtml(s.nom)} ${escapeHtml(s.post_nom)}', ${trimesterId})" class="bg-green-600 hover:bg-green-700 text-white px-2.5 py-1.5 rounded text-xs font-semibold"><i class="fas fa-hand-holding-dollar mr-1"></i>Percevoir</button>
            </div>
          </div>`).join('')
        resultsBox.classList.remove('hidden')
      } catch (e) { hide() }
    }, 300)
  })

  // Fermer si clic en dehors
  document.addEventListener('click', (e) => {
    if (!input.contains(e.target) && !resultsBox.contains(e.target)) hide()
  })
}

function hideStudentSearch(resultsId) {
  const box = document.getElementById(resultsId)
  if (box) { box.classList.add('hidden'); box.innerHTML = '' }
}

/* ----------------------------------------------------------------------------
   Sidebar mobile (responsive) : injecte un topbar + overlay et gère l'ouverture.
   Appelé automatiquement au chargement si un <aside class="app-sidebar"> existe.
---------------------------------------------------------------------------- */
function setupMobileSidebar() {
  const sidebar = document.querySelector('aside.app-sidebar')
  if (!sidebar || document.getElementById('mobile-topbar')) return

  const title = document.title.split('—')[0].trim() || 'Menu'
  const topbar = document.createElement('div')
  topbar.id = 'mobile-topbar'
  topbar.innerHTML = `
    <div class="burger" id="sidebar-burger"><i class="fas fa-bars"></i></div>
    <span class="topbar-title">${escapeHtml(title)}</span>`
  document.body.prepend(topbar)

  const overlay = document.createElement('div')
  overlay.id = 'sidebar-overlay'
  document.body.appendChild(overlay)

  const close = () => { sidebar.classList.remove('open'); overlay.classList.remove('show') }
  const open = () => { sidebar.classList.add('open'); overlay.classList.add('show') }

  document.getElementById('sidebar-burger').addEventListener('click', () => {
    sidebar.classList.contains('open') ? close() : open()
  })
  overlay.addEventListener('click', close)
  // Fermer le tiroir quand on clique sur un lien de navigation
  sidebar.querySelectorAll('.nav-link').forEach(l => l.addEventListener('click', close))
}
document.addEventListener('DOMContentLoaded', setupMobileSidebar)

function openModal(html) {
  const overlay = document.createElement('div')
  overlay.className = 'modal-overlay'
  overlay.id = 'modal-overlay'
  overlay.innerHTML = `<div class="modal-box">${html}</div>`
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal()
  })
  document.body.appendChild(overlay)
}

function closeModal() {
  const overlay = document.getElementById('modal-overlay')
  if (overlay) overlay.remove()
}

// ---------------------------------------------------------------------------
// AUTO-REFRESH (synchronisation quasi temps réel) : rafraîchit les données
// à intervalle régulier tant que l'onglet du navigateur est visible, pour que
// l'école voie presque immédiatement ce que perçoit le percepteur (et vice
// versa) sans devoir recharger la page.
// ---------------------------------------------------------------------------
const AUTO_REFRESH_INTERVAL_MS = 30000 // 30 secondes (économise les lectures D1, reste quasi temps réel)
let _autoRefreshTimer = null
let _autoRefreshFn = null

function setAutoRefresh(fn) {
  _autoRefreshFn = fn
  if (_autoRefreshTimer) clearInterval(_autoRefreshTimer)
  if (!fn) { _autoRefreshTimer = null; return }
  _autoRefreshTimer = setInterval(async () => {
    // Ne rafraîchit pas si l'onglet n'est pas visible ou si un modal est ouvert
    // (pour ne pas écraser une saisie en cours)
    if (document.visibilityState !== 'visible') return
    if (document.getElementById('modal-overlay')) return
    try { await _autoRefreshFn() } catch (_) { /* silencieux */ }
  }, AUTO_REFRESH_INTERVAL_MS)
}

// Rafraîchir immédiatement quand l'utilisateur revient sur l'onglet
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && _autoRefreshFn && !document.getElementById('modal-overlay')) {
    _autoRefreshFn().catch(() => {})
  }
})

// ---------------------------------------------------------------------------
// Modal partagé : impression des reçus sur une PLAGE DE DATES (du … au …).
// opts: { title, subtitle, defaultFrom, defaultTo, onConfirm(dateFrom, dateTo) }
// ---------------------------------------------------------------------------
function showDateRangePrintModal(opts) {
  const today = todayStr()
  const from = opts.defaultFrom || today
  const to = opts.defaultTo || today
  openModal(`
    <div class="p-6">
      <h3 class="text-lg font-bold text-slate-800 mb-1"><i class="fas fa-print mr-2 text-slate-700"></i>${opts.title || 'Imprimer les reçus'}</h3>
      ${opts.subtitle ? `<p class="text-sm text-slate-500 mb-4">${opts.subtitle}</p>` : '<div class="mb-4"></div>'}
      <form id="range-print-form" class="space-y-3">
        <div class="grid grid-cols-2 gap-3">
          <div><label class="text-xs font-medium text-slate-600">Du *</label>
            <input type="date" id="rg-from" value="${from}" required class="w-full mt-1 px-3 py-2 border rounded-lg text-sm"></div>
          <div><label class="text-xs font-medium text-slate-600">Au *</label>
            <input type="date" id="rg-to" value="${to}" required class="w-full mt-1 px-3 py-2 border rounded-lg text-sm"></div>
        </div>
        <p class="text-xs text-slate-400"><i class="fas fa-info-circle mr-1"></i>Tous les reçus de la période seront ouverts dans une page d'impression (6 reçus par page A4). Pour un seul jour, mettez la même date dans les deux champs.</p>
        <div class="flex justify-end gap-2 pt-2">
          <button type="button" onclick="closeModal()" class="px-4 py-2 text-sm rounded-lg text-slate-600 hover:bg-slate-100">Annuler</button>
          <button type="submit" class="px-4 py-2 text-sm rounded-lg bg-slate-700 hover:bg-slate-800 text-white font-semibold"><i class="fas fa-print mr-1"></i>Imprimer</button>
        </div>
      </form>
    </div>`)
  document.getElementById('range-print-form').addEventListener('submit', (e) => {
    e.preventDefault()
    const dateFrom = document.getElementById('rg-from').value
    const dateTo = document.getElementById('rg-to').value
    if (!dateFrom || !dateTo) return toast('Les deux dates sont requises', 'error')
    if (dateFrom > dateTo) return toast('La date « Du » doit être antérieure ou égale à la date « Au »', 'error')
    closeModal()
    opts.onConfirm(dateFrom, dateTo)
  })
}
