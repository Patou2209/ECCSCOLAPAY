// ============================================================================
// Routes RÉPARTITION DES QUOTAS (admin école)
//
// Le frais scolaire (par élève, par trimestre) est réparti en :
//   - ÉCOLE (frais de construction, retenu par l'école)
//   - ECC
//   - ÉTAT = Fonctionnement + Appui aux enseignants
//                 Appui aux enseignants = Bureaux de gestion (% défaut 7)
//                                       + Enseignants debout (% défaut 93)
//
// Les quotas se configurent par GROUPE DE FRAIS x TRIMESTRE (voir
// utils/feeGroups.ts). La somme des quotas ne peut pas dépasser le frais.
//
// Montant dû d'un quota = quota par élève x nombre d'élèves de la classe, en
// EXCLUANT les élèves indigents. Calculé sur la base de données AU MOMENT DU CLIC
// sur « Régler le quota » ; une fois réglé, le montant est figé (les élèves qui
// arrivent après ne changent rien). Le solde de la caisse doit couvrir le montant.
//
// « Régler le quota » écrit une SORTIE dans le livre de caisse (donc déduite du
// solde de l'école) et enregistre un règlement ; un quota ne se règle qu'une fois
// par trimestre (annulable depuis l'historique pour le recalculer).
// ============================================================================
import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { requireAuth, requireRole } from '../middleware/auth'
import { buildFeeGroups } from '../utils/feeGroups'

const quotas = new Hono<AppEnv>()
quotas.use('*', requireAuth, requireRole('admin'))

const EPS = 0.005
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

/** Quotas réglables (sortie de caisse). `ecole` est retenu par l'école : pas de règlement. */
export const PAYABLE_QUOTAS = [
  { key: 'ecc', label: "Frais de l'ECC", short: 'ECC' },
  { key: 'fonctionnement', label: 'Frais de fonctionnement (État)', short: 'Fonctionnement' },
  { key: 'appui_bureaux', label: "Appui aux bureaux de gestion (État)", short: 'Appui bureaux de gestion' },
  { key: 'appui_debout', label: 'Appui aux enseignants debout (État)', short: 'Appui enseignants debout' }
] as const
type QuotaType = (typeof PAYABLE_QUOTAS)[number]['key']

function schoolId(c: any): number {
  return c.get('user').school_id
}

async function getTrimester(db: D1Database, sid: number, trimesterId: any) {
  return db
    .prepare(
      `SELECT t.id, t.name, t.number, t.school_year_id FROM trimesters t
       JOIN school_years sy ON sy.id = t.school_year_id
       WHERE t.id = ? AND sy.school_id = ?`
    )
    .bind(trimesterId, sid)
    .first<any>()
}

type Due = { ecole: number; ecc: number; fonctionnement: number; appui_bureaux: number; appui_debout: number }
const zeroDue = (): Due => ({ ecole: 0, ecc: 0, fonctionnement: 0, appui_bureaux: 0, appui_debout: 0 })

