// ============================================================================
// Routes PERCEPTION : registre de perception journalière, paiements, reçus,
// listes de dettes. Accessible aux rôles percepteur et admin.
// ============================================================================
import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { requireAuth, requireRole } from '../middleware/auth'
import { getCurrentSchoolYear, nextReceiptNumber, syncCashbookAutoEntry, getTotalPaid, getFeeAmount, FEE_FOR_STUDENT_SQL } from '../utils/db'

const perception = new Hono<AppEnv>()

// Fragments SQL réutilisables pour enrichir les reçus EN UNE SEULE requête D1
// (frais applicables selon la catégorie de l'élève + total déjà payé) — évite
// les boucles N+1 qui consommaient énormément de lectures D1.
const RECEIPT_FEE_SQL = `COALESCE(
  (SELECT f1.montant FROM fee_structures f1 WHERE f1.class_id = st.class_id AND f1.trimester_id = p.trimester_id AND f1.categorie = st.categorie),
  (SELECT f2.montant FROM fee_structures f2 WHERE f2.class_id = st.class_id AND f2.trimester_id = p.trimester_id AND f2.categorie = 'normal'),
  0)`
const RECEIPT_PAID_SQL = `(SELECT COALESCE(SUM(p2.montant),0) FROM payments p2 WHERE p2.student_id = p.student_id AND p2.trimester_id = p.trimester_id AND p2.cancelled = 0)`

perception.use('*', requireAuth, async (c, next) => {
  const user = c.get('user') as any
  // Exception : /class-receipts est aussi accessible au rôle 'classe' (une
  // classe connectée imprime SES PROPRES reçus — vérifié dans le handler).
  const isClassReceipts = c.req.path.endsWith('/class-receipts')
  const allowed = isClassReceipts ? ['admin', 'percepteur', 'classe'] : ['admin', 'percepteur']
  if (!user || !allowed.includes(user.role)) {
    return c.json({ error: 'Accès refusé : rôle insuffisant' }, 403)
  }
  await next()
})

// GET /api/perception/my-classes - classes affectées au percepteur connecté (ou toutes si admin)
perception.get('/my-classes', async (c) => {
  const user = c.get('user')
  const db = c.env.DB
  if (user.role === 'admin') {
    const { results } = await db
      .prepare(`SELECT * FROM classes WHERE school_id = ? ORDER BY name`)
      .bind(user.school_id)
      .all()
    return c.json({ classes: results })
  }
  const { results } = await db
    .prepare(
      `SELECT cl.* FROM classes cl
       JOIN class_percepteurs cp ON cp.class_id = cl.id
       WHERE cp.percepteur_id = ? AND cl.school_id = ?
       ORDER BY cl.name`
    )
    .bind(user.uid, user.school_id)
    .all()
  return c.json({ classes: results })
})

// GET /api/perception/registre-summary?date=&trimester_id= - KPI par classe (élèves ayant payé / total perçu)
// pour la vue "cartes de classes" avant de rentrer dans le détail d'une classe.
perception.get('/registre-summary', async (c) => {
  const user = c.get('user')
  const db = c.env.DB
  const date = c.req.query('date') || new Date().toISOString().slice(0, 10)
  const trimesterId = c.req.query('trimester_id')
  if (!trimesterId) return c.json({ error: 'trimester_id requis' }, 400)

  // UNE SEULE requête D1 pour toutes les classes (au lieu de 2 requêtes par
  // classe) — indispensable pour rester dans les limites Cloudflare (nombre de
  // sous-requêtes par requête et quota de lectures D1), surtout avec le
  // rafraîchissement automatique.
  let summaryQuery = `
    SELECT cl.id as class_id, cl.name as class_name, cl.level, cl.option,
      (SELECT COUNT(*) FROM students st WHERE st.class_id = cl.id AND st.active = 1) as students_count,
      (SELECT COUNT(DISTINCT p.student_id) FROM payments p WHERE p.class_id = cl.id AND p.date_paiement = ? AND p.trimester_id = ? AND p.cancelled = 0) as paid_count,
      (SELECT COALESCE(SUM(p.montant),0) FROM payments p WHERE p.class_id = cl.id AND p.date_paiement = ? AND p.trimester_id = ? AND p.cancelled = 0) as total_collected
    FROM classes cl WHERE cl.school_id = ? ORDER BY cl.name`
  let summaryBinds: any[] = [date, trimesterId, date, trimesterId, user.school_id]
  if (user.role === 'percepteur') {
    summaryQuery = `
      SELECT cl.id as class_id, cl.name as class_name, cl.level, cl.option,
        (SELECT COUNT(*) FROM students st WHERE st.class_id = cl.id AND st.active = 1) as students_count,
        (SELECT COUNT(DISTINCT p.student_id) FROM payments p WHERE p.class_id = cl.id AND p.date_paiement = ? AND p.trimester_id = ? AND p.cancelled = 0) as paid_count,
        (SELECT COALESCE(SUM(p.montant),0) FROM payments p WHERE p.class_id = cl.id AND p.date_paiement = ? AND p.trimester_id = ? AND p.cancelled = 0) as total_collected
      FROM classes cl
      JOIN class_percepteurs cp ON cp.class_id = cl.id
      WHERE cp.percepteur_id = ? AND cl.school_id = ? ORDER BY cl.name`
    summaryBinds = [date, trimesterId, date, trimesterId, user.uid, user.school_id]
  }
  const { results: summary } = await db.prepare(summaryQuery).bind(...summaryBinds).all<any>()

  return c.json({ date, trimester_id: Number(trimesterId), classes: summary })
})

