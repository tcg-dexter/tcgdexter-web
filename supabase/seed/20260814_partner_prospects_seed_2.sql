-- Second incremental seed for public.partner_prospects — grows the roster
-- from the initial 31 (20260814_partner_prospects_seed.sql) toward a ~50+
-- healthy starting place, per an explicit follow-up research pass.
--
-- Same method and same honesty constraints as the first seed: WebSearch
-- only (this environment's egress proxy still blocks direct fetches to
-- social/creator-directory domains), every reach figure and URL sourced
-- from a WebSearch result snippet, source_url records exactly which one,
-- links_verified is false on every row without exception.
--
-- This pass explicitly ran dry on two angles rather than padding to hit a
-- round number: TikTok-specific creator searches surfaced no attributable
-- names (only generic hashtag/discover pages), and Spanish/German/French
-- competitive-scene searches surfaced only uncorroborated one-off videos.
-- Several names found in this pass were deliberately dropped rather than
-- reported: RealBreakingNate/TwicebakedJake (collecting/market-focused,
-- not deck-building — poor fit despite large reach), several
-- Feedspot-only names with no independent corroboration, and
-- Wolfe Glick/WolfeyVGC (Pokémon VGC — video game, not TCG, wrong game
-- entirely).
--
-- Three site rows here (Simbozz.gg, 20cards.com, Pokémon Meta) are
-- primarily Pokémon TCG Pocket (the mobile spin-off) tools/trackers, not
-- the paper TCG Dexter profiles — flagged low priority with an explicit
-- note despite real audience overlap, since Pocket has no Standard/
-- Expanded rotation-legality concept for our core feature to hook into.
--
-- Apply via Supabase MCP `execute_sql` (or psql) after the first seed.
-- Safe to re-run: `unique (name)` + `on conflict do nothing`.

begin;

insert into public.partner_prospects
  (name, handle, kind, tier, priority, note, reach_note, source_url,
   youtube_url, twitch_url, tiktok_url, x_url, instagram_url, website_url)
values

-- Creators — deck-tech / competitive-play channels, plus the roster's
-- first non-English (Japanese) competitive find.
('ZapdosTCG', 'ZapdosTCG', 'creator', 'mid', 'high',
 'Pro player since 2011; deck analyses and unboxings for the competitive scene — strong fit, similar profile to Tricky Gym.',
 '~133K YT subs (noxinfluencer.com estimate, undated; own video cited crossing 100K)',
 'https://www.noxinfluencer.com/youtube/channel/UCYCzQRsPJ_eUEXXmU_CSx2g',
 'https://www.youtube.com/channel/UCYCzQRsPJ_eUEXXmU_CSx2g', null, null, null, null, null),

('SmartTCG', 'smarttcg', 'creator', 'micro', 'medium',
 'Run by a top-ranked NA competitive player; deck/meta content. Good topical fit but only single-sourced (Feedspot aggregator) — subscriber count unconfirmed, treat reach as unknown.',
 'not reported',
 'https://videos.feedspot.com/pokemon_tcg_youtube_channels/',
 'https://www.youtube.com/c/smarttcg', null, null, null, null, null),

('The Pokémon Evolutionaries', 'PkmnEvolutionaries', 'creator', 'micro', 'high',
 'Long-running channel (since 2014) with a recurring "Deck Tech Thursday" series — exactly the competitive deck-profile format a legality/price tool''s audience watches. Well corroborated (own channel, dedicated playlist).',
 'not reported',
 'https://videos.feedspot.com/pokemon_tcg_youtube_channels/',
 'https://www.youtube.com/channel/UCgD--vlzKcTINeWeTyQczyA', null, null, null, null, null),

('Mitch (TCG GB)', 'Mitch', 'creator', 'micro', 'medium',
 'Australian competitive creator doing deck profiles since 2017; has a Bulbapedia entry corroborating the name. Reach source is a 2022 list with no 2026 confirmation of current activity — verify the channel is still active before reaching out.',
 '~23K YT subs (WIN.gg, 2022 — dated)',
 'https://win.gg/news/these-are-the-pokemon-tcg-youtubers-to-watch-in-2022/',
 null, null, null, null, null, null),

('DarkIntegralGaming', 'DarkIntegralGaming', 'creator', 'micro', 'medium',
 'Run by "Donald" — deck videos/shorts, but leans fun/off-meta rogue-deck builds rather than strict tournament-meta optimization. Moderate fit.',
 'not reported',
 'https://www.pokebeach.com/forums/threads/do-you-subscribe-to-any-tcg-youtube-channels.137614/',
 'https://www.youtube.com/channel/UC18Y2Z7TqLHFvg4Fk3UkbRg', null, null, null, null, null),

