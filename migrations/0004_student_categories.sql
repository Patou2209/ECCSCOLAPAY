-- ============================================================================
-- Migration 0004 : Catégories d'élèves et frais par catégorie
-- Trois catégories d'élèves : 'normal' (élève normal), 'indigent' (indigent),
-- 'fils_enseignant' (fils d'enseignant). Chaque catégorie peut avoir son
-- propre montant de frais par classe et par trimestre. Si aucun montant n'est
-- fixé pour une catégorie, le tarif 'normal' s'applique par défaut.
-- ============================================================================

PRAGMA defer_foreign_keys = TRUE;

-- -----------------------------------------------------------------------
-- 1) Colonne 'categorie' sur les élèves
-- -----------------------------------------------------------------------
ALTER TABLE students ADD COLUMN categorie TEXT NOT NULL DEFAULT 'normal'
  CHECK(categorie IN ('normal','indigent','fils_enseignant'));

-- -----------------------------------------------------------------------
-- 2) Recréation de FEE_STRUCTURES avec la colonne 'categorie'
--    (l'unicité passe de (class_id, trimester_id) à
--     (class_id, trimester_id, categorie))
-- -----------------------------------------------------------------------
ALTER TABLE fee_structures RENAME TO fee_structures_old_0004;

CREATE TABLE fee_structures (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id     INTEGER NOT NULL,
  class_id      INTEGER NOT NULL,
  trimester_id  INTEGER NOT NULL,
  categorie     TEXT NOT NULL DEFAULT 'normal' CHECK(categorie IN ('normal','indigent','fils_enseignant')),
  montant       REAL NOT NULL,
  created_at    TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at    TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE,
  FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE,
  FOREIGN KEY (trimester_id) REFERENCES trimesters(id) ON DELETE CASCADE,
  UNIQUE(class_id, trimester_id, categorie)
);

-- Les frais existants deviennent les frais de la catégorie 'normal'
INSERT INTO fee_structures (id, school_id, class_id, trimester_id, categorie, montant, created_at, updated_at)
SELECT id, school_id, class_id, trimester_id, 'normal', montant, created_at, updated_at
FROM fee_structures_old_0004;

DROP TABLE fee_structures_old_0004;

CREATE INDEX IF NOT EXISTS idx_feestruct_class ON fee_structures(class_id);
CREATE INDEX IF NOT EXISTS idx_students_categorie ON students(categorie);
