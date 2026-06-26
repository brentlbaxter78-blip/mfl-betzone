import { useState, useEffect, useCallback } from "react";

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const SUPA_URL = "https://nuiffniijnbzzkvxxtle.supabase.co";
const SUPA_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im51aWZmbmlpam5ienprdnh4dGxlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIzNDA5MzgsImV4cCI6MjA5NzkxNjkzOH0.dlKFKRYwZIU_GefbPV7aDhOab5B7jGByVTAAV3uQ8C8";
const ADMIN_USER = "brent", ADMIN_PASS = "MFLadmin2026!";
// ↓ Get a FREE key at the-odds-api.com (500 req/month, no credit card)
const ODDS_API_KEY = ""; // paste your key between the quotes

const sb = async (path, opts = {}) => {
  const { method = "GET", body, prefer = "return=representation" } = opts;
  const res = await fetch(`${SUPA_URL}/rest/v1/${path}`, {
    method,
    headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, "Content-Type": "application/json", Prefer: prefer },
    ...(body !== undefined ? { body } : {}),
  });
  if (!res.ok) { const t = await res.text(); throw new Error(t || `HTTP ${res.status}`); }
  const t = await res.text(); return t ? JSON.parse(t) : null;
};

const db = {
  findUser:   u    => sb(`users?username=eq.${encodeURIComponent(u.toLowerCase().trim())}&limit=1`),
  getUser:    id   => sb(`users?id=eq.${id}&limit=1`),
  allUsers:   ()   => sb(`users?select=id,username,display_name,balance,cash_in,cash_out,privacy_public,is_admin,created_at&order=created_at.asc`),
  addUser:    d    => sb(`users`, { method:"POST", body:JSON.stringify(d) }),
  patchUser:  (id,d) => sb(`users?id=eq.${id}`, { method:"PATCH", body:JSON.stringify(d) }),
  deleteUser: id   => sb(`users?id=eq.${id}`, { method:"DELETE", prefer:"return=minimal" }),
  getHouse:   ()   => sb(`users?username=eq.__house__&limit=1`),
  myBets:     uid  => sb(`bets?user_id=eq.${uid}&order=placed_at.desc`),
  allBets:    ()   => sb(`bets?order=placed_at.desc`),
  pendBets:   ()   => sb(`bets?status=eq.pending&order=placed_at.asc`),
  addBet:     d    => sb(`bets`, { method:"POST", body:JSON.stringify(d) }),
  patchBet:   (id,d) => sb(`bets?id=eq.${id}`, { method:"PATCH", body:JSON.stringify(d) }),
  myTxs:      uid  => sb(`transactions?user_id=eq.${uid}&order=created_at.desc`),
  allTxs:     ()   => sb(`transactions?order=created_at.desc`),
  pendingTxs: ()   => sb(`transactions?status=eq.pending&order=created_at.asc`),
  addTx:      d    => sb(`transactions`, { method:"POST", body:JSON.stringify(d) }),
  patchTx:    (id,d) => sb(`transactions?id=eq.${id}`, { method:"PATCH", body:JSON.stringify(d) }),
};

// ─── STABLE ODDS (module-level cache, resets every 2 min to match refresh) ───
let _oddsCache = {}, _cacheTime = 0;
const ODDS_TTL = 2 * 60 * 1000; // sync with refresh interval — odds update every 2 min
const VIG = 0.10;

const odds3 = (t1, t2) => {
  const s1 = STR[t1]||1100, s2 = STR[t2]||1100;
  const D = s1 - s2; // pure strength difference — no random jitter, odds are deterministic
  // H2H win probability via logistic curve
  const h2h = 0.5 + 0.5 * Math.tanh(D / 900);
  // Draw probability: ~27% for even match, falls with mismatch
  const drawP = Math.max(0.10, 0.27 - Math.abs(D) / 6000);
  // True 3-way probabilities
  const p1 = h2h * (1 - drawP);       // stronger team win
  const pD = drawP;
  const p2 = (1 - h2h) * (1 - drawP); // weaker team win
  // Convert to American moneyline with 10% vig applied
  const toAML = p => {
    const vp = p * (1 + VIG); // implied probability after vig
    return vp >= 0.5
      ? -Math.round(vp / (1 - vp) * 100)   // favorite (negative)
      : +Math.round((1 - vp) / vp * 100);   // underdog (positive)
  };
  return { o1: toAML(p1), oDraw: toAML(pD), o2: toAML(p2) };
};

const stableOdds = (gid, t1, t2) => {
  const now = Date.now();
  // Only expire cache for games not yet closed — once betting locks, odds are frozen
  if (!_oddsCache[gid]) {
    if (now - _cacheTime > ODDS_TTL) { _oddsCache = {}; _cacheTime = now; }
    _oddsCache[gid] = odds3(t1, t2);
  }
  return _oddsCache[gid];
};

// ─── WORLD CUP ───────────────────────────────────────────────────────────────
const STR = {
  "Argentina":1850,"France":1800,"Brazil":1780,"England":1750,"Portugal":1700,
  "Spain":1680,"Belgium":1620,"Netherlands":1640,"Germany":1600,"Croatia":1580,
  "Uruguay":1540,"Italy":1560,"Switzerland":1480,"Colombia":1460,"USA":1420,
  "Mexico":1400,"Japan":1380,"Morocco":1360,"Senegal":1340,"Denmark":1320,
  "South Korea":1260,"Ecuador":1240,"Canada":1220,"Serbia":1200,"Ghana":1160,
  "Cameroon":1140,"Tunisia":1120,"Iran":1100,"Costa Rica":1080,"Saudi Arabia":1040,
  "Qatar":980,"Australia":1280,"Poland":1300,"Nigeria":1120,"Algeria":1060,
  "Panama":960,"Honduras":940,"Paraguay":1020,"Bolivia":980,"Peru":1040,
  "Chile":1080,"Venezuela":960,"Jamaica":920,"Guatemala":900,"El Salvador":880,
  "Cuba":860,"Haiti":870,
};

// Name normalization — handles both ESPN API and The Odds API naming
const NAME_MAP = {
  "United States":"USA","Korea Republic":"South Korea","Côte d'Ivoire":"Ivory Coast",
  "DR Congo":"Congo","Czech Republic":"Czechia","Bosnia and Herzegovina":"Bosnia",
  "Trinidad and Tobago":"Trinidad","United Arab Emirates":"UAE","China PR":"China",
  "IR Iran":"Iran","Republic of Ireland":"Ireland","North Korea":"North Korea",
  "Central African Republic":"CAR","São Tomé and Príncipe":"Sao Tome",
  "Equatorial Guinea":"Eq. Guinea","Papua New Guinea":"PNG",
};
const normName = n => NAME_MAP[n] || n;

// ── THE ODDS API (real live odds) ─────────────────────────────────────────────
const fetchLiveOdds = async () => {
  if (!ODDS_API_KEY) return null;
  try {
    const r = await fetch(
      `https://api.the-odds-api.com/v4/sports/soccer_fifa_world_cup/odds/?apiKey=${ODDS_API_KEY}&regions=us&markets=h2h&oddsFormat=american`
    );
    if (!r.ok) return null;
    const games = await r.json();
    if (!Array.isArray(games) || !games.length) return null;
    return games.map(g => {
      // Use first available bookmaker
      const bm = g.bookmakers?.[0];
      const mkt = bm?.markets?.find(m => m.key === "h2h");
      if (!mkt) return null;
      const t1 = normName(g.home_team);
      const t2 = normName(g.away_team);
      const outs = mkt.outcomes || [];
      const home  = outs.find(o => normName(o.name) === t1 || o.name === g.home_team);
      const away  = outs.find(o => normName(o.name) === t2 || o.name === g.away_team);
      const draw  = outs.find(o => o.name === "Draw");
      const fb    = stableOdds(g.id, t1, t2);
      const now   = new Date();
      const start = new Date(g.commence_time);
      const isLive = now >= start;
      return {
        id: g.id,
        t1, t2,
        dt: g.commence_time,
        rnd: "FIFA World Cup 2026",
        isLive,
        o1:    home?.price  ?? fb.o1,
        oDraw: draw?.price  ?? fb.oDraw,
        o2:    away?.price  ?? fb.o2,
      };
    }).filter(Boolean);
  } catch(e) {
    console.warn("Odds API unavailable:", e.message);
    return null;
  }
};

// ── ESPN FALLBACK (real game schedule + real ESPN odds when available) ─────────
const fetchESPN = async () => {
  try {
    const r = await fetch("https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard");
    if (!r.ok) return null;
    const d = await r.json();
    const today = todayET();
    const evs = (d.events||[]).filter(e =>
      ["pre","in"].includes(e.status?.type?.state) &&
      dateStrET(e.date) === today
    );
    if (!evs.length) return [];
    return evs.map(e => {
      const cs = e.competitions?.[0]?.competitors||[];
      const h  = cs.find(c=>c.homeAway==="home"), a = cs.find(c=>c.homeAway==="away");
      const t1 = normName(h?.team?.displayName||"Home");
      const t2 = normName(a?.team?.displayName||"Away");
      const isLive = e.status?.type?.state === "in";

      // Try to get real odds from ESPN's odds data
      const espnOdds = e.competitions?.[0]?.odds?.[0];
      const parseML = v => (v && typeof v === "object") ? (v.moneyLine ?? null) : (v ?? null);
      const realO1   = parseML(espnOdds?.homeTeamOdds?.moneyLine ?? espnOdds?.moneylineHome);
      const realO2   = parseML(espnOdds?.awayTeamOdds?.moneyLine ?? espnOdds?.moneylineAway);
      // ESPN's drawOdds can be {moneyLine: 310} OR a plain number — handle both
      const realDraw = parseML(espnOdds?.drawOdds?.moneyLine ?? espnOdds?.drawOdds ?? espnOdds?.draw?.moneyLine);

      // Use ESPN real odds if available, otherwise fall back to calculated
      const fallback = stableOdds(e.id, t1, t2);
      const o1    = (realO1    !== null && realO1    !== 0) ? realO1    : fallback.o1;
      const o2    = (realO2    !== null && realO2    !== 0) ? realO2    : fallback.o2;
      const oDraw = (realDraw  !== null && realDraw  !== 0) ? realDraw  : fallback.oDraw;
      const usingRealOdds = realO1 !== null && realO1 !== 0;

      // Live score and clock (only populated when game is in progress)
      const homeScore = isLive ? (h?.score ?? null) : null;
      const awayScore = isLive ? (a?.score ?? null) : null;
      const clock  = isLive ? (e.status?.displayClock ?? null) : null;
      const period = isLive ? (e.status?.type?.shortDetail ?? null) : null;

      return { id:e.id, t1, t2, dt:e.date, rnd:e.name||"FIFA World Cup 2026", isLive, usingRealOdds, o1, oDraw, o2,
        score: (homeScore !== null && awayScore !== null) ? {home:homeScore, away:awayScore} : null,
        clock, period };
    });
  } catch { return null; }
};

// Master fetch: live odds API → ESPN today → no games message
const fetchWC = async () => {
  const live = await fetchLiveOdds();
  if (live?.length) return live;
  const espn = await fetchESPN();
  if (espn === null) return FB;
  return espn;
};

// Auto-fetch final scores from ESPN for completed games — used to pre-fill settle scores
const fetchFinalScores = async () => {
  try {
    const r = await fetch("https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard");
    if(!r.ok) return {};
    const d = await r.json();
    const scores = {};
    (d.events||[])
      .filter(e => e.status?.type?.state === "post") // only completed games
      .forEach(e => {
        const cs = e.competitions?.[0]?.competitors||[];
        const h = cs.find(c=>c.homeAway==="home");
        const a = cs.find(c=>c.homeAway==="away");
        if(!h||!a) return;
        const t1 = normName(h.team?.displayName||"");
        const t2 = normName(a.team?.displayName||"");
        const str = `${t1} ${h.score||0} - ${a.score||0} ${t2}`;
        // Store both orderings so we can match regardless of home/away
        scores[`${t1}|${t2}`] = str;
        scores[`${t2}|${t1}`] = str;
      });
    return scores;
  } catch { return {}; }
};

