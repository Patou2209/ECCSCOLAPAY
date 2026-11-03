// ============================================================================
// Routes ESPACE CLASSE : accès pour le compte de connexion propre à une
// classe (rôle 'classe'). Chaque classe créée par l'admin dispose d'un
// email + mot de passe pour se connecter et consulter ses propres
// informations (élèves, frais, registre de perception, dettes).
// La classe connectée peut ajouter/importer SES PROPRES élèves (elle seule,
// pas l'admin). La saisie des paiements reste réservée aux percepteurs / à
// l'admin.
// ============================================================================
import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { requireAuth, requireRole } from '../middleware/auth'
import { getFeeAmount, getTotalPaid, FEE_FOR_STUDENT_SQL, STUDENT_CATEGORIES } from '../utils/db'

const classe = new Hono<AppEnv>()
classe.use('*', requireAuth, requireRole('classe'))

function myClassId(c: any): number {
  return c.get('user').class_id
}

// GET /api/classe/me - infos de la classe connectée
classe.get('/me', async (c) => {
  const db = c.env.DB
  const classId = myClassId(c)
  const cls = await db.prepare(`SELECT * FROM classes WHERE id = ?`).bind(classId).first<any>()
  if (!cls) return c.json({ error: 'Classe introuvable' }, 404)
  const teachers = await db
    .prepare(`SELECT u.id, u.name FROM class_teachers ct JOIN users u ON u.id = ct.teacher_id WHERE ct.class_id = ?`)
    .bind(classId)
    .all()
  const percepteurs = await db
    .prepare(`SELECT u.id, u.name FROM class_percepteurs cp JOIN users u ON u.id = cp.percepteur_id WHERE cp.class_id = ?`)
    .bind(classId)
    .all()
  return c.json({ class: cls, teachers: teachers.results, percepteurs: percepteurs.results })
})

// GET /api/classe/students - liste des élèves de la classe
classe.get('/students', async (c) => {
  const db = c.env.DB
  const classId = myClassId(c)
  const { results } = await db
    .prepare(`SELECT * FROM students WHERE class_id = ? AND active = 1 ORDER BY nom, post_nom`)
    .bind(classId)
    .all()
  return c.json({ students: results })
})

// GET /api/classe/fees - frais fixés par trimestre pour la classe
classe.get('/fees', async (c) => {
  const db = c.env.DB
  const classId = myClassId(c)
  const { results } = await db
    .prepare(
      `SELECT fs.*, t.name as trimester_name, t.number as trimester_number
       FROM fee_structures fs JOIN trimesters t ON t.id = fs.trimester_id
       WHERE fs.class_id = ? ORDER BY t.number, fs.categorie`
    )
    .bind(classId)
    .all()
  return c.json({ fee_structures: results })
})

