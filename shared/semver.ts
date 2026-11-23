/** SemVer precedence; never offer a downgrade or silently replace a published version. */
export function compareVersions(left: string, right: string): number {
  const [a, apre] = left.split(/-(.*)/s), [b, bpre] = right.split(/-(.*)/s);
  const an = a.split('.').map(BigInt), bn = b.split('.').map(BigInt);
  for (let index = 0; index < 3; index++) if (an[index] !== bn[index]) return an[index] > bn[index] ? 1 : -1;
  if (apre === undefined || bpre === undefined) return apre === bpre ? 0 : apre === undefined ? 1 : -1;
  const ap = apre.split('.'), bp = bpre.split('.');
  for (let index = 0; index < Math.max(ap.length, bp.length); index++) {
    if (ap[index] === bp[index]) continue;
    if (ap[index] === undefined || bp[index] === undefined) return ap[index] === undefined ? -1 : 1;
    const ai = /^\d+$/.test(ap[index]), bi = /^\d+$/.test(bp[index]);
    if (ai && bi) { if (BigInt(ap[index]) === BigInt(bp[index])) continue; return BigInt(ap[index]) > BigInt(bp[index]) ? 1 : -1; }
    if (ai !== bi) return ai ? -1 : 1;
    return ap[index] > bp[index] ? 1 : -1;
  }
  return 0;
}
