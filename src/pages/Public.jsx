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
  card:{background:C.white,borderRadius:12,boxShadow:'0 1px 3px rgba(0,0,0,0.08)',overflow:'hidden'},
  table:{width:'100%',borderCollapse:'collapse',fontSize:14},
  th:{padding:'10px 16px',textAlign:'left',background:'#f8fafc',color:C.muted,fontFamily:"'Barlow Condensed', sans-serif",fontWeight:600,fontSize:13,letterSpacing:'0.06em',textTransform:'uppercase',borderBottom:`2px solid ${C.border}`},
  td:{padding:'13px 16px',borderBottom:`1px solid ${C.border}`,verticalAlign:'middle',color:'#111827',fontFamily:"'Outfit', sans-serif"},
  badge:{display:'inline-block',padding:'3px 10px',borderRadius:99,fontSize:12,fontWeight:600,fontFamily:"'Outfit', sans-serif"},
  empty:{padding:'56px 24px',textAlign:'center',color:C.muted,fontFamily:"'Outfit', sans-serif",fontSize:14},
}
function Badge({ children, colors }) { return <span style={{ ...S.badge, background:colors.bg, color:colors.text }}>{children}</span> }
function EmptyState({ icon, msg }) { return <div style={S.empty}><div style={{ fontSize:32, marginBottom:12 }}>{icon}</div>{msg}</div> }
function Spinner() { return <div style={S.empty}>Loading…</div> }

const REFRESH_MS = 30000

function Leaderboard() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState(null)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async (silent=false) => {
    if (!silent) setLoading(true); else setRefreshing(true)
    const [{ data: all }, { data: scores }] = await Promise.all([
      supabase.from('participants').select('id, name, paid'),
      supabase.from('participant_scores').select('participant_id, team_points, total_points'),
    ])
    const map = {}
    for (const p of all||[]) map[p.id] = { name:p.name, paid:p.paid, team_points:0, total_points:0 }
    for (const s of scores||[]) {
      if (map[s.participant_id]) {
        map[s.participant_id].team_points  += Number(s.team_points)  || 0
        map[s.participant_id].total_points += Number(s.total_points) || 0
      }
    }
    setRows(Object.values(map).sort((a,b) => b.total_points - a.total_points))
    setLastUpdated(new Date()); setLoading(false); setRefreshing(false)
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(() => load(true), REFRESH_MS)
    return () => clearInterval(t)
  }, [load])

  if (loading) return <Spinner />
  if (!rows.length) return <EmptyState icon="🏆" msg="No participants yet." />

  const podium = ['#e8b84b','#9ca3af','#cd7f32']
  return (
    <div>
      <div style={{ display:'flex', justifyContent:'flex-end', alignItems:'center', gap:8, marginBottom:10 }}>
        {refreshing && <span style={{ fontFamily:"'Outfit', sans-serif", fontSize:12, color:C.gold }}>Updating…</span>}
        {lastUpdated && <span style={{ fontFamily:"'Outfit', sans-serif", fontSize:12, color:C.muted }}>Updated {lastUpdated.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'})}</span>}
        <button onClick={()=>load(true)} style={{ background:'transparent', border:`1px solid ${C.border}`, borderRadius:6, padding:'4px 10px', fontFamily:"'Outfit', sans-serif", fontSize:12, cursor:'pointer', color:C.muted }}>↻</button>
      </div>
      <div style={S.card}>
        <table style={S.table}>
          <thead><tr>
            <th style={{ ...S.th, width:52, textAlign:'center' }}>#</th>
            <th style={S.th}>Name</th>
            <th style={S.th}>Status</th>
            <th style={{ ...S.th, textAlign:'right' }}>Points</th>
          </tr></thead>
          <tbody>
            {rows.map((row,i) => (
              <tr key={row.name} style={{ background:i%2?C.stripe:C.white }}>
                <td style={{ ...S.td, textAlign:'center' }}>
                  <span style={{ display:'inline-flex', alignItems:'center', justifyContent:'center', width:28, height:28, borderRadius:'50%', background:i<3?podium[i]+'22':'transparent', color:i<3?podium[i]:C.muted, fontFamily:"'Barlow Condensed', sans-serif", fontWeight:700, fontSize:15 }}>{i+1}</span>
                </td>
                <td style={{ ...S.td, fontWeight:600 }}>{row.name}</td>
                <td style={S.td}><Badge colors={row.paid?C.paid:C.free}>{row.paid?'Paid':'Free'}</Badge></td>
                <td style={{ ...S.td, textAlign:'right', fontWeight:700, fontFamily:"'Barlow Condensed', sans-serif", fontSize:20, color:i===0&&row.total_points>0?C.goldDim:'#111827' }}>
                  {row.total_points.toFixed(1)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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

const TABS = [{ label:'Leaderboard', icon:'🏆' }, { label:'Team Ownership', icon:'🌍' }]

export default function Public() {
  const [tab, setTab] = useState(0)
  useEffect(() => {
    const link = document.createElement('link'); link.rel='stylesheet'
    link.href='https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700;800&family=Outfit:wght@400;500;600&display=swap'
    document.head.appendChild(link); document.body.style.margin='0'; document.body.style.background=C.cream
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
          <nav style={{ display:'flex', gap:4, marginTop:20 }}>
            {TABS.map((t,i) => { const active=tab===i; return <button key={t.label} onClick={()=>setTab(i)} style={{ padding:'10px 18px', border:'none', borderRadius:'8px 8px 0 0', background:active?C.cream:'transparent', color:active?C.dark:'rgba(255,255,255,0.55)', fontFamily:"'Barlow Condensed', sans-serif", fontWeight:700, fontSize:'clamp(13px,2vw,15px)', letterSpacing:'0.06em', textTransform:'uppercase', cursor:'pointer', display:'flex', alignItems:'center', gap:6 }}><span>{t.icon}</span> {t.label}</button> })}
          </nav>
        </div>
      </header>
      <main style={{ maxWidth:960, margin:'0 auto', padding:'24px 20px 48px' }}>
        {tab===0&&<Leaderboard/>}{tab===1&&<TeamOwnership/>}
      </main>
    </div>
  )
}
