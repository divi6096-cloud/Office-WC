import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'

const C = {
  dark: '#0d1f0f', green: '#1a4a20', gold: '#e8b84b', goldDim: '#c49a30',
  cream: '#faf7f0', white: '#ffffff', muted: '#6b7280', border: '#e5e7eb',
  stripe: '#f9fafb',
  paid:  { bg: '#d1fae5', text: '#065f46' },
  free:  { bg: '#f3f4f6', text: '#374151' },
  poolA: { bg: '#fef3c7', text: '#92400e' },
  poolB: { bg: '#dbeafe', text: '#1e40af' },
  poolC: { bg: '#dcfce7', text: '#166534' },
}

const S = {
  card:  { background: C.white, borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.08)', overflow: 'hidden' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 14 },
  th: {
    padding: '10px 16px', textAlign: 'left', background: '#f8fafc',
    color: C.muted, fontFamily: "'Barlow Condensed', sans-serif",
    fontWeight: 600, fontSize: 13, letterSpacing: '0.06em',
    textTransform: 'uppercase', borderBottom: `2px solid ${C.border}`,
  },
  td: {
    padding: '13px 16px', borderBottom: `1px solid ${C.border}`,
    verticalAlign: 'middle', color: '#111827', fontFamily: "'Outfit', sans-serif",
  },
  badge: {
    display: 'inline-block', padding: '3px 10px', borderRadius: 99,
    fontSize: 12, fontWeight: 600, fontFamily: "'Outfit', sans-serif",
  },
  empty:   { padding: '56px 24px', textAlign: 'center', color: C.muted, fontFamily: "'Outfit', sans-serif", fontSize: 14 },
  loading: { padding: '56px 24px', textAlign: 'center', color: C.muted, fontFamily: "'Outfit', sans-serif", fontSize: 14 },
}

function Badge({ children, colors }) {
  return <span style={{ ...S.badge, background: colors.bg, color: colors.text }}>{children}</span>
}
function EmptyState({ icon, message }) {
  return <div style={S.empty}><div style={{ fontSize: 32, marginBottom: 12 }}>{icon}</div><div>{message}</div></div>
}
function Spinner() { return <div style={S.loading}>Loading…</div> }

