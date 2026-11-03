// ============================================================================
// Routes RAPPORT FINANCIER : synthèse par trimestre (recettes de perception,
// dépenses du livre de caisse, solde, taux de recouvrement)
// ============================================================================
import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { requireAuth, requireRole } from '../middleware/auth'
import { getCurrentSchoolYear, FEE_FOR_STUDENT_SQL } from '../utils/db'

const reports = new Hono<AppEnv>()
reports.use('*', requireAuth, requireRole('admin'))

// GET /api/reports/trimester/:id - rapport financier détaillé d'un trimestre
reports.get('/trimester/:id', async (c) => {
  const user = c.get('user')
  const db = c.env.DB
  const trimesterId = c.req.param('id')

  const trimester = await db.prepare(`SELECT * FROM trimesters WHERE id = ?`).bind(trimesterId).first<any>()
  if (!trimester) return c.json({ error: 'Trimestre introuvable' }, 404)

  const schoolYear = await db.prepare(`SELECT * FROM school_years WHERE id = ?`).bind(trimester.school_year_id).first<any>()

  // 1) Perception des frais scolaires (attendu vs perçu) par classe
  //    L'attendu tient compte de la catégorie de chaque élève (normal /
  //    indigent / fils d'enseignant), avec repli sur le tarif 'normal'.
  // UNE SEULE requête pour toutes les classes (perçu inclus via sous-requête
  // corrélée) — évite 1 requête par classe (N+1) qui gonflait les rows read D1.
  const classRows = await db
    .prepare(
      `SELECT cl.id as class_id, cl.name as class_name,
        (SELECT COUNT(*) FROM students st WHERE st.class_id = cl.id AND st.active = 1) as student_count,
        COALESCE((SELECT montant FROM fee_structures WHERE class_id = cl.id AND trimester_id = ? AND categorie = 'normal'), 0) as fee_amount,
        (SELECT COALESCE(SUM(${FEE_FOR_STUDENT_SQL}), 0) FROM students st WHERE st.class_id = cl.id AND st.active = 1) as attendu,
        (SELECT COALESCE(SUM(p.montant),0) FROM payments p WHERE p.class_id = cl.id AND p.trimester_id = ? AND p.cancelled = 0) as percu
       FROM classes cl
       WHERE cl.school_year_id = ? ORDER BY cl.name`
    )
    .bind(trimesterId, trimesterId, trimesterId, trimesterId, trimester.school_year_id)
    .all<any>()

  let totalAttendu = 0
  let totalPercu = 0
  const classDetails = []
  for (const cl of classRows.results) {
    const attendu = cl.attendu
    const percu = cl.percu ?? 0
    totalAttendu += attendu
    totalPercu += percu
    classDetails.push({
      class_id: cl.class_id,
      class_name: cl.class_name,
      student_count: cl.student_count,
      fee_amount: cl.fee_amount,
      attendu,
      percu,
      solde: attendu - percu,
      taux: attendu > 0 ? Math.round((percu / attendu) * 100) : null
    })
  }

  // 2) Dépenses et autres recettes (livre de caisse) sur la période du trimestre
  let cashbookFilter = ''
  const cashbookBinds: any[] = [user.school_id, trimester.school_year_id]
  if (trimester.start_date && trimester.end_date) {
    cashbookFilter = ' AND entry_date BETWEEN ? AND ?'
    cashbookBinds.push(trimester.start_date, trimester.end_date)
  }
  const cashRow = await db
    .prepare(
      `SELECT COALESCE(SUM(entree),0) as total_entree, COALESCE(SUM(sortie),0) as total_sortie
       FROM cash_book_entries WHERE school_id = ? AND school_year_id = ? ${cashbookFilter}`
    )
    .bind(...cashbookBinds)
    .first<{ total_entree: number; total_sortie: number }>()

  // 3) Dépenses par catégorie
  const expensesByCategory = await db
    .prepare(
      `SELECT bc.name as category_name, COALESCE(SUM(cbe.sortie),0) as total
       FROM cash_book_entries cbe JOIN budget_categories bc ON bc.id = cbe.budget_category_id
       WHERE cbe.school_id = ? AND cbe.school_year_id = ? AND bc.type = 'DEPENSE' ${cashbookFilter}
       GROUP BY bc.id ORDER BY total DESC`
    )
    .bind(...cashbookBinds)
    .all()

  // 4) Liste des dettes du trimestre (top débiteurs)
  const debtsAll = await db
    .prepare(
      `SELECT st.id, st.nom, st.post_nom, st.categorie, cl.name as class_name,
        ${FEE_FOR_STUDENT_SQL} - COALESCE((SELECT SUM(p.montant) FROM payments p WHERE p.student_id = st.id AND p.trimester_id = ? AND p.cancelled = 0),0) as balance
       FROM students st JOIN classes cl ON cl.id = st.class_id
       WHERE st.active = 1 AND cl.school_year_id = ?`
    )
    .bind(trimesterId, trimesterId, trimesterId, trimester.school_year_id)
    .all<any>()
  const debtsRow = {
    results: debtsAll.results
      .filter((r: any) => r.balance > 0)
      .sort((a: any, b: any) => b.balance - a.balance)
      .slice(0, 10)
  }

  return c.json({
    trimester,
    school_year: schoolYear,
    summary: {
      total_attendu: totalAttendu,
      total_percu: totalPercu,
      solde_frais: totalAttendu - totalPercu,
      taux_recouvrement: totalAttendu > 0 ? Math.round((totalPercu / totalAttendu) * 100) : null,
      total_entree_caisse: cashRow?.total_entree ?? 0,
      total_sortie_caisse: cashRow?.total_sortie ?? 0
    },
    class_details: classDetails,
    expenses_by_category: expensesByCategory.results,
    top_debtors: debtsRow.results
  })
})

