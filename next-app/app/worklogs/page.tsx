'use client';
import { useState, useEffect, useRef } from 'react';
import { Eye, Code2, Clipboard, Sparkles, Plus, Check, Rocket, Loader2 } from 'lucide-react';
import { useSession } from '@/lib/store';
import { useNotify } from '@/components/notify';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

/* ---------- helpers ---------- */
function parseHours(v) {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    if (v.includes(':')) { const [h, m] = v.split(':').map(Number); return +(h + (m||0)/60).toFixed(2); }
    return parseFloat(v) || 0;
  }
  return 0;
}
const MONS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
function fmtDate(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return 'Unknown date';
  const [y,m,d] = iso.slice(0,10).split('-').map(Number);
  const dt = new Date(y, m-1, d);
  return DAYS[dt.getDay()] + ', ' + d + ' ' + MONS[m-1] + ' ' + y;
}
function todayISO() {
  const d = new Date(), p = n => String(n).padStart(2,'0');
  return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate());
}
function isTodayFile(w, today) {
  if (w.date && w.date.slice(0,10) === today) return true;
  const [y,m,d] = today.split('-').map(Number);
  const name = (w.rel||'').split('/').pop().replace(/\.json$/i,'');
  return name === d+'-'+m+'-'+y;
}

const PROMPT = [
  'Turn the work I describe below into a work-log JSON for my ActiveCollab Work-log Pusher.',
  '',
  'Output ONLY a valid JSON array — one object per task — in EXACTLY this shape:',
  '[',
  '  {',
  '    "name": "Short task title",',
  '    "date": "YYYY-MM-DD",',
  '    "hours": "HH:MM",',
  '    "body": "Short one-line label for the task",',
  '    "summary": "- bullet of what was done\\n- another bullet"',
  '  }',
  ']',
  '',
  'My work and hours:',
  '(describe your tasks, the date, and how many hours each took)',
].join('\n');

// Selectable task lists (shown as "Project" in the UI)
const PROJECTS = [
  { id: '32329', label: 'MIPL' },
  { id: '32330', label: 'Monarch Website' },
];

