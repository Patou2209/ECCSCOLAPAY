// ============================================================================
// Logique frontend de l'espace ADMIN ECOLE
// ============================================================================
let currentUser = null
let currentSchool = null
let schoolYears = []
let trimesters = []
let classesCache = []

async function init() {
  const data = await guardAuth(['admin'])
  if (!data) return
  currentUser = data.user
  currentSchool = data.school
  document.getElementById('user-info').innerHTML = `<i class="fas fa-user-circle mr-1"></i>${escapeHtml(data.user.name)}`
  document.getElementById('school-name-label').textContent = data.school ? data.school.name : 'École'
  document.getElementById('perc-date').value = todayStr()

  setupTabs()
  await refreshCoreData()
  await loadDashboard()
  await loadYears()
  await loadClasses()
  await loadStaff()
  await loadFeesTable()
  populateStudentClassFilter()
  populatePerceptionSelectors()
  populateDebtSelectors()
  populateBudgetSelectors()
  buildReportTabs()
  setupStudentSearch({ inputId: 'student-search-input', resultsId: 'student-search-results', trimesterSelectId: 'perc-summary-trimester' })
}

function setupTabs() {
  document.querySelectorAll('.nav-link[data-tab]').forEach(link => {
    link.addEventListener('click', async () => {
      document.querySelectorAll('.nav-link[data-tab]').forEach(l => l.classList.remove('active'))
      link.classList.add('active')
      document.querySelectorAll('main > section').forEach(s => s.classList.add('hidden'))
      document.getElementById('tab-' + link.dataset.tab).classList.remove('hidden')
      if (link.dataset.tab === 'students') await loadStudents()
      if (link.dataset.tab === 'settings') await loadSchoolSettings()
      if (link.dataset.tab === 'cashbook') await loadCashbook()
      if (link.dataset.tab === 'budget') await loadBudget()
      if (link.dataset.tab === 'quotas') { closeQuotaTrimester(); await loadQuotasOverview() }
      if (link.dataset.tab === 'perception') {
        currentPerceptionClass = null
        document.getElementById('perception-detail-view').classList.add('hidden')
        document.getElementById('perception-classes-view').classList.remove('hidden')
        await loadPerceptionClasses()
        setAutoRefresh(loadPerceptionClasses) // synchro quasi temps réel
      } else if (link.dataset.tab === 'rapport-percepteur') {
        await populateRapportPercepteurSelector()
        setAutoRefresh(async () => { if (document.getElementById('rp-percepteur').value) await loadRapportPercepteur() })
      } else {
        setAutoRefresh(null) // pas d'auto-refresh sur les autres onglets
      }
      if (link.dataset.tab === 'debts') {
        currentDebtsClass = null
        document.getElementById('debts-detail-view').classList.add('hidden')
        document.getElementById('debts-classes-view').classList.remove('hidden')
        await loadDebtsClasses()
      }
    })
  })
}

async function refreshCoreData() {
  const yearsRes = await Api.get('/api/admin/school-years')
  schoolYears = yearsRes.school_years
  const trimRes = await Api.get('/api/admin/trimesters')
  trimesters = trimRes.trimesters
  const classesRes = await Api.get('/api/admin/classes')
  classesCache = classesRes.classes
}

// ---------------------------------------------------------------------------
// DASHBOARD
// ---------------------------------------------------------------------------
async function loadDashboard() {
  const d = await Api.get('/api/admin/dashboard')
  // TOUS les KPI sont masqués par défaut (confidentialité) — clic pour afficher/cacher
  const stats = [
    { label: 'Classes', value: d.classes, icon: 'fa-chalkboard', color: 'text-blue-600', hidden: true },
    { label: 'Élèves', value: d.students, icon: 'fa-user-graduate', color: 'text-indigo-600', hidden: true },
    { label: 'Personnel', value: d.staff, icon: 'fa-users', color: 'text-purple-600', hidden: true },
    { label: "Perçu aujourd'hui", value: fmtMoney(d.today_collected, currentSchool?.currency), icon: 'fa-calendar-day', color: 'text-green-600', hidden: true },
    { label: 'Total perçu', value: fmtMoney(d.total_collected, currentSchool?.currency), icon: 'fa-coins', color: 'text-amber-600', hidden: true }
  ]
  document.getElementById('dash-stats').innerHTML = stats.map((s, i) => s.hidden ? `
    <div class="stat-card cursor-pointer select-none" onclick="toggleKpiAmount(this)" title="Cliquer pour afficher / masquer">
      <div class="flex items-center justify-between mb-2"><span class="text-xs font-medium text-slate-500">${s.label}</span><i class="fas ${s.icon} ${s.color}"></i></div>
      <p class="text-xl font-bold text-slate-800 kpi-masked">••••••</p>
      <p class="text-xl font-bold text-slate-800 kpi-value hidden">${s.value}</p>
      <p class="text-[10px] text-slate-400 mt-1"><i class="fas fa-eye mr-1"></i>Cliquer pour afficher</p>
    </div>` : `
    <div class="stat-card">
      <div class="flex items-center justify-between mb-2"><span class="text-xs font-medium text-slate-500">${s.label}</span><i class="fas ${s.icon} ${s.color}"></i></div>
      <p class="text-xl font-bold text-slate-800">${s.value}</p>
    </div>`).join('')
}

// Affiche/masque le montant d'une carte KPI (confidentialité à l'écran)
function toggleKpiAmount(card) {
  const masked = card.querySelector('.kpi-masked')
  const value = card.querySelector('.kpi-value')
  const hint = card.querySelector('.text-\\[10px\\]') || card.querySelector('p:last-child')
  const showing = masked.classList.contains('hidden')
  if (showing) {
    masked.classList.remove('hidden'); value.classList.add('hidden')
    if (hint) hint.innerHTML = '<i class="fas fa-eye mr-1"></i>Cliquer pour afficher'
  } else {
    masked.classList.add('hidden'); value.classList.remove('hidden')
    if (hint) hint.innerHTML = '<i class="fas fa-eye-slash mr-1"></i>Cliquer pour masquer'
  }
}

// ---------------------------------------------------------------------------
// ANNEES SCOLAIRES
// ---------------------------------------------------------------------------
async function loadYears() {
  const { school_years } = await Api.get('/api/admin/school-years')
  schoolYears = school_years
  const rows = await Promise.all(school_years.map(async y => {
    const { trimesters: ts } = await Api.get(`/api/admin/trimesters?school_year_id=${y.id}`)
    return `<tr>
      <td class="font-medium">${escapeHtml(y.label)}</td>
      <td>${y.is_current ? '<span class="badge badge-green">Année en cours</span>' : '<span class="badge badge-gray">Archivée</span>'}</td>
      <td>${ts.map(t => `<span class="badge badge-blue mr-1">${escapeHtml(t.name)}</span>`).join('')}</td>
      <td>${y.is_current ? '' : `<button onclick="setCurrentYear(${y.id})" class="text-blue-600 hover:underline text-xs font-semibold">Définir comme courante</button>`}</td>
    </tr>`
  }))
  document.getElementById('years-tbody').innerHTML = rows.join('') || '<tr><td colspan="4" class="text-center text-slate-400 py-6">Aucune année scolaire</td></tr>'
}

function showCreateYearModal() {
  const nextStart = new Date().getFullYear()
  openModal(`
    <div class="p-6">
      <h3 class="text-lg font-bold text-slate-800 mb-4"><i class="fas fa-calendar mr-2 text-blue-600"></i>Nouvelle année scolaire</h3>
      <form id="create-year-form" class="space-y-3">
        <div>
          <label class="text-xs font-medium text-slate-600">Année de début *</label>
          <input required type="number" id="cy-start-year" value="${nextStart}" min="2000" max="2100" class="w-full mt-1 px-3 py-2 border rounded-lg text-sm">
          <p class="text-xs text-slate-400 mt-1">En RDC, une année scolaire couvre toujours deux années consécutives (ex : <span id="cy-preview" class="font-semibold">${nextStart}-${nextStart + 1}</span>)</p>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div><label class="text-xs font-medium text-slate-600">Début</label><input type="date" id="cy-start" class="w-full mt-1 px-3 py-2 border rounded-lg text-sm"></div>
          <div><label class="text-xs font-medium text-slate-600">Fin</label><input type="date" id="cy-end" class="w-full mt-1 px-3 py-2 border rounded-lg text-sm"></div>
        </div>
        <label class="flex items-center gap-2 text-sm"><input type="checkbox" id="cy-current" checked> Définir comme année scolaire courante</label>
        <div class="flex justify-end gap-2 pt-3">
          <button type="button" onclick="closeModal()" class="px-4 py-2 text-sm rounded-lg text-slate-600 hover:bg-slate-100">Annuler</button>
          <button type="submit" class="px-4 py-2 text-sm rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold">Créer</button>
        </div>
      </form>
    </div>`)
  document.getElementById('cy-start-year').addEventListener('input', (e) => {
    const y = parseInt(e.target.value, 10)
    document.getElementById('cy-preview').textContent = isNaN(y) ? '—' : `${y}-${y + 1}`
  })
  document.getElementById('create-year-form').addEventListener('submit', async (e) => {
    e.preventDefault()
    try {
      const y = parseInt(document.getElementById('cy-start-year').value, 10)
      if (isNaN(y)) { toast('Année de début invalide', 'error'); return }
      const label = `${y}-${y + 1}`
      await Api.post('/api/admin/school-years', {
        label,
        start_date: document.getElementById('cy-start').value || null,
        end_date: document.getElementById('cy-end').value || null,
        set_current: document.getElementById('cy-current').checked
      })
      toast(`Année scolaire ${label} créée`, 'success')
      closeModal()
      await refreshCoreData()
      await loadYears()
      populatePerceptionSelectors(); populateDebtSelectors(); populateBudgetSelectors()
    } catch (err) { toast(err.message, 'error') }
  })
}

async function setCurrentYear(id) {
  try {
    await Api.patch(`/api/admin/school-years/${id}/set-current`)
    toast('Année scolaire courante mise à jour', 'success')
    await refreshCoreData()
    await loadYears()
  } catch (err) { toast(err.message, 'error') }
}

// ---------------------------------------------------------------------------
// CLASSES
// ---------------------------------------------------------------------------
async function loadClasses() {
  const { classes } = await Api.get('/api/admin/classes')
  classesCache = classes
  document.getElementById('classes-tbody').innerHTML = classes.map(cl => `
    <tr>
      <td class="font-medium">${escapeHtml(cl.name)}${cl.option ? `<span class="badge badge-amber ml-2">${escapeHtml(cl.option)}</span>` : ''}</td>
      <td>${escapeHtml(cl.level || '—')}</td>
      <td>${cl.student_count}</td>
      <td>${cl.teacher_count}</td>
      <td>${cl.percepteur_count}</td>
      <td>
        ${cl.login_email
          ? `<span class="text-xs text-slate-600">${escapeHtml(cl.login_email)}</span> ${cl.login_active ? '<span class="badge badge-green ml-1">Actif</span>' : '<span class="badge badge-gray ml-1">Inactif</span>'}`
          : '<span class="text-xs text-slate-400">—</span>'}
      </td>
      <td class="space-x-2 whitespace-nowrap">
        <button onclick="openClassAsAdmin(${cl.id})" class="text-emerald-600 hover:underline text-xs font-semibold"><i class="fas fa-door-open"></i> Ouvrir</button>
        <button onclick="viewClassDetail(${cl.id})" class="text-slate-700 hover:underline text-xs font-semibold"><i class="fas fa-eye"></i> Voir</button>
        <button onclick="showEditClassModal(${cl.id})" class="text-amber-600 hover:underline text-xs font-semibold"><i class="fas fa-pen"></i> Modifier</button>
        <button onclick="manageClassAssignments(${cl.id}, '${escapeHtml(cl.name)}')" class="text-blue-600 hover:underline text-xs font-semibold"><i class="fas fa-user-plus"></i> Affecter</button>
        <button onclick="showClassLoginEditModal(${cl.id}, '${escapeHtml(cl.name)}', '${escapeHtml(cl.login_email || '')}')" class="text-amber-600 hover:underline text-xs font-semibold"><i class="fas fa-key"></i> Identifiants</button>
        <button onclick="deleteClass(${cl.id})" class="text-red-600 hover:underline text-xs font-semibold"><i class="fas fa-trash"></i></button>
      </td>
    </tr>`).join('') || '<tr><td colspan="7" class="text-center text-slate-400 py-6">Aucune classe créée</td></tr>'
}

async function openClassAsAdmin(classId) {
  try {
    await Api.post(`/api/admin/classes/${classId}/impersonate`)
    window.location.href = '/static/classe.html'
  } catch (err) { toast(err.message, 'error') }
}

function showClassLoginModal(className, email, password) {
  openModal(`
    <div class="p-6">
      <h3 class="text-lg font-bold text-slate-800 mb-1"><i class="fas fa-key mr-2 text-amber-600"></i>Identifiants de connexion — ${escapeHtml(className)}</h3>
      <p class="text-sm text-slate-500 mb-4">Communiquez ces identifiants à la classe (ou au percepteur affecté) pour qu'elle puisse se connecter à son espace de consultation. Le mot de passe ne sera plus jamais affiché : notez-le maintenant.</p>
      <div class="bg-slate-50 rounded-lg p-4 space-y-2 text-sm mb-4">
        <div class="flex justify-between"><span class="text-slate-500">Email</span><span class="font-mono font-semibold">${escapeHtml(email)}</span></div>
        <div class="flex justify-between"><span class="text-slate-500">Mot de passe</span><span class="font-mono font-semibold">${escapeHtml(password)}</span></div>
      </div>
      <div class="flex justify-end gap-2">
        <button onclick="closeModal()" class="px-4 py-2 text-sm rounded-lg bg-slate-800 hover:bg-slate-900 text-white font-semibold">J'ai noté, fermer</button>
      </div>
    </div>`)
}

function showClassLoginEditModal(classId, className, currentEmail) {
  openModal(`
    <div class="p-6">
      <h3 class="text-lg font-bold text-slate-800 mb-1"><i class="fas fa-key mr-2 text-amber-600"></i>Identifiants de connexion — ${escapeHtml(className)}</h3>
      <p class="text-sm text-slate-500 mb-4">Définissez ou modifiez l'email et le mot de passe de connexion de cette classe. Laissez le mot de passe vide pour ne changer que l'email.</p>
      <form id="class-login-form" class="space-y-3">
        <div><label class="text-xs font-medium text-slate-600">Email de connexion *</label><input required type="email" id="cl-email" value="${escapeHtml(currentEmail)}" class="w-full mt-1 px-3 py-2 border rounded-lg text-sm"></div>
        <div><label class="text-xs font-medium text-slate-600">Nouveau mot de passe ${currentEmail ? '(laisser vide pour ne pas changer)' : '*'}</label><input ${currentEmail ? '' : 'required'} id="cl-password" placeholder="Min. 4 caractères" class="w-full mt-1 px-3 py-2 border rounded-lg text-sm"></div>
        <div class="flex justify-end gap-2 pt-3">
          <button type="button" onclick="closeModal()" class="px-4 py-2 text-sm rounded-lg text-slate-600 hover:bg-slate-100">Annuler</button>
          <button type="submit" class="px-4 py-2 text-sm rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-semibold">Enregistrer</button>
        </div>
      </form>
    </div>`)
  document.getElementById('class-login-form').addEventListener('submit', async (e) => {
    e.preventDefault()
    try {
      const email = document.getElementById('cl-email').value
      const password = document.getElementById('cl-password').value
      const result = await Api.patch(`/api/admin/classes/${classId}/login`, { email, password: password || undefined })
      toast('Identifiants de la classe mis à jour', 'success')
      closeModal()
      await loadClasses()
      if (result.class_login && result.class_login.password) {
        showClassLoginModal(className, result.class_login.email, result.class_login.password)
      }
    } catch (err) { toast(err.message, 'error') }
  })
}

