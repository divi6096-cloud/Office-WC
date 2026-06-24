import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { quickSyncAndCalculate } from '../lib/syncEngine'

const C = {
  dark:'#0d1f0f', green:'#1a4a20', gold:'#e8b84b', goldDim:'#c49a30',
  cream:'#faf7f0', white:'#ffffff', muted:'#6b7280', border:'#e5e7eb', stripe:'#f9fafb',
  paid:{bg:'#d1fae5',text:'#065f46'}, free:{bg:'#f3f4f6',text:'#374151'},
  poolA:{bg:'#fef3c7',text:'#92400e'}, poolB:{bg:'#dbeafe',text:'#1e40af'}, poolC:{bg:'#dcfce7',text:'#166534'},
}
const S = {
  card:{background:C.white,borderRadius:12,boxShadow:'0 1px 3px rgba(0,0,0,0.08)',overflow:'hidden'},
  cardScroll:{background:C.white,borderRadius:12,boxShadow:'0 1px 3px rgba(0,0,0,0.08)',overflowX:'auto',WebkitOverflowScrolling:'touch'},
  table:{width:'100%',borderCollapse:'collapse',fontSize:14,minWidth:340},
  th:{padding:'10px 16px',textAlign:'left',background:'#f8fafc',color:C.muted,fontFamily:"'Barlow Condensed', sans-serif",fontWeight:600,fontSize:13,letterSpacing:'0.06em',textTransform:'uppercase',borderBottom:`2px solid ${C.border}`},
  td:{padding:'13px 16px',borderBottom:`1px solid ${C.border}`,verticalAlign:'middle',color:'#111827',fontFamily:"'Outfit', sans-serif"},
  badge:{display:'inline-block',padding:'3px 10px',borderRadius:99,fontSize:12,fontWeight:600,fontFamily:"'Outfit', sans-serif"},
  empty:{padding:'56px 24px',textAlign:'center',color:C.muted,fontFamily:"'Outfit', sans-serif",fontSize:14},
  loading:{padding:'56px 24px',textAlign:'center',color:C.muted,fontFamily:"'Outfit', sans-serif",fontSize:14},
}
function Badge({ children, colors }) { return <span style={{ ...S.badge, background:colors.bg, color:colors.text }}>{children}</span> }
function EmptyState({ icon, message }) { return <div style={S.empty}><div style={{ fontSize:32, marginBottom:12 }}>{icon}</div><div>{message}</div></div> }
function Spinner() { return <div style={S.loading}>Loading…</div> }

const REFRESH_INTERVAL = 30000

// Responsive styles injected once — handles mobile layout without rewriting every inline style
const RESPONSIVE_CSS = `
  * { -webkit-tap-highlight-color: transparent; }
  .tbl-scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; }
  .tab-nav { display: flex; gap: 4px; margin-top: 20px; overflow-x: auto; -webkit-overflow-scrolling: touch; scrollbar-width: none; }
  .tab-nav::-webkit-scrollbar { display: none; }
  .tab-nav button { white-space: nowrap; flex-shrink: 0; }
  @media (max-width: 640px) {
    .pub-main { padding: 16px 12px 40px !important; }
    .pub-head { padding: 18px 12px 0 !important; }
    .tab-nav button { padding: 9px 13px !important; }
    table { font-size: 13px !important; }
    th, td { padding: 10px 10px !important; }
    .filter-row { flex-wrap: wrap; }
  }
  @media (max-width: 400px) {
    th, td { padding: 9px 7px !important; }
    table { font-size: 12px !important; }
  }
`
function ResponsiveStyles() {
  useEffect(() => {
    const tag = document.createElement('style')
    tag.textContent = RESPONSIVE_CSS
    document.head.appendChild(tag)
    // ensure viewport meta exists for proper mobile scaling
    let vp = document.querySelector('meta[name="viewport"]')
    if (!vp) {
      vp = document.createElement('meta')
      vp.name = 'viewport'
      document.head.appendChild(vp)
    }
    vp.content = 'width=device-width, initial-scale=1, viewport-fit=cover'
    return () => { tag.remove() }
  }, [])
  return null
}

