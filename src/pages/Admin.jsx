import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'

const ADMIN_PASSWORD = import.meta.env.VITE_ADMIN_PASSWORD || 'office2026'

const STAGE_MAP = {
  GROUP_STAGE:'group', LAST_16:'r16', ROUND_OF_16:'r16',
  QUARTER_FINALS:'qf', SEMI_FINALS:'sf', FINAL:'final', '3RD_PLACE_MATCH':'final',
}
function apiStageToGW(stage, matchday) {
  if (stage==='GROUP_STAGE') return matchday||1
  return { LAST_16:4, ROUND_OF_16:4, QUARTER_FINALS:5, SEMI_FINALS:6, FINAL:7, '3RD_PLACE_MATCH':7 }[stage]??8
}
async function callAPI(endpoint) {
  const res = await fetch(`/football-api?endpoint=${encodeURIComponent(endpoint)}`)
  const json = await res.json()
  if (!res.ok) throw new Error(json.error||`HTTP ${res.status}`)
  return json
}
const delay = ms => new Promise(r => setTimeout(r, ms))

// ── Scoring engine (team points only) ─────────────────────────────────────────
async function calculateAllScores(settings) {
  const [
    { data: participants }, { data: ptRows },
    { data: matches }, { data: gwRows },
  ] = await Promise.all([
    supabase.from('participants').select('id'),
    supabase.from('participant_teams').select('participant_id, team_id, pool, teams(name)'),
    supabase.from('matches').select('*').eq('status','FINISHED'),
    supabase.from('gameweeks').select('id, week_number').order('week_number'),
  ])

  const gwByWeekNum = Object.fromEntries((gwRows||[]).map(g=>[g.week_number,g]))
  const teamPoolMult = { A:1.0, B:Number(settings.pool_b_team_mult)||1.5, C:Number(settings.pool_c_team_mult)||2.0 }
  const stageWinPts = { group:Number(settings.points_group_win)||2, r16:Number(settings.points_r16_win)||5, qf:Number(settings.points_qf_win)||8, sf:Number(settings.points_sf_win)||13, final:Number(settings.points_winner)||20 }
  const qualifyPts = Number(settings.points_qualify)||3
  const goalPts = Number(settings.points_goal ?? 1)   // flat — per goal the team scores
  const drawPts = Number(settings.points_draw ?? 1)   // flat — per drawn match
  const upserts = []

  for (const p of participants||[]) {
    const myTeams = (ptRows||[]).filter(r=>r.participant_id===p.id)
    // per gameweek, broken down by pool so the leaderboard can show A / B / C subtotals
    const gwPool = Object.fromEntries((gwRows||[]).map(g=>[g.id,{A:0,B:0,C:0}]))
    const qualifyGiven = new Set()

    for (const mt of myTeams) {
      const tname = mt.teams?.name; if (!tname) continue
      const pool = mt.pool, tmult = teamPoolMult[pool]??1.0
      for (const m of matches||[]) {
        const isHome=m.home_team===tname, isAway=m.away_team===tname
        if (!isHome&&!isAway) continue
        const gw = gwByWeekNum[m.gameweek]; if (!gw||!gwPool[gw.id]) continue
        const myScore=isHome?m.home_score:m.away_score, oppScore=isHome?m.away_score:m.home_score
        if (myScore==null||oppScore==null) continue
        let pts = 0
        if (myScore>oppScore) pts += (stageWinPts[m.stage]??0)*tmult   // win
        else if (myScore===oppScore) pts += drawPts*tmult              // draw
        pts += (Number(myScore)||0)*goalPts*tmult                      // goals scored, each
        if (['r16','qf','sf','final'].includes(m.stage)&&!qualifyGiven.has(mt.team_id)) {
          pts += qualifyPts*tmult; qualifyGiven.add(mt.team_id)        // qualify bonus
        }
        if (gwPool[gw.id][pool]!==undefined) gwPool[gw.id][pool] += pts
      }
    }

    for (const gw of gwRows||[]) {
      const a=+gwPool[gw.id].A.toFixed(2), b=+gwPool[gw.id].B.toFixed(2), c=+gwPool[gw.id].C.toFixed(2)
      const total=+(a+b+c).toFixed(2)
      upserts.push({ participant_id:p.id, gameweek_id:gw.id, pool_a_points:a, pool_b_points:b, pool_c_points:c, team_points:total, total_points:total, calculated_at:new Date().toISOString() })
    }
  }

  const { error } = await supabase.from('participant_scores').upsert(upserts, { onConflict:'participant_id,gameweek_id' })
  return { count:upserts.length, error }
}

