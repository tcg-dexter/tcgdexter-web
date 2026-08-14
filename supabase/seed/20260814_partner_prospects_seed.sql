-- Seed data for public.partner_prospects (see the migration for schema +
-- rationale). Committed to git rather than entered only in prod so the
-- roster is reviewable and this file is safely re-runnable.
--
-- Research method: WebSearch only — this environment's egress proxy blocks
-- WebFetch for every creator-directory / social-profile domain tried
-- (youtube.com, collabstr.com, izea.com, feedspot, socialveins, tiktok,
-- instagram), so no page was scraped directly. Every reach_note figure and
-- every URL below came from a WebSearch result snippet, and each row's
-- source_url records exactly which one. Figures are third-party-reported,
-- of unknown recency, and should be read as directional, not authoritative.
-- No email address is stored anywhere — outreach here is DM/social.
--
-- links_verified is false on every seeded row without exception: no page
-- was opened to confirm a handle still resolves. Treat that as a checklist,
-- not a formality — confirm before DMing.
--
-- Apply via Supabase MCP `execute_sql` (or psql) after the migration lands.
-- Safe to re-run: `unique (name)` + `on conflict do nothing`.

begin;

insert into public.partner_prospects
  (name, handle, kind, tier, priority, note, reach_note, source_url,
   youtube_url, twitch_url, tiktok_url, x_url, instagram_url, website_url)
values

-- Macro creators — big pack-opening/collecting channels. Reach is
-- enormous but the audience isn't deck-building-focused, and reply odds
-- at this scale are low; kept at low/medium priority accordingly.
('MandJTV', 'MandJTV', 'creator', 'macro', 'low',
 'Massive pack-opening/collecting channel; broad Pokémon audience rather than competitive deck-focused, so weak product fit despite huge reach.',
 '~2.2-2.7M YT subs (3rd-party lists, figures vary by source, undated)',
 'https://videos.feedspot.com/pokemon_youtube_channels/',
 null, null, null, null, null, null),

('PokeRev', 'PokeRev', 'creator', 'macro', 'low',
 'Opening-focused megachannel (opened 400+ 151 packs pre-release); runs own card shop (PokeCave). Reach without deck-tool audience overlap.',
 '~2.3-2.53M YT subs (3rd-party lists, undated)',
 'https://kotaku.com/pokemon-tcg-151-youtube-pokerev-unlistedleaf-pokichloe-1850924313',
 null, null, null, null, null, null),

('UnlistedLeaf', 'UnlistedLeaf', 'creator', 'macro', 'low',
 'Largest Pokémon card channel, from Australia; openings-first format, not deck-building. Low reply odds at this scale.',
 '~2.3-2.46M YT subs (3rd-party lists, undated)',
 'https://videos.feedspot.com/pokemon_youtube_channels/',
 null, null, null, null, null, null),

('Leonhart', 'Leonhart', 'creator', 'macro', 'low',
 'Card-opening/unboxing channel spanning vintage to new releases; broad collector audience, not deck-focused.',
 '~1.46-1.65M YT subs (3rd-party lists, undated)',
 'https://videos.feedspot.com/pokemon_youtube_channels/',
 null, null, null, null, null, null),

('Maxmoefoe', 'MaxmoefoePokemon', 'creator', 'macro', 'low',
 'Pack-opening/challenge-video channel; entertainment-first, not a natural fit for a deck-analysis tool.',
 '~1.65M YT subs (3rd-party list, undated)',
 'https://videos.feedspot.com/pokemon_youtube_channels/',
 null, null, null, null, null, null),

('Deep Pocket Monster', 'Deep Pocket Monster', 'creator', 'macro', 'low',
 'In-depth personal-collection vlogs; collecting-focused, not competitive/deck-building.',
 '~853K-1.49M YT subs (3rd-party lists, undated)',
 'https://izea.com/resources/popular-pokemon-influencers-on-social-media/',
 null, null, null, null, null, null),

('Alex Ketchum', 'Alex Ketchum', 'creator', 'macro', 'low',
 'TikTok card-opening + PSA grading content; large audience but pure collecting/grading focus.',
 '~652.6K TikTok followers (3rd-party list, undated)',
 'https://socialveins.com/influencers/lists/pokemon-influencers-instagram',
 null, null, null, null, null, null),

-- Mid creators — deck-profile, tournament-report and competitive-scene
-- channels. The strongest fit tier for a deck-legality/price tool.
('Tricky Gym', 'TrickyGym', 'creator', 'mid', 'high',
 'Run by Andrew Mahone; weekly tournaments, deck profiles and PTCGO gameplay for the competitive scene — direct audience overlap with a deck-legality/price tool.',
 '~85K-134K YT subs (3rd-party sources disagree; seen Jul 2026)',
 'https://www.youtube.com/@TrickyGym/streams',
 'https://www.youtube.com/@TrickyGym', null, null, null, null, null),

