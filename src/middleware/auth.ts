import { Context, Next } from 'hono'
import { verifyJWT } from '../utils/crypto'
import type { AppEnv, Role } from '../types'

const DEFAULT_SECRET = 'gestion-scolaire-secret-key-change-in-production'

export function getSecret(c: Context<AppEnv>): string {
  return c.env.JWT_SECRET || DEFAULT_SECRET
}

/** Vérifie la présence d'un jeton valide (cookie ou header Authorization) et injecte `user` dans le contexte. */
export async function requireAuth(c: Context<AppEnv>, next: Next) {
  const authHeader = c.req.header('Authorization')
  const cookieToken = c.req
    .header('Cookie')
    ?.split(';')
    .map((s) => s.trim())
    .find((s) => s.startsWith('token='))
    ?.split('=')[1]

  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : cookieToken

  if (!token) {
    return c.json({ error: 'Non authentifié' }, 401)
  }
  const payload = await verifyJWT(token, getSecret(c))
  if (!payload) {
    return c.json({ error: 'Session invalide ou expirée' }, 401)
  }
  c.set('user', payload as any)
  await next()
}

/** Restreint l'accès à une liste de rôles autorisés. */
export function requireRole(...roles: Role[]) {
  return async (c: Context<AppEnv>, next: Next) => {
    const user = c.get('user')
    if (!user || !roles.includes(user.role)) {
      return c.json({ error: 'Accès refusé : rôle insuffisant' }, 403)
    }
    await next()
  }
}

/** Vérifie que l'utilisateur courant appartient bien à l'école ciblée (sauf super_admin). */
export function ensureSchoolScope(c: Context<AppEnv>, targetSchoolId: number): boolean {
  const user = c.get('user')
  if (user.role === 'super_admin') return true
  return user.school_id === targetSchoolId
}