// ── MLB (real odds + scores from ESPN) ────────────────────────────────────────
const fetchMLB = async () => {
  try {
    const r = await fetch("https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard");
    if(!r.ok) return [];
    const d = await r.json();
    const today = todayET();
    const evs = (d.events||[]).filter(e =>
      ["pre","in"].includes(e.status?.type?.state) &&
      dateStrET(e.date) === today
    );
    return evs.map(e => {
      const cs = e.competitions?.[0]?.competitors||[];
      const h = cs.find(c=>c.homeAway==="home");
      const a = cs.find(c=>c.homeAway==="away");
      const t1 = h?.team?.displayName||"Home";
      const t2 = a?.team?.displayName||"Away";
      const abbr1 = h?.team?.abbreviation||"";
      const abbr2 = a?.team?.abbreviation||"";
      const isLive = e.status?.type?.state === "in";
      const espnOdds = e.competitions?.[0]?.odds?.[0];
      const parseML = v => (v&&typeof v==="object")?(v.moneyLine??null):(v??null);
      const realO1 = parseML(espnOdds?.homeTeamOdds?.moneyLine??espnOdds?.moneylineHome);
      const realO2 = parseML(espnOdds?.awayTeamOdds?.moneyLine??espnOdds?.moneylineAway);
      const o1 = (realO1&&realO1!==0)?realO1:-115; // fallback: slight home advantage
      const o2 = (realO2&&realO2!==0)?realO2:-105;
      const homeScore = isLive?(h?.score??null):null;
      const awayScore = isLive?(a?.score??null):null;
      const period = isLive?(e.status?.type?.shortDetail??null):null;
      return { id:e.id, t1, t2, abbr1, abbr2, dt:e.date, sport:"mlb",
        o1, o2, isLive, usingRealOdds:!!(realO1&&realO1!==0),
        score:(homeScore!==null&&awayScore!==null)?{home:homeScore,away:awayScore}:null, period };
    });
  } catch { return []; }
};

const CODES={
  "Argentina":"ar","France":"fr","Brazil":"br","England":"gb-eng","Portugal":"pt",
  "Spain":"es","Belgium":"be","Netherlands":"nl","Germany":"de","Croatia":"hr",
  "Uruguay":"uy","Italy":"it","Switzerland":"ch","Colombia":"co","USA":"us",
  "Mexico":"mx","Japan":"jp","Morocco":"ma","Senegal":"sn","Denmark":"dk",
  "South Korea":"kr","Ecuador":"ec","Canada":"ca","Serbia":"rs","Ghana":"gh",
  "Cameroon":"cm","Tunisia":"tn","Iran":"ir","Costa Rica":"cr","Saudi Arabia":"sa",
  "Qatar":"qa","Australia":"au","Poland":"pl","Nigeria":"ng","Algeria":"dz",
  "Panama":"pa","Paraguay":"py","Bolivia":"bo","Peru":"pe","Chile":"cl",
  "Venezuela":"ve","Jamaica":"jm","Honduras":"hn","El Salvador":"sv","Cuba":"cu",
  "Haiti":"ht","Wales":"gb-wls","Scotland":"gb-sct","New Zealand":"nz","UAE":"ae",
  "China":"cn","Ivory Coast":"ci","Congo":"cd","Czechia":"cz","Bosnia":"ba",
  "Trinidad":"tt","Ireland":"ie","Ukraine":"ua","Turkey":"tr","Romania":"ro",
  "Greece":"gr","Hungary":"hu","Slovakia":"sk","Slovenia":"si","Georgia":"ge",
  "Albania":"al","Finland":"fi","Norway":"no","Sweden":"se","Austria":"at",
};
// Flag renders a real image from flagcdn.com — works on ALL platforms including Windows
function Flag({team,size=24}){
  const [err,setErr]=useState(false);
  if(team==="Draw")return<span style={{fontSize:size,lineHeight:1}}>⚖️</span>;
  const code=CODES[team];
  if(!code||err)return<span style={{fontSize:size*0.8,lineHeight:1}}>⚽</span>;
  return<img src={`https://flagcdn.com/w40/${code}.png`} alt={team} width={Math.round(size*1.45)} height={size} style={{objectFit:"cover",borderRadius:2,display:"inline-block",verticalAlign:"middle"}} onError={()=>setErr(true)}/>;
}
const fl=t=>t==="Draw"?"⚖️ Draw":t; // text-only fallback for non-visual contexts

// MLB team logo from ESPN's CDN
function MLBLogo({abbr,size=26}){
  const [err,setErr]=useState(false);
  if(!abbr||err)return<span style={{fontSize:size*0.8,lineHeight:1}}>⚾</span>;
  return<img src={`https://a.espncdn.com/i/teamlogos/mlb/500/${abbr.toLowerCase()}.png`} alt={abbr} width={size} height={size} style={{objectFit:"contain",display:"inline-block"}} onError={()=>setErr(true)}/>;
}

const FB = [
  {id:"f1",t1:"Argentina",  t2:"Croatia",    dt:"2026-06-26T19:00:00",rnd:"Group Stage · C"},
  {id:"f2",t1:"France",     t2:"Tunisia",    dt:"2026-06-26T19:00:00",rnd:"Group Stage · D"},
  {id:"f3",t1:"England",    t2:"Slovakia",   dt:"2026-06-26T22:00:00",rnd:"Group Stage · B"},
  {id:"f4",t1:"USA",        t2:"Iran",       dt:"2026-06-26T22:00:00",rnd:"Group Stage · A"},
  {id:"f5",t1:"Brazil",     t2:"Cameroon",   dt:"2026-06-27T19:00:00",rnd:"Group Stage · E"},
  {id:"f6",t1:"Spain",      t2:"Japan",      dt:"2026-06-27T19:00:00",rnd:"Group Stage · F"},
  {id:"f7",t1:"Germany",    t2:"Costa Rica", dt:"2026-06-27T22:00:00",rnd:"Group Stage · G"},
  {id:"f8",t1:"Netherlands",t2:"Qatar",      dt:"2026-06-27T22:00:00",rnd:"Group Stage · H"},
].map(g=>({...g,...stableOdds(g.id,g.t1,g.t2)}));

// Closes 3 minutes before game (not live betting)
const isClosed = dt => new Date() >= new Date(new Date(dt).getTime() - 180000);

