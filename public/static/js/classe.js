// ============================================================================
// Logique frontend de l'espace CLASSE
// La classe connectée peut consulter ses informations et gérer SES PROPRES
// élèves (ajout manuel + import Excel/CSV). Les paiements restent réservés
// aux percepteurs/admin (lecture seule ici).
// ============================================================================
let currentUser = null
let currentSchool = null
let myClass = null
let trimesters = []

async function init() {
  const data = await guardAuth(['classe'])
  if (!data) return
  currentUser = data.user
  currentSchool = data.school
  document.getElementById('user-info').innerHTML = `<i class="fas fa-user-circle mr-1"></i>${escapeHtml(data.user.name)}`
  document.getElementById('school-name-label').textContent = data.school ? data.school.name : 'École'
  document.getElementById('perc-date').value = todayStr()

  renderImpersonationBanner(data.user)
  setupTabs()

  const meRes = await Api.get('/api/classe/me')
  myClass = meRes.class
  document.getElementById('class-name-label').textContent = myClass.name

  const trimRes = await Api.get('/api/shared/trimesters')
  trimesters = trimRes.trimesters
  populateSelectors()

  renderOverview(meRes)
  await loadStudents()
  if (trimesters.length) {
    await loadRegistre()
  }
}

// ---------------------------------------------------------------------------
// Bannière "vous consultez cette classe en tant qu'administrateur"
// ---------------------------------------------------------------------------
function renderImpersonationBanner(user) {
  const banner = document.getElementById('impersonation-banner')
  if (!user.impersonating) {
    banner.classList.add('hidden')
    return
  }
  banner.classList.remove('hidden')
  banner.innerHTML = `
    <i class="fas fa-eye"></i>
    <span>Vous consultez l'espace de cette classe en tant qu'administrateur (${escapeHtml(user.impersonating.admin_name)}).</span>
    <button onclick="returnToAdmin()"><i class="fas fa-arrow-left mr-1"></i>Retour à l'administration</button>
  `
  document.body.style.paddingTop = '2.5rem'
}

async function returnToAdmin() {
  try {
    await Api.post('/api/auth/restore-admin')
    window.location.href = '/static/admin.html'
  } catch (err) {
    toast(err.message, 'error')
  }
}

function setupTabs() {
  document.querySelectorAll('.nav-link[data-tab]').forEach(link => {
    link.addEventListener('click', () => {
      document.querySelectorAll('.nav-link[data-tab]').forEach(l => l.classList.remove('active'))
      link.classList.add('active')
      document.querySelectorAll('main > section').forEach(s => s.classList.add('hidden'))
      document.getElementById('tab-' + link.dataset.tab).classList.remove('hidden')
      if (link.dataset.tab === 'debts') loadDebts()
      if (link.dataset.tab === 'fees') loadFees()
      if (link.dataset.tab === 'perception') { loadRegistre(); setAutoRefresh(loadRegistre) } // synchro quasi temps réel
      else setAutoRefresh(null)
      if (link.dataset.tab === 'students') loadStudents()
    })
  })
}

function populateSelectors() {
  const trimOptions = trimesters.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('')
  document.getElementById('perc-trimester').innerHTML = trimOptions
  document.getElementById('debt-trimester').innerHTML = trimOptions
}

function renderOverview(meRes) {
  document.getElementById('overview-stats').innerHTML = `
    <div class="stat-card"><p class="text-xs text-slate-500 mb-1">Niveau</p><p class="text-lg font-bold text-slate-800">${escapeHtml(myClass.level || '—')}</p></div>
    <div class="stat-card"><p class="text-xs text-slate-500 mb-1">Enseignant(s)</p><p class="text-lg font-bold text-slate-800">${meRes.teachers.length}</p></div>
    <div class="stat-card"><p class="text-xs text-slate-500 mb-1">Percepteur(s)</p><p class="text-lg font-bold text-slate-800">${meRes.percepteurs.length}</p></div>
  `
  document.getElementById('overview-teachers').innerHTML = meRes.teachers.map(t => `<div class="bg-slate-50 px-3 py-1.5 rounded">${escapeHtml(t.name)}</div>`).join('') || '<p class="text-xs text-slate-400">Aucun enseignant affecté</p>'
  document.getElementById('overview-percepteurs').innerHTML = meRes.percepteurs.map(p => `<div class="bg-slate-50 px-3 py-1.5 rounded">${escapeHtml(p.name)}</div>`).join('') || '<p class="text-xs text-slate-400">Aucun percepteur affecté</p>'
}

