// ============================================================================
// Routes PREVISION BUDGETAIRE : montants prévus par catégorie / trimestre,
// comparés à la réalisation effective tirée du livre de caisse.
// ============================================================================
import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { requireAuth, requireRole } from '../middleware/auth'
import { getCurrentSchoolYear } from '../utils/db'

const budget = new Hono<AppEnv>()
budget.use('*', requireAuth, requireRole('admin'))

// GET /api/budget/previsions?school_year_id=&trimester_id=
budget.get('/previsions', async (c) => {
  const user = c.get('user')
  const db = c.env.DB
  let yearId = c.req.query('school_year_id')
  const trimesterId = c.req.query('trimester_id')

  if (!yearId) {
    const currentYear = await getCurrentSchoolYear(db, user.school_id)
    yearId = String((currentYear as any)?.id || '')
  }

  let query = `
    SELECT bp.*, bc.name as category_name, bc.type as category_type
    FROM budget_previsions bp JOIN budget_categories bc ON bc.id = bp.budget_category_id
    WHERE bp.school_id = ? AND bp.school_year_id = ?`
  const binds: any[] = [user.school_id, yearId]
  if (trimesterId) {
    query += ` AND bp.trimester_id = ?`
    binds.push(trimesterId)
  } else {
    query += ` AND bp.trimester_id IS NULL`
  }
  query += ` ORDER BY bc.type, bc.name`

  const { results } = await db.prepare(query).bind(...binds).all()
  return c.json({ previsions: results })
})

// POST /api/budget/previsions - créer/mettre à jour une prévision
budget.post('/previsions', async (c) => {
  const user = c.get('user')
  const db = c.env.DB
  const { budget_category_id, montant_prevu, notes, school_year_id, trimester_id } = await c.req.json<any>()

  if (!budget_category_id || montant_prevu === undefined) {
    return c.json({ error: 'budget_category_id et montant_prevu requis' }, 400)
  }

  let yearId = school_year_id
  if (!yearId) {
    const currentYear = await getCurrentSchoolYear(db, user.school_id)
    yearId = (currentYear as any)?.id
  }

  // Vérifier existence d'une prévision identique (même catégorie, même trimestre ou annuel)
  const existing = await db
    .prepare(
      `SELECT id FROM budget_previsions WHERE school_id = ? AND school_year_id = ? AND budget_category_id = ? AND ${
        trimester_id ? 'trimester_id = ?' : 'trimester_id IS NULL'
      }`
    )
    .bind(...(trimester_id ? [user.school_id, yearId, budget_category_id, trimester_id] : [user.school_id, yearId, budget_category_id]))
    .first<{ id: number }>()

  if (existing) {
    await db
      .prepare(`UPDATE budget_previsions SET montant_prevu = ?, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .bind(montant_prevu, notes || null, existing.id)
      .run()
    return c.json({ success: true, id: existing.id })
  } else {
    const result = await db
      .prepare(
        `INSERT INTO budget_previsions (school_id, school_year_id, trimester_id, budget_category_id, montant_prevu, notes)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(user.school_id, yearId, trimester_id || null, budget_category_id, montant_prevu, notes || null)
      .run()
    return c.json({ success: true, id: result.meta.last_row_id })
  }
})

budget.delete('/previsions/:id', async (c) => {
  const user = c.get('user')
  await c.env.DB.prepare(`DELETE FROM budget_previsions WHERE id = ? AND school_id = ?`).bind(c.req.param('id'), user.school_id).run()
  return c.json({ success: true })
})

// GET /api/budget/comparison?school_year_id=&trimester_id= - Prévu vs Réalisé
budget.get('/comparison', async (c) => {
  const user = c.get('user')
  const db = c.env.DB
  let yearId = c.req.query('school_year_id')
  const trimesterId = c.req.query('trimester_id')

  if (!yearId) {
    const currentYear = await getCurrentSchoolYear(db, user.school_id)
    yearId = String((currentYear as any)?.id || '')
  }

  let dateFilter = ''
  const dateBinds: any[] = []
  if (trimesterId) {
    const trimester = await db.prepare(`SELECT start_date, end_date FROM trimesters WHERE id = ?`).bind(trimesterId).first<any>()
    if (trimester?.start_date && trimester?.end_date) {
      dateFilter = ' AND entry_date BETWEEN ? AND ?'
      dateBinds.push(trimester.start_date, trimester.end_date)
    }
  }

  const categories = await db.prepare(`SELECT * FROM budget_categories WHERE school_id = ? ORDER BY type, name`).bind(user.school_id).all<any>()

  const rows = []
  for (const cat of categories.results) {
    const prevision = await db
      .prepare(
        `SELECT montant_prevu FROM budget_previsions WHERE school_id = ? AND school_year_id = ? AND budget_category_id = ? AND ${
          trimesterId ? 'trimester_id = ?' : 'trimester_id IS NULL'
        }`
      )
      .bind(...(trimesterId ? [user.school_id, yearId, cat.id, trimesterId] : [user.school_id, yearId, cat.id]))
      .first<{ montant_prevu: number }>()

    const col = cat.type === 'RECETTE' ? 'entree' : 'sortie'
    const realise = await db
      .prepare(
        `SELECT COALESCE(SUM(${col}),0) as total FROM cash_book_entries WHERE school_id = ? AND school_year_id = ? AND budget_category_id = ? ${dateFilter}`
      )
      .bind(user.school_id, yearId, cat.id, ...dateBinds)
      .first<{ total: number }>()

    const prevu = prevision?.montant_prevu ?? 0
    const reel = realise?.total ?? 0
    rows.push({
      category_id: cat.id,
      category_name: cat.name,
      type: cat.type,
      prevu,
      realise: reel,
      ecart: reel - prevu,
      taux: prevu > 0 ? Math.round((reel / prevu) * 100) : null
    })
  }

  return c.json({ rows })
})

export default budget
