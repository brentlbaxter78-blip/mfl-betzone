import { useState, useEffect, useCallback } from "react";

// ─── SUPABASE CONFIG ──────────────────────────────────────────────────────────
const SUPABASE_URL = "https://nuiffniijnbzzkvxxtle.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im51aWZmbmlpam5ienprdnh4dGxlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIzNDA5MzgsImV4cCI6MjA5NzkxNjkzOH0.dlKFKRYwZIU_GefbPV7aDhOab5B7jGByVTAAV3uQ8C8";

const sb = async (path, opts = {}) => {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      "Prefer": opts.prefer || "return=representation",
      ...opts.headers,
    },
    ...opts,
  });
  if (!res.ok) { const err = await res.text(); throw new Error(err); }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
};

const db = {
  getUserByUsername: (u) => sb(`users?username=eq.${encodeURIComponent(u.toLowerCase())}&limit=1`),
  getUserById:       (id) => sb(`users?id=eq.${id}&limit=1`),
  getAllUsers:        ()   => sb(`users?select=id,username,display_name,balance,cash_in,cash_out,privacy_public,created_at&order=created_at.asc`),
  createUser:        (d)  => sb(`users`, { method:"POST", body:JSON.stringify(d) }),
  updateUser:        (id,d)=> sb(`users?id=eq.${id}`, { method:"PATCH", body:JSON.stringify(d) }),
  getUserBets:       (uid) => sb(`bets?user_id=eq.${uid}&order=placed_at.desc`),
  getAllBets:         ()   => sb(`bets?order=placed_at.desc`),
  createBet:         (d)  => sb(`bets`, { method:"POST", body:JSON.stringify(d) }),
  updateBet:         (id,d)=> sb(`bets?id=eq.${id}`, { method:"PATCH", body:JSON.stringify(d) }),
  getUserTransactions:(uid)=> sb(`transactions?user_id=eq.${uid}&order=created_at.desc`),
  getAllTransactions: ()   => sb(`transactions?order=created_at.desc`),
  getPendingTxs:     ()   => sb(`transactions?status=eq.pending&order=created_at.asc`),
  createTransaction: (d)  => sb(`transactions`, { method:"POST", body:JSON.stringify(d) }),
  updateTransaction: (id,d)=> sb(`transactions?id=eq.${id}`, { method:"PATCH", body:JSON.stringify(d) }),
};

const ADMIN_USER = "brent";
const ADMIN_PASS = "MFLadmin2026!";

const FIGHTS = [
  { id:1, fighter1:"Islam Makhachev",     fighter2:"Charles Oliveira",   weight:"Lightweight Championship",   eventDate:"2026-07-12T22:00:00", event:"UFC 315" },
  { id:2, fighter1:"Jon Jones",            fighter2:"Stipe Miocic",        weight:"Heavyweight",                eventDate:"2026-07-12T21:00:00", event:"UFC 315" },
  { id:3, fighter1:"Alex Pereira",         fighter2:"Jamahal Hill",        weight:"Light Heavyweight",          eventDate:"2026-07-12T20:00:00", event:"UFC 315" },
  { id:4, fighter1:"Sean O'Malley",        fighter2:"Merab Dvalishvili",   weight:"Bantamweight Championship",  eventDate:"2026-08-02T22:00:00", event:"UFC 316" },
  { id:5, fighter1:"Dricus Du Plessis",    fighter2:"Sean Strickland",     weight:"Middleweight",               eventDate:"2026-08-02T21:00:00", event:"UFC 316" },
  { id:6, fighter1:"Valentina Shevchenko", fighter2:"Alexa Grasso",        weight:"Women's Flyweight",          eventDate:"2026-08-02T20:00:00", event:"UFC 316" },
];

const genOdds = () => FIGHTS.map(f => {
  const sp = Math.floor(Math.random()*200)+60, fav = Math.random()>0.5;
  return { ...f, odds1: fav?-(sp+Math.floor(Math.random()*40)):+(sp+Math.floor(Math.random()*40)), odds2: fav?+(sp+Math.floor(Math.random()*40)):-(sp+Math.floor(Math.random()*40)) };
});
const fmtOdds = o => o>0?`+${o}`:`${o}`;
const calcWin = (s,o) => o>0?+(s*(o/100)).toFixed(2):+(s*(100/Math.abs(o))).toFixed(2);
const calcParlayWin = (s,legs) => { let m=1; legs.forEach(({odds})=>{ m*=odds>0?1+odds/100:1+100/Math.abs(odds); }); return +(s*(m-1)).toFixed(2); };
const fmtDt  = iso => { const d=new Date(iso); return d.toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric",timeZone:"America/New_York"})+" · "+d.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit",timeZone:"America/New_York",timeZoneName:"short"}); };
const isClosed = ed => new Date() >= new Date(new Date(ed).getTime()-3600000);
const mkHash   = s  => btoa(unescape(encodeURIComponent(s+"||mfl2026")));
const unHash   = h  => { try{ return decodeURIComponent(escape(atob(h))).replace("||mfl2026",""); }catch(e){ return "••••"; } };

const TERMS = [
  { n:"1", t:"Don't leak outside of MFL. What happens in MFL Betzone stays in MFL Betzone. Do not share bet details, balances, or any platform info outside of the group." },
  { n:"2", t:"Gamble responsibly. Only bet what you can afford to lose. This is for fun — if it stops being fun, stop betting." },
];

// ─── ROOT ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [session,  setSession]  = useState(null);
  const [fights,   setFights]   = useState(genOdds());
  const [countdown,setCd]       = useState(600);
  const [lastUpd,  setLastUpd]  = useState(new Date());
  const [toast,    setToast]    = useState(null);

  const showToast = (msg,type="success")=>{ setToast({msg,type}); setTimeout(()=>setToast(null),3500); };

  useEffect(()=>{ const iv=setInterval(()=>{ setFights(genOdds()); setLastUpd(new Date()); setCd(600); },600000); return ()=>clearInterval(iv); },[]);
  useEffect(()=>{ const t=setInterval(()=>setCd(c=>c>0?c-1:0),1000); return ()=>clearInterval(t); },[]);
  useEffect(()=>{ try{ const s=sessionStorage.getItem("mfl_s"); if(s) setSession(JSON.parse(s)); }catch(e){} },[]);

  const login  = s=>{ setSession(s); try{ sessionStorage.setItem("mfl_s",JSON.stringify(s)); }catch(e){} };
  const logout = ()=>{ setSession(null); try{ sessionStorage.removeItem("mfl_s"); }catch(e){} };

  if(!session)       return <LoginScreen login={login} showToast={showToast} toast={toast}/>;
  if(session.isAdmin)return <AdminPanel  logout={logout} showToast={showToast} toast={toast}/>;
  return <UserApp session={session} logout={logout} showToast={showToast} toast={toast} fights={fights} countdown={countdown} lastUpd={lastUpd}/>;
}