async function viewClassDetail(classId) {
  try {
    const data = await Api.get(`/api/admin/classes/${classId}/detail`)
    const cl = data.class
    openModal(`
      <div class="p-6 max-h-[80vh] overflow-y-auto">
        <h3 class="text-lg font-bold text-slate-800 mb-1"><i class="fas fa-chalkboard mr-2 text-blue-600"></i>${escapeHtml(cl.name)}</h3>
        <p class="text-sm text-slate-500 mb-4">${escapeHtml(cl.level || 'Niveau non précisé')}</p>

        <div class="grid grid-cols-3 gap-3 mb-5 text-center">
          <div class="bg-slate-50 rounded-lg p-3"><p class="text-xs text-slate-500">Élèves</p><p class="font-bold text-lg">${data.students.length}</p></div>
          <div class="bg-slate-50 rounded-lg p-3"><p class="text-xs text-slate-500">Enseignants</p><p class="font-bold text-lg">${data.teachers.length}</p></div>
          <div class="bg-slate-50 rounded-lg p-3"><p class="text-xs text-slate-500">Percepteurs</p><p class="font-bold text-lg">${data.percepteurs.length}</p></div>
        </div>

        <div class="mb-5">
          <p class="text-xs font-semibold text-slate-500 mb-2">Compte de connexion de la classe</p>
          ${data.login_account
            ? `<div class="bg-slate-50 rounded-lg px-3 py-2 text-sm flex justify-between items-center">
                 <span class="font-mono">${escapeHtml(data.login_account.email)}</span>
                 ${data.login_account.active ? '<span class="badge badge-green">Actif</span>' : '<span class="badge badge-gray">Inactif</span>'}
               </div>`
            : '<p class="text-xs text-slate-400">Aucun compte (utilisez le bouton "Mdp" pour en créer un)</p>'}
        </div>

        <div class="mb-5">
          <p class="text-xs font-semibold text-slate-500 mb-2">Frais scolaires fixés</p>
          <table class="data-table"><thead><tr><th>Trimestre</th><th>Catégorie</th><th>Montant</th></tr></thead>
            <tbody>${data.fee_structures.map(f => `<tr><td>${escapeHtml(f.trimester_name)}</td><td>${categoryBadge(f.categorie)}</td><td>${fmtMoney(f.montant, currentSchool?.currency)}</td></tr>`).join('') || '<tr><td colspan="3" class="text-center text-slate-400 py-3">Aucun frais fixé</td></tr>'}</tbody>
          </table>
        </div>

        <div class="mb-5">
          <p class="text-xs font-semibold text-slate-500 mb-2">Élèves (${data.students.length})</p>
          <table class="data-table"><thead><tr><th>Nom</th><th>Post-nom</th><th>Catégorie</th></tr></thead>
            <tbody>${data.students.map(s => `<tr><td class="font-medium">${escapeHtml(s.nom)}</td><td>${escapeHtml(s.post_nom)}</td><td>${categoryBadge(s.categorie)}</td></tr>`).join('') || '<tr><td colspan="3" class="text-center text-slate-400 py-3">Aucun élève</td></tr>'}</tbody>
          </table>
        </div>

        <div class="mb-2">
          <p class="text-xs font-semibold text-slate-500 mb-2">Derniers paiements (${data.recent_payments.length})</p>
          <table class="data-table"><thead><tr><th>Date</th><th>Élève</th><th>Montant</th><th>Reçu</th><th>Percepteur</th></tr></thead>
            <tbody>${data.recent_payments.map(p => `<tr><td>${fmtDate(p.date_paiement)}</td><td class="font-medium">${escapeHtml(p.nom)} ${escapeHtml(p.post_nom)}</td><td class="text-green-600">${fmtMoney(p.montant, currentSchool?.currency)}</td><td class="text-xs">${escapeHtml(p.receipt_number)}</td><td class="text-xs">${escapeHtml(p.percepteur_name)}</td></tr>`).join('') || '<tr><td colspan="5" class="text-center text-slate-400 py-3">Aucun paiement enregistré</td></tr>'}</tbody>
          </table>
        </div>

        <div class="flex justify-end pt-3"><button onclick="closeModal()" class="px-4 py-2 text-sm rounded-lg bg-slate-800 text-white font-semibold">Fermer</button></div>
      </div>`)
  } catch (err) { toast(err.message, 'error') }
}

const CLASS_ORDINALS = ['1ère', '2ème', '3ème', '4ème', '5ème', '6ème', '7ème','8ème']
const CLASS_LEVELS = ['CTEB', 'Humanitaire', 'Primaire']
// Sans accents pour éviter les problèmes d'encodage Unicode (ex. « Pédagogie
// générale » n'apparaissait pas sur les reçus selon l'OS/navigateur)
const CLASS_OPTIONS = ['Commerciale-gestion', 'Construction', 'Coupe et couture', 'Latin-philosophie', 'Menuiserie', 'Nutrition', 'Pedagogie generale', 'Scientifique']

function showCreateClassModal() {
  const currentYear = schoolYears.find(y => y.is_current) || schoolYears[0]
  openModal(`
    <div class="p-6">
      <h3 class="text-lg font-bold text-slate-800 mb-4"><i class="fas fa-chalkboard mr-2 text-blue-600"></i>Nouvelle classe</h3>
      <form id="create-class-form" class="space-y-3">
        <div class="grid grid-cols-2 gap-3">
          <div><label class="text-xs font-medium text-slate-600">Nom de la classe *</label>
            <select required id="cc-ordinal" class="w-full mt-1 px-3 py-2 border rounded-lg text-sm">
              ${CLASS_ORDINALS.map(o => `<option value="${o}">${o}</option>`).join('')}
            </select>
          </div>
          <div><label class="text-xs font-medium text-slate-600">Étiquette</label><input id="cc-label" placeholder="ex: A" maxlength="5" class="w-full mt-1 px-3 py-2 border rounded-lg text-sm"></div>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div><label class="text-xs font-medium text-slate-600">Niveau</label>
            <select id="cc-level" class="w-full mt-1 px-3 py-2 border rounded-lg text-sm" onchange="toggleOptionField()">
              <option value="">— Choisir —</option>
              ${CLASS_LEVELS.map(l => `<option value="${l}">${l}</option>`).join('')}
            </select>
          </div>
          <div id="cc-option-wrap" class="hidden"><label class="text-xs font-medium text-slate-600">Option (humanités)</label>
            <select id="cc-option" class="w-full mt-1 px-3 py-2 border rounded-lg text-sm">
              <option value="">— Aucune —</option>
              ${CLASS_OPTIONS.map(o => `<option value="${o}">${o}</option>`).join('')}
            </select>
          </div>
        </div>
        <div><label class="text-xs font-medium text-slate-600">Année scolaire *</label>
          <select id="cc-year" class="w-full mt-1 px-3 py-2 border rounded-lg text-sm">
            ${schoolYears.map(y => `<option value="${y.id}" ${currentYear && y.id === currentYear.id ? 'selected' : ''}>${escapeHtml(y.label)}</option>`).join('')}
          </select>
        </div>
        <hr>
        <p class="text-xs font-semibold text-slate-500">Identifiants de connexion de la classe</p>
        <div><label class="text-xs font-medium text-slate-600">Email de connexion *</label><input required type="email" id="cc-login-email" placeholder="6emea@ecole.local" class="w-full mt-1 px-3 py-2 border rounded-lg text-sm"></div>
        <div><label class="text-xs font-medium text-slate-600">Mot de passe *</label><input required id="cc-login-password" placeholder="Min. 4 caractères" class="w-full mt-1 px-3 py-2 border rounded-lg text-sm"></div>
        <div class="flex justify-end gap-2 pt-3">
          <button type="button" onclick="closeModal()" class="px-4 py-2 text-sm rounded-lg text-slate-600 hover:bg-slate-100">Annuler</button>
          <button type="submit" class="px-4 py-2 text-sm rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold">Créer</button>
        </div>
      </form>
    </div>`)
  document.getElementById('create-class-form').addEventListener('submit', async (e) => {
    e.preventDefault()
    try {
      const ordinal = document.getElementById('cc-ordinal').value
      const label = document.getElementById('cc-label').value.trim()
      const optionVal = document.getElementById('cc-option').value
      // Le nom inclut l'option pour distinguer "1ère Scientifique" de "1ère Pédagogie générale"
      let className = ordinal
      if (optionVal) className += ` ${optionVal}`
      if (label) className += ` ${label}`
      const loginEmail = document.getElementById('cc-login-email').value
      const loginPassword = document.getElementById('cc-login-password').value
      const result = await Api.post('/api/admin/classes', {
        name: className,
        level: document.getElementById('cc-level').value,
        option: document.getElementById('cc-option').value || null,
        school_year_id: document.getElementById('cc-year').value,
        login_email: loginEmail,
        login_password: loginPassword
      })
      toast('Classe créée', 'success')
      closeModal()
      await loadClasses()
      populateStudentClassFilter(); populatePerceptionSelectors(); populateDebtSelectors(); await loadFeesTable()
      if (result.class_login) {
        showClassLoginModal(className, result.class_login.email, result.class_login.password)
      }
    } catch (err) { toast(err.message, 'error') }
  })
}

function toggleOptionField() {
  const level = document.getElementById('cc-level').value
  const wrap = document.getElementById('cc-option-wrap')
  if (!wrap) return
  if (level === 'Humanitaire') wrap.classList.remove('hidden')
  else { wrap.classList.add('hidden'); const sel = document.getElementById('cc-option'); if (sel) sel.value = '' }
}