// ── Leaderboard ────────────────────────────────────────────────────────────────
function Leaderboard() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [lastUpdated, setLastUpdated] = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState('')

  async function updateScores() {
    setSyncing(true); setSyncMsg('Checking for updates…')
    try {
      const res = await quickSyncAndCalculate(supabase, {
        cooldownMinutes: 30,
        onProgress: (msg) => setSyncMsg(msg),
      })
      if (!res.ran && res.reason === 'cooldown') {
        const wait = res.cooldownMinutes - res.minsAgo
        setSyncMsg(`Already updated ${res.minsAgo} min ago — try again in ~${wait} min.`)
        await load(true)   // still refresh the view from DB
      } else {
        setSyncMsg(`✓ Updated — ${res.updated} match${res.updated === 1 ? '' : 'es'} refreshed.`)
        await load(true)
      }
    } catch (e) {
      setSyncMsg(`✗ ${e.message}`)
    }
    setSyncing(false)
    setTimeout(() => setSyncMsg(''), 6000)
  }

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    else setRefreshing(true)

    const [{ data: allParticipants, error: pe }, { data: scores, error: se }] = await Promise.all([
      supabase.from('participants').select('id, name, paid'),
      supabase.from('participant_scores').select('participant_id, player_points, team_points, total_points'),
    ])

    if (pe || se) { setError((pe||se).message); setLoading(false); setRefreshing(false); return }

    const map = {}
    for (const p of allParticipants || []) {
      map[p.id] = { name:p.name, paid:p.paid, team_points:0, player_points:0, total_points:0 }
    }
    for (const s of scores || []) {
      if (map[s.participant_id]) {
        map[s.participant_id].team_points   += Number(s.team_points)   || 0
        map[s.participant_id].player_points += Number(s.player_points) || 0
        map[s.participant_id].total_points  += Number(s.total_points)  || 0
      }
    }

    setRows(Object.values(map).sort((a, b) => b.total_points - a.total_points))
    setLastUpdated(new Date())
    setLoading(false)
    setRefreshing(false)
  }, [])

  useEffect(() => {
    load()
    const interval = setInterval(() => load(true), REFRESH_INTERVAL)
    return () => clearInterval(interval)
  }, [load])

  if (loading) return <Spinner />
  if (error)   return <EmptyState icon="⚠️" message={`Error: ${error}`} />
  if (!rows.length) return <EmptyState icon="🏆" message="No participants yet. Check back once the draw is done." />

  const podium = ['#e8b84b','#9ca3af','#cd7f32']
  const fmtTime = d => d ? d.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit', second:'2-digit' }) : '—'
  const hasScores = rows.some(r => r.total_points > 0)

  return (
    <div>
      {/* Update Scores — throttled public sync */}
      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:14, flexWrap:'wrap' }}>
        <button onClick={updateScores} disabled={syncing}
          style={{ background:syncing?C.goldDim:C.green, color:C.white, border:'none', borderRadius:8,
            padding:'10px 18px', fontFamily:"'Barlow Condensed', sans-serif", fontWeight:700, fontSize:15,
            letterSpacing:'0.04em', cursor:syncing?'wait':'pointer', display:'flex', alignItems:'center', gap:8 }}>
          {syncing ? '⏳ Updating…' : '🔄 Update Scores'}
        </button>
        {syncMsg && <span style={{ fontFamily:"'Outfit', sans-serif", fontSize:13,
          color: syncMsg.startsWith('✓') ? C.green : syncMsg.startsWith('✗') ? '#dc2626' : C.muted }}>{syncMsg}</span>}
      </div>

      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
        {hasScores
          ? <div style={{ fontFamily:"'Outfit', sans-serif", fontSize:12, color:C.muted }}>Auto-refreshes every 30s · tap Update Scores to pull latest results</div>
          : <div style={{ fontFamily:"'Outfit', sans-serif", fontSize:12, color:C.muted }}>All participants · Scores start when matches kick off</div>
        }
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          {refreshing && <div style={{ fontFamily:"'Outfit', sans-serif", fontSize:12, color:C.gold }}>Updating…</div>}
          {lastUpdated && <div style={{ fontFamily:"'Outfit', sans-serif", fontSize:12, color:C.muted }}>Updated {fmtTime(lastUpdated)}</div>}
        </div>
      </div>

      <div style={S.cardScroll}>
        <table style={S.table}>
          <thead>
            <tr>
              <th style={{ ...S.th, width:52, textAlign:'center' }}>#</th>
              <th style={S.th}>Name</th>
              <th style={S.th}>Status</th>
              <th style={{ ...S.th, textAlign:'right' }}>Team pts</th>
              <th style={{ ...S.th, textAlign:'right' }}>Pick pts</th>
              <th style={{ ...S.th, textAlign:'right' }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={row.name} style={{ background:i%2?C.stripe:C.white }}>
                <td style={{ ...S.td, textAlign:'center' }}>
                  <span style={{ display:'inline-flex', alignItems:'center', justifyContent:'center', width:28, height:28, borderRadius:'50%', background:i<3?podium[i]+'22':'transparent', color:i<3?podium[i]:C.muted, fontFamily:"'Barlow Condensed', sans-serif", fontWeight:700, fontSize:15 }}>{i+1}</span>
                </td>
                <td style={{ ...S.td, fontWeight:600 }}>{row.name}</td>
                <td style={S.td}><Badge colors={row.paid?C.paid:C.free}>{row.paid?'Paid':'Free'}</Badge></td>
                <td style={{ ...S.td, textAlign:'right', color:C.muted }}>{row.team_points.toFixed(1)}</td>
                <td style={{ ...S.td, textAlign:'right', color:C.muted }}>{row.player_points.toFixed(1)}</td>
                <td style={{ ...S.td, textAlign:'right', fontWeight:700, fontFamily:"'Barlow Condensed', sans-serif", fontSize:18, color:i===0&&row.total_points>0?C.goldDim:'#111827' }}>
                  {row.total_points.toFixed(1)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ScoringFAQ />
    </div>
  )
}

