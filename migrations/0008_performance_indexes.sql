-- ============================================================================
-- Migration 0008 : Index de performance
-- D1 facture les lignes SCANNÉES : sans index, chaque requête lit toute la
-- table. Ces index réduisent drastiquement les "rows read" et accélèrent
-- le chargement (dashboard, rapport percepteur, reçus, login, budget).
-- Aucune donnée n'est modifiée — uniquement des index.
-- ============================================================================

-- payments : requêtes par école + date (dashboard, registre) --------------
CREATE INDEX IF NOT EXISTS idx_payments_school_date
  ON payments(school_id, date_paiement);

-- payments : requêtes par percepteur + date (rapport journalier, reçus) ---
CREATE INDEX IF NOT EXISTS idx_payments_percepteur_date
  ON payments(percepteur_id, date_paiement);

-- payments : total payé par élève + trimestre (soldes, reçus, dettes) -----
CREATE INDEX IF NOT EXISTS idx_payments_student_trimester
  ON payments(student_id, trimester_id, cancelled);

-- payments : requêtes par classe + trimestre (rapports financiers) --------
CREATE INDEX IF NOT EXISTS idx_payments_class_trimester
  ON payments(class_id, trimester_id, cancelled);

-- class_percepteurs : classes affectées à un percepteur -------------------
-- (UNIQUE(class_id, percepteur_id) ne couvre pas les recherches par percepteur)
CREATE INDEX IF NOT EXISTS idx_class_percepteurs_percepteur
  ON class_percepteurs(percepteur_id);

-- students : comptage/listes par école (dashboard) ------------------------
CREATE INDEX IF NOT EXISTS idx_students_school_active
  ON students(school_id, active);

-- students : listes par classe + actifs (registre, reçus) -----------------
CREATE INDEX IF NOT EXISTS idx_students_class_active
  ON students(class_id, active);

-- users : connexion par email (chaque login) ------------------------------
CREATE INDEX IF NOT EXISTS idx_users_email
  ON users(email);

-- fee_structures : recherche frais par classe + trimestre + catégorie -----
-- (déjà couvert par UNIQUE(class_id, trimester_id, categorie), on s'assure)
CREATE INDEX IF NOT EXISTS idx_feestruct_class_trim_cat
  ON fee_structures(class_id, trimester_id, categorie);

-- cash_book_entries : budget réalisé par catégorie ------------------------
CREATE INDEX IF NOT EXISTS idx_cashbook_school_year_cat
  ON cash_book_entries(school_id, school_year_id, budget_category_id);

-- budget_previsions : lookup par école + année + catégorie ----------------
CREATE INDEX IF NOT EXISTS idx_budget_prev_school_year_cat
  ON budget_previsions(school_id, school_year_id, budget_category_id);

-- classes : listes par école ----------------------------------------------
CREATE INDEX IF NOT EXISTS idx_classes_school
  ON classes(school_id);

-- trimesters : par année scolaire -----------------------------------------
CREATE INDEX IF NOT EXISTS idx_trimesters_year
  ON trimesters(school_year_id);