// ---------------------------------------------------------------------------
// ELEVES (ajout, import, suppression) — propres à la classe connectée
// ---------------------------------------------------------------------------
let studentsCache = []

async function loadStudents() {
  const { students } = await Api.get('/api/classe/students')
  studentsCache = students
  document.getElementById('students-tbody').innerHTML = students.map(s => `
    <tr>
      <td class="font-medium">${escapeHtml(s.nom)}</td>
      <td>${escapeHtml(s.post_nom)}</td>
      <td>${escapeHtml(s.prenom || '—')}</td>
      <td>${s.sexe || '—'}</td>
      <td>${categoryBadge(s.categorie)}</td>
      <td class="space-x-2 whitespace-nowrap">
        <button onclick="showEditStudentCategoryModal(${s.id}, '${escapeHtml(s.nom)} ${escapeHtml(s.post_nom)}', '${s.categorie || 'normal'}')" class="text-blue-600 hover:underline text-xs font-semibold"><i class="fas fa-tag"></i> Catégorie</button>
        <button onclick="showTransferStudentModal(${s.id}, '${escapeHtml(s.nom)} ${escapeHtml(s.post_nom)}')" class="text-amber-600 hover:underline text-xs font-semibold"><i class="fas fa-exchange-alt"></i> Transférer</button>
        <button onclick="deleteStudent(${s.id})" class="text-red-600 hover:underline text-xs font-semibold"><i class="fas fa-trash"></i></button>
      </td>
    </tr>`).join('') || '<tr><td colspan="6" class="text-center text-slate-400 py-6">Aucun élève</td></tr>'
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
        <p class="text-xs text-slate-400">Le montant des frais appliqué à cet élève dépend de sa catégorie.</p>
        <div class="flex justify-end gap-2 pt-2">
          <button type="button" onclick="closeModal()" class="px-4 py-2 text-sm rounded-lg text-slate-600 hover:bg-slate-100">Annuler</button>
          <button type="submit" class="px-4 py-2 text-sm rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold">Enregistrer</button>
        </div>
      </form>
    </div>`)
  document.getElementById('edit-cat-form').addEventListener('submit', async (e) => {
    e.preventDefault()
    try {
      await Api.patch(`/api/classe/students/${studentId}`, { categorie: document.getElementById('ec-categorie').value })
      toast('Catégorie mise à jour', 'success')
      closeModal()
      await loadStudents()
    } catch (err) { toast(err.message, 'error') }
  })
}

// Transfert d'un élève vers une autre classe (avec toutes ses données)
async function showTransferStudentModal(studentId, studentName) {
  let classes = []
  try {
    const res = await Api.get('/api/classe/school-classes')
    classes = res.classes || []
  } catch (err) { toast(err.message, 'error'); return }
  if (!classes.length) { toast("Aucune autre classe disponible dans l'école", 'error'); return }

  openModal(`
    <div class="p-6">
      <h3 class="text-lg font-bold text-slate-800 mb-1"><i class="fas fa-exchange-alt mr-2 text-amber-600"></i>Transférer l'élève</h3>
      <p class="text-sm text-slate-500 mb-4">${escapeHtml(studentName)}</p>
      <form id="transfer-form" class="space-y-3">
        <div><label class="text-xs font-medium text-slate-600">Classe de destination *</label>
          <select id="tr-class" class="w-full mt-1 px-3 py-2 border rounded-lg text-sm" required>
            <option value="">— Choisir une classe —</option>
            ${classes.map(cl => `<option value="${cl.id}">${escapeHtml(cl.name)}${cl.option ? ' (' + escapeHtml(cl.option) + ')' : ''} — ${escapeHtml(cl.level || '')}</option>`).join('')}
          </select>
        </div>
        <p class="text-xs text-slate-400"><i class="fas fa-info-circle mr-1"></i>L'élève part avec toutes ses données : ses paiements et son historique le suivent. Les frais appliqués seront ceux de la nouvelle classe.</p>
        <div class="flex justify-end gap-2 pt-2">
          <button type="button" onclick="closeModal()" class="px-4 py-2 text-sm rounded-lg text-slate-600 hover:bg-slate-100">Annuler</button>
          <button type="submit" class="px-4 py-2 text-sm rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-semibold"><i class="fas fa-exchange-alt mr-1"></i>Transférer</button>
        </div>
      </form>
    </div>`)
  document.getElementById('transfer-form').addEventListener('submit', async (e) => {
    e.preventDefault()
    const toClassId = document.getElementById('tr-class').value
    if (!toClassId) { toast('Choisissez une classe de destination', 'error'); return }
    try {
      const res = await Api.post(`/api/classe/students/${studentId}/transfer`, { to_class_id: Number(toClassId) })
      toast(res.message || 'Élève transféré', 'success')
      closeModal()
      await loadStudents()
    } catch (err) { toast(err.message, 'error') }
  })
}

const STUDENTS_EXPORT_COLUMNS = [
  { header: 'Nom', key: 'nom' }, { header: 'Post-nom', key: 'post_nom' }, { header: 'Prénom', key: 'prenom' },
  { header: 'Sexe', key: 'sexe' }, { header: 'Catégorie', key: 'cat' }
]

function exportStudentsExcel() {
  exportTableToExcel({
    filename: `eleves_${myClass ? myClass.name.replace(/\s+/g, '_') : 'classe'}_${todayStr()}`,
    sheetName: 'Élèves',
    title: `Liste des élèves — ${myClass ? myClass.name : ''} — ${currentSchool ? currentSchool.name : ''}`,
    columns: STUDENTS_EXPORT_COLUMNS,
    rows: studentsCache.map(s => ({ ...s, prenom: s.prenom || '', sexe: s.sexe || '', cat: categoryLabel(s.categorie) }))
  })
}

function exportStudentsPdf() {
  exportTableToPdf({
    filename: `eleves_${myClass ? myClass.name.replace(/\s+/g, '_') : 'classe'}_${todayStr()}`,
    title: `Liste des élèves — ${myClass ? myClass.name : ''}`,
    subtitle: `${currentSchool ? currentSchool.name : ''} — ${studentsCache.length} élève(s)`,
    columns: STUDENTS_EXPORT_COLUMNS,
    rows: studentsCache.map(s => ({ ...s, prenom: s.prenom || '', sexe: s.sexe || '', cat: categoryLabel(s.categorie) }))
  })
}

function showCreateStudentModal() {
  openModal(`
    <div class="p-6">
      <h3 class="text-lg font-bold text-slate-800 mb-4"><i class="fas fa-user-graduate mr-2 text-blue-600"></i>Ajouter un élève</h3>
      <form id="create-student-form" class="space-y-3">
        <div class="grid grid-cols-2 gap-3">
          <div><label class="text-xs font-medium text-slate-600">Nom *</label><input required id="st-nom" class="w-full mt-1 px-3 py-2 border rounded-lg text-sm"></div>
          <div><label class="text-xs font-medium text-slate-600">Post-nom *</label><input required id="st-postnom" class="w-full mt-1 px-3 py-2 border rounded-lg text-sm"></div>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div><label class="text-xs font-medium text-slate-600">Prénom</label><input id="st-prenom" class="w-full mt-1 px-3 py-2 border rounded-lg text-sm"></div>
          <div><label class="text-xs font-medium text-slate-600">Sexe</label>
            <select id="st-sexe" class="w-full mt-1 px-3 py-2 border rounded-lg text-sm"><option value="">—</option><option value="M">M</option><option value="F">F</option></select>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div><label class="text-xs font-medium text-slate-600">Catégorie *</label>
            <select id="st-categorie" class="w-full mt-1 px-3 py-2 border rounded-lg text-sm">${categoryOptions('normal')}</select>
          </div>
          <div><label class="text-xs font-medium text-slate-600">Contact parent</label><input id="st-contact" class="w-full mt-1 px-3 py-2 border rounded-lg text-sm"></div>
        </div>
        <div class="flex justify-end gap-2 pt-3">
          <button type="button" onclick="closeModal()" class="px-4 py-2 text-sm rounded-lg text-slate-600 hover:bg-slate-100">Annuler</button>
          <button type="submit" class="px-4 py-2 text-sm rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold">Ajouter</button>
        </div>
      </form>
    </div>`)
  document.getElementById('create-student-form').addEventListener('submit', async (e) => {
    e.preventDefault()
    try {
      await Api.post('/api/classe/students', {
        nom: document.getElementById('st-nom').value,
        post_nom: document.getElementById('st-postnom').value,
        prenom: document.getElementById('st-prenom').value,
        sexe: document.getElementById('st-sexe').value,
        parent_contact: document.getElementById('st-contact').value,
        categorie: document.getElementById('st-categorie').value
      })
      toast('Élève ajouté', 'success')
      closeModal()
      await loadStudents()
    } catch (err) { toast(err.message, 'error') }
  })
}

async function deleteStudent(id) {
  if (!confirm('Supprimer cet élève ?')) return
  try {
    await Api.del(`/api/classe/students/${id}`)
    toast('Élève supprimé', 'success')
    await loadStudents()
  } catch (err) { toast(err.message, 'error') }
}

// ---------------------------------------------------------------------------
// IMPORT ÉLÈVES (Excel / CSV) — une seule colonne "Nom et post-nom"
// ---------------------------------------------------------------------------
let importedStudentsRows = []

function splitNomPostNom(fullName) {
  const clean = String(fullName || '').trim().replace(/\s+/g, ' ')
  if (!clean) return { nom: '', post_nom: '' }
  const parts = clean.split(' ')
  const nom = parts[0]
  const post_nom = parts.slice(1).join(' ') || parts[0]
  return { nom, post_nom }
}

function showImportStudentsModal() {
  importedStudentsRows = []
  openModal(`
    <div class="p-6">
      <h3 class="text-lg font-bold text-slate-800 mb-1"><i class="fas fa-file-import mr-2 text-emerald-600"></i>Importer des élèves</h3>
      <p class="text-xs text-slate-500 mb-4">Fichier Excel (.xlsx/.xls) ou CSV attendu, avec une seule colonne contenant le <strong>Nom et post-nom</strong> de chaque élève (une ligne par élève). La première cellule peut être un en-tête (ex. "Nom et post-nom"), elle sera ignorée automatiquement. Les élèves seront ajoutés à <strong>votre classe (${escapeHtml(myClass ? myClass.name : '')})</strong>.</p>
      <div class="space-y-3">
        <div>
          <label class="text-xs font-medium text-slate-600">Fichier (.xlsx, .xls, .csv)</label>
          <input type="file" id="import-file" accept=".xlsx,.xls,.csv" class="w-full mt-1 px-3 py-2 border rounded-lg text-sm bg-white">
        </div>
        <div>
          <label class="text-xs font-medium text-slate-600">Catégorie des élèves importés *</label>
          <select id="import-categorie" class="w-full mt-1 px-3 py-2 border rounded-lg text-sm">${categoryOptions('normal')}</select>
          <p class="text-xs text-slate-400 mt-1">Tous les élèves de ce fichier seront enregistrés dans cette catégorie. Vous pourrez modifier la catégorie de chaque élève individuellement après l'import.</p>
        </div>
        <div id="import-preview" class="max-h-64 overflow-y-auto border rounded-lg hidden">
          <table class="data-table"><thead><tr><th>#</th><th>Nom et post-nom (fichier)</th><th>Nom</th><th>Post-nom</th></tr></thead><tbody id="import-preview-tbody"></tbody></table>
        </div>
        <div id="import-count" class="text-xs text-slate-500"></div>
      </div>
      <div class="flex justify-end gap-2 pt-4 mt-2 border-t">
        <button type="button" onclick="closeModal()" class="px-4 py-2 text-sm rounded-lg text-slate-600 hover:bg-slate-100">Annuler</button>
        <button type="button" id="import-submit-btn" disabled onclick="submitImportedStudents()" class="px-4 py-2 text-sm rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold">
          <i class="fas fa-upload mr-2"></i>Importer
        </button>
      </div>
    </div>`)

  document.getElementById('import-file').addEventListener('change', handleImportFileSelected)
}

function handleImportFileSelected(e) {
  const file = e.target.files[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = (evt) => {
    try {
      const data = new Uint8Array(evt.target.result)
      const workbook = XLSX.read(data, { type: 'array' })
      const firstSheetName = workbook.SheetNames[0]
      const sheet = workbook.Sheets[firstSheetName]
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: '' })

      let names = rows
        .map(r => (Array.isArray(r) ? r[0] : r))
        .map(v => String(v ?? '').trim())
        .filter(v => v.length > 0)

      if (names.length > 0) {
        const headerCandidate = names[0].toLowerCase()
        if (/^(nom|nom et post[- ]?nom|post[- ]?nom|noms)$/i.test(headerCandidate)) {
          names = names.slice(1)
        }
      }

      importedStudentsRows = names.map(n => ({ full: n, ...splitNomPostNom(n) }))
      renderImportPreview()
    } catch (err) {
      toast('Fichier illisible : ' + err.message, 'error')
    }
  }
  reader.readAsArrayBuffer(file)
}

function renderImportPreview() {
  const preview = document.getElementById('import-preview')
  const tbody = document.getElementById('import-preview-tbody')
  const countEl = document.getElementById('import-count')
  const btn = document.getElementById('import-submit-btn')

  if (importedStudentsRows.length === 0) {
    preview.classList.add('hidden')
    countEl.textContent = 'Aucun élève détecté dans le fichier.'
    btn.disabled = true
    return
  }

  tbody.innerHTML = importedStudentsRows.map((r, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${escapeHtml(r.full)}</td>
      <td class="font-medium">${escapeHtml(r.nom)}</td>
      <td>${escapeHtml(r.post_nom)}</td>
    </tr>`).join('')
  preview.classList.remove('hidden')
  countEl.textContent = `${importedStudentsRows.length} élève(s) détecté(s), prêt(s) à être importés.`
  btn.disabled = false
}

