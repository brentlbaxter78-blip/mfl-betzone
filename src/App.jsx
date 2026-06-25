import { useState, useEffect, useCallback, useRef } from "react";

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const SUPA_URL = "https://nuiffniijnbzzkvxxtle.supabase.co";
const SUPA_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im51aWZmbmlpam5ienprdnh4dGxlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIzNDA5MzgsImV4cCI6MjA5NzkxNjkzOH0.dlKFKRYwZIU_GefbPV7aDhOab5B7jGByVTAAV3uQ8C8";
const ADMIN_USER = "brent", ADMIN_PASS = "MFLadmin2026!";

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

// ─── STABLE ODDS (module-level cache, resets every 5 min) ────────────────────
let _oddsCache = {}, _cacheTime = 0;
const ODDS_TTL = 5 * 60 * 1000;
const VIG = 0.10;

const odds3 = (t1, t2) => {
  const s1 = STR[t1]||1100, s2 = STR[t2]||1100;
  const j = (Math.random()-0.5)*0.04;
  const rp = Math.min(0.88, Math.max(0.12, s1/(s1+s2)+j));
  const bal = 1-Math.abs(rp-0.5)*1.6;
  const dp = 0.20+bal*0.12, rem = 1-dp;
  const p1=(rp*rem)*(1+VIG), pD=dp*(1+VIG), p2=((1-rp)*rem)*(1+VIG);
  const ml=p=>p>=0.5?-Math.round(p/(1-p)*100):+Math.round((1-p)/p*100);
  return{o1:ml(p1),oDraw:ml(pD),o2:ml(p2)};
};

const stableOdds = (gid, t1, t2) => {
  const now = Date.now();
  if (now - _cacheTime > ODDS_TTL) { _oddsCache = {}; _cacheTime = now; }
  if (!_oddsCache[gid]) _oddsCache[gid] = odds3(t1, t2);
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
  "Cuba":860,"Haiti":870,"Costa Rica":1080,
};

// Fix ESPN team names to match our data
const ESPN_NAME = {
  "United States":"USA","Korea Republic":"South Korea","Côte d'Ivoire":"Ivory Coast",
  "DR Congo":"Congo","Czech Republic":"Czechia","Bosnia and Herzegovina":"Bosnia",
  "Trinidad and Tobago":"Trinidad","New Zealand":"New Zealand",
  "Saudi Arabia":"Saudi Arabia","Costa Rica":"Costa Rica",
  "United Arab Emirates":"UAE","China PR":"China","IR Iran":"Iran",
};
const normName = n => ESPN_NAME[n] || n;

const FLAGS = {
  "Argentina":"🇦🇷","France":"🇫🇷","Brazil":"🇧🇷","England":"🏴󠁧󠁢󠁥󠁮󠁧󠁿","Portugal":"🇵🇹",
  "Spain":"🇪🇸","Belgium":"🇧🇪","Netherlands":"🇳🇱","Germany":"🇩🇪","Croatia":"🇭🇷",
  "Uruguay":"🇺🇾","Italy":"🇮🇹","Switzerland":"🇨🇭","Colombia":"🇨🇴","USA":"🇺🇸",
  "Mexico":"🇲🇽","Japan":"🇯🇵","Morocco":"🇲🇦","Senegal":"🇸🇳","Denmark":"🇩🇰",
  "South Korea":"🇰🇷","Ecuador":"🇪🇨","Canada":"🇨🇦","Serbia":"🇷🇸","Ghana":"🇬🇭",
  "Cameroon":"🇨🇲","Tunisia":"🇹🇳","Iran":"🇮🇷","Costa Rica":"🇨🇷","Saudi Arabia":"🇸🇦",
  "Qatar":"🇶🇦","Australia":"🇦🇺","Poland":"🇵🇱","Nigeria":"🇳🇬","Algeria":"🇩🇿",
  "Panama":"🇵🇦","Paraguay":"🇵🇾","Bolivia":"🇧🇴","Peru":"🇵🇪","Chile":"🇨🇱",
  "Venezuela":"🇻🇪","Jamaica":"🇯🇲","Honduras":"🇭🇳","El Salvador":"🇸🇻",
  "Ivory Coast":"🇨🇮","Congo":"🇨🇩","Czechia":"🇨🇿","Bosnia":"🇧🇦",
  "Trinidad":"🇹🇹","UAE":"🇦🇪","China":"🇨🇳","Wales":"🏴󠁧󠁢󠁷󠁬󠁳󠁿","Scotland":"🏴󠁧󠁢󠁳󠁣󠁴󠁿",
};
const fl = t => FLAGS[t] || "⚽";

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

