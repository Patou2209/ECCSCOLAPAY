import { Hono } from 'hono'
import { serveStatic } from 'hono/cloudflare-workers'
import type { AppEnv } from './types'
import { hashPassword } from './utils/crypto'

import authRoutes from './routes/auth'
import superadminRoutes from './routes/superadmin'
import adminRoutes from './routes/admin'
import perceptionRoutes from './routes/perception'
import cashbookRoutes from './routes/cashbook'
import budgetRoutes from './routes/budget'
import reportsRoutes from './routes/reports'
import sharedRoutes from './routes/shared'
import classeRoutes from './routes/classe'
import quotasRoutes from './routes/quotas'

const app = new Hono<AppEnv>()

// ----------------------------------------------------------------------------
// Gestion globale des erreurs : renvoyer le message réel (ex. erreurs D1 :
// limite de lectures atteinte, table manquante…) au lieu d'un 500 muet.
// ----------------------------------------------------------------------------
app.onError((err, c) => {
  console.error('Erreur serveur:', err)
  const msg = (err as any)?.message || String(err)
  return c.json({ error: `Erreur serveur : ${msg}` }, 500)
})

// ----------------------------------------------------------------------------
// Fichiers statiques (frontend HTML/CSS/JS servi depuis /public)
// ----------------------------------------------------------------------------
app.use('/static/*', serveStatic({ root: './public' }))
app.use('/print/*', serveStatic({ root: './public' }))
app.get('/favicon.ico', (c) => c.body(null, 204))

// ----------------------------------------------------------------------------
// Bootstrap : crée le compte super_admin par défaut s'il n'existe pas encore
// (utile après une nouvelle installation / migration D1)
// ----------------------------------------------------------------------------
app.post('/api/bootstrap', async (c) => {
  const existing = await c.env.DB.prepare(`SELECT id FROM users WHERE role = 'super_admin' LIMIT 1`).first()
  if (existing) {
    return c.json({ error: 'Un super administrateur existe déjà' }, 409)
  }
  const { name, email, password } = await c.req.json<{ name: string; email: string; password: string }>()
  if (!name || !email || !password) {
    return c.json({ error: 'name, email, password requis' }, 400)
  }
  const { hash, salt } = await hashPassword(password)
  await c.env.DB.prepare(
    `INSERT INTO users (school_id, role, name, email, password_hash, password_salt) VALUES (NULL, 'super_admin', ?, ?, ?, ?)`
  )
    .bind(name, email.toLowerCase().trim(), hash, salt)
    .run()
  return c.json({ success: true })
})

app.get('/api/bootstrap/status', async (c) => {
  const existing = await c.env.DB.prepare(`SELECT id FROM users WHERE role = 'super_admin' LIMIT 1`).first()
  return c.json({ bootstrapped: !!existing })
})

// ----------------------------------------------------------------------------
// API routes
// ----------------------------------------------------------------------------
app.route('/api/auth', authRoutes)
app.route('/api/superadmin', superadminRoutes)
app.route('/api/admin', adminRoutes)
app.route('/api/perception', perceptionRoutes)
app.route('/api/cashbook', cashbookRoutes)
app.route('/api/budget', budgetRoutes)
app.route('/api/reports', reportsRoutes)
app.route('/api/shared', sharedRoutes)
app.route('/api/classe', classeRoutes)
app.route('/api/quotas', quotasRoutes)

// ----------------------------------------------------------------------------
// Page racine -> app frontend (SPA légère, fichiers dans /public)
// ----------------------------------------------------------------------------
app.get('/', (c) => {
  return c.redirect('/static/index.html')
})

export default app