// ─── HELPERS ─────────────────────────────────────────────────────────────────
const ET = "America/New_York"; // all times run on Eastern Time
const fmtO = o => o>0?`+${o}`:`${o}`;
const calcW = (s,o) => o>0?+(s*(o/100)).toFixed(2):+(s*(100/Math.abs(o))).toFixed(2);
const fmtDt = iso => { const d=new Date(iso); return d.toLocaleDateString("en-US",{month:"short",day:"numeric",timeZone:ET})+" · "+d.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit",timeZone:ET,timeZoneName:"short"}); };
const fmtDate = iso => new Date(iso).toLocaleDateString("en-US",{month:"short",day:"numeric",timeZone:ET});
const dateStrET = iso => new Date(iso).toLocaleDateString("en-CA",{timeZone:ET}); // "2026-06-25" — used for day comparison
const todayET = () => dateStrET(new Date().toISOString()); // today's date in ET regardless of user's location
const mkHash = s => btoa(unescape(encodeURIComponent(s+"||mfl2026")));
const unHash = h => { try{return decodeURIComponent(escape(atob(h))).replace("||mfl2026","");}catch{return "••••";} };
const betLabel = t => t==="Draw"?"⚖️ Draw":t;
const cap = s => s.charAt(0).toUpperCase()+s.slice(1);

const TERMS = [
  {n:"1",t:"Don't leak outside of MFL. What happens in MFL Betzone stays in MFL Betzone. Do not share bet details, balances, or any platform info outside the group."},
  {n:"2",t:"Gamble responsibly. Only bet what you can afford to lose. This is for fun — if it stops being fun, stop betting."},
  {n:"3",t:"No refunds. Once a bet is placed and confirmed, it is final. No cancellations or reversals for any reason. Always verify before confirming."},
];

// ─── ROOT ─────────────────────────────────────────────────────────────────────
export default function App(){
  const [session,setSession]=useState(null);
  const [toast,setToast]=useState(null);
  const [wc,setWc]=useState([]);
  const [wcLoading,setWcLoading]=useState(true);
  const [mlb,setMlb]=useState([]);
  const [mlbLoading,setMlbLoading]=useState(true);
  const showToast=(msg,type="success")=>{setToast({msg,type});setTimeout(()=>setToast(null),4000);};
  const refreshWC=useCallback(async()=>{const g=await fetchWC();setWc(g);setWcLoading(false);},[]);
  const refreshMLB=useCallback(async()=>{const g=await fetchMLB();setMlb(g);setMlbLoading(false);},[]);
  useEffect(()=>{refreshWC();refreshMLB();},[refreshWC,refreshMLB]);
  useEffect(()=>{
    const iv=setInterval(()=>{if(!document.hidden){refreshWC();refreshMLB();}},2*60*1000);
    const h=()=>{if(!document.hidden){refreshWC();refreshMLB();}};
    document.addEventListener("visibilitychange",h);
    return()=>{clearInterval(iv);document.removeEventListener("visibilitychange",h);};
  },[refreshWC,refreshMLB]);
  // On load: check localStorage first (remember me), then sessionStorage (this tab only)
  useEffect(()=>{
    try{
      const ls=localStorage.getItem("mfl_s");
      const ss=sessionStorage.getItem("mfl_s");
      const saved=ls||ss;
      if(saved)setSession(JSON.parse(saved));
    }catch(e){}
  },[]);
  // remember=true → localStorage (persists), false → sessionStorage (tab only)
  const login=(s,remember=false)=>{
    setSession(s);
    try{
      if(remember){localStorage.setItem("mfl_s",JSON.stringify(s));sessionStorage.removeItem("mfl_s");}
      else{sessionStorage.setItem("mfl_s",JSON.stringify(s));localStorage.removeItem("mfl_s");}
    }catch(e){}
  };
  const logout=()=>{
    setSession(null);
    try{localStorage.removeItem("mfl_s");sessionStorage.removeItem("mfl_s");}catch(e){}
  };
  if(!session)return<Login login={login} showToast={showToast} toast={toast}/>;
  return<Main session={session} logout={logout} showToast={showToast} toast={toast} wc={wc} wcLoading={wcLoading} mlb={mlb} mlbLoading={mlbLoading}/>;
}

// ─── LOGIN ────────────────────────────────────────────────────────────────────
function Login({login,showToast,toast}){
  const [mode,setMode]=useState("login");
  const [un,setUn]=useState(""),[pw,setPw]=useState(""),[cpw,setCpw]=useState("");
  const [tos,setTos]=useState(false),[showTos,setShowTos]=useState(false),[tosRead,setTosRead]=useState(false);
  const [busy,setBusy]=useState(false);
  const [remember,setRemember]=useState(false);
  // No ref needed — scroll is tracked via event target
  const onTosScroll=e=>{const el=e.currentTarget;if(el.scrollHeight-el.scrollTop<=el.clientHeight+30)setTosRead(true);};

  const doLogin=async()=>{
    if(!un.trim()||!pw)return showToast("Enter your username and password","error");
    if(un.trim().toLowerCase()===ADMIN_USER&&pw===ADMIN_PASS){login({userId:"admin",isAdmin:true},remember);return;}
    setBusy(true);
    try{
      const rows=await db.findUser(un.trim());const user=rows?.[0];
      if(!user||user.password_hash!==mkHash(pw))return showToast("Wrong username or password","error");
      login({userId:user.id,isAdmin:false},remember);
    }catch(e){showToast("Connection error — try again","error");}finally{setBusy(false);}
  };

  const doRegister=async()=>{
    const id=un.trim().toLowerCase().replace(/\s+/g,"");
    if(!id||!pw||!cpw)return showToast("Fill out every field","error");
    if(id===ADMIN_USER||id==="__house__")return showToast("That username is reserved","error");
    if(pw.length<4)return showToast("Password must be at least 4 characters","error");
    if(pw!==cpw)return showToast("Passwords don't match","error");
    if(!tos)return showToast("Read and agree to the Terms of Service first","error");
    setBusy(true);
    try{
      const ex=await db.findUser(id);
      if(ex?.length>0){showToast("Username already taken","error");setBusy(false);return;}
      await db.addUser({username:id,display_name:cap(id),password_hash:mkHash(pw),balance:0,cash_in:0,cash_out:0,privacy_public:true,is_admin:false});
      const rows=await db.findUser(id);const nu=rows?.[0];
      if(!nu)throw new Error("Created but couldn't retrieve");
      showToast("Welcome to MFL Betzone! 🎉");login({userId:nu.id,isAdmin:false},remember);
    }catch(e){
      const m=e.message?.includes("42501")||e.message?.includes("permission")
        ?"DB error — run mfl_setup.sql in Supabase"
        :e.message?.includes("unique")||e.message?.includes("duplicate")
        ?"Username already taken"
        :"Error creating account — try again";
      showToast(m,"error");
    }finally{setBusy(false);}
  };


  return(
    <div style={S.root}>
      {toast&&<Toast t={toast}/>}
      {showTos&&(
        <div style={S.over}>
          <div style={S.modal}>
            <div style={{fontSize:16,fontWeight:800,color:C.text,marginBottom:4}}>Terms of Service</div>
            <div style={{fontSize:11,color:C.dim,marginBottom:14}}>Scroll to the bottom to accept</div>
            <div onScroll={onTosScroll} style={{overflowY:"auto",maxHeight:260,marginBottom:16}}>
              {TERMS.map(t=>(
                <div key={t.n} style={{display:"flex",gap:14,marginBottom:20}}>
                  <span style={{fontSize:18,fontWeight:900,color:C.gold,flexShrink:0,lineHeight:1.5}}>{t.n}.</span>
                  <p style={{fontSize:14,color:C.sub,lineHeight:1.75,margin:0}}>{t.t}</p>
                </div>
              ))}
              <p style={{fontSize:12,color:C.dim,lineHeight:1.6,marginTop:8,paddingTop:12,borderTop:`1px solid ${C.border}`}}>
                By creating an account you agree to all terms. MFL Betzone is a private platform. $1 USD = ₿1 Brent Bucks.
              </p>
            </div>
            <button style={{...S.btn,width:"100%",padding:"14px",opacity:tosRead?1:0.35,cursor:tosRead?"pointer":"not-allowed"}}
              onClick={()=>tosRead&&(setTos(true),setShowTos(false))}>
              {tosRead?"I Agree ✓":"Scroll down to accept"}
            </button>
            <button style={{...S.ghost,width:"100%",marginTop:8,padding:"12px"}} onClick={()=>setShowTos(false)}>Close</button>
          </div>
        </div>
      )}
      <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",minHeight:"100vh",padding:"24px 20px"}}>
        <div style={{marginBottom:32,textAlign:"center"}}>
          <div style={{width:80,height:80,background:C.card,borderRadius:18,border:`1px solid ${C.border}`,display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 14px"}}>
            <span style={{fontSize:46,fontWeight:900,color:C.gold,lineHeight:1}}>₿</span>
          </div>
          <div style={{fontSize:22,fontWeight:900,color:C.text,letterSpacing:"0.06em"}}>MFL BETZONE</div>
          <div style={{fontSize:10,fontWeight:600,color:C.dim,letterSpacing:"0.16em",marginTop:2}}>SPORTSBOOK · $1 = ₿1</div>
        </div>
        <div style={{...S.card,width:"100%",maxWidth:400,padding:"22px 20px"}}>
          <div style={{display:"flex",background:C.bg,borderRadius:10,border:`1px solid ${C.border}`,marginBottom:22,overflow:"hidden",padding:3,gap:3}}>
            <button style={{...S.tabTog,...(mode==="login"?S.tabOn:{})}} onClick={()=>setMode("login")}>Sign In</button>
            <button style={{...S.tabTog,...(mode==="register"?S.tabOn:{})}} onClick={()=>setMode("register")}>Create Account</button>
          </div>
          <Fld label="Username (use first name)">
            <input style={S.inp} placeholder="e.g. mike" value={un} onChange={e=>setUn(e.target.value)} autoCapitalize="none" autoCorrect="off" spellCheck={false}/>
          </Fld>
          <Fld label="Password">
            <input style={S.inp} type="password" placeholder="••••••••" value={pw} onChange={e=>setPw(e.target.value)} onKeyDown={e=>mode==="login"&&e.key==="Enter"&&doLogin()}/>
          </Fld>
          {mode==="register"&&(
            <Fld label="Confirm Password">
              <input style={{...S.inp,...(cpw&&cpw!==pw?{borderColor:"#E53935"}:{})}} type="password" placeholder="••••••••" value={cpw} onChange={e=>setCpw(e.target.value)} onKeyDown={e=>e.key==="Enter"&&doRegister()}/>
              {cpw&&cpw!==pw&&<div style={{fontSize:11,color:"#E53935",marginTop:5}}>Passwords don't match</div>}
            </Fld>
          )}
          {mode==="register"&&(
            <div style={{marginBottom:18,background:C.bg,border:`1px solid ${tos?C.gold+"44":C.border}`,borderRadius:10,padding:"12px 14px"}}>
              <div style={{display:"flex",alignItems:"flex-start",gap:10}}>
                <div style={{width:18,height:18,borderRadius:4,border:`2px solid ${tos?C.gold:C.border2}`,background:tos?C.gold:"transparent",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,marginTop:1,cursor:"pointer"}}
                  onClick={()=>tos?setTos(false):(setTosRead(false),setShowTos(true))}>
                  {tos&&<span style={{fontSize:11,fontWeight:900,color:C.bg}}>✓</span>}
                </div>
                <div style={{fontSize:12,color:C.sub,lineHeight:1.6,cursor:"pointer"}} onClick={()=>tos?setTos(false):(setTosRead(false),setShowTos(true))}>
                  I've read and agree to the{" "}
                  <span style={{color:C.gold,textDecoration:"underline"}} onClick={e=>{e.stopPropagation();setTosRead(false);setShowTos(true);}}>Terms of Service</span>
                  {" "}— including no refunds on placed bets
                </div>
              </div>
            </div>
          )}
          {mode==="login"&&(
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16,cursor:"pointer"}} onClick={()=>setRemember(r=>!r)}>
              <div style={{width:18,height:18,borderRadius:4,border:`2px solid ${remember?C.gold:C.border2}`,background:remember?C.gold:"transparent",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,transition:"all 0.15s"}}>
                {remember&&<span style={{fontSize:11,fontWeight:900,color:C.bg}}>✓</span>}
              </div>
              <span style={{fontSize:12,color:C.sub}}>Remember this device — stay logged in</span>
            </div>
          )}
          <button style={{...S.btn,width:"100%",padding:"15px",fontSize:14,opacity:busy?0.55:1}} onClick={mode==="login"?doLogin:doRegister} disabled={busy}>
            {busy?"…":mode==="login"?"SIGN IN":"CREATE ACCOUNT"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
function Main({session,logout,showToast,toast,wc,wcLoading,mlb,mlbLoading}){
  const isAdmin=session.isAdmin;
  const [tab,setTab]=useState("bet");
  const [activeSport,setActiveSport]=useState("soccer");
  const [user,setUser]=useState(isAdmin?{display_name:"Brent",username:"brent",balance:0,cash_in:0,cash_out:0,privacy_public:false,is_admin:true}:null);
  const [bets,setBets]=useState([]); const [allBets,setAllBets]=useState([]);
  const [txs,setTxs]=useState([]);   const [allTxs,setAllTxs]=useState([]);
  const [users,setUsers]=useState([]); const [pendTxs,setPend]=useState([]);
  const [house,setHouse]=useState(null);
  const [loading,setLoading]=useState(!isAdmin);
  const [picks,setPicks]=useState({}); const [cash,setCash]=useState("");
  const [houseCash,setHouseCash]=useState("");
  const [expanded,setExpanded]=useState(null); const [showPw,setShowPw]=useState({});
  const [betNotifs,setBetNotifs]=useState([]);
  const [settleScores,setSettleScores]=useState({});
  const [delConfirm,setDelConfirm]=useState(null);
  const [confirm,setConfirm]=useState(null);

  const load=useCallback(async()=>{
    try{
      if(isAdmin){
        const [u,b,pb,p,a,h,finalScores]=await Promise.all([
          db.allUsers(),db.allBets(),db.pendBets(),db.pendingTxs(),db.allTxs(),db.getHouse(),
          fetchFinalScores() // auto-fetch completed game scores
        ]);
        setUsers((u||[]).filter(x=>!x.is_admin));
        setAllBets(b||[]); setPend(p||[]); setAllTxs(a||[]); setHouse(h?.[0]||null);
        // Auto-fill score field for any pending bet whose game has finished
        setSettleScores(prev=>{
          const auto={};
          (pb||[]).forEach(bet=>{
            if(prev[bet.id]) return; // don't overwrite manually entered scores
            const leg=bet.legs?.[0];
            if(!leg?.matchup) return;
            const [t1,t2]=(leg.matchup||"").split(" vs ").map(s=>s.trim());
            const score=finalScores[`${t1}|${t2}`]||finalScores[`${t2}|${t1}`];
            if(score) auto[bet.id]=score;
          });
          return{...auto,...prev}; // manual entries always win
        });
      }else{
        const [u,b,t,us,ab]=await Promise.all([db.getUser(session.userId),db.myBets(session.userId),db.myTxs(session.userId),db.allUsers(),db.allBets()]);
        if(u?.[0])setUser(u[0]); setBets(b||[]); setTxs(t||[]);
        setUsers((us||[]).filter(x=>!x.is_admin&&x.id!==session.userId));
        setAllBets(ab||[]);
      }
    }catch(e){showToast("Error loading","error");}finally{setLoading(false);}
  },[session.userId,isAdmin]);

  useEffect(()=>{load();},[load]);

  // Check for newly settled bets to show win/loss popup
  useEffect(()=>{
    if(isAdmin||!bets.length)return;
    try{
      const seen=JSON.parse(localStorage.getItem("mfl_notifs")||"[]");
      const unseen=bets.filter(b=>(b.status==="won"||b.status==="lost")&&!seen.includes(b.id));
      if(unseen.length)setBetNotifs(unseen);
    }catch(e){}
  },[bets,isAdmin]);

  const dismissNotif=id=>{
    try{
      const seen=JSON.parse(localStorage.getItem("mfl_notifs")||"[]");
      localStorage.setItem("mfl_notifs",JSON.stringify([...seen,id]));
    }catch(e){}
    setBetNotifs(p=>p.filter(b=>b.id!==id));
  };

  const setPick=(id,team,odds)=>setPicks(p=>{const ex=p[id];if(ex&&ex.team===team){const n={...p};delete n[id];return n;}return{...p,[id]:{team,odds,stake:""}};});
  const setStake=(id,v)=>setPicks(p=>({...p,[id]:{...p[id],stake:v}}));

  const findGame=gid=>[...wc,...mlb].find(x=>x.id===gid);

  const askConfirm=(gid,sport="soccer")=>{
    const pick=picks[gid]; const g=findGame(gid); if(!pick)return;
    const stake=parseFloat(pick.stake);
    if(!stake||stake<1)return showToast("Minimum bet is ₿1","error");
    if(stake>user.balance)return showToast(`You only have ₿${(user.balance||0).toFixed(2)} — can't bet more than your balance`,"error");
    if(user.balance<=0)return showToast("Your balance is ₿0 — deposit first","error");
    setConfirm({gid,team:pick.team,odds:pick.odds,stake,win:calcW(stake,pick.odds),matchup:`${g.t1} vs ${g.t2}`,sport:g?.sport||sport});
  };

  const placeBet=async()=>{
    if(!confirm)return;
    const{gid,team,odds,stake,win,matchup,sport}=confirm; const g=findGame(gid);
    setConfirm(null);
    try{
      await db.patchUser(session.userId,{balance:+(user.balance-stake).toFixed(2)});
      if(house) await db.patchUser(house.id,{balance:+(house.balance+stake).toFixed(2)});
      const eventName=sport==="mlb"?"MLB 2026":"FIFA World Cup 2026";
      await db.addBet({user_id:session.userId,type:"single",stake,potential_win:win,
        legs:[{fighter:team,matchup,odds,fightId:gid,eventDate:g?.dt||null,event:eventName,sport:sport||"soccer"}]});
      setPicks(p=>{const n={...p};delete n[gid];return n;});
      showToast(`Bet placed! To win ₿${win.toFixed(2)}`); await load();
    }catch(e){showToast("Error placing bet","error");}
  };

  // Admin: settle a bet
  const settleBet=async(betId,outcome)=>{
    const bet=allBets.find(b=>b.id===betId);
    const player=users.find(u=>u.id===bet?.user_id);
    if(!bet||!player)return;
    const score=settleScores[betId]||"";
    const updatedLegs=(bet.legs||[]).map(l=>({...l,result:score||null}));
    try{
      await db.patchBet(betId,{status:outcome,legs:updatedLegs});
      if(outcome==="won"){
        const payout=+(bet.stake+bet.potential_win).toFixed(2);
        await db.patchUser(player.id,{balance:+(player.balance+payout).toFixed(2)});
        if(house) await db.patchUser(house.id,{balance:+(house.balance-payout).toFixed(2)});
        showToast(`${player.display_name} paid ₿${payout}`);
      }else{
        showToast(`Bet marked as lost — house keeps ₿${bet.stake}`);
      }
      setSettleScores(p=>{const n={...p};delete n[betId];return n;});
      await load();
    }catch(e){showToast("Error settling bet","error");}
  };

  const reqDep=async()=>{const a=parseFloat(cash);if(!a||a<=0)return showToast("Enter an amount","error");
    try{await db.addTx({user_id:session.userId,type:"deposit",amount:a,status:"pending"});setCash("");showToast("Request sent! Bring cash to Brent.");await load();}catch(e){showToast("Error","error");}
  };
  const reqWith=async()=>{
    const a=parseFloat(cash);
    if(!a||a<=0)return showToast("Enter an amount","error");
    if(a<10)return showToast("Minimum withdrawal is $10","error");
    if(!Number.isInteger(a))return showToast("Must be a whole dollar amount — no cents (e.g. $10, $15, $20)","error");
    const maxWithdraw=Math.floor(user.balance);
    if(maxWithdraw<10)return showToast(`Your balance (₿${(user.balance||0).toFixed(2)}) is too low — minimum withdrawal is $10`,"error");
    if(a>maxWithdraw)return showToast(`Max you can withdraw is $${maxWithdraw} — whole dollars only, cents stay in your account`,"error");
    try{await db.addTx({user_id:session.userId,type:"withdraw",amount:a,status:"pending"});setCash("");showToast(`$${a} withdrawal requested! Go see Brent.`);await load();}catch(e){showToast("Error","error");}
  };
  const togglePrivacy=async()=>{
    try{await db.patchUser(session.userId,{privacy_public:!user.privacy_public});await load();showToast(user.privacy_public?"Stats now private":"Stats now public");}catch(e){}
  };
  const approve=async txId=>{
    const tx=[...allTxs,...pendTxs].find(t=>t.id===txId);const u=users.find(x=>x.id===tx?.user_id);if(!tx||!u)return;
    try{await db.patchTx(txId,{status:"approved"});
      const upd={balance:+(u.balance+(tx.type==="deposit"?tx.amount:0)).toFixed(2)};
      if(tx.type==="deposit"){upd.cash_in=+((u.cash_in||0)+tx.amount).toFixed(2);
        // Deposit: player's balance increases but house already collected stake separately, just track cash_in
      }else{upd.cash_out=+((u.cash_out||0)+tx.amount).toFixed(2);}
      await db.patchUser(u.id,upd);showToast("Approved ✓");await load();
    }catch(e){showToast("Error","error");}
  };
  const reject=async txId=>{
    const tx=[...allTxs,...pendTxs].find(t=>t.id===txId);const u=users.find(x=>x.id===tx?.user_id);if(!tx)return;
    try{await db.patchTx(txId,{status:"rejected"});
      if(tx.type==="withdraw"&&u)await db.patchUser(u.id,{balance:+(u.balance+tx.amount).toFixed(2)});
      showToast("Rejected","error");await load();
    }catch(e){showToast("Error","error");}
  };
  const houseWithdraw=async()=>{
    const a=parseFloat(houseCash);if(!a||a<=0)return showToast("Enter an amount","error");
    if(!house)return showToast("House account not found","error");
    if(a>house.balance)return showToast("Not enough in the pot","error");
    try{
      await db.patchUser(house.id,{balance:+(house.balance-a).toFixed(2),cash_out:+((house.cash_out||0)+a).toFixed(2)});
      await db.addTx({user_id:house.id,type:"withdraw",amount:a,status:"approved",note:"House cash withdrawal"});
      setHouseCash("");showToast(`₿${a} logged — take $${a} from the pot`);await load();
    }catch(e){showToast("Error","error");}
  };
  const doDelete=async uid=>{
    try{await db.deleteUser(uid);setDelConfirm(null);setExpanded(null);showToast("Account deleted");await load();}
    catch(e){showToast("Error deleting","error");}
  };

  if(loading)return<Loader/>;
  if(!user)return<div style={{color:C.text,padding:40,textAlign:"center"}}>Error loading. Refresh.</div>;

  const pnl=bets.reduce((a,b)=>b.status==="won"?a+b.potential_win:b.status==="lost"?a-b.stake:a,0);
  const pending=bets.filter(b=>b.status==="pending").length;
  const byUser={};allBets.forEach(b=>{if(!byUser[b.user_id])byUser[b.user_id]=[];byUser[b.user_id].push(b);});
  const uBets=uid=>allBets.filter(b=>b.user_id===uid);
  const uTxs=uid=>allTxs.filter(t=>t.user_id===uid&&t.user_id!==house?.id);
  const uPnl=uid=>uBets(uid).reduce((a,b)=>b.status==="won"?a+b.potential_win:b.status==="lost"?a-b.stake:a,0);
  const pendBets=allBets.filter(b=>b.status==="pending");
  const totDep=allTxs.filter(t=>t.type==="deposit"&&t.status==="approved"&&t.user_id!==house?.id).reduce((a,t)=>a+t.amount,0);

  const USER_TABS=[
    {id:"bet",    icon:"🏆",label:"Bet"},
    {id:"mybets", icon:"🎯",label:`Bets${pending>0?` (${pending})`:""}`},
    {id:"profile",icon:"👤",label:"Profile"},
  ];
  const ADMIN_TABS=[
    {id:"bet",      icon:"🏆",label:"Bet"},
    {id:"requests", icon:"💵",label:`Money${pendTxs.length>0?` (${pendTxs.length})`:""}`},
    {id:"house",    icon:"💰",label:"House"},
    {id:"users",    icon:"👥",label:"Users"},
  ];
  const TABS=isAdmin?ADMIN_TABS:USER_TABS;

  return(
    <div style={S.root}>
      {toast&&<Toast t={toast}/>}

      {/* CONFIRM BET MODAL */}
      {confirm&&(
        <div style={S.over}>
          <div style={S.modal}>
            <div style={{fontSize:16,fontWeight:800,color:C.text,marginBottom:18}}>Confirm Your Bet</div>
            <div style={{background:C.bg,borderRadius:10,border:`1px solid ${C.border}`,padding:"14px",marginBottom:14}}>
              <div style={{fontSize:10,color:C.dim,fontWeight:700,letterSpacing:"0.06em",marginBottom:6}}>{confirm.sport==="mlb"?"MLB 2026":"FIFA WORLD CUP 2026"}</div>
              <div style={{fontSize:13,color:C.sub,marginBottom:8}}>{confirm.matchup}</div>
              <div style={{fontSize:14,color:C.text,marginBottom:12}}>Pick: <strong style={{color:C.gold,display:"inline-flex",alignItems:"center",gap:5}}><Flag team={confirm.team} size={16}/>{confirm.team}</strong> <span style={{color:C.dim,fontSize:12}}>({fmtO(confirm.odds)})</span></div>
              <div style={{display:"flex",borderRadius:8,overflow:"hidden",border:`1px solid ${C.border}`}}>
                <div style={{flex:1,padding:"10px",background:C.card,textAlign:"center"}}><div style={{fontSize:10,color:C.dim,marginBottom:2}}>STAKE</div><div style={{fontSize:17,fontWeight:800,color:C.text}}>₿{confirm.stake}</div></div>
                <div style={{width:1,background:C.border}}/>
                <div style={{flex:1,padding:"10px",background:C.card,textAlign:"center"}}><div style={{fontSize:10,color:C.dim,marginBottom:2}}>TO WIN</div><div style={{fontSize:17,fontWeight:800,color:C.green}}>₿{confirm.win.toFixed(2)}</div></div>
              </div>
            </div>
            <div style={{background:"#1A0A0A",border:"1px solid #E5393533",borderRadius:10,padding:"12px 14px",marginBottom:18}}>
              <div style={{fontSize:13,color:"#E53935",lineHeight:1.65}}>⚠️ <strong>No refunds.</strong> Once confirmed this bet is final. No cancellations or exceptions.</div>
            </div>
            <button style={{...S.btn,width:"100%",padding:"15px",marginBottom:10}} onClick={placeBet}>CONFIRM — BET ₿{confirm.stake}</button>
            <button style={{...S.ghost,width:"100%",padding:"13px"}} onClick={()=>setConfirm(null)}>Go Back</button>
          </div>
        </div>
      )}

      {/* WIN / LOSS NOTIFICATION POPUP */}
      {betNotifs.length>0&&(()=>{
        const bet=betNotifs[0];
        const leg=bet.legs?.[0];
        const won=bet.status==="won";
        const payout=+(bet.stake+bet.potential_win).toFixed(2);
        return(
          <div style={S.over}>
            <div style={{...S.modal,textAlign:"center"}}>
              <div style={{fontSize:56,marginBottom:8}}>{won?"🏆":"💔"}</div>
              <div style={{fontSize:28,fontWeight:900,color:won?C.green:"#E53935",marginBottom:4}}>
                {won?"YOU WON!":"YOU LOST"}
              </div>
              {won
                ?<div style={{fontSize:22,fontWeight:800,color:C.gold,marginBottom:16}}>+₿{payout.toFixed(2)}</div>
                :<div style={{fontSize:16,color:C.sub,marginBottom:16}}>−₿{bet.stake}</div>}
              <div style={{background:C.bg,borderRadius:12,border:`1px solid ${C.border}`,padding:"14px 16px",marginBottom:16,textAlign:"left"}}>
                <div style={{fontSize:11,color:C.dim,fontWeight:600,letterSpacing:"0.06em",marginBottom:6}}>BET DETAILS</div>
                <div style={{fontSize:13,color:C.sub,marginBottom:4}}>{leg?.matchup}</div>
                <div style={{fontSize:14,color:C.text,marginBottom:leg?.result?8:0}}>
                  Pick: <strong style={{color:C.gold,display:"inline-flex",alignItems:"center",gap:4}}>
                    <Flag team={leg?.fighter} size={14}/>{leg?.fighter}
                  </strong>
                  <span style={{color:C.dim,marginLeft:6}}>({fmtO(leg?.odds)})</span>
                </div>
                {leg?.result&&(
                  <div style={{background:C.card,borderRadius:8,padding:"8px 12px",fontSize:14,fontWeight:700,color:C.text}}>
                    Final Score: {leg.result}
                  </div>
                )}
                <div style={{display:"flex",gap:16,fontSize:12,color:C.dim,marginTop:8,paddingTop:8,borderTop:`1px solid ${C.border}`}}>
                  <span>Staked <strong style={{color:C.text}}>₿{bet.stake}</strong></span>
                  <span>{won?"Profit":"Loss"} <strong style={{color:won?C.green:"#E53935"}}>{won?"+":"-"}₿{won?bet.potential_win.toFixed(2):bet.stake}</strong></span>
                </div>
              </div>
              <button style={{...S.btn,width:"100%",padding:"15px",background:won?C.green:C.gold}} onClick={()=>dismissNotif(bet.id)}>
                {betNotifs.length>1?`Next (${betNotifs.length-1} more)`:"Got it!"}
              </button>
            </div>
          </div>
        );
      })()}
      <header style={S.hdr}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"11px 16px 10px"}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <div style={{width:30,height:30,background:C.card,borderRadius:7,border:`1px solid ${C.border}`,display:"flex",alignItems:"center",justifyContent:"center"}}>
              <span style={{fontSize:18,fontWeight:900,color:C.gold,lineHeight:1}}>₿</span>
            </div>
            <div>
              <div style={{fontSize:13,fontWeight:800,color:C.text,letterSpacing:"0.04em"}}>MFL BETZONE</div>
              {isAdmin&&<div style={{fontSize:9,fontWeight:700,color:"#E53935",letterSpacing:"0.1em"}}>ADMIN</div>}
            </div>
          </div>
          {!isAdmin&&(
            <div style={{background:C.card,border:`1px solid ${C.gold}22`,borderRadius:22,padding:"5px 14px",textAlign:"right"}}>
              <div style={{fontSize:9,fontWeight:700,color:C.gold,letterSpacing:"0.1em"}}>BRENT BUCKS</div>
              <div style={{fontSize:15,fontWeight:900,color:C.text}}>₿{(user.balance||0).toFixed(2)}</div>
            </div>
          )}
          {isAdmin&&(
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <span style={{fontSize:11,fontWeight:700,color:"#E53935",background:"#1A000022",border:"1px solid #E5393533",borderRadius:8,padding:"5px 12px"}}>BRENT</span>
              <button onClick={logout} style={{background:"none",border:`1px solid ${C.border}`,color:C.dim,borderRadius:8,padding:"5px 12px",fontSize:11,fontWeight:600,cursor:"pointer"}}>Sign Out</button>
            </div>
          )}
        </div>
      </header>

      <main style={{padding:"14px 14px 80px"}}>

        {/* ── BET TAB — all sports in one place ── */}
        {tab==="bet"&&(
          <div>
            {/* Sport selector — scrollable pill row, just add more sports here */}
            <div style={{display:"flex",gap:8,overflowX:"auto",paddingBottom:4,marginBottom:16,scrollbarWidth:"none"}}>
              {[
                {id:"soccer",icon:"⚽",label:"World Cup"},
                {id:"mlb",   icon:"⚾",label:"MLB"},
                {id:"ufc",   icon:"🥊",label:"UFC",  soon:true},
                {id:"nfl",   icon:"🏈",label:"NFL",  soon:true},
                {id:"nba",   icon:"🏀",label:"NBA",  soon:true},
              ].map(s=>(
                <button key={s.id} onClick={()=>setActiveSport(s.id)}
                  style={{flexShrink:0,borderRadius:20,padding:"8px 16px",border:`1px solid ${activeSport===s.id&&!s.soon?C.gold:C.border}`,background:activeSport===s.id&&!s.soon?C.gold:C.card,color:activeSport===s.id&&!s.soon?C.bg:s.soon?C.dim:C.text,cursor:"pointer",display:"flex",alignItems:"center",gap:6,fontSize:13,fontWeight:700,whiteSpace:"nowrap"}}>
                  <span>{s.icon}</span><span>{s.label}</span>
                  {s.soon&&<span style={{fontSize:9,fontWeight:700,background:"#FF980022",color:"#FF9800",border:"1px solid #FF980033",borderRadius:3,padding:"1px 5px"}}>SOON</span>}
                </button>
              ))}
            </div>

            {/* Coming soon for inactive sports */}
            {["ufc","nfl","nba"].includes(activeSport)&&(
              <div style={{textAlign:"center",padding:"52px 20px"}}>
                <div style={{fontSize:48,marginBottom:14}}>{activeSport==="ufc"?"🥊":activeSport==="nfl"?"🏈":"🏀"}</div>
                <div style={{fontSize:18,fontWeight:800,color:C.text,marginBottom:6}}>{activeSport==="ufc"?"UFC Betting":activeSport==="nfl"?"NFL Betting":"NBA Betting"}</div>
                <div style={{fontSize:13,color:C.dim}}>{activeSport==="nfl"?"Season kicks off Fall 2026":activeSport==="nba"?"Season starts Fall 2026":"Next card TBD — check back soon"}</div>
              </div>
            )}

            {/* ── WORLD CUP ── */}
            {activeSport==="soccer"&&(
            <div>
            <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:"10px 14px",marginBottom:14,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <span style={{width:7,height:7,borderRadius:"50%",background:C.green,display:"inline-block",flexShrink:0}}/>
                <span style={{fontSize:11,fontWeight:700,color:C.green,letterSpacing:"0.04em"}}>
                  {ODDS_API_KEY ? "LIVE ODDS — THE ODDS API" : wc.some(g=>g.usingRealOdds) ? "LIVE ODDS — ESPN BET" : "ODDS — FIFA WORLD CUP 2026"}
                </span>
              </div>
              <span style={{fontSize:10,color:C.dim}}>updates every 2 min · All times ET</span>
            </div>
            {wcLoading?(
              <div style={{textAlign:"center",padding:"44px",color:C.dim}}><div style={{fontSize:28,marginBottom:8}}>⚽</div><div style={{fontSize:13}}>Loading odds…</div></div>
            ):wc.length===0?<Empty icon="📅" title="No games today" sub="Check back on matchdays — odds update every 2 min when games are scheduled"/>
            :wc.map(g=>{
              const pick=picks[g.id];
              const stake=parseFloat(pick?.stake)||0;
              const payout=stake&&pick?calcW(stake,pick.odds):0;
              const closed=isClosed(g.dt);
              const isLive=g.isLive||false;
              return(
                <div key={g.id} style={{...S.card,marginBottom:12}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
                    <div>
                      <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:2}}>
                        {isLive&&<span style={{fontSize:9,fontWeight:800,letterSpacing:"0.08em",background:"#E5393518",color:"#E53935",border:"1px solid #E5393533",borderRadius:4,padding:"2px 6px"}}>🔴 LIVE</span>}
                        <span style={{fontSize:10,fontWeight:700,color:C.gold,letterSpacing:"0.04em"}}>FIFA WORLD CUP 2026</span>
                      </div>
                      <div style={{fontSize:10,color:C.dim}}>{g.rnd}</div>
                    </div>
                    <div style={{fontSize:10,color:C.dim,textAlign:"right"}}>{fmtDt(g.dt)}</div>
                  </div>
                  {closed&&(
                    <div style={{background:"#120808",border:"1px solid #E5393522",borderRadius:7,padding:"6px 12px",fontSize:11,color:"#E53935",fontWeight:600,textAlign:"center",marginBottom:10}}>
                      {isLive?"⚽ Game in progress — odds shown, no new bets":"🔒 Betting closes 3 min before kickoff"}
                    </div>
                  )}
                  {/* LIVE SCORE */}
                  {isLive&&g.score&&(
                    <div style={{background:"#091509",border:`1px solid ${C.green}44`,borderRadius:8,padding:"10px 14px",marginBottom:10,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                      <div style={{display:"flex",alignItems:"center",gap:6,fontSize:17,fontWeight:900,color:C.text}}>
                        <Flag team={g.t1} size={18}/>&nbsp;{g.score.home}
                        <span style={{color:C.dim,fontSize:13,fontWeight:400,margin:"0 4px"}}>—</span>
                        {g.score.away}&nbsp;<Flag team={g.t2} size={18}/>
                      </div>
                      <div style={{fontSize:11,fontWeight:700,color:C.green,background:"#00E67618",padding:"3px 10px",borderRadius:5,letterSpacing:"0.04em"}}>
                        {g.period||g.clock||"● LIVE"}
                      </div>
                    </div>
                  )}
                  <div style={{display:"flex",gap:5}}>
                    <button disabled={isAdmin||closed} onClick={()=>setPick(g.id,g.t1,g.o1)} style={{...S.fBtn,flex:1,...(pick?.team===g.t1?S.fBtnOn:{}),cursor:isAdmin||closed?"not-allowed":"pointer"}}>
                      <Flag team={g.t1} size={26}/>
                      <span style={{fontSize:11,fontWeight:700,color:C.text,textAlign:"center",lineHeight:1.2}}>{g.t1}</span>
                      <span style={{fontSize:13,fontWeight:900,color:g.o1<0?"#FF6B35":C.green}}>{fmtO(g.o1)}</span>
                    </button>
                    <button disabled={isAdmin||closed} onClick={()=>setPick(g.id,"Draw",g.oDraw)} style={{...S.fBtn,flex:0.72,...(pick?.team==="Draw"?{...S.fBtnOn,background:"#151525"}:{}),cursor:isAdmin||closed?"not-allowed":"pointer"}}>
                      <span style={{fontSize:17}}>⚖️</span>
                      <span style={{fontSize:10,fontWeight:700,color:C.dim}}>DRAW</span>
                      <span style={{fontSize:13,fontWeight:900,color:C.sub}}>{fmtO(g.oDraw)}</span>
                    </button>
                    <button disabled={isAdmin||closed} onClick={()=>setPick(g.id,g.t2,g.o2)} style={{...S.fBtn,flex:1,...(pick?.team===g.t2?S.fBtnOn:{}),cursor:isAdmin||closed?"not-allowed":"pointer"}}>
                      <Flag team={g.t2} size={26}/>
                      <span style={{fontSize:11,fontWeight:700,color:C.text,textAlign:"center",lineHeight:1.2}}>{g.t2}</span>
                      <span style={{fontSize:13,fontWeight:900,color:g.o2<0?"#FF6B35":C.green}}>{fmtO(g.o2)}</span>
                    </button>
                  </div>
                  {isAdmin&&<div style={{fontSize:10,color:C.dim,textAlign:"center",marginTop:8}}>Admin view — betting disabled</div>}
                  {pick&&!isAdmin&&!closed&&(
                    <div style={{marginTop:12,background:C.bg,borderRadius:10,border:`1px solid ${C.gold}22`,padding:"12px"}}>
                      <div style={{fontSize:12,color:C.dim,marginBottom:10}}>
                        <strong style={{color:C.gold}}>{betLabel(pick.team)}</strong><span style={{color:C.dim,marginLeft:4}}>({fmtO(pick.odds)})</span>
                      </div>
                      <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:10}}>
                        <div style={{...S.stakeW,flex:1}}>
                          <span style={{fontSize:14,fontWeight:700,color:C.gold,marginRight:5}}>₿</span>
                          <input style={S.stakeInp} type="number" placeholder="min ₿1" value={pick.stake} onChange={e=>setStake(g.id,e.target.value)} min="1" step="0.01"/>
                        </div>
                        <div style={{textAlign:"right",minWidth:70}}>
                          <div style={{fontSize:10,color:C.dim}}>TO WIN</div>
                          <div style={{fontSize:14,fontWeight:800,color:C.green}}>₿{payout.toFixed(2)}</div>
                        </div>
                      </div>
                      <button style={{...S.btn,width:"100%",padding:"13px"}} onClick={()=>askConfirm(g.id)}>PLACE BET</button>
                    </div>
                  )}
                </div>
              );
            })}
            {/* No more coming soon cards here — they're in the sport selector above */}
            </div>)}

            {/* ── MLB ── */}
            {activeSport==="mlb"&&(
            <div>
            <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:"10px 14px",marginBottom:14,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <span style={{width:7,height:7,borderRadius:"50%",background:"#C9102B",display:"inline-block",flexShrink:0}}/>
                <span style={{fontSize:11,fontWeight:700,color:"#C9102B",letterSpacing:"0.04em"}}>
                  {mlb.some(g=>g.usingRealOdds)?"LIVE ODDS — ESPN BET":"MLB 2026 — MONEYLINES"}
                </span>
              </div>
              <span style={{fontSize:10,color:C.dim}}>2-way · All times ET</span>
            </div>
            {mlbLoading?<div style={{textAlign:"center",padding:"44px",color:C.dim}}><div style={{fontSize:28,marginBottom:8}}>⚾</div><div style={{fontSize:13}}>Loading MLB games…</div></div>
            :mlb.length===0?<Empty icon="⚾" title="No MLB games today" sub="Check back tomorrow — games update automatically"/>
            :mlb.map(g=>{
              const pick=picks[g.id];
              const stake=parseFloat(pick?.stake)||0;
              const payout=stake&&pick?calcW(stake,pick.odds):0;
              const closed=isClosed(g.dt);
              const isLive=g.isLive||false;
              return(
                <div key={g.id} style={{...S.card,marginBottom:12}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
                    <div>
                      <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:2}}>
                        {isLive&&<span style={{fontSize:9,fontWeight:800,background:"#E5393518",color:"#E53935",border:"1px solid #E5393533",borderRadius:4,padding:"2px 6px"}}>🔴 LIVE</span>}
                        <span style={{fontSize:10,fontWeight:700,color:"#C9102B",letterSpacing:"0.04em"}}>MLB 2026</span>
                        {g.usingRealOdds&&<span style={{fontSize:9,fontWeight:600,color:C.green}}>ESPN ✓</span>}
                      </div>
                      <div style={{fontSize:10,color:C.dim}}>{fmtDt(g.dt)}</div>
                    </div>
                    <div style={{fontSize:10,color:C.dim,textAlign:"right"}}>{g.t2} @ {g.t1}</div>
                  </div>
                  {closed&&<div style={{background:"#120808",border:"1px solid #E5393522",borderRadius:7,padding:"6px 12px",fontSize:11,color:"#E53935",fontWeight:600,textAlign:"center",marginBottom:10}}>
                    {isLive?"⚾ Game in progress — odds shown, no new bets":"🔒 Betting closed"}
                  </div>}
                  {isLive&&g.score&&(
                    <div style={{background:"#091509",border:`1px solid ${C.green}44`,borderRadius:8,padding:"10px 14px",marginBottom:10,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                      <div style={{display:"flex",alignItems:"center",gap:8,fontSize:17,fontWeight:900,color:C.text}}>
                        <MLBLogo abbr={g.abbr1} size={18}/>&nbsp;{g.score.home}
                        <span style={{color:C.dim,fontSize:13,fontWeight:400,margin:"0 4px"}}>—</span>
                        {g.score.away}&nbsp;<MLBLogo abbr={g.abbr2} size={18}/>
                      </div>
                      <div style={{fontSize:11,fontWeight:700,color:C.green,background:"#00E67618",padding:"3px 10px",borderRadius:5}}>{g.period||"● LIVE"}</div>
                    </div>
                  )}
                  {/* 2-way moneyline — no draw in baseball */}
                  <div style={{display:"flex",gap:8}}>
                    <button disabled={isAdmin||closed} onClick={()=>setPick(g.id,g.t1,g.o1)} style={{...S.fBtn,flex:1,...(pick?.team===g.t1?S.fBtnOn:{}),cursor:isAdmin||closed?"not-allowed":"pointer"}}>
                      <MLBLogo abbr={g.abbr1} size={30}/>
                      <span style={{fontSize:11,fontWeight:700,color:C.text,textAlign:"center",lineHeight:1.2}}>{g.t1}</span>
                      <span style={{fontSize:14,fontWeight:900,color:g.o1<0?"#FF6B35":C.green}}>{fmtO(g.o1)}</span>
                    </button>
                    <button disabled={isAdmin||closed} onClick={()=>setPick(g.id,g.t2,g.o2)} style={{...S.fBtn,flex:1,...(pick?.team===g.t2?S.fBtnOn:{}),cursor:isAdmin||closed?"not-allowed":"pointer"}}>
                      <MLBLogo abbr={g.abbr2} size={30}/>
                      <span style={{fontSize:11,fontWeight:700,color:C.text,textAlign:"center",lineHeight:1.2}}>{g.t2}</span>
                      <span style={{fontSize:14,fontWeight:900,color:g.o2<0?"#FF6B35":C.green}}>{fmtO(g.o2)}</span>
                    </button>
                  </div>
                  {isAdmin&&<div style={{fontSize:10,color:C.dim,textAlign:"center",marginTop:8}}>Admin view — betting disabled</div>}
                  {pick&&!isAdmin&&!closed&&(
                    <div style={{marginTop:12,background:C.bg,borderRadius:10,border:`1px solid ${C.gold}22`,padding:"12px"}}>
                      <div style={{fontSize:12,color:C.dim,marginBottom:10}}>
                        <strong style={{color:C.gold}}>{pick.team}</strong><span style={{color:C.dim,marginLeft:4}}>({fmtO(pick.odds)})</span>
                      </div>
                      <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:10}}>
                        <div style={{...S.stakeW,flex:1}}>
                          <span style={{fontSize:14,fontWeight:700,color:C.gold,marginRight:5}}>₿</span>
                          <input style={S.stakeInp} type="number" placeholder="min ₿1" value={pick.stake} onChange={e=>setStake(g.id,e.target.value)} min="1" step="0.01"/>
                        </div>
                        <div style={{textAlign:"right",minWidth:70}}>
                          <div style={{fontSize:10,color:C.dim}}>TO WIN</div>
                          <div style={{fontSize:14,fontWeight:800,color:C.green}}>₿{payout.toFixed(2)}</div>
                        </div>
                      </div>
                      <button style={{...S.btn,width:"100%",padding:"13px"}} onClick={()=>askConfirm(g.id,"mlb")}>PLACE BET</button>
                    </div>
                  )}
                </div>
              );
            })}
            {/* ← end MLB */}
            </div>)}

          </div>
        )}
        {/* ← end Bet tab */}

        {/* ── MY BETS (user) ── */}
        {tab==="mybets"&&!isAdmin&&(
          <div>
            <ST title="My Bets" sub="All bets are final — no refunds"/>
            {bets.length===0?<Empty icon="🎯" title="No bets yet" sub="Head to Soccer to place a bet"/>
            :bets.map(bet=>(
              <div key={bet.id} style={{...S.card,marginBottom:10}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                  <div style={{display:"flex",gap:6,alignItems:"center"}}><span style={S.badge}>SINGLE</span><span style={{fontSize:12}}>{bet.legs?.[0]?.sport==="mlb"?"⚾":"⚽"}</span><span style={{fontSize:10,color:C.dim}}>{fmtDate(bet.placed_at)}</span></div>
                  <SPill s={bet.status}/>
                </div>
                {bet.legs?.map((l,i)=>(
                  <div key={i} style={{fontSize:13,color:C.sub,marginBottom:3,display:"flex",alignItems:"center",gap:5,flexWrap:"wrap"}}>
                    <span style={{color:C.dim}}>{l.matchup}</span>
                    <span style={{color:C.text}}>→</span>
                    <Flag team={l.fighter} size={14}/>
                    <strong style={{color:C.gold}}>{l.fighter}</strong>
                    <span style={{color:C.dim}}>({fmtO(l.odds)})</span>
                  </div>
                ))}
                <div style={{display:"flex",gap:16,fontSize:12,color:C.dim,marginTop:10,paddingTop:8,borderTop:`1px solid ${C.border}`}}>
                  <span>Stake <strong style={{color:C.text}}>₿{bet.stake}</strong></span>
                  <span>To win <strong style={{color:C.green}}>₿{(bet.potential_win||0).toFixed(2)}</strong></span>
                </div>
              </div>
            ))}
            {/* Parlays coming soon */}
            <div style={{...S.card,marginTop:10,display:"flex",alignItems:"center",gap:14,padding:"14px 16px",opacity:0.7}}>
              <span style={{fontSize:24}}>🔗</span>
              <div style={{flex:1}}>
                <div style={{fontSize:13,fontWeight:800,color:C.text}}>Parlay Bets</div>
                <div style={{fontSize:11,color:C.dim,marginTop:1}}>Combine multiple picks for a bigger payout</div>
              </div>
              <span style={{fontSize:8,fontWeight:700,letterSpacing:"0.08em",padding:"3px 8px",borderRadius:5,background:"#FF980018",color:"#FF9800",border:"1px solid #FF980033",whiteSpace:"nowrap"}}>COMING SOON</span>
            </div>
          </div>
        )}
        {tab==="profile"&&!isAdmin&&(
          <div>
            <div style={{textAlign:"center",padding:"22px 14px 18px",background:C.card,borderRadius:14,border:`1px solid ${C.border}`,marginBottom:14}}>
              <Av name={user.display_name} size={56} style={{margin:"0 auto 10px"}}/>
              <div style={{fontSize:17,fontWeight:800,color:C.text,marginBottom:2}}>{user.display_name}</div>
              <div style={{fontSize:11,color:C.dim,marginBottom:12}}>@{user.username}</div>
              <div style={{fontSize:32,fontWeight:900,color:C.gold}}>₿{(user.balance||0).toFixed(2)}</div>
              <div style={{fontSize:10,fontWeight:700,letterSpacing:"0.12em",color:C.dim,marginTop:4}}>BRENT BUCKS · $1 = ₿1</div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}>
              {[{l:"Deposited",v:`₿${(user.cash_in||0).toFixed(2)}`},{l:"P&L",v:`${pnl>=0?"+":""}₿${pnl.toFixed(2)}`,c:pnl>=0?C.green:"#FF5252"},{l:"Total Bets",v:bets.length},{l:"Wins",v:bets.filter(b=>b.status==="won").length}].map(c=>(
                <div key={c.l} style={{...S.card,textAlign:"center"}}><div style={{fontSize:19,fontWeight:800,color:c.c||C.text,marginBottom:4}}>{c.v}</div><div style={{fontSize:10,fontWeight:600,color:C.dim,letterSpacing:"0.06em"}}>{c.l}</div></div>
              ))}
            </div>
            <div style={{...S.card,display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
              <div><div style={{fontSize:13,fontWeight:700,color:C.text}}>Stats Visibility</div><div style={{fontSize:11,color:C.dim,marginTop:2}}>{user.privacy_public?"Friends can see your stats":"Hidden from friends"}</div></div>
              <button onClick={togglePrivacy} style={{...S.btn,background:"transparent",border:`1px solid ${user.privacy_public?C.green+"44":C.gold+"44"}`,color:user.privacy_public?C.green:C.gold,fontSize:11,padding:"9px 13px",whiteSpace:"nowrap"}}>
                {user.privacy_public?"🟢 Public":"🔴 Private"}
              </button>
            </div>
            <div style={{...S.card,marginBottom:10}}>
              <div style={{fontSize:14,fontWeight:800,color:C.text,marginBottom:12}}>💵 Cash In / Withdraw</div>
              <div style={{background:C.bg,borderRadius:10,border:`1px solid ${C.border}`,padding:"11px 13px",fontSize:12,color:C.sub,lineHeight:1.75,marginBottom:12}}>
                <strong style={{color:C.gold}}>Deposit:</strong> Enter amount → Request → bring cash to Brent.<br/>
                <strong style={{color:C.gold}}>Withdraw:</strong> Minimum $10 · whole dollars only · go see Brent to collect.<br/>
                <span style={{color:C.dim}}>$1 USD = ₿1 · Minimum bet ₿1 · No refunds on bets</span>
              </div>
              <div style={{...S.stakeW,marginBottom:10}}>
                <span style={{fontSize:14,fontWeight:700,color:C.gold,marginRight:5}}>$</span>
                <input style={S.stakeInp} type="number" placeholder="whole dollars only (min $10)" value={cash} onChange={e=>setCash(e.target.value)} min="10" step="1"/>
              </div>
              <div style={{display:"flex",gap:8}}>
                <button style={{...S.btn,flex:1,padding:"13px"}} onClick={reqDep}>REQUEST DEPOSIT</button>
                <button style={{...S.btn,flex:1,padding:"13px",background:"transparent",border:"1px solid #E5393555",color:"#E53935"}} onClick={reqWith}>REQUEST WITHDRAW</button>
              </div>
              {txs.filter(t=>t.status==="pending").length>0&&<div style={{marginTop:10,fontSize:12,color:C.gold,background:"#0D0900",borderRadius:8,padding:"8px 12px"}}>⏳ {txs.filter(t=>t.status==="pending").length} request{txs.filter(t=>t.status==="pending").length>1?"s":""} pending</div>}
              <div style={{marginTop:12,paddingTop:12,borderTop:`1px solid ${C.border}`,opacity:0.5}}>
                <div style={{fontSize:9,fontWeight:700,color:C.dim,letterSpacing:"0.1em",marginBottom:8}}>COMING SOON</div>
                <div style={{display:"flex",alignItems:"center",gap:12,background:C.bg,border:`1px solid ${C.border}`,borderRadius:10,padding:"11px 13px"}}>
                  <span style={{fontSize:20}}>🍎</span>
                  <div><div style={{fontSize:13,fontWeight:700,color:C.text}}>Apple Pay</div><div style={{fontSize:11,color:C.dim,marginTop:1}}>Instant deposits & withdrawals</div></div>
                </div>
              </div>
            </div>
            {txs.length>0&&(
              <div style={{...S.card,marginBottom:10}}>
                <RL label="TRANSACTION HISTORY"/>
                {txs.map(tx=>(
                  <div key={tx.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"9px 0",borderBottom:`1px solid ${C.border}`}}>
                    <div><div style={{fontSize:13,fontWeight:700,color:C.text}}>{tx.type==="deposit"?"💵 Deposit":"💸 Withdrawal"}</div><div style={{fontSize:10,color:C.dim,marginTop:1}}>{fmtDate(tx.created_at)}</div></div>
                    <div style={{display:"flex",gap:8,alignItems:"center"}}>
                      <span style={{fontSize:13,fontWeight:800,color:tx.type==="deposit"?C.green:"#FF6B35"}}>{tx.type==="deposit"?"+":"−"}₿{tx.amount.toFixed(2)}</span>
                      <SPill s={tx.status}/>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {/* Friends / The Group */}
            {users.length>0&&(
              <div>
                <div style={{fontSize:15,fontWeight:800,color:C.text,marginBottom:4,marginTop:4}}>The Group</div>
                <div style={{fontSize:11,color:C.dim,marginBottom:12}}>{users.length} player{users.length!==1?"s":""} on MFL Betzone</div>
                {users.map(p=>{
                  const pb=byUser[p.id]||[];
                  const pp=pb.reduce((a,b)=>b.status==="won"?a+b.potential_win:b.status==="lost"?a-b.stake:a,0);
                  const open=expanded===p.id;
                  return(
                    <div key={p.id} style={{...S.card,marginBottom:8}}>
                      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",cursor:"pointer",minHeight:44}} onClick={()=>setExpanded(open?null:p.id)}>
                        <div style={{display:"flex",alignItems:"center",gap:10}}>
                          <Av name={p.display_name} size={38}/>
                          <div><div style={{fontSize:14,fontWeight:700,color:C.text}}>{p.display_name}</div><div style={{fontSize:11,color:C.dim}}>@{p.username} · {pb.length} bet{pb.length!==1?"s":""}</div></div>
                        </div>
                        <span style={{color:C.dim,fontSize:12}}>{open?"▲":"▼"}</span>
                      </div>
                      {open&&(
                        <div style={{marginTop:10,borderTop:`1px solid ${C.border}`,paddingTop:10}}>
                          {p.privacy_public?(
                            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
                              {[{l:"Deposited",v:`₿${(p.cash_in||0).toFixed(2)}`},{l:"Withdrawn",v:`₿${(p.cash_out||0).toFixed(2)}`},{l:"P&L",v:`${pp>=0?"+":""}₿${pp.toFixed(2)}`,c:pp>=0?C.green:"#FF5252"}].map(s=>(
                                <div key={s.l} style={{background:C.bg,borderRadius:8,padding:"9px",textAlign:"center"}}>
                                  <div style={{fontSize:12,fontWeight:800,color:s.c||C.text}}>{s.v}</div>
                                  <div style={{fontSize:9,color:C.dim,marginTop:2}}>{s.l}</div>
                                </div>
                              ))}
                            </div>
                          ):<div style={{textAlign:"center",padding:"8px",color:C.dim,fontSize:12}}>🔒 Stats private</div>}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            <button style={{...S.ghost,width:"100%",padding:"14px",marginTop:14}} onClick={logout}>Sign Out</button>
          </div>
        )}

        {/* ── ADMIN: MONEY (requests) ── */}
        {tab==="requests"&&isAdmin&&(
          <div>
            <ST title="Pending Requests" sub={pendTxs.length>0?`${pendTxs.length} need action`:"All clear"}/>
            {pendTxs.length===0?<div style={{...S.card,textAlign:"center",padding:"22px",color:C.dim,marginBottom:16}}>✓ No pending requests</div>
            :pendTxs.map(tx=>{const u=users.find(x=>x.id===tx.user_id);return(
              <div key={tx.id} style={{...S.card,border:`1px solid ${C.gold}22`,marginBottom:10}}>
                <div style={{fontSize:15,fontWeight:800,color:C.text,marginBottom:4}}>{tx.type==="deposit"?"💵 Deposit":"💸 Withdrawal"}</div>
                <div style={{fontSize:14,color:C.sub,marginBottom:8}}><strong style={{color:C.gold}}>{u?.display_name||"?"}</strong> · <strong style={{color:C.text}}>₿{tx.amount.toFixed(2)}</strong><span style={{color:C.dim,marginLeft:8}}>{fmtDate(tx.created_at)}</span></div>
                <div style={{fontSize:12,color:C.sub,background:C.bg,borderRadius:8,padding:"8px 12px",marginBottom:12}}>
                  {tx.type==="deposit"?`⚠️ Confirm you received $${tx.amount.toFixed(2)} cash from ${u?.display_name}`:`⚠️ Hand $${tx.amount.toFixed(2)} cash to ${u?.display_name}`}
                </div>
                <div style={{display:"flex",gap:8}}>
                  <button style={{...S.btn,flex:1,padding:"13px",background:"#00C853"}} onClick={()=>approve(tx.id)}>✓ APPROVE</button>
                  <button style={{...S.btn,flex:1,padding:"13px",background:"#E53935"}} onClick={()=>reject(tx.id)}>✕ REJECT</button>
                </div>
              </div>
            );})}
            {allTxs.filter(t=>t.status!=="pending"&&t.user_id!==house?.id).length>0&&(
              <>
                <ST title="Recent History" style={{marginTop:20}}/>
                {allTxs.filter(t=>t.status!=="pending"&&t.user_id!==house?.id).slice(0,15).map(tx=>{const u=users.find(x=>x.id===tx.user_id);return(
                  <div key={tx.id} style={{...S.card,display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                    <div><span style={{fontSize:13,fontWeight:700,color:C.text}}>{tx.type==="deposit"?"💵":"💸"} {u?.display_name||"?"}</span><div style={{fontSize:10,color:C.dim}}>{fmtDate(tx.created_at)}</div></div>
                    <div style={{display:"flex",gap:8,alignItems:"center"}}><span style={{fontSize:13,fontWeight:800,color:tx.type==="deposit"?C.green:"#FF6B35"}}>{tx.type==="deposit"?"+":"−"}₿{tx.amount.toFixed(2)}</span><SPill s={tx.status}/></div>
                  </div>
                );})}
              </>
            )}
          </div>
        )}

        {/* ── ADMIN: HOUSE (profit dashboard + settle bets) ── */}
        {tab==="house"&&isAdmin&&(
          <div>
            {/* House balance card */}
            <div style={{...S.card,marginBottom:14,border:`1px solid ${C.gold}33`}}>
              <div style={{fontSize:11,fontWeight:700,color:C.gold,letterSpacing:"0.08em",marginBottom:12}}>HOUSE ACCOUNT — YOUR POT</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:14}}>
                <div style={{background:C.bg,borderRadius:10,padding:"12px",textAlign:"center"}}>
                  <div style={{fontSize:10,color:C.dim,marginBottom:4}}>CURRENT POT</div>
                  <div style={{fontSize:20,fontWeight:900,color:C.gold}}>₿{(house?.balance||0).toFixed(2)}</div>
                  <div style={{fontSize:9,color:C.dim,marginTop:2}}>cash in pot now</div>
                </div>
                <div style={{background:C.bg,borderRadius:10,padding:"12px",textAlign:"center"}}>
                  <div style={{fontSize:10,color:C.dim,marginBottom:4}}>WITHDRAWN</div>
                  <div style={{fontSize:20,fontWeight:900,color:C.green}}>₿{(house?.cash_out||0).toFixed(2)}</div>
                  <div style={{fontSize:9,color:C.dim,marginTop:2}}>profit pocketed</div>
                </div>
                <div style={{background:C.bg,borderRadius:10,padding:"12px",textAlign:"center"}}>
                  <div style={{fontSize:10,color:C.dim,marginBottom:4}}>TOTAL EARNED</div>
                  <div style={{fontSize:20,fontWeight:900,color:C.gold}}>₿{((house?.balance||0)+(house?.cash_out||0)).toFixed(2)}</div>
                  <div style={{fontSize:9,color:C.dim,marginTop:2}}>pot + withdrawn</div>
                </div>
              </div>
              <div style={{fontSize:11,color:C.sub,background:C.bg,borderRadius:8,padding:"10px 12px",marginBottom:14,lineHeight:1.8}}>
                <strong style={{color:C.gold}}>How it works:</strong> Every bet placed adds to the pot. Every winning payout reduces it. The 10% vig is built into the odds — so the house naturally keeps ~9¢ per $1 wagered on balanced action. Pot + Withdrawn = your total profit all time.
              </div>
              <div style={{...S.stakeW,marginBottom:10}}>
                <span style={{fontSize:14,fontWeight:700,color:C.gold,marginRight:5}}>$</span>
                <input style={S.stakeInp} type="number" placeholder="Amount to withdraw from pot" value={houseCash} onChange={e=>setHouseCash(e.target.value)} min="0"/>
              </div>
              <button style={{...S.btn,width:"100%",padding:"13px"}} onClick={houseWithdraw}>LOG CASH WITHDRAWAL</button>
            </div>

            {/* Settle pending bets */}
            <ST title="Settle Bets" sub={`${pendBets.length} pending bets — mark won or lost after each game`}/>
            {pendBets.length===0?<div style={{...S.card,textAlign:"center",padding:"20px",color:C.dim,marginBottom:14}}>No pending bets to settle</div>
            :pendBets.map(bet=>{
              const player=users.find(u=>u.id===bet.user_id);
              return(
                <div key={bet.id} style={{...S.card,marginBottom:10,border:`1px solid ${C.border}`}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
                    <div><div style={{fontSize:12,color:C.gold,fontWeight:600}}>{player?.display_name||"?"}</div><div style={{fontSize:10,color:C.dim}}>{fmtDate(bet.placed_at)}</div></div>
                    <SPill s={bet.status}/>
                  </div>
                  {bet.legs?.map((l,i)=>(
                    <div key={i} style={{fontSize:13,color:C.sub,marginBottom:3}}>
                      {l.matchup} → <strong style={{color:C.gold}}>{betLabel(l.fighter)}</strong>
                    </div>
                  ))}
                  <div style={{display:"flex",gap:12,fontSize:12,color:C.dim,margin:"8px 0 10px",paddingTop:8,borderTop:`1px solid ${C.border}`}}>
                    <span>Stake <strong style={{color:C.text}}>₿{bet.stake}</strong></span>
                    <span>Payout if won <strong style={{color:C.green}}>₿{+(bet.stake+bet.potential_win).toFixed(2)}</strong></span>
                  </div>
                  {/* Score — auto-fetched from ESPN when available, editable */}
                  <div style={{position:"relative",marginBottom:8}}>
                    <input
                      style={{...S.inp,fontSize:13,padding:"9px 12px",paddingRight:settleScores[bet.id]?"80px":"12px"}}
                      placeholder="Final score (auto-fills from ESPN when game ends)"
                      value={settleScores[bet.id]||""}
                      onChange={e=>setSettleScores(p=>({...p,[bet.id]:e.target.value}))}
                    />
                    {settleScores[bet.id]&&<span style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",fontSize:9,fontWeight:700,color:C.green,letterSpacing:"0.06em"}}>AUTO ✓</span>}
                  </div>
                  <div style={{display:"flex",gap:8}}>
                    <button style={{...S.btn,flex:1,padding:"11px",background:"#00C853"}} onClick={()=>settleBet(bet.id,"won")}>🏆 WON — Pay ₿{+(bet.stake+bet.potential_win).toFixed(2)}</button>
                    <button style={{...S.btn,flex:1,padding:"11px",background:"#555"}} onClick={()=>settleBet(bet.id,"lost")}>❌ LOST</button>
                  </div>
                </div>
              );
            })}

            {/* House tx history */}
            {allTxs.filter(t=>t.user_id===house?.id).length>0&&(
              <>
                <ST title="Withdrawal History" style={{marginTop:20}}/>
                {allTxs.filter(t=>t.user_id===house?.id).slice(0,10).map(tx=>(
                  <div key={tx.id} style={{...S.card,display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                    <div><div style={{fontSize:13,fontWeight:700,color:C.text}}>💸 Took from pot</div><div style={{fontSize:10,color:C.dim}}>{fmtDate(tx.created_at)}</div></div>
                    <span style={{fontSize:14,fontWeight:800,color:"#FF6B35"}}>−₿{tx.amount.toFixed(2)}</span>
                  </div>
                ))}
              </>
            )}
          </div>
        )}

        {/* ── ADMIN: USERS ── */}
        {tab==="users"&&isAdmin&&(
          <div>
            <ST title="All Accounts" sub={`${users.length} registered players`}/>
            {users.length===0?<div style={{...S.card,textAlign:"center",padding:"20px",color:C.dim}}>No players yet</div>
            :users.map(u=>{
              const open=expanded===u.id; const ub=uBets(u.id); const ut=uTxs(u.id); const up=uPnl(u.id);
              return(
                <div key={u.id} style={{...S.card,marginBottom:10}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer",minHeight:48}} onClick={()=>setExpanded(open?null:u.id)}>
                    <div style={{display:"flex",alignItems:"center",gap:10}}>
                      <Av name={u.display_name} size={36}/>
                      <div><div style={{fontSize:14,fontWeight:700,color:C.text}}>{u.display_name}</div><div style={{fontSize:11,color:C.dim}}>@{u.username} · {ub.length} bet{ub.length!==1?"s":""}</div></div>
                    </div>
                    <div style={{display:"flex",alignItems:"center",gap:10}}>
                      <div style={{textAlign:"right"}}><div style={{fontSize:14,fontWeight:800,color:C.gold}}>₿{(u.balance||0).toFixed(2)}</div><div style={{fontSize:10,color:up>=0?C.green:"#FF5252"}}>{up>=0?"+":""}₿{up.toFixed(2)} P&L</div></div>
                      <span style={{color:C.dim,fontSize:12}}>{open?"▲":"▼"}</span>
                    </div>
                  </div>
                  {open&&(
                    <div style={{marginTop:14,borderTop:`1px solid ${C.border}`,paddingTop:14}}>
                      <div style={{background:C.bg,borderRadius:10,border:`1px solid ${C.border}`,padding:"12px",marginBottom:12}}>
                        <div style={{fontSize:9,fontWeight:700,color:C.dim,letterSpacing:"0.1em",marginBottom:8}}>CREDENTIALS</div>
                        <div style={{fontSize:13,marginBottom:6,color:C.sub}}>Username: <strong style={{color:C.gold}}>@{u.username}</strong></div>
                        <div style={{display:"flex",alignItems:"center",gap:8,fontSize:13,color:C.sub,flexWrap:"wrap"}}>
                          Password:&nbsp;
                          <strong style={{color:C.text,fontFamily:"monospace"}}>{showPw[u.id]?unHash(u.password_hash):"••••••••"}</strong>
                          <button style={{background:"none",border:`1px solid ${C.border}`,color:C.sub,borderRadius:6,padding:"3px 10px",fontSize:11,cursor:"pointer"}} onClick={()=>setShowPw(p=>({...p,[u.id]:!p[u.id]}))}>
                            {showPw[u.id]?"Hide":"Show"}
                          </button>
                        </div>
                      </div>
                      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:12}}>
                        {[{l:"Balance",v:`₿${(u.balance||0).toFixed(2)}`},{l:"Deposited",v:`₿${(u.cash_in||0).toFixed(2)}`},{l:"Withdrawn",v:`₿${(u.cash_out||0).toFixed(2)}`},{l:"Bets",v:ub.length},{l:"Wins",v:ub.filter(b=>b.status==="won").length},{l:"P&L",v:`${up>=0?"+":""}₿${up.toFixed(2)}`,c:up>=0?C.green:"#FF5252"}].map(s=>(
                          <div key={s.l} style={{background:C.bg,borderRadius:8,padding:"9px",textAlign:"center"}}><div style={{fontSize:12,fontWeight:800,color:s.c||C.text}}>{s.v}</div><div style={{fontSize:9,color:C.dim,marginTop:2}}>{s.l}</div></div>
                        ))}
                      </div>
                      {ub.length>0&&<><RL label="BETS"/>
                        {ub.slice(0,5).map(b=>(
                          <div key={b.id} style={{background:C.bg,borderRadius:8,border:`1px solid ${C.border}`,padding:"9px 11px",marginBottom:5}}>
                            <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}><span style={S.badge}>SINGLE</span><SPill s={b.status}/></div>
                            {b.legs?.map((l,i)=><div key={i} style={{fontSize:12,color:C.sub}}>{l.matchup} → <strong style={{color:C.gold}}>{betLabel(l.fighter)}</strong> <span style={{color:C.dim}}>({fmtO(l.odds)})</span></div>)}
                            <div style={{display:"flex",gap:10,fontSize:11,color:C.dim,marginTop:5}}>
                              <span>₿{b.stake}</span><span style={{color:C.green}}>₿{(b.potential_win||0).toFixed(2)} to win</span>
                              <span>{fmtDate(b.placed_at)}</span>
                            </div>
                          </div>
                        ))}
                      </>}
                      {ut.length>0&&<><RL label="TRANSACTIONS" style={{marginTop:10}}/>
                        {ut.slice(0,5).map(tx=>(
                          <div key={tx.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 0",borderBottom:`1px solid ${C.border}`,fontSize:12}}>
                            <span style={{color:C.sub}}>{tx.type==="deposit"?"💵":"💸"} {fmtDate(tx.created_at)}</span>
                            <div style={{display:"flex",gap:8,alignItems:"center"}}><span style={{fontWeight:700,color:tx.type==="deposit"?C.green:"#FF6B35"}}>{tx.type==="deposit"?"+":"−"}₿{tx.amount.toFixed(2)}</span><SPill s={tx.status}/></div>
                          </div>
                        ))}
                      </>}
                      <div style={{marginTop:12,paddingTop:10,borderTop:`1px solid ${C.border}`}}>
                        {delConfirm===u.id?(
                          <div style={{background:"#1A0A0A",border:"1px solid #E5393533",borderRadius:10,padding:"12px"}}>
                            <div style={{fontSize:13,color:"#E53935",marginBottom:10,lineHeight:1.5}}>Delete <strong>@{u.username}</strong>? Permanently removes their account, bets, and transactions.</div>
                            <div style={{display:"flex",gap:8}}>
                              <button style={{...S.btn,flex:1,padding:"11px",background:"#E53935"}} onClick={()=>doDelete(u.id)}>Yes, Delete</button>
                              <button style={{...S.ghost,flex:1,padding:"11px"}} onClick={()=>setDelConfirm(null)}>Cancel</button>
                            </div>
                          </div>
                        ):(
                          <button style={{background:"none",border:"1px solid #E5393533",color:"#E53935",borderRadius:8,padding:"8px 16px",fontSize:12,fontWeight:600,cursor:"pointer",width:"100%"}} onClick={()=>setDelConfirm(u.id)}>Delete Account</button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* BOTTOM NAV */}
      <nav style={{position:"fixed",bottom:0,left:"50%",transform:"translateX(-50%)",width:"100%",maxWidth:480,background:C.bg,borderTop:`1px solid ${C.border}`,display:"flex",zIndex:100,paddingBottom:"env(safe-area-inset-bottom)"}}>
        {TABS.map(t=>{
          const active=tab===t.id; const red=isAdmin&&t.id==="admin";
          return(
            <button key={t.id} style={{flex:1,background:"none",border:"none",color:active?(red?"#E53935":C.gold):C.dim,padding:"8px 4px 11px",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:3,position:"relative"}} onClick={()=>setTab(t.id)}>
              {active&&<div style={{position:"absolute",top:0,left:"25%",width:"50%",height:2,background:red?"#E53935":C.gold,borderRadius:"0 0 2px 2px"}}/>}
              <span style={{fontSize:20}}>{t.icon}</span>
              <span style={{fontSize:8,fontWeight:700,letterSpacing:"0.02em"}}>{t.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}

// ─── COMPONENTS ───────────────────────────────────────────────────────────────
const Av=({name,size=40,style={}})=><div style={{width:size,height:size,borderRadius:"50%",background:C.gold,color:C.bg,fontSize:size*0.42,fontWeight:900,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,...style}}>{name?.[0]?.toUpperCase()}</div>;
const ST=({title,sub,style={}})=><div style={{marginBottom:14,...style}}><div style={{fontSize:16,fontWeight:800,color:C.text}}>{title}</div>{sub&&<div style={{fontSize:11,color:C.dim,marginTop:2}}>{sub}</div>}</div>;
const RL=({label,style={}})=><div style={{fontSize:9,fontWeight:700,letterSpacing:"0.12em",color:C.dim,marginBottom:8,paddingBottom:6,borderBottom:`1px solid ${C.border}`,...style}}>{label}</div>;
const SPill=({s})=>{const m={won:["#00C85318",C.green],lost:["#E5393518","#FF5252"],cancelled:["#1A1A2A","#555"],pending:["#FFD60018",C.gold],approved:["#00C85318",C.green],rejected:["#E5393518","#FF5252"]};const[bg,c]=m[s]||["#1A1A2A","#555"];return<span style={{fontSize:9,fontWeight:700,letterSpacing:"0.07em",padding:"3px 8px",borderRadius:4,background:bg,color:c}}>{s?.toUpperCase()}</span>;};
const Fld=({label,children})=><div style={{marginBottom:16}}><label style={{fontSize:11,fontWeight:700,color:C.dim,letterSpacing:"0.07em",display:"block",marginBottom:7}}>{label}</label>{children}</div>;
const Toast=({t})=><div style={{position:"fixed",top:68,left:"50%",transform:"translateX(-50%)",padding:"12px 20px",borderRadius:10,fontWeight:700,fontSize:13,zIndex:2000,color:"#fff",boxShadow:"0 4px 24px #00000099",maxWidth:"90vw",textAlign:"center",background:t.type==="error"?"#B71C1C":"#00A846",lineHeight:1.4}}>{t.msg}</div>;
const Empty=({icon,title,sub})=><div style={{textAlign:"center",padding:"44px 20px"}}><div style={{fontSize:38,marginBottom:10}}>{icon}</div><div style={{fontSize:14,fontWeight:700,color:C.sub}}>{title}</div>{sub&&<div style={{fontSize:12,color:C.dim,marginTop:4}}>{sub}</div>}</div>;
const Loader=()=><div style={{display:"flex",alignItems:"center",justifyContent:"center",minHeight:"100vh",background:C.bg}}><div style={{textAlign:"center"}}><div style={{fontSize:32,fontWeight:900,color:C.gold,marginBottom:10}}>₿</div><div style={{fontSize:13,color:C.dim}}>Loading MFL Betzone…</div></div></div>;

// ─── TOKENS ───────────────────────────────────────────────────────────────────
const C={bg:"#09090E",card:"#111119",border:"#1C1C2A",border2:"#2C2C3A",text:"#F0F0F5",sub:"#AAAABB",dim:"#55556A",gold:"#FFD600",green:"#00E676"};
const S={
  root:{minHeight:"100vh",background:C.bg,color:C.text,fontFamily:"'Inter','SF Pro Display',system-ui,sans-serif",maxWidth:480,margin:"0 auto"},
  hdr:{background:C.bg,borderBottom:`1px solid ${C.border}`,position:"sticky",top:0,zIndex:100},
  card:{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:"14px 16px"},
  fBtn:{flex:1,background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:"12px 6px",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:6,transition:"all 0.15s"},
  fBtnOn:{background:"#15152A",border:`1px solid ${C.gold}`,boxShadow:`0 0 10px ${C.gold}14`},
  stakeW:{display:"flex",alignItems:"center",background:C.bg,border:`1px solid ${C.border}`,borderRadius:10,padding:"11px 14px"},
  stakeInp:{background:"none",border:"none",color:C.text,fontSize:16,fontWeight:700,width:"100%",outline:"none"},
  badge:{fontSize:9,fontWeight:700,letterSpacing:"0.08em",background:"#1C1C2A",color:C.dim,padding:"2px 7px",borderRadius:4},
  btn:{background:C.gold,color:C.bg,border:"none",borderRadius:10,padding:"12px 16px",fontSize:12,fontWeight:800,cursor:"pointer",letterSpacing:"0.04em",whiteSpace:"nowrap"},
  ghost:{background:"none",border:`1px solid ${C.border}`,color:C.sub,borderRadius:10,padding:"12px 16px",fontSize:13,fontWeight:600,cursor:"pointer",textAlign:"center"},
  tabTog:{flex:1,background:"none",border:"none",color:C.dim,padding:"11px",fontSize:13,fontWeight:700,cursor:"pointer",borderRadius:8},
  tabOn:{background:C.gold,color:C.bg},
  inp:{width:"100%",background:C.bg,border:`1px solid ${C.border}`,borderRadius:10,padding:"13px 14px",color:C.text,fontSize:14,outline:"none",boxSizing:"border-box"},
  over:{position:"fixed",inset:0,background:"#000000EE",zIndex:200,display:"flex",alignItems:"center",justifyContent:"center",padding:"20px"},
  modal:{background:C.card,border:`1px solid ${C.border}`,borderRadius:16,padding:"22px 20px",maxWidth:420,width:"100%",maxHeight:"88vh",overflowY:"auto"},
};