// GET /api/perception/debts-summary?trimester_id= - KPI par classe (nb élèves endettés / total dette)
// pour la vue "cartes de classes" avant de rentrer dans le détail d'une classe.
perception.get('/debts-summary', async (c) => {
  const user = c.get('user')
  const db = c.env.DB
  const trimesterId = c.req.query('trimester_id')
  if (!trimesterId) return c.json({ error: 'trimester_id requis' }, 400)

  // UNE SEULE requête D1 : dette de chaque élève calculée en SQL puis agrégée
  // par classe (évite 1 requête par classe — limites Cloudflare D1).
  let debtQuery = `
    SELECT cl.id as class_id, cl.name as class_name, cl.level, cl.option,
           COUNT(CASE WHEN d.debt > 0 THEN 1 END) as debtors_count,
           COALESCE(SUM(CASE WHEN d.debt > 0 THEN d.debt ELSE 0 END), 0) as total_debt
    FROM classes cl
    LEFT JOIN (
      SELECT st.class_id as cid,
        (${FEE_FOR_STUDENT_SQL}) - COALESCE((SELECT SUM(p.montant) FROM payments p WHERE p.student_id = st.id AND p.trimester_id = ? AND p.cancelled = 0), 0) as debt
      FROM students st WHERE st.active = 1
    ) d ON d.cid = cl.id
    WHERE cl.school_id = ?
    GROUP BY cl.id, cl.name, cl.level, cl.option
    ORDER BY cl.name`
  let debtBinds: any[] = [trimesterId, trimesterId, trimesterId, user.school_id]
  if (user.role === 'percepteur') {
    debtQuery = `
      SELECT cl.id as class_id, cl.name as class_name, cl.level, cl.option,
             COUNT(CASE WHEN d.debt > 0 THEN 1 END) as debtors_count,
             COALESCE(SUM(CASE WHEN d.debt > 0 THEN d.debt ELSE 0 END), 0) as total_debt
      FROM classes cl
      JOIN class_percepteurs cp ON cp.class_id = cl.id
      LEFT JOIN (
        SELECT st.class_id as cid,
          (${FEE_FOR_STUDENT_SQL}) - COALESCE((SELECT SUM(p.montant) FROM payments p WHERE p.student_id = st.id AND p.trimester_id = ? AND p.cancelled = 0), 0) as debt
        FROM students st WHERE st.active = 1
      ) d ON d.cid = cl.id
      WHERE cp.percepteur_id = ? AND cl.school_id = ?
      GROUP BY cl.id, cl.name, cl.level, cl.option
      ORDER BY cl.name`
    debtBinds = [trimesterId, trimesterId, trimesterId, user.uid, user.school_id]
  }
  const { results: summary } = await db.prepare(debtQuery).bind(...debtBinds).all<any>()

  return c.json({ trimester_id: Number(trimesterId), classes: summary })
})

