"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { createUserWithEmailAndPassword, onAuthStateChanged, signInWithEmailAndPassword, signOut, User } from "firebase/auth";
import { addDoc, collection, doc, getDocs, onSnapshot, query as firestoreQuery, serverTimestamp, setDoc, where, writeBatch } from "firebase/firestore";
import { auth, db, firebaseConfigured } from "./firebase";
import { seedClaims } from "./claims-data";
import { retireeRecords } from "./retirees-data";
import { optionalRetireeRecords } from "./optional-retirees-data";
import { exportClaimsExcel, exportRetireesExcel } from "./excel-export";
import {
  Activity, AlertTriangle, BarChart3, Bell, BookOpen, CheckCircle2, ChevronDown, ClipboardCheck, Clock3, Download,
  Archive, Eye, EyeOff, FileSpreadsheet, FileText, FolderOpen, Gauge, LayoutDashboard, LogOut, Menu,
  Moon, Pencil, Plus, RefreshCw, Search, Send, ShieldCheck,
  Sun, Trash2, Trophy, Upload, UserCheck, UserCog, Users, X, BadgeCheck
} from "lucide-react";

type Page = "dashboard" | "records" | "retirees" | "optional_retirees" | "compliance" | "reconcile" | "announcements" | "help" | "import" | "users" | "history" | "reports" | "archive" | "errors" | "validation" | "profile";
type Role = "administrator" | "unit_user";
type ClaimModalState = { mode: "new" | "view" | "edit"; claim?: Claim };
type UserProfile = {
  email: string; role: "admin" | "unit_user"; status: "approved" | "pending" | "disabled";
  displayName: string; unit: string;
};
const operationalUnits = ["RCD","RHQ","Batangas PPO","Cavite PPO","Laguna PPO","Quezon PPO","Rizal PPO","RMFB 4A"];
const normalizedUnit = (value:string) => value.trim().replace(/\s+/g," ").toLowerCase();
const sameUnit = (left:string|undefined,right:string|undefined) => normalizedUnit(left||"")===normalizedUnit(right||"");
export type Claim = {
  id: string; type: "KIPO" | "WIPO"; year: number; rank: string; name: string;
  province: string; office: string; stage: string; status: string; date: string;
  dateDisplay?: string; sourceCoverage?: string; injury?: string;
  benefits?: Record<string, string>;
  requirements?: Record<string, boolean>;
  lastUpdateDate?: string; nextFollowUpDate?: string; assignedFocalPerson?: string; latestAction?: string;
};
const workflowStages=["Incident Recorded","Document Completion","Document Review","RHE Board Review","OP Validation","DILG Validation","NAPOLCOM Processing","Benefits Released"] as const;
const claimStatuses=["Pending","In Process","For Review","Completed"] as const;
const claimRequirements=["Incident/Spot Report","Investigation Report","Medical Certificate","Service Record","Latest Payslip","Valid IDs","Clearances","Endorsement"] as const;
const normalizeWorkflow=(value:string)=>{
  const text=(value||"").trim().toLowerCase();
  const exact=workflowStages.find(item=>item.toLowerCase()===text);
  if(exact)return exact;
  if(/release|paid|received|complete/.test(text))return "Benefits Released";
  if(/napolcom/.test(text))return "NAPOLCOM Processing";
  if(/dilg/.test(text))return "DILG Validation";
  if(/op validation|office of the president/.test(text))return "OP Validation";
  if(/board|rhe/.test(text))return "RHE Board Review";
  if(/review/.test(text))return "Document Review";
  if(/document|requirement/.test(text))return "Document Completion";
  return "Incident Recorded";
};
const normalizeClaimStatus=(value:string,stage:string)=>{
  const text=(value||"").trim().toLowerCase();
  if(text==="completed"||normalizeWorkflow(stage)==="Benefits Released")return "Completed";
  if(text==="for review")return "For Review";
  if(text==="in process"||text==="in progress")return "In Process";
  return "Pending";
};
const isoToday=()=>new Date().toISOString().slice(0,10);
const sanitizeRecord = <T extends Record<string, unknown>>(obj: T): T => {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      if (value && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date)) {
        result[key] = sanitizeRecord(value as Record<string, unknown>);
      } else {
        result[key] = value;
      }
    }
  }
  return result as T;
};
const daysSince=(value?:string)=>value?Math.max(0,Math.floor((Date.now()-new Date(`${value}T00:00:00`).getTime())/86400000)):999;
const personnelKey=(rank:string,name:string,unit:string,date:string)=>[rank,name,unit,date].map(value=>(value||"").toLowerCase().replace(/[^a-z0-9]/g,"")).join("|");
const stableValue=(value:unknown):unknown=>{
  if(Array.isArray(value))return value.map(stableValue);
  if(value&&typeof value==="object")return Object.fromEntries(Object.entries(value as Record<string,unknown>).filter(([key])=>!["createdAt","updatedAt"].includes(key)).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,stableValue(item)]));
  return value??null;
};
const dataFingerprint=(claims:Claim[],retirees:Retiree[])=>{
  const input=JSON.stringify(stableValue({
  claims:claims.map(c=>c).sort((a,b)=>a.id.localeCompare(b.id)),
  retirees:retirees.map(r=>r).sort((a,b)=>a.id.localeCompare(b.id))
  }));let hash=2166136261;
  for(let index=0;index<input.length;index++){hash^=input.charCodeAt(index);hash=Math.imul(hash,16777619);}
  return `v1-${(hash>>>0).toString(16)}-${input.length}`;
};
const potentialDuplicate=(candidate:Claim,records:Claim[],excludeId="")=>records.find(record=>record.id!==excludeId&&(
  personnelKey(record.rank,record.name,record.province,record.date)===personnelKey(candidate.rank,candidate.name,candidate.province,candidate.date) ||
  (record.name.trim().toLowerCase()===candidate.name.trim().toLowerCase()&&sameUnit(record.province,candidate.province)&&record.type===candidate.type)
));

const nav = [
  ["dashboard", "Dashboard", LayoutDashboard],
  ["records", "KIPO/WIPO Records", FolderOpen],
  ["retirees", "Compulsory Retirees", BadgeCheck],
  ["optional_retirees", "Optional Retirees", UserCheck],
  ["compliance", "Compliance & Scorecard", Trophy],
  ["reconcile", "Data Reconciliation", ClipboardCheck],
  ["announcements", "Announcements", Bell],
  ["help", "Help & Data Dictionary", BookOpen],
  ["import", "Import Data", Upload],
  ["users", "Focal Persons", Users],
  ["history", "Activity History", Clock3],
  ["reports", "Reports", FileText],
  ["archive", "Archive & Recovery", Archive],
  ["errors", "System Errors", AlertTriangle],
  ["validation", "Monthly Validation", Gauge],
  ["profile", "My Profile", UserCog],
] as const;
const primaryNavKeys: Page[] = ["dashboard","records","retirees","optional_retirees","import","users"];
const otherNavKeys: Page[] = ["compliance","reconcile","announcements","help","history","reports","archive","errors","validation","profile"];
const administratorOnlyPages: Page[] = ["import","users","reconcile","archive","errors","validation"];

