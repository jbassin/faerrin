SELECT
    -- discord
    u.username     AS discord_name,
    u.snowflake    AS discord_snowflake,
    u.is_admin     AS discord_is_admin,

    -- player
    p.id           AS player_id,
    p.name         AS player_name,

    -- campaign
    cp.name        AS campaign_name,
    cp.edition     AS "campaign_edition: GameEdition",
    cp.is_one_shot AS campaign_is_one_shot,

    -- character
    c.name         AS character_name,
    c.class        AS character_class,
    c.is_dm        AS character_is_dm
FROM users u
         JOIN players p ON u.player_id = p.id
         JOIN characters c ON p.id = c.player_id
         JOIN campaigns cp ON c.campaign_id = cp.id
         LEFT JOIN active_campaign ac ON cp.id = ac.campaign_id
WHERE ac.id IS NOT NULL
  AND u.snowflake = $1
LIMIT 1;
