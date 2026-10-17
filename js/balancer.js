/* ==========================================================================
   js/balancer.js
   Deterministic macro top-up balancer. Given a target and what a day (or a
   single meal) already provides, it picks single-macro top-ups to close the
   protein, fat and carb gaps, then the remaining calorie gap.

   Same inputs always give the same picks: candidates are ordered by how much
   of the needed macro they carry per kcal, ties broken by id, and `rotate`
   only shifts which equally good item leads so the week does not repeat
   one top-up every day.
   ========================================================================== */

export const TRIGGER = 0.05;   // act when calories are more than 5% under target
export const FILL_TO = 0.02;   // stop once within 2% under target
export const CEILING = 0.03;   // never push more than 3% over target

const MACRO_KEY = { protein: "protein_per_unit", carb: "carbs_per_unit", fat: "fats_per_unit" };
const TOTAL_KEY = { protein: "protein", carb: "carbs", fat: "fats" };

export const zero = () => ({ calories: 0, protein: 0, carbs: 0, fats: 0 });

export function addTotals(a, b, times = 1) {
  return {
    calories: a.calories + b.calories * times,
    protein: a.protein + b.protein * times,
    carbs: a.carbs + b.carbs * times,
    fats: a.fats + b.fats * times
  };
}

export function topUpTotals(t, units = 1) {
  return {
    calories: t.calories_per_unit * units,
    protein: t.protein_per_unit * units,
    carbs: t.carbs_per_unit * units,
    fats: t.fats_per_unit * units
  };
}

/** Top-ups that fit the person's diet, setting and exclusions. */
export function eligibleTopUps(topUps, { diet = "nonveg", exclusions = [], setting } = {}) {
  const allowedDiet = { veg: ["veg"], egg: ["veg", "egg"], nonveg: ["veg", "egg", "nonveg"] }[diet] || ["veg"];
  return topUps
    .filter(t => allowedDiet.includes(t.diet || "veg"))
    .filter(t => !(t.allergens || []).some(a => exclusions.includes(a)))
    .filter(t => !setting || !t.settings || t.settings.includes(setting))
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** Gap ratio per macro: how far below target, as a share of the target (0 when met). */
function gapRatios(target, cur) {
  const r = {};
  for (const m of ["protein", "carb", "fat"]) {
    const t = target[TOTAL_KEY[m]] || 0;
    r[m] = t > 0 ? Math.max(0, (t - cur[TOTAL_KEY[m]]) / t) : 0;
  }
  return r;
}

function ranked(pool, macro, rotate) {
  const key = MACRO_KEY[macro];
  const list = pool
    .filter(t => t.primary_macro === macro)
    .map(t => ({ t, density: t[key] / Math.max(1, t.calories_per_unit) }))
    .sort((a, b) => b.density - a.density || a.t.id.localeCompare(b.t.id))
    .map(x => x.t);
  if (list.length < 2 || !rotate) return list;
  // Rotate only among the top half so the best items still lead.
  const head = Math.max(2, Math.ceil(list.length / 2));
  const k = rotate % head;
  return [...list.slice(k, head), ...list.slice(0, k), ...list.slice(head)];
}

/**
 * balance({ target, current, topUps, rotate, maxDistinct, force })
 *   target / current: { calories, protein, carbs, fats }
 *   topUps: already filtered with eligibleTopUps()
 *   force: run even when the calorie gap is under the 5% trigger (used by
 *          the pantry widget to list options)
 * Returns { triggered, deficitPct, picks: [{ topUp, units }], after }.
 */
export function balance({ target, current, topUps, rotate = 0, maxDistinct = 4, force = false }) {
  const deficitPct = target.calories > 0 ? (target.calories - current.calories) / target.calories : 0;
  const triggered = deficitPct > TRIGGER;
  const result = { triggered, deficitPct, picks: [], after: { ...current } };
  if ((!triggered && !force) || deficitPct <= FILL_TO || !topUps.length) return result;

  const ceiling = target.calories * (1 + CEILING);
  const floor = target.calories * (1 - FILL_TO);
  const units = new Map();
  let cur = { ...current };

  const room = () => ceiling - cur.calories;
  const canAdd = (t) => {
    const u = units.get(t.id) || 0;
    if (u >= (t.max_units || 2)) return false;
    if (!units.has(t.id) && units.size >= maxDistinct) return false;
    return t.calories_per_unit <= room();
  };
  const add = (t, n) => {
    units.set(t.id, (units.get(t.id) || 0) + n);
    cur = addTotals(cur, topUpTotals(t, n));
  };

  // 1) Close macro gaps, biggest relative gap first. Each macro gets one item
  //    (more units of it before reaching for a second item).
  const ratios = gapRatios(target, cur);
  const order = Object.keys(ratios).filter(m => ratios[m] > 0.04).sort((a, b) => ratios[b] - ratios[a] || a.localeCompare(b));
  for (const macro of order) {
    const key = MACRO_KEY[macro], tKey = TOTAL_KEY[macro];
    for (const t of ranked(topUps, macro, rotate)) {
      if (cur.calories >= floor) break;
      let need = target[tKey] - cur[tKey];
      if (need <= target[tKey] * 0.04) break;
      while (need > 0 && canAdd(t)) {
        add(t, 1);
        need = target[tKey] - cur[tKey];
        if (cur.calories >= floor) break;
      }
      if (units.has(t.id)) break;
    }
  }

  // 2) Fill what is left of the calorie gap with carbs, then fat, then protein items.
  for (const macro of ["carb", "fat", "protein"]) {
    for (const t of ranked(topUps, macro, rotate)) {
      while (cur.calories < floor && canAdd(t)) add(t, 1);
      if (cur.calories >= floor) break;
    }
    if (cur.calories >= floor) break;
  }

  // 3) If the last unit pushed over, drop the smallest-calorie unit that keeps us above the floor.
  const byId = Object.fromEntries(topUps.map(t => [t.id, t]));
  for (const id of [...units.keys()].sort((a, b) => byId[a].calories_per_unit - byId[b].calories_per_unit || a.localeCompare(b))) {
    const t = byId[id];
    while (units.get(id) > 0 && cur.calories - t.calories_per_unit >= floor && cur.calories > target.calories) {
      units.set(id, units.get(id) - 1);
      cur = addTotals(cur, topUpTotals(t, -1));
    }
    if (units.get(id) === 0) units.delete(id);
  }

  result.picks = [...units.entries()].map(([id, n]) => ({ topUp: byId[id], units: n }));
  result.after = cur;
  return result;
}

/** Apply a chosen set of top-ups ({ id: units }) to totals. */
export function applyChoices(current, choices, topUpsById) {
  let cur = { ...current };
  for (const [id, n] of Object.entries(choices || {})) {
    const t = topUpsById[id];
    if (t && n > 0) cur = addTotals(cur, topUpTotals(t, n));
  }
  return cur;
}