/** Calcule, pour un trimestre : le détail par groupe et les totaux dus par type de quota. */
async function computeTrimester(db: D1Database, sid: number, trimester: any) {
  const yearId = trimester.school_year_id
  const [classesRes, cfgRes, feeRes, payRes, stuRes, setRes] = await Promise.all([
    db.prepare(`SELECT id, name, option FROM classes WHERE school_id = ? AND school_year_id = ? ORDER BY name`).bind(sid, yearId).all<any>(),
    db.prepare(`SELECT * FROM quota_configs WHERE school_id = ? AND trimester_id = ?`).bind(sid, trimester.id).all<any>(),
    db
      .prepare(`SELECT class_id, montant FROM fee_structures WHERE school_id = ? AND trimester_id = ? AND categorie = 'normal'`)
      .bind(sid, trimester.id)
      .all<any>(),
    db
      .prepare(
        `SELECT class_id, COALESCE(SUM(montant),0) AS total FROM payments
         WHERE school_id = ? AND trimester_id = ? AND cancelled = 0 GROUP BY class_id`
      )
      .bind(sid, trimester.id)
      .all<any>(),
    db
      .prepare(
        `SELECT class_id, COUNT(*) AS n FROM students
         WHERE school_id = ? AND active = 1 AND categorie != 'indigent' GROUP BY class_id`
      )
      .bind(sid)
      .all<any>(),
    db
      .prepare(
        `SELECT quota_type, COALESCE(SUM(montant),0) AS total FROM quota_settlements
         WHERE school_id = ? AND trimester_id = ? GROUP BY quota_type`
      )
      .bind(sid, trimester.id)
      .all<any>()
  ])

  const cfgByKey = new Map<string, any>(cfgRes.results.map((r: any) => [r.group_key, r]))
  const feeByClass = new Map<number, number>(feeRes.results.map((r: any) => [r.class_id, r.montant]))
  const paidByClass = new Map<number, number>(payRes.results.map((r: any) => [r.class_id, r.total]))
  const studentsByClass = new Map<number, number>(stuRes.results.map((r: any) => [r.class_id, r.n]))
  const settledByType = new Map<string, number>(setRes.results.map((r: any) => [r.quota_type, r.total]))

  const totals = zeroDue()
  let totalCollected = 0
  const groups = buildFeeGroups(classesRes.results).map((g) => {
    const cfg = cfgByKey.get(g.key)
    const config = {
      ecole: cfg?.ecole ?? 0,
      ecc: cfg?.ecc ?? 0,
      fonctionnement: cfg?.fonctionnement ?? 0,
      appui_enseignants: cfg?.appui_enseignants ?? 0,
      pct_bureaux: cfg?.pct_bureaux ?? 7,
      configured: !!cfg
    }
    const fee = g.class_ids.map((id) => feeByClass.get(id) ?? 0).find((f) => f > 0) ?? 0
    const due = zeroDue()
    let collected = 0
    let students = 0
    for (const cid of g.class_ids) {
      collected += paidByClass.get(cid) ?? 0
      const n = studentsByClass.get(cid) ?? 0
      students += n
      const appui = n * config.appui_enseignants
      const bureaux = (appui * config.pct_bureaux) / 100
      due.ecole += n * config.ecole
      due.ecc += n * config.ecc
      due.fonctionnement += n * config.fonctionnement
      due.appui_bureaux += bureaux
      due.appui_debout += appui - bureaux
    }
    for (const k of Object.keys(due) as (keyof Due)[]) totals[k] += due[k]
    totalCollected += collected
    const rounded = zeroDue()
    for (const k of Object.keys(due) as (keyof Due)[]) rounded[k] = round2(due[k])
    return { ...g, fee, config, students, collected: round2(collected), due: rounded }
  })

  const payable = PAYABLE_QUOTAS.map((q) => {
    const settled = round2(settledByType.get(q.key) ?? 0)
    // Une fois réglé, le quota est FIGÉ : les élèves arrivés après le règlement ne
    // changent plus rien. Tant qu'il n'est pas réglé, le dû suit la base de données.
    const isSettled = settled > 0
    const due = isSettled ? settled : round2(totals[q.key])
    return { key: q.key, label: q.label, short: q.short, due, settled, remaining: isSettled ? 0 : due }
  })

  return {
    trimester: { id: trimester.id, name: trimester.name, number: trimester.number, school_year_id: yearId },
    groups,
    payable,
    retained_ecole: round2(totals.ecole),
    total_collected: round2(totalCollected)
  }
}

