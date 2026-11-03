// ============================================================================
// Routes SUPER ADMIN : gestion globale des écoles + comptes admin d'école
// ============================================================================
import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { requireAuth, requireRole } from '../middleware/auth'
import { hashPassword } from '../utils/crypto'

const superadmin = new Hono<AppEnv>()
superadmin.use('*', requireAuth, requireRole('super_admin'))

// GET /api/superadmin/schools - liste toutes les écoles avec stats
superadmin.get('/schools', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT s.*,
       (SELECT COUNT(*) FROM users u WHERE u.school_id = s.id AND u.role='admin') as admin_count,
       (SELECT COUNT(*) FROM classes cl WHERE cl.school_id = s.id) as class_count,
       (SELECT COUNT(*) FROM students st WHERE st.school_id = s.id AND st.active=1) as student_count
     FROM schools s ORDER BY s.created_at DESC`
  ).all()
  return c.json({ schools: results })
})

// POST /api/superadmin/schools - créer une école + son année scolaire + son admin
superadmin.post('/schools', async (c) => {
  const body = await c.req.json<{
    name: string
    code: string
    address?: string
    phone?: string
    currency?: string
    year_label: string
    admin_name: string
    admin_email: string
    admin_password: string
  }>()

  const required = ['name', 'code', 'year_label', 'admin_name', 'admin_email', 'admin_password']
  for (const field of required) {
    if (!(body as any)[field]) {
      return c.json({ error: `Le champ "${field}" est requis` }, 400)
    }
  }

  const db = c.env.DB
  const user = c.get('user')

  // Vérifier unicité code école et email admin
  const existingSchool = await db.prepare(`SELECT id FROM schools WHERE code = ?`).bind(body.code).first()
  if (existingSchool) return c.json({ error: 'Ce code école est déjà utilisé' }, 409)

  const existingUser = await db.prepare(`SELECT id FROM users WHERE email = ?`).bind(body.admin_email).first()
  if (existingUser) return c.json({ error: 'Cet email est déjà utilisé' }, 409)

  try {
    const schoolResult = await db
      .prepare(
        `INSERT INTO schools (code, name, address, phone, currency, created_by) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(body.code, body.name, body.address || null, body.phone || null, body.currency || 'CDF', user.uid)
      .run()
    const schoolId = schoolResult.meta.last_row_id as number

    const yearResult = await db
      .prepare(
        `INSERT INTO school_years (school_id, label, is_current) VALUES (?, ?, 1)`
      )
      .bind(schoolId, body.year_label)
      .run()
    const yearId = yearResult.meta.last_row_id as number

    // Créer les 3 trimestres par défaut
    for (let i = 1; i <= 3; i++) {
      await db
        .prepare(`INSERT INTO trimesters (school_year_id, number, name) VALUES (?, ?, ?)`)
        .bind(yearId, i, `${i === 1 ? '1er' : i + 'ème'} Trimestre`)
        .run()
    }

    // Catégories budgétaires par défaut
    const defaultRecettes = ['Frais scolaires', 'Subventions', 'Dons', 'Autres recettes']
    const defaultDepenses = [
      'Salaires enseignants',
      'Fournitures scolaires',
      'Entretien / Réparations',
      'Transport',
      'Restauration',
      'Autres dépenses'
    ]
    for (const name of defaultRecettes) {
      await db.prepare(`INSERT INTO budget_categories (school_id, type, name) VALUES (?, 'RECETTE', ?)`).bind(schoolId, name).run()
    }
    for (const name of defaultDepenses) {
      await db.prepare(`INSERT INTO budget_categories (school_id, type, name) VALUES (?, 'DEPENSE', ?)`).bind(schoolId, name).run()
    }

    // Créer le compte admin de l'école
    const { hash, salt } = await hashPassword(body.admin_password)
    await db
      .prepare(
        `INSERT INTO users (school_id, role, name, email, password_hash, password_salt) VALUES (?, 'admin', ?, ?, ?, ?)`
      )
      .bind(schoolId, body.admin_name, body.admin_email.toLowerCase().trim(), hash, salt)
      .run()

    return c.json({ success: true, school_id: schoolId, school_year_id: yearId })
  } catch (e: any) {
    return c.json({ error: 'Erreur lors de la création : ' + e.message }, 500)
  }
})