// GET /api/perception/registre?class_id=&date=&trimester_id= - registre de perception journalière (Image 1)
// Un élève peut payer plusieurs fois le même jour (ex: 2 versements) : on liste
// donc TOUS les paiements du jour pour chaque élève (pas seulement le dernier),
// afin que le bouton "Percevoir" reste disponible même après un premier paiement.
perception.get('/registre', async (c) => {
  const user = c.get('user')
  const classId = c.req.query('class_id')
  const date = c.req.query('date') || new Date().toISOString().slice(0, 10)
  const trimesterId = c.req.query('trimester_id')

  if (!classId) return c.json({ error: 'class_id requis' }, 400)

  const db = c.env.DB

  // 1) Liste des élèves de la classe
  const { results: baseStudents } = await db
    .prepare(`SELECT st.id, st.nom, st.post_nom, st.prenom, st.matricule, st.categorie, cl.name as class_name
              FROM students st JOIN classes cl ON cl.id = st.class_id
              WHERE st.class_id = ? AND st.active = 1
              ORDER BY st.nom ASC, st.post_nom ASC`)
    .bind(classId)
    .all<any>()

  // 2) Tous les paiements du jour (non annulés) pour cette classe/trimestre
  let paymentsQuery = `
    SELECT id as payment_id, student_id, montant as montant_jour, receipt_number
    FROM payments
    WHERE class_id = ? AND date_paiement = ? AND cancelled = 0
    ${trimesterId ? 'AND trimester_id = ?' : ''}
    ORDER BY id ASC
  `
  const payBinds: any[] = trimesterId ? [classId, date, trimesterId] : [classId, date]
  const { results: dayPayments } = await db.prepare(paymentsQuery).bind(...payBinds).all<any>()

  // 3) Regrouper les paiements du jour par élève
  const paymentsByStudent = new Map<number, any[]>()
  for (const p of dayPayments) {
    if (!paymentsByStudent.has(p.student_id)) paymentsByStudent.set(p.student_id, [])
    paymentsByStudent.get(p.student_id)!.push(p)
  }

  const students = baseStudents.map((s: any) => {
    const pays = paymentsByStudent.get(s.id) || []
    const totalJour = pays.reduce((sum, p) => sum + p.montant_jour, 0)
    return {
      ...s,
      payments_today: pays, // tous les paiements du jour (pour impression/affichage détaillé)
      payment_id: pays.length ? pays[pays.length - 1].payment_id : null, // dernier reçu du jour
      receipt_number: pays.length ? pays[pays.length - 1].receipt_number : null,
      montant_jour: totalJour || null,
      payments_count_today: pays.length
    }
  })

  const totalRow = await db
    .prepare(
      `SELECT COALESCE(SUM(montant),0) as total, COUNT(*) as cnt FROM payments
       WHERE class_id = ? AND date_paiement = ? AND cancelled = 0 ${trimesterId ? 'AND trimester_id = ?' : ''}`
    )
    .bind(...(trimesterId ? [classId, date, trimesterId] : [classId, date]))
    .first<{ total: number; cnt: number }>()

  return c.json({ date, students, total: totalRow?.total ?? 0, count: totalRow?.cnt ?? 0 })
})

// GET /api/perception/class-receipts?class_id=&date= OU &date_from=&date_to=
// Tous les reçus (paiements non annulés) d'une classe pour une date donnée OU
// une plage de dates, pour l'impression groupée des reçus de la classe.
// ORDRE : chronologique de génération (p.id croissant = ordre des numéros de reçu).
perception.get('/class-receipts', async (c) => {
  const user = c.get('user')
  const db = c.env.DB
  const classId = c.req.query('class_id')
  const date = c.req.query('date')
  const dateFrom = c.req.query('date_from') || date
  const dateTo = c.req.query('date_to') || date
  if (!classId || !dateFrom || !dateTo) return c.json({ error: 'class_id et date (ou date_from/date_to) requis' }, 400)

  // Le rôle 'classe' ne peut imprimer que les reçus de SA propre classe
  if ((user as any).role === 'classe' && Number(classId) !== Number((user as any).class_id)) {
    return c.json({ error: 'Accès refusé : vous ne pouvez imprimer que les reçus de votre classe' }, 403)
  }

  const cls = await db.prepare(`SELECT * FROM classes WHERE id = ? AND school_id = ?`).bind(classId, user.school_id).first<any>()
  if (!cls) return c.json({ error: 'Classe introuvable' }, 404)

  const school = await db.prepare(`SELECT * FROM schools WHERE id = ?`).bind(user.school_id).first<any>()

  const { results: payments } = await db
    .prepare(
      `SELECT p.*, st.nom, st.post_nom, st.prenom, st.categorie, cl.name as class_name, t.name as trimester_name, t.number as trimester_number,
              u.name as percepteur_name, sy.label as year_label,
              ${RECEIPT_FEE_SQL} as fee_amount,
              ${RECEIPT_PAID_SQL} as total_paid
       FROM payments p
       JOIN students st ON st.id = p.student_id
       JOIN classes cl ON cl.id = p.class_id
       JOIN trimesters t ON t.id = p.trimester_id
       JOIN school_years sy ON sy.id = t.school_year_id
       JOIN users u ON u.id = p.percepteur_id
       WHERE p.class_id = ? AND p.date_paiement >= ? AND p.date_paiement <= ? AND p.cancelled = 0 AND p.school_id = ?
       ORDER BY p.id ASC`
    )
    .bind(classId, dateFrom, dateTo, user.school_id)
    .all<any>()

  // fee_amount/total_paid calculés directement en SQL (1 seule requête D1)
  const enriched = payments.map((p: any) => ({ ...p, balance: p.fee_amount - p.total_paid }))

  return c.json({ school, class: cls, date: dateFrom, date_from: dateFrom, date_to: dateTo, payments: enriched, count: enriched.length })
})

