import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'

const C = {
  dark:'#0d1f0f', green:'#1a4a20', gold:'#e8b84b', goldDim:'#c49a30',
  cream:'#faf7f0', white:'#ffffff', muted:'#6b7280', border:'#e5e7eb', stripe:'#f9fafb', red:'#dc2626',
}
const inp = { padding:'10px 14px', border:`1px solid ${C.border}`, borderRadius:8, fontFamily:"'Outfit', sans-serif", fontSize:15, outline:'none', background:C.white, color:'#111827', width:'100%', boxSizing:'border-box' }
const btn = (v='primary') => ({ padding:'12px 20px', borderRadius:8, border:'none', cursor:'pointer', fontFamily:"'Barlow Condensed', sans-serif", fontWeight:700, fontSize:16, letterSpacing:'0.06em', textTransform:'uppercase', background:v==='primary'?C.green:'#f1f5f9', color:v==='ghost'?C.muted:C.white, width:'100%' })

function MultiplierBadge({ mult, pool, teamName }) {
  if (!pool) return <span style={{ fontFamily:"'Outfit', sans-serif", fontSize:13, color:C.muted }}>No boost (not your team)</span>
  const colors = { A:{ bg:'#fef3c7', text:'#92400e' }, B:{ bg:'#dbeafe', text:'#1e40af' }, C:{ bg:'#dcfce7', text:'#166534' } }
  const c = colors[pool] || colors.A
  return (
    <span style={{ display:'inline-flex', alignItems:'center', gap:6 }}>
      <span style={{ background:c.bg, color:c.text, padding:'3px 10px', borderRadius:99, fontSize:13, fontWeight:700, fontFamily:"'Barlow Condensed', sans-serif" }}>{mult}× Pool {pool}</span>
      <span style={{ fontFamily:"'Outfit', sans-serif", fontSize:13, color:C.muted }}>— {teamName} is your team</span>
    </span>
  )
}

