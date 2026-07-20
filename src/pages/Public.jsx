import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'

const C = {
  dark:'#1a1a2e', green:'#16213e', gold:'#e8b84b', goldDim:'#c49a30',
  cream:'#f5f5f5', white:'#ffffff', muted:'#6b7280', border:'#e5e7eb', stripe:'#f9fafb',
  paid:{bg:'#d1fae5',text:'#065f46'}, free:{bg:'#f3f4f6',text:'#374151'},
  poolA:{bg:'#fef3c7',text:'#92400e'}, poolB:{bg:'#dbeafe',text:'#1e40af'}, poolC:{bg:'#dcfce7',text:'#166534'},
}
const S = {
  card:{background:C.white,borderRadius:12,boxShadow:'0 1px 3px rgba(0,0,0,0.08)',overflowX:'auto',WebkitOverflowScrolling:'touch'},
  table:{width:'100%',minWidth:480,borderCollapse:'collapse',fontSize:14},
  th:{padding:'10px 16px',textAlign:'left',background:'#f8fafc',color:C.muted,fontFamily:"'Barlow Condensed', sans-serif",fontWeight:600,fontSize:13,letterSpacing:'0.06em',textTransform:'uppercase',borderBottom:`2px solid ${C.border}`},
  td:{padding:'13px 16px',borderBottom:`1px solid ${C.border}`,verticalAlign:'middle',color:'#111827',fontFamily:"'Outfit', sans-serif"},
  badge:{display:'inline-block',padding:'3px 10px',borderRadius:99,fontSize:12,fontWeight:600,fontFamily:"'Outfit', sans-serif"},
  empty:{padding:'56px 24px',textAlign:'center',color:C.muted,fontFamily:"'Outfit', sans-serif",fontSize:14},
}
function Badge({ children, colors }) { return <span style={{ ...S.badge, background:colors.bg, color:colors.text }}>{children}</span> }
function EmptyState({ icon, msg }) { return <div style={S.empty}><div style={{ fontSize:32, marginBottom:12 }}>{icon}</div>{msg}</div> }
function Spinner() { return <div style={S.empty}>Loading…</div> }

const REFRESH_MS = 30000

const STAGE_ORDER = ['group','r32','r16','qf','sf','final']
const STAGE_LABEL = { group:'Group Stage', r32:'Round of 32', r16:'Round of 16', qf:'Quarter-finals', sf:'Semi-finals', final:'Final' }
const STAGE_MAP = { GROUP_STAGE:'group', LAST_32:'r32', ROUND_OF_32:'r32', R32:'r32', LAST_16:'r16', ROUND_OF_16:'r16', QUARTER_FINALS:'qf', SEMI_FINALS:'sf', FINAL:'final', '3RD_PLACE_MATCH':'third' }
function score120(sc) {
  if (!sc) return { home:null, away:null, pens:false }
  const ft=sc.fullTime||{}, pen=sc.penalties||{}, reg=sc.regularTime||{}, et=sc.extraTime||{}
  const pens = pen.home!=null && pen.away!=null
  if (reg.home!=null && reg.away!=null) return { home:(reg.home||0)+(et.home||0), away:(reg.away||0)+(et.away||0), pens }
  return { home:ft.home??null, away:ft.away??null, pens }
}
function apiStageToGW(stage, matchday) {
  if (stage==='GROUP_STAGE') return matchday||1
  return { LAST_32:4, ROUND_OF_32:4, R32:4, LAST_16:5, ROUND_OF_16:5, QUARTER_FINALS:6, SEMI_FINALS:7, FINAL:8, '3RD_PLACE_MATCH':8 }[stage] ?? 9
}
async function callAPI(endpoint) {
  const res = await fetch(`/football-api?endpoint=${encodeURIComponent(endpoint)}`)
  const json = await res.json()
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
  return json
}