async function cashBalance(db: D1Database, sid: number, yearId: number): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COALESCE(SUM(entree),0) - COALESCE(SUM(sortie),0) AS solde FROM cash_book_entries
       WHERE school_id = ? AND school_year_id = ?`
    )
    .bind(sid, yearId)
    .first<{ solde: number }>()
  return row?.solde ?? 0
}

// GET /api/quotas/overview?school_year_id= — une carte KPI par trimestre
quotas.get('/overview', async (c) => {
  const db = c.env.DB
  const sid = schoolId(c)
  const yearId = c.req.query('school_year_id')
  if (!yearId) return c.json({ error: 'school_year_id requis' }, 400)
  const { results: trims } = await db
    .prepare(
      `SELECT t.id, t.name, t.number, t.school_year_id FROM trimesters t
       JOIN school_years sy ON sy.id = t.school_year_id
       WHERE t.school_year_id = ? AND sy.school_id = ? ORDER BY t.number`
    )
    .bind(yearId, sid)
    .all<any>()
  const out = []
  for (const t of trims) {
    const r = await computeTrimester(db, sid, t)
    out.push({
      trimester_id: t.id,
      name: t.name,
      number: t.number,
      total_collected: r.total_collected,
      due: round2(r.payable.reduce((s, p) => s + p.due, 0)),
      settled: round2(r.payable.reduce((s, p) => s + p.settled, 0)),
      remaining: round2(r.payable.reduce((s, p) => s + p.remaining, 0)),
      retained_ecole: r.retained_ecole
    })
  }
  return c.json({ trimesters: out })
})

// GET /api/quotas/trimester/:id — détail : groupes + configuration, totaux à régler, historique
quotas.get('/trimester/:id', async (c) => {
  const db = c.env.DB
  const sid = schoolId(c)
  const trimester = await getTrimester(db, sid, c.req.param('id'))
  if (!trimester) return c.json({ error: 'Trimestre introuvable' }, 404)
  const detail = await computeTrimester(db, sid, trimester)
  const { results: history } = await db
    .prepare(
      `SELECT qs.*, u.name AS created_by_name FROM quota_settlements qs
       LEFT JOIN users u ON u.id = qs.created_by
       WHERE qs.school_id = ? AND qs.trimester_id = ? ORDER BY qs.id DESC`
    )
    .bind(sid, trimester.id)
    .all<any>()
  const balance = await cashBalance(db, sid, trimester.school_year_id)
  return c.json({ ...detail, history, cash_balance: round2(balance) })
})

// PUT /api/quotas/config — enregistre les quotas d'UN groupe pour UN trimestre
quotas.put('/config', async (c) => {
  const db = c.env.DB
  const sid = schoolId(c)
  const body = await c.req.json<any>()
  const { trimester_id, group_key } = body
  if (!trimester_id || !group_key) return c.json({ error: 'trimester_id et group_key requis' }, 400)

  const num = (v: any) => (v === '' || v === null || v === undefined ? 0 : Number(v))
  const ecole = num(body.ecole)
  const ecc = num(body.ecc)
  const fonctionnement = num(body.fonctionnement)
  const appui = num(body.appui_enseignants)
  const pctBureaux = body.pct_bureaux === undefined || body.pct_bureaux === '' ? 7 : Number(body.pct_bureaux)
  for (const v of [ecole, ecc, fonctionnement, appui, pctBureaux]) {
    if (!Number.isFinite(v) || v < 0) return c.json({ error: 'Les montants et pourcentages doivent être des nombres positifs' }, 400)
  }
  if (pctBureaux > 100) return c.json({ error: 'Le pourcentage ne peut pas dépasser 100 %' }, 400)

  const trimester = await getTrimester(db, sid, trimester_id)
  if (!trimester) return c.json({ error: 'Trimestre introuvable' }, 404)

  const detail = await computeTrimester(db, sid, trimester)
  const group = detail.groups.find((g) => g.key === group_key)
  if (!group) return c.json({ error: 'Groupe de classes introuvable pour cette année scolaire' }, 404)

  const sum = ecole + ecc + fonctionnement + appui
  if (group.fee <= 0 && sum > 0) {
    return c.json({ error: `Aucun frais n'est fixé pour « ${group.label} » ce trimestre : fixez d'abord les frais scolaires.` }, 400)
  }
  if (sum > group.fee + EPS) {
    return c.json(
      { error: `La somme des quotas (${round2(sum)}) dépasse le frais demandé (${group.fee}) pour « ${group.label} ».` },
      400
    )
  }

  await db
    .prepare(
      `INSERT INTO quota_configs (school_id, trimester_id, group_key, ecole, ecc, fonctionnement, appui_enseignants, pct_bureaux)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(school_id, trimester_id, group_key) DO UPDATE SET
         ecole = excluded.ecole, ecc = excluded.ecc, fonctionnement = excluded.fonctionnement,
         appui_enseignants = excluded.appui_enseignants, pct_bureaux = excluded.pct_bureaux,
         updated_at = CURRENT_TIMESTAMP`
    )
    .bind(sid, trimester_id, group_key, ecole, ecc, fonctionnement, appui, pctBureaux)
    .run()
  return c.json({ success: true })
})

// POST /api/quotas/settle — « Régler le quota » (un type de quota, un trimestre)
// Corps : { trimester_id, quota_type, expected_amount, entry_date? }
// `expected_amount` = montant affiché dans la confirmation ; s'il a changé entre-temps
// (nouvelle perception, autre règlement), on refuse pour ne pas débiter un autre montant.
quotas.post('/settle', async (c) => {
  const db = c.env.DB
  const user = c.get('user')
  const sid = schoolId(c)
  const { trimester_id, quota_type, expected_amount, entry_date } = await c.req.json<any>()

  const qdef = PAYABLE_QUOTAS.find((q) => q.key === quota_type)
  if (!qdef) return c.json({ error: 'Type de quota invalide' }, 400)
  const trimester = await getTrimester(db, sid, trimester_id)
  if (!trimester) return c.json({ error: 'Trimestre introuvable' }, 404)
  if (entry_date && !/^\d{4}-\d{2}-\d{2}$/.test(entry_date)) return c.json({ error: 'Date invalide' }, 400)
  const date = entry_date || new Date().toISOString().slice(0, 10)

  const detail = await computeTrimester(db, sid, trimester)
  const p = detail.payable.find((x) => x.key === quota_type)!
  const amount = p.remaining
  if (p.settled > 0) return c.json({ error: `« ${qdef.short} » est déjà réglé pour ce trimestre.` }, 400)
  if (amount <= EPS) return c.json({ error: `Rien à régler pour « ${qdef.short} » : le montant dû est nul (vérifiez les quotas configurés).` }, 400)
  if (expected_amount === undefined || Math.abs(Number(expected_amount) - amount) > 0.01) {
    return c.json({ error: `Le montant dû a changé (${amount}). Rechargez l'écran et recommencez.` }, 409)
  }

  const balance = await cashBalance(db, sid, trimester.school_year_id)
  if (balance + EPS < amount) {
    return c.json(
      { error: `Solde de l'école insuffisant : solde ${round2(balance)}, quota à régler ${amount}.` },
      400
    )
  }

  const libelle = `Quota ${qdef.short} – ${trimester.name}`
  const ref = `QUOTA-T${trimester.number}-${String(quota_type).toUpperCase()}`

  // Atomique : le règlement n'est inséré que s'il n'en existe pas déjà un
  // (un seul règlement par type et par trimestre : protège du double clic / de deux admins simultanés) ; la ligne de caisse n'est
  // insérée que si le règlement l'a été (changes() > 0).
  const res = await db.batch([
    db
      .prepare(
        `INSERT INTO quota_settlements (school_id, school_year_id, trimester_id, quota_type, montant, entry_date, created_by)
         SELECT ?, ?, ?, ?, ?, ?, ?
         WHERE NOT EXISTS (SELECT 1 FROM quota_settlements
                           WHERE school_id = ? AND trimester_id = ? AND quota_type = ?)`
      )
      .bind(sid, trimester.school_year_id, trimester.id, quota_type, amount, date, user.uid, sid, trimester.id, quota_type),
    db
      .prepare(
        `INSERT INTO cash_book_entries
           (school_id, school_year_id, entry_date, code, libelle, ref, entree, sortie, is_auto, created_by, quota_settlement_id)
         SELECT ?, ?, ?, '', ?, ?, 0, ?, 0, ?, last_insert_rowid()
         WHERE changes() > 0`
      )
      .bind(sid, trimester.school_year_id, date, libelle, ref, amount, user.uid)
  ])
  if (!res[0].meta.changes) {
    return c.json({ error: 'Un règlement vient d\'être enregistré en parallèle. Rechargez l\'écran.' }, 409)
  }
  return c.json({ success: true, amount, libelle })
})

// DELETE /api/quotas/settlements/:id — annule un règlement (supprime aussi la ligne de caisse)
quotas.delete('/settlements/:id', async (c) => {
  const db = c.env.DB
  const sid = schoolId(c)
  const id = c.req.param('id')
  const s = await db.prepare(`SELECT id FROM quota_settlements WHERE id = ? AND school_id = ?`).bind(id, sid).first()
  if (!s) return c.json({ error: 'Règlement introuvable' }, 404)
  await db.batch([
    db.prepare(`DELETE FROM cash_book_entries WHERE quota_settlement_id = ? AND school_id = ?`).bind(id, sid),
    db.prepare(`DELETE FROM quota_settlements WHERE id = ? AND school_id = ?`).bind(id, sid)
  ])
  return c.json({ success: true })
})

export default quotas
