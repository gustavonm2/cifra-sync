// Andamento gravado: duração real de cada acorde, medida enquanto o músico toca com "Seguir o meu áudio".
// Guardado na música como { base, durations: [segundos | null, …] } (um valor por acorde).

/**
 * A partir dos instantes (s) em que cada acorde começou, calcula as durações.
 *  starts:  array esparso { índice do acorde: instante em que começou }
 *  endTime: instante em que o último acorde terminou (ou null se desconhecido)
 * Acordes sem instante (pulados ou repetidos) entre dois conhecidos dividem o intervalo igualmente.
 * Devolve { base, durations } ou null se menos de `minCoverage` dos acordes foram medidos.
 */
export function durationsFromStarts(starts, count, endTime = null, minCoverage = 0.5) {
  const known = [];
  for (let i = 0; i < count; i++) if (Number.isFinite(starts[i])) known.push(i);
  if (known.length < 2) return null;

  const durations = new Array(count).fill(null);
  for (let k = 0; k < known.length - 1; k++) {
    const a = known[k];
    const b = known[k + 1];
    const each = (starts[b] - starts[a]) / (b - a);
    if (each <= 0) return null; // tempo andando para trás: gravação inválida
    for (let i = a; i < b; i++) durations[i] = each;
  }
  const last = known[known.length - 1];
  if (Number.isFinite(endTime) && endTime > starts[last]) durations[last] = endTime - starts[last];

  const measured = durations.filter((d) => d !== null);
  if (measured.length / count < minCoverage) return null;
  const round = (x) => Math.round(x * 100) / 100;
  const base = round(measured.reduce((a, b) => a + b, 0) / measured.length);
  return { base, durations: durations.map((d) => (d === null ? null : round(d))) };
}

/** Válido? (formato salvo na música/nuvem) */
export function isValidTiming(t, count) {
  return !!t && Number.isFinite(t.base) && t.base > 0 && Array.isArray(t.durations) && t.durations.length === count
    && t.durations.every((d) => d === null || (Number.isFinite(d) && d > 0 && d < 120));
}

/**
 * Função "duração do acorde i (s)". Com andamento gravado e ativo, usa a duração medida,
 * escalada pela velocidade escolhida (speed / base); onde não há medida (ou sem gravação),
 * usa speed × multiplicador de "segurar".
 */
export function durationFn({ speed, holds = {}, timing = null, useTiming = true }) {
  const factor = timing && useTiming ? speed / timing.base : 1;
  return (i) => {
    const measured = timing && useTiming ? timing.durations[i] : null;
    return measured != null ? measured * factor : speed * (holds[i] ?? 1);
  };
}
