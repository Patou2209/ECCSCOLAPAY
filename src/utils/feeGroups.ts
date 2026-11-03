// ============================================================================
// GROUPES DE FRAIS : certaines classes partagent les mêmes frais (et donc les
// mêmes quotas). Ce module est la SEULE source de vérité de ces règles : il est
// utilisé par la structure des frais, par la répartition des quotas, et le
// frontend récupère les groupes via GET /api/admin/fee-groups (plus de logique
// dupliquée côté navigateur).
//
// Règles :
//  - Toutes les 7ème partagent les mêmes frais ; idem toutes les 8ème.
//  - Humanités, pour chaque option :
//      * 1ère + 2ème  = un groupe commun
//      * 3ème         = un groupe à part (retirée du groupe 1ère-2ème)
//      * 4ème         = un groupe à part
//  - Les autres classes (primaire, classes sans option) sont individuelles.
// ============================================================================

export type FeeGroup = {
  key: string
  label: string
  class_ids: number[]
  class_names: string[]
}

/** Supprime les accents (évite les écarts NFC/NFD entre navigateurs/OS). */
export function stripAccents(s: string): string {
  return s ? s.normalize('NFD').replace(/[\u0300-\u036f]/g, '') : s
}

/** Ordinal d'une classe sans accent, en minuscules : « 1ère Scientifique » -> « 1ere ». */
export function classOrdinal(name: string): string {
  return stripAccents(String(name || '').trim().split(/\s+/)[0]).toLowerCase()
}

const HUM_JUNIOR_ORDINALS = ['1ere', '2eme']
const CTEB_ORDINALS = ['7eme', '8eme']

const optNorm = (v: any) => stripAccents(String(v || '')).toLowerCase().trim()

/** Clé stable du groupe de frais d'une classe. */
export function feeGroupKey(cls: { id: number; name: string; option?: string | null }): string {
  const ord = classOrdinal(cls.name)
  if (CTEB_ORDINALS.includes(ord)) return `ord:${ord}`
  if (cls.option) {
    if (HUM_JUNIOR_ORDINALS.includes(ord)) return `opt-jr:${optNorm(cls.option)}`
    return `opt:${optNorm(cls.option)}:${ord}`
  }
  return `cls:${cls.id}`
}

function feeGroupLabel(key: string, cls: { name: string; option?: string | null }): string {
  const ord = String(cls.name || '').trim().split(/\s+/)[0]
  if (key.startsWith('ord:')) return `Toutes les ${ord}`
  if (key.startsWith('opt-jr:')) return `1ère – 2ème ${cls.option}`
  if (key.startsWith('opt:')) return `${ord} ${cls.option}`
  return cls.name
}

/** Regroupe une liste de classes (id, name, option) en groupes de frais. */
export function buildFeeGroups(classes: Array<{ id: number; name: string; option?: string | null }>): FeeGroup[] {
  const groups = new Map<string, FeeGroup>()
  for (const cl of classes) {
    const key = feeGroupKey(cl)
    if (!groups.has(key)) {
      groups.set(key, { key, label: feeGroupLabel(key, cl), class_ids: [], class_names: [] })
    }
    const g = groups.get(key)!
    g.class_ids.push(cl.id)
    g.class_names.push(cl.name)
  }
  return [...groups.values()]
}

/** Ids des classes du même groupe de frais que `cls` (cls incluse), dans la même année scolaire. */
export async function feeGroupClassIds(db: D1Database, sid: number, cls: any): Promise<number[]> {
  const { results: all } = await db
    .prepare(`SELECT id, name, option FROM classes WHERE school_id = ? AND school_year_id = ?`)
    .bind(sid, cls.school_year_id)
    .all<any>()
  const key = feeGroupKey(cls)
  const ids = all.filter((k: any) => feeGroupKey(k) === key).map((k: any) => k.id as number)
  return ids.length ? ids : [cls.id]
}