// GET /api/classe/registre?date=&trimester_id= - registre de perception journalière (lecture seule)
// Un élève peut payer plusieurs fois le même jour : on agrège tous les paiements
// du jour par élève (montant total du jour + dernier reçu).
classe.get('/registre', async (c) => {
  const db = c.env.DB
  const classId = myClassId(c)
  const date = c.req.query('date') || new Date().toISOString().slice(0, 10)
  const trimesterId = c.req.query('trimester_id')

  const { results: baseStudents } = await db
    .prepare(`SELECT id, nom, post_nom, prenom, matricule FROM students WHERE class_id = ? AND active = 1 ORDER BY nom ASC, post_nom ASC`)
    .bind(classId)
    .all<any>()

  let paymentsQuery = `
    SELECT id as payment_id, student_id, montant as montant_jour, receipt_number
    FROM payments
    WHERE class_id = ? AND date_paiement = ? AND cancelled = 0
    ${trimesterId ? 'AND trimester_id = ?' : ''}
    ORDER BY id ASC
  `
  const payBinds: any[] = trimesterId ? [classId, date, trimesterId] : [classId, date]
  const { results: dayPayments } = await db.prepare(paymentsQuery).bind(...payBinds).all<any>()

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
      payment_id: pays.length ? pays[pays.length - 1].payment_id : null,
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

// GET /api/classe/debts?trimester_id= - dettes des élèves de la classe
classe.get('/debts', async (c) => {
  const db = c.env.DB
  const classId = myClassId(c)
  const trimesterId = c.req.query('trimester_id')
  if (!trimesterId) return c.json({ error: 'trimester_id requis' }, 400)

  const { results } = await db
    .prepare(
      `SELECT st.id as student_id, st.nom, st.post_nom, st.prenom, st.matricule, st.categorie,
        ${FEE_FOR_STUDENT_SQL} as fee_amount,
        COALESCE((SELECT SUM(p.montant) FROM payments p WHERE p.student_id = st.id AND p.trimester_id = ? AND p.cancelled = 0), 0) as total_paid
       FROM students st
       WHERE st.active = 1 AND st.class_id = ?`
    )
    .bind(trimesterId, trimesterId, trimesterId, classId)
    .all<any>()

  const debts = results
    .map((r: any) => ({ ...r, balance: r.fee_amount - r.total_paid }))
    .filter((r: any) => r.balance > 0)
    .sort((a: any, b: any) => b.balance - a.balance)

  const totalDebt = debts.reduce((sum: number, r: any) => sum + r.balance, 0)
  return c.json({ debts, total_debt: totalDebt, count: debts.length })
})

// POST /api/classe/students - la classe ajoute un de ses propres élèves
classe.post('/students', async (c) => {
  const db = c.env.DB
  const classId = myClassId(c)
  const user = c.get('user')
  const body = await c.req.json<any>()
  const { nom, post_nom, prenom, sexe, matricule, date_naissance, parent_contact, categorie } = body
  if (!nom || !post_nom) return c.json({ error: 'Nom et post-nom requis' }, 400)
  const cat = categorie || 'normal'
  if (!STUDENT_CATEGORIES.includes(cat)) {
    return c.json({ error: `Catégorie invalide (autorisées: ${STUDENT_CATEGORIES.join(', ')})` }, 400)
  }
  const result = await db
    .prepare(
      `INSERT INTO students (school_id, class_id, matricule, nom, post_nom, prenom, sexe, date_naissance, parent_contact, categorie)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(user.school_id, classId, matricule || null, nom, post_nom, prenom || null, sexe || null, date_naissance || null, parent_contact || null, cat)
    .run()
  return c.json({ success: true, id: result.meta.last_row_id })
})

// POST /api/classe/students/bulk - import en masse des élèves de la classe connectée
// (import Excel/CSV : [{nom, post_nom}, ...] uniquement pour SA propre classe)
classe.post('/students/bulk', async (c) => {
  const db = c.env.DB
  const classId = myClassId(c)
  const user = c.get('user')
  const { students } = await c.req.json<{ students: any[] }>()
  if (!Array.isArray(students) || students.length === 0) return c.json({ error: 'Liste vide' }, 400)
  let created = 0
  for (const s of students) {
    if (!s.nom || !s.post_nom) continue
    const cat = STUDENT_CATEGORIES.includes(s.categorie) ? s.categorie : 'normal'
    await db
      .prepare(
        `INSERT INTO students (school_id, class_id, matricule, nom, post_nom, prenom, sexe, categorie) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(user.school_id, classId, s.matricule || null, s.nom, s.post_nom, s.prenom || null, s.sexe || null, cat)
      .run()
    created++
  }
  return c.json({ success: true, created })
})

// PATCH /api/classe/students/:id - modifie un élève de la classe connectée (dont sa catégorie)
classe.patch('/students/:id', async (c) => {
  const db = c.env.DB
  const classId = myClassId(c)
  const id = c.req.param('id')
  const body = await c.req.json<any>()
  if (body.categorie !== undefined && !STUDENT_CATEGORIES.includes(body.categorie)) {
    return c.json({ error: `Catégorie invalide (autorisées: ${STUDENT_CATEGORIES.join(', ')})` }, 400)
  }
  const fields: string[] = []
  const values: any[] = []
  for (const key of ['nom', 'post_nom', 'prenom', 'sexe', 'matricule', 'date_naissance', 'parent_contact', 'categorie']) {
    if (body[key] !== undefined) {
      fields.push(`${key} = ?`)
      values.push(body[key])
    }
  }
  if (fields.length === 0) return c.json({ error: 'Aucun champ à mettre à jour' }, 400)
  const result = await db.prepare(`UPDATE students SET ${fields.join(', ')} WHERE id = ? AND class_id = ?`)
    .bind(...values, id, classId)
    .run()
  if (!result.meta.changes) return c.json({ error: 'Élève introuvable dans votre classe' }, 404)
  return c.json({ success: true })
})

// GET /api/classe/school-classes - liste des autres classes de l'école
// (pour choisir une destination de transfert)
classe.get('/school-classes', async (c) => {
  const db = c.env.DB
  const user = c.get('user') as any
  const classId = myClassId(c)
  const { results } = await db
    .prepare(
      `SELECT cl.id, cl.name, cl.level, cl.option FROM classes cl
       WHERE cl.school_id = ? AND cl.id != ?
       ORDER BY cl.name`
    )
    .bind(user.school_id, classId)
    .all()
  return c.json({ classes: results })
})

// POST /api/classe/students/:id/transfer - transfère un élève de la classe
// connectée vers une autre classe de l'école. L'élève part avec toutes ses
// données : ses paiements suivent (class_id des paiements mis à jour) et les
// frais appliqués deviennent ceux de la nouvelle classe automatiquement.
classe.post('/students/:id/transfer', async (c) => {
  const db = c.env.DB
  const user = c.get('user') as any
  const classId = myClassId(c)
  const id = c.req.param('id')
  const body = await c.req.json<any>()
  const toClassId = Number(body.to_class_id)
  if (!toClassId) return c.json({ error: 'Classe de destination requise' }, 400)
  if (toClassId === classId) return c.json({ error: "L'élève est déjà dans cette classe" }, 400)

  const student = await db.prepare(`SELECT * FROM students WHERE id = ? AND class_id = ?`).bind(id, classId).first<any>()
  if (!student) return c.json({ error: 'Élève introuvable dans votre classe' }, 404)

  const target = await db
    .prepare(`SELECT * FROM classes WHERE id = ? AND school_id = ?`)
    .bind(toClassId, user.school_id)
    .first<any>()
  if (!target) return c.json({ error: 'Classe de destination introuvable' }, 404)

  // 1. Déplacer l'élève
  await db.prepare(`UPDATE students SET class_id = ? WHERE id = ?`).bind(toClassId, id).run()
  // 2. Ses paiements le suivent
  await db.prepare(`UPDATE payments SET class_id = ? WHERE student_id = ?`).bind(toClassId, id).run()

  return c.json({
    success: true,
    message: `Élève transféré vers ${target.name} avec tous ses paiements et données`,
    to_class: { id: target.id, name: target.name },
  })
})

// DELETE /api/classe/students/:id - supprime un élève de la classe connectée uniquement
classe.delete('/students/:id', async (c) => {
  const db = c.env.DB
  const classId = myClassId(c)
  const id = c.req.param('id')
  const result = await db.prepare(`DELETE FROM students WHERE id = ? AND class_id = ?`).bind(id, classId).run()
  if (!result.meta.changes) return c.json({ error: 'Élève introuvable dans votre classe' }, 404)
  return c.json({ success: true })
})

// GET /api/classe/student/:id/situation?trimester_id= - situation d'un élève de la classe
classe.get('/student/:id/situation', async (c) => {
  const db = c.env.DB
  const classId = myClassId(c)
  const studentId = c.req.param('id')
  const trimesterId = c.req.query('trimester_id')

  const student = await db
    .prepare(`SELECT * FROM students WHERE id = ? AND class_id = ?`)
    .bind(studentId, classId)
    .first<any>()
  if (!student) return c.json({ error: 'Élève introuvable dans cette classe' }, 404)

  if (!trimesterId) return c.json({ student })

  const feeAmount = await getFeeAmount(db, classId, Number(trimesterId), (student as any).categorie)
  const totalPaid = await getTotalPaid(db, Number(studentId), Number(trimesterId))
  const payments = await db
    .prepare(
      `SELECT p.*, u.name as percepteur_name FROM payments p JOIN users u ON u.id = p.percepteur_id
       WHERE p.student_id = ? AND p.trimester_id = ? AND p.cancelled = 0 ORDER BY p.date_paiement DESC`
    )
    .bind(studentId, trimesterId)
    .all()

  return c.json({ student, fee_amount: feeAmount, total_paid: totalPaid, balance: feeAmount - totalPaid, payments: payments.results })
})

export default classe
