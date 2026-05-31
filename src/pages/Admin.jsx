import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'

const ADMIN_PASSWORD = import.meta.env.VITE_ADMIN_PASSWORD || 'rift2026'

const STAGE_MAP = {
  GROUP_STAGE: 'group', LAST_16: 'r16', ROUND_OF_16: 'r16',
  QUARTER_FINALS: 'qf', SEMI_FINALS: 'sf',
  FINAL: 'final', '3RD_PLACE_MATCH': 'final',
}
function apiStageToGW(stage, matchday) {
  if (stage === 'GROUP_STAGE') return matchday || 1
  return { LAST_16: 4, ROUND_OF_16: 4, QUARTER_FINALS: 5, SEMI_FINALS: 6, FINAL: 7, '3RD_PLACE_MATCH': 7 }[stage] ?? 8
}
async function callAPI(endpoint) {
  const res = await fetch(`/.netlify/functions/football-api?endpoint=${encodeURIComponent(endpoint)}`)
  const json = await res.json()
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
  return json
}

const delay = ms => new Promise(r => setTimeout(r, ms))

async function processMatchScorers(matchDetail, teamByName) {
  const goals = matchDetail.goals || []
  if (!goals.length) return 0

  const goalMap = {}
  const playerRows = []

  for (const goal of goals) {
    if (goal.type === 'OWN' || !goal.scorer?.id) continue
    const teamId = teamByName[goal.team?.name] || null
    playerRows.push({ id: goal.scorer.id, name: goal.scorer.name, team_id: teamId, position: goal.scorer.position || null })
    const key = `${goal.scorer.id}_${matchDetail.id}`
    goalMap[key] = goalMap[key] || { player_id: goal.scorer.id, match_id: matchDetail.id, goals: 0 }
    goalMap[key].goals += 1
  }

  const statsRows = Object.values(goalMap)
  if (!statsRows.length) return 0

  // Ensure players exist
  if (playerRows.length) await supabase.from('players').upsert(playerRows, { onConflict: 'id' })
  // Upsert stats
  await supabase.from('player_stats').upsert(statsRows, { onConflict: 'player_id,match_id' })
  return statsRows.length
}

// ── Scoring engine ─────────────────────────────────────────────────────────────
async function calculateAllScores(settings) {
  const [
    { data: participants }, { data: ptRows }, { data: matches },
    { data: ppRows }, { data: psRows }, { data: gwRows },
  ] = await Promise.all([
    supabase.from('participants').select('id'),
    supabase.from('participant_teams').select('participant_id, team_id, pool, teams(name)'),
    supabase.from('matches').select('*').eq('status', 'FINISHED'),
    supabase.from('player_picks').select('participant_id, gameweek_id, player_id, players(team_id)'),
    supabase.from('player_stats').select('player_id, match_id, goals'),
    supabase.from('gameweeks').select('id, week_number').order('week_number'),
  ])

  const gwByWeekNum = Object.fromEntries((gwRows || []).map(g => [g.week_number, g]))
  const teamPoolMult = { A: 1.0, B: Number(settings.pool_b_team_mult) || 1.5, C: Number(settings.pool_c_team_mult) || 2.0 }
  const pickPoolMult = { A: Number(settings.team_a_multiplier) || 1.5, B: Number(settings.team_b_multiplier) || 2.0, C: Number(settings.team_c_multiplier) || 3.0 }
  const stageWinPts = {
    group: Number(settings.points_group_win) || 2, r16: Number(settings.points_r16_win) || 5,
    qf: Number(settings.points_qf_win) || 8, sf: Number(settings.points_sf_win) || 13, final: Number(settings.points_winner) || 20,
  }
  const qualifyPts = Number(settings.points_qualify) || 3
  const perGoal = Number(settings.points_per_goal) || 1
  const upserts = []

  for (const p of participants || []) {
    const myTeams = (ptRows || []).filter(r => r.participant_id === p.id)
    const myTeamById = Object.fromEntries(myTeams.map(t => [t.team_id, t]))
    const gwScore = Object.fromEntries((gwRows || []).map(g => [g.id, { team: 0, player: 0 }]))
    const qualifyGiven = new Set()

    for (const mt of myTeams) {
      const tname = mt.teams?.name
      if (!tname) continue
      const tmult = teamPoolMult[mt.pool] ?? 1.0
      for (const m of matches || []) {
        const isHome = m.home_team === tname, isAway = m.away_team === tname
        if (!isHome && !isAway) continue
        const gw = gwByWeekNum[m.gameweek]
        if (!gw || gwScore[gw.id] === undefined) continue
        const myScore = isHome ? m.home_score : m.away_score
        const oppScore = isHome ? m.away_score : m.home_score
        if (myScore > oppScore) gwScore[gw.id].team += (stageWinPts[m.stage] ?? 0) * tmult
        if (['r16','qf','sf','final'].includes(m.stage) && !qualifyGiven.has(mt.team_id)) {
          gwScore[gw.id].team += qualifyPts * tmult
          qualifyGiven.add(mt.team_id)
        }
      }
    }

    for (const pick of (ppRows || []).filter(r => r.participant_id === p.id)) {
      if (gwScore[pick.gameweek_id] === undefined) continue
      const playerMyTeam = pick.players?.team_id ? myTeamById[pick.players.team_id] : null
      const pmult = playerMyTeam ? (pickPoolMult[playerMyTeam.pool] ?? 1.0) : 1.0
      const gwWeekNum = (gwRows || []).find(g => g.id === pick.gameweek_id)?.week_number
      const gwMatchIds = new Set((matches || []).filter(m => m.gameweek === gwWeekNum).map(m => m.id))
      const goals = (psRows || []).filter(ps => ps.player_id === pick.player_id && gwMatchIds.has(ps.match_id)).reduce((s, ps) => s + (ps.goals || 0), 0)
      gwScore[pick.gameweek_id].player += goals * pmult * perGoal
    }

    for (const gw of gwRows || []) {
      const s = gwScore[gw.id]
      upserts.push({ participant_id: p.id, gameweek_id: gw.id, team_points: +s.team.toFixed(2), player_points: +s.player.toFixed(2), total_points: +(s.team + s.player).toFixed(2), calculated_at: new Date().toISOString() })
    }
  }

  const { error } = await supabase.from('participant_scores').upsert(upserts, { onConflict: 'participant_id,gameweek_id' })
  return { count: upserts.length, error }
}

