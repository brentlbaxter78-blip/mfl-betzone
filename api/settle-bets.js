// /api/settle-bets.js
// Settles pending bets by checking ESPN scores only — NO Odds API call, zero tokens.
// Called automatically when a WC game enters OT (regulation is done but game still live),
// and can be called manually any time for instant settlement without burning API budget.

const SUPA_URL = "https://nuiffniijnbzzkvxxtle.supabase.co";
const SUPA_KEY = process.env.SUPABASE_KEY;
const CRON_SECRET = process.env.CRON_SECRET || "mfl2026cron";

const ESPN_WC  = "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard";
const ESPN_MLB = "https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard";

const sbHeaders = {
  apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`,
  "Content-Type": "application/json", Prefer: "return=minimal",
};

const normName = s => {
  const NAME_MAP = {
    "United States":"USA","Korea Republic":"South Korea","Côte d'Ivoire":"Ivory Coast",
    "DR Congo":"Congo DR","Congo DR":"Congo DR","Czech Republic":"Czechia",
    "Bosnia and Herzegovina":"Bosnia","Bosnia-Herzegovina":"Bosnia","Bosnia & Herzegovina":"Bosnia",
    "Trinidad and Tobago":"Trinidad","United Arab Emirates":"UAE","China PR":"China",
    "IR Iran":"Iran","Republic of Ireland":"Ireland","Central African Republic":"CAR",
  };
  return NAME_MAP[s] || s;
};

async function fetchFinalResults(espnUrl, isSoccer) {
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

      if (isSoccer) {
        const hLs = h.linescores || [];
        const aLs = a.linescores || [];
        // Settle at end of regulation (2 halves complete) — don't wait for OT/pens
        const regulationDone = (hLs.length >= 2 && aLs.length >= 2) || state === "post";
        if (!regulationDone) continue;
        const regScore = (ls, fb) => ls.length >= 2
          ? ls.slice(0, 2).reduce((s, p) => s + parseInt(p.value ?? p.displayValue ?? 0, 10), 0)
          : parseInt(fb || 0, 10);
        const hn = normName(h.team?.displayName || "");
        const an = normName(a.team?.displayName || "");
        const homeScore = regScore(hLs, h.score);
        const awayScore = regScore(aLs, a.score);
        results[e.id] = { t1: hn, t2: an, home: homeScore, away: awayScore,
          scoreStr: `${hn} ${homeScore} - ${awayScore} ${an} (90 min)` };
      } else {
        if (state !== "post") continue;
        const hn = h.team?.displayName || "";
        const an = a.team?.displayName || "";
        results[e.id] = { t1: hn, t2: an,
          home: parseInt(h.score || 0, 10), away: parseInt(a.score || 0, 10),
          scoreStr: `${hn} ${h.score || 0} - ${a.score || 0} ${an}` };
      }
    }
    return results;
  } catch { return {}; }
}

function determineOutcome(fighter, result) {
  if (!result) return null;
  const { home, away } = result;
  if (fighter === "Draw") return home === away ? "won" : "lost";
  if (fighter === result.t1 || normName(fighter) === result.t1) return home > away ? "won" : home < away ? "lost" : "won";
  if (fighter === result.t2 || normName(fighter) === result.t2) return away > home ? "won" : away < home ? "lost" : "won";
  const ft = normName(fighter);
  if (ft === result.t1) return home > away ? "won" : home < away ? "lost" : "won";
  if (ft === result.t2) return away > home ? "won" : away < home ? "lost" : "won";
  return null;
}

async function sbGet(path) {
  const r = await fetch(`${SUPA_URL}/rest/v1/${path}`, { headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` } });
  return r.ok ? r.json() : null;
}
async function sbPatch(path, body) {
  await fetch(`${SUPA_URL}/rest/v1/${path}`, { method: "PATCH", headers: sbHeaders, body: JSON.stringify(body) });
}