// ─── LOGIN ────────────────────────────────────────────────────────────────────
function LoginScreen({login,showToast,toast}){
  const [mode,setMode]=useState("login");
  const [un,setUn]=useState(""); const [pw,setPw]=useState(""); const [nm,setNm]=useState("");
  const [tos,setTos]=useState(false); const [showTos,setShowTos]=useState(false); const [busy,setBusy]=useState(false);

  const doLogin=async()=>{
    if(!un||!pw) return showToast("Enter username and password","error");
    if(un.trim().toLowerCase()===ADMIN_USER&&pw===ADMIN_PASS){ login({userId:"admin",isAdmin:true}); return; }
    setBusy(true);
    try{
      const rows=await db.getUserByUsername(un.trim());
      const user=rows?.[0];
      if(!user||user.password_hash!==mkHash(pw)) return showToast("Wrong username or password","error");
      login({userId:user.id,isAdmin:false});
    }catch(e){ showToast("Connection error — try again","error"); }
    finally{ setBusy(false); }
  };

  const doRegister=async()=>{
    const id=un.trim().toLowerCase().replace(/\s+/g,"");
    if(!id||!pw||!nm.trim()) return showToast("Fill out all fields","error");
    if(id===ADMIN_USER) return showToast("That username is reserved","error");
    if(pw.length<4) return showToast("Password needs at least 4 characters","error");
    if(!tos) return showToast("You must agree to the Terms of Service","error");
    setBusy(true);
    try{
      const ex=await db.getUserByUsername(id);
      if(ex?.length>0) return showToast("Username already taken","error");
      const rows=await db.createUser({username:id,display_name:nm.trim(),password_hash:mkHash(pw),balance:0,cash_in:0,cash_out:0,privacy_public:true});
      const user=rows?.[0]; if(!user) throw new Error();
      showToast("Welcome to MFL Betzone! 🎉");
      login({userId:user.id,isAdmin:false});
    }catch(e){ showToast("Error creating account","error"); }
    finally{ setBusy(false); }
  };

  return(
    <div style={S.root}>
      {toast&&<Toast t={toast}/>}
      {showTos&&(
        <div style={S.modalBg}>
          <div style={S.modalBox}>
            <div style={{fontSize:17,fontWeight:800,color:"#fff",marginBottom:18}}>📋 Terms of Service</div>
            {TERMS.map(t=>(
              <div key={t.n} style={{display:"flex",gap:12,marginBottom:16}}>
                <span style={{fontSize:20,fontWeight:900,color:"#ffd600",flexShrink:0}}>{t.n}.</span>
                <p style={{fontSize:13,color:"#ccc",lineHeight:1.7,margin:0}}>{t.t}</p>
              </div>
            ))}
            <button style={{...S.btn,width:"100%",marginTop:4}} onClick={()=>{setTos(true);setShowTos(false);}}>I Agree ✓</button>
            <button style={{...S.ghost,width:"100%",marginTop:8}} onClick={()=>setShowTos(false)}>Close</button>
          </div>
        </div>
      )}
      <div style={S.loginWrap}>
        <div style={{display:"flex",alignItems:"center",gap:16,marginBottom:32}}>
          <span style={{fontSize:52,fontWeight:900,color:"#ffd600",lineHeight:1}}>₿</span>
          <div>
            <div style={{fontSize:28,fontWeight:900,color:"#fff",letterSpacing:"0.05em"}}>MFL BETZONE</div>
            <div style={{fontSize:10,fontWeight:700,color:"#333",letterSpacing:"0.18em"}}>SPORTSBOOK</div>
          </div>
        </div>
        <div style={S.loginCard}>
          <div style={{display:"flex",background:"#070709",borderRadius:8,border:"1px solid #1a1a1a",marginBottom:22,overflow:"hidden"}}>
            <button style={{...S.tabTog,...(mode==="login"?S.tabOn:{})}} onClick={()=>setMode("login")}>Sign In</button>
            <button style={{...S.tabTog,...(mode==="register"?S.tabOn:{})}} onClick={()=>setMode("register")}>Create Account</button>
          </div>
          {mode==="register"&&<Fld label="Full Name (use your real name)"><input style={S.inp} placeholder="e.g. Mike Johnson" value={nm} onChange={e=>setNm(e.target.value)}/></Fld>}
          <Fld label={mode==="register"?"Username (use your real name)":"Username"}>
            <input style={S.inp} placeholder={mode==="register"?"e.g. mikejohnson":"username"} value={un} onChange={e=>setUn(e.target.value)} autoCapitalize="none" autoCorrect="off"/>
          </Fld>
          <Fld label="Password">
            <input style={S.inp} type="password" placeholder="••••••••" value={pw} onChange={e=>setPw(e.target.value)} onKeyDown={e=>e.key==="Enter"&&(mode==="login"?doLogin():doRegister())}/>
          </Fld>
          {mode==="register"&&(
            <div style={{marginBottom:18,background:"#070709",border:"1px solid #1a1a1a",borderRadius:8,padding:"12px"}}>
              <div style={{display:"flex",alignItems:"flex-start",gap:10}}>
                <input type="checkbox" id="tos" checked={tos} onChange={e=>setTos(e.target.checked)} style={{marginTop:2,width:16,height:16,accentColor:"#ffd600",flexShrink:0}}/>
                <label htmlFor="tos" style={{fontSize:12,color:"#888",lineHeight:1.6,cursor:"pointer"}}>
                  I agree to the{" "}
                  <span style={{color:"#ffd600",textDecoration:"underline",cursor:"pointer"}} onClick={e=>{e.preventDefault();setShowTos(true);}}>MFL Betzone Terms of Service</span>
                </label>
              </div>
            </div>
          )}
          <button style={{...S.btn,width:"100%",padding:"14px",opacity:busy?0.6:1}} onClick={mode==="login"?doLogin:doRegister} disabled={busy}>
            {busy?"...":mode==="login"?"SIGN IN":"CREATE ACCOUNT"}
          </button>
        </div>
        <div style={{fontSize:11,color:"#222",marginTop:16}}>Admin: username <strong style={{color:"#333"}}>brent</strong></div>
      </div>
    </div>
  );
}