// ── Styles ─────────────────────────────────────────────────────────────────────
const C = { dark:'#0d1f0f', green:'#1a4a20', gold:'#e8b84b', cream:'#faf7f0', white:'#ffffff', muted:'#6b7280', border:'#e5e7eb', stripe:'#f9fafb', red:'#dc2626' }
const inp = { padding:'8px 12px', border:`1px solid ${C.border}`, borderRadius:6, fontFamily:"'Outfit', sans-serif", fontSize:14, outline:'none', background:C.white, color:'#111827' }
const btn = (v='primary') => ({ padding:'8px 16px', borderRadius:6, border:'none', cursor:'pointer', fontFamily:"'Barlow Condensed', sans-serif", fontWeight:700, fontSize:14, letterSpacing:'0.06em', textTransform:'uppercase', background:v==='primary'?C.green:v==='danger'?C.red:'#f1f5f9', color:v==='ghost'?C.muted:C.white })
const card = { background:C.white, borderRadius:12, boxShadow:'0 1px 3px rgba(0,0,0,0.08)', overflow:'hidden', marginBottom:20 }
const th = { padding:'10px 16px', textAlign:'left', background:'#f8fafc', color:C.muted, fontFamily:"'Barlow Condensed', sans-serif", fontWeight:600, fontSize:12, letterSpacing:'0.06em', textTransform:'uppercase', borderBottom:`2px solid ${C.border}` }
const td = { padding:'12px 16px', borderBottom:`1px solid ${C.border}`, verticalAlign:'middle', color:'#111827', fontFamily:"'Outfit', sans-serif", fontSize:14 }

function StatusMsg({ msg }) {
  if (!msg) return null
  const isErr = msg.startsWith('✗'), isOk = msg.startsWith('✓')
  return <div style={{ padding:'10px 14px', borderRadius:8, marginTop:10, fontFamily:"'Outfit', sans-serif", fontSize:13, background:isErr?'#fee2e2':isOk?'#d1fae5':'#fef3c7', color:isErr?'#991b1b':isOk?'#065f46':'#92400e' }}>{msg}</div>
}
function SectionHeader({ title, sub }) {
  return <div style={{ marginBottom:14 }}><div style={{ fontFamily:"'Barlow Condensed', sans-serif", fontWeight:700, fontSize:17, textTransform:'uppercase', letterSpacing:'0.06em', color:C.dark }}>{title}</div>{sub&&<div style={{ fontFamily:"'Outfit', sans-serif", fontSize:12, color:C.muted, marginTop:2 }}>{sub}</div>}</div>
}