export default async function handler(req, res) {
  const auth = req.headers.authorization || "";
  if (!auth.includes(CRON_SECRET)) return res.status(401).json({ error: "Unauthorized" });

  try {
    const [wcRes, mlbRes, pending, house, allUsers] = await Promise.all([
      fetchFinalResults(ESPN_WC, true),
      fetchFinalResults(ESPN_MLB, false),
      sbGet("bets?status=eq.pending&select=*"),
      sbGet("users?username=eq.brent&select=id,balance"),
      sbGet("users?select=id,username"),
    ]);

    const allResults = { ...wcRes, ...mlbRes };
    const houseAcct = house?.[0];
    const testUserIds = new Set((allUsers || []).filter(u => u.username === "test").map(u => u.id));

    const balanceDeltas = {};
    let houseBalanceDelta = 0;
    let settled = 0;

    for (const bet of (pending || [])) {
      // PARLAY
      if ((bet.legs?.length || 0) > 1) {
        let anyLost = false, allWon = true;
        const legDetails = (bet.legs || []).map(l => {
          if (l._outcome) { if (l._outcome !== "won") allWon = false; return l; }
          const result = allResults[l.fightId];
          if (!result) { allWon = false; return l; }
          const outcome = determineOutcome(l.fighter, result);
          if (outcome === "lost") anyLost = true;
          if (outcome !== "won") allWon = false;
          return { ...l, result: result.scoreStr, _outcome: outcome };
        });
        if (anyLost) {
          await sbPatch(`bets?id=eq.${bet.id}`, { status: "lost", legs: legDetails });
          settled++;
        } else if (allWon) {
          if (!testUserIds.has(bet.user_id)) {
            const payout = +(bet.stake + (bet.potential_win || 0)).toFixed(2);
            balanceDeltas[bet.user_id] = +((balanceDeltas[bet.user_id] || 0) + payout).toFixed(2);
            houseBalanceDelta = +(houseBalanceDelta - payout).toFixed(2);
          }
          await sbPatch(`bets?id=eq.${bet.id}`, { status: "won", legs: legDetails });
          settled++;
        } else {
          await sbPatch(`bets?id=eq.${bet.id}`, { legs: legDetails });
        }
        continue;
      }

      // SINGLE
      const leg = bet.legs?.[0];
      if (!leg?.fightId) continue;
      const result = allResults[leg.fightId];
      if (!result) continue;
      const outcome = determineOutcome(leg.fighter, result);
      if (!outcome) continue;
      const updatedLegs = (bet.legs || []).map(l => ({ ...l, result: result.scoreStr }));
      await sbPatch(`bets?id=eq.${bet.id}`, { status: outcome, legs: updatedLegs });
      if (!testUserIds.has(bet.user_id) && outcome === "won") {
        const payout = +(bet.stake + bet.potential_win).toFixed(2);
        balanceDeltas[bet.user_id] = +((balanceDeltas[bet.user_id] || 0) + payout).toFixed(2);
        houseBalanceDelta = +(houseBalanceDelta - payout).toFixed(2);
      }
      settled++;
    }

    // Apply balance deltas
    for (const [uid, delta] of Object.entries(balanceDeltas)) {
      if (!delta) continue;
      const fresh = await sbGet(`users?id=eq.${uid}&select=id,balance`);
      const u = fresh?.[0];
      if (u) await sbPatch(`users?id=eq.${u.id}`, { balance: +(u.balance + delta).toFixed(2) });
    }
    if (houseAcct && houseBalanceDelta !== 0) {
      const fh = await sbGet(`users?id=eq.${houseAcct.id}&select=id,balance`);
      const h = fh?.[0];
      if (h) await sbPatch(`users?id=eq.${h.id}`, { balance: +(h.balance + houseBalanceDelta).toFixed(2) });
    }

    // Fill in remaining legs on lost parlays (for "how close" display)
    try {
      const lostParlays = await sbGet("bets?status=eq.lost&order=placed_at.desc&limit=100");
      for (const bet of (lostParlays || []).filter(b => (b.legs?.length||0)>1 && b.legs.some(l=>!l._outcome))) {
        let changed = false;
        const legs = (bet.legs||[]).map(l => {
          if (l._outcome) return l;
          const result = allResults[l.fightId];
          if (!result) return l;
          changed = true;
          return { ...l, result: result.scoreStr, _outcome: determineOutcome(l.fighter, result) };
        });
        if (changed) await sbPatch(`bets?id=eq.${bet.id}`, { legs });
      }
    } catch {}

    return res.json({ ok: true, settled });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
