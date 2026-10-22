/** A drive's interview rounds, in order. No rounds configured means a single round called "Interview". */
export const roundNames = (drive) => {
  const r = Array.isArray(drive?.rounds) ? drive.rounds.filter((x) => typeof x === 'string' && x.trim()) : []
  return r.length ? r : ['Interview']
}

/** Where a candidate stands: their current round, its name, and what comes after it. */
export function roundInfo(drive, round = 1) {
  const names = roundNames(drive); const total = names.length
  const number = Math.min(Math.max(1, round || 1), total)
  return { number, name: names[number - 1], total, final: number >= total, next_name: number < total ? names[number] : null, multi: total > 1 }
}

/** Adds the round fields the screens need to a candidate row that carries `drive_rounds`. */
export const withRound = (row) => {
  if (!row) return row
  const { drive_rounds, ...rest } = row
  const info = roundInfo({ rounds: drive_rounds }, row.round)
  return { ...rest, round_name: info.name, rounds_total: info.total, final_round: info.final, next_round_name: info.next_name }
}
