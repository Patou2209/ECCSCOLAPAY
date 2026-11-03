// ============================================================================
// Logique frontend de l'espace PERCEPTEUR
// Vue en 2 étapes : cartes KPI par classe -> clic -> détail (registre / dettes)
// ============================================================================
let currentUser = null
let currentSchool = null
let myClasses = []
let trimesters = []
let currentPerceptionClass = null // { id, name }
let currentDebtsClass = null // { id, name }

async function init() {
  const data = await guardAuth(['percepteur'])
  if (!data) return
  currentUser = data.user
  currentSchool = data.school
  document.getElementById('user-info').innerHTML = `<i class="fas fa-user-circle mr-1"></i>${escapeHtml(data.user.name)}`
  document.getElementById('school-name-label').textContent = data.school ? data.school.name : 'École'
  document.getElementById('perc-summary-date').value = todayStr()

  setupTabs()

  const classesRes = await Api.get('/api/perception/my-classes')
  myClasses = classesRes.classes
  const trimRes = await Api.get('/api/shared/trimesters')
  trimesters = trimRes.trimesters

  populateSelectors()
  setupStudentSearch({ inputId: 'student-search-input', resultsId: 'student-search-results', trimesterSelectId: 'perc-summary-trimester' })

  if (myClasses.length === 0) {
    document.getElementById('perception-classes-grid').innerHTML = '<p class="text-slate-400 text-sm col-span-full text-center py-6">Aucune classe ne vous est affectée. Contactez l\'administrateur de votre école.</p>'
  } else {
    await loadPerceptionClasses()
    setAutoRefresh(loadPerceptionClasses) // synchro quasi temps réel dès l'ouverture
  }
}

function setupTabs() {
  document.querySelectorAll('.nav-link[data-tab]').forEach(link => {
    link.addEventListener('click', () => {
      document.querySelectorAll('.nav-link[data-tab]').forEach(l => l.classList.remove('active'))
      link.classList.add('active')
      document.querySelectorAll('main > section').forEach(s => s.classList.add('hidden'))
      document.getElementById('tab-' + link.dataset.tab).classList.remove('hidden')
      if (link.dataset.tab === 'perception') {
        currentPerceptionClass = null
        document.getElementById('perception-detail-view').classList.add('hidden')
        document.getElementById('perception-classes-view').classList.remove('hidden')
        loadPerceptionClasses()
        setAutoRefresh(loadPerceptionClasses) // synchro quasi temps réel
      } else {
        setAutoRefresh(null)
      }
      if (link.dataset.tab === 'debts') {
        currentDebtsClass = null
        document.getElementById('debts-detail-view').classList.add('hidden')
        document.getElementById('debts-classes-view').classList.remove('hidden')
        loadDebtsClasses()
      }
      if (link.dataset.tab === 'rapport') {
        if (!document.getElementById('mr-date').value) document.getElementById('mr-date').value = todayStr()
        loadMonRapport()
        setAutoRefresh(loadMonRapport) // synchro quasi temps réel
      }
    })
  })
}

function populateSelectors() {
  const trimOptions = trimesters.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('')
  document.getElementById('perc-summary-trimester').innerHTML = trimOptions
  document.getElementById('perc-trimester').innerHTML = trimOptions
  document.getElementById('debt-summary-trimester').innerHTML = trimOptions
  // Filtre classe du rapport journalier : uniquement MES classes assignées
  document.getElementById('mr-class').innerHTML =
    '<option value="">Toutes mes classes</option>' +
    myClasses.map(cl => `<option value="${cl.id}">${escapeHtml(cl.name)}</option>`).join('')
}