export default function PickPage() {
  const [participants, setParticipants] = useState([])
  const [selectedId, setSelectedId] = useState('')
  const [myTeams, setMyTeams] = useState([])
  const [players, setPlayers] = useState([])
  const [currentPick, setCurrentPick] = useState(null)
  const [selectedPlayer, setSelectedPlayer] = useState(null)
  const [playerSearch, setPlayerSearch] = useState('')
  const [showResults, setShowResults] = useState(false)
  const [settings, setSettings] = useState(null)
  const [currentGw, setCurrentGw] = useState(null)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(true)

  // Initial load
  useEffect(() => {
    (async () => {
      const [p, s, pl] = await Promise.all([
        supabase.from('participants').select('id, name').order('name'),
        supabase.from('settings').select('*').eq('id', 1).single(),
        supabase.from('players').select('id, name, team_id, teams(id, name)').order('name'),
      ])
      setParticipants(p.data || [])
      setSettings(s.data)
      setPlayers(pl.data || [])

      if (s.data?.current_gameweek) {
        const { data: gw } = await supabase.from('gameweeks').select('*').eq('week_number', s.data.current_gameweek).maybeSingle()
        setCurrentGw(gw)
      }
      setLoading(false)
    })()
  }, [])

  // Load participant's teams + current pick when selection changes
  useEffect(() => {
    if (!selectedId || !currentGw) return
    setCurrentPick(null); setSelectedPlayer(null); setPlayerSearch('')
    ;(async () => {
      const [teams, pick] = await Promise.all([
        supabase.from('participant_teams').select('team_id, pool, teams(id, name)').eq('participant_id', selectedId),
        supabase.from('player_picks').select('player_id, players(id, name, team_id, teams(name))').eq('participant_id', selectedId).eq('gameweek_id', currentGw.id).maybeSingle(),
      ])
      setMyTeams(teams.data || [])
      if (pick.data) {
        setCurrentPick(pick.data)
        setSelectedPlayer(pick.data.players)
        setPlayerSearch(pick.data.players?.name || '')
      }
    })()
  }, [selectedId, currentGw])

  function getMultiplier(player) {
    if (!player || !settings) return { mult: 1, pool: null, teamName: null }
    const myTeam = myTeams.find(t => t.team_id === player.team_id)
    if (!myTeam) return { mult: 1, pool: null, teamName: null }
    const multMap = { A: settings.team_a_multiplier, B: settings.team_b_multiplier, C: settings.team_c_multiplier }
    return { mult: multMap[myTeam.pool] || 1, pool: myTeam.pool, teamName: myTeam.teams?.name }
  }

  async function savePick() {
    if (!selectedId || !selectedPlayer || !currentGw) return
    setSaving(true); setStatus('')
    const { error } = await supabase.from('player_picks').upsert(
      { participant_id: selectedId, gameweek_id: currentGw.id, player_id: selectedPlayer.id },
      { onConflict: 'participant_id,gameweek_id' }
    )
    if (error) { setStatus(`✗ ${error.message}`) }
    else { setCurrentPick({ player_id: selectedPlayer.id, players: selectedPlayer }); setStatus('✓ Pick saved!'); setTimeout(() => setStatus(''), 4000) }
    setSaving(false)
  }

  const multInfo = selectedPlayer ? getMultiplier(selectedPlayer) : null
  const filteredPlayers = playerSearch.length >= 2
    ? players.filter(p => p.name.toLowerCase().includes(playerSearch.toLowerCase())).slice(0, 12)
    : []

  const fmtDate = d => d ? new Date(d).toLocaleDateString('en-ZA', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' }) : null
  const gwDeadline = currentGw?.starts_at ? fmtDate(currentGw.starts_at) : null
  const isLocked = currentGw?.starts_at ? new Date() > new Date(currentGw.starts_at) : false

  useEffect(() => {
    const link = document.createElement('link'); link.rel='stylesheet'
    link.href='https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700;800&family=Outfit:wght@400;500;600&display=swap'
    document.head.appendChild(link); document.body.style.margin='0'; document.body.style.background=C.cream
  }, [])

  return (
    <div style={{ minHeight:'100vh', background:C.cream }}>
      {/* Header */}
      <header style={{ background:C.dark, paddingBottom:0 }}>
        <div style={{ maxWidth:600, margin:'0 auto', padding:'24px 20px' }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
            <div style={{ display:'flex', alignItems:'center', gap:12 }}>
              <span style={{ fontSize:24 }}>⚽</span>
              <div>
                <h1 style={{ margin:0, fontFamily:"'Barlow Condensed', sans-serif", fontWeight:800, fontSize:26, color:'#fff', lineHeight:1.1 }}>Player Picks</h1>
                <p style={{ margin:0, fontFamily:"'Outfit', sans-serif", fontSize:12, color:'#6ee7b7', letterSpacing:'0.05em', textTransform:'uppercase' }}>The Rift WC 2026</p>
              </div>
            </div>
            <Link to="/" style={{ fontFamily:"'Outfit', sans-serif", fontSize:13, color:'rgba(255,255,255,0.5)', textDecoration:'none' }}>← Leaderboard</Link>
          </div>
        </div>
      </header>

      <main style={{ maxWidth:600, margin:'0 auto', padding:'24px 20px 48px' }}>
        {loading ? (
          <div style={{ padding:48, textAlign:'center', color:C.muted, fontFamily:"'Outfit', sans-serif" }}>Loading…</div>
        ) : !currentGw ? (
          <div style={{ background:C.white, borderRadius:12, padding:32, textAlign:'center', fontFamily:"'Outfit', sans-serif", color:C.muted }}>
            No active gameweek. Check back once the admin has set the current gameweek.
          </div>
        ) : (
          <>
            {/* Gameweek banner */}
            <div style={{ background:C.white, borderRadius:12, padding:'16px 20px', marginBottom:16, boxShadow:'0 1px 3px rgba(0,0,0,0.08)', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
              <div>
                <div style={{ fontFamily:"'Barlow Condensed', sans-serif", fontSize:22, fontWeight:700, color:C.dark }}>Gameweek {currentGw.week_number}</div>
                {gwDeadline && <div style={{ fontFamily:"'Outfit', sans-serif", fontSize:13, color:C.muted, marginTop:2 }}>Deadline: {gwDeadline}</div>}
              </div>
              {isLocked
                ? <span style={{ background:'#fee2e2', color:'#991b1b', padding:'4px 14px', borderRadius:99, fontSize:13, fontWeight:600, fontFamily:"'Outfit', sans-serif" }}>Locked</span>
                : <span style={{ background:'#d1fae5', color:'#065f46', padding:'4px 14px', borderRadius:99, fontSize:13, fontWeight:600, fontFamily:"'Outfit', sans-serif" }}>Open</span>
              }
            </div>

            {/* Step 1: Who are you */}
            <div style={{ background:C.white, borderRadius:12, padding:20, marginBottom:16, boxShadow:'0 1px 3px rgba(0,0,0,0.08)' }}>
              <div style={{ fontFamily:"'Barlow Condensed', sans-serif", fontWeight:700, fontSize:15, letterSpacing:'0.06em', textTransform:'uppercase', marginBottom:10, color:C.muted }}>Step 1 — Who are you?</div>
              <select value={selectedId} onChange={e => setSelectedId(e.target.value)} style={inp}>
                <option value="">Select your name…</option>
                {participants.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>

            {/* Step 2: Pick your player */}
            {selectedId && (
              <div style={{ background:C.white, borderRadius:12, padding:20, marginBottom:16, boxShadow:'0 1px 3px rgba(0,0,0,0.08)' }}>
                <div style={{ fontFamily:"'Barlow Condensed', sans-serif", fontWeight:700, fontSize:15, letterSpacing:'0.06em', textTransform:'uppercase', marginBottom:4, color:C.muted }}>Step 2 — Pick your player</div>
                <div style={{ fontFamily:"'Outfit', sans-serif", fontSize:13, color:C.muted, marginBottom:12 }}>
                  Your teams: {myTeams.map((t, i) => <span key={t.team_id}>{i > 0 ? ' · ' : ''}<strong>{t.teams?.name}</strong> (Pool {t.pool})</span>)}
                </div>

                {/* Player search */}
                <div style={{ position:'relative' }}>
                  <input
                    value={playerSearch}
                    onChange={e => { setPlayerSearch(e.target.value); setShowResults(true) }}
                    onFocus={() => setShowResults(true)}
                    placeholder="Search player name… (type at least 2 letters)"
                    style={inp}
                    disabled={isLocked}
                  />
                  {showResults && filteredPlayers.length > 0 && (
                    <div style={{ position:'absolute', top:'100%', left:0, right:0, background:C.white, border:`1px solid ${C.border}`, borderRadius:8, boxShadow:'0 4px 16px rgba(0,0,0,0.1)', zIndex:50, maxHeight:280, overflowY:'auto' }}>
                      {filteredPlayers.map(p => {
                        const m = getMultiplier(p)
                        return (
                          <div key={p.id} onClick={() => { setSelectedPlayer(p); setPlayerSearch(p.name); setShowResults(false) }}
                            style={{ padding:'10px 16px', cursor:'pointer', borderBottom:`1px solid ${C.stripe}`, display:'flex', alignItems:'center', justifyContent:'space-between' }}
                            onMouseEnter={e => e.currentTarget.style.background=C.stripe}
                            onMouseLeave={e => e.currentTarget.style.background=C.white}
                          >
                            <div>
                              <div style={{ fontFamily:"'Outfit', sans-serif", fontWeight:600, fontSize:14 }}>{p.name}</div>
                              <div style={{ fontFamily:"'Outfit', sans-serif", fontSize:12, color:C.muted }}>{p.teams?.name || '—'}</div>
                            </div>
                            {m.pool && <span style={{ fontFamily:"'Barlow Condensed', sans-serif", fontWeight:700, fontSize:14, color:m.pool==='C'?'#166534':m.pool==='B'?'#1e40af':'#92400e' }}>{m.mult}×</span>}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>

                {/* Selected player summary */}
                {selectedPlayer && (
                  <div style={{ marginTop:14, padding:'14px 16px', borderRadius:8, background: multInfo?.pool ? '#f0fdf4' : C.stripe, border:`1px solid ${multInfo?.pool ? '#bbf7d0' : C.border}` }}>
                    <div style={{ fontFamily:"'Outfit', sans-serif", fontWeight:600, fontSize:15 }}>{selectedPlayer.name}</div>
                    <div style={{ fontFamily:"'Outfit', sans-serif", fontSize:13, color:C.muted, marginTop:2 }}>{selectedPlayer.teams?.name || '—'}</div>
                    <div style={{ marginTop:8 }}>
                      {multInfo && <MultiplierBadge mult={multInfo.mult} pool={multInfo.pool} teamName={multInfo.teamName} />}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Current pick info */}
            {selectedId && currentPick && (
              <div style={{ background:C.white, borderRadius:12, padding:20, marginBottom:16, boxShadow:'0 1px 3px rgba(0,0,0,0.08)' }}>
                <div style={{ fontFamily:"'Barlow Condensed', sans-serif", fontWeight:700, fontSize:15, letterSpacing:'0.06em', textTransform:'uppercase', marginBottom:8, color:C.muted }}>Current GW{currentGw.week_number} pick</div>
                <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                  <div style={{ fontSize:24 }}>⚽</div>
                  <div>
                    <div style={{ fontFamily:"'Outfit', sans-serif", fontWeight:600, fontSize:16 }}>{currentPick.players?.name || '—'}</div>
                    <div style={{ fontFamily:"'Outfit', sans-serif", fontSize:13, color:C.muted }}>{currentPick.players?.teams?.name || '—'}</div>
                  </div>
                </div>
              </div>
            )}

            {/* Save button */}
            {selectedId && selectedPlayer && !isLocked && (
              <button onClick={savePick} disabled={saving} style={{ ...btn(), opacity:saving?0.6:1 }}>
                {saving ? 'Saving…' : currentPick ? `Update GW${currentGw.week_number} Pick` : `Save GW${currentGw.week_number} Pick`}
              </button>
            )}

            {isLocked && selectedId && (
              <div style={{ background:'#fee2e2', borderRadius:10, padding:'14px 18px', fontFamily:"'Outfit', sans-serif", fontSize:14, color:'#991b1b', textAlign:'center' }}>
                Gameweek {currentGw.week_number} is locked — picks can no longer be changed.
              </div>
            )}

            {status && (
              <div style={{ marginTop:12, padding:'12px 16px', borderRadius:8, fontFamily:"'Outfit', sans-serif", fontSize:14, background:status.startsWith('✓')?'#d1fae5':'#fee2e2', color:status.startsWith('✓')?'#065f46':'#991b1b', textAlign:'center' }}>{status}</div>
            )}
          </>
        )}
      </main>
    </div>
  )
}