/* ---------- main app ---------- */
export default function Page() {
  // shared session store
  const base       = useSession(s => s.base);
  const projectId  = useSession(s => s.projectId);
  const taskListId = useSession(s => s.taskListId);
  const userId     = useSession(s => s.userId);
  const cookie     = useSession(s => s.cookie);
  const csrf       = useSession(s => s.csrf);
  const setField   = useSession(s => s.setField);

  // hydration guard — store is persisted to localStorage, so connected must
  // not be evaluated until after the client has mounted.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  const connected = mounted && !!(cookie && csrf);

  // worklogs
  const [worklogs, setWorklogs]   = useState([]);
  const [selectedRel, setSelectedRel] = useState('');
  const [jsonText, setJsonText]   = useState('');
  const [tasks, setTasks]         = useState([]);
  const [showReview, setShowReview] = useState(false);
  // (pushed flag now lives in the JSON file itself — no separate state needed)

  // push
  const [status, setStatus]       = useState({});
  const [pushing, setPushing]     = useState(false);
  const [progress, setProgress]   = useState(0);
  const cancelRef                 = useRef(false);

  // autosave
  const [saveState, setSaveState] = useState<'idle'|'saving'|'saved'|'error'>('idle');
  const saveTimerRef              = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimerRef             = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipNextSaveRef           = useRef(false);

  // ui — shared toast + confirm (see components/notify)
  const { toast, confirm, ui: notifyUi } = useNotify();

  /* body scrolling is owned by the dashboard shell (.dash-main) — no body class needed */

  /* -- load worklogs from server -- */
  const lastKeyRef = useRef('');
  const autoSelectedRef = useRef(false);

  async function fetchWorklogs(force=false) {
    try {
      const r = await fetch('/api/worklogs');
      const data = await r.json();
      const key = (data.files||[]).map(f=>f.rel+':'+Math.round(f.mtime)).join('|');
      if (!force && key === lastKeyRef.current) return;
      lastKeyRef.current = key;
      // normalize to the shape the UI expects
      const wls = (data.files||[]).map(f => ({
        rel: f.rel, date: f.date||null, valid: f.valid !== false,
        mtime: f.mtime, tasks: [], loaded: false,
        count: f.count||0, hours: f.hours||0, pushed: f.pushed||false,
      }));
      setWorklogs(wls);
      // auto-select today on first load only
      if (!autoSelectedRef.current) {
        autoSelectedRef.current = true;
        const today = todayISO();
        const match = wls.find(w => isTodayFile(w, today));
        if (match) pickFile(match);
      }
    } catch {}
  }

  useEffect(() => {
    fetchWorklogs(true);
    // SSE real-time updates
    try {
      const es = new EventSource('/api/events');
      es.addEventListener('worklogs', () => fetchWorklogs(true));
      es.addEventListener('reload',   () => location.reload());
      return () => es.close();
    } catch {}
  }, []);

  useEffect(() => {
    const id = setInterval(() => fetchWorklogs(false), 15000);
    const onFocus = () => fetchWorklogs(false);
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(id); window.removeEventListener('focus', onFocus); };
  }, []);

  /* -- pick / load a file -- */
  async function pickFile(w) {
    if (!w.valid) { toast('That file has invalid JSON','err'); return; }
    setSelectedRel(w.rel);
    try {
      const r = await fetch('/api/worklog?path='+encodeURIComponent(w.rel));
      const txt = await r.text();
      if (!r.ok) { toast('Load failed','err'); return; }
      setJsonText(txt);
      const json = JSON.parse(txt);
      skipNextSaveRef.current = true; // don't autosave just because we opened the file
      loadTasks(Array.isArray(json) ? json : (json.tasks||[]));
    } catch(e) { toast('Could not load file','err'); }
  }

  function loadTasks(arr) {
    setTasks(arr.map(t => ({
      name: t.name||t.title||'', date: t.date||t.record_date||'',
      hours: parseHours(t.hours??t.duration??t.time??0),
      summary: t.summary||'', body: t.body||t.description||'',
    })));
    setStatus({}); setProgress(0); setShowReview(true);
  }

  function previewJson() {
    let json; try { json = JSON.parse(jsonText); } catch(e) { toast('Invalid JSON: '+e.message,'err'); return; }
    const arr = Array.isArray(json) ? json : (json.tasks||[]);
    if (!arr.length) { toast('No tasks found','err'); return; }
    setSelectedRel(''); loadTasks(arr);
    toast(arr.length+' task'+(arr.length>1?'s':'')+' ready','ok');
  }

  function editCell(i,f,v) { setTasks(ts => ts.map((t,idx) => idx===i ? {...t,[f]: f==='hours'?parseHours(v):v} : t)); }
  function removeRow(i) {
    setTasks(ts => ts.filter((_,idx) => idx!==i));
    setStatus(s => { const n={}; Object.keys(s).forEach(k=>{const ki=+k; if(ki<i) n[ki]=s[ki]; else if(ki>i) n[ki-1]=s[ki];}); return n; });
  }
  function addRow() { setTasks(ts => [...ts, {name:'', date:tasks[0]?.date||todayISO(), hours:0, summary:'', body:''}]); }

  /* -- instant (debounced) autosave back to the JSON file on disk -- */
  useEffect(() => {
    // no file backing pasted JSON — skip silently
    if (!selectedRel) return;
    // skip the autosave triggered by freshly opening a file
    if (skipNextSaveRef.current) { skipNextSaveRef.current = false; return; }
    // never write while a push is running
    if (pushing) return;

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      setSaveState('saving');
      try {
        const r = await fetch('/api/worklog/save?path='+encodeURIComponent(selectedRel), {
          method: 'POST',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ tasks }),
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok || data.error) throw new Error(data.error || 'Save failed');
        setSaveState('saved');
        if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
        savedTimerRef.current = setTimeout(() => setSaveState('idle'), 1500);
      } catch (e: any) {
        setSaveState('error');
        toast('Auto-save failed: '+(e?.message||'error'), 'err');
      }
    }, 600);

    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, selectedRel]);

  // mark a file as pushed — writes pushed:true into the JSON on disk, updates local state
  async function markFileDone(rel) {
    if (!rel) return;
    try {
      await fetch('/api/worklog/mark-pushed?path='+encodeURIComponent(rel), {method:'POST'});
      // update local worklogs state so badge appears immediately without a reload
      setWorklogs(ws => ws.map(w => w.rel===rel ? {...w, pushed:true} : w));
    } catch {}
  }

  const totalHours = tasks.reduce((s,t) => s+(Number(t.hours)||0), 0);
  function fmtTotal(dec) {
    const total = Math.round(dec * 60);
    const h = Math.floor(total/60), m = total%60;
    return h+'h'+(m?' '+m+'m':'');
  }
  const allDone    = tasks.length>0 && tasks.every((_,i) => (status[i]||{}).complete==='ok');

  /* -- real push -- */
  async function runPush(indices) {
    if (!connected) { toast('Connect a session first','err'); return; }
    const items = indices.map(i => tasks[i]);
    const ok = await confirm({
      title: indices.length===1 ? 'Push this task?' : `Push ${indices.length} tasks?`,
      body: `For <b>each</b> task this creates it, logs its hours, then marks it complete in ActiveCollab.`,
      items, ok: 'Push to ActiveCollab',
    });
    if (!ok) return;

    setPushing(true); cancelRef.current = false;
    const isAll = indices.length === tasks.length;
    if (isAll) setProgress(0);
    setStatus(s => { const n={...s}; indices.forEach(i => n[i]={create:'',time:'',complete:''}); return n; });
    const setStep = (i,step,val) => setStatus(s => ({...s,[i]:{...s[i],[step]:val}}));

    const cfg = {
      base, projectId, taskListId,
      cookie, csrf,
      userId,
      tasks: items,
    };

    try {
      const res = await fetch('/api/push', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(cfg)});
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '', done2 = 0;
      while (true) {
        const {value, done} = await reader.read();
        if (done) break;
        buf += dec.decode(value, {stream:true});
        let nl;
        while ((nl=buf.indexOf('\n')) !== -1) {
          const line = buf.slice(0,nl).trim(); buf = buf.slice(nl+1);
          if (!line) continue;
          const ev = JSON.parse(line);
          if (ev.done) { if(ev.error) toast(ev.error,'err'); continue; }
          if (cancelRef.current) break;
          // map sent-index → real table index
          const ri = indices[ev.idx];
          if (ev.step === 'fatal') { setStep(ri,'create','err'); continue; }
          if (ev.status === 'start') setStep(ri,ev.step,'run');
          else if (ev.status === 'ok') {
            setStep(ri,ev.step,'ok');
            if (ev.step==='complete') { done2++; if(isAll) setProgress(Math.round((done2/indices.length)*100)); }
          }
          else if (ev.status === 'error') setStep(ri,ev.step,'err');
        }
      }
      if (!cancelRef.current) {
        toast(indices.length===1?'Task pushed ✓':`${indices.length} tasks pushed ✓`,'ok');
        // if we just pushed ALL tasks for the selected file, mark it done
        if (isAll && selectedRel) markFileDone(selectedRel);
      }
    } catch(e) {
      toast('Push failed: '+e.message,'err');
    } finally {
      setPushing(false);
    }
  }

  function cancelPush() { cancelRef.current=true; setPushing(false); toast('Push stopped','info'); }

  const overall = i => {
    const s = status[i];
    if (!s) return 'wait';
    if (s.create==='err'||s.time==='err'||s.complete==='err') return 'err';
    if (s.complete==='ok') return 'ok';
    if (s.create||s.time||s.complete) return 'run';
    return 'wait';
  };
  const pmeta = {
    ok:   {l:'done',    i:'checkmark-circle'},
    err:  {l:'error',   i:'close-circle'},
    run:  {l:'working', i:'sync-outline'},
    wait: {l:'waiting', i:'ellipse-outline'},
  };

  // group worklogs by month/week
  const groups: Record<string, any[]> = {};
  worklogs.forEach((w: any) => {
    const p = w.rel.split('/');
    const g = p.length>=2 ? (p[0][0].toUpperCase()+p[0].slice(1))+' · '+p[1].replace(/^week-?/i,'Week ') : 'Files';
    (groups[g]=groups[g]||[]).push(w);
  });

  return (
    <div className="sp-wrap">
      <p className="sp-lede">Turn the work-log JSON into ActiveCollab entries in one go. For each task it <b>creates the task</b>, <b>logs the hours</b>, then <b>marks it complete</b>.</p>

      <div className="sp-flow">
        <ion-icon name="link-outline"></ion-icon>
        <span>Connect <b>session</b></span>
        <ion-icon name="chevron-forward-outline" className="ar"></ion-icon>
        <span>Pick / paste <b>JSON</b></span>
        <ion-icon name="chevron-forward-outline" className="ar"></ion-icon>
        <span>Review</span>
        <ion-icon name="chevron-forward-outline" className="ar"></ion-icon>
        <span><b>Push</b></span>
      </div>

      {/* compact settings row — reads/writes the shared session store */}
      <div className="field-grid" style={{marginBottom:16}}>
        <div>
          <label className="fld">Project</label>
          <Select value={PROJECTS.some(p=>p.id===taskListId) ? taskListId : undefined}
            onValueChange={(v)=>{ if(v) setField('taskListId', v); }}>
            <SelectTrigger className="font-mono"><SelectValue placeholder={`Custom (#${taskListId||'—'})`} /></SelectTrigger>
            <SelectContent>
              {PROJECTS.map(p => <SelectItem key={p.id} value={p.id}>{p.label} — #{p.id}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div><label className="fld">Task list ID</label><input className="inp mono-inp" value={taskListId} onChange={e=>setField('taskListId', e.target.value)} /></div>
        <div><label className="fld">Base URL</label><input className="inp mono-inp" value={base} onChange={e=>setField('base', e.target.value)} /></div>
        <div><label className="fld">Your user ID</label><input className="inp mono-inp" value={userId} onChange={e=>setField('userId', e.target.value)} /></div>
        <div><label className="fld">Project ID</label><input className="inp mono-inp" value={projectId} onChange={e=>setField('projectId', e.target.value)} /></div>
      </div>

      {/* steps */}
      <div className="sp-grid">

        {/* STEP 1 — Choose work-log */}
        <section className="card card-pad">
          <div className="sp-cardhead"><span className="sp-no">1</span><h2>Choose the work-log</h2></div>
          <p className="sp-sub">Pick a saved file, or paste an array of <code>{'{ name, date, hours }'}</code>.</p>

          <div className="sp-files">
            {Object.keys(groups).length === 0 && (
              <div style={{padding:'28px 16px',textAlign:'center',color:'var(--text3)',fontSize:12.5}}>
                <ion-icon name="folder-open-outline" style={{fontSize:28,display:'block',margin:'0 auto 8px',color:'var(--border-strong)'}}></ion-icon>
                No work-logs yet. Run <code style={{fontFamily:'var(--mono)',color:'var(--primary-dark)',background:'var(--primary-light)',padding:'1px 5px',borderRadius:5}}>/update-stats</code> to create one.
              </div>
            )}
            {Object.entries(groups).map(([g, items]) => (
              <div key={g}>
                <div className="sp-fgroup">{g}</div>
                {items.map(w => {
                  const mon = w.date ? MONS[+w.date.slice(5,7)-1] : '—';
                  const day = w.date ? +w.date.slice(8,10) : '?';
                  return (
                    <div key={w.rel} className={'sp-file'+(w.rel===selectedRel?' sel':'')} onClick={()=>pickFile(w)}>
                      <div className="sp-cal">
                        <span className="mon">{mon}</span>
                        <span className="day tnum">{day}</span>
                      </div>
                      <div style={{flex:1,minWidth:0}}>
                        <div className="sp-fdate">{w.valid ? fmtDate(w.date) : 'Invalid file'}</div>
                        <div className="sp-fmeta">
                          {w.valid
                            ? <><b className="tnum">{w.count}</b> task{w.count===1?'':'s'} · <b className="tnum">{(w.hours||0).toFixed(2)}h</b></>
                            : <span style={{color:'var(--error)'}}>could not parse</span>}
                          {' '}<span className="sp-fname">{w.rel.split('/').pop()}</span>
                        </div>
                      </div>
                      {w.pushed
                        ? <span className="pill ok" style={{fontSize:11,padding:'3px 9px',flexShrink:0}}>
                            <ion-icon name="checkmark-circle"></ion-icon>pushed
                          </span>
                        : <Button
                            variant="outline" size="sm" className="shrink-0"
                            title="Mark as pushed"
                            onClick={async e=>{
                              e.stopPropagation();
                              const ok = await confirm({
                                title: 'Mark as pushed?',
                                body: `This will mark <b>${w.rel.split('/').pop()}</b> as pushed in the file. You can\'t undo this automatically.`,
                                ok: 'Yes, mark done',
                              });
                              if (!ok) return;
                              await markFileDone(w.rel);
                              toast('Marked as pushed ✓','ok');
                            }}
                          >
                            <Check className="h-3.5 w-3.5" />Mark done
                          </Button>}
                      <ion-icon name="chevron-forward-outline" className="sp-go"></ion-icon>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          <label className="fld" style={{marginTop:4}}>Or paste work-log JSON
            <Button variant="link" size="sm" style={{float:'right',marginTop:-2}}
              onClick={()=>{setJsonText(JSON.stringify([{name:'Custom CRM Page — Setup, Hero & Overview',date:todayISO(),hours:'03:30',body:'Setup, Hero & Overview',summary:'- Scaffolded the page route\n- Built the Hero and Overview sections from Figma'}],null,2)); toast('Sample loaded','ok');}}>
              <Sparkles className="h-3.5 w-3.5" />Sample
            </Button>
          </label>
          <textarea rows={6} value={jsonText} spellCheck={false}
            onChange={e=>setJsonText(e.target.value)}
            placeholder={'[\n  { "name": "Task", "date": "'+todayISO()+'", "hours": "03:30" }\n]'} />
          <div style={{display:'flex',gap:9,flexWrap:'wrap',marginTop:12}}>
            <Button onClick={previewJson}>
              <Eye className="h-4 w-4" />Preview tasks
            </Button>
            <Button variant="outline" onClick={()=>{
              try { setJsonText(JSON.stringify(JSON.parse(jsonText),null,2)); toast('Formatted','ok'); }
              catch { toast('Invalid JSON','err'); }
            }}>
              <Code2 className="h-4 w-4" />Format
            </Button>
            <Button variant="outline" onClick={()=>{
              navigator.clipboard && navigator.clipboard.writeText(PROMPT).then(()=>toast('Claude prompt copied','ok'));
            }}>
              <Clipboard className="h-4 w-4" />Copy prompt
            </Button>
          </div>
        </section>
      </div>

      {/* STEP 2 — Review & push */}
      {showReview && tasks.length ? (
        <section className="card card-pad sp-review" id="review">
          <div className="sp-reviewhead">
            <div className="sp-cardhead" style={{margin:0}}><span className="sp-no">2</span><h2>Review &amp; push</h2></div>
            <div style={{marginLeft:'auto',display:'flex',alignItems:'center',gap:12,flexWrap:'wrap'}}>
              {selectedRel && saveState !== 'idle' ? (
                <span style={{display:'inline-flex',alignItems:'center',gap:5,fontSize:12,fontWeight:700,
                  color: saveState==='error' ? 'var(--error)' : saveState==='saved' ? 'var(--ok,#16a34a)' : 'var(--text3)'}}>
                  {saveState==='saving'   ? <><ion-icon name="sync-outline" className="spin"></ion-icon>Saving…</> : null}
                  {saveState==='saved'    ? <>Saved ✓</> : null}
                  {saveState==='error'    ? <>Save failed</> : null}
                </span>
              ) : null}
              <span className="totchip"><b className="tnum">{tasks.length}</b> task{tasks.length===1?'':'s'}</span>
              <span className="totchip">
                <ion-icon name="time-outline" style={{color:'var(--primary-dark)'}}></ion-icon>
                <b className="tnum">{fmtTotal(totalHours)}</b>
                <span style={{color:'var(--text3)',fontWeight:600,fontSize:11.5}}>({totalHours.toFixed(2)}h)</span>
              </span>
              <Button variant="ghost" onClick={addRow} disabled={pushing}>
                <Plus className="h-4 w-4" />Add task
              </Button>
            </div>
          </div>
          <p className="sp-sub" style={{marginLeft:38}}>Name, date and hours are editable — fix anything before pushing.</p>

          <div className="tablewrap" style={{marginTop:6}}>
            <table className="tasks">
              <thead>
                <tr>
                  <th style={{width:44}}>#</th>
                  <th>Task</th>
                  <th className="col-date">Date</th>
                  <th className="col-hours">Hours</th>
                  <th className="col-status">Status</th>
                  <th className="col-act"></th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((t,i) => {
                  const ov = overall(i), s = status[i]||{};
                  return (
                    <tr key={i} className={ov==='run'?'pushing':ov==='ok'?'done-row':''}>
                      <td className="idx tnum">{String(i+1).padStart(2,'0')}</td>
                      <td style={{maxWidth:340}}>
                        <input className="cell-inp name" value={t.name} placeholder="Task name"
                          onChange={e=>editCell(i,'name',e.target.value)} />
                        <input className="cell-inp bodyhint" value={t.body} placeholder="Short label"
                          onChange={e=>editCell(i,'body',e.target.value)} />
                        <textarea className="cell-inp sumhint" rows={2} value={t.summary} placeholder="- bullet…"
                          spellCheck={false}
                          style={{resize:'vertical',width:'100%',display:'block'}}
                          onChange={e=>editCell(i,'summary',e.target.value)} />
                      </td>
                      <td className="col-date">
                        <input className="cell-inp mono" value={t.date} placeholder="YYYY-MM-DD"
                          onChange={e=>editCell(i,'date',e.target.value)} />
                      </td>
                      <td className="col-hours">
                        <input className="cell-inp mono tnum" value={t.hours}
                          onChange={e=>editCell(i,'hours',e.target.value)} />
                      </td>
                      <td className="col-status">
                        <span className={'pill '+ov}>
                          <ion-icon name={pmeta[ov].i} className={ov==='run'?'spin':''}></ion-icon>
                          {pmeta[ov].l}
                        </span>
                        <div className="steps3">
                          <span className={'step-dot '+(s.create||'')}></span>
                          <span className={'step-dot '+(s.time||'')}></span>
                          <span className={'step-dot '+(s.complete||'')}></span>
                        </div>
                        <div className="steps-lbl">
                          <span>create <b className={s.create}>{s.create==='ok'?'✓':s.create==='run'?'…':'·'}</b></span>
                          <span>time <b className={s.time}>{s.time==='ok'?'✓':s.time==='run'?'…':'·'}</b></span>
                          <span>done <b className={s.complete}>{s.complete==='ok'?'✓':s.complete==='run'?'…':'·'}</b></span>
                        </div>
                      </td>
                      <td className="col-act">
                        <div className="rowacts">
                          <Button variant="outline" size="icon" className="h-8 w-8" title="Push this task"
                            disabled={pushing||ov==='ok'} onClick={()=>runPush([i])}>
                            <Rocket className="h-4 w-4" />
                          </Button>
                          <Button variant="outline" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" title="Remove" disabled={pushing}
                            onClick={()=>removeRow(i)}>
                            <ion-icon name="trash-outline"></ion-icon>
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="sp-pushbar">
            {!connected
              ? <span className="pill err"><ion-icon name="alert-circle"></ion-icon>No active session</span>
              : allDone
              ? <span className="pill ok"><ion-icon name="checkmark-circle"></ion-icon>All tasks pushed</span>
              : <span className="totchip">
                  <ion-icon name="information-circle-outline" style={{color:'var(--primary-dark)'}}></ion-icon>
                  Ready to push <b className="tnum">{tasks.length}</b> tasks
                </span>}
            <div style={{flex:1}}>
              {pushing ? (
                <div className="pushprog"><i style={{width:progress+'%'}}></i></div>
              ) : null}
            </div>
            {pushing ? (
              <Button variant="outline" onClick={cancelPush}>
                <ion-icon name="stop-circle-outline"></ion-icon>Stop
              </Button>
            ) : null}
            <Button size="lg" disabled={pushing||allDone}
              onClick={()=>runPush(tasks.map((_,i)=>i))}>
              {pushing
                ? <><Loader2 className="h-4 w-4 animate-spin" />Pushing… {progress}%</>
                : allDone
                ? <><Check className="h-4 w-4" />Done</>
                : <><Rocket className="h-4 w-4" />Push to ActiveCollab</>}
            </Button>
          </div>
        </section>
      ) : null}

      {notifyUi}
    </div>
  );
}
