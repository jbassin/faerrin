-- speaks runtime schema (SQLite). The bot owns only its own state now: dice
-- roll history (keyed by the stable integer player_id from players.toml) and
-- user-defined roll macros. Identity tables are gone — see players.toml.

create table if not exists dice (
    id        integer primary key autoincrement,
    base      integer not null,
    value     integer not null,
    source    text    not null default 'discord',
    timestamp text    not null default (datetime('now')),
    player_id integer not null,
    blame_id  integer not null
);

create index if not exists dice_base_timestamp on dice (base, timestamp);

create table if not exists funcs (
    id      integer primary key autoincrement,
    name    text not null,
    payload text not null
);