// ─── USER APP ─────────────────────────────────────────────────────────────────
function UserApp({session,logout,showToast,toast,fights,countdown,lastUpd}){
  const [tab,setTab]=useState("single");
  const [user,setUser]=useState(null); const [bets,setBets]=useState([]); const [txs,setTxs]=useState([]);
  const [allUsers,setAllUsers]=useState([]); const [allBets,setAllBets]=useState([]);
  const [loading,setLoading]=useState(true);
  const [picks,setPicks]=useState({}); const [cash,setCash]=useState("");

  const mins=Math.floor(countdown/60), secs=countdown%60;

  const load=useCallback(async()=>{
    try{
      const [u,b,t,au,ab]=await Promise.all([db.getUserById(session.userId),db.getUserBets(session.userId),db.getUserTransactions(session.userId),db.getAllUsers(),db.getAllBets()]);
      if(u?.[0]) setUser(u[0]); setBets(b||[]); setTxs(t||[]); setAllUsers(au||[]); setAllBets(ab||[]);
    }catch(e){ showToast("Error loading data","error"); }
    finally{ setLoading(false); }
  },[session.userId]);

  useEffect(()=>{ load(); },[load]);

  const setPick=(fightId,fighter,odds)=>{
    setPicks(p=>{ const ex=p[fightId]; if(ex&&ex.fighter===fighter){const n={...p};delete n[fightId];return n;} return {...p,[fightId]:{fighter,odds,stake:""}}; });
  };
  const setStake=(fightId,v)=>setPicks(p=>({...p,[fightId]:{...p[fightId],stake:v}}));

  const placeBet=async(fightId)=>{
    const pick=picks[fightId]; const fight=fights.find(f=>f.id===fightId);
    if(!pick) return;
    const stake=parseFloat(pick.stake);
    if(!stake||stake<=0) return showToast("Enter a valid stake","error");
    if(stake>user.balance) return showToast("Not enough Brent Bucks!","error");
    const win=calcWin(stake,pick.odds);
    try{
      await db.updateUser(session.userId,{balance:+(user.balance-stake).toFixed(2)});
      await db.createBet({user_id:session.userId,type:"single",stake,potential_win:win,legs:[{fighter:pick.fighter,matchup:`${fight.fighter1} vs ${fight.fighter2}`,odds:pick.odds,fightId:fight.id,eventDate:fight.eventDate,event:fight.event}]});
      setPicks(p=>{const n={...p};delete n[fightId];return n;});
      showToast(`Bet placed! To win ₿${win.toFixed(2)}`); await load();
    }catch(e){ showToast("Error placing bet","error"); }
  };

  const cancelBet=async(betId)=>{
    const bet=bets.find(b=>b.id===betId);
    if(!bet||bet.status!=="pending") return;
    if(bet.legs.some(l=>isClosed(l.eventDate))) return showToast("Can't cancel — within 1 hour of fight","error");
    try{
      await db.updateBet(betId,{status:"cancelled"});
      await db.updateUser(session.userId,{balance:+(user.balance+bet.stake).toFixed(2)});
      showToast("Bet cancelled — stake refunded"); await load();
    }catch(e){ showToast("Error","error"); }
  };

  const reqDeposit=async()=>{
    const amt=parseFloat(cash); if(!amt||amt<=0) return showToast("Enter valid amount","error");
    try{ await db.createTransaction({user_id:session.userId,type:"deposit",amount:amt,status:"pending"}); setCash(""); showToast("Deposit requested! Bring cash to Brent in person."); await load(); }catch(e){ showToast("Error","error"); }
  };
  const reqWithdraw=async()=>{
    const amt=parseFloat(cash); if(!amt||amt<=0) return showToast("Enter valid amount","error");
    if(amt>user.balance) return showToast("Not enough Brent Bucks!","error");
    try{ await db.createTransaction({user_id:session.userId,type:"withdraw",amount:amt,status:"pending"}); setCash(""); showToast("Withdrawal requested! Go see Brent to collect."); await load(); }catch(e){ showToast("Error","error"); }
  };

  const togglePrivacy=async()=>{
    try{ await db.updateUser(session.userId,{privacy_public:!user.privacy_public}); await load(); showToast(user.privacy_public?"Stats hidden from friends":"Stats now visible to friends"); }catch(e){ showToast("Error","error"); }
  };

  if(loading) return <Loader/>;
  if(!user)   return <div style={{color:"#fff",padding:40,textAlign:"center"}}>Error loading. Please refresh.</div>;

  const pnl=bets.reduce((a,b)=>b.status==="won"?a+b.potential_win:b.status==="lost"?a-b.stake:a,0);
  const pendingBets=bets.filter(b=>b.status==="pending").length;
  const friends=allUsers.filter(u=>u.id!==session.userId);
  const betsByUser={};
  allBets.forEach(b=>{ if(!betsByUser[b.user_id]) betsByUser[b.user_id]=[]; betsByUser[b.user_id].push(b); });

  return(
    <div style={S.root}>
      {toast&&<Toast t={toast}/>}
      <header style={S.hdr}>
        <div style={S.hdrInner}>
          <div style={S.logo}><span style={{fontSize:24,fontWeight:900,color:"#ffd600"}}>₿</span><span style={{fontSize:15,fontWeight:900,color:"#fff",letterSpacing:"0.05em"}}>MFL BETZONE</span></div>
          <div style={S.balPill}><span style={{fontSize:9,fontWeight:700,color:"#ffd600",letterSpacing:"0.1em"}}>BRENT BUCKS</span><span style={{fontSize:16,fontWeight:800,color:"#fff"}}>₿{(user.balance||0).toFixed(2)}</span></div>
        </div>
        <nav style={S.nav}>
          {[{id:"single",l:"🥊 SINGLE"},{id:"parlay",l:"🔥 PARLAY"},{id:"mybets",l:`🎯 MY BETS${pendingBets>0?` (${pendingBets})`:""}`},{id:"friends",l:`👥 FRIENDS`},{id:"profile",l:"👤 PROFILE"}].map(n=>(
            <button key={n.id} style={{...S.navBtn,...(tab===n.id?S.navOn:{})}} onClick={()=>setTab(n.id)}>{n.l}</button>
          ))}
        </nav>
      </header>
      <main style={S.main}>

        {tab==="single"&&(
          <div>
            <OBar mins={mins} secs={secs} lastUpd={lastUpd}/>
            <IBox>Pick <strong style={{color:"#ffd600"}}>one fighter</strong> per fight. Enter your stake and place the bet. You win or lose based on that fight result.</IBox>
            {["UFC 315","UFC 316"].map(evt=>{
              const ef=fights.filter(f=>f.event===evt);
              return(<div key={evt} style={{marginBottom:24}}>
                <EvHdr fight={ef[0]}/>
                {ef.map(fight=>{
                  const pick=picks[fight.id]; const closed=isClosed(fight.eventDate);
                  const stake=parseFloat(pick?.stake)||0; const payout=stake&&pick?calcWin(stake,pick.odds):0;
                  return(<div key={fight.id} style={{...S.fightCard,opacity:closed?0.5:1}}>
                    {closed&&<ClosedBnr/>}
                    <div style={S.wt}>{fight.weight}</div>
                    <div style={{display:"flex",gap:8}}>
                      <FBtn name={fight.fighter1} odds={fight.odds1} active={pick?.fighter===fight.fighter1} disabled={closed} onClick={()=>setPick(fight.id,fight.fighter1,fight.odds1)}/>
                      <div style={{fontSize:11,fontWeight:700,color:"#333",display:"flex",alignItems:"center",flexShrink:0}}>VS</div>
                      <FBtn name={fight.fighter2} odds={fight.odds2} active={pick?.fighter===fight.fighter2} disabled={closed} onClick={()=>setPick(fight.id,fight.fighter2,fight.odds2)}/>
                    </div>
                    {pick&&!closed&&(
                      <div style={{marginTop:12,padding:"12px",background:"#070709",borderRadius:8,border:"1px solid #ffd60022"}}>
                        <div style={{fontSize:12,color:"#777",marginBottom:8}}>Betting on <strong style={{color:"#ffd600"}}>{pick.fighter}</strong> ({fmtOdds(pick.odds)})</div>
                        <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                          <SInput value={pick.stake} onChange={v=>setStake(fight.id,v)}/>
                          <span style={{fontSize:12,color:"#666",whiteSpace:"nowrap"}}>Win: <strong style={{color:"#00e676"}}>₿{payout.toFixed(2)}</strong></span>
                          <button style={S.btn} onClick={()=>placeBet(fight.id)}>PLACE BET</button>
                        </div>
                      </div>
                    )}
                  </div>);
                })}
              </div>);
            })}
            <NFLCS/>
          </div>
        )}

        {tab==="parlay"&&(
          <div style={{textAlign:"center",padding:"56px 24px"}}>
            <div style={{fontSize:56,marginBottom:16}}>🔥</div>
            <div style={{fontSize:22,fontWeight:900,color:"#fff",marginBottom:8,letterSpacing:"0.03em"}}>PARLAY BETS</div>
            <div style={{fontSize:13,color:"#555",lineHeight:1.7,marginBottom:24}}>Pick multiple fights and multiply your winnings.<br/>All picks must win for the parlay to pay out.</div>
            <span style={{background:"#120e00",color:"#ffd600",border:"1px solid #ffd60033",borderRadius:8,padding:"10px 24px",fontSize:13,fontWeight:700,letterSpacing:"0.12em"}}>COMING SOON</span>
          </div>
        )}

        {tab==="mybets"&&(
          <div>
            <div style={{fontSize:17,fontWeight:800,color:"#fff",marginBottom:4}}>🎯 My Bets</div>
            <div style={{fontSize:12,color:"#444",marginBottom:16}}>Pending bets can be cancelled up to 1 hour before the fight starts.</div>
            {bets.length===0?<Empty icon="🎯" title="No bets yet" sub="Head to Single to place your first bet"/>
            :bets.map(bet=>{
              const canCancel=bet.status==="pending"&&!bet.legs.some(l=>isClosed(l.eventDate));
              return(<div key={bet.id} style={{...S.card,marginBottom:10}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
                  <div style={{display:"flex",gap:6,alignItems:"center"}}>
                    <span style={S.typeBadge}>{bet.type==="parlay"?`${bet.legs.length}-LEG PARLAY`:"SINGLE"}</span>
                    <span style={{fontSize:10,color:"#333"}}>{new Date(bet.placed_at).toLocaleDateString("en-US",{timeZone:"America/New_York"})}</span>
                  </div>
                  <SPill s={bet.status}/>
                </div>
                {bet.legs.map((l,i)=>(
                  <div key={i} style={{fontSize:12,color:"#aaa",marginBottom:3}}>
                    <span style={{color:"#555"}}>{l.matchup}</span> → <strong style={{color:"#ffd600"}}>{l.fighter}</strong>
                    <span style={{color:"#444",marginLeft:4}}>({fmtOdds(l.odds)})</span>
                  </div>
                ))}
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:10,flexWrap:"wrap",gap:8}}>
                  <div style={{display:"flex",gap:14,fontSize:12,color:"#555"}}>
                    <span>Stake: <strong style={{color:"#ccc"}}>₿{bet.stake}</strong></span>
                    <span>To win: <strong style={{color:"#00e676"}}>₿{(bet.potential_win||0).toFixed(2)}</strong></span>
                  </div>
                  {canCancel&&<button style={{background:"none",border:"1px solid #e5393555",color:"#e53935",borderRadius:6,padding:"5px 12px",fontSize:11,fontWeight:700,cursor:"pointer"}} onClick={()=>cancelBet(bet.id)}>CANCEL BET</button>}
                  {bet.status==="pending"&&!canCancel&&<span style={{fontSize:10,color:"#333"}}>🔒 Cancellation closed</span>}
                </div>
              </div>);
            })}
          </div>
        )}

        {tab==="friends"&&(
          <div>
            <div style={{fontSize:17,fontWeight:800,color:"#fff",marginBottom:4}}>👥 Friends</div>
            <div style={{fontSize:12,color:"#444",marginBottom:16}}>Everyone on MFL Betzone is automatically added. You can hide your own stats in Profile.</div>
            {friends.length===0?<Empty icon="👥" title="No other players yet" sub="Invite your crew to join MFL Betzone"/>
            :friends.map(fr=>{
              const fBets=betsByUser[fr.id]||[];
              const fPnl=fBets.reduce((a,b)=>b.status==="won"?a+b.potential_win:b.status==="lost"?a-b.stake:a,0);
              return(<div key={fr.id} style={{...S.card,marginBottom:10}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12}}>
                  <div style={{display:"flex",alignItems:"center",gap:12}}>
                    <div style={S.avSm}>{fr.display_name[0].toUpperCase()}</div>
                    <div>
                      <div style={{fontSize:14,fontWeight:700,color:"#fff"}}>{fr.display_name}</div>
                      <div style={{fontSize:11,color:"#444"}}>@{fr.username} · {(betsByUser[fr.id]||[]).length} bets</div>
                    </div>
                  </div>
                  {fr.privacy_public?(
                    <div style={{textAlign:"right",fontSize:12,color:"#666"}}>
                      <div>Deposited: <strong style={{color:"#ccc"}}>₿{(fr.cash_in||0).toFixed(2)}</strong></div>
                      <div>Withdrawn: <strong style={{color:"#ccc"}}>₿{(fr.cash_out||0).toFixed(2)}</strong></div>
                      <div>P&L: <strong style={{color:fPnl>=0?"#00e676":"#ff5252"}}>{fPnl>=0?"+":""}₿{fPnl.toFixed(2)}</strong></div>
                    </div>
                  ):<div style={{fontSize:11,color:"#333"}}>🔒 Stats private</div>}
                </div>
              </div>);
            })}
          </div>
        )}

        {tab==="profile"&&(
          <div>
            <div style={S.profHero}>
              <div style={S.av}>{user.display_name[0].toUpperCase()}</div>
              <div style={{fontSize:18,fontWeight:800,color:"#fff",marginBottom:2}}>{user.display_name}</div>
              <div style={{fontSize:11,color:"#444",marginBottom:10}}>@{user.username}</div>
              <div style={{fontSize:34,fontWeight:900,color:"#ffd600"}}>₿{(user.balance||0).toFixed(2)}</div>
              <div style={{fontSize:10,fontWeight:700,letterSpacing:"0.12em",color:"#333",marginTop:4}}>BRENT BUCKS BALANCE</div>
            </div>
            <div style={S.grid2}>
              {[{l:"Deposited",v:`₿${(user.cash_in||0).toFixed(2)}`},{l:"P&L",v:`${pnl>=0?"+":""}₿${pnl.toFixed(2)}`,c:pnl>=0?"#00e676":"#ff5252"},{l:"Total Bets",v:bets.length},{l:"Wins",v:bets.filter(b=>b.status==="won").length}].map(c=>(
                <div key={c.l} style={S.statCard}>
                  <div style={{fontSize:22,fontWeight:800,color:c.c||"#fff",marginBottom:4}}>{c.v}</div>
                  <div style={{fontSize:10,fontWeight:600,color:"#444",letterSpacing:"0.06em"}}>{c.l}</div>
                </div>
              ))}
            </div>
            <div style={{...S.card,marginBottom:12,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div>
                <div style={{fontSize:13,fontWeight:700,color:"#fff"}}>Stats Visibility</div>
                <div style={{fontSize:11,color:"#444",marginTop:2}}>{user.privacy_public?"Friends can see your deposited, withdrawn & P&L":"Your stats are hidden from friends"}</div>
              </div>
              <button onClick={togglePrivacy} style={{...S.btn,background:"transparent",border:`1px solid ${user.privacy_public?"#00e67644":"#ffd60044"}`,color:user.privacy_public?"#00e676":"#ffd600",fontSize:11,padding:"8px 14px"}}>
                {user.privacy_public?"🟢 Public":"🔴 Private"}
              </button>
            </div>
            <div style={{...S.card,marginBottom:12}}>
              <div style={{fontSize:14,fontWeight:800,color:"#fff",marginBottom:10}}>💵 Cash In / Withdraw</div>
              <div style={{background:"#070709",border:"1px solid #1a1a1a",borderRadius:8,padding:"10px 14px",fontSize:12,color:"#777",lineHeight:1.7,marginBottom:14}}>
                <strong style={{color:"#ffd600"}}>Deposit:</strong> Enter amount → tap Request → bring cash to Brent in person.<br/>
                <strong style={{color:"#ffd600"}}>Withdraw:</strong> Enter amount → tap Request → go see Brent to collect cash.<br/>
                <span style={{color:"#333"}}>$1 USD = ₿1 Brent Bucks</span>
              </div>
              <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:10}}>
                <SInput prefix="$" value={cash} onChange={setCash} ph="Amount"/>
                <button style={S.btn} onClick={reqDeposit}>REQUEST DEPOSIT</button>
                <button style={{...S.btn,background:"transparent",border:"1px solid #e53935",color:"#e53935"}} onClick={reqWithdraw}>REQUEST WITHDRAW</button>
              </div>
              {txs.filter(t=>t.status==="pending").length>0&&(
                <div style={{fontSize:12,color:"#ffd600",background:"#0d0900",borderRadius:6,padding:"8px 12px"}}>
                  ⏳ {txs.filter(t=>t.status==="pending").length} request{txs.filter(t=>t.status==="pending").length>1?"s":""} pending — waiting for Brent
                </div>
              )}
            </div>
            {txs.length>0&&(
              <div>
                <div style={S.secLabel}>TRANSACTION HISTORY</div>
                {txs.map(tx=>(
                  <div key={tx.id} style={{...S.card,display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                    <div><span style={{fontSize:13,fontWeight:700,color:"#fff"}}>{tx.type==="deposit"?"💵 Deposit":"💸 Withdrawal"}</span><span style={{fontSize:11,color:"#333",marginLeft:8}}>{new Date(tx.created_at).toLocaleDateString("en-US",{timeZone:"America/New_York"})}</span></div>
                    <div style={{display:"flex",gap:8,alignItems:"center"}}>
                      <span style={{fontSize:13,fontWeight:800,color:tx.type==="deposit"?"#00e676":"#ff6b35"}}>{tx.type==="deposit"?"+":"−"}₿{tx.amount.toFixed(2)}</span>
                      <SPill s={tx.status}/>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <button style={{...S.ghost,width:"100%",marginTop:20}} onClick={logout}>Sign Out</button>
          </div>
        )}
      </main>
      <footer style={{textAlign:"center",padding:"18px",fontSize:10,color:"#1a1a1a",borderTop:"1px solid #111"}}>MFL Betzone · ₿1 Brent Bucks = $1 USD · All times EST</footer>
    </div>
  );
}

// ─── ADMIN ────────────────────────────────────────────────────────────────────
function AdminPanel({logout,showToast,toast}){
  const [tab,setTab]=useState("requests");
  const [users,setUsers]=useState([]); const [allBets,setAllBets]=useState([]); const [pendTxs,setPend]=useState([]); const [allTxs,setAllTxs]=useState([]);
  const [exp,setExp]=useState(null); const [showPw,setShowPw]=useState({}); const [loading,setLoading]=useState(true);

  const load=useCallback(async()=>{
    try{
      const [u,b,p,a]=await Promise.all([db.getAllUsers(),db.getAllBets(),db.getPendingTxs(),db.getAllTransactions()]);
      setUsers(u||[]); setAllBets(b||[]); setPend(p||[]); setAllTxs(a||[]);
    }catch(e){ showToast("Error loading","error"); }
    finally{ setLoading(false); }
  },[]);
  useEffect(()=>{ load(); },[load]);

  const approve=async(txId)=>{
    const tx=[...allTxs,...pendTxs].find(t=>t.id===txId); const u=users.find(x=>x.id===tx?.user_id);
    if(!tx||!u) return;
    try{
      await db.updateTransaction(txId,{status:"approved"});
      const upd={balance:+(u.balance+(tx.type==="deposit"?tx.amount:0)).toFixed(2)};
      if(tx.type==="deposit") upd.cash_in=+((u.cash_in||0)+tx.amount).toFixed(2);
      else upd.cash_out=+((u.cash_out||0)+tx.amount).toFixed(2);
      await db.updateUser(u.id,upd);
      showToast("Approved ✓"); await load();
    }catch(e){ showToast("Error","error"); }
  };
  const reject=async(txId)=>{
    const tx=[...allTxs,...pendTxs].find(t=>t.id===txId); const u=users.find(x=>x.id===tx?.user_id);
    if(!tx) return;
    try{
      await db.updateTransaction(txId,{status:"rejected"});
      if(tx.type==="withdraw"&&u) await db.updateUser(u.id,{balance:+(u.balance+tx.amount).toFixed(2)});
      showToast("Rejected","error"); await load();
    }catch(e){ showToast("Error","error"); }
  };

  const totDep=allTxs.filter(t=>t.type==="deposit"&&t.status==="approved").reduce((a,t)=>a+t.amount,0);
  const totWith=allTxs.filter(t=>t.type==="withdraw"&&t.status==="approved").reduce((a,t)=>a+t.amount,0);
  const totHeld=users.reduce((a,u)=>a+(u.balance||0),0);
  const gBets=uid=>allBets.filter(b=>b.user_id===uid);
  const gTxs=uid=>allTxs.filter(t=>t.user_id===uid);
  const gPnl=uid=>gBets(uid).reduce((a,b)=>b.status==="won"?a+b.potential_win:b.status==="lost"?a-b.stake:a,0);

  if(loading) return <Loader/>;
  return(
    <div style={S.root}>
      {toast&&<Toast t={toast}/>}
      <header style={{...S.hdr,borderBottom:"2px solid #e53935"}}>
        <div style={S.hdrInner}>
          <div style={S.logo}><span style={{fontSize:18,color:"#e53935",marginRight:2}}>⚙</span><div><div style={{fontSize:14,fontWeight:900,color:"#fff",letterSpacing:"0.05em"}}>MFL BETZONE</div><div style={{fontSize:9,fontWeight:700,color:"#e53935",letterSpacing:"0.14em"}}>ADMIN · BRENT</div></div></div>
          <button style={{...S.ghost,fontSize:11,padding:"6px 12px"}} onClick={logout}>Sign Out</button>
        </div>
        <nav style={S.nav}>
          {[{id:"requests",l:`🔔 REQUESTS${pendTxs.length>0?` (${pendTxs.length})`:""}`},{id:"users",l:`👥 USERS (${users.length})`},{id:"overview",l:"📊 OVERVIEW"}].map(n=>(
            <button key={n.id} style={{...S.navBtn,...(tab===n.id?{...S.navOn,color:"#e53935",borderBottomColor:"#e53935"}:{})}} onClick={()=>setTab(n.id)}>{n.l}</button>
          ))}
        </nav>
      </header>
      <main style={S.main}>

        {tab==="requests"&&(
          <div>
            <div style={S.secLabel}>PENDING ({pendTxs.length})</div>
            {pendTxs.length===0?<Empty icon="✓" title="All clear" sub="No pending requests"/>
            :pendTxs.map(tx=>{
              const u=users.find(x=>x.id===tx.user_id);
              return(<div key={tx.id} style={{...S.card,border:"1px solid #ffd60022",marginBottom:10}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:10}}>
                  <div>
                    <div style={{fontSize:14,fontWeight:800,color:"#fff",marginBottom:3}}>{tx.type==="deposit"?"💵 Deposit Request":"💸 Withdrawal Request"}</div>
                    <div style={{fontSize:13,color:"#888",marginBottom:6}}><strong style={{color:"#ffd600"}}>{u?.display_name||"Unknown"}</strong> · <strong style={{color:"#fff"}}>₿{tx.amount.toFixed(2)}</strong> · {new Date(tx.created_at).toLocaleDateString("en-US",{timeZone:"America/New_York"})}</div>
                    <div style={{fontSize:11,color:"#666",background:"#070709",borderRadius:6,padding:"6px 10px"}}>{tx.type==="deposit"?`⚠️ Confirm you received $${tx.amount.toFixed(2)} cash from ${u?.display_name}`:`⚠️ Hand $${tx.amount.toFixed(2)} cash to ${u?.display_name}`}</div>
                  </div>
                  <div style={{display:"flex",gap:8}}>
                    <button style={{...S.btn,background:"#00c853",padding:"9px 16px"}} onClick={()=>approve(tx.id)}>✓ APPROVE</button>
                    <button style={{...S.btn,background:"#e53935",padding:"9px 16px"}} onClick={()=>reject(tx.id)}>✕ REJECT</button>
                  </div>
                </div>
              </div>);
            })}
            {allTxs.filter(t=>t.status!=="pending").length>0&&(
              <><div style={{...S.secLabel,marginTop:24}}>RECENTLY SETTLED</div>
              {allTxs.filter(t=>t.status!=="pending").slice(0,20).map(tx=>{
                const u=users.find(x=>x.id===tx.user_id);
                return(<div key={tx.id} style={{...S.card,display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6,flexWrap:"wrap",gap:6}}>
                  <div><span style={{fontSize:13,fontWeight:700,color:"#fff"}}>{tx.type==="deposit"?"💵":"💸"} {u?.display_name||"?"}</span><span style={{fontSize:11,color:"#333",marginLeft:8}}>{new Date(tx.created_at).toLocaleDateString("en-US",{timeZone:"America/New_York"})}</span></div>
                  <div style={{display:"flex",gap:8,alignItems:"center"}}><span style={{fontSize:13,fontWeight:800,color:tx.type==="deposit"?"#00e676":"#ff6b35"}}>{tx.type==="deposit"?"+":"−"}₿{tx.amount.toFixed(2)}</span><SPill s={tx.status}/></div>
                </div>);
              })}</>
            )}
          </div>
        )}

        {tab==="users"&&(
          <div>
            <div style={S.secLabel}>ALL USERS</div>
            {users.length===0&&<Empty icon="👥" title="No users yet" sub="Users appear here once they sign up"/>}
            {users.map(u=>{
              const open=exp===u.id; const ub=gBets(u.id); const ut=gTxs(u.id); const up=gPnl(u.id);
              return(<div key={u.id} style={{...S.card,marginBottom:10}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer"}} onClick={()=>setExp(open?null:u.id)}>
                  <div style={{display:"flex",alignItems:"center",gap:12}}>
                    <div style={{...S.avSm,margin:0}}>{u.display_name[0].toUpperCase()}</div>
                    <div><div style={{fontSize:14,fontWeight:700,color:"#fff"}}>{u.display_name}</div><div style={{fontSize:11,color:"#444"}}>@{u.username} · {ub.length} bet{ub.length!==1?"s":""}</div></div>
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:12}}>
                    <div style={{textAlign:"right"}}><div style={{fontSize:15,fontWeight:800,color:"#ffd600"}}>₿{(u.balance||0).toFixed(2)}</div><div style={{fontSize:10,color:up>=0?"#00e676":"#ff5252"}}>{up>=0?"+":""}₿{up.toFixed(2)} P&L</div></div>
                    <span style={{color:"#222",fontSize:12}}>{open?"▲":"▼"}</span>
                  </div>
                </div>
                {open&&(
                  <div style={{marginTop:14,borderTop:"1px solid #111",paddingTop:14}}>
                    <div style={{background:"#070709",borderRadius:8,padding:"12px",marginBottom:14,border:"1px solid #1a1a1a"}}>
                      <div style={{fontSize:10,fontWeight:700,color:"#333",letterSpacing:"0.1em",marginBottom:8}}>ACCOUNT CREDENTIALS</div>
                      <div style={{display:"flex",gap:20,flexWrap:"wrap",fontSize:13}}>
                        <div><span style={{color:"#444"}}>Username: </span><strong style={{color:"#ffd600"}}>@{u.username}</strong></div>
                        <div style={{display:"flex",alignItems:"center",gap:8}}>
                          <span style={{color:"#444"}}>Password: </span>
                          <strong style={{color:"#fff",fontFamily:"monospace"}}>{showPw[u.id]?unHash(u.password_hash):"••••••••"}</strong>
                          <button style={{background:"none",border:"1px solid #1e1e1e",color:"#666",borderRadius:4,padding:"2px 8px",fontSize:10,cursor:"pointer"}} onClick={()=>setShowPw(p=>({...p,[u.id]:!p[u.id]}))}>
                            {showPw[u.id]?"Hide":"Show"}
                          </button>
                        </div>
                      </div>
                    </div>
                    <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:14}}>
                      {[{l:"Balance",v:`₿${(u.balance||0).toFixed(2)}`},{l:"Deposited",v:`₿${(u.cash_in||0).toFixed(2)}`},{l:"Withdrawn",v:`₿${(u.cash_out||0).toFixed(2)}`},{l:"Total Bets",v:ub.length},{l:"Wins",v:ub.filter(b=>b.status==="won").length},{l:"P&L",v:`${up>=0?"+":""}₿${up.toFixed(2)}`,c:up>=0?"#00e676":"#ff5252"}].map(s=>(
                        <div key={s.l} style={{background:"#070709",borderRadius:8,padding:"10px",textAlign:"center"}}><div style={{fontSize:14,fontWeight:800,color:s.c||"#fff"}}>{s.v}</div><div style={{fontSize:9,color:"#333",marginTop:2,letterSpacing:"0.06em"}}>{s.l}</div></div>
                      ))}
                    </div>
                    {ub.length>0&&(<>
                      <div style={S.secLabel}>BETS</div>
                      {ub.map(b=>(<div key={b.id} style={{...S.card,background:"#070709",marginBottom:6}}>
                        <div style={{display:"flex",justifyContent:"space-between",marginBottom:5}}><span style={S.typeBadge}>{b.type==="parlay"?`${b.legs.length}-LEG PARLAY`:"SINGLE"}</span><SPill s={b.status}/></div>
                        {b.legs.map((l,i)=><div key={i} style={{fontSize:12,color:"#aaa",marginBottom:2}}>{l.matchup} → <strong style={{color:"#ffd600"}}>{l.fighter}</strong> <span style={{color:"#444"}}>({fmtOdds(l.odds)})</span></div>)}
                        <div style={{display:"flex",gap:12,fontSize:11,color:"#444",marginTop:6}}><span>Stake: <strong style={{color:"#888"}}>₿{b.stake}</strong></span><span>To win: <strong style={{color:"#00e676"}}>₿{(b.potential_win||0).toFixed(2)}</strong></span><span>{new Date(b.placed_at).toLocaleDateString("en-US",{timeZone:"America/New_York"})}</span></div>
                      </div>))}
                    </>)}
                    {ut.length>0&&(<>
                      <div style={{...S.secLabel,marginTop:12}}>TRANSACTIONS</div>
                      {ut.map(tx=><div key={tx.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"7px 0",borderBottom:"1px solid #0d0d0d",fontSize:12}}>
                        <span style={{color:"#555"}}>{tx.type==="deposit"?"💵 Deposit":"💸 Withdraw"} · {new Date(tx.created_at).toLocaleDateString("en-US",{timeZone:"America/New_York"})}</span>
                        <div style={{display:"flex",gap:8,alignItems:"center"}}><span style={{fontWeight:700,color:tx.type==="deposit"?"#00e676":"#ff6b35"}}>{tx.type==="deposit"?"+":"−"}₿{tx.amount.toFixed(2)}</span><SPill s={tx.status}/></div>
                      </div>)}
                    </>)}
                  </div>
                )}
              </div>);
            })}
          </div>
        )}

        {tab==="overview"&&(
          <div>
            <div style={S.secLabel}>SPORTSBOOK OVERVIEW</div>
            <div style={S.grid2}>
              {[{l:"Registered Users",v:users.length,i:"👥"},{l:"Brent Bucks in Play",v:`₿${totHeld.toFixed(2)}`,i:"💰",c:"#ffd600"},{l:"Total Deposited",v:`₿${totDep.toFixed(2)}`,i:"📥",c:"#00e676"},{l:"Total Withdrawn",v:`₿${totWith.toFixed(2)}`,i:"📤",c:"#ff6b35"},{l:"Total Bets Placed",v:allBets.length,i:"🎯"},{l:"Pending Requests",v:pendTxs.length,i:"🔔",c:pendTxs.length>0?"#ffd600":"#fff"}].map(s=>(
                <div key={s.l} style={S.statCard}><div style={{fontSize:20,marginBottom:6}}>{s.i}</div><div style={{fontSize:22,fontWeight:800,color:s.c||"#fff",marginBottom:4}}>{s.v}</div><div style={{fontSize:10,fontWeight:600,color:"#333",letterSpacing:"0.06em"}}>{s.l}</div></div>
              ))}
            </div>
            <div style={S.secLabel}>LEADERBOARD</div>
            {users.sort((a,b)=>(b.balance||0)-(a.balance||0)).map((u,i)=>(
              <div key={u.id} style={{...S.card,display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  <span style={{fontSize:13,fontWeight:800,color:i===0?"#ffd600":i===1?"#aaa":i===2?"#cd7f32":"#333",minWidth:24}}>#{i+1}</span>
                  <div style={{...S.avSm,margin:0}}>{u.display_name[0]}</div>
                  <div><div style={{fontSize:13,fontWeight:600,color:"#fff"}}>{u.display_name}</div><div style={{fontSize:10,color:"#333"}}>@{u.username}</div></div>
                </div>
                <span style={{fontSize:15,fontWeight:800,color:"#ffd600"}}>₿{(u.balance||0).toFixed(2)}</span>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

// ─── SMALL COMPONENTS ─────────────────────────────────────────────────────────
const OBar=({mins,secs,lastUpd})=>(
  <div style={{background:"#070709",border:"1px solid #111",borderRadius:8,padding:"9px 14px",display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
    <span style={{fontSize:11,fontWeight:700,color:"#ffd600"}}>⏱ LIVE ODDS — refresh in {mins}:{String(secs).padStart(2,"0")}</span>
    <span style={{fontSize:10,color:"#2a2a2a"}}>{lastUpd.toLocaleTimeString("en-US",{timeZone:"America/New_York"})}</span>
  </div>
);
const IBox=({children})=><div style={{background:"#070709",border:"1px solid #111",borderRadius:8,padding:"10px 14px",fontSize:12,color:"#666",marginBottom:14,lineHeight:1.7}}>{children}</div>;
const EvHdr=({fight})=>(
  <div style={{display:"flex",alignItems:"center",gap:12,padding:"12px 16px",background:"#070709",border:"1px solid #111",borderBottom:"none",borderRadius:"10px 10px 0 0"}}>
    <span style={{fontSize:18}}>🥊</span>
    <div><div style={{fontSize:14,fontWeight:800,color:"#fff"}}>{fight?.event}</div><div style={{fontSize:11,color:"#444"}}>{fmtDt(fight?.eventDate)}</div></div>
    <span style={{marginLeft:"auto",fontSize:9,fontWeight:700,letterSpacing:"0.1em",background:"#081208",color:"#00e676",border:"1px solid #00e67622",borderRadius:4,padding:"3px 8px"}}>UPCOMING</span>
  </div>
);
const FBtn=({name,odds,active,disabled,onClick})=>(
  <button disabled={disabled} onClick={onClick} style={{flex:1,background:active?"#111120":"#070709",border:active?"1px solid #ffd600":"1px solid #111",borderRadius:8,padding:"12px 8px",cursor:disabled?"not-allowed":"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:6,boxShadow:active?"0 0 10px #ffd60018":"none",transition:"all 0.15s"}}>
    <span style={{fontSize:12,fontWeight:700,color:"#fff",textAlign:"center",lineHeight:1.3}}>{name}</span>
    <span style={{fontSize:16,fontWeight:900,color:odds<0?"#ff6b35":"#00e676"}}>{fmtOdds(odds)}</span>
  </button>
);
const SInput=({value,onChange,prefix="₿",ph="Stake"})=>(
  <div style={{display:"flex",alignItems:"center",background:"#070709",border:"1px solid #111",borderRadius:8,padding:"8px 12px",flex:1,minWidth:100}}>
    <span style={{fontSize:13,fontWeight:700,color:"#ffd600",marginRight:4}}>{prefix}</span>
    <input style={{background:"none",border:"none",color:"#fff",fontSize:14,fontWeight:700,width:"100%",outline:"none"}} type="number" placeholder={ph} value={value} onChange={e=>onChange(e.target.value)} min="0"/>
  </div>
);
const ClosedBnr=()=><div style={{background:"#120808",border:"1px solid #e5393522",borderRadius:6,padding:"6px 12px",fontSize:11,color:"#e53935",fontWeight:600,textAlign:"center",marginBottom:10}}>🔒 Betting closed — fight starts in under 1 hour</div>;
const NFLCS=()=>(
  <div style={{background:"#070709",border:"1px solid #111",borderRadius:12,padding:"28px",textAlign:"center",marginTop:16}}>
    <div style={{fontSize:38,marginBottom:8}}>🏈</div>
    <div style={{fontSize:18,fontWeight:900,color:"#fff",marginBottom:6}}>NFL BETTING</div>
    <div style={{fontSize:12,color:"#444",marginBottom:14}}>Coming Soon — Season kicks off Fall 2026</div>
    <span style={{background:"#120a00",color:"#ff9800",border:"1px solid #ff980022",borderRadius:6,padding:"5px 14px",fontSize:11,fontWeight:700,letterSpacing:"0.1em"}}>COMING SOON</span>
  </div>
);
const SPill=({s})=>{
  const m={won:["#00c85318","#00e676"],lost:["#e5393518","#ff5252"],cancelled:["#1a1a1a","#444"],pending:["#ffd60018","#ffd600"],approved:["#00c85318","#00e676"],rejected:["#e5393518","#ff5252"]};
  const [bg,c]=m[s]||["#1a1a1a","#555"];
  return <span style={{fontSize:9,fontWeight:700,letterSpacing:"0.08em",padding:"2px 8px",borderRadius:3,background:bg,color:c}}>{s?.toUpperCase()}</span>;
};
const Fld=({label,children})=>(
  <div style={{marginBottom:16}}><label style={{fontSize:11,fontWeight:700,color:"#444",letterSpacing:"0.08em",display:"block",marginBottom:6}}>{label}</label>{children}</div>
);
const Toast=({t})=>(
  <div style={{position:"fixed",top:76,left:"50%",transform:"translateX(-50%)",padding:"12px 24px",borderRadius:8,fontWeight:700,fontSize:13,zIndex:1000,color:"#fff",boxShadow:"0 4px 20px #000000bb",whiteSpace:"nowrap",background:t.type==="error"?"#b71c1c":"#00c853"}}>
    {t.msg}
  </div>
);
const Empty=({icon,title,sub})=>(
  <div style={{textAlign:"center",padding:"48px 20px"}}>
    <div style={{fontSize:44,marginBottom:10}}>{icon}</div>
    <div style={{fontSize:15,fontWeight:700,color:"#666"}}>{title}</div>
    {sub&&<div style={{fontSize:12,color:"#333",marginTop:4}}>{sub}</div>}
  </div>
);
const Loader=()=>(
  <div style={{display:"flex",alignItems:"center",justifyContent:"center",minHeight:"100vh",background:"#0a0a0f"}}>
    <div style={{textAlign:"center"}}><div style={{fontSize:36,fontWeight:900,color:"#ffd600",marginBottom:10}}>₿</div><div style={{fontSize:13,color:"#333"}}>Loading MFL Betzone...</div></div>
  </div>
);

// ─── STYLES ───────────────────────────────────────────────────────────────────
const S={
  root:{minHeight:"100vh",background:"#0a0a0f",color:"#f0f0f0",fontFamily:"'Inter','SF Pro Display',system-ui,sans-serif",maxWidth:820,margin:"0 auto"},
  hdr:{background:"#0a0a0f",borderBottom:"1px solid #111",position:"sticky",top:0,zIndex:100},
  hdrInner:{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"12px 18px 10px"},
  logo:{display:"flex",alignItems:"center",gap:8},
  balPill:{background:"#0d0d12",border:"1px solid #ffd60022",borderRadius:20,padding:"5px 14px",display:"flex",flexDirection:"column",alignItems:"center"},
  nav:{display:"flex",borderTop:"1px solid #111",overflowX:"auto"},
  navBtn:{flex:1,background:"none",border:"none",color:"#333",padding:"10px 6px",fontSize:10,fontWeight:700,letterSpacing:"0.06em",cursor:"pointer",borderBottom:"2px solid transparent",whiteSpace:"nowrap",minWidth:58},
  navOn:{color:"#ffd600",borderBottomColor:"#ffd600"},
  main:{padding:"16px 16px 80px"},
  fightCard:{background:"#0a0a0f",border:"1px solid #111",borderTop:"none",padding:"14px 16px"},
  wt:{fontSize:10,fontWeight:700,color:"#444",letterSpacing:"0.07em",marginBottom:10},
  profHero:{textAlign:"center",padding:"28px 20px",background:"#0d0d12",borderRadius:12,border:"1px solid #111",marginBottom:16},
  av:{width:52,height:52,borderRadius:"50%",background:"#ffd600",color:"#0a0a0f",fontSize:22,fontWeight:900,display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 10px"},
  avSm:{width:36,height:36,borderRadius:"50%",background:"#ffd600",color:"#0a0a0f",fontSize:15,fontWeight:900,display:"flex",alignItems:"center",justifyContent:"center"},
  grid2:{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14},
  statCard:{background:"#0d0d12",border:"1px solid #111",borderRadius:10,padding:"16px",textAlign:"center"},
  card:{background:"#0d0d12",border:"1px solid #111",borderRadius:8,padding:"12px 14px"},
  typeBadge:{fontSize:9,fontWeight:700,letterSpacing:"0.08em",background:"#111",color:"#444",padding:"2px 7px",borderRadius:3},
  secLabel:{fontSize:10,fontWeight:700,letterSpacing:"0.12em",color:"#2a2a2a",marginBottom:12,paddingBottom:8,borderBottom:"1px solid #0d0d0d"},
  btn:{background:"#ffd600",color:"#0a0a0f",border:"none",borderRadius:8,padding:"10px 16px",fontSize:12,fontWeight:800,cursor:"pointer",letterSpacing:"0.04em",whiteSpace:"nowrap"},
  ghost:{background:"none",border:"1px solid #1a1a1a",color:"#555",borderRadius:8,padding:"10px 16px",fontSize:12,fontWeight:600,cursor:"pointer",textAlign:"center"},
  loginWrap:{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",minHeight:"100vh",padding:"24px"},
  loginCard:{background:"#0d0d12",border:"1px solid #1a1a1a",borderRadius:16,padding:"26px 22px",width:"100%",maxWidth:380},
  tabTog:{flex:1,background:"none",border:"none",color:"#444",padding:"10px",fontSize:12,fontWeight:700,cursor:"pointer"},
  tabOn:{background:"#ffd600",color:"#0a0a0f",borderRadius:7},
  inp:{width:"100%",background:"#070709",border:"1px solid #1a1a1a",borderRadius:8,padding:"11px 14px",color:"#fff",fontSize:14,outline:"none",boxSizing:"border-box"},
  modalBg:{position:"fixed",inset:0,background:"#000000dd",zIndex:200,display:"flex",alignItems:"center",justifyContent:"center",padding:"20px"},
  modalBox:{background:"#0d0d12",border:"1px solid #1a1a1a",borderRadius:16,padding:"26px 22px",maxWidth:420,width:"100%",maxHeight:"80vh",overflowY:"auto"},
};
