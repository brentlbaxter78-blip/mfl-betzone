// api/update-odds.js
// Vercel serverless function — runs every 5 min via cron
//
// Update schedule per game (1 API call covers ALL games for that sport):
//   12h before  → morning baseline (display only, betting still locked)
//    5h before  → betting opens, first live odds
//  4h, 3h, 2h, 1h before → hourly during betting window
//   30min before → pre-close update
//   10min before → final update (~7 min before betting closes at game-3min)
//
// Total: 8 targets × 2 sports = ~16-20 API calls/day depending on overlap

const SUPA_URL    = process.env.SUPA_URL;
const SUPA_KEY    = process.env.SUPA_KEY;
const ODDS_KEY    = process.env.VITE_ODDS_API_KEY;
const CRON_SECRET = process.env.CRON_SECRET;

const SPORTS = {
  soccer: {
    oddsKey: "soccer_fifa_world_cup",
    espnUrl: "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard",
  },
  mlb: {
    oddsKey: "baseball_mlb",
    espnUrl: "https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard",
  },
};

// Minutes offset from game start for each update target
// Negative = before game, all relative to game_start_ms
const UPDATE_OFFSETS_MINUTES = [
  -12 * 60,  // baseline: 12h before (morning display, betting locked)
  -5 * 60,   // 5h before: betting opens
  -4 * 60,   // 4h before
  -3 * 60,   // 3h before
  -2 * 60,   // 2h before
  -1 * 60,   // 1h before
  -30,       // 30 min before
  -10,       // 10 min before (final, ~7 min before betting closes at -3 min)
];

const ACCEPT_WINDOW_MS = 6 * 60 * 1000; // 6-minute window — cron fires within this to count

// Return all target timestamps for a game
function targetTimes(gameTimeMs) {
  return UPDATE_OFFSETS_MINUTES.map(m => gameTimeMs + m * 60000);
}

// Is NOW within the acceptance window of any target time for any game today?
function shouldUpdate(gameTimes) {
  const now = Date.now();
  for (const gt of gameTimes) {
    for (const t of targetTimes(gt)) {
      if (now >= t && now < t + ACCEPT_WINDOW_MS) return true;
    }
  }
  return false;
}

// Next scheduled update time across all games (for logging)
function nextUpdateTime(gameTimes) {
  const now = Date.now();
  const future = gameTimes
    .flatMap(gt => targetTimes(gt))
    .filter(t => t > now)
    .sort((a, b) => a - b);
  if (!future.length) return "none today";
  return new Date(future[0]).toLocaleTimeString("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
  }) + " ET";
}

// Fetch game times from ESPN (free, no key)
async function fetchGameTimes(espnUrl) {
  try {
    const r = await fetch(espnUrl);
    if (!r.ok) return [];
    const d = await r.json();
    return (d.events || []).map(e => new Date(e.date).getTime());
  } catch {
    return [];
  }
}

// Write to Supabase odds_cache table
async function storeOdds(sportId, data) {
  const r = await fetch(`${SUPA_URL}/rest/v1/odds_cache?id=eq.${sportId}`, {
    method: "PATCH",
    headers: {
      apikey: SUPA_KEY,
      Authorization: `Bearer ${SUPA_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({ data, updated_at: new Date().toISOString() }),
  });
  return r.ok;
}

export default async function handler(req, res) {
  if (CRON_SECRET && req.headers.authorization !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (!ODDS_KEY) return res.status(500).json({ error: "VITE_ODDS_API_KEY not set" });

  const results = {};
  const now = new Date().toISOString();

  for (const [sportId, cfg] of Object.entries(SPORTS)) {
    const gameTimes = await fetchGameTimes(cfg.espnUrl);

    if (!gameTimes.length) {
      results[sportId] = "skip — no games today";
      continue;
    }

    if (!shouldUpdate(gameTimes)) {
      results[sportId] = `skip — next update at ${nextUpdateTime(gameTimes)}`;
      continue;
    }

    try {
      const r = await fetch(
        `https://api.the-odds-api.com/v4/sports/${cfg.oddsKey}/odds/?apiKey=${ODDS_KEY}&regions=us&markets=h2h&oddsFormat=american`
      );
      if (!r.ok) { results[sportId] = `odds-api ${r.status}`; continue; }

      const data = await r.json();
      if (!Array.isArray(data)) { results[sportId] = "bad response"; continue; }

      const stored = await storeOdds(sportId, data);
      results[sportId] = stored ? `✓ ${data.length} game(s) updated` : "supabase write failed";
    } catch (e) {
      results[sportId] = `error: ${e.message}`;
    }
  }

  return res.json({ ok: true, timestamp: now, results });
}