export default function Home() {
  const [authReady, setAuthReady] = useState(!auth || !db);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [authTab, setAuthTab] = useState<"signin"|"register">("signin");
  const [showPassword, setShowPassword] = useState(false);
  const [page, setPage] = useState<Page>("dashboard");
  const [dark, setDark] = useState(true);
  const [mobileNav, setMobileNav] = useState(false);
  const [othersOpen, setOthersOpen] = useState(false);
  const [claims, setClaims] = useState<Claim[]>(seedClaims as Claim[]);
  const [retirees, setRetirees] = useState<Retiree[]>(retireeRecords as Retiree[]);
  const [optionalRetirees, setOptionalRetirees] = useState<Retiree[]>(optionalRetireeRecords as Retiree[]);
  const [query, setQuery] = useState("");
  const [type, setType] = useState("All");
  const [status, setStatus] = useState("All");
  const [claimYear, setClaimYear] = useState("All");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [unit, setUnit] = useState("");
  const [authError, setAuthError] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const registeringRef = useRef(false);
  const [role, setRole] = useState<Role>("administrator");
  const [modal, setModal] = useState<ClaimModalState | null>(null);
  const [toast, setToast] = useState("");
  const [lastSyncAt,setLastSyncAt]=useState<Date|null>(null);
  const recordSystemError=async(context:string,error:unknown)=>{
    if(!db||!currentUser||!profile)return;
    try{await addDoc(collection(db,"systemErrors"),{
      context,message:error instanceof Error?error.message:String(error||"Unknown error"),unit:profile.unit,
      actorUid:currentUser.uid,actorName:profile.displayName,resolved:false,createdAt:serverTimestamp()
    });}catch{/* A rejected database write may also prevent diagnostic logging. */}
  };

  useEffect(() => {
    if (!auth || !db) return;
    let stopProfile:undefined|(()=>void);
    const stopAuth=onAuthStateChanged(auth, async user => {
      stopProfile?.();
      if (registeringRef.current) return;
      setCurrentUser(user);
      setProfile(null);
      if (!user) { setAuthReady(true); return; }
      stopProfile=onSnapshot(doc(db, "users", user.uid),async snapshot=>{
        if (!snapshot.exists()) {
          setAuthError("Your account profile is missing. Please contact the system administrator.");
          await signOut(auth);
        } else {
          const data = snapshot.data() as UserProfile;
          if (data.status !== "approved") {
            setAuthError(data.status==="disabled"?"Your account has been disabled by the administrator.":"Your account is awaiting administrator approval.");
            await signOut(auth);
          } else {
            setProfile(data);
            setRole(data.role === "admin" ? "administrator" : "unit_user");
          }
        }
        setAuthReady(true);
      },async()=>{
        setAuthError("Unable to verify your access. Please check the Firestore security rules.");
        await signOut(auth);
        setAuthReady(true);
      });
    });
    return ()=>{stopProfile?.();stopAuth();};
  }, []);

  useEffect(() => {
    if (!db || !profile) return;
    const source = profile.role === "admin"
      ? collection(db, "claims")
      : firestoreQuery(collection(db, "claims"), where("province", "==", profile.unit));
    return onSnapshot(source, snapshot => {
      const remote = snapshot.docs.map(item => item.data() as Claim);
      setClaims(remote);
      setLastSyncAt(new Date());
    }, error => { void recordSystemError("Claims synchronization failed",error); setToast("Unable to load Firebase records."); setTimeout(() => setToast(""), 2500); });
  }, [profile]);

  const scopedClaims = useMemo(() => role==="administrator" ? claims : claims.filter(c=>sameUnit(c.province,profile?.unit)), [claims,role,profile?.unit]);
  useEffect(() => {
    if (!db || !profile) return;
    const source = profile.role === "admin"
      ? collection(db, "retirees")
      : firestoreQuery(collection(db, "retirees"), where("unit", "==", profile.unit));
    return onSnapshot(source, snapshot => {
      setRetirees(snapshot.docs.map(item => item.data() as Retiree));
      setLastSyncAt(new Date());
    }, error => { void recordSystemError("Retiree synchronization failed",error); setToast("Unable to load retiree dashboard data."); setTimeout(() => setToast(""), 2500); });
  }, [profile]);
  const scopedRetirees = useMemo(() => role==="administrator" ? retirees : retirees.filter(r=>sameUnit(r.unit,profile?.unit)), [retirees,role,profile?.unit]);
  useEffect(() => {
    if (!db || !profile) return;
    const source = profile.role === "admin"
      ? collection(db, "optionalRetirees")
      : firestoreQuery(collection(db, "optionalRetirees"), where("unit", "==", profile.unit));
    return onSnapshot(source, snapshot => {
      const docs = snapshot.docs.map(item => item.data() as Retiree);
      const hasOldDummyData = snapshot.docs.some(doc => doc.id.startsWith("OPT-2025-")) || (profile.role === "admin" && snapshot.docs.length < optionalRetireeRecords.length);
      if ((snapshot.empty || hasOldDummyData) && profile.role === "admin") {
        const batch = writeBatch(db);
        snapshot.docs.forEach(d => batch.delete(d.ref));
        (optionalRetireeRecords as Retiree[]).forEach(record => batch.set(doc(db, "optionalRetirees", record.id), record));
        batch.commit().catch(() => {});
        setOptionalRetirees(optionalRetireeRecords as Retiree[]);
      } else {
        setOptionalRetirees(docs);
      }
      setLastSyncAt(new Date());
    }, error => { void recordSystemError("Optional retiree synchronization failed",error); });
  }, [profile]);
  const scopedOptionalRetirees = useMemo(() => role==="administrator" ? optionalRetirees : optionalRetirees.filter(r=>sameUnit(r.unit,profile?.unit)), [optionalRetirees,role,profile?.unit]);
  const filtered = useMemo(() => scopedClaims.filter(c => {
    const haystack = `${c.id} ${c.rank} ${c.name} ${c.province} ${c.office} ${c.status}`.toLowerCase();
    return haystack.includes(query.toLowerCase()) && (type === "All" || c.type === type) && (claimYear === "All" || String(c.year) === claimYear) && (status === "All" || c.status === status);
  }), [scopedClaims, query, type, claimYear, status]);

  const notify = (message: string) => { setToast(message); setTimeout(() => setToast(""), 2500); };
  const logActivity = async (action:string, details:string, recordType:string, recordId:string) => {
    if (!db || !profile || !currentUser) return;
    try {
      await addDoc(collection(db, "activityHistory"), {
        action, details, recordType, recordId, unit: profile.unit,
        actorUid: currentUser.uid, actorName: profile.displayName,
        actorRole: profile.role, createdAt: serverTimestamp()
      });
    } catch { /* The primary transaction must not fail when logging is unavailable. */ }
  };
  const saveClaimWithAudit=async(claim:Claim,action:string)=>{
    if(!db||!profile||!currentUser)return;
    const batch=writeBatch(db);
    batch.set(doc(db,"claims",claim.id),claim);
    batch.set(doc(collection(db,"activityHistory")),{
      action,details:`${claim.rank} ${claim.name}`,recordType:"claim",recordId:claim.id,
      unit:profile.unit,actorUid:currentUser.uid,actorName:profile.displayName,actorRole:profile.role,
      oldValue:claims.find(item=>item.id===claim.id)||null,newValue:claim,createdAt:serverTimestamp()
    });
    await batch.commit();
  };
  const title = nav.find(n => n[0] === page)?.[1] ?? "Dashboard";
  const canOpenPage=(key:Page)=>!administratorOnlyPages.includes(key)||role==="administrator";
  const primaryNav=nav.filter(([key])=>primaryNavKeys.includes(key)&&canOpenPage(key));
  const otherNav=nav.filter(([key])=>otherNavKeys.includes(key)&&canOpenPage(key));
  const otherPageActive=otherNavKeys.includes(page);
  const navigate=(key:Page)=>{setPage(key);setMobileNav(false)};
  const submitAuth = async (event:FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!auth || !db) { setAuthError("Firebase is not configured."); return; }
    setAuthBusy(true); setAuthError("");
    try {
      if (authTab === "signin") {
        await signInWithEmailAndPassword(auth, email.trim(), password);
      } else {
        registeringRef.current = true;
        const credential = await createUserWithEmailAndPassword(auth, email.trim(), password);
        await setDoc(doc(db, "users", credential.user.uid), {
          email: email.trim().toLowerCase(), role: "unit_user", status: "pending",
          displayName: fullName.trim(), unit: unit.trim(), createdAt: serverTimestamp()
        });
        await signOut(auth);
        registeringRef.current = false;
        setAuthTab("signin"); setPassword("");
        setAuthError("Registration submitted. Wait for administrator approval before signing in.");
      }
    } catch (error) {
      const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
      const messages:Record<string,string> = {
        "auth/invalid-credential":"Incorrect email address or password.",
        "auth/email-already-in-use":"This email address is already registered.",
        "auth/invalid-email":"Enter a valid email address.",
        "auth/weak-password":"Use a password with at least six characters.",
        "auth/too-many-requests":"Too many attempts. Please try again later."
      };
      setAuthError(messages[code] || "Authentication failed. Please try again.");
    } finally { registeringRef.current = false; setAuthBusy(false); }
  };
  const exportExcel = async () => {
    try {
      await exportClaimsExcel(filtered);
      void logActivity("Excel report exported", `${filtered.length} KIPO/WIPO records exported in the official format`, "report", "claims-registry");
      notify("Official Excel registry exported.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Excel export failed.");
    }
  };

  if (!authReady) return <main className="auth-loading"><img src="/pro4a-logo.png" alt="PRO 4A"/><p>Verifying secure access…</p></main>;

  if (!currentUser || !profile) return (
    <main className={`auth ${dark ? "dark" : ""}`}>
      <section className="auth-identity">
        <img className="watermark" src="/pro4a-logo.png" alt="" />
        <div className="identity-content">
          <img className="auth-logo" src="/pro4a-logo.png" alt="Police Regional Office 4A seal" />
          <p className="gold-kicker">Philippine National Police</p>
          <h1>PRO 4A Retirees and<br/>KIPO/WIPO Monitoring<br/>System</h1>
          <p className="hero-copy">Centralized monitoring of personnel claims, benefits, documentary requirements, workflow progress, and accountable actions.</p>
          <div className="security-note"><ShieldCheck size={18}/> Authorized users only • Role and unit-based access</div>
        </div>
      </section>
      <section className="auth-panel">
        <button className="theme-auth" onClick={() => setDark(!dark)} aria-label="Toggle color theme">{dark ? <Sun/> : <Moon/>}</button>
        <form className="auth-card" onSubmit={submitAuth}>
          <p className="green-kicker">Regional Comptrollership Division</p>
          <h2>Welcome</h2>
          <p className="muted">Sign in or register for an account.</p>
          <div className="auth-tabs">
            <button type="button" className={authTab==="signin"?"active":""} onClick={()=>setAuthTab("signin")}>Sign In</button>
            <button type="button" className={authTab==="register"?"active":""} onClick={()=>setAuthTab("register")}>Register</button>
          </div>
          {authTab === "register" && <>
            <label>Full Name<input required value={fullName} onChange={e=>setFullName(e.target.value)} placeholder="Rank and full name"/></label>
            <label>Unit / Office<select required value={unit} onChange={e=>setUnit(e.target.value)}><option value="">Select your assigned unit</option>{operationalUnits.filter(x=>x!=="RCD").map(x=><option key={x}>{x}</option>)}</select></label>
          </>}
          <label>Email Address<input required type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="Enter registered email"/></label>
          <label>Password<div className="password"><input required minLength={6} type={showPassword?"text":"password"} value={password} onChange={e=>setPassword(e.target.value)}/><button type="button" onClick={()=>setShowPassword(!showPassword)} aria-label={showPassword?"Hide password":"Show password"}>{showPassword?<EyeOff/>:<Eye/>}</button></div></label>
          {authError && <p className="auth-message" role="alert">{authError}</p>}
          <button className="primary auth-submit" disabled={authBusy}>{authBusy ? "Please wait…" : authTab==="signin" ? "Sign In" : "Submit Registration"}</button>
          {authTab==="register" && <p className="form-hint">New accounts require administrator approval before access is granted.</p>}
          <p className="version">PRO 4A Retirees and KIPO/WIPO Monitoring System v3.0 • Firebase-ready</p>
        </form>
      </section>
    </main>
  );

  return (
    <main className={`app ${dark ? "dark" : "light"}`}>
      {toast && <div className="toast"><CheckCircle2 size={18}/>{toast}</div>}
      <aside className={`sidebar ${mobileNav ? "open" : ""}`}>
        <div className="side-brand"><img src="/pro4a-logo.png" alt="PRO 4A"/><div><strong>PRO 4A</strong><span>Retirees and KIPO/WIPO</span></div><button className="mobile-close" onClick={()=>setMobileNav(false)}><X/></button></div>
        <nav aria-label="Main navigation">
          {primaryNav.map(([key,label,Icon]) => <button key={key} className={page===key?"active":""} onClick={()=>navigate(key)}><Icon/><span>{label}</span></button>)}
          <button
            className={`others-toggle ${otherPageActive?"active":""}`}
            aria-expanded={othersOpen||otherPageActive}
            aria-controls="other-navigation"
            onClick={()=>setOthersOpen(value=>!value)}
          >
            <Menu/><span>Others</span><ChevronDown className={(othersOpen||otherPageActive)?"rotated":""}/>
          </button>
          <div id="other-navigation" className={`other-nav ${(othersOpen||otherPageActive)?"open":""}`}>
            {otherNav.map(([key,label,Icon]) => <button key={key} className={page===key?"active":""} onClick={()=>navigate(key)}><Icon/><span>{label}</span></button>)}
          </div>
        </nav>
        <div className="side-user"><div className="avatar">{role==="administrator"?"SA":"UU"}</div><div><strong>{profile.displayName}</strong><span>{profile.unit}</span></div><button onClick={()=>auth&&signOut(auth)} title="Sign out"><LogOut/></button></div>
      </aside>
      <section className="main-area">
        <header className="topbar">
          <button className="menu-btn" onClick={()=>setMobileNav(true)}><Menu/></button>
          <div><h2>{title}</h2><p>{page==="records" ? "Personnel registry, workflow, and documentary monitoring" : "Regional Comptrollership Division • PRO CALABARZON"}</p></div>
          <div className="top-actions"><button onClick={()=>setDark(!dark)}>{dark?<Sun/>:<Moon/>}</button><span><ShieldCheck/>{role==="administrator"?"Administrator":"Unit User"}</span></div>
        </header>
        <div className="content">
          {page==="dashboard" && <Dashboard claims={scopedClaims} retirees={scopedRetirees} optionalRetirees={scopedOptionalRetirees} goRecords={()=>setPage("records")} goRetirees={()=>setPage("retirees")} goOptionalRetirees={()=>setPage("optional_retirees")} displayName={profile.displayName} unit={profile.unit}/>}
          {page==="records" && <Records role={role} profile={profile} claims={filtered} query={query} setQuery={setQuery} type={type} setType={setType} year={claimYear} setYear={setClaimYear} status={status} setStatus={setStatus} exportExcel={exportExcel} open={setModal} notify={notify} refresh={()=>notify(`Last successful synchronization • ${lastSyncAt?.toLocaleTimeString("en-PH",{hour:"2-digit",minute:"2-digit"})||"not yet available"}`)} remove={async(id)=>{if(role!=="administrator"||!db||!currentUser){notify("Only administrators can archive records.");return;}const record=claims.find(c=>c.id===id);if(!record)return;const reason=prompt("Reason for archiving this claim:")?.trim();if(!reason){notify("Archive cancelled. A reason is required.");return;}try{const batch=writeBatch(db);const archiveRef=doc(collection(db,"archivedRecords"));batch.set(archiveRef,{sourceCollection:"claims",sourceId:id,data:record,reason,archivedBy:profile.displayName,archivedUid:currentUser.uid,archivedAt:serverTimestamp()});batch.delete(doc(db,"claims",id));batch.set(doc(collection(db,"activityHistory")),{action:"Claim archived",details:`${record.rank} ${record.name} • ${reason}`,recordType:"claim",recordId:id,unit:record.province,actorUid:currentUser.uid,actorName:profile.displayName,actorRole:profile.role,oldValue:record,newValue:{archived:true,reason},createdAt:serverTimestamp()});await batch.commit();notify("Claim archived and recoverable.");}catch(error){void recordSystemError("Claim archive failed",error);notify("Archive failed. No record was removed.");}}}/>}
          {page==="retirees" && <RetireesPage title="Compulsory Retirees" collectionName="retirees" initialData={retireeRecords as Retiree[]} role={role} profile={profile} notify={notify}/>}
          {page==="optional_retirees" && <RetireesPage title="Optional Retirees" collectionName="optionalRetirees" initialData={optionalRetireeRecords as Retiree[]} role={role} profile={profile} notify={notify}/>}
          {page==="compliance" && <CompliancePage claims={scopedClaims} retirees={scopedRetirees} profile={profile} role={role} notify={notify}/>}
          {page==="reconcile" && role==="administrator" && <ReconciliationPage claims={claims} retirees={retirees} notify={notify}/>}
          {page==="announcements" && <AnnouncementsPage profile={profile} role={role} notify={notify}/>}
          {page==="help" && <HelpPage/>}
          {page==="import" && role==="administrator" && <ImportPage profile={profile} notify={notify} logActivity={logActivity}/>}
          {page==="users" && role==="administrator" && <UsersPage notify={notify} profile={profile} currentUser={currentUser}/>}
          {page==="history" && <HistoryPage profile={profile} role={role}/>}
          {page==="reports" && <ReportsPage claims={scopedClaims} notify={notify} logActivity={logActivity}/>}
          {page==="archive" && role==="administrator" && <ArchivePage profile={profile} notify={notify} recordError={recordSystemError} onRestore={(item)=>{
            if(item.sourceCollection==="claims"){
              setClaims(prev=>[item.data as Claim, ...prev.filter(c=>c.id!==item.sourceId)]);
            } else {
              setRetirees(prev=>[item.data as Retiree, ...prev.filter(r=>r.id!==item.sourceId)]);
            }
          }}/>}
          {page==="errors" && role==="administrator" && <ErrorCenter notify={notify} lastSyncAt={lastSyncAt}/>}
          {page==="validation" && role==="administrator" && <ValidationPage claims={claims} retirees={retirees}/>}
          {page==="profile" && <ProfilePage profile={profile} role={role} notify={notify}/>}
        </div>
      </section>
      {modal && <ClaimModal claim={modal.claim??null} readOnly={modal.mode==="view"} role={role} assignedUnit={profile.unit} close={()=>setModal(null)} save={async(c)=>{
        if(role==="unit_user"&&!sameUnit(c.province,profile.unit)){notify("You can only save records for your assigned unit.");return;}
        if(modal.mode==="new"&&claims.some(existing=>existing.id.toLowerCase()===c.id.toLowerCase())){notify("Claim ID already exists. Use a unique ID.");return;}
        const duplicate=potentialDuplicate(c,claims,modal.claim?.id);
        if(duplicate){notify(`Possible duplicate: ${duplicate.rank} ${duplicate.name} (${duplicate.province}). Review the existing record first.`);return;}
        const normalized={...c,stage:normalizeWorkflow(c.stage),status:normalizeClaimStatus(c.status,c.stage),lastUpdateDate:isoToday()};
        try{if(db)await saveClaimWithAudit(normalized,modal.mode==="new"?"Claim created":"Claim updated");setClaims(prev => prev.some(x=>x.id===normalized.id)?prev.map(x=>x.id===normalized.id?normalized:x):[normalized,...prev]);setModal(null);notify(firebaseConfigured?`Record saved • ${new Date().toLocaleString("en-PH")}`:"Record saved in demonstration mode.");}catch{notify("Save failed. No partial record or audit entry was written.");}}}/>}
    </main>
  );
}

function Dashboard({claims,retirees,optionalRetirees,goRecords,goRetirees,goOptionalRetirees,displayName,unit}:{claims:Claim[];retirees:Retiree[];optionalRetirees:Retiree[];goRecords:()=>void;goRetirees:()=>void;goOptionalRetirees:()=>void;displayName:string;unit:string}) {
  const [claimView,setClaimView]=useState("All");
  const [retireeView,setRetireeView]=useState("All");
  const hour=new Date().getHours();
  const greeting=hour<12?"Good morning":hour<18?"Good afternoon":"Good evening";
  const visibleClaims=claimView==="All"?claims:claims.filter(c=>String(c.year)===claimView);
  const visibleRetirees=retireeView==="All"?retirees:retirees.filter(r=>String(r.year)===retireeView);
  const complete=visibleClaims.filter(c=>c.status==="Completed").length;
  const pending=visibleClaims.filter(c=>c.status!=="Completed").length;
  const calProcessed=(records:Retiree[])=>records.filter(isCalProcessed).length;
  const calNotProcessed=(records:Retiree[])=>records.length-calProcessed(records);
  const incomplete=claims.filter(c=>!c.office?.trim()||!c.date?.trim()||!c.stage?.trim());
  const urgent=claims.filter(c=>c.status!=="Completed"&&["Incident Recorded","Document Completion","Document Review"].includes(c.stage)).length;
  const lackingDocuments=claims.filter(c=>Object.values(c.requirements||{}).filter(Boolean).length<claimRequirements.length).length;
  const staleClaims=claims.filter(c=>c.status!=="Completed"&&daysSince(c.lastUpdateDate||c.date)>=30).length;
  const followUpsDue=claims.filter(c=>c.status!=="Completed"&&c.nextFollowUpDate&&c.nextFollowUpDate<=isoToday()).length;
  const calForAction=retirees.filter(record=>!isCalProcessed(record)).length;
  const unassigned=retirees.filter(record=>!record.unit||record.unit==="Unassigned").length;
  const completionRate=visibleClaims.length?Math.round(complete/visibleClaims.length*100):0;
  return <div className="stack">
    <section className="welcome compact-welcome"><div><p>{unit} Monitoring Overview</p><h3>{greeting}, {displayName}</h3><span>KIPO/WIPO claims, compulsory retirees, and optional retirees at a glance.</span></div></section>
    <section className="combined-dashboard">
      <article className="dashboard-module panel">
        <div className="module-heading"><div><span className="module-kicker">Personnel Claims</span><h3>KIPO/WIPO Dashboard</h3></div><div className="year-switch" aria-label="KIPO/WIPO year filter">{["All","2025","2026"].map(y=><button key={y} className={claimView===y?"active":""} onClick={()=>setClaimView(y)}>{y}</button>)}</div></div>
        <div className="module-metrics">
          {[["Total Claims",visibleClaims.length],["KIPO",visibleClaims.filter(c=>c.type==="KIPO").length],["WIPO",visibleClaims.filter(c=>c.type==="WIPO").length],["Active",pending],["Completed",complete]].map(([label,value],i)=><div key={String(label)} className={`module-stat stat-${i}`}><span>{label}</span><strong>{value}</strong></div>)}
        </div>
        <div className="claim-visual">
          <div className="mini-bars"><div><span style={{width:`${visibleClaims.length?visibleClaims.filter(c=>c.type==="KIPO").length/visibleClaims.length*100:0}%`}}/><b>KIPO</b><em>{visibleClaims.filter(c=>c.type==="KIPO").length}</em></div><div><span className="blue" style={{width:`${visibleClaims.length?visibleClaims.filter(c=>c.type==="WIPO").length/visibleClaims.length*100:0}%`}}/><b>WIPO</b><em>{visibleClaims.filter(c=>c.type==="WIPO").length}</em></div></div>
          <div className="rate-pill"><strong>{completionRate}%</strong><span>Completion Rate</span></div>
        </div>
        <button className="module-link" onClick={goRecords}>View KIPO/WIPO Records <span>→</span></button>
      </article>
      <article className="dashboard-module panel">
        <div className="module-heading"><div><span className="module-kicker">Retirement Benefits</span><h3>Compulsory & Optional Retirees</h3></div><div className="year-switch" aria-label="Retirees year filter">{["All","2025","2026"].map(y=><button key={y} className={retireeView===y?"active":""} onClick={()=>setRetireeView(y)}>{y}</button>)}</div></div>
        <div className="retiree-main-metrics">
          <div><span>Total Retirees</span><strong>{visibleRetirees.length + optionalRetirees.length}</strong></div>
          <div className="processed"><span>Compulsory</span><strong>{visibleRetirees.length}</strong></div>
          <div className="processed"><span>Optional</span><strong>{optionalRetirees.length}</strong></div>
          <div className="processed"><span>CAL Processed</span><strong>{visibleRetirees.filter(isCalProcessed).length}</strong></div>
          <div className="processed"><span>Lump Sum Processed</span><strong>{visibleRetirees.filter(isLumpSumProcessed).length}</strong></div>
        </div>
        <div className="year-comparison">
          {[2025,2026].map(year=>{const rows=retirees.filter(r=>r.year===year);const calDone=rows.filter(isCalProcessed).length;const lumpDone=rows.filter(isLumpSumProcessed).length;return <div key={year}><b>CY {year}</b><span><strong>{rows.length}</strong> Compulsory</span><span><strong>{calDone}</strong> CAL Done</span><span><strong>{lumpDone}</strong> Lump Sum</span></div>;})}
        </div>
        <div style={{display:"flex",gap:"10px",marginTop:"12px"}}>
          <button className="module-link" style={{flex:1}} onClick={goRetirees}>Compulsory Retirees <span>→</span></button>
          <button className="module-link" style={{flex:1,background:"var(--panel2)",borderColor:"var(--line)"}} onClick={goOptionalRetirees}>Optional Retirees <span>→</span></button>
        </div>
      </article>
    </section>
    <section className="dash-grid">
      <article className="panel activity-panel"><PanelHead title="Claims Action Center" copy="Priority records requiring follow-up or correction"/><div className="action-center expanded"><button onClick={goRecords}><Clock3/><strong>{followUpsDue}</strong><span>Follow-ups due today or overdue</span></button><button onClick={goRecords}><ShieldCheck/><strong>{staleClaims}</strong><span>No update for 30 days or more</span></button><button onClick={goRecords}><FileText/><strong>{lackingDocuments}</strong><span>Incomplete documentary checklist</span></button><button onClick={goRecords}><BadgeCheck/><strong>{urgent}</strong><span>Early-stage claims for action</span></button><button onClick={goRetirees}><RefreshCw/><strong>{calForAction}</strong><span>CAL claims not yet processed</span></button><button onClick={goRetirees}><Users/><strong>{unassigned+incomplete.length}</strong><span>Unassigned or incomplete records</span></button></div></article>
    </section>
  </div>
}