// GET /api/perception/my-classes-receipts?date_from=&date_to=
// Tous les reçus (paiements non annulés) de TOUTES les classes affectées au
// percepteur connecté, sur une plage de dates — impression groupée en une fois.
// (Pour un admin : toutes les classes de l'école.)
perception.get('/my-classes-receipts', async (c) => {
  const user = c.get('user')
  const db = c.env.DB
  const dateFrom = c.req.query('date_from')
  const dateTo = c.req.query('date_to') || dateFrom
  if (!dateFrom) return c.json({ error: 'date_from requis' }, 400)

  const school = await db.prepare(`SELECT * FROM schools WHERE id = ?`).bind(user.school_id).first<any>()

  // Classes concernées : celles du percepteur, ou toutes pour un admin
  let classFilterSql = ''
  const binds: any[] = []
  if (user.role === 'percepteur') {
    classFilterSql = `AND p.class_id IN (SELECT class_id FROM class_percepteurs WHERE percepteur_id = ?)`
    binds.push(user.uid)
  }

  const { results: payments } = await db
    .prepare(
      `SELECT p.*, st.nom, st.post_nom, st.prenom, st.categorie, cl.name as class_name, t.name as trimester_name, t.number as trimester_number,
              u.name as percepteur_name, sy.label as year_label,
              ${RECEIPT_FEE_SQL} as fee_amount,
              ${RECEIPT_PAID_SQL} as total_paid
       FROM payments p
       JOIN students st ON st.id = p.student_id
       JOIN classes cl ON cl.id = p.class_id
       JOIN trimesters t ON t.id = p.trimester_id
       JOIN school_years sy ON sy.id = t.school_year_id
       JOIN users u ON u.id = p.percepteur_id
       WHERE p.school_id = ? AND p.date_paiement >= ? AND p.date_paiement <= ? AND p.cancelled = 0 ${classFilterSql}
       ORDER BY p.id ASC`
    )
    .bind(user.school_id, dateFrom, dateTo, ...binds)
    .all<any>()

  const enriched = payments.map((p: any) => ({ ...p, balance: p.fee_amount - p.total_paid }))

  return c.json({
    school,
    all_classes: true,
    date_from: dateFrom,
    date_to: dateTo,
    payments: enriched,
    count: enriched.length,
    classes_count: new Set(enriched.map((p: any) => p.class_id)).size,
  })
})

// GET /api/perception/percepteur-receipts?percepteur_id=&date_from=&date_to=
// Tous les reçus perçus par UN PERCEPTEUR sur une plage de dates (toutes
// classes confondues) — pour l'impression groupée côté école.
// Un percepteur connecté ne peut consulter que ses propres reçus.
perception.get('/percepteur-receipts', async (c) => {
  const user = c.get('user')
  const db = c.env.DB
  // Un ou PLUSIEURS percepteurs : percepteur_id=2 OU percepteur_ids=2,5,7
  let idsParam = c.req.query('percepteur_ids') || c.req.query('percepteur_id') || ''
  const dateFrom = c.req.query('date_from')
  const dateTo = c.req.query('date_to') || dateFrom
  if (user.role === 'percepteur') idsParam = String(user.uid)
  const ids = idsParam.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => Number.isInteger(n) && n > 0)
  if (ids.length === 0 || !dateFrom) return c.json({ error: 'percepteur_id(s) et date_from requis' }, 400)

  const placeholders = ids.map(() => '?').join(',')
  const { results: percepteurs } = await db
    .prepare(`SELECT id, name, email FROM users WHERE id IN (${placeholders}) AND school_id = ? AND role IN ('percepteur','admin') ORDER BY name`)
    .bind(...ids, user.school_id)
    .all<any>()
  if (percepteurs.length === 0) return c.json({ error: 'Percepteur introuvable' }, 404)
  const validIds = percepteurs.map((p: any) => p.id)
  const validPlaceholders = validIds.map(() => '?').join(',')

  const school = await db.prepare(`SELECT * FROM schools WHERE id = ?`).bind(user.school_id).first<any>()

  const { results: payments } = await db
    .prepare(
      `SELECT p.*, st.nom, st.post_nom, st.prenom, st.categorie, cl.name as class_name, t.name as trimester_name, t.number as trimester_number,
              u.name as percepteur_name, sy.label as year_label,
              ${RECEIPT_FEE_SQL} as fee_amount,
              ${RECEIPT_PAID_SQL} as total_paid
       FROM payments p
       JOIN students st ON st.id = p.student_id
       JOIN classes cl ON cl.id = p.class_id
       JOIN trimesters t ON t.id = p.trimester_id
       JOIN school_years sy ON sy.id = t.school_year_id
       JOIN users u ON u.id = p.percepteur_id
       WHERE p.percepteur_id IN (${validPlaceholders}) AND p.date_paiement >= ? AND p.date_paiement <= ? AND p.cancelled = 0 AND p.school_id = ?
       ORDER BY p.id ASC`
    )
    .bind(...validIds, dateFrom, dateTo, user.school_id)
    .all<any>()

  const enriched = payments.map((p: any) => ({ ...p, balance: p.fee_amount - p.total_paid }))

  return c.json({
    school,
    percepteur: percepteurs[0], // rétro-compatibilité (1 seul percepteur)
    percepteurs,
    date_from: dateFrom,
    date_to: dateTo,
    payments: enriched,
    count: enriched.length
  })
})