const fetchWC = async () => {
  try {
    const r = await fetch("https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard");
    if (!r.ok) return FB;
    const d = await r.json();
    // Show only pre-game matches (not live, not finished)
    const evs = (d.events||[]).filter(e => e.status?.type?.state === "pre");
    if (!evs.length) return FB;
    return evs.slice(0,8).map(e => {
      const cs = e.competitions?.[0]?.competitors||[];
      const h = cs.find(c=>c.homeAway==="home"), a = cs.find(c=>c.homeAway==="away");
      const t1 = normName(h?.team?.displayName||"Home");
      const t2 = normName(a?.team?.displayName||"Away");
      return { id:e.id, t1, t2, dt:e.date, rnd:e.name||"FIFA World Cup 2026", ...stableOdds(e.id,t1,t2) };
    });
  } catch { return FB; }
};

// Closes 3 minutes before game (not live betting)
const isClosed = dt => new Date() >= new Date(new Date(dt).getTime() - 180000);

// ─── HELPERS ─────────────────────────────────────────────────────────────────
const fmtO = o => o>0?`+${o}`:`${o}`;
const calcW = (s,o) => o>0?+(s*(o/100)).toFixed(2):+(s*(100/Math.abs(o))).toFixed(2);
const fmtDt = iso => { const d=new Date(iso); return d.toLocaleDateString("en-US",{month:"short",day:"numeric",timeZone:"America/New_York"})+" · "+d.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit",timeZone:"America/New_York",timeZoneName:"short"}); };
const fmtDate = iso => new Date(iso).toLocaleDateString("en-US",{month:"short",day:"numeric",timeZone:"America/New_York"});
const mkHash = s => btoa(unescape(encodeURIComponent(s+"||mfl2026")));
const unHash = h => { try{return decodeURIComponent(escape(atob(h))).replace("||mfl2026","");}catch{return "••••";} };
const betLabel = t => t==="Draw"?`⚖️ Draw`:`${fl(t)} ${t}`;
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
  const showToast=(msg,type="success")=>{setToast({msg,type});setTimeout(()=>setToast(null),4000);};
  const refreshWC=useCallback(async()=>{const g=await fetchWC();setWc(g);setWcLoading(false);},[]);
  useEffect(()=>{refreshWC();},[refreshWC]);
  useEffect(()=>{
    const iv=setInterval(()=>{if(!document.hidden)refreshWC();},5*60*1000); // every 5 min
    const h=()=>{if(!document.hidden)refreshWC();};
    document.addEventListener("visibilitychange",h);
    return()=>{clearInterval(iv);document.removeEventListener("visibilitychange",h);};
  },[refreshWC]);
  useEffect(()=>{try{const s=sessionStorage.getItem("mfl_s");if(s)setSession(JSON.parse(s));}catch(e){}},[]); 
  const login=s=>{setSession(s);try{sessionStorage.setItem("mfl_s",JSON.stringify(s));}catch(e){}};
  const logout=()=>{setSession(null);try{sessionStorage.removeItem("mfl_s");}catch(e){}};
  if(!session)return<Login login={login} showToast={showToast} toast={toast}/>;
  return<Main session={session} logout={logout} showToast={showToast} toast={toast} wc={wc} wcLoading={wcLoading}/>;
}

