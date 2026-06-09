SELECT *
FROM embedding_listings
WHERE name = $1
LIMIT 1;
