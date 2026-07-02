// api/update-odds.js
// Vercel serverless function — runs every 5 min via cron
//
// Does two things:
//  1. Updates odds in Supabase on a FIXED daily schedule (not game-relative)
//  2. Auto-settles finished games
//
// Fixed update times (ET): 8am, 10am, 12pm, 3pm, 5pm, 7pm, 9pm
// = 7 calls per sport × 2 sports = 14 API calls/day MAX — regardless of how many games
// Acceptance window = 4 min (< 5 min cron interval so each slot fires exactly once)

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

// Fixed daily update hours (ET) — keeps odds fresh during the day
// 8am removed: next-day odds now fetched automatically when last game ends
const UPDATE_HOURS_ET = [10, 12, 15, 17, 19, 21];
// 4 min window — must be less than cron interval (5 min) to prevent double-firing
const ACCEPT_WINDOW_MS = 4 * 60 * 1000;
// After last game ends: only re-fetch if odds haven't been updated in this window
const POST_GAME_DEBOUNCE_MS = 25 * 60 * 1000; // 25 min — allows one fetch, skips the next 4 runs

// WC name normalization (mirrors client)
const WC_NAME_MAP = {
  "United States":"USA","Korea Republic":"South Korea","Côte d'Ivoire":"Ivory Coast",
  "DR Congo":"Congo","Czech Republic":"Czechia","Bosnia and Herzegovina":"Bosnia",
  "Trinidad and Tobago":"Trinidad","United Arab Emirates":"UAE","China PR":"China",
  "IR Iran":"Iran","Republic of Ireland":"Ireland","Central African Republic":"CAR",
};
const normName = n => WC_NAME_MAP[n] || n;

// ── Supabase helpers ────────────────────────────────────────────────────────
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

// ── Fixed schedule helper ──────────────────────────────────────────────────
function shouldUpdateNow() {
  const now = new Date();
  // Get current ET hour and minute
  const etStr = now.toLocaleString("en-US", {
    timeZone: "America/New_York",
    hour: "numeric", minute: "numeric", hour12: false
  });
  const [etHour, etMin] = etStr.split(":").map(Number);
  const nowMinutes = etHour * 60 + etMin;
  return UPDATE_HOURS_ET.some(h => {
    const targetMinutes = h * 60;
    return nowMinutes >= targetMinutes && nowMinutes < targetMinutes + (ACCEPT_WINDOW_MS / 60000);
  });
}

function nextUpdateLabel() {
  const now = new Date();
  const etStr = now.toLocaleString("en-US", {
    timeZone: "America/New_York",
    hour: "numeric", minute: "numeric", hour12: false
  });
  const [etHour, etMin] = etStr.split(":").map(Number);
  const nowMinutes = etHour * 60 + etMin;
  const next = UPDATE_HOURS_ET.find(h => h * 60 > nowMinutes);
  if (!next) return "tomorrow at 8am ET";
  return `${next > 12 ? next - 12 : next}${next >= 12 ? "pm" : "am"} ET`;
}

async function hasGamesToday(espnUrl) {
  try {
    const r = await fetch(espnUrl);
    if (!r.ok) return false;
    const d = await r.json();
    return (d.events || []).length > 0;
  } catch { return false; }
}

// Returns true when all of today's games are finished — triggers next-day odds fetch
async function allGamesFinal(espnUrl) {
  try {
    const r = await fetch(espnUrl);
    if (!r.ok) return false;
    const d = await r.json();
    const events = d.events || [];
    if (!events.length) return false;
    return events.length > 0 && events.every(e => e.status?.type?.state === "post");
  } catch { return false; }
}

async function storeOdds(sportId, data) {
  const r = await fetch(`${SUPA_URL}/rest/v1/odds_cache?id=eq.${sportId}`, {
    method: "PATCH", headers: sbHeaders,
    body: JSON.stringify({ data, updated_at: new Date().toISOString() }),
  });
  return r.ok;
}

