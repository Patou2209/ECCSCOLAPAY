// ============================================================================
// Helpers pour les opérations métiers récurrentes sur la base D1
// ============================================================================
// NOTE: D1Database est un type global fourni par les types Cloudflare Workers
// (voir tsconfig "types": ["@cloudflare/workers-types"] ou généré par
// `wrangler types`). Pas d'import nécessaire ici.

/** Retourne l'année scolaire courante d'une école (is_current = 1), ou la plus récente. */
export async function getCurrentSchoolYear(db: D1Database, schoolId: number) {
  const row = await db
    .prepare(
      `SELECT * FROM school_years WHERE school_id = ? AND is_current = 1 ORDER BY id DESC LIMIT 1`
    )
    .bind(schoolId)
    .first()
  if (row) return row
  return db
    .prepare(`SELECT * FROM school_years WHERE school_id = ? ORDER BY id DESC LIMIT 1`)
    .bind(schoolId)
    .first()
}

/** Génère le numéro de reçu suivant pour une école + année scolaire (format REC-<CODE>-<ANNEE>-000123) */
export async function nextReceiptNumber(
  db: D1Database,
  schoolId: number,
  schoolYearId: number,
  schoolCode: string,
  yearLabel: string
): Promise<string> {
  await db
    .prepare(
      `INSERT INTO receipt_sequences (school_id, school_year_id, last_number)
       VALUES (?, ?, 1)
       ON CONFLICT(school_id, school_year_id) DO UPDATE SET last_number = last_number + 1`
    )
    .bind(schoolId, schoolYearId)
    .run()
  const row = await db
    .prepare(`SELECT last_number FROM receipt_sequences WHERE school_id = ? AND school_year_id = ?`)
    .bind(schoolId, schoolYearId)
    .first<{ last_number: number }>()
  const num = row?.last_number ?? 1
  const seq = String(num).padStart(6, '0')
  return `REC-${schoolCode}-${yearLabel}-${seq}`
}

/**
 * Recalcule et met à jour (upsert) la ligne agrégée "Frais scolaire" du livre de
 * caisse pour une date donnée, en sommant tous les paiements non annulés de ce
 * jour. Reproduit le fonctionnement du registre papier : chaque jour de
 * perception donne lieu à UNE seule ligne "Frais scolaire" dans le livre de
 * caisse (montant total du jour), les reçus individuels servant de justificatifs.
 */
export async function syncCashbookAutoEntry(
  db: D1Database,
  schoolId: number,
  schoolYearId: number,
  dateStr: string,
  createdBy: number
) {
  const sumRow = await db
    .prepare(
      `SELECT COALESCE(SUM(montant),0) as total, COUNT(*) as cnt
       FROM payments
       WHERE school_id = ? AND date_paiement = ? AND cancelled = 0`
    )
    .bind(schoolId, dateStr)
    .first<{ total: number; cnt: number }>()

  const total = sumRow?.total ?? 0
  const cnt = sumRow?.cnt ?? 0

  const existing = await db
    .prepare(
      `SELECT id FROM cash_book_entries WHERE school_id = ? AND auto_source_date = ? AND is_auto = 1`
    )
    .bind(schoolId, dateStr)
    .first<{ id: number }>()

  if (cnt === 0) {
    // Plus aucun paiement ce jour : supprimer la ligne auto si elle existe
    if (existing) {
      await db.prepare(`DELETE FROM cash_book_entries WHERE id = ?`).bind(existing.id).run()
    }
    return
  }

  const libelle = 'Frais scolaire'
  if (existing) {
    await db
      .prepare(`UPDATE cash_book_entries SET entree = ?, libelle = ? WHERE id = ?`)
      .bind(total, libelle, existing.id)
      .run()
  } else {
    await db
      .prepare(
        `INSERT INTO cash_book_entries
          (school_id, school_year_id, entry_date, code, libelle, ref, entree, sortie, is_auto, auto_source_date, created_by)
         VALUES (?, ?, ?, '', ?, NULL, ?, 0, 1, ?, ?)`
      )
      .bind(schoolId, schoolYearId, dateStr, libelle, total, dateStr, createdBy)
      .run()
  }
}

/** Calcule le total déjà payé par un élève pour un trimestre donné (hors paiements annulés). */
export async function getTotalPaid(db: D1Database, studentId: number, trimesterId: number): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COALESCE(SUM(montant),0) as total FROM payments
       WHERE student_id = ? AND trimester_id = ? AND cancelled = 0`
    )
    .bind(studentId, trimesterId)
    .first<{ total: number }>()
  return row?.total ?? 0
}

/** Catégories d'élèves autorisées. */
export const STUDENT_CATEGORIES = ['normal', 'indigent', 'fils_enseignant'] as const
export const STUDENT_CATEGORY_LABELS: Record<string, string> = {
  normal: 'Élève normal',
  indigent: 'Indigent',
  fils_enseignant: "Fils d'enseignant"
}

/**
 * Récupère le montant des frais fixés pour une classe + trimestre + catégorie
 * d'élève. Si aucun montant n'est fixé pour la catégorie demandée, le tarif
 * de la catégorie 'normal' s'applique par défaut.
 */
export async function getFeeAmount(
  db: D1Database,
  classId: number,
  trimesterId: number,
  categorie: string = 'normal'
): Promise<number> {
  const cat = STUDENT_CATEGORIES.includes(categorie as any) ? categorie : 'normal'
  const row = await db
    .prepare(`SELECT montant FROM fee_structures WHERE class_id = ? AND trimester_id = ? AND categorie = ?`)
    .bind(classId, trimesterId, cat)
    .first<{ montant: number }>()
  if (row) return row.montant
  if (cat !== 'normal') {
    const fallback = await db
      .prepare(`SELECT montant FROM fee_structures WHERE class_id = ? AND trimester_id = ? AND categorie = 'normal'`)
      .bind(classId, trimesterId)
      .first<{ montant: number }>()
    return fallback?.montant ?? 0
  }
  return 0
}

/**
 * Fragment SQL réutilisable : montant des frais applicable à un élève `st`
 * (selon sa catégorie, avec repli sur la catégorie 'normal').
 * Nécessite 2 bindings consécutifs : trimesterId, trimesterId.
 */
export const FEE_FOR_STUDENT_SQL = `COALESCE(
  (SELECT f1.montant FROM fee_structures f1 WHERE f1.class_id = st.class_id AND f1.trimester_id = ? AND f1.categorie = st.categorie),
  (SELECT f2.montant FROM fee_structures f2 WHERE f2.class_id = st.class_id AND f2.trimester_id = ? AND f2.categorie = 'normal'),
  0)`
