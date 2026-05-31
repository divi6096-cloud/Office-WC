import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'

// ── Config ─────────────────────────────────────────────────────────────────────
// Set VITE_ADMIN_PASSWORD in Netlify env vars to change the password.
const ADMIN_PASSWORD = import.meta.env.VITE_ADMIN_PASSWORD || 'rift2026'

const STAGE_MAP = {
  GROUP_STAGE: 'group',
  LAST_16: 'r16', ROUND_OF_16: 'r16',
  QUARTER_FINALS: 'qf',
  SEMI_FINALS: 'sf',
  FINAL: 'final',
  '3RD_PLACE_MATCH': 'final',
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

// ── Shared styles ──────────────────────────────────────────────────────────────
const C = {
  dark: '#0d1f0f', green: '#1a4a20', gold: '#e8b84b',
  cream: '#faf7f0', white: '#ffffff', muted: '#6b7280',
  border: '#e5e7eb', stripe: '#f9fafb', red: '#dc2626',
  danger: { bg: '#fee2e2', text: '#991b1b' },
}
const inp = {
  padding: '8px 12px', border: `1px solid ${C.border}`, borderRadius: 6,
  fontFamily: "'Outfit', sans-serif", fontSize: 14, outline: 'none',
  background: C.white, color: '#111827',
}
const btn = (variant = 'primary') => ({
  padding: '8px 16px', borderRadius: 6, border: 'none', cursor: 'pointer',
  fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700,
  fontSize: 14, letterSpacing: '0.06em', textTransform: 'uppercase',
  background: variant === 'primary' ? C.green : variant === 'danger' ? C.red : '#f1f5f9',
  color: variant === 'ghost' ? C.muted : C.white,
  opacity: 1,
})
const card = { background: C.white, borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.08)', overflow: 'hidden', marginBottom: 20 }
const th = { padding: '10px 16px', textAlign: 'left', background: '#f8fafc', color: C.muted, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 600, fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase', borderBottom: `2px solid ${C.border}` }
const td = { padding: '12px 16px', borderBottom: `1px solid ${C.border}`, verticalAlign: 'middle', color: '#111827', fontFamily: "'Outfit', sans-serif", fontSize: 14 }

function StatusMsg({ msg }) {
  if (!msg) return null
  const isErr = msg.startsWith('✗')
  const isOk  = msg.startsWith('✓')
  return (
    <div style={{ padding: '10px 14px', borderRadius: 8, marginTop: 10, fontFamily: "'Outfit', sans-serif", fontSize: 13, background: isErr ? '#fee2e2' : isOk ? '#d1fae5' : '#fef3c7', color: isErr ? '#991b1b' : isOk ? '#065f46' : '#92400e' }}>
      {msg}
    </div>
  )
}

// ── Section: Participants ──────────────────────────────────────────────────────
function Participants() {
  const [list, setList] = useState([])
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [paid, setPaid] = useState(true)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    const { data } = await supabase.from('participants').select('*').order('created_at')
    setList(data || [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function add() {
    if (!name.trim()) return
    setSaving(true)
    await supabase.from('participants').insert({ name: name.trim(), paid })
    setName(''); setPaid(true)
    await load()
    setSaving(false)
  }

  async function togglePaid(id, current) {
    await supabase.from('participants').update({ paid: !current }).eq('id', id)
    setList(l => l.map(p => p.id === id ? { ...p, paid: !current } : p))
  }

  async function remove(id) {
    if (!confirm('Delete this participant?')) return
    await supabase.from('participants').delete().eq('id', id)
    setList(l => l.filter(p => p.id !== id))
  }

  const paidCount = list.filter(p => p.paid).length
  const pot = paidCount * 100

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        {[['Total', list.length], ['Paid', paidCount], ['Free', list.length - paidCount], [`Pot`, `R${pot}`]].map(([k, v]) => (
          <div key={k} style={{ background: C.white, borderRadius: 10, padding: '14px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.07)', minWidth: 90, textAlign: 'center' }}>
            <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 26, fontWeight: 700, color: C.dark }}>{v}</div>
            <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: 12, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{k}</div>
          </div>
        ))}
      </div>

      <div style={{ ...card, padding: 20 }}>
        <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 16, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 12 }}>Add Participant</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} placeholder="Name" style={{ ...inp, flex: 1, minWidth: 160 }} />
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: "'Outfit', sans-serif", fontSize: 14, cursor: 'pointer' }}>
            <input type="checkbox" checked={paid} onChange={e => setPaid(e.target.checked)} style={{ width: 16, height: 16 }} />
            Paid (R100)
          </label>
          <button onClick={add} disabled={saving || !name.trim()} style={{ ...btn(), opacity: saving || !name.trim() ? 0.5 : 1 }}>
            Add
          </button>
        </div>
      </div>

      {loading ? <div style={{ padding: 32, textAlign: 'center', color: C.muted }}>Loading…</div> : (
        <div style={card}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead><tr>
              <th style={th}>Name</th>
              <th style={th}>Status</th>
              <th style={th}>Added</th>
              <th style={{ ...th, textAlign: 'right' }}>Actions</th>
            </tr></thead>
            <tbody>
              {list.map((p, i) => (
                <tr key={p.id} style={{ background: i % 2 ? C.stripe : C.white }}>
                  <td style={{ ...td, fontWeight: 600 }}>{p.name}</td>
                  <td style={td}>
                    <button onClick={() => togglePaid(p.id, p.paid)} style={{ ...btn(p.paid ? 'primary' : 'ghost'), padding: '4px 12px', fontSize: 12 }}>
                      {p.paid ? 'Paid' : 'Free'}
                    </button>
                  </td>
                  <td style={{ ...td, color: C.muted }}>{new Date(p.created_at).toLocaleDateString()}</td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    <button onClick={() => remove(p.id)} style={{ ...btn('danger'), padding: '4px 12px', fontSize: 12 }}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Section: Gameweeks ────────────────────────────────────────────────────────
function Gameweeks() {
  const [list, setList] = useState([])
  const [form, setForm] = useState({ week_number: '', starts_at: '', ends_at: '' })
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    const { data } = await supabase.from('gameweeks').select('*').order('week_number')
    setList(data || [])
  }, [])

  useEffect(() => { load() }, [load])

  async function create() {
    if (!form.week_number) return
    setSaving(true)
    await supabase.from('gameweeks').insert({
      week_number: Number(form.week_number),
      starts_at: form.starts_at || null,
      ends_at: form.ends_at || null,
    })
    setForm({ week_number: '', starts_at: '', ends_at: '' })
    await load()
    setSaving(false)
  }

  async function remove(id) {
    if (!confirm('Delete this gameweek?')) return
    await supabase.from('gameweeks').delete().eq('id', id)
    setList(l => l.filter(g => g.id !== id))
  }

  const fmtDate = d => d ? new Date(d).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' }) : '—'

  return (
    <div>
      <div style={{ ...card, padding: 20 }}>
        <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 16, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 12 }}>Create Gameweek</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input type="number" placeholder="Week #" value={form.week_number} onChange={e => setForm(f => ({ ...f, week_number: e.target.value }))} style={{ ...inp, width: 90 }} />
          <input type="date" value={form.starts_at} onChange={e => setForm(f => ({ ...f, starts_at: e.target.value }))} style={inp} />
          <input type="date" value={form.ends_at} onChange={e => setForm(f => ({ ...f, ends_at: e.target.value }))} style={inp} />
          <button onClick={create} disabled={saving || !form.week_number} style={{ ...btn(), opacity: saving || !form.week_number ? 0.5 : 1 }}>Create</button>
        </div>
      </div>

      <div style={card}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead><tr>
            <th style={th}>Week</th>
            <th style={th}>Starts</th>
            <th style={th}>Ends</th>
            <th style={{ ...th, textAlign: 'right' }}>Actions</th>
          </tr></thead>
          <tbody>
            {list.length === 0
              ? <tr><td colSpan={4} style={{ ...td, textAlign: 'center', color: C.muted }}>No gameweeks yet.</td></tr>
              : list.map((gw, i) => (
                <tr key={gw.id} style={{ background: i % 2 ? C.stripe : C.white }}>
                  <td style={{ ...td, fontWeight: 700, fontFamily: "'Barlow Condensed', sans-serif", fontSize: 18 }}>GW {gw.week_number}</td>
                  <td style={td}>{fmtDate(gw.starts_at)}</td>
                  <td style={td}>{fmtDate(gw.ends_at)}</td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    <button onClick={() => remove(gw.id)} style={{ ...btn('danger'), padding: '4px 12px', fontSize: 12 }}>Delete</button>
                  </td>
                </tr>
              ))
            }
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Section: Matches ───────────────────────────────────────────────────────────
function Matches() {
  const [list, setList] = useState([])
  const [pullStatus, setPullStatus] = useState('')
  const [pulling, setPulling] = useState(false)
  const [editId, setEditId] = useState(null)
  const [editScores, setEditScores] = useState({ home_score: '', away_score: '' })
  const [stageFilter, setStageFilter] = useState('all')
  const [gwFilter, setGwFilter] = useState('all')

  const load = useCallback(async () => {
    const { data } = await supabase.from('matches').select('*').order('gameweek').order('kickoff')
    setList(data || [])
  }, [])

  useEffect(() => { load() }, [load])

  async function pullFromAPI() {
    setPulling(true)
    setPullStatus('Fetching matches from football-data.org…')
    try {
      const data = await callAPI('competitions/WC/matches')
      const matches = data.matches || []
      if (!matches.length) { setPullStatus('✗ No matches returned — WC 2026 may not be available yet on the free tier.'); setPulling(false); return }

      const rows = matches.map(m => ({
        id: m.id,
        gameweek: apiStageToGW(m.stage, m.matchday),
        stage: STAGE_MAP[m.stage] || m.stage?.toLowerCase() || 'group',
        home_team: m.homeTeam?.name || m.homeTeam?.shortName || '—',
        away_team: m.awayTeam?.name || m.awayTeam?.shortName || '—',
        home_score: m.score?.fullTime?.home ?? null,
        away_score: m.score?.fullTime?.away ?? null,
        status: m.status || 'SCHEDULED',
        kickoff: m.utcDate || null,
      }))

      const { error } = await supabase.from('matches').upsert(rows, { onConflict: 'id' })
      if (error) throw new Error(error.message)

      await load()
      setPullStatus(`✓ ${rows.length} matches synced.`)
    } catch (e) {
      setPullStatus(`✗ ${e.message}`)
    }
    setPulling(false)
  }

  async function saveScore(id) {
    const { home_score, away_score } = editScores
    const update = {
      home_score: home_score === '' ? null : Number(home_score),
      away_score: away_score === '' ? null : Number(away_score),
      status: 'FINISHED',
    }
    await supabase.from('matches').update(update).eq('id', id)
    setList(l => l.map(m => m.id === id ? { ...m, ...update } : m))
    setEditId(null)
  }

  async function remove(id) {
    if (!confirm('Delete this match?')) return
    await supabase.from('matches').delete().eq('id', id)
    setList(l => l.filter(m => m.id !== id))
  }

  const stages = ['all', ...new Set(list.map(m => m.stage))]
  const gws = ['all', ...new Set(list.map(m => m.gameweek).filter(Boolean))].sort((a, b) => a === 'all' ? -1 : a - b)
  const visible = list.filter(m => (stageFilter === 'all' || m.stage === stageFilter) && (gwFilter === 'all' || m.gameweek == gwFilter))

  const stageLabel = { group: 'Group', r16: 'R16', qf: 'QF', sf: 'SF', final: 'Final' }
  const statusColor = { FINISHED: { bg: '#d1fae5', text: '#065f46' }, SCHEDULED: { bg: '#f1f5f9', text: '#374151' }, IN_PLAY: { bg: '#fef3c7', text: '#92400e' } }

  return (
    <div>
      <div style={{ ...card, padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 16, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Pull from API</div>
            <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: 12, color: C.muted, marginTop: 2 }}>Syncs all WC 2026 matches from football-data.org</div>
          </div>
          <button onClick={pullFromAPI} disabled={pulling} style={{ ...btn(), opacity: pulling ? 0.6 : 1 }}>
            {pulling ? 'Pulling…' : '⚡ Sync Matches'}
          </button>
        </div>
        <StatusMsg msg={pullStatus} />
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <select value={stageFilter} onChange={e => setStageFilter(e.target.value)} style={{ ...inp, padding: '6px 10px' }}>
          {stages.map(s => <option key={s} value={s}>{s === 'all' ? 'All stages' : stageLabel[s] || s}</option>)}
        </select>
        <select value={gwFilter} onChange={e => setGwFilter(e.target.value)} style={{ ...inp, padding: '6px 10px' }}>
          {gws.map(g => <option key={g} value={g}>{g === 'all' ? 'All GWs' : `GW ${g}`}</option>)}
        </select>
        <span style={{ fontFamily: "'Outfit', sans-serif", fontSize: 13, color: C.muted, alignSelf: 'center' }}>{visible.length} matches</span>
      </div>

      <div style={card}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead><tr>
            <th style={th}>GW</th>
            <th style={th}>Stage</th>
            <th style={th}>Home</th>
            <th style={{ ...th, textAlign: 'center' }}>Score</th>
            <th style={th}>Away</th>
            <th style={th}>Status</th>
            <th style={{ ...th, textAlign: 'right' }}>Actions</th>
          </tr></thead>
          <tbody>
            {visible.length === 0
              ? <tr><td colSpan={7} style={{ ...td, textAlign: 'center', color: C.muted }}>No matches. Pull from API or add manually.</td></tr>
              : visible.map((m, i) => {
                const sc = statusColor[m.status] || statusColor.SCHEDULED
                const editing = editId === m.id
                return (
                  <tr key={m.id} style={{ background: i % 2 ? C.stripe : C.white }}>
                    <td style={{ ...td, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700 }}>{m.gameweek ?? '—'}</td>
                    <td style={td}><span style={{ background: '#f1f5f9', color: C.muted, padding: '2px 8px', borderRadius: 4, fontSize: 12, fontWeight: 600 }}>{stageLabel[m.stage] || m.stage}</span></td>
                    <td style={{ ...td, fontWeight: 600 }}>{m.home_team}</td>
                    <td style={{ ...td, textAlign: 'center', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 16 }}>
                      {editing
                        ? <span style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
                            <input type="number" min="0" value={editScores.home_score} onChange={e => setEditScores(s => ({ ...s, home_score: e.target.value }))} style={{ ...inp, width: 48, padding: '4px 6px', textAlign: 'center' }} />
                            <span style={{ alignSelf: 'center' }}>–</span>
                            <input type="number" min="0" value={editScores.away_score} onChange={e => setEditScores(s => ({ ...s, away_score: e.target.value }))} style={{ ...inp, width: 48, padding: '4px 6px', textAlign: 'center' }} />
                          </span>
                        : (m.home_score != null ? `${m.home_score} – ${m.away_score}` : '– – –')
                      }
                    </td>
                    <td style={{ ...td, fontWeight: 600 }}>{m.away_team}</td>
                    <td style={td}><span style={{ ...sc, padding: '2px 8px', borderRadius: 4, fontSize: 12, fontWeight: 600 }}>{m.status}</span></td>
                    <td style={{ ...td, textAlign: 'right' }}>
                      {editing
                        ? <span style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                            <button onClick={() => saveScore(m.id)} style={{ ...btn(), padding: '4px 10px', fontSize: 12 }}>Save</button>
                            <button onClick={() => setEditId(null)} style={{ ...btn('ghost'), padding: '4px 10px', fontSize: 12 }}>Cancel</button>
                          </span>
                        : <span style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                            <button onClick={() => { setEditId(m.id); setEditScores({ home_score: m.home_score ?? '', away_score: m.away_score ?? '' }) }} style={{ ...btn('ghost'), padding: '4px 10px', fontSize: 12 }}>Edit</button>
                            <button onClick={() => remove(m.id)} style={{ ...btn('danger'), padding: '4px 10px', fontSize: 12 }}>✕</button>
                          </span>
                      }
                    </td>
                  </tr>
                )
              })
            }
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Section: Players ───────────────────────────────────────────────────────────
function Players() {
  const [teams, setTeams] = useState([])
  const [players, setPlayers] = useState([])
  const [teamFilter, setTeamFilter] = useState('all')
  const [pullTeamsStatus, setPullTeamsStatus] = useState('')
  const [pullPlayersStatus, setPullPlayersStatus] = useState('')
  const [pullingTeams, setPullingTeams] = useState(false)
  const [pullingPlayers, setPullingPlayers] = useState(false)

  useEffect(() => {
    (async () => {
      const [t, p] = await Promise.all([
        supabase.from('teams').select('*').order('name'),
        supabase.from('players').select('*, teams(name)').order('name'),
      ])
      setTeams(t.data || [])
      setPlayers(p.data || [])
    })()
  }, [])

  async function pullTeams() {
    setPullingTeams(true)
    setPullTeamsStatus('Fetching WC 2026 teams…')
    try {
      const data = await callAPI('competitions/WC/teams')
      const rows = (data.teams || []).map(t => ({
        name: t.name,
        fifa_code: t.tla || '',
        group_name: null,
      }))
      const { error } = await supabase.from('teams').upsert(rows, { onConflict: 'name' })
      if (error) throw new Error(error.message)
      const { data: refreshed } = await supabase.from('teams').select('*').order('name')
      setTeams(refreshed || [])
      setPullTeamsStatus(`✓ ${rows.length} teams synced.`)
    } catch (e) {
      setPullTeamsStatus(`✗ ${e.message}`)
    }
    setPullingTeams(false)
  }

  async function pullPlayers() {
    if (!teams.length) { setPullPlayersStatus('✗ Pull teams first.'); return }
    if (!confirm(`This fetches squads for ${teams.length} teams (~${teams.length * 7}s due to rate limits). Continue?`)) return
    setPullingPlayers(true)

    let count = 0
    const errors = []

    for (let i = 0; i < teams.length; i++) {
      const team = teams[i]
      setPullPlayersStatus(`Fetching squad ${i + 1}/${teams.length}: ${team.name}…`)
      try {
        const data = await callAPI(`teams/${team.id}`)
        const squad = data.squad || []
        const rows = squad.map(p => ({
          name: p.name,
          position: p.position || '—',
          team_id: team.id,
        }))
        if (rows.length) {
          await supabase.from('players').upsert(rows, { onConflict: 'name' })
          count += rows.length
        }
      } catch (e) {
        errors.push(team.name)
      }
      if (i < teams.length - 1) await new Promise(r => setTimeout(r, 7000)) // rate limit
    }

    const { data: refreshed } = await supabase.from('players').select('*, teams(name)').order('name')
    setPlayers(refreshed || [])
    setPullPlayersStatus(`✓ ${count} players synced.${errors.length ? ` Errors: ${errors.join(', ')}` : ''}`)
    setPullingPlayers(false)
  }

  const visible = teamFilter === 'all' ? players : players.filter(p => p.team_id == teamFilter)

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
        <div style={{ ...card, flex: 1, minWidth: 240, padding: 20, marginBottom: 0 }}>
          <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 16, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Teams</div>
          <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: 13, color: C.muted, marginBottom: 12 }}>Pulls all WC 2026 national teams into the teams table.</div>
          <button onClick={pullTeams} disabled={pullingTeams} style={{ ...btn(), opacity: pullingTeams ? 0.6 : 1 }}>
            {pullingTeams ? 'Pulling…' : '⚡ Sync Teams'}
          </button>
          <StatusMsg msg={pullTeamsStatus} />
        </div>
        <div style={{ ...card, flex: 1, minWidth: 240, padding: 20, marginBottom: 0 }}>
          <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 16, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Players</div>
          <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: 13, color: C.muted, marginBottom: 12 }}>Fetches squad for each team. Slow — respects API rate limits.</div>
          <button onClick={pullPlayers} disabled={pullingPlayers || !teams.length} style={{ ...btn(), opacity: pullingPlayers || !teams.length ? 0.6 : 1 }}>
            {pullingPlayers ? 'Pulling…' : '⚡ Sync Players'}
          </button>
          <StatusMsg msg={pullPlayersStatus} />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <select value={teamFilter} onChange={e => setTeamFilter(e.target.value)} style={{ ...inp, padding: '6px 10px' }}>
          <option value="all">All teams</option>
          {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <span style={{ fontFamily: "'Outfit', sans-serif", fontSize: 13, color: C.muted, alignSelf: 'center' }}>{visible.length} players</span>
      </div>

      <div style={card}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead><tr>
            <th style={th}>Name</th>
            <th style={th}>Position</th>
            <th style={th}>Team</th>
          </tr></thead>
          <tbody>
            {visible.length === 0
              ? <tr><td colSpan={3} style={{ ...td, textAlign: 'center', color: C.muted }}>No players yet. Sync teams first, then sync players.</td></tr>
              : visible.map((p, i) => (
                <tr key={p.id} style={{ background: i % 2 ? C.stripe : C.white }}>
                  <td style={{ ...td, fontWeight: 600 }}>{p.name}</td>
                  <td style={td}>{p.position}</td>
                  <td style={td}>{p.teams?.name ?? '—'}</td>
                </tr>
              ))
            }
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Password gate ──────────────────────────────────────────────────────────────
function PasswordGate({ onAuth }) {
  const [pw, setPw] = useState('')
  const [err, setErr] = useState(false)

  function check() {
    if (pw === ADMIN_PASSWORD) { sessionStorage.setItem('admin_auth', '1'); onAuth() }
    else { setErr(true); setPw('') }
  }

  return (
    <div style={{ minHeight: '100vh', background: C.dark, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: C.white, borderRadius: 16, padding: '40px 36px', width: '100%', maxWidth: 380, textAlign: 'center', boxShadow: '0 8px 32px rgba(0,0,0,0.3)' }}>
        <div style={{ fontSize: 36, marginBottom: 8 }}>🔒</div>
        <h2 style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 24, fontWeight: 800, color: C.dark, margin: '0 0 4px' }}>Admin Panel</h2>
        <p style={{ fontFamily: "'Outfit', sans-serif", fontSize: 13, color: C.muted, margin: '0 0 24px' }}>The Rift WC 2026</p>
        <input
          type="password"
          value={pw}
          onChange={e => { setPw(e.target.value); setErr(false) }}
          onKeyDown={e => e.key === 'Enter' && check()}
          placeholder="Password"
          style={{ ...inp, width: '100%', marginBottom: 10, boxSizing: 'border-box', border: `1px solid ${err ? C.red : C.border}`, textAlign: 'center', fontSize: 16 }}
          autoFocus
        />
        {err && <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: 13, color: C.red, marginBottom: 8 }}>Incorrect password</div>}
        <button onClick={check} style={{ ...btn(), width: '100%', padding: '10px', fontSize: 15 }}>Enter</button>
        <Link to="/" style={{ display: 'block', marginTop: 16, fontFamily: "'Outfit', sans-serif", fontSize: 13, color: C.muted, textDecoration: 'none' }}>← Back to site</Link>
      </div>
    </div>
  )
}