// ── Scoring FAQ (collapsible, reads live settings) ──────────────────────────────
function ScoringFAQ() {
  const [open, setOpen] = useState(false)
  const [s, setS] = useState(null)
  useEffect(() => {
    supabase.from('settings').select('*').eq('id', 1).single().then(({ data }) => setS(data || {}))
  }, [])

  const v = (key, def) => (s && s[key] != null ? s[key] : def)
  const row = (label, val) => (
    <div style={{ display:'flex', justifyContent:'space-between', padding:'5px 0', borderBottom:`1px solid ${C.border}`, fontSize:13.5 }}>
      <span style={{ color:'#374151' }}>{label}</span>
      <span style={{ fontWeight:700, color:C.green }}>{val}</span>
    </div>
  )

  return (
    <div style={{ marginTop:18 }}>
      <button onClick={() => setOpen(o => !o)}
        style={{ width:'100%', background:C.white, border:`1px solid ${C.border}`, borderRadius:10,
          padding:'13px 16px', display:'flex', justifyContent:'space-between', alignItems:'center',
          cursor:'pointer', fontFamily:"'Barlow Condensed', sans-serif", fontWeight:700, fontSize:15,
          letterSpacing:'0.04em', color:C.dark, textTransform:'uppercase' }}>
        <span>📖 How points work</span>
        <span style={{ color:C.muted, fontSize:18 }}>{open ? '−' : '+'}</span>
      </button>

      {open && (
        <div style={{ background:C.white, border:`1px solid ${C.border}`, borderTop:'none',
          borderRadius:'0 0 10px 10px', padding:'4px 18px 18px', fontFamily:"'Outfit', sans-serif", color:'#374151', fontSize:14, lineHeight:1.6 }}>

          <p style={{ marginTop:14 }}>
            Everyone owns <strong>three teams</strong> (one from each pool: A strongest, B middle, C weakest)
            and picks <strong>one player</strong>. Your score is your three teams' points plus your player's points.
          </p>

          <h4 style={{ ...faqH }}>Team points — per match your team plays</h4>
          {row('Win (group stage)', `${v('points_group_win',2)} pts`)}
          {row('Win (Round of 32)', `${v('points_r32',3)} pts`)}
          {row('Win (Round of 16)', `${v('points_r16',5)} pts`)}
          {row('Win (Quarter-final)', `${v('points_qf',8)} pts`)}
          {row('Win (Semi-final)', `${v('points_sf',13)} pts`)}
          {row('Win (Final)', `${v('points_final',20)} pts`)}
          {row('Draw', `${v('points_draw',1)} pt`)}
          {row('Each goal your team scores', `${v('points_team_goal',1)} pt`)}

          <h4 style={faqH}>Team multipliers (by pool)</h4>
          <p style={{ margin:'2px 0 8px' }}>Your team's points are multiplied based on its pool:</p>
          {row('Pool A team', `× ${v('team_a_multiplier',1.5)}`)}
          {row('Pool B team', `× ${v('pool_b_team_mult',1.5)}`)}
          {row('Pool C team', `× ${v('pool_c_team_mult',2)}`)}

          <h4 style={faqH}>Player pick points</h4>
          {row('Each goal your player scores', `${v('points_goal',4)} pts`)}
          <p style={{ margin:'8px 0 6px' }}>
            Your player scores at <strong>1×</strong> normally — <em>unless</em> they play for one of your own teams,
            in which case they're boosted:
          </p>
          {row('Player on your Pool A team', `× ${v('pick_a_multiplier',1)}`)}
          {row('Player on your Pool B team', `× ${v('pick_b_multiplier',2)}`)}
          {row('Player on your Pool C team', `× ${v('pick_c_multiplier',3)}`)}

          <h4 style={faqH}>Switching your player</h4>
          <p style={{ margin:'2px 0' }}>
            You keep your group-stage player's goals, and once knockouts begin you may switch once.
            A new player only earns goals scored <strong>after</strong> the switch — you can't grab a player's earlier goals.
          </p>

          <h4 style={faqH}>A worked example</h4>
          <p style={{ margin:'2px 0', background:C.cream, padding:'10px 12px', borderRadius:8 }}>
            You own a Pool C team that wins a group game 3–1, and your picked player (on that Pool C team) scores 1:<br/>
            <strong>Team:</strong> ({v('points_group_win',2)} win + 3 goals × {v('points_team_goal',1)}) × {v('pool_c_team_mult',2)} = {((Number(v('points_group_win',2)) + 3*Number(v('points_team_goal',1))) * Number(v('pool_c_team_mult',2))).toFixed(0)} pts<br/>
            <strong>Player:</strong> 1 goal × {v('points_goal',4)} × {v('pick_c_multiplier',3)} = {(Number(v('points_goal',4)) * Number(v('pick_c_multiplier',3))).toFixed(0)} pts
          </p>

          <p style={{ marginTop:12, fontSize:12.5, color:C.muted }}>
            Tap <strong>Update Scores</strong> at the top to pull the latest results (available every 30 minutes).
          </p>
        </div>
      )}
    </div>
  )
}