// ── Leaderboard ────────────────────────────────────────────────────────────────
function Leaderboard() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from('participant_scores')
        .select('participant_id, player_points, team_points, total_points, participants(name, paid)')
      if (error) { setError(error.message); setLoading(false); return }
      const map = {}
      for (const row of data || []) {
        const id = row.participant_id
        if (!map[id]) map[id] = { name: row.participants?.name ?? '—', paid: row.participants?.paid ?? false, team_points: 0, player_points: 0, total_points: 0 }
        map[id].team_points   += Number(row.team_points)   || 0
        map[id].player_points += Number(row.player_points) || 0
        map[id].total_points  += Number(row.total_points)  || 0
      }
      setRows(Object.values(map).sort((a, b) => b.total_points - a.total_points))
      setLoading(false)
    })()
  }, [])

  if (loading) return <Spinner />
  if (error)   return <EmptyState icon="⚠️" message={`Error: ${error}`} />
  if (!rows.length) return <EmptyState icon="🏆" message="No scores yet. Leaderboard populates once matches kick off." />

  const podium = ['#e8b84b', '#9ca3af', '#cd7f32']

  return (
    <div style={S.card}>
      <table style={S.table}>
        <thead>
          <tr>
            <th style={{ ...S.th, width: 52, textAlign: 'center' }}>#</th>
            <th style={S.th}>Name</th>
            <th style={S.th}>Status</th>
            <th style={{ ...S.th, textAlign: 'right' }}>Team pts</th>
            <th style={{ ...S.th, textAlign: 'right' }}>Pick pts</th>
            <th style={{ ...S.th, textAlign: 'right' }}>Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.name} style={{ background: i % 2 ? C.stripe : C.white }}>
              <td style={{ ...S.td, textAlign: 'center' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, borderRadius: '50%', background: i < 3 ? podium[i] + '22' : 'transparent', color: i < 3 ? podium[i] : C.muted, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 15 }}>
                  {i + 1}
                </span>
              </td>
              <td style={{ ...S.td, fontWeight: 600 }}>{row.name}</td>
              <td style={S.td}><Badge colors={row.paid ? C.paid : C.free}>{row.paid ? 'Paid' : 'Free'}</Badge></td>
              <td style={{ ...S.td, textAlign: 'right', color: C.muted }}>{row.team_points.toFixed(1)}</td>
              <td style={{ ...S.td, textAlign: 'right', color: C.muted }}>{row.player_points.toFixed(1)}</td>
              <td style={{ ...S.td, textAlign: 'right', fontWeight: 700, fontFamily: "'Barlow Condensed', sans-serif", fontSize: 18, color: i === 0 ? C.goldDim : '#111827' }}>
                {row.total_points.toFixed(1)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Team Ownership ─────────────────────────────────────────────────────────────
function TeamOwnership() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from('participant_teams')
        .select('pool, participant_id, participants(name, paid), teams(name, fifa_code)')
      if (error) { setError(error.message); setLoading(false); return }
      const map = {}
      for (const row of data || []) {
        const id = row.participant_id
        if (!map[id]) map[id] = { name: row.participants?.name ?? '—', paid: row.participants?.paid ?? false, teams: [] }
        map[id].teams.push({ pool: row.pool, name: row.teams?.name ?? '—', fifa: row.teams?.fifa_code ?? '' })
      }
      setRows(Object.values(map).sort((a, b) => a.name.localeCompare(b.name)).map(r => ({ ...r, teams: r.teams.sort((a, b) => a.pool.localeCompare(b.pool)) })))
      setLoading(false)
    })()
  }, [])

  if (loading) return <Spinner />
  if (error)   return <EmptyState icon="⚠️" message={`Error: ${error}`} />
  if (!rows.length) return <EmptyState icon="🌍" message="No team assignments yet. Run the draw in the admin panel." />

  const poolColors = { A: C.poolA, B: C.poolB, C: C.poolC }

  return (
    <div style={S.card}>
      <table style={S.table}>
        <thead>
          <tr>
            <th style={S.th}>Participant</th>
            <th style={S.th}>Status</th>
            <th style={S.th}>Pool A</th>
            <th style={S.th}>Pool B</th>
            <th style={S.th}>Pool C</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const byPool = { A: [], B: [], C: [] }
            row.teams.forEach(t => { if (byPool[t.pool]) byPool[t.pool].push(t) })
            return (
              <tr key={row.name} style={{ background: i % 2 ? C.stripe : C.white }}>
                <td style={{ ...S.td, fontWeight: 600 }}>{row.name}</td>
                <td style={S.td}><Badge colors={row.paid ? C.paid : C.free}>{row.paid ? 'Paid' : 'Free'}</Badge></td>
                {['A', 'B', 'C'].map(pool => (
                  <td key={pool} style={S.td}>
                    {byPool[pool].length
                      ? byPool[pool].map(t => <Badge key={t.name} colors={poolColors[pool] || C.free}>{t.name}{t.fifa ? ` · ${t.fifa}` : ''}</Badge>)
                      : <span style={{ color: C.muted, fontSize: 13 }}>—</span>}
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
  const [picks, setPicks] = useState({})
  const [gwMeta, setGwMeta] = useState({})
  const [activeGw, setActiveGw] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    (async () => {
      const [picksRes, gwRes] = await Promise.all([
        supabase.from('player_picks').select('gameweek_id, participants(name), players(name, position, teams(name, fifa_code))'),
        supabase.from('gameweeks').select('*').order('week_number'),
      ])
      if (picksRes.error) { setError(picksRes.error.message); setLoading(false); return }

      const meta = {}
      for (const gw of gwRes.data || []) meta[gw.id] = gw.week_number || gw.id
      setGwMeta(meta)

      const grouped = {}
      for (const row of picksRes.data || []) {
        const gwId = row.gameweek_id
        if (!grouped[gwId]) grouped[gwId] = []
        grouped[gwId].push({
          participant: row.participants?.name ?? '—',
          player:      row.players?.name ?? '—',
          position:    row.players?.position ?? '—',
          team:        row.players?.teams?.name ?? '—',
          fifa:        row.players?.teams?.fifa_code ?? '',
        })
      }
      setPicks(grouped)
      const ids = Object.keys(grouped)
      if (ids.length) setActiveGw(ids[ids.length - 1])
      setLoading(false)
    })()
  }, [])

  if (loading) return <Spinner />
  if (error)   return <EmptyState icon="⚠️" message={`Error: ${error}`} />
  if (!Object.keys(picks).length) return <EmptyState icon="⚽" message="No player picks yet." />

  const posColors = {
    FW: { bg: '#fee2e2', text: '#991b1b' }, MF: { bg: '#fef3c7', text: '#92400e' },
    DF: { bg: '#dbeafe', text: '#1e40af' }, GK: { bg: '#f3f4f6', text: '#374151' },
  }
  const current = (picks[activeGw] || []).sort((a, b) => a.participant.localeCompare(b.participant))

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        {Object.keys(picks).map(gwId => {
          const active = gwId === activeGw
          return (
            <button key={gwId} onClick={() => setActiveGw(gwId)} style={{ padding: '8px 18px', borderRadius: 8, border: `1.5px solid ${active ? C.green : C.border}`, background: active ? C.green : C.white, color: active ? C.white : C.muted, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 600, fontSize: 14, letterSpacing: '0.04em', cursor: 'pointer' }}>
              GW {gwMeta[gwId] ?? gwId.slice(0, 6)}
            </button>
          )
        })}
      </div>
      <div style={S.card}>
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.th}>Participant</th>
              <th style={S.th}>Player</th>
              <th style={S.th}>Position</th>
              <th style={S.th}>Team</th>
            </tr>
          </thead>
          <tbody>
            {current.map((row, i) => {
              const posKey = row.position?.slice(0, 2).toUpperCase()
              const posC = posColors[posKey] || { bg: '#f3f4f6', text: '#374151' }
              return (
                <tr key={i} style={{ background: i % 2 ? C.stripe : C.white }}>
                  <td style={{ ...S.td, fontWeight: 600 }}>{row.participant}</td>
                  <td style={S.td}>{row.player}</td>
                  <td style={S.td}><Badge colors={posC}>{row.position}</Badge></td>
                  <td style={S.td}>{row.team}{row.fifa && <span style={{ color: C.muted, marginLeft: 6, fontSize: 12 }}>({row.fifa})</span>}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Public page ────────────────────────────────────────────────────────────────
const TABS = [
  { label: 'Leaderboard',    icon: '🏆' },
  { label: 'Team Ownership', icon: '🌍' },
  { label: 'Weekly Picks',   icon: '⚽' },
]

export default function Public() {
  const [tab, setTab] = useState(0)

  useEffect(() => {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = 'https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700;800&family=Outfit:wght@400;500;600&display=swap'
    document.head.appendChild(link)
    document.body.style.margin = '0'
    document.body.style.background = C.cream
  }, [])

  return (
    <div style={{ minHeight: '100vh', background: C.cream }}>
      <header style={{ background: C.dark, color: C.white, paddingBottom: 0 }}>
        <div style={{ maxWidth: 960, margin: '0 auto', padding: '28px 20px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 4 }}>
              <span style={{ fontSize: 28 }}>⚽</span>
              <div>
                <h1 style={{ margin: 0, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 'clamp(22px, 5vw, 32px)', color: C.white, lineHeight: 1.1 }}>
                  World Cup Sweepstake
                </h1>
                <p style={{ margin: 0, fontFamily: "'Outfit', sans-serif", fontSize: 13, color: '#6ee7b7', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                  The Rift WC 2026
                </p>
              </div>
            </div>
            <Link to="/admin" style={{ fontFamily: "'Outfit', sans-serif", fontSize: 12, color: 'rgba(255,255,255,0.35)', textDecoration: 'none' }}>
              Admin
            </Link>
          </div>
          <nav style={{ display: 'flex', gap: 4, marginTop: 20 }}>
            {TABS.map((t, i) => {
              const active = tab === i
              return (
                <button key={t.label} onClick={() => setTab(i)} style={{ padding: '10px 18px', border: 'none', borderRadius: '8px 8px 0 0', background: active ? C.cream : 'transparent', color: active ? C.dark : 'rgba(255,255,255,0.55)', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 'clamp(13px, 2vw, 15px)', letterSpacing: '0.06em', textTransform: 'uppercase', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span>{t.icon}</span> {t.label}
                </button>
              )
            })}
          </nav>
        </div>
      </header>
      <main style={{ maxWidth: 960, margin: '0 auto', padding: '24px 20px 48px' }}>
        {tab === 0 && <Leaderboard />}
        {tab === 1 && <TeamOwnership />}
        {tab === 2 && <WeeklyPicks />}
      </main>
    </div>
  )
}