// PATCH /api/superadmin/schools/:id - activer/désactiver, modifier infos
superadmin.patch('/schools/:id', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json<any>()
  const fields: string[] = []
  const values: any[] = []
  for (const key of ['name', 'address', 'phone', 'currency', 'active', 'logo_url']) {
    if (body[key] !== undefined) {
      fields.push(`${key} = ?`)
      values.push(body[key])
    }
  }
  if (fields.length === 0) return c.json({ error: 'Aucun champ à mettre à jour' }, 400)
  await c.env.DB.prepare(`UPDATE schools SET ${fields.join(', ')} WHERE id = ?`)
    .bind(...values, id)
    .run()
  return c.json({ success: true })
})

// DELETE /api/superadmin/schools/:id
superadmin.delete('/schools/:id', async (c) => {
  const id = c.req.param('id')
  await c.env.DB.prepare(`DELETE FROM schools WHERE id = ?`).bind(id).run()
  return c.json({ success: true })
})

// GET /api/superadmin/schools/:id/admins - liste des admins d'une école
superadmin.get('/schools/:id/admins', async (c) => {
  const id = c.req.param('id')
  const { results } = await c.env.DB.prepare(
    `SELECT id, name, email, active, created_at FROM users WHERE school_id = ? AND role = 'admin' ORDER BY created_at DESC`
  )
    .bind(id)
    .all()
  return c.json({ admins: results })
})

// POST /api/superadmin/schools/:id/admins - ajouter un admin à une école existante
superadmin.post('/schools/:id/admins', async (c) => {
  const schoolId = c.req.param('id')
  const { name, email, password } = await c.req.json<{ name: string; email: string; password: string }>()
  if (!name || !email || !password) return c.json({ error: 'Champs requis manquants' }, 400)

  const existing = await c.env.DB.prepare(`SELECT id FROM users WHERE email = ?`).bind(email).first()
  if (existing) return c.json({ error: 'Cet email est déjà utilisé' }, 409)

  const { hash, salt } = await hashPassword(password)
  await c.env.DB.prepare(
    `INSERT INTO users (school_id, role, name, email, password_hash, password_salt) VALUES (?, 'admin', ?, ?, ?, ?)`
  )
    .bind(schoolId, name, email.toLowerCase().trim(), hash, salt)
    .run()
  return c.json({ success: true })
})

// GET /api/superadmin/dashboard - statistiques globales
superadmin.get('/dashboard', async (c) => {
  const db = c.env.DB
  const schoolCount = await db.prepare(`SELECT COUNT(*) as n FROM schools`).first<{ n: number }>()
  const activeSchoolCount = await db.prepare(`SELECT COUNT(*) as n FROM schools WHERE active = 1`).first<{ n: number }>()
  const studentCount = await db.prepare(`SELECT COUNT(*) as n FROM students WHERE active = 1`).first<{ n: number }>()
  const userCount = await db.prepare(`SELECT COUNT(*) as n FROM users`).first<{ n: number }>()
  const totalCollected = await db
    .prepare(`SELECT COALESCE(SUM(montant),0) as total FROM payments WHERE cancelled = 0`)
    .first<{ total: number }>()

  return c.json({
    schools: schoolCount?.n ?? 0,
    active_schools: activeSchoolCount?.n ?? 0,
    students: studentCount?.n ?? 0,
    users: userCount?.n ?? 0,
    total_collected: totalCollected?.total ?? 0
  })
})

export default superadmin
