// syncEngine.js
// Shared quick-sync + score-calculation logic used by both the Admin and Public pages.
// Place at: src/lib/syncEngine.js
//
// Exports:
//   callAPI(endpoint)        - proxy call to football-data via /football-api
//   fetchAll(buildQuery)     - paginate past Supabase's 1000-row cap
//   quickSyncAndCalculate(supabase, { cooldownMinutes }) - throttled sync + recalc
//
// The throttle uses settings.last_synced_at so the cooldown is shared across all users.

const STAGE_MAP = {
  GROUP_STAGE: 'group', LAST_16: 'r16', ROUND_OF_16: 'r16',
  QUARTER_FINALS: 'qf', SEMI_FINALS: 'sf',
  FINAL: 'final', '3RD_PLACE_MATCH': 'final',
}
function apiStageToGW(stage, matchday) {
  if (stage === 'GROUP_STAGE') return matchday || 1
  return { LAST_16: 4, ROUND_OF_16: 4, QUARTER_FINALS: 5, SEMI_FINALS: 6, FINAL: 7, '3RD_PLACE_MATCH': 7 }[stage] ?? 4
}

export async function callAPI(endpoint) {
  const res = await fetch(`/football-api?endpoint=${encodeURIComponent(endpoint)}`)
  const json = await res.json()
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
  return json
}

export async function fetchAll(buildQuery, pageSize = 1000) {
  let from = 0, all = []
  while (true) {
    const { data, error } = await buildQuery().range(from, from + pageSize - 1)
    if (error) { console.error('fetchAll error:', error.message); break }
    if (!data || data.length === 0) break
    all = all.concat(data)
    if (data.length < pageSize) break
    from += pageSize
  }
  return all
}

