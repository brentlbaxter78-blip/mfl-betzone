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
  const t = await res.text();
  return t ? JSON.parse(t) : null;
};

const db = {
  findUser:    u   => sb(`users?username=eq.${encodeURIComponent(u.toLowerCase().trim())}&limit=1`),
  getUser:     id  => sb(`users?id=eq.${id}&limit=1`),
  allUsers:    ()  => sb(`users?select=id,username,display_name,balance,cash_in,cash_out,privacy_public,last_seen,created_at&order=created_at.asc`),
  addUser:     d   => sb(`users`, { method:"POST", body:JSON.stringify(d) }),
  patchUser:   (id,d) => sb(`users?id=eq.${id}`, { method:"PATCH", body:JSON.stringify(d) }),
  deleteUser:  id  => sb(`users?id=eq.${id}`, { method:"DELETE", prefer:"return=minimal" }),
  myBets:      uid => sb(`bets?user_id=eq.${uid}&order=placed_at.desc`),
  allBets:     ()  => sb(`bets?order=placed_at.desc`),
  addBet:      d   => sb(`bets`, { method:"POST", body:JSON.stringify(d) }),
  myTxs:       uid => sb(`transactions?user_id=eq.${uid}&order=created_at.desc`),
  allTxs:      ()  => sb(`transactions?order=created_at.desc`),
  pendingTxs:  ()  => sb(`transactions?status=eq.pending&order=created_at.asc`),
  addTx:       d   => sb(`transactions`, { method:"POST", body:JSON.stringify(d) }),
  patchTx:     (id,d) => sb(`transactions?id=eq.${id}`, { method:"PATCH", body:JSON.stringify(d) }),
  chat:        ()  => sb(`chat_messages?order=created_at.asc&limit=150`),
  sendChat:    d   => sb(`chat_messages`, { method:"POST", body:JSON.stringify(d) }),
  contacts:    ()  => sb(`contact_messages?order=created_at.desc`),
  markRead:    id  => sb(`contact_messages?id=eq.${id}`, { method:"PATCH", body:JSON.stringify({read:true}) }),
  onlineCount: ()  => sb(`users?last_seen=gte.${new Date(Date.now()-90000).toISOString()}&select=id`),
};

// ─── WORLD CUP + ODDS (10% VIG BAKED IN) ────────────────────────────────────
const FLAGS = {
  "Argentina":"🇦🇷","France":"🇫🇷","Brazil":"🇧🇷","England":"🏴󠁧󠁢󠁥󠁮󠁧󠁿","Portugal":"🇵🇹",
  "Spain":"🇪🇸","Belgium":"🇧🇪","Netherlands":"🇳🇱","Germany":"🇩🇪","Croatia":"🇭🇷",
  "Uruguay":"🇺🇾","Italy":"🇮🇹","Switzerland":"🇨🇭","Colombia":"🇨🇴","USA":"🇺🇸",
  "Mexico":"🇲🇽","Japan":"🇯🇵","Morocco":"🇲🇦","Senegal":"🇸🇳","Denmark":"🇩🇰",
  "South Korea":"🇰🇷","Ecuador":"🇪🇨","Canada":"🇨🇦","Serbia":"🇷🇸","Ghana":"🇬🇭",
  "Cameroon":"🇨🇲","Tunisia":"🇹🇳","Iran":"🇮🇷","Costa Rica":"🇨🇷","Saudi Arabia":"🇸🇦",
  "Qatar":"🇶🇦","Australia":"🇦🇺","Poland":"🇵🇱","Nigeria":"🇳🇬","Algeria":"🇩🇿",
};
const STR = {
  "Argentina":1850,"France":1800,"Brazil":1780,"England":1750,"Portugal":1700,
  "Spain":1680,"Belgium":1620,"Netherlands":1640,"Germany":1600,"Croatia":1580,
  "Uruguay":1540,"Italy":1560,"Switzerland":1480,"Colombia":1460,"USA":1420,
  "Mexico":1400,"Japan":1380,"Morocco":1360,"Senegal":1340,"Denmark":1320,
  "South Korea":1260,"Ecuador":1240,"Canada":1220,"Serbia":1200,"Ghana":1160,
  "Cameroon":1140,"Tunisia":1120,"Iran":1100,"Costa Rica":1080,"Saudi Arabia":1040,
  "Qatar":980,"Australia":1280,"Poland":1300,"Nigeria":1120,"Algeria":1060,
};
const VIG = 0.10; // 10% house vig
const odds3 = (t1, t2) => {
  const s1=STR[t1]||1100, s2=STR[t2]||1100;
  const j=(Math.random()-0.5)*0.04;
  const rawP1=Math.min(0.88,Math.max(0.12,s1/(s1+s2)+j));
  const bal=1-Math.abs(rawP1-0.5)*1.6;
  const drawP=0.20+bal*0.12;
  const rem=1-drawP;
  // Apply vig: inflate implied probs by 10% so book has edge
  const p1=(rawP1*rem)*(1+VIG);
  const pD=drawP*(1+VIG);
  const p2=((1-rawP1)*rem)*(1+VIG);
  const ml=p=>p>=0.5?-Math.round(p/(1-p)*100):+Math.round((1-p)/p*100);
  return{o1:ml(p1),oDraw:ml(pD),o2:ml(p2)};
};

const FB=[
  {id:"f1",t1:"Argentina",  t2:"Croatia",    dt:"2026-06-26T19:00:00",rnd:"Group Stage · Group C"},
  {id:"f2",t1:"France",     t2:"Tunisia",    dt:"2026-06-26T19:00:00",rnd:"Group Stage · Group D"},
  {id:"f3",t1:"England",    t2:"Slovakia",   dt:"2026-06-26T22:00:00",rnd:"Group Stage · Group B"},
  {id:"f4",t1:"USA",        t2:"Iran",       dt:"2026-06-26T22:00:00",rnd:"Group Stage · Group A"},
  {id:"f5",t1:"Brazil",     t2:"Cameroon",   dt:"2026-06-27T19:00:00",rnd:"Group Stage · Group E"},
  {id:"f6",t1:"Spain",      t2:"Japan",      dt:"2026-06-27T19:00:00",rnd:"Group Stage · Group F"},
  {id:"f7",t1:"Germany",    t2:"Costa Rica", dt:"2026-06-27T22:00:00",rnd:"Group Stage · Group G"},
  {id:"f8",t1:"Netherlands",t2:"Qatar",      dt:"2026-06-27T22:00:00",rnd:"Group Stage · Group H"},
].map(g=>({...g,...odds3(g.t1,g.t2)}));

const fetchWC=async()=>{
  try{
    const r=await fetch("https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard");
    if(!r.ok)return FB;
    const d=await r.json();
    const evs=(d.events||[]).filter(e=>["pre","in"].includes(e.status?.type?.state));
    if(!evs.length)return FB;
    return evs.slice(0,8).map(e=>{
      const cs=e.competitions?.[0]?.competitors||[];
      const h=cs.find(c=>c.homeAway==="home"),a=cs.find(c=>c.homeAway==="away");
      const t1=h?.team?.displayName||"Home",t2=a?.team?.displayName||"Away";
      return{id:e.id,t1,t2,dt:e.date,rnd:e.name||"FIFA World Cup 2026",...odds3(t1,t2)};
    });
  }catch{return FB;}
};

