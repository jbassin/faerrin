SELECT c.id,
       c.name,
       c.edition AS "edition: GameEdition",
       c.is_one_shot
FROM active_campaign ac
         JOIN campaigns c ON ac.campaign_id = c.id
LIMIT 1;