// ── Quick sync: recent matches (last 3 days) + scorers, skipping unchanged ──
async function quickSync(supabase, onProgress = () => {}) {
  const d = new Date()
  const to = d.toISOString().slice(0, 10)
  const fromDate = new Date(d.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const data = await callAPI(`competitions/WC/matches?season=2026&dateFrom=${fromDate}&dateTo=${to}`)
  const allMatches = data.matches || []
  const withResults = allMatches.filter(m =>
    m.status === 'FINISHED' || m.status === 'IN_PLAY' || m.status === 'PAUSED' ||
    (m.score?.fullTime?.home != null && m.score?.fullTime?.away != null)
  )

  const { data: existingMatches } = await supabase
    .from('matches').select('api_match_id, home_score, away_score, status')
  const existingByApi = {}
  ;(existingMatches || []).forEach(m => { existingByApi[m.api_match_id] = m })

  const { data: teams } = await supabase.from('teams').select('id, name, fifa_code, api_id')
  const teamByCode = {}, teamByName = {}, teamByApiId = {}
  teams?.forEach(t => {
    teamByCode[t.fifa_code] = t.id
    teamByName[t.name.toLowerCase()] = t.id
    if (t.api_id) teamByApiId[t.api_id] = t.id
  })
  const findTeam = (t) => teamByApiId[t.id] || teamByCode[t.tla] || teamByName[t.name?.toLowerCase()] || null

  let updated = 0
  for (let i = 0; i < withResults.length; i++) {
    const m = withResults[i]
    const newHome = m.score?.fullTime?.home ?? null
    const newAway = m.score?.fullTime?.away ?? null
    const ex = existingByApi[m.id]
    if (ex && ex.status === 'FINISHED' && m.status === 'FINISHED'
        && ex.home_score === newHome && ex.away_score === newAway) continue
    const homeId = findTeam(m.homeTeam); const awayId = findTeam(m.awayTeam)
    if (!homeId || !awayId) continue
    const gwNum = apiStageToGW(m.stage, m.matchday)
    const gw = (await supabase.from('gameweeks').select('id').eq('week_number', gwNum).single()).data
    const { error } = await supabase.from('matches').upsert({
      api_match_id: m.id,
      home_team: m.homeTeam?.name || m.homeTeam?.shortName || '—',
      away_team: m.awayTeam?.name || m.awayTeam?.shortName || '—',
      gameweek_id: gw?.id || null,
      home_team_id: homeId, away_team_id: awayId,
      match_date: m.utcDate,
      stage: STAGE_MAP[m.stage] || 'group',
      home_score: newHome, away_score: newAway,
      status: m.status,
    }, { onConflict: 'api_match_id' })
    if (!error) updated++
    onProgress(`Updating results… ${i + 1}/${withResults.length}`)
  }

  // Scorers (single free call)
  try {
    const scData = await callAPI('competitions/WC/scorers?limit=200')
    for (const sc of (scData.scorers || [])) {
      if (!sc.player?.id) continue
      await supabase.from('players').update({ total_goals: sc.goals ?? 0 }).eq('id', sc.player.id)
    }
  } catch (e) { /* scorers optional; ignore */ }

  return updated
}

// ── Recalculate all participant scores (mirrors Admin calculateAll) ──
async function calculateScores(supabase) {
  const players = await fetchAll(() => supabase.from('players').select('id, team_id, total_goals'))
  const [{ data: participants }, { data: gameweeks }, { data: ptRows }, { data: matches },
         { data: picks }, { data: pickHistory }, { data: settings }] = await Promise.all([
    supabase.from('participants').select('id, name, paid'),
    supabase.from('gameweeks').select('*'),
    supabase.from('participant_teams').select('participant_id, team_id, pool'),
    supabase.from('matches').select('*').not('home_score', 'is', null),
    supabase.from('player_picks').select('participant_id, player_id, goals_at_pick'),
    supabase.from('player_pick_history').select('participant_id, player_id, goals_at_pick, goals_at_end'),
    supabase.from('settings').select('*').eq('id', 1).single(),
  ])

  const s = settings || {}
  const pts = {
    group_win: parseFloat(s.points_group_win) || 2,
    r32: parseFloat(s.points_r32) || 3, r16: parseFloat(s.points_r16) || 5,
    qf: parseFloat(s.points_qf) || 8, sf: parseFloat(s.points_sf) || 13,
    final: parseFloat(s.points_final) || 20, goal: parseFloat(s.points_goal) || 4,
    draw: parseFloat(s.points_draw) || 1, team_goal: parseFloat(s.points_team_goal) || 1,
  }
  const mults = { A: parseFloat(s.team_a_multiplier) || 1.5, B: parseFloat(s.pool_b_team_mult) || 1.5, C: parseFloat(s.pool_c_team_mult) || 2 }
  const pickMults = { A: parseFloat(s.pick_a_multiplier) || 1, B: parseFloat(s.pick_b_multiplier) || 2, C: parseFloat(s.pick_c_multiplier) || 3 }
  const poolMultFor = (myTeams, teamId) => { const o = myTeams.find(r => r.team_id === teamId); return o ? (mults[o.pool] || 1) : 1 }
  const pickMultFor = (myTeams, teamId) => { const o = myTeams.find(r => r.team_id === teamId); return o ? (pickMults[o.pool] || 1) : 1 }

  let latestGwId = null, latestWk = -1
  for (const g of gameweeks) { if ((g.week_number || 0) >= latestWk) { latestWk = g.week_number || 0; latestGwId = g.id } }

  const playerPointsByP = {}
  for (const p of participants) {
    const myTeams = ptRows.filter(r => r.participant_id === p.id)
    let total = 0
    const live = (picks || []).find(pk => pk.participant_id === p.id)
    if (live) {
      const player = players.find(pl => pl.id === live.player_id)
      if (player) total += Math.max(0, (player.total_goals || 0) - (live.goals_at_pick || 0)) * pts.goal * pickMultFor(myTeams, player.team_id)
    }
    for (const h of (pickHistory || []).filter(x => x.participant_id === p.id)) {
      const player = players.find(pl => pl.id === h.player_id)
      if (!player) continue
      total += Math.max(0, (h.goals_at_end || 0) - (h.goals_at_pick || 0)) * pts.goal * pickMultFor(myTeams, player.team_id)
    }
    playerPointsByP[p.id] = total
  }

  const scoreRows = []
  for (const p of participants) {
    for (const gw of gameweeks) {
      const gwStart = gw.starts_at ? new Date(gw.starts_at) : null
      const gwEnd = gw.ends_at ? new Date(gw.ends_at) : null
      const inWindow = (m) => {
        if (m.gameweek_id && m.gameweek_id === gw.id) return true
        if (!gwStart || !gwEnd || !m.match_date) return false
        const d = new Date(m.match_date); return d >= gwStart && d <= gwEnd
      }
      const gwMatches = matches.filter(inWindow)
      const myTeams = ptRows.filter(r => r.participant_id === p.id)
      const myTeamIds = myTeams.map(r => r.team_id)

      let team_points = 0
      for (const m of gwMatches) {
        const stageMap = { group: pts.group_win, r32: pts.r32, r16: pts.r16, qf: pts.qf, sf: pts.sf, final: pts.final }
        const stagePts = stageMap[m.stage] || pts.group_win
        const hs = m.home_score ?? 0, as = m.away_score ?? 0, draw = hs === as
        if (myTeamIds.includes(m.home_team_id)) {
          let raw = 0; if (draw) raw += pts.draw; else if (hs > as) raw += stagePts; raw += hs * pts.team_goal
          team_points += raw * poolMultFor(myTeams, m.home_team_id)
        }
        if (myTeamIds.includes(m.away_team_id)) {
          let raw = 0; if (draw) raw += pts.draw; else if (as > hs) raw += stagePts; raw += as * pts.team_goal
          team_points += raw * poolMultFor(myTeams, m.away_team_id)
        }
      }
      let player_points = 0
      if (latestGwId === gw.id) player_points = playerPointsByP[p.id] || 0

      scoreRows.push({
        participant_id: p.id, gameweek_id: gw.id,
        team_points, player_points, total_points: team_points + player_points,
        calculated_at: new Date().toISOString(),
      })
    }
  }
  const { error } = await supabase.from('participant_scores').upsert(scoreRows, { onConflict: 'participant_id,gameweek_id' })
  if (error) throw new Error(error.message)
  return participants.length
}

// ── Public-facing throttled entry point ──
// Returns { ran: bool, reason?: string, updated?: number, lastSynced?: Date }
export async function quickSyncAndCalculate(supabase, { cooldownMinutes = 30, onProgress = () => {} } = {}) {
  // Check the shared cooldown
  const { data: st } = await supabase.from('settings').select('last_synced_at').eq('id', 1).single()
  const last = st?.last_synced_at ? new Date(st.last_synced_at) : null
  const now = new Date()
  if (last) {
    const minsAgo = (now - last) / 60000
    if (minsAgo < cooldownMinutes) {
      return { ran: false, reason: 'cooldown', lastSynced: last, minsAgo: Math.floor(minsAgo), cooldownMinutes }
    }
  }
  onProgress('Fetching latest results…')
  const updated = await quickSync(supabase, onProgress)
  onProgress('Calculating scores…')
  await calculateScores(supabase)
  await supabase.from('settings').update({ last_synced_at: now.toISOString() }).eq('id', 1)
  return { ran: true, updated, lastSynced: now }
}
