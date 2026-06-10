SELECT d.value     as "value!: i32",
       count(d.value) as "count!: i32",
       d.player_id as "player_id!: i32"
FROM dice d
WHERE d.timestamp > datetime('now', '-' || ?2)
  AND d.base = ?1
  AND d.player_id <> 6
GROUP BY d.player_id, d.value;
