DO
$$
    DECLARE
        josh_id              int          := 1;
        jorge_id             int          := 2;
        mike_id              int          := 3;
        noah_id              int          := 4;
        tanner_id            int          := 5;
        campaign_name        varchar(256) := 'Kagalee High';
        campaign_is_one_shot boolean      := true;
        josh_name            varchar(256) := 'Peat Pennyweather';
        josh_class           varchar(64)  := 'animist';
        josh_is_dm           boolean      := false;
        jorge_name           varchar(256) := 'Wren Wormstrome';
        jorge_class          varchar(64)  := 'fighter';
        jorge_is_dm          boolean      := false;
        mike_name            varchar(256) := 'Chuck Knuckleson';
        mike_class           varchar(64)  := 'fighter';
        mike_is_dm           boolean      := false;
        noah_name            varchar(256) := 'The Great and Powerful Noah';
        noah_class           varchar(64)  := 'gm';
        noah_is_dm           boolean      := true;
        tanner_name          varchar(256) := 'Billy Pebbles';
        tanner_class         varchar(64)  := 'bard';
        tanner_is_dm         boolean      := false;
        new_campaign_id      int;
        josh_char_id         int;
        jorge_char_id        int;
        mike_char_id         int;
        noah_char_id         int;
        tanner_char_id       int;
    BEGIN
        insert into campaigns
            (name, edition, is_one_shot)
        values (campaign_name, 'pathfinder_2e', campaign_is_one_shot)
        returning id into new_campaign_id;

        UPDATE active_campaign
        SET campaign_id = new_campaign_id
        WHERE id = 1;

        insert into characters
            (name, class, is_dm, player_id, campaign_id)
        values (josh_name, josh_class, josh_is_dm, josh_id, new_campaign_id)
        returning id into josh_char_id;

        insert into characters
            (name, class, is_dm, player_id, campaign_id)
        values (jorge_name, jorge_class, jorge_is_dm, jorge_id, new_campaign_id)
        returning id into jorge_char_id;

        insert into characters
            (name, class, is_dm, player_id, campaign_id)
        values (mike_name, mike_class, mike_is_dm, mike_id, new_campaign_id)
        returning id into mike_char_id;

        insert into characters
            (name, class, is_dm, player_id, campaign_id)
        values (noah_name, noah_class, noah_is_dm, noah_id, new_campaign_id)
        returning id into noah_char_id;

        insert into characters
            (name, class, is_dm, player_id, campaign_id)
        values (tanner_name, tanner_class, tanner_is_dm, tanner_id, new_campaign_id)
        returning id into tanner_char_id;

        insert into active_characters
            (player_id, campaign_id, character_id)
        values (josh_id, new_campaign_id, josh_char_id),
               (jorge_id, new_campaign_id, jorge_char_id),
               (mike_id, new_campaign_id, mike_char_id),
               (noah_id, new_campaign_id, noah_char_id),
               (tanner_id, new_campaign_id, tanner_char_id);
    END
$$;