function Records(p:{role:Role;profile:UserProfile;claims:Claim[];query:string;setQuery:(s:string)=>void;type:string;setType:(s:string)=>void;year:string;setYear:(s:string)=>void;status:string;setStatus:(s:string)=>void;exportExcel:()=>void;open:(state:ClaimModalState)=>void;remove:(id:string)=>void;refresh:()=>void;notify:(s:string)=>void}) {
  const [selected,setSelected]=useState<string[]>([]);
  const [bulkDate,setBulkDate]=useState(isoToday());
  const [bulkAction,setBulkAction]=useState("");
  const toggle=(id:string)=>setSelected(previous=>previous.includes(id)?previous.filter(item=>item!==id):[...previous,id]);
  const bulkUpdate=async()=>{
    if(!db||!selected.length||!bulkDate||!bulkAction.trim())return;
    if(selected.length>400){p.notify("Select no more than 400 records per bulk update.");return;}
    if(!confirm(`Update follow-up details for ${selected.length} selected records?`))return;
    try{
      const batch=writeBatch(db);
      p.claims.filter(record=>selected.includes(record.id)).forEach(record=>batch.set(doc(db!,"claims",record.id),{nextFollowUpDate:bulkDate,latestAction:bulkAction.trim(),lastUpdateDate:isoToday(),assignedFocalPerson:p.profile.displayName},{merge:true}));
      if(auth?.currentUser)batch.set(doc(collection(db,"activityHistory")),{action:"Bulk follow-up updated",details:`${selected.length} records • ${bulkAction.trim()} • next follow-up ${bulkDate}`,recordType:"claim",recordId:"bulk-follow-up",unit:p.profile.unit,actorUid:auth.currentUser.uid,actorName:p.profile.displayName,actorRole:p.profile.role,newValue:{recordIds:selected,nextFollowUpDate:bulkDate,latestAction:bulkAction.trim()},createdAt:serverTimestamp()});
      await batch.commit();setSelected([]);setBulkAction("");p.notify("Bulk follow-up update saved and recorded.");
    }catch{p.notify("Bulk update failed. No partial changes were written.");}
  };
  return <div className="stack">
    <section className="toolbar panel"><div className="search"><Search/><input aria-label="Search claims" value={p.query} onChange={e=>p.setQuery(e.target.value)} placeholder="Search name, unit, status..."/></div><Select label="Claim type" value={p.type} change={p.setType} options={["All","KIPO","WIPO"]}/><Select label="Claim year" value={p.year} change={p.setYear} options={["All","2025","2026"]}/><Select label="Claim status" value={p.status} change={p.setStatus} options={["All","Pending","In Process","For Review","Completed"]}/><button className="outline" onClick={p.exportExcel}><Download/>Export Excel</button><button className="primary" onClick={()=>p.open({mode:"new"})}><Plus/>Add Personnel</button></section>
    {selected.length>0&&<section className="panel bulk-bar"><strong>{selected.length} selected {selected.length>400&&<small className="validation-error">Maximum 400</small>}</strong><label>Next follow-up<input type="date" value={bulkDate} onChange={e=>setBulkDate(e.target.value)}/></label><label>Action taken<input value={bulkAction} onChange={e=>setBulkAction(e.target.value)} placeholder="Enter common action taken"/></label><button className="primary" disabled={selected.length>400} onClick={bulkUpdate}><Send/>Apply Update</button><button className="outline" onClick={()=>setSelected([])}>Clear</button></section>}
    <section className="panel registry"><PanelHead title="Personnel Claims Registry" copy={`${p.claims.length} records • Select personnel for bulk follow-up updates`} action={<button className="icon-button" aria-label="Check synchronization" title="Check synchronization" onClick={p.refresh}><RefreshCw/></button>}/><div className="table-wrap"><table><thead><tr><th><input aria-label="Select all visible records" type="checkbox" checked={Boolean(p.claims.length)&&selected.length===p.claims.length} onChange={e=>setSelected(e.target.checked?p.claims.map(c=>c.id):[])}/></th><th>Type / Year</th><th>Rank / Name</th><th>Date of Incident</th><th>Unit / Office</th><th>Workflow</th><th>Status</th><th>Actions</th></tr></thead><tbody>{p.claims.map(c=><tr key={c.id}><td><input aria-label={`Select ${c.rank} ${c.name}`} type="checkbox" checked={selected.includes(c.id)} onChange={()=>toggle(c.id)}/></td><td><em className={`type ${c.type.toLowerCase()}`}>{c.type}</em><small>CY {c.year}</small></td><td><strong>{c.rank} {c.name}</strong></td><td><strong>{c.dateDisplay || c.date}</strong><small>{c.sourceCoverage}</small></td><td>{c.province}<small>{c.office}</small></td><td><span className="stage">{c.stage}</span></td><td><span className={`status ${c.status.toLowerCase().replace(" ","-")}`}>{c.status}</span></td><td><div className="actions"><button title="View" aria-label={`View record of ${c.rank} ${c.name}`} onClick={()=>p.open({mode:"view",claim:c})}><Eye/></button><button className="edit" title="Edit" aria-label={`Edit record of ${c.rank} ${c.name}`} onClick={()=>p.open({mode:"edit",claim:c})}><Pencil/></button>{p.role==="administrator"&&<button className="delete" title="Archive" aria-label={`Archive record of ${c.rank} ${c.name}`} onClick={()=>p.remove(c.id)}><Archive/></button>}</div></td></tr>)}</tbody></table>{!p.claims.length&&<div className="empty">No matching records found.</div>}</div></section>
  </div>
}

type Retiree = {
  id:string; year:number; rank:string; name:string; retirementDate:string; retirementDisplay:string;
  unit?:string; calRequirements:string; lumpSumRequirements:string; status:string; remarks:string; sourceCoverage:string;
  calStatus?:"Processed"|"Not Processed"; requirements?:Record<string,boolean>;
  lumpSumStatus?:"Processed"|"Not Processed";
  lastUpdateDate?:string; nextFollowUpDate?:string; assignedFocalPerson?:string; latestAction?:string;
};
const isCalProcessed=(record:Retiree)=>record.calStatus?record.calStatus==="Processed":record.status==="Complete"||/\bcomplete(d)?\b/i.test(record.calRequirements||"");
const isLumpSumProcessed=(record:Retiree)=>record.lumpSumStatus?record.lumpSumStatus==="Processed":record.status==="Complete"||/\b(complete(d)?|submitted|prbs|uploaded)\b/i.test(record.lumpSumRequirements||"")||/\blumpsum\b/i.test(record.remarks||"");

const retireeRequirements=["CAL Folder","Lump Sum/Outright Folder","Service Record","Retirement Order","Latest Payslip","Clearances","Valid IDs","Bank Account Details"] as const;

const retireeMonths=["January","February","March","April","May","June","July","August","September","October","November","December"];

function RetireeMonthlyDashboard({records, title="Compulsory Retirees"}:{records:Retiree[]; title?:string}) {
  const availableYears=Array.from(new Set(records.map(record=>record.year))).sort((a,b)=>a-b);
  const [selectedYear,setSelectedYear]=useState<number>(availableYears.includes(2025)?2025:availableYears[0]||2025);

  const yearRecords=records.filter(record=>record.year===selectedYear);
  const monthly=retireeMonths.map((month,index)=>{
    const monthRecords=yearRecords.filter(record=>{
      const date=new Date(`${record.retirementDate}T00:00:00`);
      return !Number.isNaN(date.getTime())&&date.getMonth()===index;
    });
    const calDone=monthRecords.filter(isCalProcessed).length;
    const lumpDone=monthRecords.filter(isLumpSumProcessed).length;
    return {
      month,
      total:monthRecords.length,
      calDone,
      calPending:monthRecords.length-calDone,
      lumpDone,
      lumpPending:monthRecords.length-lumpDone
    };
  });
  const totalMonthlyTotal=monthly.reduce((sum,row)=>sum+row.total,0);
  const totalCalDone=monthly.reduce((sum,row)=>sum+row.calDone,0);
  const totalCalPending=monthly.reduce((sum,row)=>sum+row.calPending,0);
  const totalLumpDone=monthly.reduce((sum,row)=>sum+row.lumpDone,0);
  const totalLumpPending=monthly.reduce((sum,row)=>sum+row.lumpPending,0);

  const recapUnits=["Batangas PPO","Cavite PPO","Laguna PPO","Quezon PPO","Rizal PPO","RHQ","RMFB 4A"];
  const recapRows=recapUnits.map(unit=>{
    const unitRecords=yearRecords.filter(r=>sameUnit(r.unit,unit));
    const calDone=unitRecords.filter(isCalProcessed).length;
    const lumpDone=unitRecords.filter(isLumpSumProcessed).length;
    return {
      unit,
      total:unitRecords.length,
      calDone,
      calPending:unitRecords.length-calDone,
      lumpDone,
      lumpPending:unitRecords.length-lumpDone
    };
  });
  const totalRecapTotal=recapRows.reduce((sum,row)=>sum+row.total,0);
  const totalRecapCalDone=recapRows.reduce((sum,row)=>sum+row.calDone,0);
  const totalRecapCalPending=recapRows.reduce((sum,row)=>sum+row.calPending,0);
  const totalRecapLumpDone=recapRows.reduce((sum,row)=>sum+row.lumpDone,0);
  const totalRecapLumpPending=recapRows.reduce((sum,row)=>sum+row.lumpPending,0);

  return (
    <div className="stack">
      <div className="panel" style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"14px 22px"}}>
        <div style={{display:"flex",alignItems:"center",gap:"10px"}}>
          <span style={{fontSize:"11px",color:"#efc45d",textTransform:"uppercase",letterSpacing:".14em",fontWeight:800}}>{title}</span>
          <h3 style={{margin:0,fontSize:"20px"}}>CY {selectedYear} Executive Summary</h3>
        </div>
        <div className="year-switch" aria-label="Select retirement year">
          {availableYears.map(yr=>(
            <button key={yr} className={selectedYear===yr?"active":""} onClick={()=>setSelectedYear(yr)}>
              {yr}
            </button>
          ))}
        </div>
      </div>

      <section className="monthly-retiree-grid" aria-label={`Monthly ${title.toLowerCase()} dashboard`}>
        <article className="monthly-retiree panel">
          <header><h3>Monthly Breakdown ({selectedYear})</h3></header>
          <div className="monthly-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Month</th>
                  <th>Total No. of {title}</th>
                  <th>CAL Claims Processed</th>
                  <th>CAL Claims Not Yet Processed</th>
                  <th>Lump Sum Processed</th>
                  <th>Lump Sum Not Processed</th>
                </tr>
              </thead>
              <tbody>
                {monthly.map(row=>(
                  <tr key={row.month}>
                    <td>{row.month}</td>
                    <td>{row.total||"—"}</td>
                    <td>{row.calDone||"—"}</td>
                    <td>{row.calPending||"—"}</td>
                    <td>{row.lumpDone||"—"}</td>
                    <td>{row.lumpPending||"—"}</td>
                  </tr>
                ))}
                <tr className="monthly-total">
                  <td>Total</td>
                  <td>{totalMonthlyTotal}</td>
                  <td>{totalCalDone}</td>
                  <td>{totalCalPending}</td>
                  <td>{totalLumpDone}</td>
                  <td>{totalLumpPending}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </article>

        <article className="monthly-retiree panel">
          <header><h3>Recap by PPO and RHQ ({selectedYear})</h3></header>
          <div className="monthly-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>PPO / RHQ Unit</th>
                  <th>Total No. of {title}</th>
                  <th>CAL Processed</th>
                  <th>CAL Not Processed</th>
                  <th>Lump Sum Processed</th>
                  <th>Lump Sum Not Processed</th>
                </tr>
              </thead>
              <tbody>
                {recapRows.map(row=>(
                  <tr key={row.unit}>
                    <td style={{textAlign:"left",fontWeight:650}}>{row.unit}</td>
                    <td>{row.total||"—"}</td>
                    <td>{row.calDone||"—"}</td>
                    <td>{row.calPending||"—"}</td>
                    <td>{row.lumpDone||"—"}</td>
                    <td>{row.lumpPending||"—"}</td>
                  </tr>
                ))}
                <tr className="monthly-total">
                  <td style={{textAlign:"left"}}>Total</td>
                  <td>{totalRecapTotal}</td>
                  <td>{totalRecapCalDone}</td>
                  <td>{totalRecapCalPending}</td>
                  <td>{totalRecapLumpDone}</td>
                  <td>{totalRecapLumpPending}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </article>
      </section>
    </div>
  );
}