('Ptcgradio', 'ptcgradio', 'creator', 'mid', 'low',
 'Primarily rip-and-ship/pack-opening streams with occasional quick deck tips mixed in — collecting-first audience, weak fit for a deck-legality tool despite decent reach.',
 '163K (platform/recency unclear from source — treat as directional only)',
 'https://cardchill.com/article/most-popular-youtube-and-twitch-rip-ship-streamers-for-pokemon-tcg-in-2025',
 null, 'https://www.twitch.tv/ptcgradio', null, null, null, null),

('サーニーゴ (Daichi Shimada)', 'Sanigo', 'creator', 'mid', 'high',
 '2022 World Championship TCG runner-up and multiple Champions League title holder; commentary and tournament-vlog content. Best-attested non-English find — opens the Japanese competitive scene, well corroborated across multiple JP sources.',
 'not reported numerically; well-ranked per yutura.net',
 'https://yutura.net/channel/73036/',
 'https://www.youtube.com/channel/UC9KZl6gVF9Kyteo6h0Q73vg', null, null, null, null, null),

('Team Rainbow Wing', 'rainbowwingtcg', 'site', 'micro', 'medium',
 'Malaysia-based competitive TCG team blog with named contributing writers (a 2019 Worlds qualifier/head judge and multiple Oceania/Worlds competitors) — good fit for underserved SE Asia/Oceania competitive coverage. Current posting activity is unverified; bios cite older results.',
 'not reported',
 'https://therainbowwing.wordpress.com/',
 null, null, null, null, null, 'https://therainbowwing.wordpress.com/'),

-- Podcasts — competitive meta/news/tournament-breakdown shows.
('Uncommon Energy', 'uncommonenergypod', 'podcast', 'mid', 'high',
 'Co-hosted by AzulGG (already tracked separately as a creator) and Chip Richey, an official TCG livestream commentator and former Worlds competitor. Core competitive meta/news show — distinct entity from the AzulGG creator row, not a duplicate.',
 'not reported',
 'https://podcasts.apple.com/us/podcast/uncommon-energy-a-pok%C3%A9mon-tcg-podcast/id1614098696',
 'https://www.youtube.com/c/UncommonEnergyPodcast', null, null, null, null, null),

('PCS – A Pokémon TCG Podcast', 'thepcspodcast', 'podcast', 'mid', 'high',
 'Hosts Drew and Justin break down tournament decks and upcoming cards; active Discord/Patreon community. Strong competitive/meta fit.',
 'not reported',
 'https://creators.spotify.com/pod/profile/pcspod/',
 'https://www.youtube.com/@thepcspodcast', 'https://www.twitch.tv/pcspodcast', null, null, null, null),

('Special Conditions', 'specialconditionspod', 'podcast', 'mid', 'medium',
 'Hosts Adam Tuttle and Justin Keller cover deck strategy, set breakdowns, tournament talk and market trends — mixes competitive and collecting content.',
 'not reported',
 'https://podcasts.apple.com/us/podcast/special-conditions-a-pok%C3%A9mon-tcg-podcast/id1471582087',
 null, null, null, null, null, 'https://podcasts.apple.com/us/podcast/special-conditions-a-pok%C3%A9mon-tcg-podcast/id1471582087'),

('Tag Team Pokemon TCG Podcast', 'tagteampodcast', 'podcast', 'mid', 'high',
 'The longest continually-running PTCG podcast (281+ episodes), produced by three regional champions including JW Kriewall (already tracked separately as a creator — this is the distinct podcast entity).',
 'not reported',
 'https://podcasts.apple.com/us/podcast/tag-team-pokemon-tcg-podcast/id1483009735',
 null, null, null, null, null, 'https://podcasts.apple.com/us/podcast/tag-team-pokemon-tcg-podcast/id1483009735'),

('Battle Frontier – A Pokemon TCG Podcast', 'battlefrontierpod', 'podcast', 'micro', 'medium',
 'Hosts Aaron Curry and John Paul Orgel cover tournament results, deck/card reasoning and championship-point standings. Good fit; newer/smaller show (~31 episodes at time of research).',
 'not reported',
 'https://creators.spotify.com/pod/profile/aaron-curry6/episodes/Episode-31-SIZING-UP-OUR-RIVALS-e32skrk',
 null, null, null, null, null, 'https://creators.spotify.com/pod/profile/aaron-curry6/'),