// ─── HELPERS ─────────────────────────────────────────────────────────────────
const fmtO=o=>o>0?`+${o}`:`${o}`;
const calcW=(s,o)=>o>0?+(s*(o/100)).toFixed(2):+(s*(100/Math.abs(o))).toFixed(2);
const fmtDt=iso=>{const d=new Date(iso);return d.toLocaleDateString("en-US",{month:"short",day:"numeric",timeZone:"America/New_York"})+" · "+d.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit",timeZone:"America/New_York",timeZoneName:"short"});};
const fmtTime=iso=>new Date(iso).toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit",timeZone:"America/New_York"});
const fmtDate=iso=>new Date(iso).toLocaleDateString("en-US",{month:"short",day:"numeric",timeZone:"America/New_York"});
const mkHash=s=>btoa(unescape(encodeURIComponent(s+"||mfl2026")));
const unHash=h=>{try{return decodeURIComponent(escape(atob(h))).replace("||mfl2026","");}catch{return "••••";}};
const fl=t=>FLAGS[t]||"🏳️";
const betLabel=t=>t==="Draw"?"⚖️ Draw":`${fl(t)} ${t}`;

const TERMS=[
  {n:"1",t:"Don't leak outside of MFL. What happens in MFL Betzone stays in MFL Betzone. Do not share bet details, balances, or any platform info outside the group."},
  {n:"2",t:"Gamble responsibly. Only bet what you can afford to lose. This is for fun — if it stops being fun, stop betting."},
  {n:"3",t:"No refunds. Once a bet is confirmed and placed, it is final. No cancellations, refunds, or reversals for any reason. Always verify before confirming."},
];

// ─── ROOT ─────────────────────────────────────────────────────────────────────
export default function App(){
  const [session,setSession]=useState(null);
  const [toast,setToast]=useState(null);
  const [wc,setWc]=useState([]);
  const [wcLoading,setWcLoading]=useState(true);
  const showToast=(msg,type="success")=>{setToast({msg,type});setTimeout(()=>setToast(null),4000);};
  const refreshWC=useCallback(async()=>{const g=await fetchWC();setWc(g.map(m=>({...m,...odds3(m.t1,m.t2)})));setWcLoading(false);},[]);
  useEffect(()=>{refreshWC();},[refreshWC]);
  useEffect(()=>{
    const h=()=>{if(!document.hidden)refreshWC();};
    document.addEventListener("visibilitychange",h);
    const iv=setInterval(()=>{if(!document.hidden)refreshWC();},60000);
    return()=>{document.removeEventListener("visibilitychange",h);clearInterval(iv);};
  },[refreshWC]);
  useEffect(()=>{try{const s=sessionStorage.getItem("mfl_s");if(s)setSession(JSON.parse(s));}catch(e){}},[]); 
  const login=s=>{setSession(s);try{sessionStorage.setItem("mfl_s",JSON.stringify(s));}catch(e){}};
  const logout=()=>{setSession(null);try{sessionStorage.removeItem("mfl_s");}catch(e){}};
  if(!session)return<Login login={login} showToast={showToast} toast={toast}/>;
  return<Main session={session} logout={logout} showToast={showToast} toast={toast} wc={wc} wcLoading={wcLoading} refreshWC={refreshWC}/>;
}

// ─── LOGIN ────────────────────────────────────────────────────────────────────
function Login({login,showToast,toast}){
  const [mode,setMode]=useState("login");
  const [un,setUn]=useState("");const [pw,setPw]=useState("");const [cpw,setCpw]=useState("");const [nm,setNm]=useState("");
  const [tos,setTos]=useState(false);const [showTos,setShowTos]=useState(false);
  const [tosRead,setTosRead]=useState(false);const [busy,setBusy]=useState(false);
  const tosRef=useRef(null);
  const onTosScroll=()=>{const el=tosRef.current;if(el&&el.scrollHeight-el.scrollTop<=el.clientHeight+24)setTosRead(true);};

  const doLogin=async()=>{
    if(!un.trim()||!pw)return showToast("Enter your username and password","error");
    if(un.trim().toLowerCase()===ADMIN_USER&&pw===ADMIN_PASS){login({userId:"admin",isAdmin:true});return;}
    setBusy(true);
    try{
      const rows=await db.findUser(un.trim());
      const user=rows?.[0];
      if(!user||user.password_hash!==mkHash(pw))return showToast("Wrong username or password","error");
      login({userId:user.id,isAdmin:false});
    }catch(e){showToast("Connection error — try again","error");}finally{setBusy(false);}
  };

  const doRegister=async()=>{
    const id=un.trim().toLowerCase().replace(/\s+/g,"");
    if(!id||!pw||!cpw||!nm.trim())return showToast("Fill out every field","error");
    if(id===ADMIN_USER)return showToast("That username is reserved","error");
    if(pw.length<4)return showToast("Password must be at least 4 characters","error");
    if(pw!==cpw)return showToast("Passwords don't match","error");
    if(!tos)return showToast("Read and agree to the Terms of Service first","error");
    setBusy(true);
    try{
      const ex=await db.findUser(id);
      if(ex?.length>0){showToast("Username already taken","error");setBusy(false);return;}
      await db.addUser({username:id,display_name:nm.trim(),password_hash:mkHash(pw),balance:0,cash_in:0,cash_out:0,privacy_public:true,last_seen:new Date().toISOString()});
      const rows=await db.findUser(id);
      const newUser=rows?.[0];
      if(!newUser)throw new Error("Created but couldn't retrieve — try signing in");
      showToast("Welcome to MFL Betzone! 🎉");
      login({userId:newUser.id,isAdmin:false});
    }catch(e){
      console.error("Register:",e);
      const m=e.message?.includes("42501")||e.message?.includes("permission")
        ?"DB permissions error — tell Brent to run fix_permissions.sql"
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
            <div style={{fontSize:11,color:C.dim,marginBottom:14}}>Scroll to bottom to accept</div>
            <div ref={tosRef} onScroll={onTosScroll} style={{overflowY:"auto",maxHeight:260,marginBottom:16,paddingRight:4}}>
              {TERMS.map(t=>(
                <div key={t.n} style={{display:"flex",gap:14,marginBottom:20}}>
                  <span style={{fontSize:18,fontWeight:900,color:C.gold,flexShrink:0,lineHeight:1.5}}>{t.n}.</span>
                  <p style={{fontSize:14,color:C.sub,lineHeight:1.75,margin:0}}>{t.t}</p>
                </div>
              ))}
              <p style={{fontSize:12,color:C.dim,lineHeight:1.6,marginTop:8,paddingTop:12,borderTop:`1px solid ${C.border}`}}>
                By creating an account you confirm you have read and agree to all terms. MFL Betzone is a private platform.
              </p>
            </div>
            <button style={{...S.btn,width:"100%",padding:"14px",opacity:tosRead?1:0.35,cursor:tosRead?"pointer":"not-allowed"}}
              onClick={()=>tosRead&&(setTos(true),setShowTos(false))}>
              {tosRead?"I Agree — Continue ✓":"Keep scrolling to accept"}
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
          <div style={{fontSize:10,fontWeight:600,color:C.dim,letterSpacing:"0.16em",marginTop:2}}>SPORTSBOOK</div>
        </div>
        <div style={{...S.card,width:"100%",maxWidth:400,padding:"22px 20px"}}>
          <div style={{display:"flex",background:C.bg,borderRadius:10,border:`1px solid ${C.border}`,marginBottom:22,overflow:"hidden",padding:3,gap:3}}>
            <button style={{...S.tabTog,...(mode==="login"?S.tabOn:{})}} onClick={()=>setMode("login")}>Sign In</button>
            <button style={{...S.tabTog,...(mode==="register"?S.tabOn:{})}} onClick={()=>setMode("register")}>Create Account</button>
          </div>
          {mode==="register"&&<Fld label="Full Name (your real name)"><input style={S.inp} placeholder="e.g. Mike Johnson" value={nm} onChange={e=>setNm(e.target.value)}/></Fld>}
          <Fld label={mode==="register"?"Username (no spaces, real name)":"Username"}>
            <input style={S.inp} placeholder={mode==="register"?"e.g. mikejohnson":"username"} value={un} onChange={e=>setUn(e.target.value)} autoCapitalize="none" autoCorrect="off" spellCheck={false}/>
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
                  <span style={{color:C.gold,textDecoration:"underline"}} onClick={e=>{e.stopPropagation();setTosRead(false);setShowTos(true);}}>
                    Terms of Service
                  </span>{" "}— including no refunds on placed bets
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

// ─── MAIN ────────────────────────────────────────────────────────────────────
function Main({session,logout,showToast,toast,wc,wcLoading,refreshWC}){
  const isAdmin=session.isAdmin;
  const [tab,setTab]=useState("soccer");
  const [user,setUser]=useState(isAdmin?{display_name:"Brent",username:"brent",balance:0,cash_in:0,cash_out:0,privacy_public:false,last_seen:null}:null);
  const [bets,setBets]=useState([]);const [allBets,setAllBets]=useState([]);
  const [txs,setTxs]=useState([]);const [allTxs,setAllTxs]=useState([]);
  const [users,setUsers]=useState([]);const [contacts,setContacts]=useState([]);const [pendTxs,setPend]=useState([]);
  const [loading,setLoading]=useState(!isAdmin);
  const [picks,setPicks]=useState({});const [cash,setCash]=useState("");
  const [chatOpen,setChatOpen]=useState(false);
  const [chatMsgs,setChatMsgs]=useState([]);const [chatIn,setChatIn]=useState("");const [chatBusy,setChatBusy]=useState(false);
  const [onlineCount,setOnlineCount]=useState(0);
  const [expanded,setExpanded]=useState(null);const [showPw,setShowPw]=useState({});
  const [delConfirm,setDelConfirm]=useState(null);
  const [confirm,setConfirm]=useState(null);
  const chatEnd=useRef(null);

  const load=useCallback(async()=>{
    try{
      if(isAdmin){
        const [u,b,p,a,c]=await Promise.all([db.allUsers(),db.allBets(),db.pendingTxs(),db.allTxs(),db.contacts()]);
        setUsers(u||[]);setAllBets(b||[]);setPend(p||[]);setAllTxs(a||[]);setContacts(c||[]);
      }else{
        const [u,b,t,us,ab]=await Promise.all([db.getUser(session.userId),db.myBets(session.userId),db.myTxs(session.userId),db.allUsers(),db.allBets()]);
        if(u?.[0])setUser(u[0]);setBets(b||[]);setTxs(t||[]);setUsers(us||[]);setAllBets(ab||[]);
      }
    }catch(e){showToast("Error loading data","error");}finally{setLoading(false);}
  },[session.userId,isAdmin]);

  useEffect(()=>{load();},[load]);

  // Presence: update last_seen every 30s
  useEffect(()=>{
    if(isAdmin||!session.userId)return;
    const upd=()=>db.patchUser(session.userId,{last_seen:new Date().toISOString()}).catch(()=>{});
    upd();const iv=setInterval(upd,30000);return()=>clearInterval(iv);
  },[session.userId,isAdmin]);

  // Count online users every 30s
  useEffect(()=>{
    const count=async()=>{try{const r=await db.onlineCount();setOnlineCount((r||[]).length);}catch(e){}};
    count();const iv=setInterval(count,30000);return()=>clearInterval(iv);
  },[]);

  // Chat poll every 5s
  useEffect(()=>{
    const poll=async()=>{try{const m=await db.chat();setChatMsgs(m||[]);}catch(e){}};
    poll();const iv=setInterval(poll,5000);return()=>clearInterval(iv);
  },[]);
  useEffect(()=>{if(chatOpen)setTimeout(()=>chatEnd.current?.scrollIntoView({behavior:"smooth"}),100);},[chatMsgs,chatOpen]);

  const setPick=(id,team,odds)=>setPicks(p=>{const ex=p[id];if(ex&&ex.team===team){const n={...p};delete n[id];return n;}return{...p,[id]:{team,odds,stake:""}};});
  const setStake=(id,v)=>setPicks(p=>({...p,[id]:{...p[id],stake:v}}));

  const askConfirm=(gid)=>{
    const pick=picks[gid];const g=wc.find(x=>x.id===gid);if(!pick)return;
    const stake=parseFloat(pick.stake);
    if(!stake||stake<=0)return showToast("Enter how much you want to bet","error");
    if(stake>user.balance)return showToast("Not enough Brent Bucks!","error");
    setConfirm({gid,team:pick.team,odds:pick.odds,stake,win:calcW(stake,pick.odds),matchup:`${g.t1} vs ${g.t2}`});
  };

  const placeBet=async()=>{
    if(!confirm)return;
    const{gid,team,odds,stake,win,matchup}=confirm;
    const g=wc.find(x=>x.id===gid);setConfirm(null);
    try{
      await db.patchUser(session.userId,{balance:+(user.balance-stake).toFixed(2)});
      await db.addBet({user_id:session.userId,type:"single",stake,potential_win:win,legs:[{fighter:team,matchup,odds,fightId:gid,eventDate:g?.dt||null,event:"FIFA World Cup 2026"}]});
      setPicks(p=>{const n={...p};delete n[gid];return n;});
      showToast(`Bet placed! To win ₿${win.toFixed(2)}`);await load();
    }catch(e){showToast("Error placing bet","error");}
  };

  const reqDep=async()=>{const a=parseFloat(cash);if(!a||a<=0)return showToast("Enter an amount","error");
    try{await db.addTx({user_id:session.userId,type:"deposit",amount:a,status:"pending"});setCash("");showToast("Request sent! Bring cash to Brent.");await load();}catch(e){showToast("Error","error");}
  };
  const reqWith=async()=>{const a=parseFloat(cash);if(!a||a<=0)return showToast("Enter an amount","error");
    if(a>user.balance)return showToast("Not enough Brent Bucks!","error");
    try{await db.addTx({user_id:session.userId,type:"withdraw",amount:a,status:"pending"});setCash("");showToast("Request sent! Go see Brent.");await load();}catch(e){showToast("Error","error");}
  };
  const togglePrivacy=async()=>{
    try{await db.patchUser(session.userId,{privacy_public:!user.privacy_public});await load();showToast(user.privacy_public?"Stats now private":"Stats now public");}catch(e){}
  };
  const sendChat=async()=>{
    if(!chatIn.trim())return;setChatBusy(true);
    try{await db.sendChat({user_id:isAdmin?"admin":session.userId,display_name:user.display_name,message:chatIn.trim()});
      setChatIn("");const m=await db.chat();setChatMsgs(m||[]);
    }catch(e){showToast("Error sending","error");}finally{setChatBusy(false);}
  };
  const approve=async(txId)=>{
    const tx=[...allTxs,...pendTxs].find(t=>t.id===txId);const u=users.find(x=>x.id===tx?.user_id);if(!tx||!u)return;
    try{await db.patchTx(txId,{status:"approved"});
      const upd={balance:+(u.balance+(tx.type==="deposit"?tx.amount:0)).toFixed(2)};
      if(tx.type==="deposit")upd.cash_in=+((u.cash_in||0)+tx.amount).toFixed(2);
      else upd.cash_out=+((u.cash_out||0)+tx.amount).toFixed(2);
      await db.patchUser(u.id,upd);showToast("Approved ✓");await load();
    }catch(e){showToast("Error","error");}
  };
  const reject=async(txId)=>{
    const tx=[...allTxs,...pendTxs].find(t=>t.id===txId);const u=users.find(x=>x.id===tx?.user_id);if(!tx)return;
    try{await db.patchTx(txId,{status:"rejected"});
      if(tx.type==="withdraw"&&u)await db.patchUser(u.id,{balance:+(u.balance+tx.amount).toFixed(2)});
      showToast("Rejected","error");await load();
    }catch(e){showToast("Error","error");}
  };
  const markRead=async id=>{try{await db.markRead(id);await load();}catch(e){}};
  const doDelete=async(uid)=>{
    try{await db.deleteUser(uid);setDelConfirm(null);setExpanded(null);showToast("Account deleted");await load();}
    catch(e){showToast("Error deleting account","error");}
  };

  if(loading)return<Loader/>;
  if(!user)return<div style={{color:C.text,padding:40,textAlign:"center"}}>Error loading. Refresh.</div>;

  const pnl=bets.reduce((a,b)=>b.status==="won"?a+b.potential_win:b.status==="lost"?a-b.stake:a,0);
  const pending=bets.filter(b=>b.status==="pending").length;
  const others=users.filter(u=>u.id!==session.userId&&u.username!==ADMIN_USER);
  const byUser={};allBets.forEach(b=>{if(!byUser[b.user_id])byUser[b.user_id]=[];byUser[b.user_id].push(b);});
  const unread=contacts.filter(m=>!m.read).length;
  const totDep=allTxs.filter(t=>t.type==="deposit"&&t.status==="approved").reduce((a,t)=>a+t.amount,0);
  const totWith=allTxs.filter(t=>t.type==="withdraw"&&t.status==="approved").reduce((a,t)=>a+t.amount,0);
  const totHeld=users.reduce((a,u)=>a+(u.balance||0),0);
  const uBets=uid=>allBets.filter(b=>b.user_id===uid);
  const uTxs=uid=>allTxs.filter(t=>t.user_id===uid);
  const uPnl=uid=>uBets(uid).reduce((a,b)=>b.status==="won"?a+b.potential_win:b.status==="lost"?a-b.stake:a,0);

  const TABS=[
    {id:"soccer",icon:"⚽",label:"World Cup"},
    {id:"mybets",icon:"🎯",label:`Bets${pending>0?` (${pending})`:""}`},
    {id:"players",icon:"👥",label:"Players"},
    {id:"profile",icon:"👤",label:"Profile"},
    ...(isAdmin?[{id:"admin",icon:"⚙",label:`Admin${pendTxs.length>0?` (${pendTxs.length})`:""}`}]:[]),
  ];

  return(
    <div style={S.root}>
      {toast&&<Toast t={toast}/>}

      {/* CONFIRM BET MODAL */}
      {confirm&&(
        <div style={S.over}>
          <div style={S.modal}>
            <div style={{fontSize:16,fontWeight:800,color:C.text,marginBottom:18}}>Confirm Your Bet</div>
            <div style={{background:C.bg,borderRadius:10,border:`1px solid ${C.border}`,padding:"14px",marginBottom:14}}>
              <div style={{fontSize:11,color:C.dim,fontWeight:600,letterSpacing:"0.06em",marginBottom:6}}>FIFA WORLD CUP 2026</div>
              <div style={{fontSize:13,color:C.sub,marginBottom:8}}>{confirm.matchup}</div>
              <div style={{fontSize:15,color:C.text,marginBottom:12}}>
                Pick: <strong style={{color:C.gold}}>{betLabel(confirm.team)}</strong>
                <span style={{color:C.dim,fontSize:12,marginLeft:6}}>({fmtO(confirm.odds)})</span>
              </div>
              <div style={{display:"flex",borderRadius:8,overflow:"hidden",border:`1px solid ${C.border}`}}>
                <div style={{flex:1,padding:"10px",background:C.card,textAlign:"center"}}>
                  <div style={{fontSize:10,color:C.dim,marginBottom:2}}>STAKE</div>
                  <div style={{fontSize:17,fontWeight:800,color:C.text}}>₿{confirm.stake}</div>
                </div>
                <div style={{width:1,background:C.border}}/>
                <div style={{flex:1,padding:"10px",background:C.card,textAlign:"center"}}>
                  <div style={{fontSize:10,color:C.dim,marginBottom:2}}>TO WIN</div>
                  <div style={{fontSize:17,fontWeight:800,color:C.green}}>₿{confirm.win.toFixed(2)}</div>
                </div>
              </div>
            </div>
            <div style={{background:"#1A0A0A",border:"1px solid #E5393533",borderRadius:10,padding:"12px 14px",marginBottom:18}}>
              <div style={{fontSize:13,color:"#E53935",lineHeight:1.65}}>⚠️ <strong>No refunds.</strong> Once confirmed this bet is final. No cancellations, no exceptions.</div>
            </div>
            <button style={{...S.btn,width:"100%",padding:"15px",marginBottom:10}} onClick={placeBet}>CONFIRM — BET ₿{confirm.stake}</button>
            <button style={{...S.ghost,width:"100%",padding:"13px"}} onClick={()=>setConfirm(null)}>Go Back</button>
          </div>
        </div>
      )}

      {/* CHAT PANEL OVERLAY */}
      {chatOpen&&(
        <>
          <div style={{position:"fixed",inset:0,background:"#00000077",zIndex:149}} onClick={()=>setChatOpen(false)}/>
          <div style={{position:"fixed",left:0,top:56,bottom:60,width:"min(300px,85vw)",background:C.card,borderRight:`1px solid ${C.border}`,zIndex:150,display:"flex",flexDirection:"column",boxShadow:"6px 0 24px #00000066"}}>
            <div style={{padding:"14px 14px 10px",borderBottom:`1px solid ${C.border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div>
                <div style={{fontSize:14,fontWeight:800,color:C.text}}>Group Chat</div>
                <div style={{display:"flex",alignItems:"center",gap:5,marginTop:3}}>
                  <span style={{width:7,height:7,borderRadius:"50%",background:C.green,display:"inline-block",boxShadow:`0 0 5px ${C.green}`}}/>
                  <span style={{fontSize:11,color:C.green,fontWeight:600}}>{onlineCount} online</span>
                </div>
              </div>
              <button onClick={()=>setChatOpen(false)} style={{background:"none",border:"none",color:C.dim,fontSize:20,cursor:"pointer",padding:4}}>✕</button>
            </div>
            <div style={{flex:1,overflowY:"auto",padding:"12px",display:"flex",flexDirection:"column",gap:8}}>
              {chatMsgs.length===0&&<div style={{textAlign:"center",padding:"32px 12px",color:C.dim,fontSize:13}}>No messages yet — say hi! 👋</div>}
              {chatMsgs.map(msg=>{
                const isMe=isAdmin?msg.user_id==="admin":msg.user_id===session.userId;
                return(
                  <div key={msg.id} style={{display:"flex",flexDirection:"column",alignItems:isMe?"flex-end":"flex-start"}}>
                    {!isMe&&<div style={{fontSize:10,fontWeight:700,color:C.gold,marginBottom:3,paddingLeft:2}}>{msg.display_name}</div>}
                    <div style={{maxWidth:"85%",background:isMe?C.gold:C.bg,border:isMe?"none":`1px solid ${C.border}`,borderRadius:isMe?"12px 12px 2px 12px":"12px 12px 12px 2px",padding:"8px 12px"}}>
                      <div style={{fontSize:13,color:isMe?C.bg:C.text,lineHeight:1.4}}>{msg.message}</div>
                    </div>
                    <div style={{fontSize:9,color:C.dim,marginTop:2,padding:"0 2px"}}>{fmtTime(msg.created_at)}</div>
                  </div>
                );
              })}
              <div ref={chatEnd}/>
            </div>
            <div style={{padding:"10px",borderTop:`1px solid ${C.border}`,display:"flex",gap:8}}>
              <input style={{...S.inp,flex:1,padding:"10px 12px",fontSize:13}} placeholder="Say something…" value={chatIn}
                onChange={e=>setChatIn(e.target.value)} onKeyDown={e=>e.key==="Enter"&&sendChat()}/>
              <button style={{...S.btn,padding:"10px 14px",fontSize:17,opacity:chatBusy?0.5:1}} onClick={sendChat} disabled={chatBusy}>↑</button>
            </div>
          </div>
        </>
      )}

      {/* FLOATING CHAT BUTTON */}
      <button onClick={()=>setChatOpen(o=>!o)} style={{position:"fixed",bottom:68,left:14,width:48,height:48,borderRadius:"50%",background:chatOpen?C.gold:C.card,border:`1px solid ${chatOpen?C.gold:C.border}`,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,zIndex:120,boxShadow:"0 2px 12px #00000066",transition:"all 0.2s"}}>
        💬
        {onlineCount>0&&(
          <div style={{position:"absolute",top:-3,right:-3,background:C.green,borderRadius:"50%",minWidth:17,height:17,display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,fontWeight:800,color:C.bg,border:`2px solid ${C.bg}`,padding:"0 2px"}}>
            {onlineCount}
          </div>
        )}
      </button>

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

        {/* ── WORLD CUP ── */}
        {tab==="soccer"&&(
          <div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:"10px 14px",marginBottom:14}}>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <span style={{width:7,height:7,borderRadius:"50%",background:C.green,display:"inline-block",boxShadow:`0 0 6px ${C.green}`}}/>
                <span style={{fontSize:11,fontWeight:700,color:C.green,letterSpacing:"0.04em"}}>LIVE ODDS · FIFA World Cup 2026</span>
              </div>
              <button onClick={refreshWC} style={{background:"none",border:"none",color:C.dim,cursor:"pointer",fontSize:16,padding:2}}>↻</button>
            </div>
            <div style={{...S.card,display:"flex",alignItems:"center",gap:14,padding:"13px 16px",marginBottom:14}}>
              <span style={{fontSize:24}}>🥊</span>
              <div style={{flex:1}}><div style={{fontSize:13,fontWeight:800,color:C.text}}>UFC Betting</div><div style={{fontSize:11,color:C.dim,marginTop:1}}>No fights scheduled yet</div></div>
              <Pill label="COMING SOON" color="#FF9800"/>
            </div>
            {wcLoading?(
              <div style={{textAlign:"center",padding:"44px",color:C.dim}}><div style={{fontSize:28,marginBottom:10}}>⚽</div><div style={{fontSize:13}}>Loading live odds…</div></div>
            ):wc.length===0?<Empty icon="⚽" title="No matches right now" sub="Check back soon"/>
            :wc.map(g=>{
              const pick=picks[g.id];
              const stake=parseFloat(pick?.stake)||0;
              const payout=stake&&pick?calcW(stake,pick.odds):0;
              return(
                <div key={g.id} style={{...S.card,marginBottom:12}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12}}>
                    <div>
                      <div style={{fontSize:10,fontWeight:700,color:C.gold,letterSpacing:"0.05em"}}>FIFA WORLD CUP 2026</div>
                      <div style={{fontSize:10,color:C.dim,marginTop:1}}>{g.rnd}</div>
                    </div>
                    <div style={{fontSize:10,color:C.dim}}>{fmtDt(g.dt)}</div>
                  </div>
                  {/* 3-WAY BETTING: Home | Draw | Away */}
                  <div style={{display:"flex",gap:5}}>
                    <button disabled={isAdmin} onClick={()=>setPick(g.id,g.t1,g.o1)}
                      style={{...S.fBtn,flex:1,...(pick?.team===g.t1?S.fBtnOn:{})}}>
                      <span style={{fontSize:20}}>{fl(g.t1)}</span>
                      <span style={{fontSize:11,fontWeight:700,color:C.text,textAlign:"center",lineHeight:1.2}}>{g.t1.split(" ").slice(-1)[0]}</span>
                      <span style={{fontSize:13,fontWeight:900,color:g.o1<0?"#FF6B35":C.green}}>{fmtO(g.o1)}</span>
                    </button>
                    <button disabled={isAdmin} onClick={()=>setPick(g.id,"Draw",g.oDraw)}
                      style={{...S.fBtn,flex:0.75,...(pick?.team==="Draw"?{...S.fBtnOn,background:"#151525"}:{})}}>
                      <span style={{fontSize:18}}>⚖️</span>
                      <span style={{fontSize:10,fontWeight:700,color:C.dim}}>DRAW</span>
                      <span style={{fontSize:13,fontWeight:900,color:C.sub}}>{fmtO(g.oDraw)}</span>
                    </button>
                    <button disabled={isAdmin} onClick={()=>setPick(g.id,g.t2,g.o2)}
                      style={{...S.fBtn,flex:1,...(pick?.team===g.t2?S.fBtnOn:{})}}>
                      <span style={{fontSize:20}}>{fl(g.t2)}</span>
                      <span style={{fontSize:11,fontWeight:700,color:C.text,textAlign:"center",lineHeight:1.2}}>{g.t2.split(" ").slice(-1)[0]}</span>
                      <span style={{fontSize:13,fontWeight:900,color:g.o2<0?"#FF6B35":C.green}}>{fmtO(g.o2)}</span>
                    </button>
                  </div>
                  {isAdmin&&<div style={{fontSize:10,color:C.dim,textAlign:"center",marginTop:8}}>Admin view — betting disabled</div>}
                  {pick&&!isAdmin&&(
                    <div style={{marginTop:12,background:C.bg,borderRadius:10,border:`1px solid ${C.gold}22`,padding:"12px"}}>
                      <div style={{fontSize:12,color:C.dim,marginBottom:10}}>
                        <strong style={{color:C.gold}}>{betLabel(pick.team)}</strong>
                        <span style={{color:C.dim,marginLeft:4}}>({fmtO(pick.odds)})</span>
                      </div>
                      <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:10}}>
                        <div style={{...S.stakeW,flex:1}}>
                          <span style={{fontSize:14,fontWeight:700,color:C.gold,marginRight:5}}>₿</span>
                          <input style={S.stakeInp} type="number" placeholder="0.00" value={pick.stake} onChange={e=>setStake(g.id,e.target.value)} min="0"/>
                        </div>
                        <div style={{textAlign:"right",minWidth:68}}>
                          <div style={{fontSize:10,color:C.dim}}>TO WIN</div>
                          <div style={{fontSize:14,fontWeight:800,color:C.green}}>₿{payout.toFixed(2)}</div>
                        </div>
                      </div>
                      <button style={{...S.btn,width:"100%",padding:"12px"}} onClick={()=>askConfirm(g.id)}>PLACE BET</button>
                    </div>
                  )}
                </div>
              );
            })}
            <div style={{...S.card,display:"flex",alignItems:"center",gap:14,padding:"13px 16px",marginTop:6}}>
              <span style={{fontSize:24}}>🏈</span>
              <div style={{flex:1}}><div style={{fontSize:13,fontWeight:800,color:C.text}}>NFL Betting</div><div style={{fontSize:11,color:C.dim,marginTop:1}}>Season kicks off Fall 2026</div></div>
              <Pill label="COMING SOON" color="#FF9800"/>
            </div>
          </div>
        )}

        {/* ── BETS ── */}
        {tab==="mybets"&&(
          <div>
            <ST title={isAdmin?"All Bets":"My Bets"} sub={isAdmin?"Every bet from every player":"All bets are final — no refunds"}/>
            {(isAdmin?allBets:bets).length===0
              ?<Empty icon="🎯" title="No bets yet" sub={isAdmin?"No bets placed yet":"Head to World Cup to bet"}/>
              :(isAdmin?allBets:bets).map(bet=>{
                const bu=isAdmin?users.find(u=>u.id===bet.user_id):null;
                return(
                  <div key={bet.id} style={{...S.card,marginBottom:10}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
                      <div>
                        <div style={{display:"flex",gap:6,alignItems:"center",marginBottom:isAdmin?4:0}}>
                          <span style={S.badge}>SINGLE</span>
                          <span style={{fontSize:10,color:C.dim}}>{fmtDate(bet.placed_at)}</span>
                        </div>
                        {isAdmin&&bu&&<div style={{fontSize:12,color:C.gold,fontWeight:600}}>{bu.display_name} <span style={{color:C.dim}}>@{bu.username}</span></div>}
                      </div>
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
                );
              })
            }
          </div>
        )}

        {/* ── PLAYERS ── */}
        {tab==="players"&&(
          <div>
            <ST title="Players" sub={`${others.length} player${others.length!==1?"s":""} on MFL Betzone · Tap to view stats`}/>
            {others.length===0?<Empty icon="👥" title="No other players yet" sub="Invite your crew"/>
            :others.map(p=>{
              const pb=byUser[p.id]||[];
              const pp=pb.reduce((a,b)=>b.status==="won"?a+b.potential_win:b.status==="lost"?a-b.stake:a,0);
              const open=expanded===p.id;
              return(
                <div key={p.id} style={{...S.card,marginBottom:10}}>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",cursor:"pointer",minHeight:48}} onClick={()=>setExpanded(open?null:p.id)}>
                    <div style={{display:"flex",alignItems:"center",gap:12}}>
                      <Av name={p.display_name} size={44}/>
                      <div>
                        <div style={{fontSize:15,fontWeight:700,color:C.text}}>{p.display_name}</div>
                        <div style={{fontSize:11,color:C.dim}}>@{p.username} · {pb.length} bet{pb.length!==1?"s":""}</div>
                      </div>
                    </div>
                    <span style={{color:C.dim,fontSize:13}}>{open?"▲":"▼"}</span>
                  </div>
                  {open&&(
                    <div style={{marginTop:12,borderTop:`1px solid ${C.border}`,paddingTop:12}}>
                      {p.privacy_public?(
                        <>
                          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:8}}>
                            {[{l:"Deposited",v:`₿${(p.cash_in||0).toFixed(2)}`},{l:"Withdrawn",v:`₿${(p.cash_out||0).toFixed(2)}`},{l:"P&L",v:`${pp>=0?"+":""}₿${pp.toFixed(2)}`,c:pp>=0?C.green:"#FF5252"}].map(s=>(
                              <div key={s.l} style={{background:C.bg,borderRadius:8,padding:"10px",textAlign:"center"}}>
                                <div style={{fontSize:13,fontWeight:800,color:s.c||C.text}}>{s.v}</div>
                                <div style={{fontSize:9,color:C.dim,marginTop:2}}>{s.l}</div>
                              </div>
                            ))}
                          </div>
                          <div style={{fontSize:12,color:C.dim,textAlign:"center"}}>{pb.length} bets · {pb.filter(b=>b.status==="won").length} wins</div>
                        </>
                      ):<div style={{textAlign:"center",padding:"10px",color:C.dim,fontSize:12}}>🔒 Stats private</div>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ── PROFILE ── */}
        {tab==="profile"&&(
          <div>
            <div style={{textAlign:"center",padding:"22px 14px 18px",background:C.card,borderRadius:14,border:`1px solid ${C.border}`,marginBottom:14}}>
              <Av name={user.display_name} size={56} style={{margin:"0 auto 10px"}}/>
              <div style={{fontSize:17,fontWeight:800,color:C.text,marginBottom:2}}>{user.display_name}</div>
              <div style={{fontSize:11,color:C.dim,marginBottom:12}}>@{user.username}</div>
              {!isAdmin&&<><div style={{fontSize:32,fontWeight:900,color:C.gold}}>₿{(user.balance||0).toFixed(2)}</div><div style={{fontSize:10,fontWeight:700,letterSpacing:"0.12em",color:C.dim,marginTop:4}}>BRENT BUCKS</div></>}
              {isAdmin&&<div style={{fontSize:12,color:"#E53935",fontWeight:700}}>⚙ Admin Account</div>}
            </div>
            {!isAdmin&&<>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}>
                {[{l:"Deposited",v:`₿${(user.cash_in||0).toFixed(2)}`},{l:"P&L",v:`${pnl>=0?"+":""}₿${pnl.toFixed(2)}`,c:pnl>=0?C.green:"#FF5252"},{l:"Total Bets",v:bets.length},{l:"Wins",v:bets.filter(b=>b.status==="won").length}].map(c=>(
                  <div key={c.l} style={{...S.card,textAlign:"center"}}>
                    <div style={{fontSize:19,fontWeight:800,color:c.c||C.text,marginBottom:4}}>{c.v}</div>
                    <div style={{fontSize:10,fontWeight:600,color:C.dim,letterSpacing:"0.06em"}}>{c.l}</div>
                  </div>
                ))}
              </div>
              <div style={{...S.card,display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                <div><div style={{fontSize:13,fontWeight:700,color:C.text}}>Stats Visibility</div><div style={{fontSize:11,color:C.dim,marginTop:2}}>{user.privacy_public?"Friends can see your stats":"Hidden from other players"}</div></div>
                <button onClick={togglePrivacy} style={{...S.btn,background:"transparent",border:`1px solid ${user.privacy_public?C.green+"44":C.gold+"44"}`,color:user.privacy_public?C.green:C.gold,fontSize:11,padding:"9px 13px",whiteSpace:"nowrap"}}>
                  {user.privacy_public?"🟢 Public":"🔴 Private"}
                </button>
              </div>
              <div style={{...S.card,marginBottom:10}}>
                <div style={{fontSize:14,fontWeight:800,color:C.text,marginBottom:12}}>💵 Cash In / Withdraw</div>
                <div style={{background:C.bg,borderRadius:10,border:`1px solid ${C.border}`,padding:"11px 13px",fontSize:12,color:C.sub,lineHeight:1.75,marginBottom:12}}>
                  <strong style={{color:C.gold}}>Deposit:</strong> Enter amount → Request → bring cash to Brent.<br/>
                  <strong style={{color:C.gold}}>Withdraw:</strong> Enter amount → Request → go see Brent to collect.<br/>
                  <span style={{color:C.dim}}>$1 USD = ₿1 Brent Bucks</span>
                </div>
                <div style={{...S.stakeW,marginBottom:10}}>
                  <span style={{fontSize:14,fontWeight:700,color:C.gold,marginRight:5}}>$</span>
                  <input style={S.stakeInp} type="number" placeholder="0.00" value={cash} onChange={e=>setCash(e.target.value)} min="0"/>
                </div>
                <div style={{display:"flex",gap:8}}>
                  <button style={{...S.btn,flex:1,padding:"13px"}} onClick={reqDep}>REQUEST DEPOSIT</button>
                  <button style={{...S.btn,flex:1,padding:"13px",background:"transparent",border:"1px solid #E5393555",color:"#E53935"}} onClick={reqWith}>REQUEST WITHDRAW</button>
                </div>
                {txs.filter(t=>t.status==="pending").length>0&&(
                  <div style={{marginTop:10,fontSize:12,color:C.gold,background:"#0D0900",borderRadius:8,padding:"8px 12px"}}>
                    ⏳ {txs.filter(t=>t.status==="pending").length} request{txs.filter(t=>t.status==="pending").length>1?"s":""} pending
                  </div>
                )}
                <div style={{marginTop:12,paddingTop:12,borderTop:`1px solid ${C.border}`}}>
                  <div style={{fontSize:9,fontWeight:700,color:C.dim,letterSpacing:"0.1em",marginBottom:8}}>COMING SOON</div>
                  <div style={{display:"flex",alignItems:"center",gap:12,background:C.bg,border:`1px solid ${C.border}`,borderRadius:10,padding:"11px 13px",opacity:0.5}}>
                    <span style={{fontSize:20}}>🍎</span>
                    <div><div style={{fontSize:13,fontWeight:700,color:C.text}}>Apple Pay</div><div style={{fontSize:11,color:C.dim,marginTop:1}}>Instant deposits & withdrawals</div></div>
                    <Pill label="COMING SOON" color="#888" style={{marginLeft:"auto"}}/>
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
            </>}
            <button style={{...S.ghost,width:"100%",padding:"14px",marginTop:4}} onClick={logout}>Sign Out</button>
          </div>
        )}

        {/* ── ADMIN ── */}
        {tab==="admin"&&isAdmin&&(
          <div>
            {/* Requests */}
            <ST title="Pending Requests" sub={pendTxs.length>0?`${pendTxs.length} waiting`:"All clear"}/>
            {pendTxs.length===0?<div style={{...S.card,textAlign:"center",padding:"22px",color:C.dim,marginBottom:16}}>✓ No pending requests</div>
            :pendTxs.map(tx=>{const u=users.find(x=>x.id===tx.user_id);return(
              <div key={tx.id} style={{...S.card,border:`1px solid ${C.gold}22`,marginBottom:10}}>
                <div style={{fontSize:15,fontWeight:800,color:C.text,marginBottom:4}}>{tx.type==="deposit"?"💵 Deposit":"💸 Withdrawal"}</div>
                <div style={{fontSize:14,color:C.sub,marginBottom:8}}><strong style={{color:C.gold}}>{u?.display_name}</strong> · <strong style={{color:C.text}}>₿{tx.amount.toFixed(2)}</strong><span style={{color:C.dim,marginLeft:8}}>{fmtDate(tx.created_at)}</span></div>
                <div style={{fontSize:12,color:C.sub,background:C.bg,borderRadius:8,padding:"8px 12px",marginBottom:12}}>
                  {tx.type==="deposit"?`⚠️ Confirm you received $${tx.amount.toFixed(2)} cash from ${u?.display_name}`:`⚠️ Hand $${tx.amount.toFixed(2)} cash to ${u?.display_name}`}
                </div>
                <div style={{display:"flex",gap:8}}>
                  <button style={{...S.btn,flex:1,padding:"13px",background:"#00C853"}} onClick={()=>approve(tx.id)}>✓ APPROVE</button>
                  <button style={{...S.btn,flex:1,padding:"13px",background:"#E53935"}} onClick={()=>reject(tx.id)}>✕ REJECT</button>
                </div>
              </div>
            );})}

            {/* Contact Messages */}
            {contacts.length>0&&<>
              <ST title={`Messages`} sub={unread>0?`${unread} unread`:""} style={{marginTop:20}}/>
              {contacts.slice(0,5).map(m=>(
                <div key={m.id} style={{...S.card,marginBottom:8,border:`1px solid ${m.read?C.border:C.gold+"33"}`}}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                    <span style={{fontSize:13,fontWeight:700,color:C.gold}}>{m.display_name}</span>
                    {!m.read&&<span style={{fontSize:9,fontWeight:700,background:C.gold+"18",color:C.gold,padding:"2px 8px",borderRadius:4}}>NEW</span>}
                  </div>
                  <div style={{fontSize:13,color:C.sub,lineHeight:1.65,marginBottom:m.read?0:10}}>{m.message}</div>
                  {!m.read&&<button style={{...S.ghost,fontSize:11,padding:"6px 14px"}} onClick={()=>markRead(m.id)}>Mark Read</button>}
                </div>
              ))}
            </>}

            {/* All Users with Delete */}
            <ST title="All Accounts" sub={`${users.length} registered`} style={{marginTop:20}}/>
            {users.length===0?<div style={{...S.card,textAlign:"center",padding:"18px",color:C.dim}}>No users yet</div>
            :users.map(u=>{
              const open=expanded===u.id;const ub=uBets(u.id);const ut=uTxs(u.id);const up=uPnl(u.id);
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
                      {/* Credentials */}
                      <div style={{background:C.bg,borderRadius:10,border:`1px solid ${C.border}`,padding:"12px",marginBottom:12}}>
                        <div style={{fontSize:9,fontWeight:700,color:C.dim,letterSpacing:"0.1em",marginBottom:8}}>CREDENTIALS</div>
                        <div style={{fontSize:13,marginBottom:6,color:C.sub}}>Username: <strong style={{color:C.gold}}>@{u.username}</strong></div>
                        <div style={{display:"flex",alignItems:"center",gap:8,fontSize:13,color:C.sub}}>
                          Password:&nbsp;
                          <strong style={{color:C.text,fontFamily:"monospace"}}>{showPw[u.id]?unHash(u.password_hash):"••••••••"}</strong>
                          <button style={{background:"none",border:`1px solid ${C.border}`,color:C.sub,borderRadius:6,padding:"3px 10px",fontSize:11,cursor:"pointer"}} onClick={()=>setShowPw(p=>({...p,[u.id]:!p[u.id]}))}>
                            {showPw[u.id]?"Hide":"Show"}
                          </button>
                        </div>
                      </div>
                      {/* Stats */}
                      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:12}}>
                        {[{l:"Balance",v:`₿${(u.balance||0).toFixed(2)}`},{l:"Deposited",v:`₿${(u.cash_in||0).toFixed(2)}`},{l:"Withdrawn",v:`₿${(u.cash_out||0).toFixed(2)}`},{l:"Bets",v:ub.length},{l:"Wins",v:ub.filter(b=>b.status==="won").length},{l:"P&L",v:`${up>=0?"+":""}₿${up.toFixed(2)}`,c:up>=0?C.green:"#FF5252"}].map(s=>(
                          <div key={s.l} style={{background:C.bg,borderRadius:8,padding:"10px",textAlign:"center"}}><div style={{fontSize:13,fontWeight:800,color:s.c||C.text}}>{s.v}</div><div style={{fontSize:9,color:C.dim,marginTop:2}}>{s.l}</div></div>
                        ))}
                      </div>
                      {/* Bets */}
                      {ub.length>0&&<><RL label="BETS"/>
                        {ub.map(b=>(
                          <div key={b.id} style={{background:C.bg,borderRadius:8,border:`1px solid ${C.border}`,padding:"10px 12px",marginBottom:6}}>
                            <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}><span style={S.badge}>SINGLE</span><SPill s={b.status}/></div>
                            {b.legs?.map((l,i)=><div key={i} style={{fontSize:12,color:C.sub,marginBottom:2}}>{l.matchup} → <strong style={{color:C.gold}}>{betLabel(l.fighter)}</strong> <span style={{color:C.dim}}>({fmtO(l.odds)})</span></div>)}
                            <div style={{display:"flex",gap:12,fontSize:11,color:C.dim,marginTop:5}}>
                              <span>₿{b.stake} staked</span><span style={{color:C.green}}>₿{(b.potential_win||0).toFixed(2)} to win</span>
                              <span>{new Date(b.placed_at).toLocaleDateString("en-US",{month:"short",day:"numeric",hour:"numeric",minute:"2-digit",timeZone:"America/New_York"})}</span>
                            </div>
                          </div>
                        ))}
                      </>}
                      {/* Txs */}
                      {ut.length>0&&<><RL label="TRANSACTIONS" style={{marginTop:10}}/>
                        {ut.map(tx=>(
                          <div key={tx.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"7px 0",borderBottom:`1px solid ${C.border}`,fontSize:12}}>
                            <span style={{color:C.sub}}>{tx.type==="deposit"?"💵":"💸"} {fmtDate(tx.created_at)}</span>
                            <div style={{display:"flex",gap:8,alignItems:"center"}}><span style={{fontWeight:700,color:tx.type==="deposit"?C.green:"#FF6B35"}}>{tx.type==="deposit"?"+":"−"}₿{tx.amount.toFixed(2)}</span><SPill s={tx.status}/></div>
                          </div>
                        ))}
                      </>}
                      {/* DELETE */}
                      <div style={{marginTop:14,paddingTop:12,borderTop:`1px solid ${C.border}`}}>
                        {delConfirm===u.id?(
                          <div style={{background:"#1A0A0A",border:"1px solid #E5393533",borderRadius:10,padding:"12px"}}>
                            <div style={{fontSize:13,color:"#E53935",marginBottom:10,lineHeight:1.5}}>Delete <strong>@{u.username}</strong>? This permanently removes the account, all bets, and transactions. Cannot be undone.</div>
                            <div style={{display:"flex",gap:8}}>
                              <button style={{...S.btn,flex:1,padding:"11px",background:"#E53935"}} onClick={()=>doDelete(u.id)}>Yes, Delete</button>
                              <button style={{...S.ghost,flex:1,padding:"11px"}} onClick={()=>setDelConfirm(null)}>Cancel</button>
                            </div>
                          </div>
                        ):(
                          <button style={{background:"none",border:"1px solid #E5393533",color:"#E53935",borderRadius:8,padding:"8px 16px",fontSize:12,fontWeight:600,cursor:"pointer",width:"100%"}} onClick={()=>setDelConfirm(u.id)}>
                            Delete Account
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {/* Overview */}
            <ST title="Overview" style={{marginTop:20}}/>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
              {[{l:"Users",v:users.length,i:"👥"},{l:"In Play",v:`₿${totHeld.toFixed(2)}`,i:"💰",c:C.gold},{l:"Deposited",v:`₿${totDep.toFixed(2)}`,i:"📥",c:C.green},{l:"Withdrawn",v:`₿${totWith.toFixed(2)}`,i:"📤",c:"#FF6B35"},{l:"Total Bets",v:allBets.length,i:"🎯"},{l:"Pending",v:pendTxs.length,i:"🔔",c:pendTxs.length>0?C.gold:C.text}].map(s=>(
                <div key={s.l} style={{...S.card,textAlign:"center"}}>
                  <div style={{fontSize:18,marginBottom:4}}>{s.i}</div>
                  <div style={{fontSize:17,fontWeight:800,color:s.c||C.text,marginBottom:2}}>{s.v}</div>
                  <div style={{fontSize:10,fontWeight:600,color:C.dim}}>{s.l}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      {/* BOTTOM NAV */}
      <nav style={{position:"fixed",bottom:0,left:"50%",transform:"translateX(-50%)",width:"100%",maxWidth:480,background:C.bg,borderTop:`1px solid ${C.border}`,display:"flex",zIndex:100,paddingBottom:"env(safe-area-inset-bottom)"}}>
        {TABS.map(t=>{
          const active=tab===t.id;
          const red=isAdmin&&t.id==="admin";
          return(
            <button key={t.id} style={{flex:1,background:"none",border:"none",color:active?(red?"#E53935":C.gold):C.dim,padding:"8px 4px 11px",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:3,position:"relative"}}
              onClick={()=>setTab(t.id)}>
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

// ─── SHARED COMPONENTS ────────────────────────────────────────────────────────
const Av=({name,size=40,style={}})=><div style={{width:size,height:size,borderRadius:"50%",background:C.gold,color:C.bg,fontSize:size*0.42,fontWeight:900,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,...style}}>{name?.[0]?.toUpperCase()}</div>;
const Pill=({label,color="#FF9800"})=><span style={{fontSize:8,fontWeight:700,letterSpacing:"0.08em",padding:"3px 8px",borderRadius:5,background:color+"18",color,border:`1px solid ${color}33`,whiteSpace:"nowrap"}}>{label}</span>;
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