// ── Auto-settlement ────────────────────────────────────────────────────────
async function fetchFinalResults(sport) {
  const { espnUrl } = SPORTS[sport];
  try {
    const r = await fetch(espnUrl);
    if (!r.ok) return {};
    const d = await r.json();
    const results = {};
    for (const e of (d.events || [])) {
      const cs = e.competitions?.[0]?.competitors || [];
      const h = cs.find(c => c.homeAway === "home");
      const a = cs.find(c => c.homeAway === "away");
      if (!h || !a) continue;
      const state = e.status?.type?.state;

      if (sport === "soccer") {
        // Settle as soon as 90-min regulation (incl. stoppage time) is complete —
        // don't wait for extra time / penalties to finish in knockout games.
        // ESPN only populates a half's linescore entry once that half has fully ended,
        // including stoppage time, so 2 entries = regulation is locked in.
        const hLs = h.linescores || [];
        const aLs = a.linescores || [];
        const regulationDone = (hLs.length >= 2 && aLs.length >= 2) || state === "post";
        if (!regulationDone) continue;

        const hn = normName(h.team?.displayName || "");
        const an = normName(a.team?.displayName || "");
        const regScore = (ls, fallback) => ls.length >= 2
          ? ls.slice(0, 2).reduce((s, p) => s + parseInt(p.value ?? p.displayValue ?? 0, 10), 0)
          : parseInt(fallback || 0, 10);
        const homeScore = regScore(hLs, h.score);
        const awayScore = regScore(aLs, a.score);

        results[e.id] = {
          t1: hn, t2: an,
          home: homeScore, away: awayScore,
          scoreStr: `${hn} ${homeScore} - ${awayScore} ${an} (90 min)`,
        };
      } else {
        // Non-soccer sports: wait for the full game to end as normal
        if (state !== "post") continue;
        const hn = h.team?.displayName || "";
        const an = a.team?.displayName || "";
        results[e.id] = {
          t1: hn, t2: an,
          home: parseInt(h.score || 0, 10),
          away: parseInt(a.score || 0, 10),
          scoreStr: `${hn} ${h.score || 0} - ${a.score || 0} ${an}`,
        };
      }
    }
    return results;
  } catch { return {}; }
}

function determineOutcome(fighter, result) {
  const { t1, t2, home, away } = result;
  const lastWord = s => s.split(" ").slice(-1)[0];
  // All bets settled on 90-minute regulation score only
  // Same as FanDuel h2h market — ET/penalty goals never count
  // Draw pays if tied at full time (even if someone wins on pens after)
  if (fighter === "Draw") return home === away ? "won" : "lost";
  if (fighter === t1) return home > away ? "won" : home < away ? "lost" : null;
  if (fighter === t2) return away > home ? "won" : away < home ? "lost" : null;
  if (lastWord(t1) === lastWord(fighter)) return home > away ? "won" : home < away ? "lost" : null;
  if (lastWord(t2) === lastWord(fighter)) return away > home ? "won" : away < home ? "lost" : null;
  return null;
}