// GET /api/reports/year-summary?school_year_id= - vue globale des 3 trimestres
reports.get('/year-summary', async (c) => {
  const user = c.get('user')
  const db = c.env.DB
  let yearId = c.req.query('school_year_id')
  if (!yearId) {
    const currentYear = await getCurrentSchoolYear(db, user.school_id)
    yearId = String((currentYear as any)?.id || '')
  }

  const trimesters = await db.prepare(`SELECT * FROM trimesters WHERE school_year_id = ? ORDER BY number`).bind(yearId).all<any>()

  const summary = []
  for (const t of trimesters.results) {
    const paidRow = await db
      .prepare(`SELECT COALESCE(SUM(montant),0) as total FROM payments WHERE trimester_id = ? AND cancelled = 0 AND school_id = ?`)
      .bind(t.id, user.school_id)
      .first<{ total: number }>()

    const attenduRow = await db
      .prepare(
        `SELECT COALESCE(SUM(${FEE_FOR_STUDENT_SQL}), 0) as total
         FROM students st JOIN classes cl ON cl.id = st.class_id
         WHERE st.active = 1 AND cl.school_id = ?`
      )
      .bind(t.id, t.id, user.school_id)
      .first<{ total: number }>()

    let cashbookFilter = ''
    const binds: any[] = [user.school_id, yearId]
    if (t.start_date && t.end_date) {
      cashbookFilter = ' AND entry_date BETWEEN ? AND ?'
      binds.push(t.start_date, t.end_date)
    }
    const cashRow = await db
      .prepare(`SELECT COALESCE(SUM(sortie),0) as total FROM cash_book_entries WHERE school_id = ? AND school_year_id = ? ${cashbookFilter}`)
      .bind(...binds)
      .first<{ total: number }>()

    summary.push({
      trimester_id: t.id,
      trimester_name: t.name,
      trimester_number: t.number,
      total_attendu: attenduRow?.total ?? 0,
      total_percu: paidRow?.total ?? 0,
      total_depenses: cashRow?.total ?? 0
    })
  }

  return c.json({ school_year_id: yearId, trimesters: summary })
})

export default reports
