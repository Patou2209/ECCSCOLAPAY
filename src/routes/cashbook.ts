// ============================================================================
// Routes LIVRE DE CAISSE (Image 2 : DATE, CODE, LIBELLE, REF, ENTREE, SORTIE, SOLDE)
// Le solde est calculé côté serveur de manière cumulative, dans l'ordre
// chronologique (date, puis id d'insertion).
// ============================================================================
import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { requireAuth, requireRole } from '../middleware/auth'
import { getCurrentSchoolYear } from '../utils/db'

const cashbook = new Hono<AppEnv>()
cashbook.use('*', requireAuth, requireRole('admin', 'percepteur'))

// GET /api/cashbook?school_year_id=&from=&to= - liste avec solde cumulé
cashbook.get('/', async (c) => {
  const user = c.get('user')
  const db = c.env.DB
  let schoolYearId = c.req.query('school_year_id')
  const from = c.req.query('from')
  const to = c.req.query('to')

  if (!schoolYearId) {
    const currentYear = await getCurrentSchoolYear(db, user.school_id)
    schoolYearId = String((currentYear as any)?.id || '')
  }
  if (!schoolYearId) return c.json({ entries: [], solde_initial: 0, solde_final: 0 })

  // Solde initial = somme de tout ce qui précède la date "from" (si filtre de date appliqué)
  let soldeInitial = 0
  if (from) {
    const row = await db
      .prepare(
        `SELECT COALESCE(SUM(entree),0) - COALESCE(SUM(sortie),0) as solde FROM cash_book_entries
         WHERE school_id = ? AND school_year_id = ? AND entry_date < ?`
      )
      .bind(user.school_id, schoolYearId, from)
      .first<{ solde: number }>()
    soldeInitial = row?.solde ?? 0
  }

  let query = `SELECT * FROM cash_book_entries WHERE school_id = ? AND school_year_id = ?`
  const binds: any[] = [user.school_id, schoolYearId]
  if (from) {
    query += ` AND entry_date >= ?`
    binds.push(from)
  }
  if (to) {
    query += ` AND entry_date <= ?`
    binds.push(to)
  }
  query += ` ORDER BY entry_date ASC, id ASC`

  const { results } = await db.prepare(query).bind(...binds).all<any>()

  let running = soldeInitial
  const entries = results.map((r: any) => {
    running += (r.entree || 0) - (r.sortie || 0)
    return { ...r, solde: running }
  })

  const totalEntree = entries.reduce((s: number, e: any) => s + (e.entree || 0), 0)
  const totalSortie = entries.reduce((s: number, e: any) => s + (e.sortie || 0), 0)

  return c.json({
    entries,
    solde_initial: soldeInitial,
    solde_final: running,
    total_entree: totalEntree,
    total_sortie: totalSortie
  })
})

// POST /api/cashbook - ajouter une ligne manuelle (dépense/recette hors perception)
cashbook.post('/', async (c) => {
  const user = c.get('user')
  const db = c.env.DB
  const { entry_date, code, libelle, ref, entree, sortie, budget_category_id, school_year_id } = await c.req.json<any>()

  if (!entry_date || !libelle) return c.json({ error: 'Date et libellé requis' }, 400)
  if ((!entree || entree <= 0) && (!sortie || sortie <= 0)) {
    return c.json({ error: 'Un montant en entrée ou en sortie est requis' }, 400)
  }

  let yearId = school_year_id
  if (!yearId) {
    const currentYear = await getCurrentSchoolYear(db, user.school_id)
    yearId = (currentYear as any)?.id
  }
  if (!yearId) return c.json({ error: 'Aucune année scolaire active' }, 400)

  if (code && !['F', 'B', 'R', 'AUT', ''].includes(code)) {
    return c.json({ error: 'Code invalide (F, B, R, AUT)' }, 400)
  }

  const result = await db
    .prepare(
      `INSERT INTO cash_book_entries (school_id, school_year_id, entry_date, code, libelle, ref, entree, sortie, budget_category_id, is_auto, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`
    )
    .bind(user.school_id, yearId, entry_date, code || '', libelle, ref || null, entree || 0, sortie || 0, budget_category_id || null, user.uid)
    .run()

  return c.json({ success: true, id: result.meta.last_row_id })
})

// PATCH /api/cashbook/:id - modifier une ligne manuelle
cashbook.patch('/:id', async (c) => {
  const user = c.get('user')
  const db = c.env.DB
  const id = c.req.param('id')
  const body = await c.req.json<any>()

  const existing = await db.prepare(`SELECT * FROM cash_book_entries WHERE id = ? AND school_id = ?`).bind(id, user.school_id).first<any>()
  if (!existing) return c.json({ error: 'Ligne introuvable' }, 404)
  if (existing.is_auto) return c.json({ error: 'Cette ligne est générée automatiquement depuis les perceptions et ne peut pas être modifiée manuellement' }, 400)
  if (existing.quota_settlement_id) return c.json({ error: 'Cette ligne provient d\'un règlement de quota : annulez-la depuis l\'onglet Répartition des quotas' }, 400)

  const fields: string[] = []
  const values: any[] = []
  for (const key of ['entry_date', 'code', 'libelle', 'ref', 'entree', 'sortie', 'budget_category_id']) {
    if (body[key] !== undefined) {
      fields.push(`${key} = ?`)
      values.push(body[key])
    }
  }
  if (fields.length === 0) return c.json({ error: 'Aucun champ à mettre à jour' }, 400)
  await db.prepare(`UPDATE cash_book_entries SET ${fields.join(', ')} WHERE id = ?`).bind(...values, id).run()
  return c.json({ success: true })
})

// DELETE /api/cashbook/:id
cashbook.delete('/:id', async (c) => {
  const user = c.get('user')
  const db = c.env.DB
  const id = c.req.param('id')
  const existing = await db.prepare(`SELECT * FROM cash_book_entries WHERE id = ? AND school_id = ?`).bind(id, user.school_id).first<any>()
  if (!existing) return c.json({ error: 'Ligne introuvable' }, 404)
  if (existing.is_auto) return c.json({ error: 'Cette ligne est générée automatiquement et ne peut pas être supprimée manuellement (annulez les paiements du jour concerné)' }, 400)
  if (existing.quota_settlement_id) return c.json({ error: 'Cette ligne provient d\'un règlement de quota : annulez-la depuis l\'onglet Répartition des quotas' }, 400)
  await db.prepare(`DELETE FROM cash_book_entries WHERE id = ?`).bind(id).run()
  return c.json({ success: true })
})

export default cashbook
