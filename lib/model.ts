// The token radar's model: a fitted comps model, tested blind, with costed farm plans.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) plus every
// other pre-token protocol the watchlist's own rule would keep: pre-token, not a wrapped, staked or
// bridged product of a token that already trades, not an exchange, not a versioned pool. Wrapped
// products (WBTC, staked ETH, USDT0) are never ranked: the snapshot's own guide says they are not
// protocols still waiting on a launch of their own.
//
// Implied value follows only from the snapshot's own figures, fitted at runtime, never from a
// hardcoded list of names:
//
//   comps     = the tokenised protocols that record a market cap above zero (16 records carry a
//               market cap of 0 or -1 and are left out: dead or unpriced tokens, not comps)
//   ratio     = mcap_usd / tvl_usd, winsorised to [0.005, 2.0] so one extreme token cannot set a
//               whole category's multiple (one prediction-market token trades at 400x its TVL)
//   multiple  = the category's median ratio, shrunk toward the global median with k = 5:
//               (n * median + 5 * global) / (n + 5); a category with no comps takes the global
//   growth    = clamp(change_7d, -60, 120) per cent; growthMult = 1 + growth/100 * 0.5
//   maturity  = 0.6 + min(age_days, 1095) / 1095 * 0.4   (age_days unknown: 365)
//   implied   = max(1, round(tvl_usd * multiple * growthMult * maturity))
//
// The fit is tested blind at runtime: the comps are split by sha256(slug) mod 5 (test = 0, a 20%
// holdout no fit ever sees), the multiples are fit on the 80%, and the median absolute log error
// of the fitted multiple is reported against a flat fitted median and the starter's flat 0.25.
// Growth and maturity are the house's stated adjustments, applied on top of the fitted multiple.
//
// A farm plan is derived from the protocol's own record (category, chains, TVL, age, implied
// value): a capital tier, a category action, a hold window, and a closing verdict step that nets
// the plan's gas and time against a stated scenario (5% of the implied value to farmers) and
// calls the row FARM, THIN or SKIP. No protocol name is ever special-cased.

import { createHash } from 'node:crypto';

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them and the sandbox may change them. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  winsor_low: number;
  winsor_high: number;
  shrink_k: number;
  farmer_share: number;
  farm_value_usd: number;
  thin_value_usd: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  winsor_low: 0.005,
  winsor_high: 2.0,
  shrink_k: 5,
  farmer_share: 0.05,
  farm_value_usd: 100_000_000,
  thin_value_usd: 25_000_000,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** A farm verdict: whether the plan is worth running, and why. */
export type Verdict = 'FARM' | 'THIN' | 'SKIP';

/** The fitted comps: the global multiple and one shrunk multiple per category. */
export interface CompsFit {
  comps: number;
  global_multiple: number;
  by_category: Record<string, number>;
}