async function autoSettle() {
  const pending = await sbGet("bets?status=eq.pending&select=*");
  if (!pending?.length) return { settled: 0 };
  const users = await sbGet("users?select=id,balance,username");
  if (!users) return { settled: 0 };
  const house = users.find(u => u.username === "__house__");
  const testUserIds = new Set(users.filter(u => u.username === "test").map(u => u.id));
  const [wcRes, mlbRes] = await Promise.all([
    fetchFinalResults("soccer"),
    fetchFinalResults("mlb"),
  ]);
  const allResults = { ...wcRes, ...mlbRes };
  const balanceDeltas = {};
  let houseBalanceDelta = 0;
  let settled = 0;
  for (const bet of pending) {

    // ── PARLAY (2+ legs) ──────────────────────────────────────────────────────
    if ((bet.legs?.length || 0) > 1) {
      let anyLost = false, allWon = true;
      const legDetails = (bet.legs || []).map(l => {
        if (l._outcome) { if (l._outcome !== 'won') allWon = false; return l; } // already settled
        const result = allResults[l.fightId];
        if (!result) { allWon = false; return l; }
        const outcome = determineOutcome(l.fighter, result);
        if (outcome === 'lost') anyLost = true;
        if (outcome !== 'won') allWon = false;
        return { ...l, result: result.scoreStr, _outcome: outcome };
      });
      if (anyLost) {
        await sbPatch(`bets?id=eq.${bet.id}`, { status: 'lost', legs: legDetails });
        settled++;
      } else if (allWon) {
        if (!testUserIds.has(bet.user_id)) {
          const payout = +(bet.stake + (bet.potential_win || 0)).toFixed(2);
          balanceDeltas[bet.user_id] = +((balanceDeltas[bet.user_id] || 0) + payout).toFixed(2);
          houseBalanceDelta = +(houseBalanceDelta - payout).toFixed(2);
        }
        await sbPatch(`bets?id=eq.${bet.id}`, { status: 'won', legs: legDetails });
        settled++;
      } else {
        // Partial progress — update legs so UI shows which have settled
        await sbPatch(`bets?id=eq.${bet.id}`, { legs: legDetails });
      }
      continue;
    }

    // ── SINGLE BET (1 leg) ────────────────────────────────────────────────────
    const leg = bet.legs?.[0];
    if (!leg?.fightId) continue;
    const result = allResults[leg.fightId];
    if (!result) continue;
    const outcome = determineOutcome(leg.fighter, result);
    if (!outcome) continue;
    const updatedLegs = (bet.legs || []).map(l => ({ ...l, result: result.scoreStr }));
    await sbPatch(`bets?id=eq.${bet.id}`, { status: outcome, legs: updatedLegs });
    // Test user bets: mark won/lost but never touch player or house balance
    if (testUserIds.has(bet.user_id)) { settled++; continue; }
    if (outcome === "won") {
      const payout = +(bet.stake + bet.potential_win).toFixed(2);
      balanceDeltas[bet.user_id] = +((balanceDeltas[bet.user_id] || 0) + payout).toFixed(2);
      houseBalanceDelta = +(houseBalanceDelta - payout).toFixed(2);
    }
    settled++;
  }
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

  // ── Fill in remaining legs on LOST parlays ────────────────────────────────
  // Parlay is already lost (house keeps stake) but players want to see how close
  // they were — keep updating unsettled legs with ✅/❌ without touching status/balance
  try {
    const lostParlays = await sbGet(`bets?status=eq.lost&order=placed_at.desc&limit=100`);
    const lostMultiLeg = (lostParlays || []).filter(b =>
      (b.legs?.length || 0) > 1 && b.legs.some(l => !l._outcome)
    );
    for (const bet of lostMultiLeg) {
      let changed = false;
      const legDetails = (bet.legs || []).map(l => {
        if (l._outcome) return l;
        const result = allResults[l.fightId];
        if (!result) return l;
        const outcome = determineOutcome(l.fighter, result);
        changed = true;
        return { ...l, result: result.scoreStr, _outcome: outcome };
      });
      if (changed) await sbPatch(`bets?id=eq.${bet.id}`, { legs: legDetails });
    }
  } catch (e) { /* non-critical — don't fail the whole cron */ }

  return { settled };
}

// ── Main handler ───────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (CRON_SECRET && req.headers.authorization !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (!ODDS_KEY) return res.status(500).json({ error: "VITE_ODDS_API_KEY not set" });

  const timestamp = new Date().toISOString();
  const results = {};

  // 1. Auto-settle finished games (runs every cron tick — no API call)
  const settle = await autoSettle();
  results._settle = settle.settled > 0 ? `✓ settled ${settle.settled} bet(s)` : "no bets to settle";

  // 2. Update odds — on fixed schedule OR when all today's games just ended (per sport)
  const onSchedule = shouldUpdateNow();

  for (const [sportId, cfg] of Object.entries(SPORTS)) {
    const gamesJustEnded = await allGamesFinal(cfg.espnUrl);

    if (!onSchedule && !gamesJustEnded) {
      results[sportId] = `skip — next at ${nextUpdateLabel()}`;
      continue;
    }

    // Post-game debounce: after all games end, only fetch next-day odds once per 25 min
    if (gamesJustEnded && !onSchedule) {
      const cached = await sbGet(`odds_cache?id=eq.${sportId}&select=updated_at`);
      const lastUpdate = cached?.[0]?.updated_at ? new Date(cached[0].updated_at).getTime() : 0;
      if (Date.now() - lastUpdate < POST_GAME_DEBOUNCE_MS) {
        results[sportId] = `skip — next-day odds already fetched ${Math.round((Date.now()-lastUpdate)/60000)}m ago`;
        continue;
      }
    }

    try {
      const r = await fetch(
        `https://api.the-odds-api.com/v4/sports/${cfg.oddsKey}/odds/?apiKey=${ODDS_KEY}&regions=us&markets=h2h&oddsFormat=american`
      );
      if (!r.ok) { results[sportId] = `odds-api ${r.status}`; continue; }
      const data = await r.json();
      if (!Array.isArray(data)) { results[sportId] = "bad response"; continue; }
      const stored = await storeOdds(sportId, data);
      results[sportId] = stored
        ? `✓ ${data.length} game(s)${gamesJustEnded&&!onSchedule?" (post-game next-day fetch)":""}`
        : "supabase write failed";
    } catch (e) {
      results[sportId] = `error: ${e.message}`;
    }
  }

  return res.json({ ok: true, timestamp, results });
}