// ── Styles ─────────────────────────────────────────────────────────────────────
const C = { dark:'#1a1a2e', green:'#16213e', gold:'#e8b84b', cream:'#f5f5f5', white:'#ffffff', muted:'#6b7280', border:'#e5e7eb', stripe:'#f9fafb', red:'#dc2626' }
const inp = { padding:'8px 12px', border:`1px solid ${C.border}`, borderRadius:6, fontFamily:"'Outfit', sans-serif", fontSize:14, outline:'none', background:C.white, color:'#111827' }
const btn = (v='primary') => ({ padding:'8px 16px', borderRadius:6, border:'none', cursor:'pointer', fontFamily:"'Barlow Condensed', sans-serif", fontWeight:700, fontSize:14, letterSpacing:'0.06em', textTransform:'uppercase', background:v==='primary'?C.green:v==='danger'?C.red:'#f1f5f9', color:v==='ghost'?C.muted:C.white })
const card = { background:C.white, borderRadius:12, boxShadow:'0 1px 3px rgba(0,0,0,0.08)', overflow:'hidden', marginBottom:20 }
const th = { padding:'10px 16px', textAlign:'left', background:'#f8fafc', color:C.muted, fontFamily:"'Barlow Condensed', sans-serif", fontWeight:600, fontSize:12, letterSpacing:'0.06em', textTransform:'uppercase', borderBottom:`2px solid ${C.border}` }
const td = { padding:'12px 16px', borderBottom:`1px solid ${C.border}`, verticalAlign:'middle', color:'#111827', fontFamily:"'Outfit', sans-serif", fontSize:14 }

function StatusMsg({ msg }) {
  if (!msg) return null
  const isErr=msg.startsWith('✗'),isOk=msg.startsWith('✓')
  return <div style={{ padding:'10px 14px', borderRadius:8, marginTop:10, fontFamily:"'Outfit', sans-serif", fontSize:13, background:isErr?'#fee2e2':isOk?'#d1fae5':'#fef3c7', color:isErr?'#991b1b':isOk?'#065f46':'#92400e' }}>{msg}</div>
}
function SH({ title, sub }) {
  return <div style={{ marginBottom:14 }}><div style={{ fontFamily:"'Barlow Condensed', sans-serif", fontWeight:700, fontSize:17, textTransform:'uppercase', letterSpacing:'0.06em', color:C.dark }}>{title}</div>{sub&&<div style={{ fontFamily:"'Outfit', sans-serif", fontSize:12, color:C.muted, marginTop:2 }}>{sub}</div>}</div>
}