/** The blind test's result: the fitted multiple against two flat baselines. */
export interface ModelTest {
  split: string;
  fit_n: number;
  test_n: number;
  fitted_med_log_err: number;
  flat_med_log_err: number;
  starter_med_log_err: number;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  verdict: Verdict;
  farmer_pool_usd: number;
  plan_cost_usd: number;
  plan_hours: number;
  model: {
    multiple: number;
    category_multiple: number;
    global_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, farm plan included so page and board agree. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  verdict: Verdict;
  farmer_pool_usd: number;
  plan_cost_usd: number;
  plan_hours: number;
  multiple: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, the fit and its blind test. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  model_fit: CompsFit;
  model_test: ModelTest;
  verdict_counts: Record<Verdict, number>;
  totals: { protocols: number; pre_token: number; tokenised: number; watchlist: number };
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The median of a non-empty list of numbers. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A comps ratio, winsorised so one extreme token cannot set a category's multiple. */
function winsor(ratio: number, model: ModelConstants): number {
  return Math.min(model.winsor_high, Math.max(model.winsor_low, ratio));
}

/** The tokenised protocols with a usable market cap: the comps the multiples are fit from. */
export function compsOf(snapshot: Snapshot): SnapshotProtocol[] {
  return snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
}

/** Fit the multiples from the comps: one shrunk median per category, global fallback. */
export function fitMultiples(comps: SnapshotProtocol[], model: ModelConstants = MODEL): CompsFit {
  const ratios = comps.map((p) => winsor(p.mcap_usd! / p.tvl_usd, model));
  const global = median(ratios);
  const byCat = new Map<string, number[]>();
  for (const p of comps) {
    const list = byCat.get(p.category ?? 'Uncategorised') ?? [];
    list.push(winsor(p.mcap_usd! / p.tvl_usd, model));
    byCat.set(p.category ?? 'Uncategorised', list);
  }
  const by_category: Record<string, number> = {};
  for (const [cat, rs] of [...byCat.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    by_category[cat] = (rs.length * median(rs) + model.shrink_k * global) / (rs.length + model.shrink_k);
  }
  return { comps: comps.length, global_multiple: global, by_category };
}

/** The multiple one protocol gets: its category's fitted multiple, or the global one. */
export function multipleFor(p: SnapshotProtocol, fit: CompsFit): number {
  return fit.by_category[p.category ?? 'Uncategorised'] ?? fit.global_multiple;
}

/** The deterministic blind-test split: sha256(slug) mod 5, test fold 0. */
export function hashFold(slug: string): number {
  const hex = createHash('sha256').update(slug, 'utf8').digest('hex');
  return Number(BigInt(`0x${hex}`) % 5n);
}

/** The blind test: fit the multiples on 80% of the comps, score the 20% holdout. */
export function blindTest(comps: SnapshotProtocol[], model: ModelConstants = MODEL): ModelTest {
  const fitSet = comps.filter((p) => hashFold(p.slug) !== 0);
  const testSet = comps.filter((p) => hashFold(p.slug) === 0);
  const fit = fitMultiples(fitSet, model);
  const medErr = (pred: (p: SnapshotProtocol) => number): number => {
    const errs = testSet
      .map((p) => Math.abs(Math.log(pred(p) / p.mcap_usd!)))
      .sort((a, b) => a - b);
    const mid = Math.floor(errs.length / 2);
    return errs.length % 2 === 1 ? errs[mid]! : (errs[mid - 1]! + errs[mid]!) / 2;
  };
  const err = medErr;
  return {
    split: 'sha256(slug) mod 5, fold 0 held out (20%)',
    fit_n: fitSet.length,
    test_n: testSet.length,
    fitted_med_log_err: round4(err((p) => p.tvl_usd * multipleFor(p, fit))),
    flat_med_log_err: round4(err((p) => p.tvl_usd * fit.global_multiple)),
    starter_med_log_err: round4(err((p) => p.tvl_usd * 0.25)),
  };
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The three multipliers and the implied value one protocol gets under the fitted model. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  fit: CompsFit,
  model: ModelConstants = MODEL,
): { implied: number; multiple: number; growthPct: number; growthMult: number; maturityMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const multiple = multipleFor(protocol, fit);
  const implied = Math.max(1, Math.round(protocol.tvl_usd * multiple * growthMult * maturityMult));
  return { implied, multiple, growthPct, growthMult, maturityMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** The watchlist's own exclusion rule, applied to the whole board: not a wrapped, staked or bridged
 * product of a token that already trades, not an exchange, not a versioned pool. The snapshot
 * carries no parentProtocol field, so that leg of the rule cannot be checked here. */
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const EXCHANGES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token and kept by the watchlist's own rule. */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGES.some((e) => p.name.startsWith(e))) return false;
  return true;
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The verdict: FARM a large, non-shrinking launch candidate; THIN a mid-size one; SKIP the rest. */
export function verdictFor(implied: number, change7d: number | null, model: ModelConstants = MODEL): Verdict {
  const growth = change7d ?? 0;
  if (implied >= model.farm_value_usd && growth >= -10) return 'FARM';
  if (implied >= model.thin_value_usd && growth >= -20) return 'THIN';
  return 'SKIP';
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('basis')) return `Deposit $${capital} of USDC into ${name}'s basis vault on ${chain} and keep the position open.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  if (c.includes('payment')) return `Route $${capital} of payments through ${name} on ${chain} and keep the receipts.`;
  if (c.includes('governance') || c.includes('incentive')) return `Lock $${capital} in ${name}'s incentives on ${chain} and vote each round.`;
  if (c.includes('privacy')) return `Deposit $${capital} through ${name}'s private pool on ${chain} and keep the note.`;
  if (c.includes('chain') && p.chains.length > 0) return `Bridge $${capital} of USDC to ${name} and use its flagship app while the position is open.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** The plan's gas and time totals, so the verdict step can net them. */
export function planEconomics(capital: number, hold: number): { gasUsd: number; hours: number } {
  const weeks = Math.max(1, Math.ceil(hold / 7));
  const setupGas = capital >= 150 ? 8 : 4;
  const gasUsd = 3 + setupGas + 2 * weeks;
  const minutes = 5 + 15 + 10 * weeks + 10 + 5;
  return { gasUsd, hours: Math.round((minutes / 60) * 10) / 10 };
}

function fmtUsdShort(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${Math.round(n)}`;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time, closing with the
 * verdict step that nets the plan's gas and time against the stated 5%-to-farmers scenario.
 * Derived from the protocol's own record (category, chains, TVL, age, implied value) only.
 */
export function farmSteps(
  p: SnapshotProtocol,
  age: number | null,
  implied: number,
  verdict: Verdict,
  model: ModelConstants = MODEL,
): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  const { gasUsd, hours } = planEconomics(capital, hold);
  const pool = Math.round(implied * model.farmer_share);
  const why =
    verdict === 'FARM'
      ? `a large implied value that is not shrinking fast, so the plan is worth running while the protocol keeps growing`
      : verdict === 'THIN'
        ? `a mid-size implied value, so run a small position and no more`
        : `a small or shrinking implied value, so the gas and time exceed the case for farming it`;
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
    {
      text: `Verdict: ${verdict} — ${why}. Scenario: if 5% of the ${fmtUsdShort(implied)} implied value went to farmers, the farmer pool would be ${fmtUsdShort(pool)}; this plan costs about $${gasUsd} in gas and ${hours} hours over ${hold} days, and pays only if a launch rewards early farmers at all.`,
      cost: `about $${gasUsd} of gas in total`,
      time: `${hours} hours over ${hold} days`,
    },
  ];
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const fit = fitMultiples(compsOf(snapshot), model);
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but
  // the board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every other pre-token protocol the watchlist's own rule keeps, all of them.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }
  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, fit, model);
    const verdict = verdictFor(v.implied, p.change_7d, model);
    const { gasUsd, hours } = planEconomics(capitalFor(p), holdDaysFor(v.age));
    return { p, ...v, verdict, gasUsd, hours };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    verdict: s.verdict,
    farmer_pool_usd: Math.round(s.implied * model.farmer_share),
    plan_cost_usd: s.gasUsd,
    plan_hours: s.hours,
    model: {
      // Full precision here: the dashboard recomputes the implied value from these three and
      // checks the board's number, so they must be the exact values the model used.
      multiple: s.multiple,
      category_multiple: round4(multipleFor(s.p, fit)),
      global_multiple: round4(fit.global_multiple),
      growth_pct: s.growthPct,
      growth_multiplier: s.growthMult,
      maturity_multiplier: s.maturityMult,
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age, s.implied, s.verdict, model).map(stepText),
  }));
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with the farm plan included. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    verdict: row.verdict,
    farmer_pool_usd: row.farmer_pool_usd,
    plan_cost_usd: row.plan_cost_usd,
    plan_hours: row.plan_hours,
    multiple: row.model.multiple,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const fit = fitMultiples(compsOf(snapshot), model);
  const test = blindTest(compsOf(snapshot), model);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const counts: Record<Verdict, number> = { FARM: 0, THIN: 0, SKIP: 0 };
  for (const r of board) counts[r.verdict]++;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    model_fit: fit,
    model_test: test,
    verdict_counts: counts,
    totals: {
      protocols: snapshot.protocols.length,
      pre_token: snapshot.protocols.filter(isPreToken).length,
      tokenised: snapshot.protocols.filter((p) => !isPreToken(p)).length,
      watchlist: snapshot.watchlist.length,
    },
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
