SELECT d.value        as "value: i32",
       count(d.value) as "count!: i32",
       p.name         as player_name
FROM dice d
         join players p on d.player_id = p.id
WHERE d.timestamp > (now() - ($2::text)::interval)
  AND d.base = $1::int
  AND d.player_id <> 6
GROUP BY (p.name, d.value);
