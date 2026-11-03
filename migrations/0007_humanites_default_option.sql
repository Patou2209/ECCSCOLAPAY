-- Les classes des humanités créées AVANT le correctif des accents n'ont pas
-- d'option enregistrée (option NULL) et leur nom est juste « 1ère », « 2ème »…
-- On leur attribue l'option par défaut « Pedagogie generale » et on complète
-- leur nom, SANS toucher aux élèves, paiements ni frais (tout est lié par
-- class_id, donc aucune donnée de perception n'est affectée).

-- 1) Option par défaut pour toute classe des humanités sans option
UPDATE classes SET option = 'Pedagogie generale'
WHERE level = 'Humanitaire' AND (option IS NULL OR TRIM(option) = '');

-- 2) Compléter le nom si l'option n'y figure pas déjà (ex. « 1ère » → « 1ère Pedagogie generale »)
--    Protection anti-doublon : on ne renomme pas si une classe portant déjà le
--    nom cible existe pour la même année scolaire (contrainte UNIQUE) — dans ce
--    cas on ajoute un suffixe « (2) » pour distinguer sans rien casser.
UPDATE classes SET name = name || ' Pedagogie generale'
WHERE level = 'Humanitaire' AND option = 'Pedagogie generale' AND name NOT LIKE '%edagogie%'
  AND NOT EXISTS (
    SELECT 1 FROM classes c2
    WHERE c2.school_year_id = classes.school_year_id
      AND c2.id != classes.id
      AND c2.name = classes.name || ' Pedagogie generale'
  );

UPDATE classes SET name = name || ' Pedagogie generale (2)'
WHERE level = 'Humanitaire' AND option = 'Pedagogie generale' AND name NOT LIKE '%edagogie%';

-- 3) Synchroniser le nom des comptes de connexion « Classe … »
UPDATE users SET name = 'Classe ' || (SELECT c.name FROM classes c WHERE c.id = users.class_id)
WHERE role = 'classe' AND class_id IN (SELECT id FROM classes WHERE option = 'Pedagogie generale');