function RetireesPage({title="Compulsory Retirees",collectionName="retirees",initialData=retireeRecords as Retiree[],role,profile,notify}:{title?:string;collectionName?:string;initialData?:Retiree[];role:Role;profile:UserProfile;notify:(message:string)=>void}) {
  const [allRecords,setAllRecords]=useState<Retiree[]>(initialData);
  const [query,setQuery]=useState("");
  const [year,setYear]=useState("All");
  const [status,setStatus]=useState("All");
  const [editing,setEditing]=useState<Retiree|"new"|null>(null);
  useEffect(()=>{
    if(!db)return;
    const source=role==="administrator"
      ? collection(db,collectionName)
      : firestoreQuery(collection(db,collectionName),where("unit","==",profile.unit));
    return onSnapshot(source,snapshot=>{
      const remote=snapshot.docs.map(item=>item.data() as Retiree);
      setAllRecords(remote);
    },()=>notify(`Unable to load ${title.toLowerCase()} records from Firebase.`));
  },[notify,profile.unit,role,collectionName,title]);
  const scopedRecords=role==="administrator"?allRecords:allRecords.filter(record=>sameUnit(record.unit,profile.unit));
  const records=scopedRecords.filter(r=>{
    const text=`${r.id} ${r.rank} ${r.name} ${r.status} ${r.remarks}`.toLowerCase();
    return text.includes(query.toLowerCase()) &&
      (year==="All" || String(r.year)===year) &&
      (status==="All" || r.status===status);
  });
  const exportRetirees=async()=>{
    try {
      await exportRetireesExcel(records);
      notify(`${records.length} ${title.toLowerCase()} records exported in official Excel format.`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Excel export failed.");
    }
  };
  const statuses=["All",...Array.from(new Set(scopedRecords.map(r=>r.status)))];
  const saveRetiree=async(record:Retiree)=>{
    if(role==="unit_user"&&!sameUnit(record.unit,profile.unit)){notify(`You can only save ${title.toLowerCase()} records for your assigned unit.`);return;}
    if(editing==="new"&&allRecords.some(existing=>existing.id.toLowerCase()===record.id.toLowerCase())){notify("ID already exists. Use a unique ID.");return;}
    const sanitizedRecord = sanitizeRecord({
      ...record,
      unit: record.unit || profile.unit || "RHQ",
      lastUpdateDate: record.lastUpdateDate || isoToday()
    });
    try {
      if(db&&auth?.currentUser){
        const batch=writeBatch(db);
        batch.set(doc(db,collectionName,sanitizedRecord.id),sanitizedRecord);
        batch.set(doc(collection(db,"activityHistory")),{
          action:editing==="new"?`${title} created`:`${title} updated`,
          details:`${sanitizedRecord.rank} ${sanitizedRecord.name}`,
          recordType:collectionName,
          recordId:sanitizedRecord.id,
          unit:sanitizedRecord.unit || profile.unit,
          actorUid:auth.currentUser.uid,
          actorName:profile.displayName,
          actorRole:profile.role,
          oldValue:allRecords.find(r=>r.id===sanitizedRecord.id)||null,
          newValue:sanitizedRecord,
          createdAt:serverTimestamp()
        });
        await batch.commit();
      }
    } catch (error) {
      console.error("Save error:", error);
      void recordSystemError(`${title} save failed`, error);
      notify("Save failed. Check network or security permissions.");
      return;
    }
    setAllRecords(previous=>previous.some(r=>r.id===sanitizedRecord.id)?previous.map(r=>r.id===sanitizedRecord.id?sanitizedRecord:r):[sanitizedRecord,...previous]);
    setEditing(null);
    notify(firebaseConfigured ? `${title} record saved and synced to Firebase.` : `${title} record saved.`);
  };
  const removeRetiree=async(id:string)=>{
    if(role!=="administrator"||!db||!auth?.currentUser){notify("Only administrators can archive records.");return;}
    const record=allRecords.find(r=>r.id===id);if(!record)return;
    const reason=prompt(`Reason for archiving this ${title.toLowerCase()} record:`)?.trim();if(!reason){notify("Archive cancelled. A reason is required.");return;}
    try {const batch=writeBatch(db);const archiveRef=doc(collection(db,"archivedRecords"));batch.set(archiveRef,{sourceCollection:collectionName,sourceId:id,data:record,reason,archivedBy:profile.displayName,archivedUid:auth.currentUser.uid,archivedAt:serverTimestamp()});batch.delete(doc(db,collectionName,id));batch.set(doc(collection(db,"activityHistory")),{action:`${title} archived`,details:`${record.rank} ${record.name} • ${reason}`,recordType:collectionName,recordId:id,unit:record.unit,actorUid:auth.currentUser.uid,actorName:profile.displayName,actorRole:profile.role,oldValue:record,newValue:{archived:true,reason},createdAt:serverTimestamp()});await batch.commit();} catch { notify("Archive failed. No record was removed."); return; }
    setAllRecords(previous=>previous.filter(r=>r.id!==id)); notify(`${title} record archived and recoverable.`);
  };
  const yearOptions = ["All", ...Array.from(new Set(scopedRecords.map(r => String(r.year)))).sort()];
  return <div className="stack">
    <RetireeMonthlyDashboard records={scopedRecords} title={title}/>
    <section className="retiree-summary">
      <article><span>Total {title}</span><strong>{scopedRecords.length}</strong><small>{role==="administrator"?"All PRO 4A units":profile.unit}</small></article>
      <article><span>CY 2025</span><strong>{scopedRecords.filter(r=>r.year===2025).length}</strong><small>{title}</small></article>
      <article><span>CY 2026</span><strong>{scopedRecords.filter(r=>r.year===2026).length}</strong><small>Monitoring</small></article>
      <article><span>Complete</span><strong>{scopedRecords.filter(r=>r.status==="Complete").length}</strong><small>Requirements processed</small></article>
      <article><span>For Action</span><strong>{scopedRecords.filter(r=>r.status!=="Complete").length}</strong><small>Requires monitoring</small></article>
    </section>
    <section className="toolbar panel">
      <div className="search"><Search/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search name, status or remarks..."/></div>
      <Select value={year} change={setYear} options={yearOptions.length > 1 ? yearOptions : ["All","2025","2026","2027"]}/>
      <Select value={status} change={setStatus} options={statuses}/>
      <button className="outline" onClick={exportRetirees}><Download/>Export Excel</button>
      <button className="primary" onClick={()=>setEditing("new")}><Plus/>Add {title.replace(/s$/i,"")}</button>
    </section>
    <section className="panel registry">
      <PanelHead title={`${title} Registry`} copy={`${records.length} records • Multi-year monitoring`}/>
      <div className="table-wrap"><table className="retiree-table"><thead><tr><th>Rank / Name</th><th>Date of Retirement</th><th>CAL Requirements</th><th>Lump Sum</th><th>Status</th><th>Remarks</th><th>Actions</th></tr></thead>
      <tbody>{records.map(r=><tr key={r.id}><td><strong>{r.rank} {r.name}</strong><small>{r.unit||"Unit not assigned"}</small></td><td><strong>{r.retirementDisplay}</strong><small>CY {r.year}</small></td><td>{r.calRequirements}</td><td>{r.lumpSumRequirements}</td><td><span className={`status ${r.status==="Complete"?"completed":r.status==="Pending Clearance"?"pending":"in-process"}`}>{r.status}</span></td><td className="remarks-cell">{r.remarks}</td><td><div className="actions"><button className="edit" title="Update" aria-label={`Update record of ${r.rank} ${r.name}`} onClick={()=>setEditing(r)}><Pencil/></button>{role==="administrator"&&<button className="delete" title="Archive" aria-label={`Archive record of ${r.rank} ${r.name}`} onClick={()=>removeRetiree(r.id)}><Archive/></button>}</div></td></tr>)}</tbody></table>{!records.length&&<div className="empty">No records are assigned to {profile.unit}.</div>}</div>
    </section>
    {editing&&<RetireeModal title={title} retiree={editing==="new"?null:editing} role={role} assignedUnit={profile.unit} close={()=>setEditing(null)} save={saveRetiree}/>}
  </div>
}

function RetireeModal({title="Compulsory Retiree",retiree,role,assignedUnit,close,save}:{title?:string;retiree:Retiree|null;role:Role;assignedUnit:string;close:()=>void;save:(record:Retiree)=>void}) {
  const [data,setData]=useState<Retiree>(()=>{const now=new Date(),today=now.toISOString().slice(0,10),currentYear=now.getFullYear(),prefix=title.toLowerCase().includes("optional")?"OPT":"RET";return retiree??{id:`${prefix}-${currentYear}-${String(now.getTime()).slice(-3)}`,year:currentYear,rank:"",name:"",unit:role==="unit_user"?assignedUnit:"",retirementDate:today,retirementDisplay:new Date(today+"T00:00:00").toLocaleDateString("en-US",{month:"long",day:"2-digit",year:"numeric"}),calRequirements:"Pending",lumpSumRequirements:"Pending",status:"Pending Clearance",calStatus:"Not Processed",requirements:{},lastUpdateDate:today,remarks:"",sourceCoverage:`CY ${currentYear}`}});
  const field=(key:keyof Retiree,value:string|number)=>setData(current=>({...current,[key]:value}));
  const setDate=(value:string)=>setData(current=>({...current,retirementDate:value,year:Number(value.slice(0,4)),sourceCoverage:`CY ${value.slice(0,4)}`,retirementDisplay:new Date(value+"T00:00:00").toLocaleDateString("en-US",{month:"long",day:"2-digit",year:"numeric"})}));
  return <div className="modal-bg" onMouseDown={e=>e.target===e.currentTarget&&close()}><form className="modal panel" onSubmit={e=>{e.preventDefault();save(data)}}><div className="modal-head"><div><p>{title}</p><h3>{retiree?`Update ${title.toLowerCase().replace(/s$/i,"")} record`:`Add ${title.toLowerCase().replace(/s$/i,"")} record`}</h3></div><button type="button" onClick={close}><X/></button></div><div className="form-grid">
    <input type="hidden" value={data.id}/><label>Date of Retirement<input required type="date" value={data.retirementDate} onChange={e=>setDate(e.target.value)}/></label>
    <label>Rank<input required value={data.rank} onChange={e=>field("rank",e.target.value)}/></label><label>Full Name<input required value={data.name} onChange={e=>field("name",e.target.value)}/></label>
    <label>Unit / Office<select required disabled={role==="unit_user"} value={data.unit||""} onChange={e=>field("unit",e.target.value)}><option value="">Select unit</option>{operationalUnits.map(x=><option key={x}>{x}</option>)}</select></label>
    <label>CAL Processing Status<select value={data.calStatus||(isCalProcessed(data)?"Processed":"Not Processed")} onChange={e=>field("calStatus",e.target.value)}><option>Not Processed</option><option>Processed</option></select></label><label>CAL Requirements<input required value={data.calRequirements} onChange={e=>field("calRequirements",e.target.value)}/></label><label>Lump Sum Requirements<input required value={data.lumpSumRequirements} onChange={e=>field("lumpSumRequirements",e.target.value)}/></label>
    <label>Status<select value={data.status} onChange={e=>field("status",e.target.value)}>{["Complete","Pending Clearance","Lacking Requirements","Under BOS"].map(x=><option key={x}>{x}</option>)}</select></label>
    <label>Last Update Date<input type="date" value={data.lastUpdateDate||""} onChange={e=>field("lastUpdateDate",e.target.value)}/></label><label>Next Follow-up Date<input type="date" value={data.nextFollowUpDate||""} onChange={e=>field("nextFollowUpDate",e.target.value)}/></label><label>Assigned Focal Person<input value={data.assignedFocalPerson||""} onChange={e=>field("assignedFocalPerson",e.target.value)}/></label><label className="wide">Latest Action Taken<textarea value={data.latestAction||""} onChange={e=>field("latestAction",e.target.value)} rows={2}/></label>
    <label className="wide">Remarks<textarea value={data.remarks} onChange={e=>field("remarks",e.target.value)} rows={3}/></label>
  </div><section className="requirements-section"><div className="benefits-heading"><div><p>Documentary Requirements</p><strong>{Object.values(data.requirements||{}).filter(Boolean).length} of {retireeRequirements.length} complete</strong></div><small>Check only verified documents.</small></div><div className="requirements-checklist">{retireeRequirements.map(item=><label key={item}><input type="checkbox" checked={Boolean(data.requirements?.[item])} onChange={e=>setData(current=>({...current,requirements:{...(current.requirements||{}),[item]:e.target.checked}}))}/><span>{item}</span></label>)}</div></section><div className="modal-actions"><button type="button" className="outline" onClick={close}>Cancel</button><button className="primary">Save Retiree</button></div></form></div>
}

function ClaimModal({claim,readOnly,role,assignedUnit,close,save}:{claim:Claim|null;readOnly:boolean;role:Role;assignedUnit:string;close:()=>void;save:(c:Claim)=>void}) {
  const [data,setData]=useState<Claim>(()=>{const now=new Date();return claim??{id:`KIPO-${now.getFullYear()}-${String(now.getTime()).slice(-3)}`,type:"KIPO",year:now.getFullYear(),rank:"",name:"",province:role==="unit_user"?assignedUnit:"RHQ",office:"",stage:"Incident Recorded",status:"Pending",date:now.toISOString().slice(0,10),lastUpdateDate:isoToday(),requirements:{}}});
  const field=(key:keyof Claim,value:string|number)=>setData({...data,[key]:value});
  const benefit=(key:string,value:string)=>setData(current=>({...current,benefits:{...(current.benefits||{}),[key]:value}}));
  const benefitValue=(key:string)=>data.benefits?.[key]||(key==="pnpSfa"?data.benefits?.rhe:key==="promotion"?data.benefits?.specialPromotion:"")||"";
  const benefitGroups=[
    {title:"PNP",items:[["pnpSfa","PNP-SFA RA 6963"],["cal","CAL"],["promotion","Promotion"],["awards","Awards"]]},
    {title:"NAPOLCOM",items:[["napolcom","Gratuity"],["burial","Burial"],["pension","Pension"],["scholarship","Scholarship"]]},
    {title:"PSSLAI",items:[["psslai","PSSLAI"]]},
    {title:"AFPMBAI",items:[["afpmbai","AFPMBAI"]]},
    {title:"AFPSLAI",items:[["afpslai","AFPSLAI"]]},
    {title:"PSMBFI",items:[["psmbfi","PSMBFI–SGTI"]]},
    {title:"Comprehensive Social Benefits Program (CSBP)",items:[["psfSfa","PSF–SFA"],["education","Educational Assistance"],["philHealth","PhilHealth"]]},
    {title:"Others",items:[["others","Other Benefits / Assistance"]]},
  ] as const;
  return <div className="modal-bg" onMouseDown={e=>e.target===e.currentTarget&&close()}><form className="modal panel" onSubmit={e=>{e.preventDefault();if(!readOnly)save(data)}}><div className="modal-head"><div><p>Personnel Claim</p><h3>{readOnly?"Record details":claim?"Update record":"Add new personnel record"}</h3></div><button type="button" onClick={close} aria-label="Close"><X/></button></div><fieldset disabled={readOnly} className="plain-fieldset"><div className="form-grid">
    <input type="hidden" value={data.id}/><label>Claim Type<select value={data.type} onChange={e=>field("type",e.target.value)}><option>KIPO</option><option>WIPO</option></select></label>
    <label>Rank<input required value={data.rank} onChange={e=>field("rank",e.target.value.toUpperCase())}/></label><label>Full Name<input required value={data.name} onChange={e=>field("name",e.target.value.toUpperCase())}/></label>
    <label>Unit / Province<select required disabled={role==="unit_user"||readOnly} value={data.province} onChange={e=>field("province",e.target.value)}>{operationalUnits.map(x=><option key={x}>{x}</option>)}</select></label><label>Office<input required value={data.office} onChange={e=>field("office",e.target.value)}/></label>
    <label>Date of Incident<input required type="date" value={data.date} onChange={e=>field("date",e.target.value)}/></label><label>Workflow Stage<select value={normalizeWorkflow(data.stage)} onChange={e=>field("stage",e.target.value)}>{workflowStages.map(x=><option key={x}>{x}</option>)}</select></label><label>Status<select value={normalizeClaimStatus(data.status,data.stage)} onChange={e=>field("status",e.target.value)}>{claimStatuses.map(x=><option key={x}>{x}</option>)}</select></label>
    <label>Last Update Date<input type="date" value={data.lastUpdateDate||""} onChange={e=>field("lastUpdateDate",e.target.value)}/></label><label>Next Follow-up Date<input type="date" value={data.nextFollowUpDate||""} onChange={e=>field("nextFollowUpDate",e.target.value)}/></label><label>Assigned Focal Person<input value={data.assignedFocalPerson||""} onChange={e=>field("assignedFocalPerson",e.target.value)}/></label><label className="wide">Latest Action Taken<textarea rows={2} value={data.latestAction||""} onChange={e=>field("latestAction",e.target.value)}/></label>
  </div><section className="requirements-section"><div className="benefits-heading"><div><p>Documentary Requirements</p><strong>{Object.values(data.requirements||{}).filter(Boolean).length} of {claimRequirements.length} complete</strong></div><small>Check only documents already verified.</small></div><div className="requirements-checklist">{claimRequirements.map(item=><label key={item}><input type="checkbox" checked={Boolean(data.requirements?.[item])} onChange={e=>setData(current=>({...current,requirements:{...(current.requirements||{}),[item]:e.target.checked}}))}/><span>{item}</span></label>)}</div></section><section className="benefits-section"><div className="benefits-heading"><div><p>Claims and Benefits</p><strong>Benefits monitoring</strong></div><small>{readOnly?"Current recorded status":"Enter the status, amount, date, or remarks for each applicable benefit."}</small></div><div className="benefits-matrix">{benefitGroups.map(group=><article className={`benefit-group ${group.items.length===1?"compact":""}`} key={group.title}><h4>{group.title}</h4><div>{group.items.map(([key,label])=><label key={key}><span>{label}</span><textarea rows={2} placeholder={readOnly?"No entry recorded":"Enter status or remarks"} value={benefitValue(key)} onChange={e=>benefit(key,e.target.value)}/></label>)}</div></article>)}</div></section><div className="workflow"><strong>Workflow progress</strong><div>{["Incident Recorded","Document Completion","RHE Board Review","OP Validation","Benefits Released"].map((x,i)=>{const current=workflowStages.indexOf(normalizeWorkflow(data.stage) as typeof workflowStages[number]);const target=workflowStages.indexOf(x as typeof workflowStages[number]);const done=current>=target;return <span className={done?"done":""} key={x}><b>{done?"✓":i+1}</b>{x.replace(" Recorded","").replace(" Completion","").replace("RHE ","").replace("OP ","")}</span>})}</div></div></fieldset><div className="modal-actions"><button type="button" className="outline" onClick={close}>{readOnly?"Close":"Cancel"}</button>{!readOnly&&<button className="primary">Save Record</button>}</div></form></div>
}

type ImportKind="claims"|"retirees"|"optionalRetirees";
type ImportPreview={row:number;id:string;valid:boolean;duplicate:boolean;errors:string[];record:Claim|Retiree};
const cleanHeader=(value:string)=>value.trim().toLowerCase().replace(/[^a-z0-9]+/g,"");
const readCell=(row:Record<string,unknown>,aliases:string[])=>{
  const entries=Object.entries(row);
  for(const alias of aliases){
    const match=entries.find(([key])=>cleanHeader(key)===cleanHeader(alias));
    if(match&&String(match[1]??"").trim())return String(match[1]).trim();
  }
  return "";
};
const normalizeDate=(value:string)=>{
  const cleaned=value.trim();
  const named=cleaned.match(/^(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\D+(\d{1,2})\D+(\d{2}|\d{4})$/i);
  if(named){
    const months=["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
    const month=months.findIndex(item=>named[1].toLowerCase().startsWith(item));
    const day=Number(named[2]);
    const shortYear=Number(named[3]);
    const year=named[3].length===2?2000+shortYear:shortYear;
    const date=new Date(Date.UTC(year,month,day));
    if(month>=0&&date.getUTCFullYear()===year&&date.getUTCMonth()===month&&date.getUTCDate()===day)return date.toISOString().slice(0,10);
  }
  const longDate=cleaned.match(/(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}/i)?.[0];
  const date=new Date(longDate||cleaned);
  return Number.isNaN(date.getTime())?"":date.toISOString().slice(0,10);
};
const displayDate=(value:string)=>value?new Date(`${value}T00:00:00`).toLocaleDateString("en-US",{month:"long",day:"2-digit",year:"numeric"}):"";
const cellText=(value:unknown)=>String(value??"").trim();
const splitRankName=(value:string)=>{
  const text=value.trim().replace(/\s+/g," ");
  const match=text.match(/^(PGEN|PLTGEN|PMGEN|PBGEN|PCOL|PLTCOL|PMAJ|PCPT|PLT|PEMS|PCMS|PSMS|PMSg|PSSg|PCpl|Pat|NUP)\s+(.+)$/i);
  return match?{rank:match[1],name:match[2]}:{rank:"",name:text};
};
const inferUnit=(...values:string[])=>{
  const text=values.join(" ").toUpperCase();
  if(/\b(CPPO|CAVITE PPO)\b/.test(text))return "Cavite PPO";
  if(/\b(LPPO|LAGUNA PPO)\b/.test(text))return "Laguna PPO";
  if(/\b(QPPO|QUEZON PPO)\b/.test(text))return "Quezon PPO";
  if(/\b(RPPO|RIZAL PPO)\b/.test(text))return "Rizal PPO";
  if(/\b(BPPO|BATANGAS PPO)\b/.test(text))return "Batangas PPO";
  if(/\bRMFB(?:\s*4A)?\b/.test(text))return "RMFB 4A";
  if(/\b(RHQ|RCD|RPDEU|R[A-Z]+U\s*4A)\b/.test(text))return text.includes("RCD")?"RCD":"RHQ";
  return "";
};
const workflowFromText=(text:string)=>{
  const value=text.toLowerCase();
  if(/received|released|paid|granted|enrolled|complete/.test(value))return {stage:"Benefits Released",status:"Completed"};
  if(/napolcom/.test(value))return {stage:"NAPOLCOM Processing",status:"For Review"};
  if(/dilg/.test(value))return {stage:"DILG Validation",status:"For Review"};
  if(/approv|validation/.test(value))return {stage:"OP Validation",status:"For Review"};
  return {stage:"Document Completion",status:"In Process"};
};
const officialCoverage=(matrix:unknown[][],fallback:string)=>{
  const text=matrix.slice(0,6).flat().map(cellText).find(value=>/^as of /i.test(value));
  return text||fallback;
};
const parseOfficialClaims=(matrix:unknown[][],fileName:string):ImportPreview[]|null=>{
  const heading=matrix.slice(0,7).flat().map(cellText).join(" ").toUpperCase();
  const claimType=heading.includes("KIPO")?"KIPO":heading.includes("WIPO")?"WIPO":null;
  if(!claimType)return null;
  const year=Number(fileName.match(/20\d{2}/)?.[0]||heading.match(/20\d{2}/)?.[0]);
  if(!year)return null;
  const coverage=officialCoverage(matrix,`CY ${year}`);
  const firstDataRow=matrix.findIndex(cells=>{
    const serial=cellText(cells[0]);
    return /^\d+$/.test(serial)&&Boolean(splitRankName(cellText(cells[1])).rank);
  });
  if(firstDataRow<0)return [];
  let carriedDate="",carriedOffice="";
  return matrix.slice(firstDataRow).map((cells,index)=>{
    const serial=cellText(cells[0]);
    if(!/^\d+$/.test(serial)||!cellText(cells[1]))return null;
    const person=splitRankName(cellText(cells[1]));
    const errors:string[]=[];
    let office="",dateText="",injury="",benefits:Record<string,string>={};
    if(claimType==="WIPO"){
      dateText=cellText(cells[2])||carriedDate;
      office=cellText(cells[3])||carriedOffice;
      if(cellText(cells[2]))carriedDate=cellText(cells[2]);
      if(cellText(cells[3]))carriedOffice=cellText(cells[3]);
      injury=cellText(cells[12])||cellText(cells[4]);
      benefits={rhe:cellText(cells[5]),specialPromotion:cellText(cells[6]),awards:cellText(cells[7]),scholarship:cellText(cells[8]),psmbfi:cellText(cells[9]),psfSfa:cellText(cells[10]),others:cellText(cells[11])};
    }else{
      const hasExtraUnitColumn=matrix[4]?.length>17;
      office=cellText(cells[2]);
      dateText=cellText(cells[hasExtraUnitColumn?4:3]);
      const start=hasExtraUnitColumn?5:4;
      benefits={
        pnpSfa:cellText(cells[start]),cal:cellText(cells[start+1]),promotion:cellText(cells[start+2]),
        awards:cellText(cells[start+3]),napolcom:cellText(cells[start+4]),
        psmbfi:cellText(cells[start+(hasExtraUnitColumn?11:8)]),
        psfSfa:cellText(cells[start+(hasExtraUnitColumn?12:9)]),
        education:cellText(cells[start+(hasExtraUnitColumn?13:10)]),
        philHealth:cellText(cells[start+(hasExtraUnitColumn?14:11)]),
        others:cellText(cells[start+(hasExtraUnitColumn?15:12)])
      };
    }
    const date=normalizeDate(dateText);
    const unit=inferUnit(office,claimType==="KIPO"?cellText(cells[3]):"");
    const workflow=workflowFromText(Object.values(benefits).join(" "));
    const id=`${claimType}-${year}-${String(Number(serial)||index+1).padStart(3,"0")}`;
    if(!person.rank)errors.push("Missing or unrecognized rank");
    if(!person.name)errors.push("Missing name");
    if(!date)errors.push("Invalid incident date");
    if(!unit)errors.push("Unable to determine unit");
    if(!office)errors.push("Missing office");
    const record:Claim={id,type:claimType,year,rank:person.rank,name:person.name.toUpperCase(),province:unit,office,stage:normalizeWorkflow(workflow.stage),status:normalizeClaimStatus(workflow.status,workflow.stage),date,dateDisplay:dateText||displayDate(date),injury,sourceCoverage:coverage,benefits,lastUpdateDate:isoToday()};
    return {row:firstDataRow+index+1,id,valid:errors.length===0,duplicate:false,errors,record};
  }).filter((item):item is ImportPreview=>item!==null);
};
const parseOfficialRetirees=(matrix:unknown[][],fileName:string):ImportPreview[]|null=>{
  const heading=matrix.slice(0,4).flat().map(cellText).join(" ").toUpperCase();
  if(!heading.includes("COMPULSORY RETIREE"))return null;
  const year=Number(fileName.match(/20\d{2}/)?.[0]||heading.match(/20\d{2}/)?.[0]);
  if(!year)return null;
  const coverage=officialCoverage(matrix,`CY ${year}`);
  return matrix.slice(3).map((cells,index)=>{
    const serial=cellText(cells[0]);
    if(!serial||!cellText(cells[2]))return null;
    const person=splitRankName(cellText(cells[2]));
    const retirementDate=normalizeDate(cellText(cells[4]));
    const unit=inferUnit(cellText(cells[3]))||"Unassigned";
    const calRequirements=cellText(cells[5]);
    const lumpSumRequirements=cellText(cells[6]);
    const remarks=cellText(cells[7]);
    const complete=/complete/i.test(calRequirements)&&/complete/i.test(lumpSumRequirements);
    const status=complete?"Complete":/bos/i.test(`${calRequirements} ${lumpSumRequirements} ${remarks}`)?"Under BOS":"Pending Clearance";
    const id=`RET-${year}-${String(Number(serial)||index+1).padStart(3,"0")}`;
    const errors:string[]=[];
    if(!person.rank)errors.push("Missing or unrecognized rank");
    if(!person.name)errors.push("Missing name");
    if(!retirementDate)errors.push("Invalid retirement date");
    if(!calRequirements)errors.push("Missing CAL requirements");
    const record:Retiree={id,year,rank:person.rank,name:person.name.toUpperCase(),unit,retirementDate,retirementDisplay:displayDate(retirementDate),calRequirements,lumpSumRequirements,status,calStatus:complete?"Processed":"Not Processed",remarks,sourceCoverage:coverage,lastUpdateDate:isoToday()};
    return {row:index+4,id,valid:errors.length===0,duplicate:false,errors,record};
  }).filter((item):item is ImportPreview=>item!==null);
};

function ImportPage({profile,notify,logActivity}:{profile:UserProfile;notify:(s:string)=>void;logActivity:(a:string,d:string,t:string,id:string)=>Promise<void>}) {
  const [kind,setKind]=useState<ImportKind>("claims");
  const [fileName,setFileName]=useState("");
  const [rows,setRows]=useState<ImportPreview[]>([]);
  const [replaceDuplicates,setReplaceDuplicates]=useState(false);
  const [busy,setBusy]=useState(false);
  const fileRef=useRef<HTMLInputElement>(null);
  const reset=()=>{setRows([]);setFileName("");if(fileRef.current)fileRef.current.value="";};
  const downloadTemplate=async()=>{
    const XLSX=await import("xlsx");
    const headers=kind==="claims"
      ? ["Claim ID","Type","Year","Rank","Name","Unit","Office","Date of Incident","Workflow Stage","Status","Injury","Source Coverage"]
      : ["Retiree ID","Year","Rank","Name","Unit","Date of Retirement","CAL Requirements","Lump Sum Requirements","Status","Remarks","Source Coverage"];
    const example=kind==="claims"
      ? ["WIPO-2026-001","WIPO",2026,"PCpl","JUAN D. DELA CRUZ","Cavite PPO","Cavite PMFC","2026-07-15","Document Completion","In Process","Sample injury","As of July 2026"]
      : kind==="optionalRetirees"
      ? ["OPT-2026-001",2026,"PMSg","JUAN D. DELA CRUZ","Cavite PPO","2026-10-15","COMPLETE","Pending","Pending Clearance","Sample optional remarks","CY 2026"]
      : ["RET-2026-001",2026,"PMSg","JUAN D. DELA CRUZ","Cavite PPO","2026-10-15","COMPLETE","Pending","Pending Clearance","Sample compulsory remarks","CY 2026"];
    const workbook=XLSX.utils.book_new();
    const sheetName=kind==="claims"?"KIPO-WIPO":kind==="optionalRetirees"?"Optional-Retirees":"Compulsory-Retirees";
    const templateName=kind==="claims"?"PRO4A-KIPO-WIPO-Import-Template.xlsx":kind==="optionalRetirees"?"PRO4A-Optional-Retirees-Import-Template.xlsx":"PRO4A-Compulsory-Retirees-Import-Template.xlsx";
    XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet([headers,example]),sheetName);
    XLSX.writeFile(workbook,templateName);
    notify("Import template downloaded.");
  };
  const parseFile=async(file:File)=>{
    setBusy(true);setRows([]);setFileName(file.name);
    try{
      const XLSX=await import("xlsx");
      const workbook=XLSX.read(await file.arrayBuffer(),{type:"array",cellDates:true});
      const fileText = `${file.name} ${workbook.SheetNames.join(" ")}`.toLowerCase();
      let activeKind: ImportKind = kind;
      if (/optional/i.test(fileText)) {
        activeKind = "optionalRetirees";
        setKind("optionalRetirees");
      } else if (/retiree|compulsory|cal\b/i.test(fileText) && !/kipo|wipo/i.test(fileText)) {
        activeKind = "retirees";
        setKind("retirees");
      } else if (/kipo|wipo/i.test(fileText)) {
        activeKind = "claims";
        setKind("claims");
      }

      const selected=workbook.SheetNames.map((name,index)=>{
        const sheet=workbook.Sheets[name];
        const matrix=XLSX.utils.sheet_to_json<unknown[]>(sheet,{header:1,defval:"",raw:false,dateNF:"yyyy-mm-dd"});
        const heading=matrix.slice(0,7).flat().map(cellText).join(" ").toUpperCase();
        const fileYear=file.name.match(/20\d{2}/)?.[0]||"";
        const sheetYear=name.match(/20\d{2}/)?.[0]||"";
        const headingYear=heading.match(/20\d{2}/)?.[0]||"";
        const expectedKind=activeKind==="claims"?/\b(KIPO|WIPO)\b/.test(`${name} ${heading}`):activeKind==="optionalRetirees"?/OPTIONAL/.test(`${name} ${heading}`):/COMPULSORY|RETIREE|CAL/.test(`${name} ${heading}`);
        const yearMatch=Boolean(fileYear&&(sheetYear===fileYear||headingYear===fileYear));
        return {sheet,matrix,index,score:(expectedKind?20:0)+(yearMatch?20:0)+(sheetYear===fileYear?5:0)};
      }).sort((a,b)=>b.score-a.score||a.index-b.index)[0];

      const sheet=selected.sheet;
      const matrix=selected.matrix;
      const official=activeKind==="claims"?parseOfficialClaims(matrix,file.name):parseOfficialRetirees(matrix,file.name);
      const raw=XLSX.utils.sheet_to_json<Record<string,unknown>>(sheet,{defval:"",raw:false,dateNF:"yyyy-mm-dd"});
      if(!raw.length&&!official?.length)throw new Error("The selected file has no data rows.");

      const existingDocs=db?(await getDocs(collection(db,activeKind))).docs:[];
      const existingIds=new Set(existingDocs.map(item=>item.id.toLowerCase()));
      const existingPersonnel=new Set(existingDocs.map(item=>{
        const record=item.data() as Claim|Retiree;
        return "province" in record
          ? personnelKey(record.rank,record.name,record.province,record.date)
          : personnelKey(record.rank,record.name,record.unit||"",record.retirementDate);
      }));

      // Also merge seed records into duplicate detection
      if (activeKind === "claims") {
        (seedClaims as Claim[]).forEach(c => {
          existingIds.add(c.id.toLowerCase());
          existingPersonnel.add(personnelKey(c.rank,c.name,c.province,c.date));
        });
      } else if (activeKind === "retirees") {
        (retireeRecords as Retiree[]).forEach(r => {
          existingIds.add(r.id.toLowerCase());
          existingPersonnel.add(personnelKey(r.rank,r.name,r.unit||"",r.retirementDate));
        });
      } else {
        (optionalRetireeRecords as Retiree[]).forEach(r => {
          existingIds.add(r.id.toLowerCase());
          existingPersonnel.add(personnelKey(r.rank,r.name,r.unit||"",r.retirementDate));
        });
      }

      const seen=new Set<string>();const seenPersonnel=new Set<string>();
      const setDuplicate=(item:ImportPreview)=>{
        const key="province" in item.record
          ? personnelKey(item.record.rank,item.record.name,item.record.province,item.record.date)
          : personnelKey(item.record.rank,item.record.name,item.record.unit||"",item.record.retirementDate);
        const duplicate=existingIds.has(item.id.toLowerCase())||seen.has(item.id.toLowerCase())||(Boolean(item.record.name)&&(existingPersonnel.has(key)||seenPersonnel.has(key)));
        if(item.id)seen.add(item.id.toLowerCase());
        if(key)seenPersonnel.add(key);
        return {...item,duplicate};
      };

      const preview=official?.map(setDuplicate)??raw.map((row,index)=>{
        const errors:string[]=[];
        if(activeKind==="claims"){
          const rawId=readCell(row,["Claim ID","ID","Record ID","Control No","No.","Serial","Item"]);
          const rawType=readCell(row,["Type","Claim Type","Category","Kind"]).toUpperCase();
          const claimType=rawType.includes("WIPO")?"WIPO":rawType.includes("KIPO")?"KIPO":"KIPO";
          const rawDate=readCell(row,["Date of Incident","Incident Date","Date","Effective Date","Date of Incident/Death"]);
          const date=normalizeDate(rawDate)||(rawDate?isoToday():isoToday());
          const year=Number(readCell(row,["Year","CY"])||(date?date.slice(0,4):"2026"))||2026;
          const rawUnitText=readCell(row,["Unit","Unit / Province","Province","PPO","Office / Unit","Office","Assigned Unit"]);
          const unit=inferUnit(rawUnitText)||(operationalUnits.includes(rawUnitText)?rawUnitText:profile.unit||"RHQ");
          const office=readCell(row,["Office","Station","Office / Unit","Sub-Unit","Division"])||unit;
          const rawRank=readCell(row,["Rank","Designation","Title"]);
          let rawName=readCell(row,["Name","Full Name","Personnel Name","Rank & Name","Name of Personnel","Personnel","Member Name"]);
          if (!rawName) {
            const vals = Object.values(row).map(v => String(v || "").trim()).filter(Boolean);
            rawName = vals.find(v => /[a-zA-Z]{2,}/.test(v) && !/^\d+$/.test(v) && !normalizeDate(v) && v !== rawUnitText) || "";
          }
          const parsedPerson=splitRankName(rawName);
          const rank=(rawRank||parsedPerson.rank||"PNP").toUpperCase();
          const name=(parsedPerson.name||rawName).toUpperCase();
          const id=(rawId||`${claimType}-${year}-${String(index+1).padStart(3,"0")}`).toUpperCase();
          const rawStage=readCell(row,["Workflow Stage","Workflow","Stage","Progress"]);
          const rawStatus=readCell(row,["Status","Claim Status","State"]);
          const record:Claim={id,type:claimType,year,rank,name,province:unit,office,stage:normalizeWorkflow(rawStage),status:normalizeClaimStatus(rawStatus,rawStage),date,dateDisplay:displayDate(date),injury:readCell(row,["Injury","Injury Information","Remarks"]),sourceCoverage:readCell(row,["Source Coverage","Coverage"])||`CY ${year}`,lastUpdateDate:isoToday()};
          if(!record.name)errors.push("Missing name");
          const key=personnelKey(rank,name,unit,date);
          const duplicate=existingIds.has(id.toLowerCase())||seen.has(id.toLowerCase())||(Boolean(name)&&(existingPersonnel.has(key)||seenPersonnel.has(key)));
          if(id)seen.add(id.toLowerCase());
          if(key)seenPersonnel.add(key);
          return {row:index+2,id,valid:errors.length===0,duplicate,errors,record};
        }
        const rawId=readCell(row,["Retiree ID","ID","Record ID","Control No","No.","Serial","Item"]);
        const rawDate=readCell(row,["Date of Retirement","Retirement Date","Date","Effective Date"]);
        const retirementDate=normalizeDate(rawDate)||(rawDate?isoToday():isoToday());
        const year=Number(readCell(row,["Year","CY"])||(retirementDate?retirementDate.slice(0,4):"2026"))||2026;
        const rawUnitText=readCell(row,["Unit","Unit / Office","Office","PPO","Assigned Unit"]);
        const unit=inferUnit(rawUnitText)||(operationalUnits.includes(rawUnitText)?rawUnitText:profile.unit||"RHQ");
        const rawRank=readCell(row,["Rank","Designation","Title"]);
        let rawName=readCell(row,["Name","Full Name","Personnel Name","Rank & Name","Name of Personnel","Personnel","Member Name"]);
        if (!rawName) {
          const vals = Object.values(row).map(v => String(v || "").trim()).filter(Boolean);
          rawName = vals.find(v => /[a-zA-Z]{2,}/.test(v) && !/^\d+$/.test(v) && !normalizeDate(v) && v !== rawUnitText) || "";
        }
        const parsedPerson=splitRankName(rawName);
        const rank=(rawRank||parsedPerson.rank||"PNP").toUpperCase();
        const name=(parsedPerson.name||rawName).toUpperCase();
        const prefix=activeKind==="optionalRetirees"?"OPT":"RET";
        const id=(rawId||`${prefix}-${year}-${String(index+1).padStart(3,"0")}`).toUpperCase();
        const calRequirements=readCell(row,["CAL Requirements","CAL","CAL Status"])||"Pending";
        const lumpSumRequirements=readCell(row,["Lump Sum Requirements","Lump Sum","Lump Sum Status"])||"Pending";
        const rawStatus=readCell(row,["Status","Retirement Status","State"]);
        const complete=/complete/i.test(calRequirements)&&/complete/i.test(lumpSumRequirements);
        const status=rawStatus||(complete?"Complete":/bos/i.test(`${calRequirements} ${lumpSumRequirements}`)?"Under BOS":"Pending Clearance");
        const record:Retiree={id,year,rank,name,unit,retirementDate,retirementDisplay:displayDate(retirementDate),calRequirements,lumpSumRequirements,status,calStatus:complete?"Processed":"Not Processed",remarks:readCell(row,["Remarks","Note","Notes"])||"Imported record",sourceCoverage:readCell(row,["Source Coverage","Coverage"])||`CY ${year}`,lastUpdateDate:isoToday()};
        if(!record.name)errors.push("Missing name");
        const key=personnelKey(rank,name,unit,retirementDate);
        const duplicate=existingIds.has(id.toLowerCase())||seen.has(id.toLowerCase())||(Boolean(name)&&(existingPersonnel.has(key)||seenPersonnel.has(key)));
        if(id)seen.add(id.toLowerCase());
        if(key)seenPersonnel.add(key);
        return {row:index+2,id,valid:errors.length===0,duplicate,errors,record};
      });
      setRows(preview);
      const newCount = preview.filter(r => r.valid && !r.duplicate).length;
      const dupCount = preview.filter(r => r.duplicate).length;
      notify(`${preview.length} rows checked: ${newCount} new records ready, ${dupCount} duplicate records skipped.`);
    }catch(error){reset();notify(error instanceof Error?error.message:"Unable to read the selected file.");}
    finally{setBusy(false);}
  };
  const validRows=rows.filter(row=>row.valid&&(!row.duplicate||replaceDuplicates));
  const invalidCount=rows.filter(row=>!row.valid).length;
  const duplicateCount=rows.filter(row=>row.duplicate).length;
  const importRows=async()=>{
    if(!db||!validRows.length)return;
    if(validRows.length>450){notify("For safety, import a maximum of 450 records at one time. No records were written.");return;}
    const action=replaceDuplicates?"create new records and update matching IDs":"create new records and skip matching IDs";
    const labelText=kind==="claims"?"KIPO/WIPO":kind==="optionalRetirees"?"optional retiree":"compulsory retiree";
    if(!confirm(`Import ${validRows.length} validated ${labelText} records?\n\nThis will ${action}.`))return;
    setBusy(true);
    try{
      const batch=writeBatch(db);
      validRows.forEach(item=>batch.set(doc(db!,kind,item.id),item.record));
      if(auth?.currentUser)batch.set(doc(collection(db,"activityHistory")),{
        action:"Bulk data imported",details:`${validRows.length} ${labelText} records • ${fileName} • ${replaceDuplicates?"duplicates updated":"duplicates skipped"}`,
        recordType:"import",recordId:kind,unit:profile.unit,actorUid:auth.currentUser.uid,
        actorName:profile.displayName,actorRole:profile.role,newValue:{fileName,count:validRows.length,replaceDuplicates},createdAt:serverTimestamp()
      });
      await batch.commit();
      notify(`${validRows.length} records imported successfully.`);
      reset();
    }catch{notify("Import failed. The atomic batch was rolled back; no records from this file were written.");}
    finally{setBusy(false);}
  };
  return <div className="stack">
    <section className="import-hero"><div><p>Administrator Tool</p><h3>Import Official Records</h3><span>Validate Excel or CSV files before adding them to Firebase. Nothing is saved until you review and confirm.</span></div><FileSpreadsheet/></section>
    <section className="panel import-panel">
      <div className="import-steps"><div className="active"><b>1</b><span>Select data</span></div><div className={rows.length?"active":""}><b>2</b><span>Review validation</span></div><div><b>3</b><span>Confirm import</span></div></div>
      <div className="import-controls">
        <label>Data type<select value={kind} onChange={e=>{setKind(e.target.value as ImportKind);reset()}}><option value="claims">KIPO/WIPO Records</option><option value="retirees">Compulsory Retirees</option><option value="optionalRetirees">Optional Retirees</option></select></label>
        <button className="outline" onClick={downloadTemplate}><Download/>Download Template</button>
      </div>
      <label className="drop-zone">
        <Upload/><strong>{busy?"Reading and validating file…":fileName||"Choose Excel or CSV file"}</strong>
        <span>Accepted formats: .xlsx, .xls, and .csv • First worksheet will be imported</span>
        <input ref={fileRef} disabled={busy} type="file" accept=".xlsx,.xls,.csv" onChange={e=>e.target.files?.[0]&&parseFile(e.target.files[0])}/>
      </label>
    </section>
    {rows.length>0&&<section className="panel import-review">
      <PanelHead title="Validation Summary" copy={`${fileName} • ${rows.length} data rows checked`}/>
      <div className="validation-cards"><article><span>Valid new rows</span><strong>{rows.filter(r=>r.valid&&!r.duplicate).length}</strong></article><article><span>Duplicate IDs</span><strong>{duplicateCount}</strong></article><article><span>Rows with errors</span><strong>{invalidCount}</strong></article><article><span>Ready to import</span><strong>{validRows.length}</strong></article></div>{validRows.length>450&&<p className="validation-error">Safety limit exceeded. Split the file into batches of 450 or fewer; nothing can be imported until corrected.</p>}
      <label className="duplicate-option"><input type="checkbox" checked={replaceDuplicates} onChange={e=>setReplaceDuplicates(e.target.checked)}/><span><strong>Update existing records with matching IDs</strong><small>Off by default. When off, duplicate records are skipped and existing Firebase data is preserved.</small></span></label>
      <div className="table-wrap"><table className="import-table"><thead><tr><th>Row</th><th>Record ID</th><th>Name</th><th>Unit</th><th>Result</th></tr></thead><tbody>{rows.slice(0,100).map(item=><tr key={`${item.row}-${item.id}`}><td>{item.row}</td><td><b className="claim-id">{item.id||"—"}</b></td><td>{item.record.name||"—"}</td><td>{"province" in item.record?item.record.province:item.record.unit||"—"}</td><td>{!item.valid?<span className="validation-error">{item.errors.join("; ")}</span>:item.duplicate?<span className="validation-duplicate">{replaceDuplicates?"Will update":"Will skip"}</span>:<span className="validation-valid">Ready</span>}</td></tr>)}</tbody></table>{rows.length>100&&<p className="preview-note">Showing the first 100 rows. All {rows.length} rows were validated.</p>}</div>
      <div className="import-actions"><button className="outline" onClick={reset}>Clear File</button><button className="primary" disabled={busy||!validRows.length} onClick={importRows}><Upload/>{busy?"Importing…":`Import ${validRows.length} Records`}</button></div>
    </section>}
    <section className="panel import-guidance"><ShieldCheck/><div><strong>Safe import controls</strong><p>Only administrators can open this page. Required fields, units, dates, and duplicate IDs are checked before saving. Every completed import is recorded in Activity History under {profile.unit}.</p></div></section>
  </div>
}

type ManagedUser = UserProfile & { id:string };
function UsersPage({notify,profile,currentUser}:{notify:(s:string)=>void;profile:UserProfile;currentUser:User|null}) {
  const [users,setUsers]=useState<ManagedUser[]>([]);
  const [seeding,setSeeding]=useState(false);
  useEffect(()=>{
    if(!db)return;
    return onSnapshot(collection(db,"users"),snapshot=>{
      setUsers(snapshot.docs.map(item=>({id:item.id,...item.data()} as ManagedUser)));
    },()=>notify("Unable to load registered users."));
  },[notify]);
  const setStatus=async(user:ManagedUser,status:UserProfile["status"])=>{
    if(!db||!currentUser)return;
    const batch=writeBatch(db);
    batch.set(doc(db,"users",user.id),{status},{merge:true});
    batch.set(doc(collection(db,"activityHistory")),{
      action:status==="disabled"?"Focal person disabled":"Focal person approved",
      details:`${user.displayName} • ${user.email}`,recordType:"user",recordId:user.id,unit:profile.unit,
      actorUid:currentUser.uid,actorName:profile.displayName,actorRole:profile.role,
      oldValue:{status:user.status,unit:user.unit},newValue:{status,unit:user.unit},createdAt:serverTimestamp()
    });
    await batch.commit();
    notify(`${user.displayName} is now ${status}.`);
  };
  const setUnitAssignment=async(user:ManagedUser,unit:string)=>{
    if(!db)return;
    await setDoc(doc(db,"users",user.id),{unit},{merge:true});
    notify(`${user.displayName}'s assigned unit is now ${unit}.`);
  };
  const initializeData=async()=>{
    if(!db)return;
    setSeeding(true);
    try{
      const [claimSnapshot,retireeSnapshot,optionalSnapshot]=await Promise.all([
        getDocs(collection(db,"claims")),
        getDocs(collection(db,"retirees")),
        getDocs(collection(db,"optionalRetirees"))
      ]);
      const claimIds=new Set(claimSnapshot.docs.map(item=>item.id));
      const retireeIds=new Set(retireeSnapshot.docs.map(item=>item.id));
      const optionalIds=new Set(optionalSnapshot.docs.map(item=>item.id));
      const missingClaims=seedClaims.filter(record=>!claimIds.has(record.id));
      const missingRetirees=retireeRecords.filter(record=>!retireeIds.has(record.id));
      const legacyOptional=optionalSnapshot.docs.filter(item=>item.id.startsWith("OPT-2025-"));
      const missingOptional=optionalRetireeRecords.filter(record=>!optionalIds.has(record.id));
      if(!missingClaims.length&&!missingRetirees.length&&!missingOptional.length&&!legacyOptional.length){notify("Official registry is already initialized. No records were changed.");return;}
      if(!confirm(`Safe initialization preview:\n\n${missingClaims.length} new KIPO/WIPO records\n${missingRetirees.length} new compulsory retiree records\n${missingOptional.length} new optional retiree records\n${legacyOptional.length} legacy sample records to clean up\n\nContinue?`))return;
      const batch=writeBatch(db);
      missingClaims.forEach(record=>batch.set(doc(db!,"claims",record.id),record));
      missingRetirees.forEach(record=>batch.set(doc(db!,"retirees",record.id),record));
      legacyOptional.forEach(docItem=>batch.delete(docItem.ref));
      missingOptional.forEach(record=>batch.set(doc(db!,"optionalRetirees",record.id),record));
      await batch.commit();
      notify(`Safe initialization complete: ${missingClaims.length+missingRetirees.length+missingOptional.length} records synchronized.`);
    }catch{notify("Upload failed. Confirm the administrator role and Firestore rules.");}
    finally{setSeeding(false);}
  };
  return <section className="panel page-panel"><PanelHead title="Focal Persons" copy="Approve focal person accounts, assign their unit, and safely initialize missing official records" action={<button className="primary" disabled={seeding} onClick={initializeData}><RefreshCw/>{seeding?"Checking…":"Safe Initialize"}</button>}/><div className="user-cards">{users.map(u=><article key={u.id}><div className="avatar">{(u.displayName||u.email).split(" ").map(x=>x[0]).slice(-2).join("").toUpperCase()}</div><div><strong>{u.displayName||u.email}</strong><p>{u.role==="admin"?"Administrator":"Focal Person"}<br/>{u.email}</p></div>{u.role==="admin"?<strong>{u.unit}</strong>:<select aria-label={`Assigned unit for ${u.displayName}`} value={u.unit||""} onChange={e=>setUnitAssignment(u,e.target.value)}><option value="">Assign unit</option>{operationalUnits.filter(x=>x!=="RCD").map(x=><option key={x}>{x}</option>)}</select>}<span className={`status ${u.status==="approved"?"completed":"pending"}`}>{u.status}</span>{u.role!=="admin"&&<button className="outline" disabled={!u.unit} onClick={()=>setStatus(u,u.status==="approved"?"disabled":"approved")}>{u.status==="approved"?"Disable":"Approve"}</button>}</article>)}{!users.length&&<div className="empty">No registered focal persons found.</div>}</div></section>
}
type ActivityEntry={id:string;action:string;details:string;unit:string;actorName:string;createdAt?:{toDate?:()=>Date}};
function HistoryPage({profile,role}:{profile:UserProfile;role:Role}) {
  const [entries,setEntries]=useState<ActivityEntry[]>([]);
  useEffect(()=>{
    if(!db)return;
    const source=role==="administrator"?collection(db,"activityHistory"):firestoreQuery(collection(db,"activityHistory"),where("unit","==",profile.unit));
    return onSnapshot(source,snapshot=>setEntries(snapshot.docs.map(item=>({id:item.id,...item.data()} as ActivityEntry)).sort((a,b)=>(b.createdAt?.toDate?.().getTime()||0)-(a.createdAt?.toDate?.().getTime()||0))));
  },[profile.unit,role]);
  return <section className="panel page-panel"><PanelHead title="Activity History" copy="Actual accountable actions recorded by the system"/><div className="timeline">{entries.map(entry=><article key={entry.id}><i><Activity/></i><div><strong>{entry.action}</strong><p>{entry.details}</p><small>{entry.createdAt?.toDate?.().toLocaleString("en-PH")||"Syncing time…"} • {entry.actorName} • {entry.unit}</small></div></article>)}{!entries.length&&<div className="empty">No recorded activity yet. New record actions will appear here.</div>}</div></section>
}
function ReportsPage({claims,notify,logActivity}:{claims:Claim[];notify:(s:string)=>void;logActivity:(a:string,d:string,t:string,id:string)=>Promise<void>}) {
  const reports=[
    {title:"Consolidated Registry",copy:"Complete KIPO/WIPO personnel registry",rows:claims},
    {title:"Pending Claims",copy:"Records requiring documentary follow-up",rows:claims.filter(c=>c.status!=="Completed")},
    {title:"Completed Claims",copy:"Benefits already processed and completed",rows:claims.filter(c=>c.status==="Completed")},
    {title:"2026 Annual Report",copy:"Management registry for calendar year 2026",rows:claims.filter(c=>c.year===2026)}
  ];
  const generate=async(title:string,rows:Claim[])=>{
    try {
      await exportClaimsExcel(rows,`PRO4A-${title.replaceAll(" ","-")}.xlsx`);
      void logActivity("Excel report generated",`${title} • ${rows.length} records • official workbook format`,"report",title.toLowerCase().replaceAll(" ","-"));
      notify(`${title} Excel file generated.`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Excel export failed.");
    }
  };
  return <div className="stack"><section className="report-head"><div><p>Decision Support</p><h3>Reports and Analytics</h3><span>Each report generates a genuine Excel workbook using the official KIPO/WIPO layout.</span></div><BarChart3/></section><section className="report-grid">{reports.map(report=><article className="panel" key={report.title}><i><FileText/></i><h4>{report.title}</h4><p>{report.copy}</p><strong>{report.rows.length} records</strong><button className="outline" onClick={()=>generate(report.title,report.rows)}><Download/>Generate Excel</button></article>)}</section></div>
}

type Certification={id:string;unit:string;period:string;claimCount:number;retireeCount:number;dataFingerprint?:string;certifiedBy:string;createdAt?:{toDate?:()=>Date}};
function CompliancePage({claims,retirees,profile,role,notify}:{claims:Claim[];retirees:Retiree[];profile:UserProfile;role:Role;notify:(s:string)=>void}) {
  const [certifications,setCertifications]=useState<Certification[]>([]);
  const [certificationsReady,setCertificationsReady]=useState(true);
  useEffect(()=>{
    if(!db)return;
    const source=role==="administrator"?collection(db,"certifications"):firestoreQuery(collection(db,"certifications"),where("unit","==",profile.unit));
    return onSnapshot(
      source,
      snapshot=>{
        setCertifications(snapshot.docs.map(item=>({id:item.id,...item.data()} as Certification)));
        setCertificationsReady(true);
      },
      ()=>{
        setCertifications([]);
        setCertificationsReady(false);
      }
    );
  },[profile.unit,role]);
  const rows=operationalUnits.filter(unit=>unit!=="RCD").map(unit=>{
    const unitClaims=claims.filter(c=>sameUnit(c.province,unit));const unitRetirees=retirees.filter(r=>sameUnit(r.unit,unit));
    const completeDocs=unitClaims.filter(c=>Object.values(c.requirements||{}).filter(Boolean).length===claimRequirements.length).length;
    const timely=unitClaims.filter(c=>daysSince(c.lastUpdateDate||c.date)<30).length;
    const overdue=unitClaims.filter(c=>c.status!=="Completed"&&daysSince(c.lastUpdateDate||c.date)>=30).length;
    const hasData=unitClaims.length+unitRetirees.length>0;
    const completeness=unitClaims.length?completeDocs/unitClaims.length*100:0;
    const timeliness=unitClaims.length?timely/unitClaims.length*100:0;
    const certification=certifications.filter(c=>sameUnit(c.unit,unit)).sort((a,b)=>(b.createdAt?.toDate?.().getTime()||0)-(a.createdAt?.toDate?.().getTime()||0))[0];
    const fingerprint=dataFingerprint(unitClaims,unitRetirees);
    const certified=Boolean(certificationsReady&&certification&&certification.dataFingerprint===fingerprint);
    const score=hasData?Math.max(0,Math.round(completeness*.45+timeliness*.35+(certified?20:0)-Math.min(overdue*2,20))):null;
    return {unit,unitClaims,unitRetirees,completeness,timeliness,overdue,certified,certification,score,hasData};
  }).filter(row=>role==="administrator"||sameUnit(row.unit,profile.unit)).sort((a,b)=>(b.score??-1)-(a.score??-1));
  const certify=async()=>{
    if(!db||!auth?.currentUser)return;
    const unitClaims=claims.filter(c=>sameUnit(c.province,profile.unit));const unitRetirees=retirees.filter(r=>sameUnit(r.unit,profile.unit));
    if(!confirm(`I certify that the ${unitClaims.length} KIPO/WIPO and ${unitRetirees.length} retiree records for ${profile.unit} are accurate and updated as of ${new Date().toLocaleDateString("en-PH")}.`))return;
    const batch=writeBatch(db);const ref=doc(collection(db,"certifications"));
    const payload={unit:profile.unit,period:new Date().toLocaleDateString("en-PH",{month:"long",year:"numeric"}),claimCount:unitClaims.length,retireeCount:unitRetirees.length,dataFingerprint:dataFingerprint(unitClaims,unitRetirees),certifiedBy:profile.displayName,certifiedUid:auth.currentUser.uid,createdAt:serverTimestamp()};
    batch.set(ref,payload);batch.set(doc(collection(db,"activityHistory")),{action:"Data accuracy certified",details:`${profile.unit} • ${unitClaims.length} claims • ${unitRetirees.length} retirees`,recordType:"certification",recordId:ref.id,unit:profile.unit,actorUid:auth.currentUser.uid,actorName:profile.displayName,actorRole:profile.role,newValue:payload,createdAt:serverTimestamp()});
    try{await batch.commit();notify("Certification of Data Accuracy submitted.");}catch{notify("Certification failed. No certification was recorded.");}
  };
  return <div className="stack"><section className="report-head compliance-head"><div><p>Regional Monitoring</p><h3>Compliance Dashboard and Unit Scorecard</h3><span>Score: 45% completeness, 35% timeliness, and 20% current certification, with overdue deductions. Units without records are not ranked.</span></div><Trophy/></section>{!certificationsReady&&<section className="panel import-guidance"><AlertTriangle/><div><strong>Certification status is temporarily unavailable</strong><p>The scorecard remains available, but certification points are withheld until the updated Firestore security rules are published.</p></div></section>}{role==="unit_user"&&<section className="panel certify-card"><div><ClipboardCheck/><div><strong>Certification of Data Accuracy</strong><p>Review your visible KIPO/WIPO and retiree records before certifying the current figures. Any covered data change automatically expires this certification.</p></div></div><button className="primary" onClick={certify}><ShieldCheck/>Certify Current Data</button></section>}<section className="panel registry"><PanelHead title="Unit Performance Scorecard" copy="Regional ranking based on measurable record compliance"/><div className="table-wrap"><table><thead><tr><th>Rank</th><th>Unit</th><th>Records</th><th>Completeness</th><th>Timeliness</th><th>Overdue</th><th>Certification</th><th>Score</th></tr></thead><tbody>{rows.map(row=><tr key={row.unit}><td><strong>{row.hasData?`#${rows.filter(r=>r.hasData).findIndex(r=>r.unit===row.unit)+1}`:"—"}</strong></td><td><strong>{row.unit}</strong></td><td>{row.unitClaims.length} claims<small>{row.unitRetirees.length} retirees</small></td><td>{row.hasData?`${Math.round(row.completeness)}%`:"No data"}</td><td>{row.hasData?`${Math.round(row.timeliness)}%`:"No data"}</td><td>{row.overdue}</td><td><span className={`status ${row.certified?"completed":"pending"}`}>{!row.hasData?"Not applicable":!certificationsReady?"Unavailable":row.certified?"Current":"Needs certification"}</span>{certificationsReady&&row.certification&&<small>{row.certification.certifiedBy}</small>}</td><td><strong className="score">{row.score??"Not ranked"}</strong></td></tr>)}</tbody></table></div></section></div>
}

type ReconcileRow={name:string;unit:string;type:string;result:"Missing in System"|"Conflicting"|"Matched";details:string};
function ReconciliationPage({claims,retirees,notify}:{claims:Claim[];retirees:Retiree[];notify:(s:string)=>void}) {
  const [rows,setRows]=useState<ReconcileRow[]>([]);const [fileName,setFileName]=useState("");
  const read=async(file:File)=>{
    try{
      const XLSX=await import("xlsx");const wb=XLSX.read(await file.arrayBuffer(),{type:"array",raw:false,cellDates:true});
      const fileYear=file.name.match(/20\d{2}/)?.[0]||"";
      const selected=wb.SheetNames.map((name,index)=>{const sheet=wb.Sheets[name];const matrix=XLSX.utils.sheet_to_json<unknown[]>(sheet,{header:1,defval:"",raw:false,dateNF:"yyyy-mm-dd"});const heading=matrix.slice(0,8).flat().map(cellText).join(" ").toUpperCase();const sheetYear=name.match(/20\d{2}/)?.[0]||"";const headingYear=heading.match(/20\d{2}/)?.[0]||"";const retireesKind=/COMPULSORY|RETIRE/.test(`${file.name} ${heading}`.toUpperCase());const yearMatch=Boolean(fileYear&&(sheetYear===fileYear||headingYear===fileYear));return {sheet,matrix,retireesKind,index,score:(yearMatch?20:0)+(sheetYear===fileYear?5:0)+(/\b(KIPO|WIPO)\b|COMPULSORY/.test(heading)?10:0)}}).sort((a,b)=>b.score-a.score||a.index-b.index)[0];
      const official=selected.retireesKind?parseOfficialRetirees(selected.matrix,file.name):parseOfficialClaims(selected.matrix,file.name);
      const readValue=(r:Record<string,unknown>,keys:string[])=>{const key=Object.keys(r).find(k=>keys.some(x=>k.toLowerCase().includes(x)));return key?String(r[key]||"").trim():""};
      const simple=XLSX.utils.sheet_to_json<Record<string,unknown>>(selected.sheet,{defval:"",raw:false,dateNF:"yyyy-mm-dd"});
      const source=(official?.length?official.map(item=>item.record):simple.map(row=>({name:readValue(row,["name"]),rank:readValue(row,["rank"]),unit:readValue(row,["unit","province","ppo"]),type:readValue(row,["type","claim"])||"Retiree",date:normalizeDate(readValue(row,["incident date","retirement date","date"]))}))).map(record=>"province" in record?{name:record.name,rank:record.rank,unit:record.province,type:record.type,date:record.date}:{name:record.name,rank:record.rank,unit:record.unit||"",type:"Retiree",date:record.retirementDate});
      if(!source.length)throw new Error("No personnel rows");
      const pool=[...claims.map(c=>({name:c.name,rank:c.rank,unit:c.province,type:c.type,date:c.date})),...retirees.map(r=>({name:r.name,rank:r.rank,unit:r.unit||"",type:"Retiree",date:r.retirementDate}))];
      const compared=source.map(row=>{const match=pool.find(record=>record.name.toLowerCase()===row.name.toLowerCase()&&(sameUnit(record.unit,row.unit)||!row.unit));if(!match)return {name:row.name||"Unnamed row",unit:row.unit,type:row.type,result:"Missing in System" as const,details:"No personnel match by name and unit"};const conflicts=[row.unit&&!sameUnit(match.unit,row.unit)?"unit":"",row.type&&match.type.toLowerCase()!==row.type.toLowerCase()?"type":"",row.date&&match.date!==row.date?"date":"",row.rank&&match.rank.toLowerCase()!==row.rank.toLowerCase()?"rank":""].filter(Boolean);return {name:row.name,unit:row.unit,type:row.type,result:conflicts.length?"Conflicting" as const:"Matched" as const,details:conflicts.length?`Different ${conflicts.join(", ")}`:"Official file agrees with the system"}});
      setRows(compared);setFileName(file.name);
      if(db&&auth?.currentUser){const ref=doc(collection(db,"reconciliationRuns"));const summary={fileName:file.name,total:compared.length,matched:compared.filter(r=>r.result==="Matched").length,missing:compared.filter(r=>r.result==="Missing in System").length,conflicting:compared.filter(r=>r.result==="Conflicting").length,runBy:auth.currentUser.uid,createdAt:serverTimestamp()};const batch=writeBatch(db);batch.set(ref,summary);batch.set(doc(collection(db,"activityHistory")),{action:"Official data reconciled",details:`${file.name} • ${summary.matched} matched • ${summary.missing+summary.conflicting} differences`,recordType:"reconciliation",recordId:ref.id,unit:"RCD",actorUid:auth.currentUser.uid,actorName:"Administrator",actorRole:"admin",newValue:summary,createdAt:serverTimestamp()});await batch.commit();}
      notify(`${compared.length} official rows reconciled.`);
    }catch{notify("Unable to reconcile this file. Use an official KIPO, WIPO, or Retirees Excel workbook.");}
  };
  const exportResults=async()=>{const XLSX=await import("xlsx");const ws=XLSX.utils.json_to_sheet(rows);const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,"Reconciliation");XLSX.writeFile(wb,`PRO4A-Reconciliation-${isoToday()}.xlsx`)};
  return <div className="stack"><section className="import-hero"><div><p>Administrator Tool</p><h3>Data Reconciliation</h3><span>Compare an official Excel file against live records without changing Firebase data.</span></div><ClipboardCheck/></section><section className="panel import-panel"><label className="drop-zone"><Upload/><strong>{fileName||"Choose official Excel file"}</strong><span>Comparison only • no records will be added, updated, or deleted</span><input type="file" accept=".xlsx,.xls" onChange={e=>e.target.files?.[0]&&read(e.target.files[0])}/></label></section>{rows.length>0&&<section className="panel registry"><PanelHead title="Reconciliation Results" copy={`${rows.filter(r=>r.result==="Matched").length} matched • ${rows.filter(r=>r.result==="Missing in System").length} missing • ${rows.filter(r=>r.result==="Conflicting").length} conflicting`} action={<button className="outline" onClick={exportResults}><Download/>Export Excel</button>}/><div className="table-wrap"><table><thead><tr><th>Name</th><th>Unit</th><th>Type</th><th>Result</th><th>Details</th></tr></thead><tbody>{rows.map((r,i)=><tr key={`${r.name}-${i}`}><td><strong>{r.name}</strong></td><td>{r.unit||"—"}</td><td>{r.type||"—"}</td><td><span className={`reconcile-result ${r.result.toLowerCase().replaceAll(" ","-")}`}>{r.result}</span></td><td>{r.details}</td></tr>)}</tbody></table></div></section>}</div>
}

type Announcement={id:string;title:string;message:string;audience:string;author:string;createdAt?:{toDate?:()=>Date}};
function AnnouncementsPage({profile,role,notify}:{profile:UserProfile;role:Role;notify:(s:string)=>void}) {
  const [items,setItems]=useState<Announcement[]>([]);const [title,setTitle]=useState("");const [message,setMessage]=useState("");const [audience,setAudience]=useState("All Units");
  useEffect(()=>{
    if(!db)return;
    const sort=(rows:Announcement[])=>rows.sort((a,b)=>(b.createdAt?.toDate?.().getTime()||0)-(a.createdAt?.toDate?.().getTime()||0));
    if(role==="administrator")return onSnapshot(collection(db,"announcements"),s=>setItems(sort(s.docs.map(d=>({id:d.id,...d.data()} as Announcement)))),()=>notify("Unable to load announcements."));
    let allRows:Announcement[]=[];let unitRows:Announcement[]=[];
    const merge=()=>setItems(sort(Array.from(new Map([...allRows,...unitRows].map(item=>[item.id,item])).values())));
    const stopAll=onSnapshot(firestoreQuery(collection(db,"announcements"),where("audience","==","All Units")),s=>{allRows=s.docs.map(d=>({id:d.id,...d.data()} as Announcement));merge()},()=>notify("Unable to load regional announcements."));
    const stopUnit=onSnapshot(firestoreQuery(collection(db,"announcements"),where("audience","==",profile.unit)),s=>{unitRows=s.docs.map(d=>({id:d.id,...d.data()} as Announcement));merge()},()=>notify("Unable to load unit announcements."));
    return ()=>{stopAll();stopUnit()};
  },[notify,profile.unit,role]);
  const post=async()=>{if(!db||!auth?.currentUser||!title.trim()||!message.trim())return;try{const batch=writeBatch(db);const ref=doc(collection(db,"announcements"));const payload={title:title.trim(),message:message.trim(),audience,author:profile.displayName,authorUid:auth.currentUser.uid,createdAt:serverTimestamp()};batch.set(ref,payload);batch.set(doc(collection(db,"activityHistory")),{action:"Announcement posted",details:`${title.trim()} • ${audience}`,recordType:"announcement",recordId:ref.id,unit:profile.unit,actorUid:auth.currentUser.uid,actorName:profile.displayName,actorRole:profile.role,newValue:payload,createdAt:serverTimestamp()});await batch.commit();setTitle("");setMessage("");notify("Announcement posted.");}catch{notify("Announcement could not be posted.");}};
  return <div className="stack">{role==="administrator"&&<section className="panel announcement-compose"><PanelHead title="Post Announcement" copy="Publish deadlines, meeting instructions, and system advisories"/><div className="form-grid"><label>Title<input value={title} onChange={e=>setTitle(e.target.value)} placeholder="Short announcement title"/></label><label>Audience<select value={audience} onChange={e=>setAudience(e.target.value)}><option>All Units</option>{operationalUnits.filter(u=>u!=="RCD").map(u=><option key={u}>{u}</option>)}</select></label><label className="wide">Message<textarea value={message} onChange={e=>setMessage(e.target.value)} placeholder="Write the official instruction, deadline, or advisory"/></label></div><button className="primary" onClick={post}><Send/>Post Announcement</button></section>}<section className="announcement-list">{items.map(item=><article className="panel" key={item.id}><i><Bell/></i><div><span>{item.audience}</span><h3>{item.title}</h3><p>{item.message}</p><small>{item.author} • {item.createdAt?.toDate?.().toLocaleString("en-PH")||"Publishing…"}</small></div></article>)}{!items.length&&<div className="panel empty">No announcements for {profile.unit}.</div>}</section></div>
}

type ArchivedRecord={id:string;sourceCollection:"claims"|"retirees";sourceId:string;data:Claim|Retiree;reason:string;archivedBy:string;archivedAt?:{toDate?:()=>Date}};
function ArchivePage({profile,notify,recordError,onRestore}:{profile:UserProfile;notify:(s:string)=>void;recordError:(context:string,error:unknown)=>Promise<void>;onRestore:(item:ArchivedRecord)=>void}) {
  const [items,setItems]=useState<ArchivedRecord[]>([]);
  useEffect(()=>{
    if(!db)return;
    return onSnapshot(collection(db,"archivedRecords"),snapshot=>setItems(snapshot.docs.map(item=>({id:item.id,...item.data()} as ArchivedRecord)).sort((a,b)=>(b.archivedAt?.toDate?.().getTime()||0)-(a.archivedAt?.toDate?.().getTime()||0))),error=>{void recordError("Archive retrieval failed",error);notify("Unable to load archived records.")});
  },[notify,recordError]);
  const restore=async(item:ArchivedRecord)=>{
    if(!db||!auth?.currentUser)return;
    if(!confirm(`Restore ${item.sourceId} to active records?`))return;
    try{
      const batch=writeBatch(db);
      const sanitizedData = sanitizeRecord(item.data as Record<string, unknown>);
      batch.set(doc(db,item.sourceCollection,item.sourceId),sanitizedData);
      batch.delete(doc(db,"archivedRecords",item.id));
      batch.set(doc(collection(db,"activityHistory")),{
        action:"Archived record restored",
        details:`${item.sourceId} restored to ${item.sourceCollection}`,
        recordType:item.sourceCollection==="claims"?"claim":"retiree",
        recordId:item.sourceId,
        unit:("province" in item.data ? item.data.province : item.data.unit) || profile.unit || "RHQ",
        actorUid:auth.currentUser.uid,
        actorName:profile.displayName,
        actorRole:profile.role,
        oldValue:{archived:true,reason:item.reason},
        newValue:sanitizedData,
        createdAt:serverTimestamp()
      });
      await batch.commit();
      onRestore(item);
      notify("Record restored to active monitoring.");
    }catch(error){
      console.error("Restore error:", error);
      void recordError("Archive restoration failed",error);
      notify("Restore failed. Check network or security permissions.");
    }
  };
  const erase=async(item:ArchivedRecord)=>{if(!db||!auth?.currentUser)return;const reason=prompt("Permanent deletion reason:")?.trim();if(!reason)return;const confirmation=prompt(`Type DELETE ${item.sourceId} to permanently remove this archived record.`);if(confirmation!==`DELETE ${item.sourceId}`){notify("Permanent deletion cancelled.");return;}try{const batch=writeBatch(db);batch.delete(doc(db,"archivedRecords",item.id));batch.set(doc(collection(db,"activityHistory")),{action:"Archived record permanently deleted",details:`${item.sourceId} • ${reason}`,recordType:item.sourceCollection==="claims"?"claim":"retiree",recordId:item.sourceId,unit:"RCD",actorUid:auth.currentUser.uid,actorName:profile.displayName,actorRole:profile.role,oldValue:item,newValue:null,createdAt:serverTimestamp()});await batch.commit();notify("Archived record permanently deleted.");}catch(error){void recordError("Permanent archive deletion failed",error);notify("Permanent deletion failed.");}};
  return <div className="stack"><section className="report-head"><div><p>Administrator Recovery</p><h3>Archive and Recovery</h3><span>Archived records do not appear in active dashboards or reports and remain recoverable here.</span></div><Archive/></section><section className="panel registry"><PanelHead title="Archived Records" copy={`${items.length} recoverable records`}/><div className="table-wrap"><table><thead><tr><th>Record</th><th>Personnel</th><th>Reason</th><th>Archived</th><th>Actions</th></tr></thead><tbody>{items.map(item=><tr key={item.id}><td><strong>{item.sourceId}</strong><small>{item.sourceCollection}</small></td><td>{"rank" in item.data?`${item.data.rank} ${item.data.name}`:"—"}</td><td>{item.reason}</td><td>{item.archivedAt?.toDate?.().toLocaleString("en-PH")||"Syncing…"}<small>{item.archivedBy}</small></td><td><div className="actions"><button className="edit" onClick={()=>restore(item)}><RefreshCw/> Restore</button><button className="delete" onClick={()=>erase(item)}><Trash2/> Permanent Delete</button></div></td></tr>)}</tbody></table>{!items.length&&<div className="empty">No archived records.</div>}</div></section></div>;
}

type SystemError={id:string;context:string;message:string;unit:string;actorName:string;resolved:boolean;createdAt?:{toDate?:()=>Date}};
function ErrorCenter({notify,lastSyncAt}:{notify:(s:string)=>void;lastSyncAt:Date|null}) {
  const [items,setItems]=useState<SystemError[]>([]);
  useEffect(()=>{if(!db)return onSnapshot(collection(db,"systemErrors"),snapshot=>setItems(snapshot.docs.map(item=>({id:item.id,...item.data()} as SystemError)).sort((a,b)=>(b.createdAt?.toDate?.().getTime()||0)-(a.createdAt?.toDate?.().getTime()||0))),()=>notify("Unable to load system errors."))},[notify]);
  const resolve=async(item:SystemError)=>{if(!db||!auth?.currentUser)return;try{const batch=writeBatch(db);batch.set(doc(db,"systemErrors",item.id),{resolved:true,resolvedAt:serverTimestamp(),resolvedBy:auth.currentUser.uid},{merge:true});batch.set(doc(collection(db,"activityHistory")),{action:"System error resolved",details:`${item.context} • ${item.message}`,recordType:"system-error",recordId:item.id,unit:"RCD",actorUid:auth.currentUser.uid,actorName:"Administrator",actorRole:"admin",oldValue:item,newValue:{...item,resolved:true},createdAt:serverTimestamp()});await batch.commit();notify("Error marked resolved.");}catch{notify("Unable to resolve this error entry.");}};
  return <div className="stack"><section className="report-head"><div><p>Administrator Diagnostics</p><h3>Error and Failed-Operation Center</h3><span>Last successful live synchronization: {lastSyncAt?.toLocaleString("en-PH")||"Not available in this session"}</span></div><AlertTriangle/></section><section className="validation-cards"><article><span>Unresolved</span><strong>{items.filter(i=>!i.resolved).length}</strong></article><article><span>Resolved</span><strong>{items.filter(i=>i.resolved).length}</strong></article><article><span>Total Logged</span><strong>{items.length}</strong></article></section><section className="panel registry"><PanelHead title="Failed Operations" copy="Client-side database, permission, import, and synchronization errors"/><div className="table-wrap"><table><thead><tr><th>Date/Time</th><th>Context</th><th>Error</th><th>Unit/User</th><th>Status</th></tr></thead><tbody>{items.map(item=><tr key={item.id}><td>{item.createdAt?.toDate?.().toLocaleString("en-PH")||"Syncing…"}</td><td><strong>{item.context}</strong></td><td>{item.message}</td><td>{item.unit}<small>{item.actorName}</small></td><td>{item.resolved?<span className="status completed">Resolved</span>:<button className="outline" onClick={()=>resolve(item)}>Mark Resolved</button>}</td></tr>)}</tbody></table>{!items.length&&<div className="empty">No failed operation has been recorded.</div>}</div></section></div>;
}

type ValidationSnapshot={certifications:number;reconciliationDifferences:number};
function ValidationPage({claims,retirees}:{claims:Claim[];retirees:Retiree[]}) {
  const [snapshot,setSnapshot]=useState<ValidationSnapshot>({certifications:0,reconciliationDifferences:0});
  useEffect(()=>{if(!db)return;let certificationCount=0;let reconciliationDifferences=0;const update=()=>setSnapshot({certifications:certificationCount,reconciliationDifferences});const stopCert=onSnapshot(collection(db,"certifications"),s=>{certificationCount=s.size;update()});const stopRecon=onSnapshot(collection(db,"reconciliationRuns"),s=>{const latest=s.docs.map(d=>d.data() as {missing?:number;conflicting?:number;createdAt?:{toDate?:()=>Date}}).sort((a,b)=>(b.createdAt?.toDate?.().getTime()||0)-(a.createdAt?.toDate?.().getTime()||0))[0];reconciliationDifferences=(latest?.missing||0)+(latest?.conflicting||0);update()});return()=>{stopCert();stopRecon()}},[]);
  const duplicates=claims.filter((claim,index)=>claims.findIndex(other=>personnelKey(other.rank,other.name,other.province,other.date)===personnelKey(claim.rank,claim.name,claim.province,claim.date))!==index).length;
  const missingRequirements=claims.filter(c=>Object.values(c.requirements||{}).filter(Boolean).length<claimRequirements.length).length;
  const overdue=claims.filter(c=>c.status!=="Completed"&&daysSince(c.lastUpdateDate||c.date)>=30).length;
  const unassigned=retirees.filter(r=>!r.unit||r.unit==="Unassigned").length;
  const report=[["Validation Month",new Date().toLocaleDateString("en-PH",{month:"long",year:"numeric"})],["KIPO/WIPO Records",claims.length],["Compulsory Retirees",retirees.length],["Possible Duplicates",duplicates],["Incomplete Requirements",missingRequirements],["Overdue Follow-ups",overdue],["Unassigned Records",unassigned],["Certifications on File",snapshot.certifications],["Latest Reconciliation Differences",snapshot.reconciliationDifferences]];
  const download=async()=>{const XLSX=await import("xlsx");const sheet=XLSX.utils.aoa_to_sheet([["PRO 4A MONTHLY SYSTEM VALIDATION REPORT"],[],["Check","Result"],...report]);const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,sheet,"Validation");XLSX.writeFile(book,`PRO4A-Monthly-Validation-${isoToday()}.xlsx`)};
  return <div className="stack"><section className="report-head"><div><p>Administrator Control</p><h3>Monthly System Validation Report</h3><span>One-page quality check of the current active monitoring data.</span></div><Gauge/></section><section className="panel registry"><PanelHead title={new Date().toLocaleDateString("en-PH",{month:"long",year:"numeric"})} copy="Live validation results; archived records are excluded." action={<button className="primary" onClick={download}><Download/>Download Excel</button>}/><div className="validation-report">{report.map(([label,value])=><article key={String(label)}><span>{label}</span><strong>{value}</strong></article>)}</div></section></div>;
}

const dictionary=[
  ["KIPO","Killed in Police Operations"],["WIPO","Wounded in Police Operations"],["CAL","Commutation of Accumulated Leave"],["Processed","CAL claim has completed the required processing"],["Not Processed","CAL claim is recorded but processing is not yet complete"],["Pending","Record requires an action, requirement, or follow-up"],["In Process","Record is actively being processed"],["For Review","Record is awaiting review or validation"],["Completed","All monitored workflow steps are complete"],["Completion Rate","Completed KIPO/WIPO records divided by total visible claims"],["Compliance Score","45% documentary completeness + 35% timely updates + 20% current certification, less overdue deductions"],["Data Certification","Formal focal-person confirmation that visible unit records are accurate and updated"],["Reconciliation","Read-only comparison of an official Excel file against live system records"]
];
function HelpPage(){const [query,setQuery]=useState("");const visible=dictionary.filter(([term,meaning])=>`${term} ${meaning}`.toLowerCase().includes(query.toLowerCase()));return <div className="stack"><section className="report-head"><div><p>System Guide</p><h3>Help and Data Dictionary</h3><span>Definitions, computations, and safe-use guidance for focal persons and administrators.</span></div><BookOpen/></section><section className="panel help-guide"><div className="search"><Search/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search a term, status, or computation"/></div><div className="dictionary">{visible.map(([term,meaning])=><article key={term}><strong>{term}</strong><p>{meaning}</p></article>)}</div></section><section className="help-cards"><article className="panel"><ShieldCheck/><h3>Unit Access</h3><p>Unit focal persons see and update only records assigned to their unit. Administrators have regional access.</p></article><article className="panel"><AlertTriangle/><h3>Duplicate Warning</h3><p>The system checks name, rank, unit, record type, and incident date before saving or importing.</p></article><article className="panel"><FileSpreadsheet/><h3>Official Excel</h3><p>Imports are validated before writing. Reconciliation compares files without changing records. Exports use Excel format.</p></article></section></div>}

function ProfilePage({profile,role,notify}:{profile:UserProfile;role:Role;notify:(s:string)=>void}) { return <section className="panel profile"><PanelHead title="My Profile" copy="Account identity and access assignment"/><div className="profile-hero"><div className="avatar large">{role==="administrator"?"SA":"UU"}</div><div><h3>{profile.displayName}</h3><p>{profile.unit} • {role==="administrator"?"Administrator":"Unit User"}</p></div></div><div className="form-grid"><label>Full Name<input value={profile.displayName} readOnly/></label><label>Email Address<input value={profile.email} readOnly/></label><label>Assigned Unit<input value={profile.unit} readOnly/></label><label>Role<input value={role==="administrator"?"Administrator":"Unit User"} readOnly/></label></div><button className="primary" onClick={()=>notify("Profile information is managed by the administrator.")}>Request Profile Update</button></section> }
function PanelHead({title,copy,action}:{title:string;copy:string;action?:React.ReactNode}) { return <div className="panel-head"><div><h3>{title}</h3><p>{copy}</p></div>{action}</div> }
function Select({label="Filter",value,change,options}:{label?:string;value:string;change:(v:string)=>void;options:string[]}) { return <label className="select"><span className="sr-only">{label}</span><select aria-label={label} value={value} onChange={e=>change(e.target.value)}>{options.map(x=><option key={x} value={x}>{x==="All"?"All":x}</option>)}</select><ChevronDown/></label> }