function showEditClassModal(classId) {
  const cl = classesCache.find(c => c.id === classId)
  if (!cl) return
  openModal(`
    <div class="p-6">
      <h3 class="text-lg font-bold text-slate-800 mb-4"><i class="fas fa-pen mr-2 text-amber-600"></i>Modifier la classe</h3>
      <form id="edit-class-form" class="space-y-3">
        <div><label class="text-xs font-medium text-slate-600">Nom de la classe *</label><input required id="ecl-name" value="${escapeHtml(cl.name)}" class="w-full mt-1 px-3 py-2 border rounded-lg text-sm"></div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div><label class="text-xs font-medium text-slate-600">Niveau</label>
            <select id="ecl-level" class="w-full mt-1 px-3 py-2 border rounded-lg text-sm">
              <option value="">— Choisir —</option>
              ${CLASS_LEVELS.map(l => `<option value="${l}" ${cl.level === l ? 'selected' : ''}>${l}</option>`).join('')}
            </select>
          </div>
          <div><label class="text-xs font-medium text-slate-600">Option (humanités)</label>
            <select id="ecl-option" class="w-full mt-1 px-3 py-2 border rounded-lg text-sm">
              <option value="__none__">— Aucune —</option>
              ${CLASS_OPTIONS.map(o => `<option value="${o}" ${cl.option === o ? 'selected' : ''}>${o}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="flex justify-end gap-2 pt-3">
          <button type="button" onclick="closeModal()" class="px-4 py-2 text-sm rounded-lg text-slate-600 hover:bg-slate-100">Annuler</button>
          <button type="submit" class="px-4 py-2 text-sm rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold">Enregistrer</button>
        </div>
      </form>
    </div>`)
  document.getElementById('edit-class-form').addEventListener('submit', async (e) => {
    e.preventDefault()
    try {
      await Api.patch(`/api/admin/classes/${classId}`, {
        name: document.getElementById('ecl-name').value.trim(),
        level: document.getElementById('ecl-level').value || null,
        option: document.getElementById('ecl-option').value
      })
      toast('Classe modifiée', 'success')
      closeModal()
      await refreshCoreData()
      await loadClasses()
    } catch (err) { toast(err.message, 'error') }
  })
}

async function deleteClass(id) {
  if (!confirm('Supprimer cette classe et tous ses élèves associés ?')) return
  try {
    await Api.del(`/api/admin/classes/${id}`)
    toast('Classe supprimée', 'success')
    await loadClasses()
    populateStudentClassFilter(); populatePerceptionSelectors(); populateDebtSelectors()
  } catch (err) { toast(err.message, 'error') }
}

async function manageClassAssignments(classId, className) {
  const [assignRes, staffRes] = await Promise.all([
    Api.get(`/api/admin/classes/${classId}/assignments`),
    Api.get('/api/admin/staff')
  ])
  const teachers = staffRes.staff.filter(s => s.role === 'enseignant')
  const percepteurs = staffRes.staff.filter(s => s.role === 'percepteur')

  openModal(`
    <div class="p-6">
      <h3 class="text-lg font-bold text-slate-800 mb-4"><i class="fas fa-user-plus mr-2 text-blue-600"></i>Affectations — ${escapeHtml(className)}</h3>

      <div class="mb-5">
        <p class="text-xs font-semibold text-slate-500 mb-2">Enseignants affectés</p>
        <div class="space-y-1 mb-2" id="assign-teachers-list">
          ${assignRes.teachers.map(t => `<div class="flex items-center justify-between bg-slate-50 px-3 py-1.5 rounded text-sm">
            <span>${escapeHtml(t.name)} ${t.is_titulaire ? '<span class="badge badge-blue ml-1">Titulaire</span>' : ''}</span>
            <button onclick="removeTeacherAssignment(${classId}, ${t.id}, '${escapeHtml(className)}')" class="text-red-500 text-xs"><i class="fas fa-times"></i></button>
          </div>`).join('') || '<p class="text-xs text-slate-400">Aucun enseignant affecté</p>'}
        </div>
        <div class="flex gap-2">
          <select id="add-teacher-select" class="flex-1 px-3 py-2 border rounded-lg text-sm">
            <option value="">— Choisir un enseignant —</option>
            ${teachers.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('')}
          </select>
          <button onclick="addTeacherAssignment(${classId}, '${escapeHtml(className)}')" class="bg-blue-600 text-white px-3 py-2 rounded-lg text-sm">Ajouter</button>
        </div>
      </div>

      <hr class="mb-5">

      <div>
        <p class="text-xs font-semibold text-slate-500 mb-2">Percepteurs affectés (au moins 1 requis pour percevoir)</p>
        <div class="space-y-1 mb-2" id="assign-percepteurs-list">
          ${assignRes.percepteurs.map(p => `<div class="flex items-center justify-between bg-slate-50 px-3 py-1.5 rounded text-sm">
            <span>${escapeHtml(p.name)}</span>
            <button onclick="removePercepteurAssignment(${classId}, ${p.id}, '${escapeHtml(className)}')" class="text-red-500 text-xs"><i class="fas fa-times"></i></button>
          </div>`).join('') || '<p class="text-xs text-slate-400">Aucun percepteur affecté</p>'}
        </div>
        <div class="flex gap-2">
          <select id="add-percepteur-select" class="flex-1 px-3 py-2 border rounded-lg text-sm">
            <option value="">— Choisir un percepteur —</option>
            ${percepteurs.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('')}
          </select>
          <button onclick="addPercepteurAssignment(${classId}, '${escapeHtml(className)}')" class="bg-blue-600 text-white px-3 py-2 rounded-lg text-sm">Ajouter</button>
        </div>
      </div>

      <div class="flex justify-end pt-5"><button onclick="closeModal(); loadClasses();" class="px-4 py-2 text-sm rounded-lg bg-slate-800 text-white font-semibold">Fermer</button></div>
    </div>`)
}

async function addTeacherAssignment(classId, className) {
  const teacherId = document.getElementById('add-teacher-select').value
  if (!teacherId) return toast('Sélectionnez un enseignant', 'error')
  try {
    await Api.post(`/api/admin/classes/${classId}/teachers`, { teacher_id: teacherId, is_titulaire: true })
    toast('Enseignant affecté', 'success')
    manageClassAssignments(classId, className)
  } catch (err) { toast(err.message, 'error') }
}
async function removeTeacherAssignment(classId, teacherId, className) {
  try {
    await Api.del(`/api/admin/classes/${classId}/teachers/${teacherId}`)
    manageClassAssignments(classId, className)
  } catch (err) { toast(err.message, 'error') }
}
async function addPercepteurAssignment(classId, className) {
  const percepteurId = document.getElementById('add-percepteur-select').value
  if (!percepteurId) return toast('Sélectionnez un percepteur', 'error')
  try {
    await Api.post(`/api/admin/classes/${classId}/percepteurs`, { percepteur_id: percepteurId })
    toast('Percepteur affecté', 'success')
    manageClassAssignments(classId, className)
  } catch (err) { toast(err.message, 'error') }
}
async function removePercepteurAssignment(classId, percepteurId, className) {
  try {
    await Api.del(`/api/admin/classes/${classId}/percepteurs/${percepteurId}`)
    manageClassAssignments(classId, className)
  } catch (err) { toast(err.message, 'error') }
}

// ---------------------------------------------------------------------------
// ELEVES
// ---------------------------------------------------------------------------
function populateStudentClassFilter() {
  const sel = document.getElementById('students-class-filter')
  sel.innerHTML = '<option value="">Toutes les classes</option>' + classesCache.map(cl => `<option value="${cl.id}">${escapeHtml(cl.name)}</option>`).join('')
  sel.onchange = loadStudents
}

let studentsCache = []

async function loadStudents() {
  const classId = document.getElementById('students-class-filter').value
  const url = classId ? `/api/admin/students?class_id=${classId}` : '/api/admin/students'
  const { students } = await Api.get(url)
  studentsCache = students
  document.getElementById('students-tbody').innerHTML = students.map(s => `
    <tr>
      <td class="font-medium">${escapeHtml(s.nom)}</td>
      <td>${escapeHtml(s.post_nom)}</td>
      <td>${escapeHtml(s.prenom || '—')}</td>
      <td>${s.sexe || '—'}</td>
      <td>${categoryBadge(s.categorie)}</td>
      <td class="space-x-2 whitespace-nowrap">
        <button onclick="showEditStudentModal(${s.id})" class="text-amber-600 hover:underline text-xs font-semibold" title="Modifier l'élève"><i class="fas fa-pen"></i> Modifier</button>
        <button onclick="showEditStudentCategoryModal(${s.id}, '${escapeHtml(s.nom)} ${escapeHtml(s.post_nom)}', '${s.categorie || 'normal'}')" class="text-blue-600 hover:underline text-xs font-semibold"><i class="fas fa-tag"></i> Catégorie</button>
        <button onclick="showTransferStudentModal(${s.id}, '${escapeHtml(s.nom)} ${escapeHtml(s.post_nom)}', ${s.class_id})" class="text-purple-600 hover:underline text-xs font-semibold" title="Transférer vers une autre classe"><i class="fas fa-exchange-alt"></i> Transférer</button>
        <button onclick="deleteStudent(${s.id})" class="text-red-600 hover:underline text-xs font-semibold" title="Supprimer l'élève"><i class="fas fa-trash"></i></button>
      </td>
    </tr>`).join('') || '<tr><td colspan="6" class="text-center text-slate-400 py-6">Aucun élève. L\'ajout et l\'import se font depuis l\'espace de connexion de chaque classe.</td></tr>'
}

// Transfert d'un élève vers une autre classe (avec paiements et toutes ses données)
function showTransferStudentModal(studentId, studentName, currentClassId) {
  const destClasses = classesCache.filter(cl => cl.id !== currentClassId)
  if (!destClasses.length) { toast('Aucune autre classe disponible', 'error'); return }
  openModal(`
    <div class="p-6">
      <h3 class="text-lg font-bold text-slate-800 mb-1"><i class="fas fa-exchange-alt mr-2 text-purple-600"></i>Transférer l'élève</h3>
      <p class="text-sm text-slate-500 mb-4">${escapeHtml(studentName)}</p>
      <form id="transfer-form" class="space-y-3">
        <div><label class="text-xs font-medium text-slate-600">Classe de destination *</label>
          <select id="tr-class" class="w-full mt-1 px-3 py-2 border rounded-lg text-sm" required>
            <option value="">— Choisir une classe —</option>
            ${destClasses.map(cl => `<option value="${cl.id}">${escapeHtml(cl.name)}${cl.option ? ' (' + escapeHtml(cl.option) + ')' : ''} — ${escapeHtml(cl.level || '')}</option>`).join('')}
          </select>
        </div>
        <p class="text-xs text-slate-400"><i class="fas fa-info-circle mr-1"></i>L'élève part avec toutes ses données : ses paiements et son historique le suivent. Les frais appliqués seront ceux de la nouvelle classe.</p>
        <div class="flex justify-end gap-2 pt-2">
          <button type="button" onclick="closeModal()" class="px-4 py-2 text-sm rounded-lg text-slate-600 hover:bg-slate-100">Annuler</button>
          <button type="submit" class="px-4 py-2 text-sm rounded-lg bg-purple-600 hover:bg-purple-700 text-white font-semibold"><i class="fas fa-exchange-alt mr-1"></i>Transférer</button>
        </div>
      </form>
    </div>`)
  document.getElementById('transfer-form').addEventListener('submit', async (e) => {
    e.preventDefault()
    const toClassId = document.getElementById('tr-class').value
    if (!toClassId) { toast('Choisissez une classe de destination', 'error'); return }
    try {
      const res = await Api.post(`/api/admin/students/${studentId}/transfer`, { to_class_id: Number(toClassId) })
      toast(res.message || 'Élève transféré', 'success')
      closeModal()
      await loadStudents()
    } catch (err) { toast(err.message, 'error') }
  })
}

function showEditStudentModal(studentId) {
  const s = studentsCache.find(x => x.id === studentId)
  if (!s) return
  openModal(`
    <div class="p-6">
      <h3 class="text-lg font-bold text-slate-800 mb-1"><i class="fas fa-pen mr-2 text-amber-600"></i>Modifier l'élève</h3>
      <p class="text-sm text-slate-500 mb-4">${escapeHtml(s.nom)} ${escapeHtml(s.post_nom)}</p>
      <form id="edit-student-form" class="space-y-3">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div><label class="text-xs font-medium text-slate-600">Nom *</label><input required id="es-nom" value="${escapeHtml(s.nom)}" class="w-full mt-1 px-3 py-2 border rounded-lg text-sm"></div>
          <div><label class="text-xs font-medium text-slate-600">Post-nom *</label><input required id="es-postnom" value="${escapeHtml(s.post_nom)}" class="w-full mt-1 px-3 py-2 border rounded-lg text-sm"></div>
          <div><label class="text-xs font-medium text-slate-600">Prénom</label><input id="es-prenom" value="${escapeHtml(s.prenom || '')}" class="w-full mt-1 px-3 py-2 border rounded-lg text-sm"></div>
          <div><label class="text-xs font-medium text-slate-600">Sexe</label>
            <select id="es-sexe" class="w-full mt-1 px-3 py-2 border rounded-lg text-sm">
              <option value="" ${!s.sexe ? 'selected' : ''}>—</option>
              <option value="M" ${s.sexe === 'M' ? 'selected' : ''}>M</option>
              <option value="F" ${s.sexe === 'F' ? 'selected' : ''}>F</option>
            </select>
          </div>
          <div><label class="text-xs font-medium text-slate-600">Classe</label>
            <select id="es-classe" class="w-full mt-1 px-3 py-2 border rounded-lg text-sm">
              ${classesCache.map(cl => `<option value="${cl.id}" ${cl.id === s.class_id ? 'selected' : ''}>${escapeHtml(cl.name)}</option>`).join('')}
            </select>
          </div>
          <div><label class="text-xs font-medium text-slate-600">Catégorie</label>
            <select id="es-categorie" class="w-full mt-1 px-3 py-2 border rounded-lg text-sm">${categoryOptions(s.categorie || 'normal')}</select>
          </div>
        </div>
        <div class="flex justify-end gap-2 pt-2">
          <button type="button" onclick="closeModal()" class="px-4 py-2 text-sm rounded-lg text-slate-600 hover:bg-slate-100">Annuler</button>
          <button type="submit" class="px-4 py-2 text-sm rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold">Enregistrer</button>
        </div>
      </form>
    </div>`)
  document.getElementById('edit-student-form').addEventListener('submit', async (e) => {
    e.preventDefault()
    try {
      await Api.patch(`/api/admin/students/${studentId}`, {
        nom: document.getElementById('es-nom').value.trim(),
        post_nom: document.getElementById('es-postnom').value.trim(),
        prenom: document.getElementById('es-prenom').value.trim() || null,
        sexe: document.getElementById('es-sexe').value || null,
        class_id: parseInt(document.getElementById('es-classe').value),
        categorie: document.getElementById('es-categorie').value
      })
      toast('Élève modifié', 'success')
      closeModal()
      await loadStudents()
    } catch (err) { toast(err.message, 'error') }
  })
}

function showEditStudentCategoryModal(studentId, studentName, currentCat) {
  openModal(`
    <div class="p-6">
      <h3 class="text-lg font-bold text-slate-800 mb-1"><i class="fas fa-tag mr-2 text-blue-600"></i>Catégorie de l'élève</h3>
      <p class="text-sm text-slate-500 mb-4">${escapeHtml(studentName)}</p>
      <form id="edit-cat-form" class="space-y-3">
        <div><label class="text-xs font-medium text-slate-600">Catégorie *</label>
          <select id="ec-categorie" class="w-full mt-1 px-3 py-2 border rounded-lg text-sm">${categoryOptions(currentCat)}</select>
        </div>
        <p class="text-xs text-slate-400">Le montant des frais appliqué à cet élève dépend de sa catégorie (voir l'onglet « Frais scolaires »).</p>
        <div class="flex justify-end gap-2 pt-2">
          <button type="button" onclick="closeModal()" class="px-4 py-2 text-sm rounded-lg text-slate-600 hover:bg-slate-100">Annuler</button>
          <button type="submit" class="px-4 py-2 text-sm rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold">Enregistrer</button>
        </div>
      </form>
    </div>`)
  document.getElementById('edit-cat-form').addEventListener('submit', async (e) => {
    e.preventDefault()
    try {
      await Api.patch(`/api/admin/students/${studentId}`, { categorie: document.getElementById('ec-categorie').value })
      toast('Catégorie mise à jour', 'success')
      closeModal()
      await loadStudents()
    } catch (err) { toast(err.message, 'error') }
  })
}

function exportStudentsExcel() {
  const classSel = document.getElementById('students-class-filter')
  const className = classSel.value ? classSel.options[classSel.selectedIndex].text : 'Toutes les classes'
  exportTableToExcel({
    filename: `eleves_${todayStr()}`,
    sheetName: 'Élèves',
    title: `Liste des élèves — ${className} — ${currentSchool ? currentSchool.name : ''}`,
    columns: [
      { header: 'Nom', key: 'nom' }, { header: 'Post-nom', key: 'post_nom' }, { header: 'Prénom', key: 'prenom' },
      { header: 'Sexe', key: 'sexe' }, { header: 'Catégorie', key: 'cat' }, { header: 'Classe', key: 'class_name' }
    ],
    rows: studentsCache.map(s => ({ ...s, prenom: s.prenom || '', sexe: s.sexe || '', cat: categoryLabel(s.categorie) }))
  })
}

function exportStudentsPdf() {
  const classSel = document.getElementById('students-class-filter')
  const className = classSel.value ? classSel.options[classSel.selectedIndex].text : 'Toutes les classes'
  exportTableToPdf({
    filename: `eleves_${todayStr()}`,
    title: `Liste des élèves — ${className}`,
    subtitle: `${currentSchool ? currentSchool.name : ''} — ${studentsCache.length} élève(s)`,
    columns: [
      { header: 'Nom', key: 'nom' }, { header: 'Post-nom', key: 'post_nom' }, { header: 'Prénom', key: 'prenom' },
      { header: 'Sexe', key: 'sexe' }, { header: 'Catégorie', key: 'cat' }, { header: 'Classe', key: 'class_name' }
    ],
    rows: studentsCache.map(s => ({ ...s, prenom: s.prenom || '', sexe: s.sexe || '', cat: categoryLabel(s.categorie) }))
  })
}

async function deleteStudent(id) {
  if (!confirm('Supprimer cet élève ?')) return
  try {
    await Api.del(`/api/admin/students/${id}`)
    toast('Élève supprimé', 'success')
    await loadStudents()
    await loadClasses()
  } catch (err) { toast(err.message, 'error') }
}

// ---------------------------------------------------------------------------
// PERSONNEL
// ---------------------------------------------------------------------------
async function loadStaff() {
  const { staff } = await Api.get('/api/admin/staff')
  document.getElementById('staff-tbody').innerHTML = staff.map(s => `
    <tr>
      <td class="font-medium">${escapeHtml(s.name)}</td>
      <td>${escapeHtml(s.email)}</td>
      <td><span class="badge ${s.role === 'enseignant' ? 'badge-blue' : 'badge-amber'}">${s.role === 'enseignant' ? 'Enseignant' : 'Percepteur'}</span></td>
      <td>${s.active ? '<span class="badge badge-green">Actif</span>' : '<span class="badge badge-gray">Inactif</span>'}</td>
      <td class="space-x-2">
        <button onclick="toggleStaff(${s.id}, ${s.active ? 0 : 1})" class="text-xs font-semibold ${s.active ? 'text-red-600' : 'text-green-600'} hover:underline">${s.active ? 'Désactiver' : 'Activer'}</button>
        <button onclick="deleteStaff(${s.id})" class="text-red-600 hover:underline text-xs font-semibold"><i class="fas fa-trash"></i></button>
      </td>
    </tr>`).join('') || '<tr><td colspan="5" class="text-center text-slate-400 py-6">Aucun personnel enregistré</td></tr>'
}

function showCreateStaffModal() {
  openModal(`
    <div class="p-6">
      <h3 class="text-lg font-bold text-slate-800 mb-4"><i class="fas fa-user-plus mr-2 text-blue-600"></i>Ajouter du personnel</h3>
      <form id="create-staff-form" class="space-y-3">
        <div><label class="text-xs font-medium text-slate-600">Nom complet *</label><input required id="sf-name" class="w-full mt-1 px-3 py-2 border rounded-lg text-sm"></div>
        <div class="grid grid-cols-2 gap-3">
          <div><label class="text-xs font-medium text-slate-600">Email *</label><input required type="email" id="sf-email" class="w-full mt-1 px-3 py-2 border rounded-lg text-sm"></div>
          <div><label class="text-xs font-medium text-slate-600">Téléphone</label><input id="sf-phone" class="w-full mt-1 px-3 py-2 border rounded-lg text-sm"></div>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div><label class="text-xs font-medium text-slate-600">Mot de passe *</label><input required id="sf-password" class="w-full mt-1 px-3 py-2 border rounded-lg text-sm"></div>
          <div><label class="text-xs font-medium text-slate-600">Rôle *</label>
            <select required id="sf-role" class="w-full mt-1 px-3 py-2 border rounded-lg text-sm"><option value="percepteur">Percepteur</option><option value="enseignant">Enseignant</option></select>
          </div>
        </div>
        <div class="flex justify-end gap-2 pt-3">
          <button type="button" onclick="closeModal()" class="px-4 py-2 text-sm rounded-lg text-slate-600 hover:bg-slate-100">Annuler</button>
          <button type="submit" class="px-4 py-2 text-sm rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold">Ajouter</button>
        </div>
      </form>
    </div>`)
  document.getElementById('create-staff-form').addEventListener('submit', async (e) => {
    e.preventDefault()
    try {
      await Api.post('/api/admin/staff', {
        name: document.getElementById('sf-name').value,
        email: document.getElementById('sf-email').value,
        phone: document.getElementById('sf-phone').value,
        password: document.getElementById('sf-password').value,
        role: document.getElementById('sf-role').value
      })
      toast('Personnel ajouté', 'success')
      closeModal()
      await loadStaff()
    } catch (err) { toast(err.message, 'error') }
  })
}

async function toggleStaff(id, active) {
  try { await Api.patch(`/api/admin/staff/${id}`, { active }); toast('Statut mis à jour', 'success'); loadStaff() }
  catch (err) { toast(err.message, 'error') }
}
async function deleteStaff(id) {
  if (!confirm('Supprimer ce compte ?')) return
  try { await Api.del(`/api/admin/staff/${id}`); toast('Supprimé', 'success'); loadStaff() }
  catch (err) { toast(err.message, 'error') }
}

// ---------------------------------------------------------------------------
// FRAIS SCOLAIRES (par classe x trimestre)
// ---------------------------------------------------------------------------
let feesExportData = [] // pour l'export : [{ class_name, categorie, t1, t2, t3 }]

// Les groupes de frais viennent du backend (GET /api/admin/fee-groups) : une seule
// source de vérité pour les frais et les quotas.

async function loadFeesTable() {
  const currentYear = schoolYears.find(y => y.is_current) || schoolYears[0]
  if (!currentYear) { document.getElementById('fees-tbody').innerHTML = '<tr><td colspan="5" class="text-center text-slate-400 py-6">Créez une année scolaire d\'abord</td></tr>'; return }
  const { trimesters: ts } = await Api.get(`/api/admin/trimesters?school_year_id=${currentYear.id}`)
  const { classes } = await Api.get(`/api/admin/classes?school_year_id=${currentYear.id}`)
  const { fee_structures } = await Api.get(`/api/admin/fee-structures?school_year_id=${currentYear.id}`)

  const feeMap = {}
  const feeIdMap = {}
  fee_structures.forEach(f => {
    feeMap[`${f.class_id}-${f.trimester_id}-${f.categorie || 'normal'}`] = f.montant
    feeIdMap[`${f.class_id}-${f.trimester_id}-${f.categorie || 'normal'}`] = f.id
  })

  const CATS = ['normal', 'indigent', 'fils_enseignant']
  feesExportData = []
  const { groups: apiGroups } = await Api.get(`/api/admin/fee-groups?school_year_id=${currentYear.id}`)
  const classById = new Map(classes.map(k => [k.id, k]))
  const groups = apiGroups.map(g => ({ key: g.key, label: g.label, classes: g.class_ids.map(id => classById.get(id)).filter(Boolean) })).filter(g => g.classes.length)

  document.getElementById('fees-tbody').innerHTML = groups.map(g => {
    const rep = g.classes[0] // classe représentante : le backend propage au groupe
    const members = g.classes.map(k => escapeHtml(k.name)).join(', ')
    return CATS.map((cat, ci) => {
      const exportRow = { class_name: g.label, categorie: categoryLabel(cat) }
      ts.forEach((t, i) => { exportRow['t' + (i + 1)] = feeMap[`${rep.id}-${t.id}-${cat}`] ?? '' })
      feesExportData.push(exportRow)
      return `
    <tr class="${ci === 0 ? 'border-t-2 border-slate-200' : ''}">
      ${ci === 0 ? `<td class="font-medium align-top" rowspan="3">${escapeHtml(g.label)}${g.classes.length > 1 ? `<div class="text-[10px] text-slate-400 font-normal mt-0.5" title="${members}"><i class="fas fa-layer-group mr-1"></i>${g.classes.length} classes : ${members}</div>` : ''}</td>` : ''}
      <td>${categoryBadge(cat)}</td>
      ${ts.map(t => `<td>
        <div class="flex items-center gap-1">
          <input type="number" min="0" step="0.01" value="${feeMap[`${rep.id}-${t.id}-${cat}`] ?? ''}" id="fee-${rep.id}-${t.id}-${cat}" class="w-28 px-2 py-1 border rounded text-sm" placeholder="${cat === 'normal' ? 'Montant' : 'Défaut: normal'}">
          <button onclick="saveFee(${rep.id}, ${t.id}, '${cat}')" class="text-blue-600 text-xs" title="Enregistrer${g.classes.length > 1 ? ' (appliqué à tout le groupe)' : ''}"><i class="fas fa-save"></i></button>
          ${feeIdMap[`${rep.id}-${t.id}-${cat}`] !== undefined ? `<button onclick="deleteFee(${feeIdMap[`${rep.id}-${t.id}-${cat}`]})" class="text-red-500 text-xs" title="Supprimer ce frais${g.classes.length > 1 ? ' (retiré de tout le groupe)' : ''}"><i class="fas fa-trash"></i></button>` : ''}
        </div>
      </td>`).join('')}
    </tr>`
    }).join('')
  }).join('') || '<tr><td colspan="5" class="text-center text-slate-400 py-6">Aucune classe</td></tr>'
}

async function deleteFee(feeId) {
  if (!confirm('Supprimer ce frais ? Il sera retiré de toutes les classes du groupe. Les élèves de cette catégorie reviendront au tarif « normal » (ou à 0 si catégorie normale).')) return
  try {
    const res = await Api.del(`/api/admin/fee-structures/${feeId}`)
    toast(res.removed_from > 1 ? `Frais supprimé de ${res.removed_from} classes du groupe` : 'Frais supprimé', 'success')
    await loadFeesTable()
  } catch (err) { toast(err.message, 'error') }
}

async function saveFee(classId, trimesterId, categorie) {
  const input = document.getElementById(`fee-${classId}-${trimesterId}-${categorie}`)
  const montant = parseFloat(input.value)
  if (isNaN(montant) || montant < 0) return toast('Montant invalide', 'error')
  try {
    const res = await Api.post('/api/admin/fee-structures', { class_id: classId, trimester_id: trimesterId, montant, categorie })
    toast(res.applied_to > 1 ? `Frais enregistré (${categoryLabel(categorie)}) — appliqué à ${res.applied_to} classes du groupe` : `Frais enregistré (${categoryLabel(categorie)})`, 'success')
    await loadFeesTable()
  } catch (err) { toast(err.message, 'error') }
}

const FEES_EXPORT_COLUMNS = [
  { header: 'Classe', key: 'class_name' },
  { header: "Catégorie d'élève", key: 'categorie' },
  { header: '1er Trimestre', key: 't1' },
  { header: '2ème Trimestre', key: 't2' },
  { header: '3ème Trimestre', key: 't3' }
]

function exportFeesExcel() {
  exportTableToExcel({
    filename: `frais_scolaires_${todayStr()}`,
    sheetName: 'Frais scolaires',
    title: `Frais scolaires par classe, trimestre et catégorie — ${currentSchool ? currentSchool.name : ''}`,
    columns: FEES_EXPORT_COLUMNS,
    rows: feesExportData
  })
}

function exportFeesPdf() {
  exportTableToPdf({
    filename: `frais_scolaires_${todayStr()}`,
    title: 'Frais scolaires par classe, trimestre et catégorie',
    subtitle: currentSchool ? currentSchool.name : '',
    columns: FEES_EXPORT_COLUMNS,
    rows: feesExportData
  })
}


// ---------------------------------------------------------------------------
// RÉPARTITION DES QUOTAS
// ---------------------------------------------------------------------------
let currentQuotaTrimesterId = null
let currentQuotaDetail = null

function quotaMoney(n) { return fmtMoney(n, currentSchool?.currency) }

async function loadQuotasOverview() {
  const year = schoolYears.find(y => y.is_current) || schoolYears[0]
  const grid = document.getElementById('quotas-kpis')
  if (!year) { grid.innerHTML = '<p class="text-slate-400 text-sm col-span-full text-center py-6">Créez une année scolaire d\'abord</p>'; return }
  try {
    const { trimesters: ts } = await Api.get(`/api/quotas/overview?school_year_id=${year.id}`)
    grid.innerHTML = ts.map(t => `
      <div onclick="openQuotaTrimester(${t.trimester_id})" class="section-card cursor-pointer hover:shadow-md hover:border-blue-300 transition">
        <div class="flex items-center justify-between mb-3">
          <h3 class="font-bold text-slate-800">${escapeHtml(t.name)}</h3>
          <span class="badge badge-blue">${escapeHtml(year.label || year.name || '')}</span>
        </div>
        <div class="grid grid-cols-2 gap-2 text-center">
          <div class="bg-slate-50 rounded-lg p-2"><p class="text-xs text-slate-500">Perçu</p><p class="font-bold text-sm text-green-600">${quotaMoney(t.total_collected)}</p></div>
          <div class="bg-slate-50 rounded-lg p-2"><p class="text-xs text-slate-500">Quotas dus</p><p class="font-bold text-sm text-slate-800">${quotaMoney(t.due)}</p></div>
          <div class="bg-slate-50 rounded-lg p-2"><p class="text-xs text-slate-500">Réglé</p><p class="font-bold text-sm text-blue-600">${quotaMoney(t.settled)}</p></div>
          <div class="bg-slate-50 rounded-lg p-2"><p class="text-xs text-slate-500">Reste à régler</p><p class="font-bold text-sm ${t.remaining > 0 ? 'text-red-600' : 'text-slate-800'}">${quotaMoney(t.remaining)}</p></div>
        </div>
        <p class="text-xs text-blue-600 font-semibold mt-3 text-right">Ouvrir <i class="fas fa-arrow-right ml-1"></i></p>
      </div>`).join('') || '<p class="text-slate-400 text-sm col-span-full text-center py-6">Aucun trimestre</p>'
  } catch (err) { toast(err.message, 'error') }
}

function closeQuotaTrimester() {
  currentQuotaTrimesterId = null
  document.getElementById('quotas-detail-view').classList.add('hidden')
  document.getElementById('quotas-overview-view').classList.remove('hidden')
}

async function openQuotaTrimester(trimesterId) {
  currentQuotaTrimesterId = trimesterId
  document.getElementById('quotas-overview-view').classList.add('hidden')
  document.getElementById('quotas-detail-view').classList.remove('hidden')
  await loadQuotaDetail()
}

async function loadQuotaDetail() {
  try {
    const d = await Api.get(`/api/quotas/trimester/${currentQuotaTrimesterId}`)
    currentQuotaDetail = d
    document.getElementById('quotas-detail-title').textContent = `Répartition des quotas — ${d.trimester.name}`
    renderQuotaSettle(d)
    renderQuotaConfig(d)
    renderQuotaHistory(d)
  } catch (err) { toast(err.message, 'error') }
}

function renderQuotaSettle(d) {
  document.getElementById('quotas-settle').innerHTML = `
    <div class="flex items-center justify-between mb-3 flex-wrap gap-2">
      <h3 class="font-bold text-slate-800">Quotas à régler</h3>
      <span class="text-sm text-slate-500">Solde de l'école : <strong class="text-blue-600">${quotaMoney(d.cash_balance)}</strong> · Perçu ce trimestre : <strong class="text-green-600">${quotaMoney(d.total_collected)}</strong></span>
    </div>
    <table class="data-table"><thead><tr><th>Quota</th><th>Dû</th><th>Déjà réglé</th><th>Reste à régler</th><th></th></tr></thead><tbody>
    ${d.payable.map(p => `
      <tr>
        <td class="font-medium">${escapeHtml(p.label)}</td>
        <td>${quotaMoney(p.due)}</td>
        <td class="text-blue-600">${quotaMoney(p.settled)}</td>
        <td class="font-semibold ${p.remaining > 0 ? 'text-red-600' : ''}">${quotaMoney(p.remaining)}</td>
        <td><button onclick="settleQuota('${p.key}')" class="btn btn-primary" ${p.remaining > 0 ? '' : 'disabled style="opacity:.45;cursor:not-allowed"'}><i class="ph-bold ph-hand-coins"></i>Régler le quota</button></td>
      </tr>`).join('')}
      <tr class="bg-slate-50"><td class="font-medium">Frais de construction (retenus par l'école)</td><td>${quotaMoney(d.retained_ecole)}</td><td colspan="3" class="text-xs text-slate-400">Reste dans la caisse de l'école — aucun règlement</td></tr>
    </tbody></table>`
}

function quotaGroupRowId(key) { return 'q-' + key.replace(/[^a-zA-Z0-9]/g, '_') }

function renderQuotaConfig(d) {
  const rows = d.groups.map(g => {
    const id = quotaGroupRowId(g.key)
    const c = g.config
    const members = g.class_names.map(escapeHtml).join(', ')
    const inp = (f, v) => `<input type="number" min="0" step="0.01" id="${id}-${f}" value="${v || v === 0 ? v : ''}" oninput="updateQuotaRow('${g.key}')" class="w-24 px-2 py-1 border rounded text-sm" placeholder="0">`
    return `
    <tr data-group="${escapeHtml(g.key)}" data-fee="${g.fee}">
      <td class="font-medium align-top">${escapeHtml(g.label)}${g.class_ids.length > 1 ? `<div class="text-[10px] text-slate-400 font-normal mt-0.5" title="${members}"><i class="fas fa-layer-group mr-1"></i>${g.class_ids.length} classes : ${members}</div>` : ''}<div class="text-[10px] text-slate-400 font-normal">${g.students} élève(s) payant(s), indigents exclus</div></td>
      <td class="font-semibold">${g.fee > 0 ? quotaMoney(g.fee) : '<span class="text-xs text-red-500">Frais non fixé</span>'}</td>
      <td>${inp('ecole', c.ecole)}</td>
      <td>${inp('ecc', c.ecc)}</td>
      <td>${inp('fonctionnement', c.fonctionnement)}</td>
      <td>${inp('appui', c.appui_enseignants)}</td>
      <td>
        <div class="flex items-center gap-1 text-xs">
          <input type="number" min="0" max="100" step="0.01" id="${id}-pb" value="${c.pct_bureaux}" oninput="syncQuotaPct('${g.key}','pb')" class="w-16 px-1 py-1 border rounded text-sm" title="% bureaux de gestion"> %
          <span class="text-slate-400">/</span>
          <input type="number" min="0" max="100" step="0.01" id="${id}-pd" value="${round2js(100 - c.pct_bureaux)}" oninput="syncQuotaPct('${g.key}','pd')" class="w-16 px-1 py-1 border rounded text-sm" title="% enseignants debout"> %
        </div>
        <div class="text-[10px] text-slate-400 mt-0.5">bureaux / debout</div>
      </td>
      <td id="${id}-sum" class="text-sm"></td>
      <td><button onclick="saveQuotaGroup('${g.key}')" class="text-blue-600" title="Enregistrer ce groupe"><i class="fas fa-save"></i></button></td>
    </tr>`
  }).join('') || '<tr><td colspan="9" class="text-center text-slate-400 py-6">Aucune classe</td></tr>'
  document.getElementById('quotas-config').innerHTML = `
    <h3 class="font-bold text-slate-800 mb-3">Configuration des quotas (par élève)</h3>
    <table class="data-table"><thead><tr><th>Groupe de classes</th><th>Frais demandé</th><th>École (construction)</th><th>ECC</th><th>État : fonctionnement</th><th>État : appui aux enseignants</th><th>Répartition de l'appui</th><th>Total / Reste</th><th></th></tr></thead><tbody>${rows}</tbody></table>`
  d.groups.forEach(g => updateQuotaRow(g.key))
}

function round2js(n) { return Math.round((Number(n) + Number.EPSILON) * 100) / 100 }

function syncQuotaPct(key, src) {
  const id = quotaGroupRowId(key)
  const pb = document.getElementById(id + '-pb'), pd = document.getElementById(id + '-pd')
  const v = Math.min(100, Math.max(0, parseFloat((src === 'pb' ? pb : pd).value) || 0))
  if (src === 'pb') pd.value = round2js(100 - v); else pb.value = round2js(100 - v)
  updateQuotaRow(key)
}

function quotaRowValues(key) {
  const id = quotaGroupRowId(key)
  const n = f => parseFloat(document.getElementById(`${id}-${f}`).value) || 0
  return { ecole: n('ecole'), ecc: n('ecc'), fonctionnement: n('fonctionnement'), appui_enseignants: n('appui'), pct_bureaux: n('pb') }
}

/** Affiche en direct le total des quotas et le reste non réparti (rouge si dépassement). */
function updateQuotaRow(key) {
  const id = quotaGroupRowId(key)
  const tr = document.querySelector(`tr[data-group="${CSS.escape(key)}"]`)
  const fee = parseFloat(tr.dataset.fee) || 0
  const v = quotaRowValues(key)
  const sum = v.ecole + v.ecc + v.fonctionnement + v.appui_enseignants
  const over = sum > fee + 0.005
  const el = document.getElementById(id + '-sum')
  el.innerHTML = `<span class="${over ? 'text-red-600 font-semibold' : 'text-slate-700'}">${quotaMoney(round2js(sum))}</span><div class="text-[10px] ${over ? 'text-red-600' : 'text-slate-400'}">${over ? 'Dépasse le frais de ' + quotaMoney(round2js(sum - fee)) : 'Non réparti : ' + quotaMoney(round2js(fee - sum))}</div>`
}

async function saveQuotaGroup(key) {
  const v = quotaRowValues(key)
  try {
    await Api.put('/api/quotas/config', { trimester_id: currentQuotaTrimesterId, group_key: key, ...v })
    toast('Quotas enregistrés', 'success')
    await loadQuotaDetail()
  } catch (err) { toast(err.message, 'error') }
}

async function settleQuota(type) {
  const p = currentQuotaDetail.payable.find(x => x.key === type)
  if (!p || p.remaining <= 0) return
  if (!confirm(`Régler « ${p.label} » pour ${currentQuotaDetail.trimester.name} ?\n\nMontant : ${quotaMoney(p.remaining)}\nIl sera déduit du solde de l'école (${quotaMoney(currentQuotaDetail.cash_balance)}) et écrit dans le livre de caisse.`)) return
  try {
    await Api.post('/api/quotas/settle', { trimester_id: currentQuotaTrimesterId, quota_type: type, expected_amount: p.remaining, entry_date: todayStr() })
    toast('Quota réglé et inscrit au livre de caisse', 'success')
    await loadQuotaDetail()
  } catch (err) { toast(err.message, 'error'); await loadQuotaDetail() }
}

function renderQuotaHistory(d) {
  const label = k => (d.payable.find(p => p.key === k) || {}).short || k
  document.getElementById('quotas-history').innerHTML = `
    <h3 class="font-bold text-slate-800 mb-3">Historique des règlements</h3>
    <table class="data-table"><thead><tr><th>Date</th><th>Quota</th><th>Montant</th><th>Par</th><th></th></tr></thead><tbody>
    ${d.history.map(h => `<tr><td>${fmtDate(h.entry_date)}</td><td>${escapeHtml(label(h.quota_type))}</td><td class="text-red-600 font-semibold">${quotaMoney(h.montant)}</td><td>${escapeHtml(h.created_by_name || '—')}</td><td><button onclick="cancelQuotaSettlement(${h.id})" class="text-red-600 hover:underline text-xs" title="Annuler ce règlement (retire aussi la ligne du livre de caisse)"><i class="fas fa-rotate-left mr-1"></i>Annuler</button></td></tr>`).join('') || '<tr><td colspan="5" class="text-center text-slate-400 py-4">Aucun règlement</td></tr>'}
    </tbody></table>`
}

async function cancelQuotaSettlement(id) {
  if (!confirm('Annuler ce règlement ? La ligne correspondante sera retirée du livre de caisse et le montant redeviendra dû.')) return
  try { await Api.del(`/api/quotas/settlements/${id}`); toast('Règlement annulé', 'success'); await loadQuotaDetail() }
  catch (err) { toast(err.message, 'error') }
}

// ---------------------------------------------------------------------------
// PERCEPTION (vue 1 : cartes KPI par classe -> vue 2 : détail/registre journalier)
// ---------------------------------------------------------------------------
let currentPerceptionClass = null // { id, name }

function populatePerceptionSelectors() {
  const trimOptions = trimesters.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('')
  document.getElementById('perc-summary-trimester').innerHTML = trimOptions
  document.getElementById('perc-trimester').innerHTML = trimOptions
  document.getElementById('perc-summary-date').value = todayStr()
}

async function loadPerceptionClasses() {
  const trimesterId = document.getElementById('perc-summary-trimester').value
  const date = document.getElementById('perc-summary-date').value || todayStr()
  if (!trimesterId) return
  const data = await Api.get(`/api/perception/registre-summary?date=${date}&trimester_id=${trimesterId}`)

  document.getElementById('perception-classes-grid').innerHTML = data.classes.map(cl => `
    <div onclick="openPerceptionClass(${cl.class_id}, '${escapeHtml(cl.class_name)}')" class="section-card cursor-pointer hover:shadow-md hover:border-blue-300 transition">
      <div class="flex items-center justify-between mb-3">
        <h3 class="font-bold text-slate-800">${escapeHtml(cl.class_name)}</h3>
        <span class="badge badge-blue">${escapeHtml(cl.level || '—')}</span>${cl.option ? `<span class="badge badge-amber ml-1">${escapeHtml(cl.option)}</span>` : ''}
      </div>
      <div class="grid grid-cols-2 gap-2 text-center">
        <div class="bg-slate-50 rounded-lg p-2"><p class="text-xs text-slate-500">Ont payé</p><p class="font-bold text-sm text-slate-800">${cl.paid_count}/${cl.students_count}</p></div>
        <div class="bg-slate-50 rounded-lg p-2"><p class="text-xs text-slate-500">Perçu</p><p class="font-bold text-sm text-green-600">${fmtMoney(cl.total_collected, currentSchool?.currency)}</p></div>
      </div>
      <p class="text-xs text-blue-600 font-semibold mt-3 text-right">Ouvrir <i class="fas fa-arrow-right ml-1"></i></p>
    </div>`).join('') || '<p class="text-slate-400 text-sm col-span-full text-center py-6">Aucune classe</p>'
}

function openPerceptionClass(classId, className) {
  currentPerceptionClass = { id: classId, name: className }
  document.getElementById('perception-detail-title').textContent = className
  document.getElementById('perc-trimester').value = document.getElementById('perc-summary-trimester').value
  document.getElementById('perc-date').value = document.getElementById('perc-summary-date').value || todayStr()
  document.getElementById('perception-classes-view').classList.add('hidden')
  document.getElementById('perception-detail-view').classList.remove('hidden')
  loadRegistre()
  setAutoRefresh(loadRegistre) // le registre se met à jour tout seul (synchro)
}

function closePerceptionDetail() {
  currentPerceptionClass = null
  document.getElementById('perception-detail-view').classList.add('hidden')
  document.getElementById('perception-classes-view').classList.remove('hidden')
  loadPerceptionClasses()
  setAutoRefresh(loadPerceptionClasses)
}

let registreCache = null

async function loadRegistre() {
  if (!currentPerceptionClass) return
  const classId = currentPerceptionClass.id
  const trimesterId = document.getElementById('perc-trimester').value
  const date = document.getElementById('perc-date').value || todayStr()
  if (!classId || !trimesterId) return

  const data = await Api.get(`/api/perception/registre?class_id=${classId}&date=${date}&trimester_id=${trimesterId}`)
  registreCache = data

  document.getElementById('registre-summary').innerHTML = `
    <div class="stat-card"><p class="text-xs text-slate-500 mb-1">Élèves ayant payé ce jour</p><p class="text-xl font-bold text-slate-800">${data.count}</p></div>
    <div class="stat-card"><p class="text-xs text-slate-500 mb-1">Total perçu ce jour</p><p class="text-xl font-bold text-green-600">${fmtMoney(data.total, currentSchool?.currency)}</p></div>
    <div class="stat-card"><p class="text-xs text-slate-500 mb-1">Date</p><p class="text-xl font-bold text-slate-800">${fmtDate(data.date)}</p></div>
  `

  document.getElementById('registre-tbody').innerHTML = data.students.map((s, idx) => `
    <tr>
      <td>${idx + 1}</td>
      <td class="font-medium"><button onclick="showStudentReceipts(${s.id}, '${escapeHtml(s.nom)} ${escapeHtml(s.post_nom)}', ${trimesterId})" class="hover:underline hover:text-blue-600 text-left">${escapeHtml(s.nom)} ${escapeHtml(s.post_nom)}</button></td>
      <td>${categoryBadge(s.categorie)}</td>
      <td>${s.montant_jour ? fmtMoney(s.montant_jour, currentSchool?.currency) : '<span class="text-slate-400">—</span>'}</td>
      <td>${s.receipt_number ? `<span class="badge badge-green">${escapeHtml(s.receipt_number)}</span>${s.payments_count_today > 1 ? ` <span class="badge badge-blue">x${s.payments_count_today}</span>` : ''}` : '—'}</td>
      <td class="space-x-2 whitespace-nowrap">
        ${s.payment_id
          ? `<button onclick="printReceipt(${s.payment_id})" class="text-blue-600 hover:underline text-xs font-semibold" title="Imprimer le reçu"><i class="fas fa-print"></i> Reçu</button>
             <button onclick="showEditPaymentModal(${s.payment_id}, ${s.montant_jour}, '${data.date}', loadRegistre)" class="text-amber-600 hover:underline text-xs font-semibold" title="Modifier le reçu"><i class="fas fa-pen"></i></button>
             <button onclick="deletePayment(${s.payment_id}, loadRegistre)" class="text-red-600 hover:underline text-xs font-semibold" title="Supprimer le reçu"><i class="fas fa-trash"></i></button>
             <button onclick="cancelPayment(${s.payment_id})" class="text-slate-500 hover:underline text-xs font-semibold" title="Annuler (conserve la trace)"><i class="fas fa-rotate-left"></i></button>`
          : ''}
        <button onclick="showPayModal(${s.id}, '${escapeHtml(s.nom)} ${escapeHtml(s.post_nom)}', ${trimesterId})" class="bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded text-xs font-semibold"><i class="fas fa-hand-holding-dollar mr-1"></i>Percevoir</button>
      </td>
    </tr>`).join('') || '<tr><td colspan="6" class="text-center text-slate-400 py-6">Aucun élève dans cette classe</td></tr>'
}

const REGISTRE_EXPORT_COLUMNS = [
  { header: 'N°', key: 'num' },
  { header: 'Nom et Post-nom', key: 'full_name' },
  { header: 'Catégorie', key: 'cat' },
  { header: 'Montant du jour', key: 'montant' },
  { header: 'Reçu', key: 'receipt' }
]

function registreExportRows() {
  if (!registreCache) return []
  return registreCache.students.map((s, i) => ({
    num: i + 1,
    full_name: `${s.nom} ${s.post_nom}`,
    cat: categoryLabel(s.categorie),
    montant: s.montant_jour ? fmtMoney(s.montant_jour, currentSchool?.currency) : '',
    receipt: s.receipt_number || ''
  }))
}

function exportRegistreExcel() {
  if (!registreCache || !currentPerceptionClass) return toast('Affichez d\'abord un registre', 'error')
  const rows = registreExportRows()
  rows.push({ num: '', full_name: 'TOTAL DU JOUR', cat: '', montant: fmtMoney(registreCache.total, currentSchool?.currency), receipt: `${registreCache.count} paiement(s)` })
  exportTableToExcel({
    filename: `registre_${currentPerceptionClass.name.replace(/\s+/g, '_')}_${registreCache.date}`,
    sheetName: 'Registre',
    title: `Registre de perception — ${currentPerceptionClass.name} — ${fmtDate(registreCache.date)}`,
    columns: REGISTRE_EXPORT_COLUMNS,
    rows
  })
}

function exportRegistrePdf() {
  if (!registreCache || !currentPerceptionClass) return toast('Affichez d\'abord un registre', 'error')
  const rows = registreExportRows()
  rows.push({ num: '', full_name: 'TOTAL DU JOUR', cat: '', montant: fmtMoney(registreCache.total, currentSchool?.currency), receipt: `${registreCache.count} paiement(s)` })
  exportTableToPdf({
    filename: `registre_${currentPerceptionClass.name.replace(/\s+/g, '_')}_${registreCache.date}`,
    title: `Registre de perception — ${currentPerceptionClass.name}`,
    subtitle: `${currentSchool ? currentSchool.name : ''} — ${fmtDate(registreCache.date)}`,
    columns: REGISTRE_EXPORT_COLUMNS,
    rows
  })
}

// Affiche la liste des paiements d'un élève (toutes dates) pour ce trimestre,
// avec possibilité d'imprimer le reçu de n'importe lequel d'entre eux.
async function showStudentReceipts(studentId, studentName, trimesterId) {
  const situation = await Api.get(`/api/perception/student/${studentId}/situation?trimester_id=${trimesterId}`)
  const rows = (situation.payments || []).map(p => `
    <tr>
      <td>${fmtDate(p.date_paiement)}</td>
      <td>${fmtMoney(p.montant, currentSchool?.currency)}</td>
      <td><span class="badge badge-green">${escapeHtml(p.receipt_number)}</span></td>
      <td class="space-x-1 whitespace-nowrap">
        <button onclick="printReceipt(${p.id})" class="bg-blue-600 hover:bg-blue-700 text-white px-2.5 py-1 rounded text-xs font-semibold" title="Imprimer"><i class="fas fa-print"></i></button>
        <button onclick="closeModal(); showEditPaymentModal(${p.id}, ${p.montant}, '${p.date_paiement}', loadRegistre)" class="bg-amber-500 hover:bg-amber-600 text-white px-2.5 py-1 rounded text-xs font-semibold" title="Modifier"><i class="fas fa-pen"></i></button>
        <button onclick="closeModal(); deletePayment(${p.id}, loadRegistre)" class="bg-red-600 hover:bg-red-700 text-white px-2.5 py-1 rounded text-xs font-semibold" title="Supprimer"><i class="fas fa-trash"></i></button>
      </td>
    </tr>`).join('') || '<tr><td colspan="4" class="text-center text-slate-400 py-6">Aucun paiement enregistré ce trimestre</td></tr>'

  openModal(`
    <div class="p-6">
      <h3 class="text-lg font-bold text-slate-800 mb-1"><i class="fas fa-receipt mr-2 text-blue-600"></i>Paiements de ${escapeHtml(studentName)}</h3>
      <p class="text-sm text-slate-500 mb-4">Sélectionnez un paiement pour imprimer son reçu</p>
      <div class="grid grid-cols-3 gap-2 mb-4 text-center">
        <div class="bg-slate-50 rounded-lg p-2"><p class="text-xs text-slate-500">Frais fixé</p><p class="font-bold text-sm">${fmtMoney(situation.fee_amount, currentSchool?.currency)}</p></div>
        <div class="bg-slate-50 rounded-lg p-2"><p class="text-xs text-slate-500">Déjà payé</p><p class="font-bold text-sm text-green-600">${fmtMoney(situation.total_paid, currentSchool?.currency)}</p></div>
        <div class="bg-slate-50 rounded-lg p-2"><p class="text-xs text-slate-500">Solde dû</p><p class="font-bold text-sm text-red-600">${fmtMoney(situation.balance, currentSchool?.currency)}</p></div>
      </div>
      <div class="overflow-x-auto max-h-80 overflow-y-auto">
        <table class="data-table">
          <thead><tr><th>Date</th><th>Montant</th><th>Reçu</th><th>Action</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="flex justify-end pt-4">
        <button type="button" onclick="closeModal()" class="px-4 py-2 text-sm rounded-lg text-slate-600 hover:bg-slate-100">Fermer</button>
      </div>
    </div>`)
}

function printAllReceipts() {
  if (!currentPerceptionClass) return
  const date = document.getElementById('perc-date').value || todayStr()
  showDateRangePrintModal({
    title: 'Imprimer les reçus de la classe',
    subtitle: `${currentPerceptionClass.name} — choisissez la période`,
    defaultFrom: date,
    defaultTo: date,
    onConfirm: (dateFrom, dateTo) => {
      window.open(`/static/receipts-batch.html?class_id=${currentPerceptionClass.id}&date_from=${dateFrom}&date_to=${dateTo}`, '_blank')
    }
  })
}

// Impression des reçus d'UN OU PLUSIEURS percepteurs sur une période
// (onglet Rapport percepteur) : cases à cocher + plage de dates
async function printPercepteurReceipts() {
  const { staff } = await Api.get('/api/admin/staff?role=percepteur_et_admin')
  if (!staff || staff.length === 0) return toast('Aucun percepteur disponible', 'error')
  const currentId = document.getElementById('rp-percepteur').value
  // Reprend la période choisie dans le rapport (par défaut : aujourd'hui)
  const dateFrom = document.getElementById('rp-date-from').value || todayStr()
  const dateTo = document.getElementById('rp-date-to').value || dateFrom

  const checkboxes = staff.map(s => `
    <label class="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-slate-50 cursor-pointer border border-slate-200">
      <input type="checkbox" class="pp-check accent-blue-600" value="${s.id}" ${String(s.id) === String(currentId) ? 'checked' : ''}>
      <span class="text-sm">${escapeHtml(s.name)}${s.role === 'admin' ? ' <span class="text-xs text-slate-400">(admin)</span>' : ''}</span>
    </label>`).join('')

  openModal(`
    <div class="p-6">
      <h3 class="text-lg font-bold text-slate-800 mb-1"><i class="fas fa-print mr-2 text-slate-700"></i>Imprimer les reçus des percepteurs</h3>
      <p class="text-sm text-slate-500 mb-4">Cochez un ou plusieurs percepteurs, puis choisissez la période</p>
      <form id="pp-print-form" class="space-y-3">
        <div class="flex items-center justify-between">
          <label class="text-xs font-medium text-slate-600">Percepteurs *</label>
          <button type="button" id="pp-toggle-all" class="text-xs text-blue-600 hover:underline">Tout cocher / décocher</button>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-1">${checkboxes}</div>
        <div class="grid grid-cols-2 gap-3">
          <div><label class="text-xs font-medium text-slate-600">Du *</label>
            <input type="date" id="pp-from" value="${dateFrom}" required class="w-full mt-1 px-3 py-2 border rounded-lg text-sm"></div>
          <div><label class="text-xs font-medium text-slate-600">Au *</label>
            <input type="date" id="pp-to" value="${dateTo}" required class="w-full mt-1 px-3 py-2 border rounded-lg text-sm"></div>
        </div>
        <p class="text-xs text-slate-400"><i class="fas fa-info-circle mr-1"></i>Tous les reçus des percepteurs cochés sur la période seront regroupés dans une seule page d'impression (6 reçus par page A4).</p>
        <div class="flex justify-end gap-2 pt-2">
          <button type="button" onclick="closeModal()" class="px-4 py-2 text-sm rounded-lg text-slate-600 hover:bg-slate-100">Annuler</button>
          <button type="submit" class="px-4 py-2 text-sm rounded-lg bg-slate-700 hover:bg-slate-800 text-white font-semibold"><i class="fas fa-print mr-1"></i>Imprimer</button>
        </div>
      </form>
    </div>`)

  document.getElementById('pp-toggle-all').addEventListener('click', () => {
    const boxes = [...document.querySelectorAll('.pp-check')]
    const allChecked = boxes.every(b => b.checked)
    boxes.forEach(b => { b.checked = !allChecked })
  })

  document.getElementById('pp-print-form').addEventListener('submit', (e) => {
    e.preventDefault()
    const ids = [...document.querySelectorAll('.pp-check:checked')].map(b => b.value)
    if (ids.length === 0) return toast('Cochez au moins un percepteur', 'error')
    const dateFrom = document.getElementById('pp-from').value
    const dateTo = document.getElementById('pp-to').value
    if (!dateFrom || !dateTo) return toast('Les deux dates sont requises', 'error')
    if (dateFrom > dateTo) return toast('La date « Du » doit être antérieure ou égale à la date « Au »', 'error')
    closeModal()
    window.open(`/static/receipts-batch.html?percepteur_ids=${ids.join(',')}&date_from=${dateFrom}&date_to=${dateTo}`, '_blank')
  })
}

async function showPayModal(studentId, studentName, trimesterId) {
  const situation = await Api.get(`/api/perception/student/${studentId}/situation?trimester_id=${trimesterId}`)
  openModal(`
    <div class="p-6">
      <h3 class="text-lg font-bold text-slate-800 mb-1"><i class="fas fa-hand-holding-dollar mr-2 text-green-600"></i>Perception</h3>
      <p class="text-sm text-slate-500 mb-4">${escapeHtml(studentName)}</p>
      <div class="grid grid-cols-3 gap-2 mb-4 text-center">
        <div class="bg-slate-50 rounded-lg p-2"><p class="text-xs text-slate-500">Frais fixé</p><p class="font-bold text-sm">${fmtMoney(situation.fee_amount, currentSchool?.currency)}</p></div>
        <div class="bg-slate-50 rounded-lg p-2"><p class="text-xs text-slate-500">Déjà payé</p><p class="font-bold text-sm text-green-600">${fmtMoney(situation.total_paid, currentSchool?.currency)}</p></div>
        <div class="bg-slate-50 rounded-lg p-2"><p class="text-xs text-slate-500">Solde dû</p><p class="font-bold text-sm text-red-600">${fmtMoney(situation.balance, currentSchool?.currency)}</p></div>
      </div>
      <form id="pay-form" class="space-y-3">
        <div><label class="text-xs font-medium text-slate-600">Montant à percevoir *</label><input required type="number" step="0.01" min="0.01" max="${situation.balance}" id="pay-amount" class="w-full mt-1 px-3 py-2 border rounded-lg text-sm" placeholder="0.00">
          <p class="text-xs text-slate-400 mt-1"><i class="fas fa-circle-info mr-1"></i>Maximum autorisé : <span class="font-semibold text-slate-600">${fmtMoney(situation.balance, currentSchool?.currency)}</span> (le système refuse toute somme supérieure aux frais demandés)</p>
        </div>
        <div><label class="text-xs font-medium text-slate-600">Date de perception *</label><input required type="date" id="pay-date" value="${(document.getElementById('perc-date')?.value) || todayStr()}" class="w-full mt-1 px-3 py-2 border rounded-lg text-sm">
          <p class="text-xs text-slate-400 mt-1">Par défaut : aujourd'hui — vous pouvez choisir une autre date</p>
        </div>
        <div class="flex justify-end gap-2 pt-2">
          <button type="button" onclick="closeModal()" class="px-4 py-2 text-sm rounded-lg text-slate-600 hover:bg-slate-100">Annuler</button>
          <button type="submit" class="px-4 py-2 text-sm rounded-lg bg-green-600 hover:bg-green-700 text-white font-semibold">Enregistrer et générer le reçu</button>
        </div>
      </form>
    </div>`)
  document.getElementById('pay-form').addEventListener('submit', async (e) => {
    e.preventDefault()
    try {
      const montant = parseFloat(document.getElementById('pay-amount').value)
      if (montant > situation.balance) {
        toast(`Montant refusé : la somme saisie est supérieure aux frais demandés. Reste à payer : ${fmtMoney(situation.balance, currentSchool?.currency)} maximum.`, 'error')
        return
      }
      const result = await Api.post('/api/perception/pay', {
        student_id: studentId, trimester_id: trimesterId, montant,
        date_paiement: document.getElementById('pay-date').value || todayStr()
      })
      toast('Paiement enregistré : ' + result.receipt_number, 'success')
      closeModal()
      await loadRegistre()
      printReceipt(result.payment_id)
    } catch (err) { toast(err.message, 'error') }
  })
}

async function cancelPayment(paymentId) {
  if (!confirm('Annuler ce paiement ? Cette action ne peut pas être défaite facilement.')) return
  try {
    await Api.post(`/api/perception/payments/${paymentId}/cancel`)
    toast('Paiement annulé', 'success')
    await loadRegistre()
  } catch (err) { toast(err.message, 'error') }
}

// ---------------------------------------------------------------------------
// MODIFICATION / SUPPRESSION DES REÇUS (admin uniquement)
// ---------------------------------------------------------------------------
function showEditPaymentModal(paymentId, montant, datePaiement, onDone) {
  openModal(`
    <div class="p-6">
      <h3 class="text-lg font-bold text-slate-800 mb-1"><i class="fas fa-pen mr-2 text-blue-600"></i>Modifier le reçu</h3>
      <p class="text-sm text-slate-500 mb-4">Corriger le montant ou la date de ce paiement</p>
      <form id="edit-pay-form" class="space-y-3">
        <div><label class="text-xs font-medium text-slate-600">Montant *</label><input required type="number" step="0.01" min="0.01" id="edit-pay-amount" value="${montant}" class="w-full mt-1 px-3 py-2 border rounded-lg text-sm"></div>
        <div><label class="text-xs font-medium text-slate-600">Date de paiement *</label><input required type="date" id="edit-pay-date" value="${datePaiement}" class="w-full mt-1 px-3 py-2 border rounded-lg text-sm"></div>
        <div class="flex justify-end gap-2 pt-2">
          <button type="button" onclick="closeModal()" class="px-4 py-2 text-sm rounded-lg text-slate-600 hover:bg-slate-100">Annuler</button>
          <button type="submit" class="px-4 py-2 text-sm rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold">Enregistrer</button>
        </div>
      </form>
    </div>`)
  document.getElementById('edit-pay-form').addEventListener('submit', async (e) => {
    e.preventDefault()
    try {
      await Api.patch(`/api/perception/payments/${paymentId}`, {
        montant: parseFloat(document.getElementById('edit-pay-amount').value),
        date_paiement: document.getElementById('edit-pay-date').value
      })
      toast('Reçu modifié', 'success')
      closeModal()
      if (onDone) await onDone()
    } catch (err) { toast(err.message, 'error') }
  })
}

async function deletePayment(paymentId, onDone) {
  if (!confirm('SUPPRIMER définitivement ce reçu/paiement ? Cette action est irréversible et met à jour le livre de caisse.')) return
  try {
    await Api.del(`/api/perception/payments/${paymentId}`)
    toast('Reçu supprimé', 'success')
    if (onDone) await onDone()
  } catch (err) { toast(err.message, 'error') }
}

// ---------------------------------------------------------------------------
// RAPPORT JOURNALIER PAR PERCEPTEUR
// ---------------------------------------------------------------------------
let rapportPercepteurCache = null

async function populateRapportPercepteurSelector() {
  // L'admin perçoit aussi : il doit figurer dans la liste des percepteurs
  const { staff } = await Api.get('/api/admin/staff?role=percepteur_et_admin')
  document.getElementById('rp-percepteur').innerHTML =
    staff.map(s => `<option value="${s.id}">${escapeHtml(s.name)}${s.role === 'admin' ? ' (admin)' : ''}</option>`).join('') ||
    '<option value="">Aucun percepteur</option>'
  if (!document.getElementById('rp-date-from').value) document.getElementById('rp-date-from').value = todayStr()
  if (!document.getElementById('rp-date-to').value) document.getElementById('rp-date-to').value = todayStr()
}

// Libellé de la période : "22/10/2026" (un seul jour) ou "du 01/10/2026 au 22/10/2026"
function rpPeriodLabel(d) {
  return d.date_from === d.date_to ? fmtDate(d.date_from) : `du ${fmtDate(d.date_from)} au ${fmtDate(d.date_to)}`
}
function rpFileSuffix(d) {
  return d.date_from === d.date_to ? d.date_from : `${d.date_from}_au_${d.date_to}`
}
function rpReportTitle(d) {
  return d.date_from === d.date_to ? 'Rapport journalier par percepteur' : 'Rapport par percepteur (période)'
}

async function loadRapportPercepteur() {
  const percepteurId = document.getElementById('rp-percepteur').value
  const dateFrom = document.getElementById('rp-date-from').value || todayStr()
  const dateTo = document.getElementById('rp-date-to').value || dateFrom
  if (!percepteurId) return toast('Sélectionnez un percepteur', 'error')
  if (dateFrom > dateTo) return toast('La date « Du » doit être antérieure ou égale à la date « Au »', 'error')

  const data = await Api.get(`/api/perception/rapport-percepteur?percepteur_id=${percepteurId}&date_from=${dateFrom}&date_to=${dateTo}`)
  rapportPercepteurCache = data
  const cur = currentSchool?.currency
  const multi = data.date_from !== data.date_to // période : on affiche la colonne Date
  const periode = rpPeriodLabel(data)

  document.getElementById('rp-summary').innerHTML = `
    <div class="stat-card"><p class="text-xs text-slate-500 mb-1">Percepteur</p><p class="text-lg font-bold text-slate-800">${escapeHtml(data.percepteur.name)}</p></div>
    <div class="stat-card"><p class="text-xs text-slate-500 mb-1">Paiements perçus — ${periode}</p><p class="text-xl font-bold text-slate-800">${data.count}</p></div>
    <div class="stat-card"><p class="text-xs text-slate-500 mb-1">TOTAL PERÇU</p><p class="text-xl font-bold text-green-600">${fmtMoney(data.total, cur)}</p></div>
  `

  if (!data.classes.length) {
    document.getElementById('rp-content').innerHTML = `<div class="section-card text-center text-slate-400 py-10">Aucune perception enregistrée par ce percepteur ${multi ? 'sur cette période' : 'à cette date'}</div>`
    return
  }

  document.getElementById('rp-content').innerHTML = data.classes.map(cl => `
    <div class="section-card mb-4 overflow-x-auto">
      <div class="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h3 class="font-bold text-slate-800"><i class="fas fa-chalkboard mr-2 text-blue-600"></i>${escapeHtml(cl.class_name)}</h3>
        <span class="badge badge-green">Total classe : ${fmtMoney(cl.total, cur)} — ${cl.count} paiement(s)</span>
      </div>
      <table class="data-table">
        <thead><tr><th>N°</th>${multi ? '<th>Date</th>' : ''}<th>Élève</th><th>Catégorie</th><th>Trimestre</th><th>Montant</th><th>Reçu</th><th>Actions</th></tr></thead>
        <tbody>
          ${cl.payments.map((p, i) => `
          <tr>
            <td>${i + 1}</td>
            ${multi ? `<td class="whitespace-nowrap">${fmtDate(p.date_paiement)}</td>` : ''}
            <td class="font-medium">${escapeHtml(p.nom)} ${escapeHtml(p.post_nom)}</td>
            <td>${categoryBadge(p.categorie)}</td>
            <td>${escapeHtml(p.trimester_name)}</td>
            <td class="font-semibold">${fmtMoney(p.montant, cur)}</td>
            <td><span class="badge badge-green">${escapeHtml(p.receipt_number)}</span></td>
            <td class="space-x-2 whitespace-nowrap">
              <button onclick="printReceipt(${p.id})" class="text-blue-600 hover:underline text-xs font-semibold" title="Imprimer le reçu"><i class="fas fa-print"></i></button>
              <button onclick="showEditPaymentModal(${p.id}, ${p.montant}, '${p.date_paiement}', loadRapportPercepteur)" class="text-amber-600 hover:underline text-xs font-semibold" title="Modifier"><i class="fas fa-pen"></i></button>
              <button onclick="deletePayment(${p.id}, loadRapportPercepteur)" class="text-red-600 hover:underline text-xs font-semibold" title="Supprimer"><i class="fas fa-trash"></i></button>
            </td>
          </tr>`).join('')}
        </tbody>
        <tfoot><tr><td colspan="${multi ? 5 : 4}">TOTAL ${escapeHtml(cl.class_name)}</td><td colspan="3" class="text-green-700">${fmtMoney(cl.total, cur)}</td></tr></tfoot>
      </table>
    </div>`).join('') + `
    <div class="section-card bg-slate-800 text-white">
      <div class="flex items-center justify-between flex-wrap gap-2">
        <span class="font-bold"><i class="fas fa-coins mr-2 text-amber-400"></i>TOTAL GÉNÉRAL PERÇU PAR ${escapeHtml(data.percepteur.name).toUpperCase()} — ${periode}</span>
        <span class="text-xl font-extrabold text-green-400">${fmtMoney(data.total, cur)}</span>
      </div>
    </div>`
}

function rapportPercepteurRows() {
  const cur = currentSchool?.currency
  const rows = []
  for (const cl of rapportPercepteurCache.classes) {
    cl.payments.forEach((p, i) => rows.push({
      classe: cl.class_name,
      num: i + 1,
      date: fmtDate(p.date_paiement),
      eleve: `${p.nom} ${p.post_nom}`,
      cat: categoryLabel(p.categorie),
      trimestre: p.trimester_name,
      montant: fmtMoney(p.montant, cur),
      recu: p.receipt_number
    }))
    rows.push({ classe: cl.class_name, num: '', date: '', eleve: `TOTAL ${cl.class_name}`, cat: '', trimestre: '', montant: fmtMoney(cl.total, cur), recu: `${cl.count} paiement(s)` })
  }
  rows.push({ classe: '', num: '', date: '', eleve: 'TOTAL GÉNÉRAL', cat: '', trimestre: '', montant: fmtMoney(rapportPercepteurCache.total, cur), recu: `${rapportPercepteurCache.count} paiement(s)` })
  return rows
}

// La colonne Date n'apparaît dans les exports que pour une période (plusieurs jours)
function rpExportColumns(d) {
  const multi = d.date_from !== d.date_to
  return [
    { header: 'Classe', key: 'classe' },
    { header: 'N°', key: 'num' },
    ...(multi ? [{ header: 'Date', key: 'date' }] : []),
    { header: 'Élève', key: 'eleve' },
    { header: 'Catégorie', key: 'cat' },
    { header: 'Trimestre', key: 'trimestre' },
    { header: 'Montant', key: 'montant' },
    { header: 'Reçu', key: 'recu' }
  ]
}

function exportRapportPercepteurExcel() {
  if (!rapportPercepteurCache) return toast('Affichez d\'abord un rapport', 'error')
  const d = rapportPercepteurCache
  exportTableToExcel({
    filename: `rapport_percepteur_${d.percepteur.name.replace(/\s+/g, '_')}_${rpFileSuffix(d)}`,
    sheetName: 'Rapport percepteur',
    title: `${rpReportTitle(d)} — ${d.percepteur.name} — ${rpPeriodLabel(d)} — Total perçu : ${fmtMoney(d.total, currentSchool?.currency)}`,
    columns: rpExportColumns(d),
    rows: rapportPercepteurRows()
  })
}

function exportRapportPercepteurPdf() {
  if (!rapportPercepteurCache) return toast('Affichez d\'abord un rapport', 'error')
  const d = rapportPercepteurCache
  exportTableToPdf({
    filename: `rapport_percepteur_${d.percepteur.name.replace(/\s+/g, '_')}_${rpFileSuffix(d)}`,
    title: `${rpReportTitle(d)} — ${d.percepteur.name}`,
    subtitle: `${currentSchool ? currentSchool.name : ''} — ${rpPeriodLabel(d)} — TOTAL PERÇU : ${fmtMoney(d.total, currentSchool?.currency)}`,
    columns: rpExportColumns(d),
    rows: rapportPercepteurRows()
  })
}

function printRapportPercepteur() {
  if (!rapportPercepteurCache) return toast('Affichez d\'abord un rapport', 'error')
  const d = rapportPercepteurCache
  const cur = currentSchool?.currency
  const multi = d.date_from !== d.date_to
  const win = window.open('', '_blank')
  win.document.write(`<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>Rapport percepteur — ${escapeHtml(d.percepteur.name)} — ${rpFileSuffix(d)}</title>
    <style>
      body { font-family: 'Segoe UI', Arial, sans-serif; margin: 2rem; color: #1e293b; font-size: 13px; }
      h1 { font-size: 18px; margin-bottom: 2px; } h2 { font-size: 14px; margin: 18px 0 6px; }
      .sub { color: #64748b; font-size: 12px; margin-bottom: 14px; }
      table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
      th, td { border: 1px solid #cbd5e1; padding: 5px 8px; text-align: left; }
      th { background: #f1f5f9; font-size: 11px; text-transform: uppercase; }
      .total-row td { font-weight: bold; background: #f8fafc; }
      .grand-total { margin-top: 16px; padding: 12px; border: 2px solid #1e293b; font-weight: bold; font-size: 15px; display: flex; justify-content: space-between; }
      @media print { body { margin: 0.8cm; } }
    </style></head><body>
    <h1>${escapeHtml(currentSchool ? currentSchool.name : '')} — ${rpReportTitle(d)}</h1>
    <p class="sub">Percepteur : <b>${escapeHtml(d.percepteur.name)}</b> &nbsp;|&nbsp; ${multi ? 'Période' : 'Date'} : <b>${rpPeriodLabel(d)}</b> &nbsp;|&nbsp; ${d.count} paiement(s)</p>
    ${d.classes.map(cl => `
      <h2>Classe : ${escapeHtml(cl.class_name)}</h2>
      <table>
        <thead><tr><th>N°</th>${multi ? '<th>Date</th>' : ''}<th>Élève</th><th>Catégorie</th><th>Trimestre</th><th>Montant</th><th>Reçu</th></tr></thead>
        <tbody>
          ${cl.payments.map((p, i) => `<tr><td>${i + 1}</td>${multi ? `<td>${fmtDate(p.date_paiement)}</td>` : ''}<td>${escapeHtml(p.nom)} ${escapeHtml(p.post_nom)}</td><td>${categoryLabel(p.categorie)}</td><td>${escapeHtml(p.trimester_name)}</td><td>${fmtMoney(p.montant, cur)}</td><td>${escapeHtml(p.receipt_number)}</td></tr>`).join('')}
          <tr class="total-row"><td colspan="${multi ? 5 : 4}">TOTAL ${escapeHtml(cl.class_name)}</td><td colspan="2">${fmtMoney(cl.total, cur)}</td></tr>
        </tbody>
      </table>`).join('')}
    <div class="grand-total"><span>TOTAL GÉNÉRAL PERÇU</span><span>${fmtMoney(d.total, cur)}</span></div>
    <p class="sub" style="margin-top:24px">Signature du percepteur : ________________________ &nbsp;&nbsp;&nbsp; Visa de la direction : ________________________</p>
    <script>window.onload = () => window.print()<\/script>
    </body></html>`)
  win.document.close()
}

function printReceipt(paymentId) {
  window.open(`/static/receipts-batch.html?payment_id=${paymentId}`, '_blank')
}

// ---------------------------------------------------------------------------
// DETTES (vue 1 : cartes KPI par classe -> vue 2 : détail des dettes d'une classe)
// ---------------------------------------------------------------------------
let currentDebtsClass = null // { id, name }

function populateDebtSelectors() {
  document.getElementById('debt-summary-trimester').innerHTML = trimesters.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('')
}

async function loadDebtsClasses() {
  const trimesterId = document.getElementById('debt-summary-trimester').value
  if (!trimesterId) return
  const data = await Api.get(`/api/perception/debts-summary?trimester_id=${trimesterId}`)

  document.getElementById('debts-classes-grid').innerHTML = data.classes.map(cl => `
    <div onclick="openDebtsClass(${cl.class_id}, '${escapeHtml(cl.class_name)}')" class="section-card cursor-pointer hover:shadow-md hover:border-blue-300 transition">
      <div class="flex items-center justify-between mb-3">
        <h3 class="font-bold text-slate-800">${escapeHtml(cl.class_name)}</h3>
        <span class="badge badge-blue">${escapeHtml(cl.level || '—')}</span>${cl.option ? `<span class="badge badge-amber ml-1">${escapeHtml(cl.option)}</span>` : ''}
      </div>
      <div class="grid grid-cols-2 gap-2 text-center">
        <div class="bg-slate-50 rounded-lg p-2"><p class="text-xs text-slate-500">Endettés</p><p class="font-bold text-sm ${cl.debtors_count > 0 ? 'text-red-600' : 'text-green-600'}">${cl.debtors_count}</p></div>
        <div class="bg-slate-50 rounded-lg p-2"><p class="text-xs text-slate-500">Total dette</p><p class="font-bold text-sm text-red-600">${fmtMoney(cl.total_debt, currentSchool?.currency)}</p></div>
      </div>
      <p class="text-xs text-blue-600 font-semibold mt-3 text-right">Ouvrir <i class="fas fa-arrow-right ml-1"></i></p>
    </div>`).join('') || '<p class="text-slate-400 text-sm col-span-full text-center py-6">Aucune classe</p>'
}

function openDebtsClass(classId, className) {
  currentDebtsClass = { id: classId, name: className }
  document.getElementById('debts-detail-title').textContent = className
  document.getElementById('debts-classes-view').classList.add('hidden')
  document.getElementById('debts-detail-view').classList.remove('hidden')
  loadDebts()
}

function closeDebtsDetail() {
  currentDebtsClass = null
  document.getElementById('debts-detail-view').classList.add('hidden')
  document.getElementById('debts-classes-view').classList.remove('hidden')
  loadDebtsClasses()
}

let debtsCache = null

async function loadDebts() {
  if (!currentDebtsClass) return
  const trimesterId = document.getElementById('debt-summary-trimester').value
  const classId = currentDebtsClass.id
  if (!trimesterId) return
  const data = await Api.get(`/api/perception/debts?trimester_id=${trimesterId}&class_id=${classId}`)
  debtsCache = data

  document.getElementById('debts-summary').innerHTML = `
    <div class="stat-card"><p class="text-xs text-slate-500 mb-1">Élèves endettés</p><p class="text-xl font-bold text-red-600">${data.count}</p></div>
    <div class="stat-card"><p class="text-xs text-slate-500 mb-1">Total des dettes</p><p class="text-xl font-bold text-red-600">${fmtMoney(data.total_debt, currentSchool?.currency)}</p></div>
  `

  document.getElementById('debts-tbody').innerHTML = data.debts.map(d => `
    <tr>
      <td class="font-medium">${escapeHtml(d.nom)} ${escapeHtml(d.post_nom)}</td>
      <td>${categoryBadge(d.categorie)}</td>
      <td>${fmtMoney(d.fee_amount, currentSchool?.currency)}</td>
      <td class="text-green-600">${fmtMoney(d.total_paid, currentSchool?.currency)}</td>
      <td class="text-red-600 font-semibold">${fmtMoney(d.balance, currentSchool?.currency)}</td>
    </tr>`).join('') || '<tr><td colspan="5" class="text-center text-slate-400 py-6">Aucune dette : tous les frais sont soldés 🎉</td></tr>'
}

const DEBTS_EXPORT_COLUMNS = [
  { header: 'Nom et Post-nom', key: 'full_name' },
  { header: 'Catégorie', key: 'cat' },
  { header: 'Frais fixé', key: 'fee' },
  { header: 'Payé', key: 'paid' },
  { header: 'Dette restante', key: 'balance' }
]

function debtsExportRows() {
  if (!debtsCache) return []
  const rows = debtsCache.debts.map(d => ({
    full_name: `${d.nom} ${d.post_nom}`,
    cat: categoryLabel(d.categorie),
    fee: fmtMoney(d.fee_amount, currentSchool?.currency),
    paid: fmtMoney(d.total_paid, currentSchool?.currency),
    balance: fmtMoney(d.balance, currentSchool?.currency)
  }))
  rows.push({ full_name: 'TOTAL', cat: '', fee: '', paid: '', balance: fmtMoney(debtsCache.total_debt, currentSchool?.currency) })
  return rows
}

function exportDebtsExcel() {
  if (!debtsCache || !currentDebtsClass) return toast('Affichez d\'abord une liste de dettes', 'error')
  exportTableToExcel({
    filename: `dettes_${currentDebtsClass.name.replace(/\s+/g, '_')}_${todayStr()}`,
    sheetName: 'Dettes',
    title: `Liste des dettes — ${currentDebtsClass.name} — ${currentSchool ? currentSchool.name : ''}`,
    columns: DEBTS_EXPORT_COLUMNS,
    rows: debtsExportRows()
  })
}

function exportDebtsPdf() {
  if (!debtsCache || !currentDebtsClass) return toast('Affichez d\'abord une liste de dettes', 'error')
  exportTableToPdf({
    filename: `dettes_${currentDebtsClass.name.replace(/\s+/g, '_')}_${todayStr()}`,
    title: `Liste des dettes — ${currentDebtsClass.name}`,
    subtitle: `${currentSchool ? currentSchool.name : ''} — ${debtsCache.count} élève(s) endetté(s)`,
    columns: DEBTS_EXPORT_COLUMNS,
    rows: debtsExportRows()
  })
}

// ---------------------------------------------------------------------------
// BUDGET (prévision vs réalisé)
// ---------------------------------------------------------------------------
function populateBudgetSelectors() {
  const sel = document.getElementById('budget-trimester')
  sel.innerHTML = '<option value="">Annuel (toute l\'année)</option>' + trimesters.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('')
}

let budgetCache = []

async function loadBudget() {
  const trimesterId = document.getElementById('budget-trimester').value
  const url = trimesterId ? `/api/budget/comparison?trimester_id=${trimesterId}` : '/api/budget/comparison'
  const { rows } = await Api.get(url)
  budgetCache = rows
  document.getElementById('budget-tbody').innerHTML = rows.map(r => `
    <tr>
      <td class="font-medium">${escapeHtml(r.category_name)}</td>
      <td><span class="badge ${r.type === 'RECETTE' ? 'badge-green' : 'badge-red'}">${r.type === 'RECETTE' ? 'Recette' : 'Dépense'}</span></td>
      <td>${fmtMoney(r.prevu, currentSchool?.currency)}</td>
      <td>${fmtMoney(r.realise, currentSchool?.currency)}</td>
      <td class="${r.ecart >= 0 ? 'text-green-600' : 'text-red-600'} font-semibold">${r.ecart >= 0 ? '+' : ''}${fmtMoney(r.ecart, currentSchool?.currency)}</td>
      <td>${r.taux !== null ? r.taux + '%' : '—'}</td>
    </tr>`).join('') || '<tr><td colspan="6" class="text-center text-slate-400 py-6">Aucune catégorie budgétaire</td></tr>'
}

const BUDGET_EXPORT_COLUMNS = [
  { header: 'Catégorie', key: 'category_name' },
  { header: 'Type', key: 'type_label' },
  { header: 'Prévu', key: 'prevu_f' },
  { header: 'Réalisé', key: 'realise_f' },
  { header: 'Écart', key: 'ecart_f' },
  { header: 'Taux', key: 'taux_f' }
]

function budgetExportRows() {
  return budgetCache.map(r => ({
    category_name: r.category_name,
    type_label: r.type === 'RECETTE' ? 'Recette' : 'Dépense',
    prevu_f: fmtMoney(r.prevu, currentSchool?.currency),
    realise_f: fmtMoney(r.realise, currentSchool?.currency),
    ecart_f: (r.ecart >= 0 ? '+' : '') + fmtMoney(r.ecart, currentSchool?.currency),
    taux_f: r.taux !== null ? r.taux + '%' : '—'
  }))
}

function exportBudgetExcel() {
  if (!budgetCache.length) return toast('Aucune donnée budgétaire à exporter', 'error')
  exportTableToExcel({
    filename: `budget_${todayStr()}`,
    sheetName: 'Budget',
    title: `Prévision budgétaire (prévu vs réalisé) — ${currentSchool ? currentSchool.name : ''}`,
    columns: BUDGET_EXPORT_COLUMNS,
    rows: budgetExportRows()
  })
}

function exportBudgetPdf() {
  if (!budgetCache.length) return toast('Aucune donnée budgétaire à exporter', 'error')
  exportTableToPdf({
    filename: `budget_${todayStr()}`,
    title: 'Prévision budgétaire (prévu vs réalisé)',
    subtitle: currentSchool ? currentSchool.name : '',
    columns: BUDGET_EXPORT_COLUMNS,
    rows: budgetExportRows()
  })
}

async function showAddPrevisionModal() {
  const { categories } = await Api.get('/api/admin/budget-categories')
  openModal(`
    <div class="p-6">
      <h3 class="text-lg font-bold text-slate-800 mb-4"><i class="fas fa-chart-pie mr-2 text-blue-600"></i>Définir une prévision budgétaire</h3>
      <form id="prevision-form" class="space-y-3">
        <div><label class="text-xs font-medium text-slate-600">Catégorie *</label>
          <select required id="pv-category" class="w-full mt-1 px-3 py-2 border rounded-lg text-sm">
            ${categories.map(c => `<option value="${c.id}">${c.type === 'RECETTE' ? '🟢' : '🔴'} ${escapeHtml(c.name)}</option>`).join('')}
          </select>
        </div>
        <div><label class="text-xs font-medium text-slate-600">Portée</label>
          <select id="pv-trimester" class="w-full mt-1 px-3 py-2 border rounded-lg text-sm">
            <option value="">Annuel</option>
            ${trimesters.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('')}
          </select>
        </div>
        <div><label class="text-xs font-medium text-slate-600">Montant prévu *</label><input required type="number" step="0.01" min="0" id="pv-amount" class="w-full mt-1 px-3 py-2 border rounded-lg text-sm"></div>
        <div><label class="text-xs font-medium text-slate-600">Notes</label><textarea id="pv-notes" class="w-full mt-1 px-3 py-2 border rounded-lg text-sm" rows="2"></textarea></div>
        <div class="flex justify-end gap-2 pt-2">
          <button type="button" onclick="closeModal()" class="px-4 py-2 text-sm rounded-lg text-slate-600 hover:bg-slate-100">Annuler</button>
          <button type="submit" class="px-4 py-2 text-sm rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold">Enregistrer</button>
        </div>
      </form>
    </div>`)
  document.getElementById('prevision-form').addEventListener('submit', async (e) => {
    e.preventDefault()
    try {
      await Api.post('/api/budget/previsions', {
        budget_category_id: document.getElementById('pv-category').value,
        trimester_id: document.getElementById('pv-trimester').value || null,
        montant_prevu: parseFloat(document.getElementById('pv-amount').value),
        notes: document.getElementById('pv-notes').value
      })
      toast('Prévision enregistrée', 'success')
      closeModal()
      loadBudget()
    } catch (err) { toast(err.message, 'error') }
  })
}

// ---------------------------------------------------------------------------
// LIVRE DE CAISSE
// ---------------------------------------------------------------------------
let cashbookCache = null

async function loadCashbook() {
  const from = document.getElementById('cb-from').value
  const to = document.getElementById('cb-to').value
  let url = '/api/cashbook'
  const params = []
  if (from) params.push(`from=${from}`)
  if (to) params.push(`to=${to}`)
  if (params.length) url += '?' + params.join('&')

  const data = await Api.get(url)
  cashbookCache = data

  document.getElementById('cashbook-summary').innerHTML = `
    <div class="stat-card"><p class="text-xs text-slate-500 mb-1">Total Entrées</p><p class="text-xl font-bold text-green-600">${fmtMoney(data.total_entree, currentSchool?.currency)}</p></div>
    <div class="stat-card"><p class="text-xs text-slate-500 mb-1">Total Sorties</p><p class="text-xl font-bold text-red-600">${fmtMoney(data.total_sortie, currentSchool?.currency)}</p></div>
    <div class="stat-card"><p class="text-xs text-slate-500 mb-1">Solde final</p><p class="text-xl font-bold text-blue-600">${fmtMoney(data.solde_final, currentSchool?.currency)}</p></div>
  `

  const initRow = `<tr class="bg-slate-50"><td colspan="6" class="font-semibold">Solde initial</td><td class="font-bold">${fmtMoney(data.solde_initial, currentSchool?.currency)}</td><td></td></tr>`

  document.getElementById('cashbook-tbody').innerHTML = initRow + data.entries.map(e => `
    <tr>
      <td>${fmtDate(e.entry_date)}</td>
      <td>${e.code ? `<span class="badge badge-gray">${escapeHtml(e.code)}</span>` : '—'}</td>
      <td class="font-medium">${escapeHtml(e.libelle)} ${e.is_auto ? '<span class="badge badge-blue ml-1">Auto</span>' : ''}${e.quota_settlement_id ? '<span class="badge badge-amber ml-1">Quota</span>' : ''}</td>
      <td>${escapeHtml(e.ref || '—')}</td>
      <td class="text-green-600">${e.entree ? fmtMoney(e.entree, currentSchool?.currency) : ''}</td>
      <td class="text-red-600">${e.sortie ? fmtMoney(e.sortie, currentSchool?.currency) : ''}</td>
      <td class="font-semibold">${fmtMoney(e.solde, currentSchool?.currency)}</td>
      <td>${e.is_auto ? '<span class="text-xs text-slate-400">Généré par perception</span>' : e.quota_settlement_id ? '<span class="text-xs text-slate-400">Règlement de quota</span>' : `<button onclick="deleteCashbookEntry(${e.id})" class="text-red-600 hover:underline text-xs"><i class="fas fa-trash"></i></button>`}</td>
    </tr>`).join('')
}

function clearCashbookFilter() {
  document.getElementById('cb-from').value = ''
  document.getElementById('cb-to').value = ''
  loadCashbook()
}

/** Ouvre la page d'impression A4 du livre de caisse (en respectant le filtre de période actif). */
function printCashbook() {
  const from = document.getElementById('cb-from').value
  const to = document.getElementById('cb-to').value
  const params = []
  if (from) params.push(`from=${from}`)
  if (to) params.push(`to=${to}`)
  const url = '/print/cashbook.html' + (params.length ? '?' + params.join('&') : '')
  window.open(url, '_blank')
}

const CASHBOOK_EXPORT_COLUMNS = [
  { header: 'Date', key: 'date_f' },
  { header: 'Code', key: 'code' },
  { header: 'Libellé', key: 'libelle' },
  { header: 'Réf.', key: 'ref' },
  { header: 'Entrée', key: 'entree_f' },
  { header: 'Sortie', key: 'sortie_f' },
  { header: 'Solde', key: 'solde_f' }
]

function cashbookExportRows() {
  if (!cashbookCache) return []
  const cur = currentSchool?.currency
  const rows = [{ date_f: '', code: '', libelle: 'SOLDE INITIAL', ref: '', entree_f: '', sortie_f: '', solde_f: fmtMoney(cashbookCache.solde_initial, cur) }]
  for (const e of cashbookCache.entries) {
    rows.push({
      date_f: fmtDate(e.entry_date),
      code: e.code || '',
      libelle: e.libelle,
      ref: e.ref || '',
      entree_f: e.entree ? fmtMoney(e.entree, cur) : '',
      sortie_f: e.sortie ? fmtMoney(e.sortie, cur) : '',
      solde_f: fmtMoney(e.solde, cur)
    })
  }
  rows.push({ date_f: '', code: '', libelle: 'TOTAUX', ref: '', entree_f: fmtMoney(cashbookCache.total_entree, cur), sortie_f: fmtMoney(cashbookCache.total_sortie, cur), solde_f: fmtMoney(cashbookCache.solde_final, cur) })
  return rows
}

function exportCashbookExcel() {
  if (!cashbookCache) return toast('Chargez d\'abord le livre de caisse', 'error')
  exportTableToExcel({
    filename: `livre_de_caisse_${todayStr()}`,
    sheetName: 'Livre de caisse',
    title: `Livre de caisse — ${currentSchool ? currentSchool.name : ''}`,
    columns: CASHBOOK_EXPORT_COLUMNS,
    rows: cashbookExportRows()
  })
}

function exportCashbookPdf() {
  if (!cashbookCache) return toast('Chargez d\'abord le livre de caisse', 'error')
  exportTableToPdf({
    filename: `livre_de_caisse_${todayStr()}`,
    title: 'Livre de caisse',
    subtitle: currentSchool ? currentSchool.name : '',
    columns: CASHBOOK_EXPORT_COLUMNS,
    rows: cashbookExportRows(),
    orientation: 'landscape'
  })
}

async function showAddCashbookModal() {
  const { categories } = await Api.get('/api/admin/budget-categories')
  openModal(`
    <div class="p-6">
      <h3 class="text-lg font-bold text-slate-800 mb-4"><i class="fas fa-book mr-2 text-blue-600"></i>Nouvelle opération au livre de caisse</h3>
      <form id="cashbook-form" class="space-y-3">
        <div class="grid grid-cols-2 gap-3">
          <div><label class="text-xs font-medium text-slate-600">Date *</label><input required type="date" id="cbe-date" value="${todayStr()}" class="w-full mt-1 px-3 py-2 border rounded-lg text-sm"></div>
          <div><label class="text-xs font-medium text-slate-600">Code pièce</label>
            <select id="cbe-code" class="w-full mt-1 px-3 py-2 border rounded-lg text-sm">
              <option value="">—</option><option value="F">F - Facture</option><option value="B">B - Bon</option><option value="R">R - Reçu</option><option value="AUT">AUT - Autodéclaration</option>
            </select>
          </div>
        </div>
        <div><label class="text-xs font-medium text-slate-600">Libellé *</label><input required id="cbe-libelle" class="w-full mt-1 px-3 py-2 border rounded-lg text-sm" placeholder="ex: Transport 5 sacs ciment"></div>
        <div><label class="text-xs font-medium text-slate-600">Référence</label><input id="cbe-ref" placeholder="ex: B12/25 ou F2260" class="w-full mt-1 px-3 py-2 border rounded-lg text-sm"></div>
        <div><label class="text-xs font-medium text-slate-600">Catégorie budgétaire</label>
          <select id="cbe-category" class="w-full mt-1 px-3 py-2 border rounded-lg text-sm">
            <option value="">— Aucune —</option>
            ${categories.map(c => `<option value="${c.id}">${c.type === 'RECETTE' ? '🟢' : '🔴'} ${escapeHtml(c.name)}</option>`).join('')}
          </select>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div><label class="text-xs font-medium text-slate-600">Entrée</label><input type="number" step="0.01" min="0" id="cbe-entree" class="w-full mt-1 px-3 py-2 border rounded-lg text-sm" placeholder="0.00"></div>
          <div><label class="text-xs font-medium text-slate-600">Sortie</label><input type="number" step="0.01" min="0" id="cbe-sortie" class="w-full mt-1 px-3 py-2 border rounded-lg text-sm" placeholder="0.00"></div>
        </div>
        <p class="text-xs text-slate-400">Remplir soit "Entrée" soit "Sortie" (jamais les deux).</p>
        <div class="flex justify-end gap-2 pt-2">
          <button type="button" onclick="closeModal()" class="px-4 py-2 text-sm rounded-lg text-slate-600 hover:bg-slate-100">Annuler</button>
          <button type="submit" class="px-4 py-2 text-sm rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold">Enregistrer</button>
        </div>
      </form>
    </div>`)
  document.getElementById('cashbook-form').addEventListener('submit', async (e) => {
    e.preventDefault()
    try {
      await Api.post('/api/cashbook', {
        entry_date: document.getElementById('cbe-date').value,
        code: document.getElementById('cbe-code').value,
        libelle: document.getElementById('cbe-libelle').value,
        ref: document.getElementById('cbe-ref').value,
        entree: parseFloat(document.getElementById('cbe-entree').value) || 0,
        sortie: parseFloat(document.getElementById('cbe-sortie').value) || 0,
        budget_category_id: document.getElementById('cbe-category').value || null
      })
      toast('Opération enregistrée', 'success')
      closeModal()
      loadCashbook()
    } catch (err) { toast(err.message, 'error') }
  })
}

async function deleteCashbookEntry(id) {
  if (!confirm('Supprimer cette opération ?')) return
  try { await Api.del(`/api/cashbook/${id}`); toast('Supprimé', 'success'); loadCashbook() }
  catch (err) { toast(err.message, 'error') }
}

// ---------------------------------------------------------------------------
// RAPPORTS FINANCIERS
// ---------------------------------------------------------------------------
function buildReportTabs() {
  document.getElementById('report-tabs').innerHTML = trimesters.map((t, i) => `
    <div class="tab-btn ${i === 0 ? 'active' : ''}" onclick="selectReportTab(${t.id}, this)">${escapeHtml(t.name)}</div>
  `).join('')
  if (trimesters.length) loadReport(trimesters[0].id)
}

function selectReportTab(trimesterId, el) {
  document.querySelectorAll('#report-tabs .tab-btn').forEach(b => b.classList.remove('active'))
  el.classList.add('active')
  loadReport(trimesterId)
}

let reportCache = null

async function loadReport(trimesterId) {
  document.getElementById('report-content').innerHTML = '<div class="loader"></div>'
  const data = await Api.get(`/api/reports/trimester/${trimesterId}`)
  reportCache = data
  const s = data.summary
  document.getElementById('report-content').innerHTML = `
    <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
      <div class="stat-card"><p class="text-xs text-slate-500 mb-1">Frais attendus</p><p class="text-lg font-bold text-slate-800">${fmtMoney(s.total_attendu, currentSchool?.currency)}</p></div>
      <div class="stat-card"><p class="text-xs text-slate-500 mb-1">Frais perçus</p><p class="text-lg font-bold text-green-600">${fmtMoney(s.total_percu, currentSchool?.currency)}</p></div>
      <div class="stat-card"><p class="text-xs text-slate-500 mb-1">Solde restant dû</p><p class="text-lg font-bold text-red-600">${fmtMoney(s.solde_frais, currentSchool?.currency)}</p></div>
      <div class="stat-card"><p class="text-xs text-slate-500 mb-1">Taux de recouvrement</p><p class="text-lg font-bold text-blue-600">${s.taux_recouvrement !== null ? s.taux_recouvrement + '%' : '—'}</p></div>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div class="section-card">
        <h3 class="font-bold text-slate-800 mb-3"><i class="fas fa-chalkboard mr-2 text-blue-600"></i>Détail par classe</h3>
        <table class="data-table"><thead><tr><th>Classe</th><th>Élèves</th><th>Attendu</th><th>Perçu</th><th>Taux</th></tr></thead>
          <tbody>${data.class_details.map(c => `<tr><td class="font-medium">${escapeHtml(c.class_name)}</td><td>${c.student_count}</td><td>${fmtMoney(c.attendu, currentSchool?.currency)}</td><td class="text-green-600">${fmtMoney(c.percu, currentSchool?.currency)}</td><td>${c.taux !== null ? c.taux + '%' : '—'}</td></tr>`).join('') || '<tr><td colspan="5" class="text-center text-slate-400 py-4">Aucune donnée</td></tr>'}</tbody>
        </table>
      </div>

      <div class="section-card">
        <h3 class="font-bold text-slate-800 mb-3"><i class="fas fa-money-bill-wave mr-2 text-red-600"></i>Dépenses par catégorie</h3>
        <table class="data-table"><thead><tr><th>Catégorie</th><th>Montant</th></tr></thead>
          <tbody>${data.expenses_by_category.map(e => `<tr><td class="font-medium">${escapeHtml(e.category_name)}</td><td class="text-red-600">${fmtMoney(e.total, currentSchool?.currency)}</td></tr>`).join('') || '<tr><td colspan="2" class="text-center text-slate-400 py-4">Aucune dépense catégorisée</td></tr>'}</tbody>
          <tfoot><tr><td>Total Entrées Caisse</td><td class="text-green-600">${fmtMoney(s.total_entree_caisse, currentSchool?.currency)}</td></tr><tr><td>Total Sorties Caisse</td><td class="text-red-600">${fmtMoney(s.total_sortie_caisse, currentSchool?.currency)}</td></tr></tfoot>
        </table>
      </div>
    </div>

    <div class="section-card mt-6">
      <h3 class="font-bold text-slate-800 mb-3"><i class="fas fa-triangle-exclamation mr-2 text-amber-600"></i>Top 10 des débiteurs</h3>
      <table class="data-table"><thead><tr><th>Élève</th><th>Classe</th><th>Dette</th></tr></thead>
        <tbody>${data.top_debtors.map(d => `<tr><td class="font-medium">${escapeHtml(d.nom)} ${escapeHtml(d.post_nom)}</td><td>${escapeHtml(d.class_name)}</td><td class="text-red-600 font-semibold">${fmtMoney(d.balance, currentSchool?.currency)}</td></tr>`).join('') || '<tr><td colspan="3" class="text-center text-slate-400 py-4">Aucun débiteur 🎉</td></tr>'}</tbody>
      </table>
    </div>

    <div class="text-right mt-4">
      <button onclick="window.print()" class="text-sm text-slate-600 hover:underline"><i class="fas fa-print mr-1"></i>Imprimer ce rapport</button>
    </div>
  `
}

function reportExportSections() {
  if (!reportCache) return null
  const cur = currentSchool?.currency
  const s = reportCache.summary
  return {
    title: `Rapport financier — ${reportCache.trimester.name} (${reportCache.school_year.label})`,
    subtitle: currentSchool ? currentSchool.name : '',
    sections: [
      {
        title: 'Synthèse',
        sheetName: 'Synthèse',
        columns: [{ header: 'Indicateur', key: 'k' }, { header: 'Valeur', key: 'v' }],
        rows: [
          { k: 'Frais attendus', v: fmtMoney(s.total_attendu, cur) },
          { k: 'Frais perçus', v: fmtMoney(s.total_percu, cur) },
          { k: 'Solde restant dû', v: fmtMoney(s.solde_frais, cur) },
          { k: 'Taux de recouvrement', v: s.taux_recouvrement !== null ? s.taux_recouvrement + '%' : '—' },
          { k: 'Total Entrées Caisse', v: fmtMoney(s.total_entree_caisse, cur) },
          { k: 'Total Sorties Caisse', v: fmtMoney(s.total_sortie_caisse, cur) }
        ]
      },
      {
        title: 'Détail par classe',
        sheetName: 'Par classe',
        columns: [
          { header: 'Classe', key: 'class_name' }, { header: 'Élèves', key: 'student_count' },
          { header: 'Attendu', key: 'attendu_f' }, { header: 'Perçu', key: 'percu_f' },
          { header: 'Solde', key: 'solde_f' }, { header: 'Taux', key: 'taux_f' }
        ],
        rows: reportCache.class_details.map(c => ({
          class_name: c.class_name, student_count: c.student_count,
          attendu_f: fmtMoney(c.attendu, cur), percu_f: fmtMoney(c.percu, cur),
          solde_f: fmtMoney(c.solde, cur), taux_f: c.taux !== null ? c.taux + '%' : '—'
        }))
      },
      {
        title: 'Dépenses par catégorie',
        sheetName: 'Dépenses',
        columns: [{ header: 'Catégorie', key: 'category_name' }, { header: 'Montant', key: 'total_f' }],
        rows: reportCache.expenses_by_category.map(e => ({ category_name: e.category_name, total_f: fmtMoney(e.total, cur) }))
      },
      {
        title: 'Top 10 des débiteurs',
        sheetName: 'Débiteurs',
        columns: [{ header: 'Élève', key: 'full_name' }, { header: 'Classe', key: 'class_name' }, { header: 'Dette', key: 'balance_f' }],
        rows: reportCache.top_debtors.map(d => ({ full_name: `${d.nom} ${d.post_nom}`, class_name: d.class_name, balance_f: fmtMoney(d.balance, cur) }))
      }
    ]
  }
}

function exportReportExcel() {
  const r = reportExportSections()
  if (!r) return toast('Chargez d\'abord un rapport', 'error')
  exportSheetsToExcel({
    filename: `rapport_financier_${reportCache.trimester.name.replace(/\s+/g, '_')}_${todayStr()}`,
    sheets: r.sections.map(sec => ({ sheetName: sec.sheetName, title: `${r.title} — ${sec.title}`, columns: sec.columns, rows: sec.rows }))
  })
}

function exportReportPdf() {
  const r = reportExportSections()
  if (!r) return toast('Chargez d\'abord un rapport', 'error')
  exportSectionsToPdf({
    filename: `rapport_financier_${reportCache.trimester.name.replace(/\s+/g, '_')}_${todayStr()}`,
    title: r.title,
    subtitle: r.subtitle,
    sections: r.sections
  })
}

// ---------------------------------------------------------------------------
// PARAMÈTRES DE L'ÉCOLE
// ---------------------------------------------------------------------------
async function loadSchoolSettings() {
  const { school, account } = await Api.get('/api/admin/school-settings')
  document.getElementById('set-school-name').value = school?.name || ''
  document.getElementById('set-head-name').value = school?.head_name || ''
  document.getElementById('set-address').value = school?.address || ''
  document.getElementById('set-phone').value = school?.phone || ''
  document.getElementById('set-admin-name').value = account?.name || ''
  document.getElementById('set-email').value = account?.email || ''
  document.getElementById('set-current-password').value = ''
  document.getElementById('set-new-password').value = ''
}

document.getElementById('school-info-form')?.addEventListener('submit', async (e) => {
  e.preventDefault()
  try {
    await Api.put('/api/admin/school-settings', {
      school_name: document.getElementById('set-school-name').value.trim() || null,
      head_name: document.getElementById('set-head-name').value.trim() || null,
      address: document.getElementById('set-address').value.trim() || null,
      phone: document.getElementById('set-phone').value.trim() || null
    })
    toast('Informations de l\'école mises à jour', 'success')
    // Rafraîchir le nom affiché dans l'entête
    const me = await Api.get('/api/auth/me')
    currentSchool = me.school
  } catch (err) { toast(err.message, 'error') }
})

document.getElementById('account-form')?.addEventListener('submit', async (e) => {
  e.preventDefault()
  try {
    const newPwd = document.getElementById('set-new-password').value
    const curPwd = document.getElementById('set-current-password').value
    if (newPwd && !curPwd) { toast('Entrez votre mot de passe actuel pour le changer', 'error'); return }
    await Api.put('/api/admin/school-settings', {
      admin_name: document.getElementById('set-admin-name').value.trim() || null,
      email: document.getElementById('set-email').value.trim() || null,
      current_password: curPwd || null,
      new_password: newPwd || null
    })
    toast('Compte mis à jour' + (newPwd ? ' (nouveau mot de passe actif)' : ''), 'success')
    document.getElementById('set-current-password').value = ''
    document.getElementById('set-new-password').value = ''
  } catch (err) { toast(err.message, 'error') }
})

init()