// ── Admin root ────────────────────────────────────────────────────────────────
const ADMIN_TABS = [
  { id: 'participants', label: 'Participants', icon: '👥' },
  { id: 'gameweeks',    label: 'Gameweeks',    icon: '📅' },
  { id: 'matches',      label: 'Matches',      icon: '⚽' },
  { id: 'players',      label: 'Players',      icon: '🌍' },
]

export default function Admin() {
  const [authed, setAuthed] = useState(!!sessionStorage.getItem('admin_auth'))
  const [tab, setTab] = useState('participants')

  useEffect(() => {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = 'https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700;800&family=Outfit:wght@400;500;600&display=swap'
    document.head.appendChild(link)
    document.body.style.margin = '0'
    document.body.style.background = C.cream
  }, [])

  if (!authed) return <PasswordGate onAuth={() => setAuthed(true)} />

  function logout() { sessionStorage.removeItem('admin_auth'); setAuthed(false) }

  return (
    <div style={{ minHeight: '100vh', background: C.cream }}>
      <header style={{ background: C.dark, color: C.white, paddingBottom: 0 }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', padding: '20px 20px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
            <div>
              <h1 style={{ margin: 0, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 26, color: C.white, lineHeight: 1.1 }}>
                ⚙️ Admin Panel
              </h1>
              <p style={{ margin: 0, fontFamily: "'Outfit', sans-serif", fontSize: 12, color: '#6ee7b7', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                The Rift WC 2026
              </p>
            </div>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <Link to="/" style={{ fontFamily: "'Outfit', sans-serif", fontSize: 13, color: 'rgba(255,255,255,0.5)', textDecoration: 'none' }}>← Public site</Link>
              <button onClick={logout} style={{ ...btn('ghost'), padding: '6px 12px', fontSize: 12, border: `1px solid rgba(255,255,255,0.2)`, color: 'rgba(255,255,255,0.5)' }}>Logout</button>
            </div>
          </div>
          <nav style={{ display: 'flex', gap: 4, marginTop: 16 }}>
            {ADMIN_TABS.map(t => {
              const active = tab === t.id
              return (
                <button key={t.id} onClick={() => setTab(t.id)} style={{ padding: '10px 18px', border: 'none', borderRadius: '8px 8px 0 0', background: active ? C.cream : 'transparent', color: active ? C.dark : 'rgba(255,255,255,0.55)', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 14, letterSpacing: '0.06em', textTransform: 'uppercase', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                  {t.icon} {t.label}
                </button>
              )
            })}
          </nav>
        </div>
      </header>
      <main style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 20px 48px' }}>
        {tab === 'participants' && <Participants />}
        {tab === 'gameweeks'    && <Gameweeks />}
        {tab === 'matches'      && <Matches />}
        {tab === 'players'      && <Players />}
      </main>
    </div>
  )
}