// GET /api/perception/student/:id/situation?trimester_id= - situation de paiement d'un élève
perception.get('/student/:id/situation', async (c) => {
  const studentId = c.req.param('id')
  const trimesterId = c.req.query('trimester_id')
  const db = c.env.DB

  const student = await db
    .prepare(`SELECT st.*, cl.name as class_name, cl.id as class_id FROM students st JOIN classes cl ON cl.id = st.class_id WHERE st.id = ?`)
    .bind(studentId)
    .first<any>()
  if (!student) return c.json({ error: 'Élève introuvable' }, 404)

  if (!trimesterId) {
    return c.json({ student })
  }

  const feeAmount = await getFeeAmount(db, student.class_id, Number(trimesterId), student.categorie)
  const totalPaid = await getTotalPaid(db, Number(studentId), Number(trimesterId))
  const solde = feeAmount - totalPaid

  const payments = await db
    .prepare(
      `SELECT p.*, u.name as percepteur_name FROM payments p JOIN users u ON u.id = p.percepteur_id
       WHERE p.student_id = ? AND p.trimester_id = ? AND p.cancelled = 0 ORDER BY p.date_paiement DESC`
    )
    .bind(studentId, trimesterId)
    .all()

  return c.json({
    student,
    fee_amount: feeAmount,
    total_paid: totalPaid,
    balance: solde,
    payments: payments.results
  })
})

