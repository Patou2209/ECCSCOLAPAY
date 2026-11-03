// ============================================================================
// Routes SHARED : lectures transverses utilisées par plusieurs rôles
// (percepteur a besoin de voir trimestres, élèves de sa classe, etc.)
// ============================================================================
import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { requireAuth, requireRole } from '../middleware/auth'
import { getCurrentSchoolYear } from '../utils/db'

const shared = new Hono<AppEnv>()
shared.use('*', requireAuth, requireRole('admin', 'percepteur', 'enseignant', 'classe'))

// GET /api/shared/trimesters - trimestres de l'année courante de l'école
shared.get('/trimesters', async (c) => {
  const user = c.get('user')
  const db = c.env.DB
  const currentYear = await getCurrentSchoolYear(db, user.school_id)
  if (!currentYear) return c.json({ trimesters: [], school_year: null })
  const { results } = await db
    .prepare(`SELECT * FROM trimesters WHERE school_year_id = ? ORDER BY number`)
    .bind((currentYear as any).id)
    .all()
  return c.json({ trimesters: results, school_year: currentYear })
})

// GET /api/shared/classes/:id/students - élèves d'une classe (lecture)
shared.get('/classes/:id/students', async (c) => {
  const db = c.env.DB
  const classId = c.req.param('id')
  const { results } = await db
    .prepare(`SELECT * FROM students WHERE class_id = ? AND active = 1 ORDER BY nom, post_nom`)
    .bind(classId)
    .all()
  return c.json({ students: results })
})

export default shared