// ── Participants ───────────────────────────────────────────────────────────────
function Participants() {
  const [list, setList] = useState([]); const [loading, setLoading] = useState(true)
  const [name, setName] = useState(''); const [paid, setPaid] = useState(true); const [saving, setSaving] = useState(false)
  const load = useCallback(async () => { const { data } = await supabase.from('participants').select('*').order('created_at'); setList(data||[]); setLoading(false) }, [])
  useEffect(()=>{ load() },[load])
  async function add() { if (!name.trim()) return; setSaving(true); await supabase.from('participants').insert({ name:name.trim(), paid }); setName(''); setPaid(true); await load(); setSaving(false) }
  async function togglePaid(id,cur) { await supabase.from('participants').update({ paid:!cur }).eq('id',id); setList(l=>l.map(p=>p.id===id?{...p,paid:!cur}:p)) }
  async function remove(id) { if (!confirm('Delete?')) return; await supabase.from('participants').delete().eq('id',id); setList(l=>l.filter(p=>p.id!==id)) }
  const paidCount = list.filter(p=>p.paid).length
  return (
    <div>
      <div style={{ display:'flex', gap:12, marginBottom:20, flexWrap:'wrap' }}>
        {[['Total',list.length],['Paid',paidCount],['Free',list.length-paidCount],['Pot',`R${paidCount*100}`]].map(([k,v])=>(
          <div key={k} style={{ background:C.white, borderRadius:10, padding:'14px 20px', boxShadow:'0 1px 3px rgba(0,0,0,0.07)', minWidth:90, textAlign:'center' }}>
            <div style={{ fontFamily:"'Barlow Condensed', sans-serif", fontSize:26, fontWeight:700 }}>{v}</div>
            <div style={{ fontFamily:"'Outfit', sans-serif", fontSize:12, color:C.muted, textTransform:'uppercase' }}>{k}</div>
          </div>
        ))}
      </div>
      <div style={{ ...card, padding:20 }}>
        <SH title="Add Participant" />
        <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
          <input value={name} onChange={e=>setName(e.target.value)} onKeyDown={e=>e.key==='Enter'&&add()} placeholder="Name" style={{ ...inp, flex:1, minWidth:160 }} />
          <label style={{ display:'flex', alignItems:'center', gap:6, fontFamily:"'Outfit', sans-serif", fontSize:14, cursor:'pointer' }}>
            <input type="checkbox" checked={paid} onChange={e=>setPaid(e.target.checked)} style={{ width:16, height:16 }} /> Paid (R100)
          </label>
          <button onClick={add} disabled={saving||!name.trim()} style={{ ...btn(), opacity:saving||!name.trim()?0.5:1 }}>Add</button>
        </div>
      </div>
      {loading ? <div style={{ padding:32, textAlign:'center', color:C.muted }}>Loading…</div> : (
        <div style={card}>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:14 }}>
            <thead><tr><th style={th}>Name</th><th style={th}>Status</th><th style={th}>Added</th><th style={{ ...th, textAlign:'right' }}>Actions</th></tr></thead>
            <tbody>
              {list.map((p,i)=>(
                <tr key={p.id} style={{ background:i%2?C.stripe:C.white }}>
                  <td style={{ ...td, fontWeight:600 }}>{p.name}</td>
                  <td style={td}><button onClick={()=>togglePaid(p.id,p.paid)} style={{ ...btn(p.paid?'primary':'ghost'), padding:'4px 12px', fontSize:12 }}>{p.paid?'Paid':'Free'}</button></td>
                  <td style={{ ...td, color:C.muted }}>{new Date(p.created_at).toLocaleDateString()}</td>
                  <td style={{ ...td, textAlign:'right' }}><button onClick={()=>remove(p.id)} style={{ ...btn('danger'), padding:'4px 12px', fontSize:12 }}>Delete</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Gameweeks ─────────────────────────────────────────────────────────────────
function Gameweeks() {
  const [list, setList] = useState([]); const [form, setForm] = useState({ week_number:'', starts_at:'', ends_at:'' }); const [saving, setSaving] = useState(false)
  const load = useCallback(async()=>{ const { data } = await supabase.from('gameweeks').select('*').order('week_number'); setList(data||[]) },[])
  useEffect(()=>{ load() },[load])
  async function create() { if (!form.week_number) return; setSaving(true); await supabase.from('gameweeks').insert({ week_number:Number(form.week_number), starts_at:form.starts_at||null, ends_at:form.ends_at||null }); setForm({ week_number:'', starts_at:'', ends_at:'' }); await load(); setSaving(false) }
  async function remove(id) { if (!confirm('Delete?')) return; await supabase.from('gameweeks').delete().eq('id',id); setList(l=>l.filter(g=>g.id!==id)) }
  const fmtDate = d => d?new Date(d).toLocaleDateString('en-ZA',{day:'numeric',month:'short'}):'—'
  return (
    <div>
      <div style={{ ...card, padding:20 }}>
        <SH title="Create Gameweek" />
        <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
          <input type="number" placeholder="Week #" value={form.week_number} onChange={e=>setForm(f=>({...f,week_number:e.target.value}))} style={{ ...inp, width:90 }} />
          <input type="date" value={form.starts_at} onChange={e=>setForm(f=>({...f,starts_at:e.target.value}))} style={inp} />
          <input type="date" value={form.ends_at} onChange={e=>setForm(f=>({...f,ends_at:e.target.value}))} style={inp} />
          <button onClick={create} disabled={saving||!form.week_number} style={{ ...btn(), opacity:saving||!form.week_number?0.5:1 }}>Create</button>
        </div>
      </div>
      <div style={card}>
        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:14 }}>
          <thead><tr><th style={th}>Week</th><th style={th}>Starts</th><th style={th}>Ends</th><th style={{ ...th, textAlign:'right' }}>Actions</th></tr></thead>
          <tbody>
            {list.length===0?<tr><td colSpan={4} style={{ ...td, textAlign:'center', color:C.muted }}>No gameweeks yet.</td></tr>
              :list.map((gw,i)=>(
                <tr key={gw.id} style={{ background:i%2?C.stripe:C.white }}>
                  <td style={{ ...td, fontWeight:700, fontFamily:"'Barlow Condensed', sans-serif", fontSize:18 }}>GW {gw.week_number}</td>
                  <td style={td}>{fmtDate(gw.starts_at)}</td><td style={td}>{fmtDate(gw.ends_at)}</td>
                  <td style={{ ...td, textAlign:'right' }}><button onClick={()=>remove(gw.id)} style={{ ...btn('danger'), padding:'4px 12px', fontSize:12 }}>Delete</button></td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Matches ────────────────────────────────────────────────────────────────────
function Matches() {
  const [list, setList] = useState([]); const [pullStatus, setPullStatus] = useState(''); const [pulling, setPulling] = useState(false); const [pullMode, setPullMode] = useState('')
  const [editId, setEditId] = useState(null); const [editScores, setEditScores] = useState({ home_score:'', away_score:'' })
  const [stageFilter, setStageFilter] = useState('all'); const [gwFilter, setGwFilter] = useState('all')
  const load = useCallback(async()=>{ const { data } = await supabase.from('matches').select('*').order('gameweek').order('kickoff'); setList(data||[]) },[])
  useEffect(()=>{ load() },[load])

  function buildRows(matches) {
    return (matches||[]).map(m=>({ id:m.id, gameweek:apiStageToGW(m.stage,m.matchday), stage:STAGE_MAP[m.stage]||m.stage?.toLowerCase()||'group', home_team:m.homeTeam?.name||'—', away_team:m.awayTeam?.name||'—', home_score:m.score?.fullTime?.home??null, away_score:m.score?.fullTime?.away??null, status:m.status||'SCHEDULED', kickoff:m.utcDate||null }))
  }

  async function quickSync() {
    setPulling(true); setPullMode('quick'); setPullStatus('Fetching fixtures and scores…')
    try {
      const data = await callAPI('competitions/WC/matches?season=2026')
      const rows = buildRows(data.matches)
      if (!rows.length) { setPullStatus('✗ No matches returned.'); setPulling(false); return }
      const { error } = await supabase.from('matches').upsert(rows,{onConflict:'id'})
      if (error) throw new Error(error.message)
      await load(); setPullStatus(`✓ ${rows.length} matches synced.`)
    } catch(e) { setPullStatus(`✗ ${e.message}`) }
    setPulling(false)
  }

  async function fullSync() {
    setPulling(true); setPullMode('full'); setPullStatus('Step 1/3 — Syncing fixtures…')
    try {
      const data = await callAPI('competitions/WC/matches?season=2026')
      const allMatches = data.matches||[]
      if (!allMatches.length) { setPullStatus('✗ No matches returned.'); setPulling(false); return }
      const { error:me } = await supabase.from('matches').upsert(buildRows(allMatches),{onConflict:'id'})
      if (me) throw new Error(me.message)

      // Step 2 — goalscorers (display only). Uses the free /scorers endpoint, which returns
      // cumulative tournament goals per player. Non-fatal: stays empty until games are played.
      setPullStatus('Step 2/3 — Updating goalscorers…')
      let scorerCount = 0
      try {
        const sc = await callAPI('competitions/WC/scorers?season=2026&limit=100')
        const scorers = (sc.scorers||[]).map(s=>({
          api_id: s.player?.id,
          name: s.player?.name||'—',
          team_name: s.team?.name||'—',
          goals: s.goals??0,
          updated_at: new Date().toISOString(),
        })).filter(s=>s.api_id)
        if (scorers.length) {
          const { error:se } = await supabase.from('goalscorers').upsert(scorers,{onConflict:'api_id'})
          if (!se) scorerCount = scorers.length
        }
      } catch(_) { /* scorers may be empty before kickoff — non-fatal */ }

      setPullStatus('Step 3/3 — Calculating scores…')
      const { data: settings } = await supabase.from('settings').select('*').eq('id',1).single()
      const result = await calculateAllScores(settings)
      if (result.error) throw new Error(result.error.message)
      await load()
      const finished = allMatches.filter(m=>m.status==='FINISHED').length
      setPullStatus(`✓ Done — ${allMatches.length} matches (${finished} finished), ${scorerCount} scorers, leaderboard updated.`)
    } catch(e) { setPullStatus(`✗ ${e.message}`) }
    setPulling(false)
  }

  async function saveScore(id) {
    const update = { home_score:Number(editScores.home_score), away_score:Number(editScores.away_score), status:'FINISHED' }
    await supabase.from('matches').update(update).eq('id',id)
    setList(l=>l.map(m=>m.id===id?{...m,...update}:m)); setEditId(null)
  }
  async function remove(id) { if (!confirm('Delete?')) return; await supabase.from('matches').delete().eq('id',id); setList(l=>l.filter(m=>m.id!==id)) }

  const stages=['all',...new Set(list.map(m=>m.stage))]
  const gws=['all',...new Set(list.map(m=>m.gameweek).filter(Boolean))].sort((a,b)=>a==='all'?-1:a-b)
  const visible=list.filter(m=>(stageFilter==='all'||m.stage===stageFilter)&&(gwFilter==='all'||m.gameweek==gwFilter))
  const stageLabel={group:'Group',r16:'R16',qf:'QF',sf:'SF',final:'Final'}
  const statusColor={FINISHED:{bg:'#d1fae5',text:'#065f46'},SCHEDULED:{bg:'#f1f5f9',text:'#374151'},IN_PLAY:{bg:'#fef3c7',text:'#92400e'}}

  return (
    <div>
      <div style={{ ...card, padding:20 }}>
        <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', flexWrap:'wrap', gap:12 }}>
          <div><SH title="Sync from API" /><div style={{ fontFamily:"'Outfit', sans-serif", fontSize:13, color:C.muted, marginTop:-8 }}><strong style={{ color:'#111827' }}>Quick Sync</strong> — fixtures only. <strong style={{ color:'#111827' }}>Full Sync</strong> — fixtures + recalculates leaderboard.</div></div>
          <div style={{ display:'flex', gap:8 }}>
            <button onClick={quickSync} disabled={pulling} style={{ ...btn('ghost'), border:`1px solid ${C.border}`, opacity:pulling?0.6:1 }}>{pulling&&pullMode==='quick'?'Syncing…':'↻ Quick Sync'}</button>
            <button onClick={fullSync} disabled={pulling} style={{ ...btn(), opacity:pulling?0.6:1 }}>{pulling&&pullMode==='full'?'Syncing…':'⚡ Full Sync'}</button>
          </div>
        </div>
        <StatusMsg msg={pullStatus} />
      </div>
      <div style={{ display:'flex', gap:8, marginBottom:12 }}>
        <select value={stageFilter} onChange={e=>setStageFilter(e.target.value)} style={{ ...inp, padding:'6px 10px' }}>{stages.map(s=><option key={s} value={s}>{s==='all'?'All stages':stageLabel[s]||s}</option>)}</select>
        <select value={gwFilter} onChange={e=>setGwFilter(e.target.value)} style={{ ...inp, padding:'6px 10px' }}>{gws.map(g=><option key={g} value={g}>{g==='all'?'All GWs':`GW ${g}`}</option>)}</select>
        <span style={{ fontFamily:"'Outfit', sans-serif", fontSize:13, color:C.muted, alignSelf:'center' }}>{visible.length} matches</span>
      </div>
      <div style={card}>
        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
          <thead><tr><th style={th}>GW</th><th style={th}>Stage</th><th style={th}>Home</th><th style={{ ...th, textAlign:'center' }}>Score</th><th style={th}>Away</th><th style={th}>Status</th><th style={{ ...th, textAlign:'right' }}>Actions</th></tr></thead>
          <tbody>
            {visible.length===0?<tr><td colSpan={7} style={{ ...td, textAlign:'center', color:C.muted }}>No matches yet.</td></tr>
              :visible.map((m,i)=>{ const sc=statusColor[m.status]||statusColor.SCHEDULED; const editing=editId===m.id; return (
                <tr key={m.id} style={{ background:i%2?C.stripe:C.white }}>
                  <td style={{ ...td, fontFamily:"'Barlow Condensed', sans-serif", fontWeight:700 }}>{m.gameweek??'—'}</td>
                  <td style={td}><span style={{ background:'#f1f5f9', color:C.muted, padding:'2px 8px', borderRadius:4, fontSize:12, fontWeight:600 }}>{stageLabel[m.stage]||m.stage}</span></td>
                  <td style={{ ...td, fontWeight:600 }}>{m.home_team}</td>
                  <td style={{ ...td, textAlign:'center', fontFamily:"'Barlow Condensed', sans-serif", fontWeight:700, fontSize:16 }}>
                    {editing?<span style={{ display:'flex', gap:4, justifyContent:'center' }}>
                      <input type="number" min="0" value={editScores.home_score} onChange={e=>setEditScores(s=>({...s,home_score:e.target.value}))} style={{ ...inp, width:48, padding:'4px 6px', textAlign:'center' }} />
                      <span style={{ alignSelf:'center' }}>–</span>
                      <input type="number" min="0" value={editScores.away_score} onChange={e=>setEditScores(s=>({...s,away_score:e.target.value}))} style={{ ...inp, width:48, padding:'4px 6px', textAlign:'center' }} />
                    </span>:(m.home_score!=null?`${m.home_score} – ${m.away_score}`:'– – –')}
                  </td>
                  <td style={{ ...td, fontWeight:600 }}>{m.away_team}</td>
                  <td style={td}><span style={{ ...sc, padding:'2px 8px', borderRadius:4, fontSize:12, fontWeight:600 }}>{m.status}</span></td>
                  <td style={{ ...td, textAlign:'right' }}>
                    {editing?<span style={{ display:'flex', gap:4, justifyContent:'flex-end' }}>
                      <button onClick={()=>saveScore(m.id)} style={{ ...btn(), padding:'4px 10px', fontSize:12 }}>Save</button>
                      <button onClick={()=>setEditId(null)} style={{ ...btn('ghost'), padding:'4px 10px', fontSize:12 }}>Cancel</button>
                    </span>:<span style={{ display:'flex', gap:4, justifyContent:'flex-end' }}>
                      <button onClick={()=>{ setEditId(m.id); setEditScores({ home_score:m.home_score??'', away_score:m.away_score??'' }) }} style={{ ...btn('ghost'), padding:'4px 10px', fontSize:12 }}>Edit</button>
                      <button onClick={()=>remove(m.id)} style={{ ...btn('danger'), padding:'4px 10px', fontSize:12 }}>✕</button>
                    </span>}
                  </td>
                </tr>
              )})}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Teams (sync only, no players) ─────────────────────────────────────────────
function Teams() {
  const [teams, setTeams] = useState([]); const [status, setStatus] = useState(''); const [pulling, setPulling] = useState(false)
  useEffect(()=>{ supabase.from('teams').select('*').order('name').then(({data})=>setTeams(data||[])) },[])
  async function pullTeams() {
    setPulling(true); setStatus('Fetching teams…')
    try {
      const data = await callAPI('competitions/WC/teams?season=2026')
      const rows = (data.teams||[]).map(t=>({ api_id:t.id, name:t.name, fifa_code:t.tla||'', group_name:null }))
      if (!rows.length) { setStatus('✗ No teams returned.'); setPulling(false); return }
      const { error } = await supabase.from('teams').upsert(rows,{onConflict:'name'})
      if (error) throw new Error(error.message)
      const { data:r } = await supabase.from('teams').select('*').order('name')
      setTeams(r||[]); setStatus(`✓ ${rows.length} teams synced.`)
    } catch(e) { setStatus(`✗ ${e.message}`) }
    setPulling(false)
  }
  return (
    <div>
      <div style={{ ...card, padding:20 }}>
        <SH title="Sync Teams" sub="Pull all WC 2026 national teams. Run this before assigning teams to participants." />
        <button onClick={pullTeams} disabled={pulling} style={{ ...btn(), opacity:pulling?0.6:1 }}>{pulling?'Pulling…':'⚡ Sync Teams'}</button>
        <StatusMsg msg={status} />
      </div>
      <div style={card}>
        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:14 }}>
          <thead><tr><th style={th}>Team</th><th style={th}>FIFA Code</th></tr></thead>
          <tbody>
            {teams.length===0?<tr><td colSpan={2} style={{ ...td, textAlign:'center', color:C.muted }}>No teams yet. Click Sync Teams.</td></tr>
              :teams.map((t,i)=><tr key={t.id} style={{ background:i%2?C.stripe:C.white }}><td style={{ ...td, fontWeight:600 }}>{t.name}</td><td style={{ ...td, color:C.muted }}>{t.fifa_code||'—'}</td></tr>)}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Scoring ────────────────────────────────────────────────────────────────────
function Scoring() {
  const [status, setStatus] = useState(''); const [running, setRunning] = useState(false); const [lastRun, setLastRun] = useState(null)
  async function calculate() {
    setRunning(true); setStatus('Loading settings…')
    try {
      const { data: settings } = await supabase.from('settings').select('*').eq('id',1).single()
      setStatus('Calculating…')
      const result = await calculateAllScores(settings)
      if (result.error) throw new Error(result.error.message)
      setLastRun(new Date()); setStatus(`✓ ${result.count} score entries written.`)
    } catch(e) { setStatus(`✗ ${e.message}`) }
    setRunning(false)
  }
  return (
    <div style={{ maxWidth:540 }}>
      <div style={{ ...card, padding:24 }}>
        <SH title="Calculate Scores" sub="Reads finished matches, applies pool multipliers, writes to leaderboard" />
        <div style={{ fontFamily:"'Outfit', sans-serif", fontSize:14, color:C.muted, marginBottom:20, lineHeight:1.7 }}>
          Run after every matchday or after manually entering scores. Uses current settings multipliers automatically.
        </div>
        <button onClick={calculate} disabled={running} style={{ ...btn(), opacity:running?0.6:1, padding:'10px 24px', fontSize:15 }}>{running?'Calculating…':'⚡ Calculate Scores'}</button>
        <StatusMsg msg={status} />
        {lastRun&&<div style={{ marginTop:12, fontFamily:"'Outfit', sans-serif", fontSize:12, color:C.muted }}>Last run: {lastRun.toLocaleTimeString()}</div>}
      </div>
    </div>
  )
}

// ── Settings ───────────────────────────────────────────────────────────────────
function Settings() {
  const [cfg, setCfg] = useState(null); const [saving, setSaving] = useState(false); const [status, setStatus] = useState('')
  useEffect(()=>{ supabase.from('settings').select('*').eq('id',1).single().then(({data})=>setCfg(data)) },[])
  async function save() { setSaving(true); const { error } = await supabase.from('settings').update(cfg).eq('id',1); setStatus(error?`✗ ${error.message}`:'✓ Saved'); setSaving(false); setTimeout(()=>setStatus(''),3000) }
  if (!cfg) return <div style={{ padding:32, textAlign:'center', color:C.muted }}>Loading…</div>

  const Field = ({ label, field, type='number', step='1', hint }) => (
    <div style={{ marginBottom:12 }}>
      <div style={{ fontFamily:"'Outfit', sans-serif", fontSize:13, fontWeight:600, marginBottom:4 }}>{label}</div>
      {hint&&<div style={{ fontFamily:"'Outfit', sans-serif", fontSize:11, color:C.muted, marginBottom:4 }}>{hint}</div>}
      <input type={type} step={step} min="0" value={cfg[field]??''} onChange={e=>setCfg(c=>({...c,[field]:type==='number'?Number(e.target.value):e.target.value}))} style={{ ...inp, width:type==='text'?120:90 }} />
    </div>
  )

  return (
    <div style={{ maxWidth:700 }}>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
        <div style={{ ...card, padding:20 }}>
          <SH title="General" />
          <Field label="Entry fee" field="entry_fee" step="10" />
          <Field label="Currency" field="currency" type="text" />
          <Field label="Current gameweek" field="current_gameweek" />
        </div>
        <div style={{ ...card, padding:20 }}>
          <SH title="Scoring rules" />
          {[['Group win','points_group_win'],['Qualify from group','points_qualify'],['R16 win','points_r16_win'],['QF win','points_qf_win'],['SF win','points_sf_win'],['Winner','points_winner'],['Goal scored','points_goal'],['Draw','points_draw']].map(([l,f])=><Field key={f} label={l} field={f} />)}
        </div>
        <div style={{ ...card, padding:20 }}>
          <SH title="Pool multipliers" sub="Applied to all result points for teams in that pool" />
          <div style={{ background:'#f8fafc', borderRadius:8, padding:'10px 14px', marginBottom:14, fontFamily:"'Outfit', sans-serif", fontSize:13, color:C.muted }}>Pool A: <strong style={{ color:'#111827' }}>1.0×</strong> base</div>
          <Field label="Pool B multiplier" field="pool_b_team_mult" step="0.5" hint="e.g. 1.5× all points from Pool B team" />
          <Field label="Pool C multiplier" field="pool_c_team_mult" step="0.5" hint="e.g. 2.0× all points from Pool C team" />
        </div>
      </div>
      <div style={{ display:'flex', alignItems:'center', gap:12 }}>
        <button onClick={save} disabled={saving} style={{ ...btn(), opacity:saving?0.6:1 }}>{saving?'Saving…':'Save Settings'}</button>
        <StatusMsg msg={status} />
      </div>
    </div>
  )
}

// ── Password gate ──────────────────────────────────────────────────────────────
function PasswordGate({ onAuth }) {
  const [pw, setPw] = useState(''); const [err, setErr] = useState(false)
  function check() { if (pw===ADMIN_PASSWORD) { sessionStorage.setItem('admin_auth','1'); onAuth() } else { setErr(true); setPw('') } }
  return (
    <div style={{ minHeight:'100vh', background:C.dark, display:'flex', alignItems:'center', justifyContent:'center' }}>
      <div style={{ background:C.white, borderRadius:16, padding:'40px 36px', width:'100%', maxWidth:380, textAlign:'center', boxShadow:'0 8px 32px rgba(0,0,0,0.3)' }}>
        <div style={{ fontSize:36, marginBottom:8 }}>🔒</div>
        <h2 style={{ fontFamily:"'Barlow Condensed', sans-serif", fontSize:24, fontWeight:800, color:C.dark, margin:'0 0 4px' }}>Admin Panel</h2>
        <p style={{ fontFamily:"'Outfit', sans-serif", fontSize:13, color:C.muted, margin:'0 0 24px' }}>Office WC 2026</p>
        <input type="password" value={pw} onChange={e=>{setPw(e.target.value);setErr(false)}} onKeyDown={e=>e.key==='Enter'&&check()} placeholder="Password" style={{ ...inp, width:'100%', marginBottom:10, boxSizing:'border-box', border:`1px solid ${err?C.red:C.border}`, textAlign:'center', fontSize:16 }} autoFocus />
        {err&&<div style={{ fontFamily:"'Outfit', sans-serif", fontSize:13, color:C.red, marginBottom:8 }}>Incorrect password</div>}
        <button onClick={check} style={{ ...btn(), width:'100%', padding:'10px' }}>Enter</button>
        <Link to="/" style={{ display:'block', marginTop:16, fontFamily:"'Outfit', sans-serif", fontSize:13, color:C.muted, textDecoration:'none' }}>← Back to site</Link>
      </div>
    </div>
  )
}

// ── Admin root ────────────────────────────────────────────────────────────────
const ADMIN_TABS = [
  { id:'participants', label:'Participants', icon:'👥' },
  { id:'gameweeks',   label:'Gameweeks',    icon:'📅' },
  { id:'matches',     label:'Matches',      icon:'⚽' },
  { id:'teams',       label:'Teams',        icon:'🌍' },
  { id:'scoring',     label:'Scoring',      icon:'🏆' },
  { id:'settings',    label:'Settings',     icon:'⚙️' },
]

export default function Admin() {
  const [authed, setAuthed] = useState(!!sessionStorage.getItem('admin_auth'))
  const [tab, setTab] = useState('participants')
  useEffect(()=>{ const link=document.createElement('link'); link.rel='stylesheet'; link.href='https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700;800&family=Outfit:wght@400;500;600&display=swap'; document.head.appendChild(link); document.body.style.margin='0'; document.body.style.background=C.cream },[])
  if (!authed) return <PasswordGate onAuth={()=>setAuthed(true)} />
  return (
    <div style={{ minHeight:'100vh', background:C.cream }}>
      <header style={{ background:C.dark, paddingBottom:0 }}>
        <div style={{ maxWidth:1100, margin:'0 auto', padding:'20px 20px 0' }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:4 }}>
            <div><h1 style={{ margin:0, fontFamily:"'Barlow Condensed', sans-serif", fontWeight:800, fontSize:26, color:'#fff', lineHeight:1.1 }}>⚙️ Admin Panel</h1><p style={{ margin:0, fontFamily:"'Outfit', sans-serif", fontSize:12, color:'#6ee7b7', letterSpacing:'0.05em', textTransform:'uppercase' }}>Office WC 2026</p></div>
            <div style={{ display:'flex', gap:12, alignItems:'center' }}>
              <Link to="/" style={{ fontFamily:"'Outfit', sans-serif", fontSize:13, color:'rgba(255,255,255,0.5)', textDecoration:'none' }}>← Public site</Link>
              <button onClick={()=>{sessionStorage.removeItem('admin_auth');setAuthed(false)}} style={{ ...btn('ghost'), padding:'6px 12px', fontSize:12, border:'1px solid rgba(255,255,255,0.2)', color:'rgba(255,255,255,0.5)' }}>Logout</button>
            </div>
          </div>
          <nav style={{ display:'flex', gap:2, marginTop:16, overflowX:'auto' }}>
            {ADMIN_TABS.map(t=>{ const active=tab===t.id; return <button key={t.id} onClick={()=>setTab(t.id)} style={{ padding:'10px 16px', border:'none', borderRadius:'8px 8px 0 0', background:active?C.cream:'transparent', color:active?C.dark:'rgba(255,255,255,0.55)', fontFamily:"'Barlow Condensed', sans-serif", fontWeight:700, fontSize:13, letterSpacing:'0.06em', textTransform:'uppercase', cursor:'pointer', display:'flex', alignItems:'center', gap:5, whiteSpace:'nowrap' }}>{t.icon} {t.label}</button> })}
          </nav>
        </div>
      </header>
      <main style={{ maxWidth:1100, margin:'0 auto', padding:'24px 20px 48px' }}>
        {tab==='participants'&&<Participants/>}{tab==='gameweeks'&&<Gameweeks/>}{tab==='matches'&&<Matches/>}{tab==='teams'&&<Teams/>}{tab==='scoring'&&<Scoring/>}{tab==='settings'&&<Settings/>}
      </main>
    </div>
  )
}