// POST /api/perception/pay - enregistrer un paiement + générer un reçu
perception.post('/pay', async (c) => {
  const user = c.get('user')
  const db = c.env.DB
  const { student_id, trimester_id, montant, date_paiement } = await c.req.json<any>()

  if (!student_id || !trimester_id || !montant || montant <= 0) {
    return c.json({ error: 'student_id, trimester_id et montant (>0) requis' }, 400)
  }

  const student = await db.prepare(`SELECT * FROM students WHERE id = ? AND school_id = ?`).bind(student_id, user.school_id).first<any>()
  if (!student) return c.json({ error: 'Élève introuvable dans votre école' }, 404)

  // Si percepteur (non admin), vérifier qu'il est bien affecté à cette classe
  if (user.role === 'percepteur') {
    const assigned = await db
      .prepare(`SELECT id FROM class_percepteurs WHERE class_id = ? AND percepteur_id = ?`)
      .bind(student.class_id, user.uid)
      .first()
    if (!assigned) return c.json({ error: "Vous n'êtes pas percepteur de la classe de cet élève" }, 403)
  }

  const trimester = await db.prepare(`SELECT * FROM trimesters WHERE id = ?`).bind(trimester_id).first<any>()
  if (!trimester) return c.json({ error: 'Trimestre introuvable' }, 404)

  const schoolYear = await db.prepare(`SELECT * FROM school_years WHERE id = ?`).bind(trimester.school_year_id).first<any>()
  const school = await db.prepare(`SELECT * FROM schools WHERE id = ?`).bind(user.school_id).first<any>()

  // CONTRÔLE STRICT : interdire toute perception dépassant les frais demandés.
  // On vérifie le montant saisi par rapport au SOLDE restant (frais - déjà payé).
  const feeDue = await getFeeAmount(db, student.class_id, Number(trimester_id), student.categorie)
  const alreadyPaid = await getTotalPaid(db, Number(student_id), Number(trimester_id))
  const remaining = feeDue - alreadyPaid

  if (feeDue <= 0) {
    return c.json({ error: "Aucun frais n'est fixé pour cette classe et ce trimestre. Perception impossible." }, 400)
  }
  if (remaining <= 0) {
    return c.json({ error: `Cet élève a déjà soldé ses frais du trimestre (${feeDue} ${school.currency} payés en totalité). Aucune perception supplémentaire n'est autorisée.` }, 400)
  }
  if (montant > remaining) {
    return c.json({
      error: `Montant refusé : la somme saisie (${montant} ${school.currency}) est supérieure aux frais demandés. Frais du trimestre : ${feeDue} ${school.currency}, déjà payé : ${alreadyPaid} ${school.currency}, reste à payer : ${remaining} ${school.currency}. Vous ne pouvez percevoir que ${remaining} ${school.currency} au maximum.`,
      fee_amount: feeDue,
      total_paid: alreadyPaid,
      remaining,
    }, 400)
  }

  const payDate = date_paiement || new Date().toISOString().slice(0, 10)
  const receiptNumber = await nextReceiptNumber(db, user.school_id, schoolYear.id, school.code, schoolYear.label.replace(/[^0-9]/g, ''))

  const result = await db
    .prepare(
      `INSERT INTO payments (school_id, student_id, class_id, trimester_id, montant, date_paiement, percepteur_id, receipt_number)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(user.school_id, student_id, student.class_id, trimester_id, montant, payDate, user.uid, receiptNumber)
    .run()

  // Synchroniser la ligne agrégée "Frais scolaire" du livre de caisse pour ce jour
  await syncCashbookAutoEntry(db, user.school_id, schoolYear.id, payDate, user.uid)

  const feeAmount = await getFeeAmount(db, student.class_id, Number(trimester_id), student.categorie)
  const totalPaid = await getTotalPaid(db, Number(student_id), Number(trimester_id))

  return c.json({
    success: true,
    payment_id: result.meta.last_row_id,
    receipt_number: receiptNumber,
    fee_amount: feeAmount,
    total_paid: totalPaid,
    balance: feeAmount - totalPaid
  })
})

// GET /api/perception/search-students?q= - RECHERCHE GÉNÉRALE D'ÉLÈVES
// Pour le percepteur : limité à ses classes affectées. Pour l'admin : toute l'école.
perception.get('/search-students', async (c) => {
  const user = c.get('user')
  const db = c.env.DB
  const q = (c.req.query('q') || '').trim()
  if (q.length < 2) return c.json({ students: [] })

  const like = `%${q}%`
  let query: string
  let binds: any[]

  if (user.role === 'percepteur') {
    query = `
      SELECT st.id, st.nom, st.post_nom, st.prenom, st.matricule, st.categorie,
             cl.id as class_id, cl.name as class_name, cl.option as class_option
      FROM students st
      JOIN classes cl ON cl.id = st.class_id
      JOIN class_percepteurs cp ON cp.class_id = cl.id AND cp.percepteur_id = ?
      WHERE st.active = 1 AND cl.school_id = ?
        AND (st.nom LIKE ? OR st.post_nom LIKE ? OR st.prenom LIKE ? OR (st.nom || ' ' || st.post_nom) LIKE ? OR st.matricule LIKE ?)
      ORDER BY st.nom ASC, st.post_nom ASC
      LIMIT 25`
    binds = [user.uid, user.school_id, like, like, like, like, like]
  } else {
    query = `
      SELECT st.id, st.nom, st.post_nom, st.prenom, st.matricule, st.categorie,
             cl.id as class_id, cl.name as class_name, cl.option as class_option
      FROM students st
      JOIN classes cl ON cl.id = st.class_id
      WHERE st.active = 1 AND cl.school_id = ?
        AND (st.nom LIKE ? OR st.post_nom LIKE ? OR st.prenom LIKE ? OR (st.nom || ' ' || st.post_nom) LIKE ? OR st.matricule LIKE ?)
      ORDER BY st.nom ASC, st.post_nom ASC
      LIMIT 25`
    binds = [user.school_id, like, like, like, like, like]
  }

  const { results } = await db.prepare(query).bind(...binds).all()
  return c.json({ students: results })
})

// GET /api/perception/rapport-percepteur?percepteur_id=&date_from=&date_to= - RAPPORT PAR PERCEPTEUR
// Liste tous les paiements perçus par un percepteur sur une date OU une période
// (date_from → date_to inclus), groupés par classe, avec total perçu par classe
// et total général. Compatibilité : l'ancien paramètre ?date= (un seul jour) reste accepté.
perception.get('/rapport-percepteur', async (c) => {
  const user = c.get('user')
  const db = c.env.DB
  const today = new Date().toISOString().slice(0, 10)
  const legacyDate = c.req.query('date') // ancien paramètre : un seul jour
  const dateFrom = c.req.query('date_from') || legacyDate || c.req.query('date_to') || today
  const dateTo = c.req.query('date_to') || legacyDate || dateFrom
  if (dateFrom > dateTo) return c.json({ error: 'La date de début doit être antérieure ou égale à la date de fin' }, 400)
  let percepteurId = c.req.query('percepteur_id')
  const classId = c.req.query('class_id') // filtre optionnel par classe

  // Un percepteur ne peut consulter que son propre rapport
  if (user.role === 'percepteur') percepteurId = String(user.uid)
  if (!percepteurId) return c.json({ error: 'percepteur_id requis' }, 400)

  const percepteur = await db
    .prepare(`SELECT id, name, email FROM users WHERE id = ? AND school_id = ? AND role IN ('percepteur','admin')`)
    .bind(percepteurId, user.school_id)
    .first<any>()
  if (!percepteur) return c.json({ error: 'Percepteur introuvable' }, 404)

  const { results: payments } = await db
    .prepare(
      `SELECT p.id, p.montant, p.receipt_number, p.date_paiement, p.trimester_id,
              st.nom, st.post_nom, st.prenom, st.categorie,
              cl.id as class_id, cl.name as class_name, t.name as trimester_name
       FROM payments p
       JOIN students st ON st.id = p.student_id
       JOIN classes cl ON cl.id = p.class_id
       JOIN trimesters t ON t.id = p.trimester_id
       WHERE p.percepteur_id = ? AND p.date_paiement BETWEEN ? AND ? AND p.cancelled = 0 AND p.school_id = ? ${classId ? 'AND p.class_id = ?' : ''}
       ORDER BY cl.name ASC, p.date_paiement ASC, st.nom ASC, st.post_nom ASC, p.id ASC`
    )
    .bind(...(classId ? [percepteurId, dateFrom, dateTo, user.school_id, classId] : [percepteurId, dateFrom, dateTo, user.school_id]))
    .all<any>()

  // Groupement par classe avec total par classe
  const byClass = new Map<number, { class_id: number; class_name: string; payments: any[]; total: number; count: number }>()
  let grandTotal = 0
  for (const p of payments) {
    if (!byClass.has(p.class_id)) {
      byClass.set(p.class_id, { class_id: p.class_id, class_name: p.class_name, payments: [], total: 0, count: 0 })
    }
    const g = byClass.get(p.class_id)!
    g.payments.push(p)
    g.total += p.montant
    g.count += 1
    grandTotal += p.montant
  }

  return c.json({
    date: dateFrom, // compatibilité (percepteur.js « Mon rapport »)
    date_from: dateFrom,
    date_to: dateTo,
    percepteur,
    classes: Array.from(byClass.values()),
    total: grandTotal,
    count: payments.length
  })
})

// PATCH /api/perception/payments/:id - MODIFIER un paiement/reçu (ADMIN uniquement)
perception.patch('/payments/:id', async (c) => {
  const user = c.get('user')
  if (user.role !== 'admin') return c.json({ error: 'Seule l\'administration de l\'école peut modifier un reçu' }, 403)
  const db = c.env.DB
  const id = c.req.param('id')
  const { montant, date_paiement } = await c.req.json<any>()

  const payment = await db.prepare(`SELECT * FROM payments WHERE id = ? AND school_id = ?`).bind(id, user.school_id).first<any>()
  if (!payment) return c.json({ error: 'Paiement introuvable' }, 404)

  if (montant !== undefined && (isNaN(Number(montant)) || Number(montant) <= 0)) {
    return c.json({ error: 'Montant invalide' }, 400)
  }

  const newMontant = montant !== undefined ? Number(montant) : payment.montant
  const newDate = date_paiement || payment.date_paiement

  await db.prepare(`UPDATE payments SET montant = ?, date_paiement = ? WHERE id = ?`).bind(newMontant, newDate, id).run()

  // Resynchroniser le livre de caisse pour l'ancienne ET la nouvelle date
  const trimester = await db.prepare(`SELECT school_year_id FROM trimesters WHERE id = ?`).bind(payment.trimester_id).first<any>()
  await syncCashbookAutoEntry(db, user.school_id, trimester.school_year_id, payment.date_paiement, user.uid)
  if (newDate !== payment.date_paiement) {
    await syncCashbookAutoEntry(db, user.school_id, trimester.school_year_id, newDate, user.uid)
  }

  return c.json({ success: true })
})

// DELETE /api/perception/payments/:id - SUPPRIMER définitivement un paiement/reçu (ADMIN uniquement)
perception.delete('/payments/:id', async (c) => {
  const user = c.get('user')
  if (user.role !== 'admin') return c.json({ error: 'Seule l\'administration de l\'école peut supprimer un reçu' }, 403)
  const db = c.env.DB
  const id = c.req.param('id')

  const payment = await db.prepare(`SELECT * FROM payments WHERE id = ? AND school_id = ?`).bind(id, user.school_id).first<any>()
  if (!payment) return c.json({ error: 'Paiement introuvable' }, 404)

  await db.prepare(`DELETE FROM payments WHERE id = ?`).bind(id).run()

  const trimester = await db.prepare(`SELECT school_year_id FROM trimesters WHERE id = ?`).bind(payment.trimester_id).first<any>()
  await syncCashbookAutoEntry(db, user.school_id, trimester.school_year_id, payment.date_paiement, user.uid)

  return c.json({ success: true })
})

// POST /api/perception/payments/:id/cancel - annuler un paiement (erreur de saisie)
perception.post('/payments/:id/cancel', async (c) => {
  const user = c.get('user')
  const db = c.env.DB
  const id = c.req.param('id')
  const payment = await db.prepare(`SELECT * FROM payments WHERE id = ? AND school_id = ?`).bind(id, user.school_id).first<any>()
  if (!payment) return c.json({ error: 'Paiement introuvable' }, 404)

  await db.prepare(`UPDATE payments SET cancelled = 1 WHERE id = ?`).bind(id).run()

  const trimester = await db.prepare(`SELECT school_year_id FROM trimesters WHERE id = ?`).bind(payment.trimester_id).first<any>()
  await syncCashbookAutoEntry(db, user.school_id, trimester.school_year_id, payment.date_paiement, user.uid)

  return c.json({ success: true })
})

// GET /api/perception/receipt/:paymentId - données complètes pour impression du reçu
perception.get('/receipt/:paymentId', async (c) => {
  const db = c.env.DB
  const user = c.get('user')
  const paymentId = c.req.param('paymentId')

  const payment = await db
    .prepare(
      `SELECT p.*, st.nom, st.post_nom, st.prenom, cl.name as class_name, t.name as trimester_name, t.number as trimester_number,
              u.name as percepteur_name, sy.label as year_label
       FROM payments p
       JOIN students st ON st.id = p.student_id
       JOIN classes cl ON cl.id = p.class_id
       JOIN trimesters t ON t.id = p.trimester_id
       JOIN school_years sy ON sy.id = t.school_year_id
       JOIN users u ON u.id = p.percepteur_id
       WHERE p.id = ? AND p.school_id = ?`
    )
    .bind(paymentId, user.school_id)
    .first<any>()

  if (!payment) return c.json({ error: 'Paiement introuvable' }, 404)

  const school = await db.prepare(`SELECT * FROM schools WHERE id = ?`).bind(user.school_id).first<any>()
  const feeAmount = await getFeeAmount(db, payment.class_id, payment.trimester_id, payment.categorie)
  const totalPaid = await getTotalPaid(db, payment.student_id, payment.trimester_id)

  return c.json({
    school,
    payment,
    fee_amount: feeAmount,
    total_paid: totalPaid,
    balance: feeAmount - totalPaid
  })
})

// GET /api/perception/debts?class_id=&trimester_id= - liste des dettes (élèves n'ayant pas payé intégralement)
perception.get('/debts', async (c) => {
  const db = c.env.DB
  const user = c.get('user')
  const classId = c.req.query('class_id')
  const trimesterId = c.req.query('trimester_id')

  if (!trimesterId) return c.json({ error: 'trimester_id requis' }, 400)

  let classFilter = ''
  const binds: any[] = [trimesterId, trimesterId, trimesterId]
  if (classId) {
    classFilter = 'AND st.class_id = ?'
  }

  let query = `
    SELECT st.id as student_id, st.nom, st.post_nom, st.prenom, st.matricule, st.categorie, cl.id as class_id, cl.name as class_name,
      ${FEE_FOR_STUDENT_SQL} as fee_amount,
      COALESCE((SELECT SUM(p.montant) FROM payments p WHERE p.student_id = st.id AND p.trimester_id = ? AND p.cancelled = 0), 0) as total_paid
    FROM students st
    JOIN classes cl ON cl.id = st.class_id
    WHERE st.active = 1 AND cl.school_id = ? ${classFilter}
  `
  binds.push(user.school_id)
  if (classId) binds.push(classId)

  const { results } = await db.prepare(query).bind(...binds).all<any>()

  const debts = results
    .map((r: any) => ({ ...r, balance: r.fee_amount - r.total_paid }))
    .filter((r: any) => r.balance > 0)
    .sort((a: any, b: any) => b.balance - a.balance)

  const totalDebt = debts.reduce((sum: number, r: any) => sum + r.balance, 0)

  return c.json({ debts, total_debt: totalDebt, count: debts.length })
})

export default perception