async function submitImportedStudents() {
  if (importedStudentsRows.length === 0) { toast('Aucun élève à importer', 'error'); return }

  const categorie = document.getElementById('import-categorie') ? document.getElementById('import-categorie').value : 'normal'
  const students = importedStudentsRows.map(r => ({ nom: r.nom, post_nom: r.post_nom, categorie }))

  const btn = document.getElementById('import-submit-btn')
  btn.disabled = true
  btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Import en cours...'
  try {
    const res = await Api.post('/api/classe/students/bulk', { students })
    toast(`${res.created} élève(s) importé(s) avec succès`, 'success')
    closeModal()
    await loadStudents()
  } catch (err) {
    toast(err.message, 'error')
    btn.disabled = false
    btn.innerHTML = '<i class="fas fa-upload mr-2"></i>Importer'
  }
}

// ---------------------------------------------------------------------------
// REGISTRE DE PERCEPTION (lecture seule)
// ---------------------------------------------------------------------------
let registreCache = null

async function loadRegistre() {
  const trimesterId = document.getElementById('perc-trimester').value
  const date = document.getElementById('perc-date').value || todayStr()
  if (!trimesterId) return

  const data = await Api.get(`/api/classe/registre?date=${date}&trimester_id=${trimesterId}`)
  registreCache = data

  document.getElementById('registre-summary').innerHTML = `
    <div class="stat-card"><p class="text-xs text-slate-500 mb-1">Élèves ayant payé ce jour</p><p class="text-xl font-bold text-slate-800">${data.count}</p></div>
    <div class="stat-card"><p class="text-xs text-slate-500 mb-1">Total perçu ce jour</p><p class="text-xl font-bold text-green-600">${fmtMoney(data.total, currentSchool?.currency)}</p></div>
    <div class="stat-card"><p class="text-xs text-slate-500 mb-1">Date</p><p class="text-xl font-bold text-slate-800">${fmtDate(data.date)}</p></div>
  `

  document.getElementById('registre-tbody').innerHTML = data.students.map((s, idx) => `
    <tr>
      <td>${idx + 1}</td>
      <td class="font-medium">${escapeHtml(s.nom)} ${escapeHtml(s.post_nom)}</td>
      <td>${categoryBadge(s.categorie)}</td>
      <td>${s.montant_jour ? fmtMoney(s.montant_jour, currentSchool?.currency) : '<span class="text-slate-400">—</span>'}</td>
      <td>${s.receipt_number ? `<span class="badge badge-green">${escapeHtml(s.receipt_number)}</span>${s.payments_count_today > 1 ? ` <span class="badge badge-blue">x${s.payments_count_today}</span>` : ''}` : '—'}</td>
    </tr>`).join('') || '<tr><td colspan="5" class="text-center text-slate-400 py-6">Aucun élève dans cette classe</td></tr>'
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
  const rows = registreCache.students.map((s, i) => ({
    num: i + 1,
    full_name: `${s.nom} ${s.post_nom}`,
    cat: categoryLabel(s.categorie),
    montant: s.montant_jour ? fmtMoney(s.montant_jour, currentSchool?.currency) : '',
    receipt: s.receipt_number || ''
  }))
  rows.push({ num: '', full_name: 'TOTAL DU JOUR', cat: '', montant: fmtMoney(registreCache.total, currentSchool?.currency), receipt: `${registreCache.count} paiement(s)` })
  return rows
}

