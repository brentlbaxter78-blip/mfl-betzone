// api/update-odds.js
// Vercel serverless function â runs every 5 min via cron
//
// Does two things:
//  1. Updates odds in Supabase on a game-time-aligned schedule
//  2. Auto-settles finished games (no admin action needed)
//
// Odds update schedule per game:
//   12h before â morning baseline (display only, betting locked)
//    5h before â betting opens
//  4h 3h 2h 1h â hourly during window
//   30min before â pre-close update
//   10min before â final update (~7 min before betting closes at -3 min)

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

const UPDATE_OFFSETS_MINUTES = [-12*60, -5*60, -4*60, -3*60, -2*60, -1*60, -30, -10];
const ACCEPT_WINDOW_MS = 6 * 60 * 1000;

// WC name normalization (mirrors client)
const WC_NAME_MAP = {
  "United States":"USA","Korea Republic":"South Korea","CÃ´te d'Ivoire":"Ivory Coast",
  "DR Congo":"Congo","Czech Republic":"Czechia","Bosnia and Herzegovina":"Bosnia",
  "Trinidad and Tobago":"Trinidad","United Arab Emirates":"UAE","China PR":"China",
  "IR Iran":"Iran","Republic of Ireland":"Ireland","Central African Republic":"CAR",
};
const normName = n => WC_NAME_MAP[n] || n;

// ââ Supabase helpers ââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
const sbHeaders = {
  apikey: SUPA_KEY,
  Authorization: `Bearer ${SUPA_KEY}`,
  "Content-Type": "application/json",
  Prefer: "return=minimal",
};

async function sbGet(path) {
  const r = await fetch(`${SUPA_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` }
  });
  return r.ok ? r.json() : null;
}
async function sbPatch(path, body) {
  await fetch(`${SUPA_URL}/rest/v1/${path}`, {
    method: "PATCH", headers: sbHeaders, body: JSON.stringify(body)
  });
}

// ââ Odds schedule helpers ââââââââââââââââââââââââââââââââââââââââââââââââââ
function targetTimes(gameTimeMs) {
  return UPDATE_OFFSETS_MINUTES.map(m => gameTimeMs + m * 60000);
}
function shouldUpdate(gameTimes) {
  const now = Date.now();
  return gameTimes.some(gt => targetTimes(gt).some(t => now >= t && now < t + ACCEPT_WINDOW_MS));
}
function nextUpdateLabel(gameTimes) {
  const now = Date.now();
  const next = gameTimes.flatMap(gt => targetTimes(gt)).filter(t => t > now).sort()[0];
  if (!next) return "none today";
  return new Date(next).toLocaleTimeString("en-US", { timeZone:"America/New_York", hour:"2-digit", minute:"2-digit" }) + " ET";
}

async function fetchGameTimes(espnUrl) {
  try {
    const r = await fetch(espnUrl);
    if (!r.ok) return [];
    const d = await r.json();
    return (d.events || []).map(e => new Date(e.date).getTime());
  } catch { return []; }
}

async function storeOdds(sportId, data) {
  const r = await fetch(`${SUPA_URL}/rest/v1/odds_cache?id=eq.${sportId}`, {
    method: "PATCH", headers: sbHeaders,
    body: JSON.stringify({ data, updated_at: new Date().toISOString() }),
  });
  return r.ok;
}

// ââ Auto-settlement ââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
// Fetch completed game results from ESPN
async function fetchFinalResults(sport) {
  const { espnUrl } = SPORTS[sport];
  try {
    const r = await fetch(espnUrl);
    if (!r.ok) return {};
    const d = await r.json();
    const results = {};
    for (const e of (d.events || [])) {
      if (e.status?.type?.state !== "post") continue;
      const cs = e.competitions?.[0]?.competitors || [];
      const h = cs.find(c => c.homeAway === "home");
      const a = cs.find(c => c.homeAway === "away");
      if (!h || !a) continue;
      const hn = sport === "soccer" ? normName(h.team?.displayName || "") : (h.team?.displayName || "");
      const an = sport === "soccer" ? normName(a.team?.displayName || "") : (a.team?.displayName || "");
      results[e.id] = {
        t1: hn, t2: an,
        home: parseInt(h.score || 0, 10),
        away: parseInt(a.score || 0, 10),
        scoreStr: `${hn} ${h.score || 0} - ${a.score || 0} ${an}`,
      };
    }
    return results;
  } catch { return {}; }
}

