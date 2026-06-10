SELECT d.value        as "value: i32",
       count(d.value) as "count!: i32",
       d.player_id    as "player_id!: i32"
FROM dice d
WHERE d.timestamp > (now() - ($2::text)::interval)
  AND d.base = $1::int
  AND d.player_id <> 6
GROUP BY (d.player_id, d.value);