('AzulGG', 'AzulGG', 'creator', 'mid', 'high',
 '5x Regional Champion, 2022 NAIC Champion, 2023 OCIC Champion; in-depth top-deck analysis content. High-credibility competitive voice.',
 '~91.5K YT subs (3rd-party source, undated)',
 'https://www.twitch.tv/azulgg',
 null, 'https://www.twitch.tv/azulgg', null, null, null, null),

('JW Kriewall', 'JW Kriewall', 'creator', 'mid', 'high',
 '3x Regional Champion (Fort Wayne ''13, Richmond ''19, Toronto ''23); YouTuber and Twitch streamer active in the competitive community.',
 'not reported',
 'https://outofthe925.com/pokemon-youtubers/',
 null, null, null, null, null, null),

('OmniPoke', 'OmniPoke', 'creator', 'mid', 'high',
 'Two UK competitive players covering deck analysis, set reviews, tier lists and tournament prep — exactly the audience a deck-legality tool wants.',
 'not reported',
 'https://x.com/omnipoke',
 'https://www.youtube.com/channel/UC9k2vZA_jd83-4gMzRupYrQ', null, null, 'https://x.com/omnipoke', null, null),

('PokiChloe', 'PokiChloe', 'creator', 'mid', 'medium',
 'UK creator, co-runs Collector''s Cardhouse; traditional pack-opening format rather than deck content, but well-connected in the UK scene.',
 'not reported (Kotaku top-9 feature)',
 'https://kotaku.com/pokemon-tcg-151-youtube-pokerev-unlistedleaf-pokichloe-1850924313',
 null, null, null, null, null, null),

('Katie TCG', 'katie.tcg', 'creator', 'mid', 'low',
 'Daily TikTok content and card pulls; collecting-focused, not deck-building.',
 '~197K TikTok followers (3rd-party list, undated)',
 'https://www.tiktok.com/@katie.tcg',
 null, null, 'https://www.tiktok.com/@katie.tcg', null, null, null),

('hollypaintscards', 'hollypaintscards', 'creator', 'mid', 'low',
 'Custom Pokémon card artist; large, engaged audience but not TCG-competitive/deck-building — a brand-awareness play at best.',
 '~117.7K followers (3rd-party list, undated)',
 'https://socialveins.com/influencers/lists/pokemon-influencers-instagram',
 null, null, null, null, null, null),

-- Micro / emerging creators — smaller, but the best reply rates and often
-- the tightest topical fit.
('PokéStats', 'pokestatstcg', 'creator', 'micro', 'high',
 'Competitive PTCG stats/updates account run by a small contributor team — audience is exactly competitive players who''d use a deck tool.',
 '~35K X followers (as of research)',
 'https://x.com/pokestatstcg',
 null, null, null, 'https://x.com/pokestatstcg', null, null),

('@pokechamp__', 'pokechamp__', 'creator', 'micro', 'low',
 'TCG collector & connoisseur; pull/showcase content, not deck-building.',
 '~34.2-34.6K IG followers (3rd-party list, undated)',
 'https://izea.com/resources/popular-pokemon-influencers-on-social-media/',
 null, null, null, null, null, null),

('@golden_gibbon_', 'golden_gibbon_', 'creator', 'micro', 'low',
 'Broad pop-culture/gaming/tech account that touches Pokémon; audience isn''t TCG-specific.',
 '~33.8K IG followers (3rd-party list, undated)',
 'https://socialveins.com/influencers/lists/pokemon-influencers-instagram',
 null, null, null, null, null, null),

('@pinky.pogo', 'pinky.pogo', 'creator', 'micro', 'low',
 'Shiny-Pokémon collector content since 2019; collecting-focused.',
 '~24.2K IG followers (3rd-party list, undated)',
 'https://socialveins.com/influencers/lists/pokemon-influencers-instagram',
 null, null, null, null, null, null),

('ThePeachTCG', 'ThePeachTCG', 'creator', 'micro', 'medium',
 'Owns a Singapore TCG store; shop-owner audience likely to appreciate a price/legality tool for customers.',
 '~12.2K TikTok followers (3rd-party list, undated)',
 'https://www.tiktok.com/discover/peach-tcg',
 null, null, null, null, null, null),