// ── Participants ───────────────────────────────────────────────────────────────
function Participants() {
  const [list, setList] = useState([])
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState(''); const [paid, setPaid] = useState(true); const [saving, setSaving] = useState(false)
  const load = useCallback(async () => { const { data } = await supabase.from('participants').select('*').order('created_at'); setList(data||[]); setLoading(false) }, [])
  useEffect(() => { load() }, [load])
  async function add() {
    if (!name.trim()) return; setSaving(true)
    await supabase.from('participants').insert({ name: name.trim(), paid }); setName(''); setPaid(true); await load(); setSaving(false)
  }
  async function togglePaid(id, cur) { await supabase.from('participants').update({ paid: !cur }).eq('id', id); setList(l => l.map(p => p.id===id?{...p,paid:!cur}:p)) }
  async function remove(id) { if (!confirm('Delete?')) return; await supabase.from('participants').delete().eq('id', id); setList(l=>l.filter(p=>p.id!==id)) }
  const paidCount = list.filter(p => p.paid).length
  return (
    <div>
      <div style={{ display:'flex', gap:12, marginBottom:20, flexWrap:'wrap' }}>
        {[['Total',list.length],['Paid',paidCount],['Free',list.length-paidCount],['Pot',`R${paidCount*100}`]].map(([k,v]) => (
          <div key={k} style={{ background:C.white, borderRadius:10, padding:'14px 20px', boxShadow:'0 1px 3px rgba(0,0,0,0.07)', minWidth:90, textAlign:'center' }}>
            <div style={{ fontFamily:"'Barlow Condensed', sans-serif", fontSize:26, fontWeight:700, color:C.dark }}>{v}</div>
            <div style={{ fontFamily:"'Outfit', sans-serif", fontSize:12, color:C.muted, textTransform:'uppercase', letterSpacing:'0.05em' }}>{k}</div>
          </div>
        ))}
      </div>
      <div style={{ ...card, padding:20 }}>
        <SectionHeader title="Add Participant" />
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
              {list.map((p,i) => (
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
  const [list, setList] = useState([])
  const [form, setForm] = useState({ week_number:'', starts_at:'', ends_at:'' }); const [saving, setSaving] = useState(false)
  const load = useCallback(async () => { const { data } = await supabase.from('gameweeks').select('*').order('week_number'); setList(data||[]) }, [])
  useEffect(() => { load() }, [load])
  async function create() {
    if (!form.week_number) return; setSaving(true)
    await supabase.from('gameweeks').insert({ week_number:Number(form.week_number), starts_at:form.starts_at||null, ends_at:form.ends_at||null })
    setForm({ week_number:'', starts_at:'', ends_at:'' }); await load(); setSaving(false)
  }
  async function remove(id) { if (!confirm('Delete?')) return; await supabase.from('gameweeks').delete().eq('id', id); setList(l=>l.filter(g=>g.id!==id)) }
  const fmtDate = d => d ? new Date(d).toLocaleDateString('en-ZA', { day:'numeric', month:'short' }) : '—'
  return (
    <div>
      <div style={{ ...card, padding:20 }}>
        <SectionHeader title="Create Gameweek" />
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
            {list.length===0 ? <tr><td colSpan={4} style={{ ...td, textAlign:'center', color:C.muted }}>No gameweeks yet.</td></tr>
              : list.map((gw,i) => (
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
  const load = useCallback(async () => { const { data } = await supabase.from('matches').select('*').order('gameweek').order('kickoff'); setList(data||[]) }, [])
  useEffect(() => { load() }, [load])

  // Quick sync: just match fixtures + scores (1 API call)
  async function quickSync() {
    setPulling(true); setPullMode('quick'); setPullStatus('Fetching fixtures and scores…')
    try {
      const data = await callAPI('competitions/WC/matches')
      const rows = (data.matches||[]).map(m => ({ id:m.id, gameweek:apiStageToGW(m.stage,m.matchday), stage:STAGE_MAP[m.stage]||m.stage?.toLowerCase()||'group', home_team:m.homeTeam?.name||'—', away_team:m.awayTeam?.name||'—', home_score:m.score?.fullTime?.home??null, away_score:m.score?.fullTime?.away??null, status:m.status||'SCHEDULED', kickoff:m.utcDate||null }))
      if (!rows.length) { setPullStatus('✗ No matches returned.'); setPulling(false); return }
      const { error } = await supabase.from('matches').upsert(rows, { onConflict:'id' })
      if (error) throw new Error(error.message)
      await load(); setPullStatus(`✓ ${rows.length} matches synced.`)
    } catch(e) { setPullStatus(`✗ ${e.message}`) }
    setPulling(false)
  }

  // Full sync: matches + goalscorers + auto-calculate scores
  async function fullSync() {
    setPulling(true); setPullMode('full'); setPullStatus('Step 1/3 — Fetching fixtures and scores…')
    try {
      // 1. Sync all matches
      const data = await callAPI('competitions/WC/matches')
      const allMatches = data.matches || []
      if (!allMatches.length) { setPullStatus('✗ No matches returned.'); setPulling(false); return }
      const rows = allMatches.map(m => ({ id:m.id, gameweek:apiStageToGW(m.stage,m.matchday), stage:STAGE_MAP[m.stage]||m.stage?.toLowerCase()||'group', home_team:m.homeTeam?.name||'—', away_team:m.awayTeam?.name||'—', home_score:m.score?.fullTime?.home??null, away_score:m.score?.fullTime?.away??null, status:m.status||'SCHEDULED', kickoff:m.utcDate||null }))
      const { error: me } = await supabase.from('matches').upsert(rows, { onConflict:'id' })
      if (me) throw new Error(me.message)

      // 2. Sync scorers for finished matches not yet processed
      const finished = allMatches.filter(m => m.status === 'FINISHED')
      if (finished.length > 0) {
        const { data: existing } = await supabase.from('player_stats').select('match_id')
        const covered = new Set((existing||[]).map(s => s.match_id))
        const toFetch = finished.filter(m => !covered.has(m.id))

        if (toFetch.length > 0) {
          const estMins = Math.ceil(toFetch.length * 6.5 / 60)
          setPullStatus(`Step 2/3 — Fetching scorers for ${toFetch.length} matches (~${estMins} min)…`)

          // Build team name → UUID map once
          const { data: teamsData } = await supabase.from('teams').select('id, name')
          const teamByName = Object.fromEntries((teamsData||[]).map(t => [t.name, t.id]))

          let totalGoals = 0
          for (let i = 0; i < toFetch.length; i++) {
            const m = toFetch[i]
            setPullStatus(`Step 2/3 — Scorers ${i+1}/${toFetch.length}: ${m.homeTeam?.name} vs ${m.awayTeam?.name}`)
            try {
              const detail = await callAPI(`matches/${m.id}`)
              totalGoals += await processMatchScorers(detail, teamByName)
            } catch(e) { console.error('Scorer fetch failed', m.id, e) }
            if (i < toFetch.length - 1) await delay(6500)
          }
          setPullStatus(`Step 2/3 — Scorers done. ${totalGoals} goal entries saved.`)
        } else {
          setPullStatus('Step 2/3 — All finished matches already have scorers.')
        }
      }

      // 3. Auto-calculate scores
      setPullStatus('Step 3/3 — Calculating leaderboard scores…')
      const { data: settings } = await supabase.from('settings').select('*').eq('id',1).single()
      const result = await calculateAllScores(settings)
      if (result.error) throw new Error(result.error.message)

      await load()
      setPullStatus(`✓ Done — ${allMatches.length} matches, ${finished.length} finished, leaderboard updated.`)
    } catch(e) { setPullStatus(`✗ ${e.message}`) }
    setPulling(false)
  }

  async function saveScore(id) {
    const update = { home_score:Number(editScores.home_score), away_score:Number(editScores.away_score), status:'FINISHED' }
    await supabase.from('matches').update(update).eq('id', id)
    setList(l=>l.map(m=>m.id===id?{...m,...update}:m)); setEditId(null)
  }
  async function remove(id) { if (!confirm('Delete?')) return; await supabase.from('matches').delete().eq('id', id); setList(l=>l.filter(m=>m.id!==id)) }

  const stages = ['all',...new Set(list.map(m=>m.stage))]
  const gws = ['all',...new Set(list.map(m=>m.gameweek).filter(Boolean))].sort((a,b)=>a==='all'?-1:a-b)
  const visible = list.filter(m=>(stageFilter==='all'||m.stage===stageFilter)&&(gwFilter==='all'||m.gameweek==gwFilter))
  const stageLabel = { group:'Group', r16:'R16', qf:'QF', sf:'SF', final:'Final' }
  const statusColor = { FINISHED:{bg:'#d1fae5',text:'#065f46'}, SCHEDULED:{bg:'#f1f5f9',text:'#374151'}, IN_PLAY:{bg:'#fef3c7',text:'#92400e'} }

  return (
    <div>
      <div style={{ ...card, padding:20 }}>
        <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', flexWrap:'wrap', gap:12 }}>
          <div>
            <SectionHeader title="Sync from API" />
            <div style={{ fontFamily:"'Outfit', sans-serif", fontSize:13, color:C.muted, marginTop:-8, marginBottom:0 }}>
              <strong style={{ color:'#111827' }}>Quick Sync</strong> — updates fixtures and scores only (fast, 1 call).<br/>
              <strong style={{ color:'#111827' }}>Full Sync</strong> — also pulls goalscorers and recalculates the leaderboard automatically.
            </div>
          </div>
          <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
            <button onClick={quickSync} disabled={pulling} style={{ ...btn('ghost'), border:`1px solid ${C.border}`, opacity:pulling?0.6:1 }}>
              {pulling && pullMode==='quick' ? 'Syncing…' : '↻ Quick Sync'}
            </button>
            <button onClick={fullSync} disabled={pulling} style={{ ...btn(), opacity:pulling?0.6:1 }}>
              {pulling && pullMode==='full' ? 'Syncing…' : '⚡ Full Sync'}
            </button>
          </div>
        </div>
        <StatusMsg msg={pullStatus} />
      </div>
      <div style={{ display:'flex', gap:8, marginBottom:12, flexWrap:'wrap' }}>
        <select value={stageFilter} onChange={e=>setStageFilter(e.target.value)} style={{ ...inp, padding:'6px 10px' }}>{stages.map(s=><option key={s} value={s}>{s==='all'?'All stages':stageLabel[s]||s}</option>)}</select>
        <select value={gwFilter} onChange={e=>setGwFilter(e.target.value)} style={{ ...inp, padding:'6px 10px' }}>{gws.map(g=><option key={g} value={g}>{g==='all'?'All GWs':`GW ${g}`}</option>)}</select>
        <span style={{ fontFamily:"'Outfit', sans-serif", fontSize:13, color:C.muted, alignSelf:'center' }}>{visible.length} matches</span>
      </div>
      <div style={card}>
        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
          <thead><tr><th style={th}>GW</th><th style={th}>Stage</th><th style={th}>Home</th><th style={{ ...th, textAlign:'center' }}>Score</th><th style={th}>Away</th><th style={th}>Status</th><th style={{ ...th, textAlign:'right' }}>Actions</th></tr></thead>
          <tbody>
            {visible.length===0 ? <tr><td colSpan={7} style={{ ...td, textAlign:'center', color:C.muted }}>No matches yet.</td></tr>
              : visible.map((m,i) => {
                const sc = statusColor[m.status]||statusColor.SCHEDULED; const editing = editId===m.id
                return (
                  <tr key={m.id} style={{ background:i%2?C.stripe:C.white }}>
                    <td style={{ ...td, fontFamily:"'Barlow Condensed', sans-serif", fontWeight:700 }}>{m.gameweek??'—'}</td>
                    <td style={td}><span style={{ background:'#f1f5f9', color:C.muted, padding:'2px 8px', borderRadius:4, fontSize:12, fontWeight:600 }}>{stageLabel[m.stage]||m.stage}</span></td>
                    <td style={{ ...td, fontWeight:600 }}>{m.home_team}</td>
                    <td style={{ ...td, textAlign:'center', fontFamily:"'Barlow Condensed', sans-serif", fontWeight:700, fontSize:16 }}>
                      {editing ? <span style={{ display:'flex', gap:4, justifyContent:'center' }}>
                        <input type="number" min="0" value={editScores.home_score} onChange={e=>setEditScores(s=>({...s,home_score:e.target.value}))} style={{ ...inp, width:48, padding:'4px 6px', textAlign:'center' }} />
                        <span style={{ alignSelf:'center' }}>–</span>
                        <input type="number" min="0" value={editScores.away_score} onChange={e=>setEditScores(s=>({...s,away_score:e.target.value}))} style={{ ...inp, width:48, padding:'4px 6px', textAlign:'center' }} />
                      </span> : (m.home_score!=null?`${m.home_score} – ${m.away_score}`:'– – –')}
                    </td>
                    <td style={{ ...td, fontWeight:600 }}>{m.away_team}</td>
                    <td style={td}><span style={{ ...sc, padding:'2px 8px', borderRadius:4, fontSize:12, fontWeight:600 }}>{m.status}</span></td>
                    <td style={{ ...td, textAlign:'right' }}>
                      {editing ? <span style={{ display:'flex', gap:4, justifyContent:'flex-end' }}>
                        <button onClick={()=>saveScore(m.id)} style={{ ...btn(), padding:'4px 10px', fontSize:12 }}>Save</button>
                        <button onClick={()=>setEditId(null)} style={{ ...btn('ghost'), padding:'4px 10px', fontSize:12 }}>Cancel</button>
                      </span> : <span style={{ display:'flex', gap:4, justifyContent:'flex-end' }}>
                        <button onClick={()=>{ setEditId(m.id); setEditScores({ home_score:m.home_score??'', away_score:m.away_score??'' }) }} style={{ ...btn('ghost'), padding:'4px 10px', fontSize:12 }}>Edit</button>
                        <button onClick={()=>remove(m.id)} style={{ ...btn('danger'), padding:'4px 10px', fontSize:12 }}>✕</button>
                      </span>}
                    </td>
                  </tr>
                )
              })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Players ────────────────────────────────────────────────────────────────────
function Players() {
  const [teams, setTeams] = useState([]); const [players, setPlayers] = useState([]); const [teamFilter, setTeamFilter] = useState('all')
  const [pullTeamsStatus, setPullTeamsStatus] = useState('')
  const [pullPlayersStatus, setPullPlayersStatus] = useState('')
  const [pullingTeams, setPullingTeams] = useState(false); const [pullingPlayers, setPullingPlayers] = useState(false)
  useEffect(() => { (async () => { const [t,p] = await Promise.all([supabase.from('teams').select('*').order('name'), supabase.from('players').select('*, teams(name)').order('name')]); setTeams(t.data||[]); setPlayers(p.data||[]) })() }, [])
  async function pullTeams() {
    setPullingTeams(true); setPullTeamsStatus('Fetching teams…')
    try { const data = await callAPI('competitions/WC/teams'); const rows = (data.teams||[]).map(t=>({ name:t.name, fifa_code:t.tla||'', group_name:null })); const { error } = await supabase.from('teams').upsert(rows, { onConflict:'name' }); if (error) throw new Error(error.message); const { data:r } = await supabase.from('teams').select('*').order('name'); setTeams(r||[]); setPullTeamsStatus(`✓ ${rows.length} teams synced.`) } catch(e) { setPullTeamsStatus(`✗ ${e.message}`) }
    setPullingTeams(false)
  }
  async function pullPlayers() {
    if (!teams.length) { setPullPlayersStatus('✗ Pull teams first.'); return }
    if (!confirm(`Fetch squads for ${teams.length} teams (~${teams.length*7}s). Continue?`)) return
    setPullingPlayers(true); let count=0, errors=[]
    for (let i=0;i<teams.length;i++) { const team=teams[i]; setPullPlayersStatus(`Squad ${i+1}/${teams.length}: ${team.name}…`); try { const data=await callAPI(`teams/${team.id}`); const rows=(data.squad||[]).map(p=>({ name:p.name, position:p.position||'—', team_id:team.id })); if (rows.length) { await supabase.from('players').upsert(rows,{onConflict:'name'}); count+=rows.length } } catch(e) { errors.push(team.name) }; if (i<teams.length-1) await new Promise(r=>setTimeout(r,7000)) }
    const { data:r } = await supabase.from('players').select('*, teams(name)').order('name'); setPlayers(r||[])
    setPullPlayersStatus(`✓ ${count} players synced.${errors.length?` Errors: ${errors.join(', ')}`:''}`); setPullingPlayers(false)
  }
  const visible = teamFilter==='all' ? players : players.filter(p=>p.team_id==teamFilter)
  return (
    <div>
      <div style={{ display:'flex', gap:12, flexWrap:'wrap', marginBottom:20 }}>
        {[{ title:'Teams', sub:'Pull all WC 2026 national teams', action:pullTeams, loading:pullingTeams, status:pullTeamsStatus, label:'⚡ Sync Teams', disabled:pullingTeams }, { title:'Players', sub:'Fetch squads — slow, rate limited', action:pullPlayers, loading:pullingPlayers, status:pullPlayersStatus, label:'⚡ Sync Players', disabled:pullingPlayers||!teams.length }].map(s => (
          <div key={s.title} style={{ ...card, flex:1, minWidth:240, padding:20, marginBottom:0 }}><SectionHeader title={s.title} sub={s.sub} /><button onClick={s.action} disabled={s.disabled} style={{ ...btn(), opacity:s.disabled?0.6:1 }}>{s.loading?'Pulling…':s.label}</button><StatusMsg msg={s.status} /></div>
        ))}
      </div>
      <div style={{ display:'flex', gap:8, marginBottom:12 }}>
        <select value={teamFilter} onChange={e=>setTeamFilter(e.target.value)} style={{ ...inp, padding:'6px 10px' }}><option value="all">All teams</option>{teams.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select>
        <span style={{ fontFamily:"'Outfit', sans-serif", fontSize:13, color:C.muted, alignSelf:'center' }}>{visible.length} players</span>
      </div>
      <div style={card}>
        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
          <thead><tr><th style={th}>Name</th><th style={th}>Position</th><th style={th}>Team</th></tr></thead>
          <tbody>{visible.length===0?<tr><td colSpan={3} style={{ ...td, textAlign:'center', color:C.muted }}>No players yet.</td></tr>:visible.map((p,i)=><tr key={p.id} style={{ background:i%2?C.stripe:C.white }}><td style={{ ...td, fontWeight:600 }}>{p.name}</td><td style={td}>{p.position}</td><td style={td}>{p.teams?.name??'—'}</td></tr>)}</tbody>
        </table>
      </div>
    </div>
  )
}

// ── Settings ───────────────────────────────────────────────────────────────────
function Settings() {
  const [cfg, setCfg] = useState(null); const [saving, setSaving] = useState(false); const [status, setStatus] = useState('')
  useEffect(() => { supabase.from('settings').select('*').eq('id',1).single().then(({data})=>setCfg(data)) }, [])
  async function save() { setSaving(true); const { error } = await supabase.from('settings').update(cfg).eq('id',1); setStatus(error?`✗ ${error.message}`:'✓ Settings saved'); setSaving(false); setTimeout(()=>setStatus(''),3000) }
  if (!cfg) return <div style={{ padding:32, textAlign:'center', color:C.muted }}>Loading settings…</div>

  const Field = ({ label, field, type='number', step='0.5', hint }) => (
    <div style={{ marginBottom:12 }}>
      <div style={{ fontFamily:"'Outfit', sans-serif", fontSize:13, fontWeight:600, marginBottom:4 }}>{label}</div>
      {hint&&<div style={{ fontFamily:"'Outfit', sans-serif", fontSize:11, color:C.muted, marginBottom:4 }}>{hint}</div>}
      <input type={type} step={step} min="0" value={cfg[field]??''} onChange={e=>setCfg(c=>({...c,[field]:type==='number'?Number(e.target.value):e.target.value}))} style={{ ...inp, width:type==='text'?120:90 }} />
    </div>
  )

  return (
    <div style={{ maxWidth:760 }}>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
        <div style={{ ...card, padding:20 }}>
          <SectionHeader title="General" />
          <Field label="Entry fee" field="entry_fee" step="10" />
          <Field label="Currency" field="currency" type="text" />
          <Field label="Current gameweek" field="current_gameweek" step="1" />
        </div>
        <div style={{ ...card, padding:20 }}>
          <SectionHeader title="Scoring rules" sub="Points for match results" />
          {[['Group stage win','points_group_win'],['Qualify from group','points_qualify'],['Round of 16 win','points_r16_win'],['Quarter-final win','points_qf_win'],['Semi-final win','points_sf_win'],['Tournament winner','points_winner'],['Goals (per goal)','points_per_goal']].map(([label,field])=><Field key={field} label={label} field={field} step="1" />)}
        </div>
        <div style={{ ...card, padding:20 }}>
          <SectionHeader title="Team points multipliers" sub="Applied to all result points from that pool" />
          <div style={{ background:'#f8fafc', borderRadius:8, padding:'10px 14px', marginBottom:14, fontFamily:"'Outfit', sans-serif", fontSize:13, color:C.muted }}>Pool A teams: <strong style={{ color:'#111827' }}>1.0×</strong> (base, fixed)</div>
          <Field label="Pool B team multiplier" field="pool_b_team_mult" hint="e.g. 1.5 = 50% bonus on all Pool B team result points" />
          <Field label="Pool C team multiplier" field="pool_c_team_mult" hint="e.g. 2.0 = double all Pool C team result points" />
        </div>
        <div style={{ ...card, padding:20 }}>
          <SectionHeader title="Player pick multipliers" sub="Applied when player is from one of your own teams" />
          <Field label="Pick from Pool A team" field="team_a_multiplier" hint="e.g. 1.5× if player plays for your Pool A team" />
          <Field label="Pick from Pool B team" field="team_b_multiplier" hint="e.g. 2.0× if player plays for your Pool B team" />
          <Field label="Pick from Pool C team" field="team_c_multiplier" hint="e.g. 3.0× if player plays for your Pool C team" />
        </div>
      </div>
      <div style={{ display:'flex', alignItems:'center', gap:12 }}>
        <button onClick={save} disabled={saving} style={{ ...btn(), opacity:saving?0.6:1 }}>{saving?'Saving…':'Save Settings'}</button>
        <StatusMsg msg={status} />
      </div>
    </div>
  )
}

// ── Scoring ────────────────────────────────────────────────────────────────────
function Scoring() {
  const [status, setStatus] = useState(''); const [running, setRunning] = useState(false); const [lastRun, setLastRun] = useState(null); const [summary, setSummary] = useState(null)
  async function calculate() {
    setRunning(true); setStatus('Loading settings…'); setSummary(null)
    try {
      const { data: settings, error: se } = await supabase.from('settings').select('*').eq('id',1).single()
      if (se) throw new Error(se.message)
      setStatus('Calculating scores…')
      const result = await calculateAllScores(settings)
      if (result.error) throw new Error(result.error.message)
      setLastRun(new Date()); setStatus('✓ Done'); setSummary({ entries: result.count })
    } catch(e) { setStatus(`✗ ${e.message}`) }
    setRunning(false)
  }
  return (
    <div style={{ maxWidth:600 }}>
      <div style={{ ...card, padding:24 }}>
        <SectionHeader title="Calculate scores" sub="Reads all finished matches and player stats, writes totals to the leaderboard" />
        <div style={{ fontFamily:"'Outfit', sans-serif", fontSize:14, color:C.muted, lineHeight:1.7, marginBottom:20 }}>
          Run after every matchday. Scoring uses:
          <ul style={{ margin:'4px 0 0 20px', padding:0 }}>
            <li>Team result points × pool multiplier</li>
            <li>Qualify-from-group bonus</li>
            <li>Player pick goals × pick multiplier (if from own team)</li>
          </ul>
        </div>
        <button onClick={calculate} disabled={running} style={{ ...btn(), opacity:running?0.6:1, padding:'10px 24px', fontSize:15 }}>{running?'Calculating…':'⚡ Calculate All Scores'}</button>
        <StatusMsg msg={status} />
        {summary && <div style={{ marginTop:16, background:'#f0fdf4', border:'1px solid #bbf7d0', borderRadius:8, padding:'14px 18px' }}><div style={{ fontFamily:"'Barlow Condensed', sans-serif", fontWeight:700, fontSize:16, color:'#065f46' }}>Complete</div><div style={{ fontFamily:"'Outfit', sans-serif", fontSize:13, color:'#065f46', marginTop:4 }}>{summary.entries} score entries written.</div></div>}
        {lastRun && <div style={{ marginTop:12, fontFamily:"'Outfit', sans-serif", fontSize:12, color:C.muted }}>Last run: {lastRun.toLocaleTimeString()}</div>}
      </div>
      <div style={{ ...card, padding:20 }}>
        <SectionHeader title="How scoring works" />
        <div style={{ fontFamily:"'Outfit', sans-serif", fontSize:13, color:C.muted, lineHeight:1.7 }}>
          <div>Use <strong style={{ color:'#111827' }}>Full Sync</strong> on the Matches tab to pull match results, goalscorer data, and recalculate the leaderboard in one click.</div>
          <div style={{ marginTop:8 }}>Alternatively, run <strong style={{ color:'#111827' }}>Calculate All Scores</strong> above after manually editing results in the Matches tab.</div>
          <div style={{ marginTop:8 }}>Multipliers are configured in the <strong style={{ color:'#111827' }}>Settings</strong> tab.</div>
        </div>
      </div>
    </div>
  )
}

// ── Admin Picks ────────────────────────────────────────────────────────────────
function AdminPicks() {
  const [participants, setParticipants] = useState([])
  const [gameweeks, setGameweeks] = useState([])
  const [players, setPlayers] = useState([])
  const [ptRows, setPtRows] = useState([])  // participant_teams
  const [picks, setPicks] = useState([])
  const [settings, setSettings] = useState(null)
  const [selectedGw, setSelectedGw] = useState(null)
  const [editPid, setEditPid] = useState(null) // participant being edited
  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    (async () => {
      const [p, g, pl, pt, s] = await Promise.all([
        supabase.from('participants').select('id, name').order('name'),
        supabase.from('gameweeks').select('*').order('week_number'),
        supabase.from('players').select('id, name, team_id, teams(name)').order('name'),
        supabase.from('participant_teams').select('participant_id, team_id, pool'),
        supabase.from('settings').select('*').eq('id', 1).single(),
      ])
      setParticipants(p.data || [])
      setGameweeks(g.data || [])
      setPlayers(pl.data || [])
      setPtRows(pt.data || [])
      setSettings(s.data)
      const curGwNum = s.data?.current_gameweek
      const cur = (g.data || []).find(g => g.week_number === curGwNum) || (g.data || [])[0]
      if (cur) setSelectedGw(cur.id)
    })()
  }, [])

  const loadPicks = useCallback(async (gwId) => {
    if (!gwId) return
    const { data } = await supabase.from('player_picks').select('participant_id, player_id, players(id, name, team_id, teams(name))').eq('gameweek_id', gwId)
    setPicks(data || [])
  }, [])

  useEffect(() => { loadPicks(selectedGw) }, [selectedGw, loadPicks])

  function getMultiplier(participantId, playerTeamId) {
    if (!playerTeamId || !settings) return null
    const pt = ptRows.find(t => t.participant_id === participantId && t.team_id === playerTeamId)
    if (!pt) return null
    const multMap = { A: settings.team_a_multiplier, B: settings.team_b_multiplier, C: settings.team_c_multiplier }
    return { mult: multMap[pt.pool] || 1, pool: pt.pool }
  }

  async function assignPick(participantId, player) {
    setSaving(true)
    const { error } = await supabase.from('player_picks').upsert(
      { participant_id: participantId, gameweek_id: selectedGw, player_id: player.id },
      { onConflict: 'participant_id,gameweek_id' }
    )
    if (!error) { await loadPicks(selectedGw); setEditPid(null); setSearch('') }
    setSaving(false)
  }

  async function removePick(participantId) {
    if (!confirm('Remove this pick?')) return
    await supabase.from('player_picks').delete().eq('participant_id', participantId).eq('gameweek_id', selectedGw)
    setPicks(picks.filter(p => p.participant_id !== participantId))
  }

  const currentGw = gameweeks.find(g => g.id === selectedGw)
  const filteredPlayers = search.length >= 2 ? players.filter(p => p.name.toLowerCase().includes(search.toLowerCase())).slice(0, 10) : []
  const rows = participants.map(p => ({ ...p, pick: picks.find(pk => pk.participant_id === p.id) || null }))
  const unpicked = rows.filter(r => !r.pick).length

  return (
    <div>
      {/* Gameweek selector */}
      <div style={{ display:'flex', gap:8, marginBottom:16, flexWrap:'wrap', alignItems:'center' }}>
        {gameweeks.map(gw => { const active = gw.id === selectedGw; return (
          <button key={gw.id} onClick={() => setSelectedGw(gw.id)} style={{ padding:'8px 16px', border:`1.5px solid ${active?C.green:C.border}`, borderRadius:8, background:active?C.green:C.white, color:active?C.white:C.muted, fontFamily:"'Barlow Condensed', sans-serif", fontWeight:700, fontSize:14, cursor:'pointer' }}>
            GW {gw.week_number}
          </button>
        )})}
        {unpicked > 0 && <span style={{ fontFamily:"'Outfit', sans-serif", fontSize:13, color:'#92400e', background:'#fef3c7', padding:'4px 12px', borderRadius:99 }}>{unpicked} not picked</span>}
        <a href="/picks" target="_blank" style={{ fontFamily:"'Outfit', sans-serif", fontSize:13, color:C.green, marginLeft:'auto', textDecoration:'none' }}>→ Public picks page ↗</a>
      </div>

      <div style={card}>
        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:14 }}>
          <thead><tr>
            <th style={th}>Participant</th>
            <th style={th}>GW{currentGw?.week_number} Pick</th>
            <th style={th}>Multiplier</th>
            <th style={{ ...th, textAlign:'right' }}>Actions</th>
          </tr></thead>
          <tbody>
            {rows.map((row, i) => {
              const m = row.pick ? getMultiplier(row.id, row.pick.players?.team_id) : null
              const editing = editPid === row.id
              return (
                <tr key={row.id} style={{ background: i % 2 ? C.stripe : C.white }}>
                  <td style={{ ...td, fontWeight:600 }}>{row.name}</td>
                  <td style={td}>
                    {editing ? (
                      <div style={{ position:'relative' }}>
                        <input autoFocus value={search} onChange={e => setSearch(e.target.value)} placeholder="Search player…" style={{ ...inp, width:220, padding:'6px 10px' }} />
                        {filteredPlayers.length > 0 && (
                          <div style={{ position:'absolute', top:'100%', left:0, width:280, background:C.white, border:`1px solid ${C.border}`, borderRadius:8, boxShadow:'0 4px 12px rgba(0,0,0,0.12)', zIndex:50 }}>
                            {filteredPlayers.map(p => {
                              const m2 = getMultiplier(row.id, p.team_id)
                              return (
                                <div key={p.id} onClick={() => assignPick(row.id, p)} style={{ padding:'8px 12px', cursor:'pointer', borderBottom:`1px solid ${C.stripe}`, display:'flex', justifyContent:'space-between', alignItems:'center' }}
                                  onMouseEnter={e => e.currentTarget.style.background=C.stripe} onMouseLeave={e => e.currentTarget.style.background=C.white}>
                                  <div>
                                    <div style={{ fontWeight:600, fontSize:13 }}>{p.name}</div>
                                    <div style={{ fontSize:12, color:C.muted }}>{p.teams?.name}</div>
                                  </div>
                                  {m2 && <span style={{ fontFamily:"'Barlow Condensed', sans-serif", fontWeight:700, fontSize:14, color:C.green }}>{m2.mult}×</span>}
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    ) : row.pick ? (
                      <span>
                        <strong>{row.pick.players?.name || '—'}</strong>
                        <span style={{ color:C.muted, fontSize:13, marginLeft:6 }}>{row.pick.players?.teams?.name}</span>
                      </span>
                    ) : (
                      <span style={{ color:C.muted, fontSize:13, fontStyle:'italic' }}>Not picked</span>
                    )}
                  </td>
                  <td style={td}>
                    {m ? <span style={{ fontFamily:"'Barlow Condensed', sans-serif", fontWeight:700, fontSize:15, color:C.green }}>{m.mult}× Pool {m.pool}</span>
                       : <span style={{ color:C.muted, fontSize:13 }}>—</span>}
                  </td>
                  <td style={{ ...td, textAlign:'right' }}>
                    <span style={{ display:'flex', gap:4, justifyContent:'flex-end' }}>
                      {editing
                        ? <button onClick={() => { setEditPid(null); setSearch('') }} style={{ ...btn('ghost'), padding:'4px 10px', fontSize:12 }}>Cancel</button>
                        : <button onClick={() => { setEditPid(row.id); setSearch('') }} style={{ ...btn('ghost'), padding:'4px 10px', fontSize:12 }}>Set</button>
                      }
                      {row.pick && !editing && <button onClick={() => removePick(row.id)} style={{ ...btn('danger'), padding:'4px 10px', fontSize:12 }}>✕</button>}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
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
        <p style={{ fontFamily:"'Outfit', sans-serif", fontSize:13, color:C.muted, margin:'0 0 24px' }}>The Rift WC 2026</p>
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
  { id:'gameweeks', label:'Gameweeks', icon:'📅' },
  { id:'matches', label:'Matches', icon:'⚽' },
  { id:'players', label:'Players', icon:'🌍' },
  { id:'picks', label:'Picks', icon:'🎯' },
  { id:'scoring', label:'Scoring', icon:'🏆' },
  { id:'settings', label:'Settings', icon:'⚙️' },
]

export default function Admin() {
  const [authed, setAuthed] = useState(!!sessionStorage.getItem('admin_auth'))
  const [tab, setTab] = useState('participants')
  useEffect(() => {
    const link = document.createElement('link'); link.rel='stylesheet'; link.href='https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700;800&family=Outfit:wght@400;500;600&display=swap'; document.head.appendChild(link)
    document.body.style.margin='0'; document.body.style.background=C.cream
  }, [])
  if (!authed) return <PasswordGate onAuth={()=>setAuthed(true)} />
  return (
    <div style={{ minHeight:'100vh', background:C.cream }}>
      <header style={{ background:C.dark, paddingBottom:0 }}>
        <div style={{ maxWidth:1100, margin:'0 auto', padding:'20px 20px 0' }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:4 }}>
            <div><h1 style={{ margin:0, fontFamily:"'Barlow Condensed', sans-serif", fontWeight:800, fontSize:26, color:'#fff', lineHeight:1.1 }}>⚙️ Admin Panel</h1><p style={{ margin:0, fontFamily:"'Outfit', sans-serif", fontSize:12, color:'#6ee7b7', letterSpacing:'0.05em', textTransform:'uppercase' }}>The Rift WC 2026</p></div>
            <div style={{ display:'flex', gap:12, alignItems:'center' }}>
              <Link to="/" style={{ fontFamily:"'Outfit', sans-serif", fontSize:13, color:'rgba(255,255,255,0.5)', textDecoration:'none' }}>← Public site</Link>
              <button onClick={()=>{sessionStorage.removeItem('admin_auth');setAuthed(false)}} style={{ ...btn('ghost'), padding:'6px 12px', fontSize:12, border:'1px solid rgba(255,255,255,0.2)', color:'rgba(255,255,255,0.5)' }}>Logout</button>
            </div>
          </div>
          <nav style={{ display:'flex', gap:2, marginTop:16, overflowX:'auto' }}>
            {ADMIN_TABS.map(t => { const active=tab===t.id; return <button key={t.id} onClick={()=>setTab(t.id)} style={{ padding:'10px 16px', border:'none', borderRadius:'8px 8px 0 0', background:active?C.cream:'transparent', color:active?C.dark:'rgba(255,255,255,0.55)', fontFamily:"'Barlow Condensed', sans-serif", fontWeight:700, fontSize:13, letterSpacing:'0.06em', textTransform:'uppercase', cursor:'pointer', display:'flex', alignItems:'center', gap:5, whiteSpace:'nowrap' }}>{t.icon} {t.label}</button> })}
          </nav>
        </div>
      </header>
      <main style={{ maxWidth:1100, margin:'0 auto', padding:'24px 20px 48px' }}>
        {tab==='participants'&&<Participants/>}{tab==='gameweeks'&&<Gameweeks/>}{tab==='matches'&&<Matches/>}{tab==='players'&&<Players/>}{tab==='picks'&&<AdminPicks/>}{tab==='scoring'&&<Scoring/>}{tab==='settings'&&<Settings/>}
      </main>
    </div>
  )
}