// ─── LOGIN ────────────────────────────────────────────────────────────────────
function Login({login,showToast,toast}){
  const [mode,setMode]=useState("login");
  const [un,setUn]=useState(""),[pw,setPw]=useState(""),[cpw,setCpw]=useState("");
  const [tos,setTos]=useState(false),[showTos,setShowTos]=useState(false),[tosRead,setTosRead]=useState(false);
  const [busy,setBusy]=useState(false);
  // No ref needed — scroll is tracked via event target
  const onTosScroll=e=>{const el=e.currentTarget;if(el.scrollHeight-el.scrollTop<=el.clientHeight+30)setTosRead(true);};

  const doLogin=async()=>{
    if(!un.trim()||!pw)return showToast("Enter your username and password","error");
    if(un.trim().toLowerCase()===ADMIN_USER&&pw===ADMIN_PASS){login({userId:"admin",isAdmin:true});return;}
    setBusy(true);
    try{
      const rows=await db.findUser(un.trim());const user=rows?.[0];
      if(!user||user.password_hash!==mkHash(pw))return showToast("Wrong username or password","error");
      login({userId:user.id,isAdmin:false});
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
      showToast("Welcome to MFL Betzone! 🎉");login({userId:nu.id,isAdmin:false});
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
          <button style={{...S.btn,width:"100%",padding:"15px",fontSize:14,opacity:busy?0.55:1}} onClick={mode==="login"?doLogin:doRegister} disabled={busy}>
            {busy?"…":mode==="login"?"SIGN IN":"CREATE ACCOUNT"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
function Main({session,logout,showToast,toast,wc,wcLoading}){
  const isAdmin=session.isAdmin;
  const [tab,setTab]=useState("soccer");
  const [user,setUser]=useState(isAdmin?{display_name:"Brent",username:"brent",balance:0,cash_in:0,cash_out:0,privacy_public:false,is_admin:true}:null);
  const [bets,setBets]=useState([]); const [allBets,setAllBets]=useState([]);
  const [txs,setTxs]=useState([]);   const [allTxs,setAllTxs]=useState([]);
  const [users,setUsers]=useState([]); const [pendTxs,setPend]=useState([]);
  const [house,setHouse]=useState(null);
  const [loading,setLoading]=useState(!isAdmin);
  const [picks,setPicks]=useState({}); const [cash,setCash]=useState("");
  const [houseCash,setHouseCash]=useState("");
  const [expanded,setExpanded]=useState(null); const [showPw,setShowPw]=useState({});
  const [delConfirm,setDelConfirm]=useState(null);
  const [confirm,setConfirm]=useState(null);

  const load=useCallback(async()=>{
    try{
      if(isAdmin){
        const [u,b,pb,p,a,h]=await Promise.all([db.allUsers(),db.allBets(),db.pendBets(),db.pendingTxs(),db.allTxs(),db.getHouse()]);
        setUsers((u||[]).filter(x=>!x.is_admin));
        setAllBets(b||[]); setPend(p||[]); setAllTxs(a||[]); setHouse(h?.[0]||null);
      }else{
        const [u,b,t,us,ab]=await Promise.all([db.getUser(session.userId),db.myBets(session.userId),db.myTxs(session.userId),db.allUsers(),db.allBets()]);
        if(u?.[0])setUser(u[0]); setBets(b||[]); setTxs(t||[]);
        setUsers((us||[]).filter(x=>!x.is_admin&&x.id!==session.userId));
        setAllBets(ab||[]);
      }
    }catch(e){showToast("Error loading","error");}finally{setLoading(false);}
  },[session.userId,isAdmin]);

  useEffect(()=>{load();},[load]);

  const setPick=(id,team,odds)=>setPicks(p=>{const ex=p[id];if(ex&&ex.team===team){const n={...p};delete n[id];return n;}return{...p,[id]:{team,odds,stake:""}};});
  const setStake=(id,v)=>setPicks(p=>({...p,[id]:{...p[id],stake:v}}));

  const askConfirm=gid=>{
    const pick=picks[gid]; const g=wc.find(x=>x.id===gid); if(!pick)return;
    const stake=parseFloat(pick.stake);
    if(!stake||stake<1)return showToast("Minimum bet is ₿1","error");
    if(stake>user.balance)return showToast(`You only have ₿${(user.balance||0).toFixed(2)} — can't bet more than your balance`,"error");
    if(user.balance<=0)return showToast("Your balance is ₿0 — deposit first","error");
    setConfirm({gid,team:pick.team,odds:pick.odds,stake,win:calcW(stake,pick.odds),matchup:`${g.t1} vs ${g.t2}`});
  };

  const placeBet=async()=>{
    if(!confirm)return;
    const{gid,team,odds,stake,win,matchup}=confirm; const g=wc.find(x=>x.id===gid);
    setConfirm(null);
    try{
      // Deduct from player, credit house
      await db.patchUser(session.userId,{balance:+(user.balance-stake).toFixed(2)});
      if(house) await db.patchUser(house.id,{balance:+(house.balance+stake).toFixed(2)});
      await db.addBet({user_id:session.userId,type:"single",stake,potential_win:win,legs:[{fighter:team,matchup,odds,fightId:gid,eventDate:g?.dt||null,event:"FIFA World Cup 2026"}]});
      setPicks(p=>{const n={...p};delete n[gid];return n;});
      showToast(`Bet placed! To win ₿${win.toFixed(2)}`); await load();
    }catch(e){showToast("Error placing bet","error");}
  };

  // Admin: settle a bet
  const settleBet=async(betId,outcome)=>{
    const bet=allBets.find(b=>b.id===betId);
    const player=users.find(u=>u.id===bet?.user_id);
    if(!bet||!player)return;
    try{
      await db.patchBet(betId,{status:outcome});
      if(outcome==="won"){
        const payout=+(bet.stake+bet.potential_win).toFixed(2);
        await db.patchUser(player.id,{balance:+(player.balance+payout).toFixed(2)});
        if(house) await db.patchUser(house.id,{balance:+(house.balance-payout).toFixed(2)});
        showToast(`${player.display_name} paid ₿${payout}`);
      }else{
        showToast(`Bet marked as lost — house keeps ₿${bet.stake}`);
      }
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
    {id:"soccer",icon:"⚽",label:"Soccer"},
    {id:"mybets",icon:"🎯",label:`Bets${pending>0?` (${pending})`:""}`},
    {id:"profile",icon:"👤",label:"Profile"},
  ];
  const ADMIN_TABS=[
    {id:"soccer",   icon:"⚽",label:"Soccer"},
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
              <div style={{fontSize:10,color:C.dim,fontWeight:700,letterSpacing:"0.06em",marginBottom:6}}>FIFA WORLD CUP 2026</div>
              <div style={{fontSize:13,color:C.sub,marginBottom:8}}>{confirm.matchup}</div>
              <div style={{fontSize:14,color:C.text,marginBottom:12}}>Pick: <strong style={{color:C.gold}}>{betLabel(confirm.team)}</strong> <span style={{color:C.dim,fontSize:12}}>({fmtO(confirm.odds)})</span></div>
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

      {/* HEADER */}
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
          {isAdmin&&<span style={{fontSize:11,fontWeight:700,color:"#E53935",background:"#1A000022",border:"1px solid #E5393533",borderRadius:8,padding:"5px 12px"}}>BRENT</span>}
        </div>
      </header>

      <main style={{padding:"14px 14px 80px"}}>

        {/* ── SOCCER / WORLD CUP ── */}
        {tab==="soccer"&&(
          <div>
            <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:"10px 14px",marginBottom:14,display:"flex",alignItems:"center",gap:8}}>
              <span style={{width:7,height:7,borderRadius:"50%",background:C.green,display:"inline-block"}}/>
              <span style={{fontSize:11,fontWeight:700,color:C.green,letterSpacing:"0.04em"}}>FIFA WORLD CUP 2026 — LIVE ODDS</span>
            </div>
            {wcLoading?(
              <div style={{textAlign:"center",padding:"44px",color:C.dim}}><div style={{fontSize:28,marginBottom:8}}>⚽</div><div style={{fontSize:13}}>Loading odds…</div></div>
            ):wc.length===0?<Empty icon="⚽" title="No upcoming matches" sub="Check back soon for odds"/>
            :wc.map(g=>{
              const pick=picks[g.id];
              const stake=parseFloat(pick?.stake)||0;
              const payout=stake&&pick?calcW(stake,pick.odds):0;
              const closed=isClosed(g.dt);
              return(
                <div key={g.id} style={{...S.card,marginBottom:12,opacity:closed?0.7:1}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12}}>
                    <div><div style={{fontSize:10,fontWeight:700,color:C.gold,letterSpacing:"0.05em"}}>FIFA WORLD CUP 2026</div><div style={{fontSize:10,color:C.dim,marginTop:1}}>{g.rnd}</div></div>
                    <div style={{fontSize:10,color:C.dim,textAlign:"right"}}>{fmtDt(g.dt)}</div>
                  </div>
                  {closed&&<div style={{background:"#120808",border:"1px solid #E5393522",borderRadius:7,padding:"6px 12px",fontSize:11,color:"#E53935",fontWeight:600,textAlign:"center",marginBottom:12}}>🔒 Betting closed</div>}
                  <div style={{display:"flex",gap:5}}>
                    <button disabled={isAdmin||closed} onClick={()=>setPick(g.id,g.t1,g.o1)} style={{...S.fBtn,flex:1,...(pick?.team===g.t1?S.fBtnOn:{}),cursor:isAdmin||closed?"not-allowed":"pointer"}}>
                      <span style={{fontSize:20,lineHeight:1}}>{fl(g.t1)}</span>
                      <span style={{fontSize:11,fontWeight:700,color:C.text,textAlign:"center",lineHeight:1.2}}>{g.t1}</span>
                      <span style={{fontSize:13,fontWeight:900,color:g.o1<0?"#FF6B35":C.green}}>{fmtO(g.o1)}</span>
                    </button>
                    <button disabled={isAdmin||closed} onClick={()=>setPick(g.id,"Draw",g.oDraw)} style={{...S.fBtn,flex:0.72,...(pick?.team==="Draw"?{...S.fBtnOn,background:"#151525"}:{}),cursor:isAdmin||closed?"not-allowed":"pointer"}}>
                      <span style={{fontSize:17}}>⚖️</span>
                      <span style={{fontSize:10,fontWeight:700,color:C.dim}}>DRAW</span>
                      <span style={{fontSize:13,fontWeight:900,color:C.sub}}>{fmtO(g.oDraw)}</span>
                    </button>
                    <button disabled={isAdmin||closed} onClick={()=>setPick(g.id,g.t2,g.o2)} style={{...S.fBtn,flex:1,...(pick?.team===g.t2?S.fBtnOn:{}),cursor:isAdmin||closed?"not-allowed":"pointer"}}>
                      <span style={{fontSize:20,lineHeight:1}}>{fl(g.t2)}</span>
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
            {/* Coming Soon Cards */}
            <div style={{marginTop:16,display:"flex",flexDirection:"column",gap:10}}>
              {[{icon:"🏈",label:"NFL Football",sub:"Season kicks off Fall 2026"},{icon:"🥊",label:"UFC Betting",sub:"Next card TBD"},{icon:"⚾",label:"MLB Baseball",sub:"Season in progress — coming soon"}].map(cs=>(
                <div key={cs.label} style={{...S.card,display:"flex",alignItems:"center",gap:14,padding:"13px 16px"}}>
                  <span style={{fontSize:24}}>{cs.icon}</span>
                  <div style={{flex:1}}>
                    <div style={{fontSize:13,fontWeight:800,color:C.text}}>{cs.label}</div>
                    <div style={{fontSize:11,color:C.dim,marginTop:1}}>{cs.sub}</div>
                  </div>
                  <span style={{fontSize:8,fontWeight:700,letterSpacing:"0.08em",padding:"3px 8px",borderRadius:5,background:"#FF980018",color:"#FF9800",border:"1px solid #FF980033",whiteSpace:"nowrap"}}>COMING SOON</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── MY BETS (user) ── */}
        {tab==="mybets"&&!isAdmin&&(
          <div>
            <ST title="My Bets" sub="All bets are final — no refunds"/>
            {bets.length===0?<Empty icon="🎯" title="No bets yet" sub="Head to Soccer to place a bet"/>
            :bets.map(bet=>(
              <div key={bet.id} style={{...S.card,marginBottom:10}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                  <div style={{display:"flex",gap:6,alignItems:"center"}}><span style={S.badge}>SINGLE</span><span style={{fontSize:10,color:C.dim}}>{fmtDate(bet.placed_at)}</span></div>
                  <SPill s={bet.status}/>
                </div>
                {bet.legs?.map((l,i)=>(
                  <div key={i} style={{fontSize:13,color:C.sub,marginBottom:3}}>
                    <span style={{color:C.dim}}>{l.matchup}</span> → <strong style={{color:C.gold}}>{betLabel(l.fighter)}</strong>
                    <span style={{color:C.dim,marginLeft:4}}>({fmtO(l.odds)})</span>
                  </div>
                ))}
                <div style={{display:"flex",gap:16,fontSize:12,color:C.dim,marginTop:10,paddingTop:8,borderTop:`1px solid ${C.border}`}}>
                  <span>Stake <strong style={{color:C.text}}>₿{bet.stake}</strong></span>
                  <span>To win <strong style={{color:C.green}}>₿{(bet.potential_win||0).toFixed(2)}</strong></span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── PROFILE (user) ── */}
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
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}>
                <div style={{background:C.bg,borderRadius:10,padding:"14px",textAlign:"center"}}>
                  <div style={{fontSize:11,color:C.dim,marginBottom:4}}>CURRENT POT</div>
                  <div style={{fontSize:26,fontWeight:900,color:C.gold}}>₿{(house?.balance||0).toFixed(2)}</div>
                  <div style={{fontSize:10,color:C.dim,marginTop:2}}>= cash in your pot</div>
                </div>
                <div style={{background:C.bg,borderRadius:10,padding:"14px",textAlign:"center"}}>
                  <div style={{fontSize:11,color:C.dim,marginBottom:4}}>TOTAL WITHDRAWN</div>
                  <div style={{fontSize:26,fontWeight:900,color:C.green}}>₿{(house?.cash_out||0).toFixed(2)}</div>
                  <div style={{fontSize:10,color:C.dim,marginTop:2}}>= profit pocketed</div>
                </div>
              </div>
              <div style={{fontSize:11,color:C.sub,background:C.bg,borderRadius:8,padding:"10px 12px",marginBottom:14,lineHeight:1.7}}>
                Pot = stakes collected − payouts made − your withdrawals.<br/>
                Log a withdrawal when you take cash from the pot.
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
                  <div style={{display:"flex",gap:12,fontSize:12,color:C.dim,margin:"8px 0 12px",paddingTop:8,borderTop:`1px solid ${C.border}`}}>
                    <span>Stake <strong style={{color:C.text}}>₿{bet.stake}</strong></span>
                    <span>Payout if won <strong style={{color:C.green}}>₿{+(bet.stake+bet.potential_win).toFixed(2)}</strong></span>
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