function exportRegistreExcel() {
  if (!registreCache) return toast('Affichez d\'abord le registre', 'error')
  exportTableToExcel({
    filename: `registre_${myClass ? myClass.name.replace(/\s+/g, '_') : 'classe'}_${registreCache.date}`,
    sheetName: 'Registre',
    title: `Registre de perception — ${myClass ? myClass.name : ''} — ${fmtDate(registreCache.date)}`,
    columns: REGISTRE_EXPORT_COLUMNS,
    rows: registreExportRows()
  })
}

function exportRegistrePdf() {
  if (!registreCache) return toast('Affichez d\'abord le registre', 'error')
  exportTableToPdf({
    filename: `registre_${myClass ? myClass.name.replace(/\s+/g, '_') : 'classe'}_${registreCache.date}`,
    title: `Registre de perception — ${myClass ? myClass.name : ''}`,
    subtitle: `${currentSchool ? currentSchool.name : ''} — ${fmtDate(registreCache.date)}`,
    columns: REGISTRE_EXPORT_COLUMNS,
    rows: registreExportRows()
  })
}

function printAllReceipts() {
  if (!myClass) return
  const date = document.getElementById('perc-date').value || todayStr()
  showDateRangePrintModal({
    title: 'Imprimer les reçus de la classe',
    subtitle: `${myClass.name} — choisissez la période`,
    defaultFrom: date,
    defaultTo: date,
    onConfirm: (dateFrom, dateTo) => {
      window.open(`/static/receipts-batch.html?class_id=${myClass.id}&date_from=${dateFrom}&date_to=${dateTo}`, '_blank')
    }
  })
}