('Pokémon Collector Girl', 'pokemon.collector.girl', 'creator', 'micro', 'low',
 'UK-based collector — PSA holos, sealed boxes, pulls. Small but real; profile URL confirmed in search results.',
 '~3.7K IG followers (3rd-party list, undated)',
 'https://www.instagram.com/pokemon.collector.girl/',
 null, null, null, null, 'https://www.instagram.com/pokemon.collector.girl/', null),

('WILL (@collectwithwill)', 'collectwithwill', 'creator', 'micro', 'medium',
 'Pokémon content creator; profile URL confirmed in search results. General collecting content.',
 'not reported',
 'https://www.instagram.com/collectwithwill/',
 null, null, null, null, 'https://www.instagram.com/collectwithwill/', null),

('Discount Pokemon Decks', 'Discount Pokemon Decks', 'creator', 'micro', 'high',
 'Small emerging channel (~15 videos) building original budget decks with clearly explained card-choice reasoning — the exact "help me build/afford a deck" audience Dexter serves.',
 'small/emerging (video count only, no sub count reported)',
 'https://www.pokebeach.com/forums/threads/do-you-subscribe-to-any-tcg-youtube-channels.137614/',
 null, null, null, null, null, null),

('TripleBtcg', 'TripleBtcg', 'creator', 'micro', 'high',
 'Small channel focused on budget-friendly deck building, active since April 2022 — strong topical fit despite small reach.',
 '~4.6K YT subs (3rd-party search summary, undated)',
 'https://videos.feedspot.com/pokemon_tcg_youtube_channels/',
 null, null, null, null, null, null),

('Jay''s Corner TCG', 'Jay''s Corner TCG', 'creator', 'micro', 'medium',
 'Small channel active since June 2020, general TCG content.',
 '~7.3K YT subs (3rd-party search summary, undated)',
 'https://videos.feedspot.com/pokemon_tcg_youtube_channels/',
 null, null, null, null, null, null),

-- Sites / podcasts / newsletters — tools and media whose audience overlaps
-- Dexter's almost exactly. Several are plausible integration partners, not
-- just shoutout targets.
('Limitless TCG', 'limitlesstcg', 'site', 'mid', 'high',
 'The competitive scene''s tournament database + podcast (hosted by Connor Hayward). About as direct an audience overlap as exists for a deck-legality/price tool — worth exploring an integration, not just a shoutout.',
 'established competitive-community hub; no follower count reported',
 'https://limitlesstcg.com/',
 null, 'https://www.twitch.tv/limitless_tcg', null, null, null, 'https://limitlesstcg.com/'),

('Trainer Hill', 'Trainer Hill', 'site', 'mid', 'high',
 'Competitive PTCG analytics hub (meta trends, decklists, matchup stats) plus a podcast hub — same audience as Dexter, potential integration partner as well as an outreach lead.',
 'not reported',
 'https://www.trainerhill.com/',
 null, null, null, null, null, 'https://www.trainerhill.com/'),

('PokeBeach', 'PokeBeach', 'site', 'mid', 'medium',
 'Long-running (22 yrs) fan news site run by Jon Sahagian ("Water Pokémon Master"); huge broad reach but general Pokémon/TCG news rather than deck-building specifically.',
 '120.1K X followers, ~48K Facebook (as of research)',
 'https://x.com/pokebeach',
 null, null, null, 'https://x.com/pokebeach', null, 'https://www.pokebeach.com/'),

('PokeGuardian', 'PokeGuardian', 'site', 'mid', 'high',
 'Daily PTCG news, columns, podcasts and a card/set database — content style and audience map closely onto Dexter''s catalog + legality features.',
 'not reported',
 'https://www.pokeguardian.com/',
 null, null, null, 'https://x.com/pokeguardian', null, 'https://www.pokeguardian.com/'),

('Celio''s Network', 'Celio''s Network', 'newsletter', 'micro', 'high',
 'Substack newsletter on competitive PTCG strategy and improvement — readers are exactly the deck-building/legality audience.',
 'not reported',
 'https://celiosnetwork.substack.com/',
 null, null, null, null, null, 'https://celiosnetwork.substack.com/'),

('danharrtcg', 'danharrtcg', 'newsletter', 'micro', 'medium',
 'Weekly Substack — meta calls, deck reviews, market reviews and event reports; small but highly relevant readership.',
 'not reported',
 'https://danharrtcg.substack.com/p/introduction',
 null, null, null, null, null, 'https://danharrtcg.substack.com/'),

('The Mulligan (BooflingTCG)', 'booflingtcg', 'newsletter', 'micro', 'medium',
 'PTCG newsletter; small but on-topic readership.',
 'not reported',
 'https://booflingtcg.substack.com',
 null, null, null, null, null, 'https://booflingtcg.substack.com')

on conflict (name) do nothing;

commit;