// ── Shared scoring (mirrors Admin calculateAllScores) ──
async function calculateAllScores(settings) {
  const [{ data: participants }, { data: ptRows }, { data: matches }, { data: gwRows }] = await Promise.all([
    supabase.from('participants').select('id'),
    supabase.from('participant_teams').select('participant_id, team_id, pool, teams(name)'),
    supabase.from('matches').select('*').eq('status','FINISHED'),
    supabase.from('gameweeks').select('id, week_number').order('week_number'),
  ])
  const gwByWeekNum = Object.fromEntries((gwRows||[]).map(g=>[g.week_number,g]))
  const teamPoolMult = { A:1.0, B:Number(settings.pool_b_team_mult)||1.5, C:Number(settings.pool_c_team_mult)||2.0 }
  const stageWinPts = { group:Number(settings.points_group_win)||2, r32:Number(settings.points_r32_win)||3, r16:Number(settings.points_r16_win)||5, qf:Number(settings.points_qf_win)||8, sf:Number(settings.points_sf_win)||13, final:Number(settings.points_winner)||20, third:Number(settings.points_third)||3 }
  const qualifyPts = Number(settings.points_qualify)||3
  const goalPts = Number(settings.points_goal ?? 1)
  const drawPts = Number(settings.points_draw ?? 1)
  const upserts = []
  for (const p of participants||[]) {
    const myTeams = (ptRows||[]).filter(r=>r.participant_id===p.id)
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
        const wentToPens = m.went_to_penalties === true
        let pts = 0
        if (!wentToPens && myScore>oppScore) pts += (stageWinPts[m.stage]??0)*tmult
        else if (wentToPens || myScore===oppScore) pts += drawPts*tmult
        pts += (Number(myScore)||0)*goalPts*tmult
        if (['r32','r16','qf','sf','final','third'].includes(m.stage)&&!qualifyGiven.has(mt.team_id)) {
          pts += qualifyPts*tmult; qualifyGiven.add(mt.team_id)
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

function buildRows(matches) {
  return (matches||[]).map(m=>{ const s=score120(m.score); return ({ id:m.id, gameweek:apiStageToGW(m.stage,m.matchday), stage:STAGE_MAP[m.stage]||m.stage?.toLowerCase()||'group', home_team:m.homeTeam?.name||'—', away_team:m.awayTeam?.name||'—', home_score:s.home, away_score:s.away, went_to_penalties:s.pens, status:m.status||'SCHEDULED', kickoff:m.utcDate||null }) })
}

// Throttled public sync: matches + goalscorers + calculate, with shared cooldown
async function publicSyncAndCalculate({ cooldownMinutes=30, onProgress=()=>{} } = {}) {
  const { data: settings } = await supabase.from('settings').select('*').eq('id',1).single()
  const last = settings?.last_synced_at ? new Date(settings.last_synced_at) : null
  const now = new Date()
  if (last) {
    const mins = (now-last)/60000
    if (mins < cooldownMinutes) return { ran:false, reason:'cooldown', minsAgo:Math.floor(mins), cooldownMinutes }
  }
  onProgress('Fetching fixtures and scores…')
  const data = await callAPI('competitions/WC/matches?season=2026')
  const allMatches = data.matches||[]
  if (allMatches.length) {
    await supabase.from('matches').upsert(buildRows(allMatches),{onConflict:'id'})
  }
  onProgress('Updating goalscorers…')
  try {
    const sc = await callAPI('competitions/WC/scorers?season=2026&limit=100')
    const scorers = (sc.scorers||[]).map(s=>({ api_id:s.player?.id, name:s.player?.name||'—', team_name:s.team?.name||'—', goals:s.goals??0, updated_at:new Date().toISOString() })).filter(s=>s.api_id)
    if (scorers.length) await supabase.from('goalscorers').upsert(scorers,{onConflict:'api_id'})
  } catch(_) { /* non-fatal */ }
  onProgress('Calculating scores…')
  await calculateAllScores(settings)
  await supabase.from('settings').update({ last_synced_at: now.toISOString() }).eq('id',1)
  const finished = allMatches.filter(m=>m.status==='FINISHED').length
  return { ran:true, matches:allMatches.length, finished }
}

function Leaderboard() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState('')

  const load = useCallback(async (silent=false) => {
    if (!silent) setLoading(true); else setRefreshing(true)
    const [{ data: all }, { data: scores }] = await Promise.all([
      supabase.from('participants').select('id, name, paid'),
      supabase.from('participant_scores').select('participant_id, pool_a_points, pool_b_points, pool_c_points, total_points'),
    ])
    const map = {}
    for (const p of all||[]) map[p.id] = { name:p.name, paid:p.paid, a:0, b:0, c:0, total:0 }
    for (const s of scores||[]) {
      if (map[s.participant_id]) {
        map[s.participant_id].a     += Number(s.pool_a_points) || 0
        map[s.participant_id].b     += Number(s.pool_b_points) || 0
        map[s.participant_id].c     += Number(s.pool_c_points) || 0
        map[s.participant_id].total += Number(s.total_points)  || 0
      }
    }
    setRows(Object.values(map).sort((a,b) => b.total - a.total))
    setLastUpdated(new Date()); setLoading(false); setRefreshing(false)
  }, [])

  async function updateScores() {
    setSyncing(true); setSyncMsg('Checking for updates…')
    try {
      const res = await publicSyncAndCalculate({ cooldownMinutes:30, onProgress:(m)=>setSyncMsg(m) })
      if (!res.ran && res.reason==='cooldown') {
        const wait = res.cooldownMinutes - res.minsAgo
        setSyncMsg(`Already updated ${res.minsAgo} min ago — try again in ~${wait} min.`)
        await load(true)
      } else {
        setSyncMsg(`✓ Updated — ${res.matches} matches (${res.finished} finished).`)
        await load(true)
      }
    } catch(e) { setSyncMsg(`✗ ${e.message}`) }
    setSyncing(false)
    setTimeout(()=>setSyncMsg(''), 6000)
  }

  useEffect(() => {
    load()
    const t = setInterval(() => load(true), REFRESH_MS)
    return () => clearInterval(t)
  }, [load])

  if (loading) return <Spinner />
  if (!rows.length) return <EmptyState icon="🏆" msg="No participants yet." />

  const podium = ['#e8b84b','#9ca3af','#cd7f32']
  const poolCell = { ...S.td, textAlign:'right', color:C.muted, fontFamily:"'Barlow Condensed', sans-serif", fontSize:16 }
  return (
    <div>
      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:14, flexWrap:'wrap' }}>
        <button onClick={updateScores} disabled={syncing} style={{ background:syncing?C.goldDim:C.green, color:C.white, border:'none', borderRadius:8, padding:'10px 18px', fontFamily:"'Barlow Condensed', sans-serif", fontWeight:700, fontSize:15, letterSpacing:'0.04em', cursor:syncing?'wait':'pointer', display:'flex', alignItems:'center', gap:8 }}>
          {syncing ? '⏳ Updating…' : '🔄 Update Scores'}
        </button>
        {syncMsg && <span style={{ fontFamily:"'Outfit', sans-serif", fontSize:13, color: syncMsg.startsWith('✓')?'#16a34a':syncMsg.startsWith('✗')?C.red:C.muted }}>{syncMsg}</span>}
      </div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:8, marginBottom:10 }}>
        <span style={{ fontFamily:"'Outfit', sans-serif", fontSize:12, color:C.muted }}>Auto-refreshes every 30s · tap Update Scores for latest results</span>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          {refreshing && <span style={{ fontFamily:"'Outfit', sans-serif", fontSize:12, color:C.gold }}>Updating…</span>}
          {lastUpdated && <span style={{ fontFamily:"'Outfit', sans-serif", fontSize:12, color:C.muted }}>Updated {lastUpdated.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'})}</span>}
        </div>
      </div>
      <div style={S.card}>
        <table style={S.table}>
          <thead><tr>
            <th style={{ ...S.th, width:52, textAlign:'center' }}>#</th>
            <th style={S.th}>Name</th>
            <th style={{ ...S.th, textAlign:'right' }}>Pool A</th>
            <th style={{ ...S.th, textAlign:'right' }}>Pool B</th>
            <th style={{ ...S.th, textAlign:'right' }}>Pool C</th>
            <th style={{ ...S.th, textAlign:'right' }}>Total</th>
          </tr></thead>
          <tbody>
            {rows.map((row,i) => (
              <tr key={row.name} style={{ background:i%2?C.stripe:C.white }}>
                <td style={{ ...S.td, textAlign:'center' }}>
                  <span style={{ display:'inline-flex', alignItems:'center', justifyContent:'center', width:28, height:28, borderRadius:'50%', background:i<3?podium[i]+'22':'transparent', color:i<3?podium[i]:C.muted, fontFamily:"'Barlow Condensed', sans-serif", fontWeight:700, fontSize:15 }}>{i+1}</span>
                </td>
                <td style={{ ...S.td, fontWeight:600 }}>
                  {row.name}
                  <span style={{ marginLeft:8, verticalAlign:'middle' }}><Badge colors={row.paid?C.paid:C.free}>{row.paid?'Paid':'Free'}</Badge></span>
                </td>
                <td style={poolCell}>{row.a.toFixed(1)}</td>
                <td style={poolCell}>{row.b.toFixed(1)}</td>
                <td style={poolCell}>{row.c.toFixed(1)}</td>
                <td style={{ ...S.td, textAlign:'right', fontWeight:700, fontFamily:"'Barlow Condensed', sans-serif", fontSize:20, color:i===0&&row.total>0?C.goldDim:'#111827' }}>
                  {row.total.toFixed(1)}
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

function ScoringFAQ() {
  const [open, setOpen] = useState(false)
  const [s, setS] = useState(null)
  useEffect(() => { supabase.from('settings').select('*').eq('id',1).single().then(({data})=>setS(data||{})) }, [])
  const v = (k, d) => (s && s[k]!=null ? s[k] : d)
  const row = (label, val) => (
    <div style={{ display:'flex', justifyContent:'space-between', padding:'5px 0', borderBottom:`1px solid ${C.border}`, fontSize:13.5 }}>
      <span style={{ color:'#374151' }}>{label}</span><span style={{ fontWeight:700, color:C.green }}>{val}</span>
    </div>
  )
  const faqH = { fontFamily:"'Barlow Condensed', sans-serif", fontSize:15, fontWeight:700, color:C.dark, margin:'18px 0 6px', letterSpacing:'0.03em' }
  return (
    <div style={{ marginTop:18 }}>
      <button onClick={()=>setOpen(o=>!o)} style={{ width:'100%', background:C.white, border:`1px solid ${C.border}`, borderRadius:10, padding:'13px 16px', display:'flex', justifyContent:'space-between', alignItems:'center', cursor:'pointer', fontFamily:"'Barlow Condensed', sans-serif", fontWeight:700, fontSize:15, letterSpacing:'0.04em', color:C.dark, textTransform:'uppercase' }}>
        <span>📖 How points work</span><span style={{ color:C.muted, fontSize:18 }}>{open?'−':'+'}</span>
      </button>
      {open && (
        <div style={{ background:C.white, border:`1px solid ${C.border}`, borderTop:'none', borderRadius:'0 0 10px 10px', padding:'4px 18px 18px', fontFamily:"'Outfit', sans-serif", color:'#374151', fontSize:14, lineHeight:1.6 }}>
          <p style={{ marginTop:14 }}>Everyone owns <strong>three teams</strong> — one from each pool (A strongest, B middle, C weakest). Your score is the points your three teams earn, each multiplied by its pool multiplier.</p>
          <h4 style={faqH}>Points your teams earn — per match</h4>
          {row('Group-stage win', `${v('points_group_win',2)} pts`)}
          {row('Qualify from group (bonus)', `${v('points_qualify',3)} pts`)}
          {row('Round of 32 win', `${v('points_r32_win',3)} pts`)}
          {row('Round of 16 win', `${v('points_r16_win',5)} pts`)}
          {row('Quarter-final win', `${v('points_qf_win',8)} pts`)}
          {row('Semi-final win', `${v('points_sf_win',13)} pts`)}
          {row('Final win (champions)', `${v('points_winner',20)} pts`)}
          {row('Each goal your team scores', `${v('points_goal',1)} pt`)}
          {row('Draw', `${v('points_draw',1)} pt`)}
          <h4 style={faqH}>Pool multipliers</h4>
          <p style={{ margin:'2px 0 8px' }}>Every point a team earns is multiplied by its pool:</p>
          {row('Pool A team', `× 1.0`)}
          {row('Pool B team', `× ${v('pool_b_team_mult',1.5)}`)}
          {row('Pool C team', `× ${v('pool_c_team_mult',2)}`)}
          <h4 style={faqH}>A worked example</h4>
          <p style={{ margin:'2px 0', background:C.cream, padding:'10px 12px', borderRadius:8 }}>
            Your Pool C team wins a group game 3–1:<br/>
            ({v('points_group_win',2)} win + 3 goals × {v('points_goal',1)}) × {v('pool_c_team_mult',2)} = <strong>{((Number(v('points_group_win',2)) + 3*Number(v('points_goal',1))) * Number(v('pool_c_team_mult',2))).toFixed(0)} pts</strong>
          </p>
          <p style={{ marginTop:12, fontSize:12.5, color:C.muted }}>Tap <strong>Update Scores</strong> at the top to pull the latest results (available every 30 minutes).</p>
        </div>
      )}
    </div>
  )
}

function TeamOwnership() {
  const [rows, setRows] = useState([]); const [loading, setLoading] = useState(true)
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('participant_teams').select('pool, participant_id, participants(name, paid), teams(name, fifa_code)')
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
  if (!rows.length) return <EmptyState icon="🌍" msg="No team assignments yet." />
  const poolColors = { A:C.poolA, B:C.poolB, C:C.poolC }
  return (
    <div style={S.card}>
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
                    {byPool[pool].length ? byPool[pool].map(t=><Badge key={t.name} colors={poolColors[pool]||C.free}>{t.name}{t.fifa?` · ${t.fifa}`:''}</Badge>)
                      : <span style={{ color:C.muted, fontSize:13 }}>—</span>}
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

function Fixtures() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [filter, setFilter] = useState('all')

  const load = useCallback(async (silent=false) => {
    if (!silent) setLoading(true); else setRefreshing(true)
    const { data } = await supabase.from('matches').select('*').order('kickoff')
    setRows(data||[]); setLoading(false); setRefreshing(false)
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(() => load(true), REFRESH_MS)
    return () => clearInterval(t)
  }, [load])

  if (loading) return <Spinner />
  if (!rows.length) return <EmptyState icon="📅" msg="No fixtures yet." />

  const isDone = m => m.status==='FINISHED' || m.home_score!=null
  const filtered = rows.filter(m => filter==='all' ? true : filter==='results' ? isDone(m) : !isDone(m))
  const newestFirst = filter==='results'
  const byStage = {}
  for (const m of filtered) { const s=m.stage||'group'; (byStage[s]=byStage[s]||[]).push(m) }
  for (const st in byStage) byStage[st].sort((a,b)=>{ const da=a.kickoff?new Date(a.kickoff).getTime():0, db=b.kickoff?new Date(b.kickoff).getTime():0; return newestFirst?db-da:da-db })
  const stages = newestFirst ? [...STAGE_ORDER].reverse() : STAGE_ORDER
  const fmt = d => d ? new Date(d).toLocaleString('en-ZA',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}) : 'TBD'

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12, flexWrap:'wrap', gap:8 }}>
        <div style={{ display:'flex', gap:4 }}>
          {[['all','All'],['results','Results'],['upcoming','Upcoming']].map(([k,label]) => (
            <button key={k} onClick={()=>setFilter(k)} style={{ padding:'5px 14px', borderRadius:6, border:`1px solid ${C.border}`, background:filter===k?C.dark:C.white, color:filter===k?C.white:C.muted, fontFamily:"'Outfit', sans-serif", fontSize:13, fontWeight:600, cursor:'pointer' }}>{label}</button>
          ))}
        </div>
        {refreshing && <span style={{ fontFamily:"'Outfit', sans-serif", fontSize:12, color:C.gold }}>Updating…</span>}
      </div>
      {stages.filter(s=>byStage[s]?.length).map(stage => (
        <div key={stage} style={{ marginBottom:20 }}>
          <div style={{ fontFamily:"'Barlow Condensed', sans-serif", fontWeight:700, fontSize:15, textTransform:'uppercase', letterSpacing:'0.06em', color:C.muted, margin:'4px 4px 8px' }}>{STAGE_LABEL[stage]||stage}</div>
          <div style={S.card}>
            <table style={S.table}>
              <tbody>
                {byStage[stage].map((m,i) => {
                  const done=isDone(m)
                  const homeWin=done&&m.home_score>m.away_score, awayWin=done&&m.away_score>m.home_score
                  return (
                    <tr key={m.id} style={{ background:i%2?C.stripe:C.white }}>
                      <td style={{ ...S.td, color:C.muted, fontSize:12, width:118, whiteSpace:'nowrap' }}>{fmt(m.kickoff)}</td>
                      <td style={{ ...S.td, textAlign:'right', fontWeight:homeWin?700:500 }}>{m.home_team}</td>
                      <td style={{ ...S.td, textAlign:'center', width:64, fontFamily:"'Barlow Condensed', sans-serif", fontWeight:700, fontSize:16, color:done?'#111827':C.muted }}>{done?`${m.home_score} – ${m.away_score}`:'v'}</td>
                      <td style={{ ...S.td, fontWeight:awayWin?700:500 }}>{m.away_team}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  )
}

function Goalscorers() {
  const [rows, setRows] = useState([]); const [loading, setLoading] = useState(true)
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('goalscorers').select('name, team_name, goals').order('goals',{ascending:false})
      setRows((data||[]).filter(r=>Number(r.goals)>0))
      setLoading(false)
    })()
  }, [])
  if (loading) return <Spinner />
  if (!rows.length) return <EmptyState icon="👟" msg="No goals yet — check back once matches kick off." />

  const podium = ['#e8b84b','#9ca3af','#cd7f32']
  return (
    <div style={S.card}>
      <table style={S.table}>
        <thead><tr>
          <th style={{ ...S.th, width:52, textAlign:'center' }}>#</th>
          <th style={S.th}>Player</th>
          <th style={S.th}>Team</th>
          <th style={{ ...S.th, textAlign:'right' }}>Goals</th>
        </tr></thead>
        <tbody>
          {rows.map((row,i) => (
            <tr key={row.name+i} style={{ background:i%2?C.stripe:C.white }}>
              <td style={{ ...S.td, textAlign:'center' }}>
                <span style={{ display:'inline-flex', alignItems:'center', justifyContent:'center', width:28, height:28, borderRadius:'50%', background:i<3?podium[i]+'22':'transparent', color:i<3?podium[i]:C.muted, fontFamily:"'Barlow Condensed', sans-serif", fontWeight:700, fontSize:15 }}>{i+1}</span>
              </td>
              <td style={{ ...S.td, fontWeight:600 }}>{row.name}</td>
              <td style={{ ...S.td, color:C.muted }}>{row.team_name}</td>
              <td style={{ ...S.td, textAlign:'right', fontWeight:700, fontFamily:"'Barlow Condensed', sans-serif", fontSize:20 }}>{row.goals}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const TABS = [
  { label:'Leaderboard', icon:'🏆' },
  { label:'Fixtures', icon:'📅' },
  { label:'Goalscorers', icon:'👟' },
  { label:'Team Ownership', icon:'🌍' },
]

export default function Public() {
  const [tab, setTab] = useState(0)
  useEffect(() => {
    const link = document.createElement('link'); link.rel='stylesheet'
    link.href='https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700;800&family=Outfit:wght@400;500;600&display=swap'
    document.head.appendChild(link); document.body.style.margin='0'; document.body.style.background=C.cream
    if (!document.querySelector('meta[name="viewport"]')) {
      const vp = document.createElement('meta'); vp.name='viewport'
      vp.content='width=device-width, initial-scale=1'
      document.head.appendChild(vp)
    }
  }, [])
  return (
    <div style={{ minHeight:'100vh', background:C.cream }}>
      <header style={{ background:C.dark, paddingBottom:0 }}>
        <div style={{ maxWidth:960, margin:'0 auto', padding:'28px 20px 0' }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
            <div style={{ display:'flex', alignItems:'center', gap:14, marginBottom:4 }}>
              <span style={{ fontSize:28 }}>⚽</span>
              <div>
                <h1 style={{ margin:0, fontFamily:"'Barlow Condensed', sans-serif", fontWeight:800, fontSize:'clamp(22px,5vw,32px)', color:C.white, lineHeight:1.1 }}>World Cup Sweepstake</h1>
                <p style={{ margin:0, fontFamily:"'Outfit', sans-serif", fontSize:13, color:'#6ee7b7', letterSpacing:'0.05em', textTransform:'uppercase' }}>Office WC 2026</p>
              </div>
            </div>
            <Link to="/admin" style={{ fontFamily:"'Outfit', sans-serif", fontSize:12, color:'rgba(255,255,255,0.35)', textDecoration:'none' }}>Admin</Link>
          </div>
          <nav style={{ display:'flex', gap:4, marginTop:20, overflowX:'auto', flexWrap:'nowrap', scrollbarWidth:'none' }}>
            {TABS.map((t,i) => { const active=tab===i; return <button key={t.label} onClick={()=>setTab(i)} style={{ padding:'10px 18px', border:'none', borderRadius:'8px 8px 0 0', background:active?C.cream:'transparent', color:active?C.dark:'rgba(255,255,255,0.55)', fontFamily:"'Barlow Condensed', sans-serif", fontWeight:700, fontSize:'clamp(13px,2vw,15px)', letterSpacing:'0.06em', textTransform:'uppercase', cursor:'pointer', display:'flex', alignItems:'center', gap:6, whiteSpace:'nowrap', flexShrink:0 }}><span>{t.icon}</span> {t.label}</button> })}
          </nav>
        </div>
      </header>
      <main style={{ maxWidth:960, margin:'0 auto', padding:'24px 20px 48px' }}>
        {tab===0&&<Leaderboard/>}{tab===1&&<Fixtures/>}{tab===2&&<Goalscorers/>}{tab===3&&<TeamOwnership/>}
      </main>
    </div>
  )
}
