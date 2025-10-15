// lib/cashout.js
// All numbers are decimal odds. fee is commission on PROFIT only (0..1).
// Round only at the UI boundary; keep math precise here.

const r2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;

export function cashoutBack({ stake, originalOdds, currentLayOdds, fee = 0.15, fraction = 1 }) {
  if (stake <= 0 || originalOdds <= 1 || currentLayOdds <= 1 || fraction <= 0) {
    return { held: 0, payoutNow: 0, profitNow: 0 };
  }
  const S = stake * fraction;
  const gross = (S * originalOdds) / currentLayOdds;  // what you’d pay user now
  const profit = gross - S;                           // vs stake held earlier
  const profitAfterFee = profit * (1 - fee);
  return {
    held: S,
    payoutNow: S + profitAfterFee,                    // return stake + net profit
    profitNow: profitAfterFee,
  };
}

export function cashoutLay({ layStake, layOddsPlaced, currentBackOdds, fee = 0.15, fraction = 1 }) {
  if (layStake <= 0 || layOddsPlaced <= 1 || currentBackOdds <= 1 || fraction <= 0) {
    return { held: 0, payoutNow: 0, profitNow: 0 };
  }
  const L = layStake * fraction;
  const liability = (layOddsPlaced - 1) * L;
  const backStake = liability / (currentBackOdds - 1); // hedge needed now
  const profit = L - backStake;                        // can be negative
  const profitAfterFee = profit * (1 - fee);
  return {
    held: liability,
    payoutNow: liability + layStake,             // release liability + net profit/loss
    profitNow: profitAfterFee,
  };
}

// oddsBook: { [selection: string]: { back: number, lay: number } }
export function cashoutForBet(bet, oddsBook, { fee = 0.15, fraction = 1 } = {}) {
  const sel = bet.selectionName || bet.market || bet.team || bet.pick;
  const px = oddsBook?.[sel];
  if (!px) return { held: 0, payoutNow: 0, profitNow: 0, unavailable: true };

  if (bet.lay) {
    // Close lay with CURRENT BACK
    if (!px.back || px.back <= 1) return { held: 0, payoutNow: 0, profitNow: 0, unavailable: true };
    return cashoutLay({
      layStake: Number(bet.stake),
      layOddsPlaced: Number(bet.odds),
      currentBackOdds: Number(px.back),
      fee,
      fraction,
    });
  } else {
    // Close back with CURRENT LAY
    if (!px.lay || px.lay <= 1) return { held: 0, payoutNow: 0, profitNow: 0, unavailable: true };
    return cashoutBack({
      stake: Number(bet.stake),
      originalOdds: Number(bet.odds),
      currentLayOdds: Number(px.lay),
      fee,
      fraction,
    });
  }
}

export function cashoutForTeam(bets, selection, oddsBook, { fee = 0.15, fraction = 1 } = {}) {
  let held = 0, payoutNow = 0, profitNow = 0;
  let any = false, unavailable = false;

  for (const b of bets) {
    const sel = b.selectionName || b.market;
    if (sel !== selection) continue;
    any = true;
    const r = cashoutForBet(b, oddsBook, { fee, fraction });
    if (r.unavailable) { unavailable = true; continue; }
    held += r.held; payoutNow += r.payoutNow; profitNow += r.profitNow;
  }
  return {
    any,
    unavailable,
    held: r2(held),
    payoutNow: r2(payoutNow),
    profitNow: r2(profitNow),
  };
}

export function cashoutPortfolio(bets, oddsBook, { fee = 0.15, fraction = 1 } = {}) {
  const perTeam = {};
  let held = 0, payoutNow = 0, profitNow = 0;

  for (const b of bets) {
    const sel = b.selectionName || b.market;
    const r = cashoutForBet(b, oddsBook, { fee, fraction });
    if (!perTeam[sel]) perTeam[sel] = { held: 0, payoutNow: 0, profitNow: 0, unavailable: false, any: false };
    perTeam[sel].any = true;
    if (r.unavailable) { perTeam[sel].unavailable = true; continue; }
    perTeam[sel].held = r2(perTeam[sel].held + r.held);
    perTeam[sel].payoutNow = r2(perTeam[sel].payoutNow + r.payoutNow);
    perTeam[sel].profitNow = r2(perTeam[sel].profitNow + r.profitNow);

    held += r.held; payoutNow += r.payoutNow; profitNow += r.profitNow;
  }
  return {
    held: r2(held),
    payoutNow: r2(payoutNow),
    profitNow: r2(profitNow),
    perTeam, // keyed by selection name
  };
}