// Determine if a bet won or lost given the final game result
function determineOutcome(fighter, result) {
  const { t1, t2, home, away } = result;
  if (fighter === "Draw") return home === away ? "won" : "lost";
  // Exact match first
  if (fighter === t1) return home > away ? "won" : home < away ? "lost" : null;
  if (fighter === t2) return away > home ? "won" : away < home ? "lost" : null;
  // Fuzzy: last word of team name (e.g. "Red Sox" vs "Boston Red Sox")
  const lastWord = s => s.split(" ").slice(-1)[0];
  if (lastWord(t1) === lastWord(fighter)) return home > away ? "won" : home < away ? "lost" : null;
  if (lastWord(t2) === lastWord(fighter)) return away > home ? "won" : away < home ? "lost" : null;
  return null; // can't determine â skip
}

async function autoSettle() {
  // Get pending bets
  const pending = await sbGet("bets?status=eq.pending&select=*");
  if (!pending?.length) return { settled: 0 };

  // Get all users
  const users = await sbGet("users?select=id,balance,username");
  if (!users) return { settled: 0 };
  const house = users.find(u => u.username === "__house__");

  // Get final results from both sports
  const [wcRes, mlbRes] = await Promise.all([
    fetchFinalResults("soccer"),
    fetchFinalResults("mlb"),
  ]);
  const allResults = { ...wcRes, ...mlbRes };

  // Track balance deltas to batch updates per user
  const balanceDeltas = {}; // userId â delta amount
  let houseBalanceDelta = 0;
  let settled = 0;

  for (const bet of pending) {
    const leg = bet.legs?.[0];
    if (!leg?.fightId) continue;

    const result = allResults[leg.fightId];
    if (!result) continue; // game not finished yet

    const outcome = determineOutcome(leg.fighter, result);
    if (!outcome) continue; // can't determine â skip rather than guess

    const updatedLegs = (bet.legs || []).map(l => ({ ...l, result: result.scoreStr }));
    await sbPatch(`bets?id=eq.${bet.id}`, { status: outcome, legs: updatedLegs });

    if (outcome === "won") {
      const payout = +(bet.stake + bet.potential_win).toFixed(2);
      balanceDeltas[bet.user_id] = +((balanceDeltas[bet.user_id] || 0) + payout).toFixed(2);
      houseBalanceDelta = +(houseBalanceDelta - payout).toFixed(2);
    }
    // "lost": house already has the stake from bet placement â no change needed
    settled++;
  }

  // Apply balance updates (fetch fresh balance for each user to avoid stale-state overwrite)
  for (const [userId, delta] of Object.entries(balanceDeltas)) {
    if (delta === 0) continue;
    const fresh = await sbGet(`users?id=eq.${userId}&select=id,balance`);
    const u = fresh?.[0];
    if (u) await sbPatch(`users?id=eq.${u.id}`, { balance: +(u.balance + delta).toFixed(2) });
  }

  if (house && houseBalanceDelta !== 0) {
    const freshHouse = await sbGet(`users?id=eq.${house.id}&select=id,balance`);
    const h = freshHouse?.[0];
    if (h) await sbPatch(`users?id=eq.${h.id}`, { balance: +(h.balance + houseBalanceDelta).toFixed(2) });
  }

  return { settled };
}

// ââ Main handler âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
export default async function handler(req, res) {
  if (CRON_SECRET && req.headers.authorization !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (!ODDS_KEY) return res.status(500).json({ error: "VITE_ODDS_API_KEY not set" });

  const timestamp = new Date().toISOString();
  const results = {};

  // 1. Auto-settle any finished games
  const settle = await autoSettle();
  results._settle = settle.settled > 0 ? `â settled ${settle.settled} bet(s)` : "no bets to settle";

  // 2. Update odds on schedule
  for (const [sportId, cfg] of Object.entries(SPORTS)) {
    const gameTimes = await fetchGameTimes(cfg.espnUrl);
    if (!gameTimes.length) { results[sportId] = "skip â do games today"; continue; }
    if (!shouldUpdate(gameTimes)) { results[sportId] = `skip â next at ${nextUpdateLabel(gameTimes)}`; continue; }

    try {
      const r = await fetch(
        `https://api.the-odds-api.com/v4/sports/${cfg.oddsKey}/odds/?apiKey=${ODDS_KEY}&regions=us&markets=h2h&oddsFormat=american`
      );
      if (!r.ok) { results[sportId] = `odds-api ${r.status}`; continue; }
      const data = await r.json();
      if (!Array.isArray(data)) { results[sportId] = "bad response"; continue; }
      const stored = await storeOdds(sportId, data);
      results[sportId] = stored ? `â ${data.length} game(s)` : "supabase write failed";
    } catch (e) {
      results[sportId] = `error: ${e.message}`;
    }
  }

  return res.json({ ok: true, timestamp, results });
}