// ---------------------------------------------------------------------------
// DETTES
// ---------------------------------------------------------------------------
let debtsCache = null

async function loadDebts() {
  const trimesterId = document.getElementById('debt-trimester').value
  if (!trimesterId) return
  const data = await Api.get(`/api/classe/debts?trimester_id=${trimesterId}`)
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
    </tr>`).join('') || '<tr><td colspan="5" class="text-center text-slate-400 py-6">Aucune dette 🎉</td></tr>'
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
  if (!debtsCache) return toast('Affichez d\'abord les dettes', 'error')
  exportTableToExcel({
    filename: `dettes_${myClass ? myClass.name.replace(/\s+/g, '_') : 'classe'}_${todayStr()}`,
    sheetName: 'Dettes',
    title: `Liste des dettes — ${myClass ? myClass.name : ''} — ${currentSchool ? currentSchool.name : ''}`,
    columns: DEBTS_EXPORT_COLUMNS,
    rows: debtsExportRows()
  })
}

function exportDebtsPdf() {
  if (!debtsCache) return toast('Affichez d\'abord les dettes', 'error')
  exportTableToPdf({
    filename: `dettes_${myClass ? myClass.name.replace(/\s+/g, '_') : 'classe'}_${todayStr()}`,
    title: `Liste des dettes — ${myClass ? myClass.name : ''}`,
    subtitle: `${currentSchool ? currentSchool.name : ''} — ${debtsCache.count} élève(s) endetté(s)`,
    columns: DEBTS_EXPORT_COLUMNS,
    rows: debtsExportRows()
  })
}

async function loadFees() {
  const { fee_structures } = await Api.get('/api/classe/fees')
  document.getElementById('fees-tbody').innerHTML = fee_structures.map(f => `
    <tr>
      <td class="font-medium">${escapeHtml(f.trimester_name)}</td>
      <td>${categoryBadge(f.categorie)}</td>
      <td>${fmtMoney(f.montant, currentSchool?.currency)}</td>
    </tr>`).join('') || '<tr><td colspan="3" class="text-center text-slate-400 py-6">Aucun frais fixé pour cette classe</td></tr>'
}

init()