// ---------------------------------------------------------------------------
// PERCEPTION : vue 1 (cartes KPI par classe)
// ---------------------------------------------------------------------------
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
    </div>`).join('') || '<p class="text-slate-400 text-sm col-span-full text-center py-6">Aucune classe ne vous est affectée</p>'
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

// ---------------------------------------------------------------------------
// PERCEPTION : vue 2 (détail / registre journalier d'une classe)
// ---------------------------------------------------------------------------
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
        ${s.payment_id ? `<button onclick="printReceipt(${s.payment_id})" class="text-blue-600 hover:underline text-xs font-semibold"><i class="fas fa-print"></i> Reçu</button>` : ''}
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
  if (!registreCache || !currentPerceptionClass) return toast('Affichez d\'abord un registre', 'error')
  exportTableToExcel({
    filename: `registre_${currentPerceptionClass.name.replace(/\s+/g, '_')}_${registreCache.date}`,
    sheetName: 'Registre',
    title: `Registre de perception — ${currentPerceptionClass.name} — ${fmtDate(registreCache.date)}`,
    columns: REGISTRE_EXPORT_COLUMNS,
    rows: registreExportRows()
  })
}

function exportRegistrePdf() {
  if (!registreCache || !currentPerceptionClass) return toast('Affichez d\'abord un registre', 'error')
  exportTableToPdf({
    filename: `registre_${currentPerceptionClass.name.replace(/\s+/g, '_')}_${registreCache.date}`,
    title: `Registre de perception — ${currentPerceptionClass.name}`,
    subtitle: `${currentSchool ? currentSchool.name : ''} — ${fmtDate(registreCache.date)}`,
    columns: REGISTRE_EXPORT_COLUMNS,
    rows: registreExportRows()
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
      <td><button onclick="printReceipt(${p.id})" class="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded text-xs font-semibold"><i class="fas fa-print mr-1"></i>Imprimer le reçu</button></td>
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

function printReceipt(paymentId) {
  window.open(`/static/receipts-batch.html?payment_id=${paymentId}`, '_blank')
}

// Impression des reçus de TOUTES les classes du percepteur sur une période
function printAllMyClassesReceipts() {
  const date = document.getElementById('perc-summary-date').value || todayStr()
  showDateRangePrintModal({
    title: 'Imprimer les reçus de toutes mes classes',
    subtitle: 'Tous les reçus de toutes vos classes — choisissez la période',
    defaultFrom: date,
    defaultTo: date,
    onConfirm: (dateFrom, dateTo) => {
      window.open(`/static/receipts-batch.html?all_classes=1&date_from=${dateFrom}&date_to=${dateTo}`, '_blank')
    }
  })
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

// ---------------------------------------------------------------------------
// MON RAPPORT JOURNALIER : les perceptions du percepteur connecté,
// filtrables par date et par classe assignée
// ---------------------------------------------------------------------------
let monRapportCache = null

async function loadMonRapport() {
  const date = document.getElementById('mr-date').value || todayStr()
  const classId = document.getElementById('mr-class').value
  const data = await Api.get(`/api/perception/rapport-percepteur?date=${date}${classId ? `&class_id=${classId}` : ''}`)
  monRapportCache = data
  const cur = currentSchool?.currency

  document.getElementById('mr-summary').innerHTML = `
    <div class="stat-card"><p class="text-xs text-slate-500 mb-1">Date</p><p class="text-lg font-bold text-slate-800">${fmtDate(data.date)}</p></div>
    <div class="stat-card"><p class="text-xs text-slate-500 mb-1">Paiements perçus</p><p class="text-xl font-bold text-slate-800">${data.count}</p></div>
    <div class="stat-card"><p class="text-xs text-slate-500 mb-1">TOTAL PERÇU</p><p class="text-xl font-bold text-green-600">${fmtMoney(data.total, cur)}</p></div>
  `

  if (!data.classes.length) {
    document.getElementById('mr-content').innerHTML = '<div class="section-card p-8 text-center text-slate-400">Aucune perception enregistrée à cette date</div>'
    return
  }

  document.getElementById('mr-content').innerHTML = data.classes.map(cl => `
    <div class="section-card mb-4 overflow-x-auto">
      <div class="flex items-center justify-between mb-3 flex-wrap gap-2 p-4 pb-0">
        <h3 class="font-bold text-slate-800"><i class="ph ph-chalkboard-simple mr-2 text-brand"></i>${escapeHtml(cl.class_name)}</h3>
        <span class="badge badge-green">Total classe : ${fmtMoney(cl.total, cur)} — ${cl.count} paiement(s)</span>
      </div>
      <table class="data-table">
        <thead><tr><th>N°</th><th>Élève</th><th>Catégorie</th><th>Trimestre</th><th>Montant</th><th>Reçu</th><th></th></tr></thead>
        <tbody>
          ${cl.payments.map((p, i) => `
          <tr>
            <td>${i + 1}</td>
            <td class="font-medium">${escapeHtml(p.nom)} ${escapeHtml(p.post_nom)}</td>
            <td>${typeof categoryBadge === 'function' ? categoryBadge(p.categorie) : escapeHtml(p.categorie || '')}</td>
            <td>${escapeHtml(p.trimester_name)}</td>
            <td class="font-semibold">${fmtMoney(p.montant, cur)}</td>
            <td><span class="badge badge-green">${escapeHtml(p.receipt_number)}</span></td>
            <td><button onclick="printReceipt(${p.id})" class="text-blue-600 hover:underline text-xs font-semibold" title="Imprimer le reçu"><i class="ph ph-printer"></i></button></td>
          </tr>`).join('')}
        </tbody>
        <tfoot><tr><td colspan="4">TOTAL ${escapeHtml(cl.class_name)}</td><td colspan="3" class="text-green-700 font-bold">${fmtMoney(cl.total, cur)}</td></tr></tfoot>
      </table>
    </div>`).join('') + `
    <div class="section-card p-4" style="background:#0F1B33;color:#fff">
      <div class="flex items-center justify-between flex-wrap gap-2">
        <span class="font-bold"><i class="ph ph-coins mr-2" style="color:#fbbf24"></i>TOTAL GÉNÉRAL — ${fmtDate(data.date)}</span>
        <span class="text-xl font-extrabold" style="color:#4ade80">${fmtMoney(data.total, cur)}</span>
      </div>
    </div>`
}

// Impression du rapport journalier (même mise en page que côté admin)
function printMonRapport() {
  if (!monRapportCache || !monRapportCache.classes.length) return toast('Affichez d\'abord un rapport avec des perceptions', 'error')
  const d = monRapportCache
  const cur = currentSchool?.currency
  const catLabel = (c) => (typeof categoryLabel === 'function' ? categoryLabel(c) : (c || ''))
  const win = window.open('', '_blank')
  win.document.write(`<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>Mon rapport journalier — ${escapeHtml(d.percepteur.name)} — ${d.date}</title>
    <style>
      body { font-family: 'Segoe UI', Arial, sans-serif; margin: 2rem; color: #1e293b; font-size: 13px; }
      h1 { font-size: 18px; margin-bottom: 2px; } h2 { font-size: 14px; margin: 18px 0 6px; }
      .sub { color: #64748b; font-size: 12px; margin-bottom: 14px; }
      table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
      th, td { border: 1px solid #cbd5e1; padding: 5px 8px; text-align: left; }
      th { background: #f1f5f9; font-size: 11px; text-transform: uppercase; }
      .total-row td { font-weight: bold; background: #f8fafc; }
      .grand-total { margin-top: 16px; padding: 12px; border: 2px solid #1e293b; font-weight: bold; font-size: 15px; display: flex; justify-content: space-between; }
      .signs { margin-top: 38px; display: flex; justify-content: space-between; text-align: center; font-size: 12px; }
      .signs div { width: 40%; } .signs .line { border-bottom: 1px solid #334155; height: 34px; margin-bottom: 4px; }
      @media print { body { margin: 0.8cm; } }
    </style></head><body>
    <h1>${escapeHtml(currentSchool ? currentSchool.name : '')} — Rapport journalier de perception</h1>
    <p class="sub">Percepteur : <b>${escapeHtml(d.percepteur.name)}</b> &nbsp;|&nbsp; Date : <b>${fmtDate(d.date)}</b> &nbsp;|&nbsp; ${d.count} paiement(s)</p>
    ${d.classes.map(cl => `
      <h2>Classe : ${escapeHtml(cl.class_name)}</h2>
      <table>
        <thead><tr><th>N°</th><th>Élève</th><th>Catégorie</th><th>Trimestre</th><th>Montant</th><th>Reçu</th></tr></thead>
        <tbody>
          ${cl.payments.map((p, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(p.nom)} ${escapeHtml(p.post_nom)}</td><td>${catLabel(p.categorie)}</td><td>${escapeHtml(p.trimester_name)}</td><td>${fmtMoney(p.montant, cur)}</td><td>${escapeHtml(p.receipt_number)}</td></tr>`).join('')}
          <tr class="total-row"><td colspan="4">TOTAL ${escapeHtml(cl.class_name)}</td><td colspan="2">${fmtMoney(cl.total, cur)}</td></tr>
        </tbody>
      </table>`).join('')}
    <div class="grand-total"><span>TOTAL GÉNÉRAL PERÇU</span><span>${fmtMoney(d.total, cur)}</span></div>
    <div class="signs">
      <div><div class="line"></div>Signature du percepteur</div>
      <div><div class="line"></div>Visa de l'administration</div>
    </div>
    <script>window.onload = () => window.print()<\/script>
    </body></html>`)
  win.document.close()
}

// Impression de MES reçus sur une période (comme côté admin) :
// le backend force percepteur_id = moi, donc pas besoin de le passer
function printMesRecusPeriode() {
  const date = document.getElementById('mr-date').value || todayStr()
  showDateRangePrintModal({
    title: 'Imprimer mes reçus',
    subtitle: 'Tous les reçus que vous avez perçus — choisissez la période',
    defaultFrom: date,
    defaultTo: date,
    onConfirm: (dateFrom, dateTo) => {
      window.open(`/static/receipts-batch.html?percepteur_id=me&date_from=${dateFrom}&date_to=${dateTo}`, '_blank')
    }
  })
}

// ---------------------------------------------------------------------------
// DETTES : vue 1 (cartes KPI par classe)
// ---------------------------------------------------------------------------
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
    </div>`).join('') || '<p class="text-slate-400 text-sm col-span-full text-center py-6">Aucune classe ne vous est affectée</p>'
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

// ---------------------------------------------------------------------------
// DETTES : vue 2 (détail des dettes d'une classe)
// ---------------------------------------------------------------------------
let debtsCache = null

async function loadDebts() {
  if (!currentDebtsClass) return
  const classId = currentDebtsClass.id
  const trimesterId = document.getElementById('debt-summary-trimester').value
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

init()