-- Sites — deck-database / meta-tracker / pricing tools. Several here are
-- functionally closest to Dexter itself (deck legality, meta tracking,
-- pricing) — worth an integration/comparison conversation, not just a
-- shoutout.
('pkmn.gg', 'pkmngg', 'site', 'mid', 'high',
 'Collection tracker + deck builder with automatic legality validation (Standard/Expanded/GLC/Unlimited) and TCGplayer-sourced pricing — the closest functional overlap with Dexter found in this pass. Worth an integration/comparison conversation.',
 'not reported',
 'https://www.pkmn.gg/',
 null, null, null, null, null, 'https://www.pkmn.gg/'),

('MetaDex', 'metadex', 'site', 'mid', 'high',
 'Competitive PTCG meta tracker sourced from Limitless tournament data (Regionals/Internationals/Champions League) — tier lists, deck building and match logging. Very strong overlap with Dexter''s meta-analysis feature.',
 'not reported',
 'https://www.meta-dex.com/',
 null, null, null, null, null, 'https://www.meta-dex.com/'),

('PTCG Legends', 'ptcglegends', 'site', 'mid', 'medium',
 'Database of modern and retro event results, decklists and stats — good fit for a competitive-history angle.',
 'not reported',
 'https://www.ptcglegends.com/',
 null, null, null, null, null, 'https://www.ptcglegends.com/'),

('JustInBasil''s Pokémon TCG Resources', 'justinbasil', 'site', 'mid', 'high',
 'Long-standing competitive resource site — "What to Play" Standard meta guides, budget decklists, deck-building fundamentals, alternate-format coverage. Well established in the competitive community.',
 'not reported',
 'https://www.justinbasil.com/about',
 null, null, null, null, null, 'https://www.justinbasil.com/'),

('PokemonCard.io', 'pokemoncardio', 'site', 'mid', 'high',
 'Deck builder, price checker (multi-source comps, paywalled historical pricing tier), card database and community-submitted decks — direct feature overlap with Dexter''s deck-building + pricing.',
 'not reported',
 'https://pokemoncard.io/',
 null, null, null, null, null, 'https://pokemoncard.io/'),

('Pokepedia', 'pokepedia', 'site', 'micro', 'low',
 'Card database with a decklist builder and event info. Only lightly corroborated (single search cluster, no independent reach data) and more general-database than competitive-meta-focused.',
 'not reported',
 'https://www.pokepedia.net/',
 null, null, null, null, null, 'https://www.pokepedia.net/'),

('Simbozz.gg', 'simbozz', 'site', 'micro', 'low',
 'Daily deck guides, tier lists and tournament-data-driven scoring — but primarily Pokémon TCG Pocket (the mobile spin-off), not the paper TCG. Real audience overlap, but Pocket has no Standard/Expanded rotation-legality concept for Dexter''s core feature to hook into.',
 'not reported',
 'https://simbozz.gg/methodology',
 null, null, null, null, null, 'https://simbozz.gg/'),

('20cards.com', '20cards', 'site', 'micro', 'low',
 'AI-assisted deck builder + meta tracker (263 archetypes / 37K+ tournament lists tracked) — exclusively Pokémon TCG Pocket. Same fit caveat as Simbozz.gg.',
 'not reported',
 'https://20cards.com/',
 null, null, null, null, null, 'https://20cards.com/'),

('Pokémon Meta', 'pokemonmeta', 'site', 'micro', 'low',
 'News, decks and tournaments site — also Pokémon TCG Pocket-focused per its own top-decks/tier-list pages. Same fit caveat as Simbozz.gg and 20cards.com.',
 'not reported',
 'https://www.pokemonmeta.com/top-decks',
 null, null, null, null, null, 'https://www.pokemonmeta.com/'),

-- Newsletter
('The Johto Times', 'johtotimes', 'newsletter', 'micro', 'low',
 'General Pokémon news/culture newsletter that touches TCG and Worlds coverage, but isn''t competitive-TCG-specific (sample post found was a reader poll on favourite Pokémon). Weakest fit in this pass — included for honesty rather than omitted, since it is a genuinely new, distinct, real newsletter.',
 'not reported',
 'https://johto.substack.com/p/vol3-33',
 null, null, null, null, null, 'https://johto.substack.com/')

on conflict (name) do nothing;

commit;