const faqH = { fontFamily:"'Barlow Condensed', sans-serif", fontSize:15, fontWeight:700, color:C.dark, margin:'18px 0 6px', letterSpacing:'0.03em' }
function TeamOwnership() {
  const [rows, setRows] = useState([]); const [loading, setLoading] = useState(true); const [error, setError] = useState(null)
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.from('participant_teams').select('pool, participant_id, participants(name, paid), teams(name, fifa_code)')
      if (error) { setError(error.message); setLoading(false); return }
      const map = {}
      for (const row of data||[]) {
        const id = row.participant_id
        if (!map[id]) map[id] = { name:row.participants?.name??'—', paid:row.participants?.paid??false, teams:[] }
        map[id].teams.push({ pool:row.pool, name:row.teams?.name??'—', fifa:row.teams?.fifa_code??'' })
      }
      setRows(Object.values(map).sort((a,b)=>a.name.localeCompare(b.name)).map(r=>({...r,teams:r.teams.sort((a,b)=>a.pool.localeCompare(b.pool))})))
      setLoading(false)
    })()
  }, [])
  if (loading) return <Spinner />
  if (error)   return <EmptyState icon="⚠️" message={`Error: ${error}`} />
  if (!rows.length) return <EmptyState icon="🌍" message="No team assignments yet. Teams will appear after the draw." />
  const poolColors = { A:C.poolA, B:C.poolB, C:C.poolC }
  return (
    <div style={S.cardScroll}>
      <table style={S.table}>
        <thead><tr><th style={S.th}>Participant</th><th style={S.th}>Status</th><th style={S.th}>Pool A</th><th style={S.th}>Pool B</th><th style={S.th}>Pool C</th></tr></thead>
        <tbody>
          {rows.map((row,i) => {
            const byPool = { A:[], B:[], C:[] }
            row.teams.forEach(t=>{ if (byPool[t.pool]) byPool[t.pool].push(t) })
            return (
              <tr key={row.name} style={{ background:i%2?C.stripe:C.white }}>
                <td style={{ ...S.td, fontWeight:600 }}>{row.name}</td>
                <td style={S.td}><Badge colors={row.paid?C.paid:C.free}>{row.paid?'Paid':'Free'}</Badge></td>
                {['A','B','C'].map(pool=>(
                  <td key={pool} style={S.td}>
                    {byPool[pool].length ? byPool[pool].map(t=><Badge key={t.name} colors={poolColors[pool]||C.free}>{t.name}{t.fifa?` · ${t.fifa}`:''}</Badge>) : <span style={{ color:C.muted, fontSize:13 }}>—</span>}
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── Weekly Picks ───────────────────────────────────────────────────────────────
function WeeklyPicks() {
  const [picks, setPicks] = useState({}); const [gwMeta, setGwMeta] = useState({}); const [activeGw, setActiveGw] = useState(null); const [loading, setLoading] = useState(true); const [error, setError] = useState(null)
  useEffect(() => {
    (async () => {
      const [picksRes, gwRes] = await Promise.all([
        supabase.from('player_picks').select('gameweek_id, participants(name), players(name, position, teams(name, fifa_code))'),
        supabase.from('gameweeks').select('*').order('week_number'),
      ])
      if (picksRes.error) { setError(picksRes.error.message); setLoading(false); return }
      const meta = {}
      for (const gw of gwRes.data||[]) meta[gw.id] = gw.week_number || gw.id
      setGwMeta(meta)
      const grouped = {}
      for (const row of picksRes.data||[]) {
        const gwId = row.gameweek_id
        if (!grouped[gwId]) grouped[gwId] = []
        grouped[gwId].push({ participant:row.participants?.name??'—', player:row.players?.name??'—', position:row.players?.position??'—', team:row.players?.teams?.name??'—', fifa:row.players?.teams?.fifa_code??'' })
      }
      setPicks(grouped)
      const ids = Object.keys(grouped)
      if (ids.length) setActiveGw(ids[ids.length-1])
      setLoading(false)
    })()
  }, [])
  if (loading) return <Spinner />
  if (error)   return <EmptyState icon="⚠️" message={`Error: ${error}`} />
  if (!Object.keys(picks).length) return <EmptyState icon="⚽" message="No player picks yet." />
  const posColors = { FW:{bg:'#fee2e2',text:'#991b1b'}, MF:{bg:'#fef3c7',text:'#92400e'}, DF:{bg:'#dbeafe',text:'#1e40af'}, GK:{bg:'#f3f4f6',text:'#374151'} }
  const current = (picks[activeGw]||[]).sort((a,b)=>a.participant.localeCompare(b.participant))
  return (
    <div>
      <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:16 }}>
        {Object.keys(picks).map(gwId => { const active=gwId===activeGw; return <button key={gwId} onClick={()=>setActiveGw(gwId)} style={{ padding:'8px 18px', borderRadius:8, border:`1.5px solid ${active?C.green:C.border}`, background:active?C.green:C.white, color:active?C.white:C.muted, fontFamily:"'Barlow Condensed', sans-serif", fontWeight:600, fontSize:14, letterSpacing:'0.04em', cursor:'pointer' }}>GW {gwMeta[gwId]??gwId.slice(0,6)}</button> })}
      </div>
      <div style={S.cardScroll}>
        <table style={S.table}>
          <thead><tr><th style={S.th}>Participant</th><th style={S.th}>Player</th><th style={S.th}>Position</th><th style={S.th}>Team</th></tr></thead>
          <tbody>
            {current.map((row,i) => { const posKey=row.position?.slice(0,2).toUpperCase(); const posC=posColors[posKey]||{bg:'#f3f4f6',text:'#374151'}; return (
              <tr key={i} style={{ background:i%2?C.stripe:C.white }}>
                <td style={{ ...S.td, fontWeight:600 }}>{row.participant}</td>
                <td style={S.td}>{row.player}</td>
                <td style={S.td}><Badge colors={posC}>{row.position}</Badge></td>
                <td style={S.td}>{row.team}{row.fifa&&<span style={{ color:C.muted, marginLeft:6, fontSize:12 }}>({row.fifa})</span>}</td>
              </tr>
            )})}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Fixtures & Results ─────────────────────────────────────────────────────────
const STAGE_LABEL = { group:'Group Stage', r32:'Round of 32', r16:'Round of 16', qf:'Quarter-finals', sf:'Semi-finals', final:'Final' }
const STAGE_ORDER = { group:0, r32:1, r16:2, qf:3, sf:4, final:5 }

function Fixtures() {
  const [matches, setMatches] = useState([])
  const [ownerByTeam, setOwnerByTeam] = useState({})  // team name -> participant name
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [filter, setFilter] = useState('all') // all | results | upcoming

  const load = useCallback(async (silent=false) => {
    if (!silent) setLoading(true)
    const [mRes, ownRes] = await Promise.all([
      supabase
        .from('matches')
        .select('id, home_team, away_team, home_score, away_score, status, stage, match_date')
        .order('match_date'),
      supabase
        .from('participant_teams')
        .select('teams(name), participants(name)'),
    ])
    if (mRes.error) { setError(mRes.error.message); setLoading(false); return }
    // Build team-name -> owner-name map
    const owners = {}
    ;(ownRes.data || []).forEach(r => {
      const tn = r.teams?.name
      const pn = r.participants?.name
      if (tn && pn) owners[tn] = pn
    })
    setOwnerByTeam(owners)
    setMatches(mRes.data || [])
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
    const iv = setInterval(() => load(true), REFRESH_INTERVAL)
    return () => clearInterval(iv)
  }, [load])

  if (loading) return <Spinner />
  if (error)   return <EmptyState icon="⚠️" message={`Error: ${error}`} />
  if (!matches.length) return <EmptyState icon="📅" message="No fixtures yet. They'll appear once synced." />

  const isFinished = m => m.status === 'FINISHED' || (m.home_score != null && m.away_score != null)
  const shown = matches.filter(m =>
    filter === 'all' ? true : filter === 'results' ? isFinished(m) : !isFinished(m)
  )

  const newestFirst = filter === 'results'  // results show most recent at the top

  const byStage = {}
  for (const m of shown) {
    const st = m.stage || 'group'
    if (!byStage[st]) byStage[st] = []
    byStage[st].push(m)
  }
  // Within each stage, order matches by date (newest first for results, else oldest first)
  for (const st in byStage) {
    byStage[st].sort((a,b) => {
      const da = a.match_date ? new Date(a.match_date).getTime() : 0
      const db = b.match_date ? new Date(b.match_date).getTime() : 0
      return newestFirst ? db - da : da - db
    })
  }
  // Stage order: for results, show the latest stages first (Final → Group); otherwise Group → Final
  const stages = Object.keys(byStage).sort((a,b) => {
    const oa = STAGE_ORDER[a] ?? 9, ob = STAGE_ORDER[b] ?? 9
    return newestFirst ? ob - oa : oa - ob
  })

  const fmtDate = d => d ? new Date(d).toLocaleDateString([], { month:'short', day:'numeric' }) : ''
  const fmtTime = d => d ? new Date(d).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' }) : ''

  const filterBtn = (key, label) => {
    const active = filter === key
    return <button onClick={()=>setFilter(key)} style={{ padding:'7px 16px', borderRadius:8, border:`1.5px solid ${active?C.green:C.border}`, background:active?C.green:C.white, color:active?C.white:C.muted, fontFamily:"'Barlow Condensed', sans-serif", fontWeight:600, fontSize:14, letterSpacing:'0.04em', cursor:'pointer' }}>{label}</button>
  }

  return (
    <div>
      <div className="filter-row" style={{ display:'flex', gap:8, marginBottom:16 }}>
        {filterBtn('all','All')}{filterBtn('results','Results')}{filterBtn('upcoming','Upcoming')}
      </div>
      {stages.map(st => (
        <div key={st} style={{ marginBottom:22 }}>
          <div style={{ fontFamily:"'Barlow Condensed', sans-serif", fontWeight:700, fontSize:15, color:C.green, letterSpacing:'0.08em', textTransform:'uppercase', marginBottom:8 }}>
            {STAGE_LABEL[st] || st}
          </div>
          <div style={S.cardScroll}>
            <table style={S.table}>
              <tbody>
                {byStage[st].map((m,i) => {
                  const fin = isFinished(m)
                  const homeWin = fin && m.home_score > m.away_score
                  const awayWin = fin && m.away_score > m.home_score
                  const homeOwner = ownerByTeam[m.home_team]
                  const awayOwner = ownerByTeam[m.away_team]
                  return (
                    <tr key={m.id} style={{ background:i%2?C.stripe:C.white }}>
                      <td style={{ ...S.td, width:70, color:C.muted, fontSize:12, whiteSpace:'nowrap' }}>
                        {fmtDate(m.match_date)}<br/><span style={{ fontSize:11 }}>{fmtTime(m.match_date)}</span>
                      </td>
                      <td style={{ ...S.td, textAlign:'right', fontWeight:homeWin?700:500, width:'40%' }}>
                        {m.home_team || '—'}
                        {homeOwner && <span style={{ display:'block', fontSize:11, color:C.green, fontWeight:600 }}>({homeOwner})</span>}
                      </td>
                      <td style={{ ...S.td, textAlign:'center', width:70 }}>
                        {fin
                          ? <span style={{ fontFamily:"'Barlow Condensed', sans-serif", fontWeight:700, fontSize:17 }}>{m.home_score}–{m.away_score}</span>
                          : <span style={{ color:C.muted, fontSize:12 }}>v</span>}
                      </td>
                      <td style={{ ...S.td, textAlign:'left', fontWeight:awayWin?700:500, width:'40%' }}>
                        {m.away_team || '—'}
                        {awayOwner && <span style={{ display:'block', fontSize:11, color:C.green, fontWeight:600 }}>({awayOwner})</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      {!shown.length && <EmptyState icon="📅" message="Nothing to show for this filter yet." />}
    </div>
  )
}

// ── Goalscorer Leaderboard ──────────────────────────────────────────────────────
function Goalscorers() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async (silent=false) => {
    if (!silent) setLoading(true)
    // Read cumulative goals straight off the players table (paginated past the 1000 cap)
    let from = 0, all = []
    while (true) {
      const { data, error } = await supabase
        .from('players')
        .select('id, name, position, total_goals, teams(name, fifa_code)')
        .gt('total_goals', 0)
        .order('total_goals', { ascending: false })
        .range(from, from+999)
      if (error) { setError(error.message); setLoading(false); return }
      if (!data || !data.length) break
      all = all.concat(data)
      if (data.length < 1000) break
      from += 1000
    }
    const list = all
      .map(p => ({ name:p.name, position:p.position||'—', team:p.teams?.name||'—', fifa:p.teams?.fifa_code||'', goals:Number(p.total_goals)||0 }))
      .filter(p => p.goals > 0)
      .sort((a,b)=>b.goals-a.goals)
    setRows(list)
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
    const iv = setInterval(() => load(true), REFRESH_INTERVAL)
    return () => clearInterval(iv)
  }, [load])

  if (loading) return <Spinner />
  if (error)   return <EmptyState icon="⚠️" message={`Error: ${error}`} />
  if (!rows.length) return <EmptyState icon="👟" message="No goals yet. The Golden Boot race starts at kickoff." />

  const podium = ['#e8b84b','#9ca3af','#cd7f32']
  return (
    <div style={S.cardScroll}>
      <table style={S.table}>
        <thead>
          <tr>
            <th style={{ ...S.th, width:52, textAlign:'center' }}>#</th>
            <th style={S.th}>Player</th>
            <th style={S.th}>Team</th>
            <th style={{ ...S.th, textAlign:'right' }}>Goals</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row,i) => (
            <tr key={row.name+i} style={{ background:i%2?C.stripe:C.white }}>
              <td style={{ ...S.td, textAlign:'center' }}>
                <span style={{ display:'inline-flex', alignItems:'center', justifyContent:'center', width:28, height:28, borderRadius:'50%', background:i<3?podium[i]+'22':'transparent', color:i<3?podium[i]:C.muted, fontFamily:"'Barlow Condensed', sans-serif", fontWeight:700, fontSize:15 }}>{i+1}</span>
              </td>
              <td style={{ ...S.td, fontWeight:600 }}>{row.name}</td>
              <td style={S.td}>{row.team}{row.fifa&&<span style={{ color:C.muted, marginLeft:6, fontSize:12 }}>({row.fifa})</span>}</td>
              <td style={{ ...S.td, textAlign:'right', fontWeight:700, fontFamily:"'Barlow Condensed', sans-serif", fontSize:18, color:i===0?C.goldDim:'#111827' }}>{row.goals}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Public page ────────────────────────────────────────────────────────────────
const TABS = [
  { label:'Leaderboard', icon:'🏆' },
  { label:'Fixtures', icon:'📅' },
  { label:'Goalscorers', icon:'👟' },
  { label:'Team Ownership', icon:'🌍' },
  { label:'Weekly Picks', icon:'⚽' },
]

export default function Public() {
  const [tab, setTab] = useState(0)
  useEffect(() => {
    const link = document.createElement('link'); link.rel='stylesheet'; link.href='https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700;800&family=Outfit:wght@400;500;600&display=swap'; document.head.appendChild(link)
    document.body.style.margin='0'; document.body.style.background=C.cream
  }, [])
  return (
    <div style={{ minHeight:'100vh', background:C.cream }}>
      <ResponsiveStyles />
      <header style={{ background:C.dark, paddingBottom:0 }}>
        <div className="pub-head" style={{ maxWidth:960, margin:'0 auto', padding:'28px 20px 0' }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:10, flexWrap:'wrap' }}>
            <div style={{ display:'flex', alignItems:'center', gap:14, marginBottom:4 }}>
              <span style={{ fontSize:28 }}>⚽</span>
              <div>
                <h1 style={{ margin:0, fontFamily:"'Barlow Condensed', sans-serif", fontWeight:800, fontSize:'clamp(20px, 5vw, 32px)', color:C.white, lineHeight:1.1 }}>World Cup Sweepstake</h1>
                <p style={{ margin:0, fontFamily:"'Outfit', sans-serif", fontSize:12, color:'#6ee7b7', letterSpacing:'0.05em', textTransform:'uppercase' }}>The Rift WC 2026</p>
              </div>
            </div>
            <div style={{ display:'flex', alignItems:'center', gap:10 }}>
              <Link to="/admin" style={{ fontFamily:"'Outfit', sans-serif", fontSize:12, color:'rgba(255,255,255,0.35)', textDecoration:'none' }}>Admin</Link>
            </div>
          </div>
          <nav className="tab-nav">
            {TABS.map((t,i) => { const active=tab===i; return <button key={t.label} onClick={()=>setTab(i)} style={{ padding:'10px 18px', border:'none', borderRadius:'8px 8px 0 0', background:active?C.cream:'transparent', color:active?C.dark:'rgba(255,255,255,0.55)', fontFamily:"'Barlow Condensed', sans-serif", fontWeight:700, fontSize:'clamp(13px, 2vw, 15px)', letterSpacing:'0.06em', textTransform:'uppercase', cursor:'pointer', display:'flex', alignItems:'center', gap:6 }}><span>{t.icon}</span> {t.label}</button> })}
          </nav>
        </div>
      </header>
      <main className="pub-main" style={{ maxWidth:960, margin:'0 auto', padding:'24px 20px 48px' }}>
        {tab===0&&<Leaderboard/>}{tab===1&&<Fixtures/>}{tab===2&&<Goalscorers/>}{tab===3&&<TeamOwnership/>}{tab===4&&<WeeklyPicks/>}
      </main>
    </div>
  )
}