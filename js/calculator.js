/* ==========================================================================
   js/calculator.js
   Safe calorie and macro engine plus the 7-day meal plan generator.

   - BMR: Mifflin-St Jeor (Mifflin et al., Am J Clin Nutr 1990;51:241-247)
       men:   10*kg + 6.25*cm - 5*age + 5
       women: 10*kg + 6.25*cm - 5*age - 161
   - Maintenance (TDEE) = BMR x activity factor.
   - Guardrails: under-18s and BMI < 18.5 never get a deficit; any health
     screening flag switches to maintenance-only numbers with a referral.
   - Every cooked dish carries an explicit cooking-oil allowance.
   Pure functions only: no DOM, no storage, so it runs in Node for tests.
   ========================================================================== */

import { balance, eligibleTopUps, addTotals, topUpTotals, zero } from "./balancer.js";

export const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
export const ACTIVITY = [
  { value: 1.2, label: "Sedentary", hint: "Desk work or classes, little walking" },
  { value: 1.375, label: "Lightly active", hint: "Walk daily or train 1 to 3 days a week" },
  { value: 1.55, label: "Moderately active", hint: "Train 3 to 5 days a week" },
  { value: 1.725, label: "Very active", hint: "Hard training 6 to 7 days a week" },
  { value: 1.9, label: "Athlete", hint: "Twice-a-day training or a physical job" }
];
export const GOALS = {
  cut: { label: "Lose fat", hint: "A calorie deficit with high protein to keep muscle" },
  recomp: { label: "Lean recomposition", hint: "Build muscle and lose fat slowly at about maintenance" },
  maintain: { label: "Maintain", hint: "Eat at maintenance and keep your weight steady" },
  gain: { label: "Gain muscle", hint: "A small surplus to build muscle with less fat" }
};
export const PACES = { cut: [0.25, 0.5, 0.75, 1], gain: [0.25, 0.5] };
export const DEFAULT_PACE = { cut: 0.5, gain: 0.25 };
export const HEALTH_FLAGS = {
  pregnant: "Pregnant or breastfeeding",
  ckd: "Chronic kidney disease",
  diabetes: "Diabetes (type 1 or type 2)",
  ed: "A history of an eating disorder"
};
export const KCAL_PER_KG = 7700;            // energy in 1 kg of body weight change
const DAILY_PER_KG_WEEK = KCAL_PER_KG / 7;  // = 1100 kcal a day for 1 kg a week
export const OIL_TSP = { kcal: 45, fat: 5 };
export const LOW_CAL_CAP = 1400;

export const LIMITS = { age: [13, 80], heightCm: [120, 230], weightKg: [30, 250] };

// ---------------------------------------------------------------- units
export const cmFromFtIn = (ft, inch) => (Number(ft) || 0) * 30.48 + (Number(inch) || 0) * 2.54;
export const ftInFromCm = (cm) => { const t = cm / 2.54; let ft = Math.floor(t / 12); let inch = Math.round(t - ft * 12); if (inch === 12) { ft += 1; inch = 0; } return { ft, inch }; };
export const kgFromLb = (lb) => (Number(lb) || 0) * 0.45359237;
export const lbFromKg = (kg) => kg / 0.45359237;

export const bmiOf = (kg, cm) => kg / ((cm / 100) ** 2);

export function bmiBand(bmi) {
  if (bmi < 18.5) return "underweight";
  if (bmi < 22) return "lower-healthy";
  if (bmi < 25) return "healthy";
  if (bmi < 30) return "overweight";
  return "obese";
}

/** Returns a list of input errors (empty when the profile is usable). */
export function validateProfile(p) {
  const errs = [];
  const chk = (key, label, unit) => {
    const [lo, hi] = LIMITS[key];
    const v = p[key];
    if (!Number.isFinite(v)) errs.push({ field: key, text: `Enter your ${label}.` });
    else if (v < lo || v > hi) errs.push({ field: key, text: `${label[0].toUpperCase() + label.slice(1)} must be between ${lo} and ${hi} ${unit}.` });
  };
  chk("age", "age", "years");
  chk("heightCm", "height", "cm");
  chk("weightKg", "weight", "kg");
  if (!["m", "f"].includes(p.sex)) errs.push({ field: "sex", text: "Choose man or woman (used by the formula)." });
  return errs;
}

export const isClinical = (p) => Object.keys(HEALTH_FLAGS).some(k => p.health && p.health[k]);

/**
 * Which goals this person may pick, which one is the safe default, and the
 * advisory notes to show on the goal step.
 */
export function goalRules(p) {
  const bmi = bmiOf(p.weightKg, p.heightCm);
  const minor = p.age < 18;
  const allowed = {
    cut: { ok: true, reason: "" },
    recomp: { ok: true, reason: "" },
    maintain: { ok: true, reason: "" },
    gain: { ok: true, reason: "" }
  };
  const notes = [];
  let defaultGoal = "recomp";

  if (minor) {
    allowed.cut = { ok: false, reason: "Not available under 18" };
    allowed.gain = { ok: false, reason: "Not available under 18" };
    defaultGoal = "maintain";
    notes.push({ level: "warn", text: "You are under 18, so DietMaker plans at maintenance or lean recomposition only. Growing bodies need full energy; a deficit can affect growth, hormones and bone health. Talk to a doctor or a parent before changing how much you eat." });
  }
  if (bmi < 18.5) {
    allowed.cut = { ok: false, reason: "Blocked: BMI under 18.5" };
    if (!minor) defaultGoal = "gain";
    notes.push({ level: "warn", text: `Your BMI is ${bmi.toFixed(1)}, which is below the healthy range (18.5 to 24.9). Fat loss is blocked. Maintaining or gaining weight is the safer goal; please speak to a doctor if you have lost weight without trying.` });
  } else if (bmi < 22) {
    if (!minor) {
      defaultGoal = "recomp";
      notes.push({ level: "info", text: `Your BMI is ${bmi.toFixed(1)}, already in the healthy range. Lean recomposition is the default: it builds muscle without dieting. If you still choose to cut, keep it slow (0.25 to 0.5 kg a week); aggressive cutting at a healthy weight mostly costs muscle and energy.` });
    } else {
      notes.push({ level: "info", text: `Your BMI is ${bmi.toFixed(1)}, in the healthy range. There is no need to cut; eat enough to fuel growth and training.` });
    }
  }
  return { bmi, band: bmiBand(bmi), allowed, defaultGoal, notes, minor };
}

/** Effective goal after guardrails: the requested goal if allowed, else the default. */
export function effectiveGoal(p) {
  const rules = goalRules(p);
  const wanted = p.goal && rules.allowed[p.goal]?.ok ? p.goal : rules.defaultGoal;
  return { goal: wanted, changed: !!p.goal && wanted !== p.goal, rules };
}

/**
 * Daily targets.
 * mode "plan": full targets and a 7-day plan.
 * mode "clinical": maintenance baseline only (health screening flagged).
 */
export function computeTargets(p) {
  const errors = validateProfile(p);
  if (errors.length) return { mode: "invalid", errors };

  const bmr = 10 * p.weightKg + 6.25 * p.heightCm - 5 * p.age + (p.sex === "m" ? 5 : -161);
  const tdee = bmr * (p.activity || 1.2);
  const { goal, changed, rules } = effectiveGoal(p);
  const notes = [...rules.notes];
  const round10 = (v) => Math.round(v / 10) * 10;

  if (isClinical(p)) {
    const flags = Object.keys(HEALTH_FLAGS).filter(k => p.health[k]).map(k => HEALTH_FLAGS[k]);
    return {
      mode: "clinical", bmr: Math.round(bmr), tdee: Math.round(tdee), maintenance: round10(tdee),
      bmi: rules.bmi, band: rules.band, flags, notes
    };
  }

  if (changed) notes.unshift({ level: "warn", text: `"${GOALS[p.goal].label}" isn't available for your profile, so this plan uses "${GOALS[goal].label}".` });

  const pace = goal === "cut" || goal === "gain"
    ? (PACES[goal].includes(p.pace) ? p.pace : DEFAULT_PACE[goal]) : 0;
  let kcal, adjustment, floored = false, weekly = 0;
  if (goal === "gain") {
    kcal = tdee + pace * DAILY_PER_KG_WEEK;
    adjustment = `${Math.round(pace * DAILY_PER_KG_WEEK)} kcal surplus`;
    weekly = pace;
  } else if (goal === "cut") {
    const floor = Math.max(bmr, p.sex === "m" ? 1500 : 1200);
    kcal = tdee - pace * DAILY_PER_KG_WEEK;
    if (kcal < floor) { kcal = floor; floored = true; }
    weekly = -Math.max(0, (tdee - kcal) / DAILY_PER_KG_WEEK);
    adjustment = `${Math.round(tdee - kcal)} kcal deficit`;
    if (floored) notes.push({ level: "warn", text: `${pace} kg a week would take you below ${Math.round(kcal)} kcal, the lowest this plan goes for you (your BMR or a ${p.sex === "m" ? "1,500" : "1,200"} kcal floor). Expect about ${Math.abs(weekly).toFixed(2)} kg a week instead.` });
    else if (pace > p.weightKg * 0.01) notes.push({ level: "warn", text: "That pace is more than 1% of your body weight a week, which risks losing muscle. 0.5 kg a week is safer." });
  } else if (goal === "recomp") {
    // Lean recomp is a small deficit for adults; at maintenance for under-18s and low BMI.
    const atMaintenance = rules.minor || rules.bmi < 18.5;
    kcal = atMaintenance ? tdee : tdee * 0.95;
    adjustment = atMaintenance ? "at maintenance" : "5% below maintenance";
  } else {
    kcal = tdee;
    adjustment = "at maintenance";
  }
  kcal = round10(kcal);

  // Protein per kg. Above BMI 28 use the weight at BMI 25 so targets stay realistic.
  const refWeight = rules.bmi > 28 ? 25 * (p.heightCm / 100) ** 2 : p.weightKg;
  let perKg = { cut: 2.2, recomp: 2.0, maintain: 1.6, gain: 1.8 }[goal];
  if (rules.minor) perKg = Math.min(perKg, 1.6);
  let protein = Math.round(refWeight * perKg);
  const fats = Math.round(Math.max((kcal * 0.25) / 9, 0.6 * p.weightKg));
  // Protein never takes more than 35% of calories.
  protein = Math.min(protein, Math.round((kcal * 0.35) / 4));
  const carbs = Math.max(0, Math.round((kcal - protein * 4 - fats * 9) / 4));

  return {
    mode: "plan", goal, pace, bmr: Math.round(bmr), tdee: Math.round(tdee), maintenance: round10(tdee),
    calories: kcal, protein, carbs, fats, perKg, refWeight, adjustment, floored, weekly,
    bmi: rules.bmi, band: rules.band, notes, lowCalorie: kcal < LOW_CAL_CAP
  };
}

// ---------------------------------------------------------------- oil
/** Hidden oil allowance. Hostel/mess: 1 tsp light dishes, 2 tsp curries. Home: 1 tsp. */
export function oilAllowance(recipe, setting = "home") {
  if (!recipe || recipe.oil_style === "none") return { tsp: 0, calories: 0, fats: 0 };
  const tsp = setting === "hostel" ? (recipe.oil_style === "rich" ? 2 : 1) : 1;
  return { tsp, calories: tsp * OIL_TSP.kcal, fats: tsp * OIL_TSP.fat };
}

export function recipeTotals(recipe, servings = 1, setting = "home") {
  const oil = oilAllowance(recipe, setting);
  return {
    calories: recipe.calories * servings + oil.calories,
    protein: recipe.protein * servings,
    carbs: recipe.carbs * servings,
    fats: recipe.fats * servings + oil.fats
  };
}

/** Ingredient list scaled to the servings, grams rounded to 5. */
export function scaledIngredients(recipe, servings = 1, ingredientsById = {}) {
  return recipe.ingredients_detail.map(d => ({
    ...d,
    name: ingredientsById[d.ingredient_id]?.name || d.ingredient_id,
    scaledGrams: Math.max(5, Math.round((d.grams * servings) / 5) * 5)
  }));
}

// ---------------------------------------------------------------- filters
const DIET_OK = { veg: ["veg"], egg: ["veg", "egg"], nonveg: ["veg", "egg", "nonveg"] };

export function recipeAllowed(r, { diet = "nonveg", exclusions = [] } = {}) {
  return (DIET_OK[diet] || DIET_OK.veg).includes(r.diet) && !(r.allergens || []).some(a => exclusions.includes(a));
}

/** Recipes for one meal slot, deterministic order. Setting is relaxed only if nothing fits. */
export function slotPool(recipes, mealType, prefs) {
  const base = recipes.filter(r => r.meal_type === mealType && recipeAllowed(r, prefs));
  const inSetting = base.filter(r => !r.settings || r.settings.includes(prefs.setting || "home"));
  return (inSetting.length ? inSetting : base).slice().sort((a, b) => a.id.localeCompare(b.id));
}

// ---------------------------------------------------------------- plan
export function slotsFor(kcal) {
  if (kcal < LOW_CAL_CAP) {
    // Low-calorie cap: no snack, so minimum portions don't overshoot.
    return [
      { key: "breakfast", label: "Breakfast", time: "8 am", share: 0.30 },
      { key: "lunch", label: "Lunch", time: "1 pm", share: 0.35 },
      { key: "dinner", label: "Dinner", time: "8 pm", share: 0.35 }
    ];
  }
  return [
    { key: "breakfast", label: "Breakfast", time: "8 am", share: 0.25 },
    { key: "lunch", label: "Lunch", time: "1 pm", share: 0.30 },
    { key: "snack", label: "Snack", time: "5 pm", share: 0.15 },
    { key: "dinner", label: "Dinner", time: "8:30 pm", share: 0.30 }
  ];
}

const SERVING_MIN = 0.5, SERVING_MAX = 2, SERVING_STEP = 0.25;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const roundStep = (v) => Math.round(v / SERVING_STEP) * SERVING_STEP;

function servingsFor(recipe, slotKcal, setting) {
  const oil = oilAllowance(recipe, setting).calories;
  return clamp(roundStep((slotKcal - oil) / recipe.calories), SERVING_MIN, SERVING_MAX);
}

function mealEntry(slot, recipe, servings, setting, pool, d) {
  return {
    slot: slot.key, label: slot.label, time: slot.time, recipe, servings,
    oil: oilAllowance(recipe, setting), totals: recipeTotals(recipe, servings, setting),
    poolSize: pool.length, swapKey: `${d}-${slot.key}`
  };
}

const sumMeals = (meals) => meals.reduce((acc, m) => addTotals(acc, m.totals), zero());

/**
 * generatePlan(profile, targets, catalog, { swaps })
 *   catalog: { recipes, topUps }
 *   swaps: { "<dayIndex>-<slot>": recipeId } chosen by the person
 * Returns { slots, days: [{ index, name, meals, base, balance, target }] }.
 */
export function generatePlan(profile, targets, catalog, { swaps = {} } = {}) {
  if (targets.mode !== "plan") return null;
  const prefs = { diet: profile.diet, exclusions: profile.exclusions || [], setting: profile.setting };
  const slots = slotsFor(targets.calories);
  const pools = Object.fromEntries(slots.map(s => [s.key, slotPool(catalog.recipes, s.key, prefs)]));
  const topUps = eligibleTopUps(catalog.topUps, prefs);
  const target = { calories: targets.calories, protein: targets.protein, carbs: targets.carbs, fats: targets.fats };

  // Rotation: day d takes index (d + slotSeed) % n. Seeds differ per slot so
  // the same dish never lines up across slots, and with n >= 7 the 7 days are
  // distinct. A signature check guarantees no two days repeat the whole menu.
  const seeds = Object.fromEntries(slots.map((s, i) => [s.key, i * 3]));
  const used = new Set();
  const days = [];
  for (let d = 0; d < 7; d++) {
    const idx = Object.fromEntries(slots.map(s => [s.key, pools[s.key].length ? (d + seeds[s.key]) % pools[s.key].length : -1]));
    const sig = () => slots.map(s => idx[s.key]).join(",");
    for (let tries = 0; used.has(sig()) && tries < 7 * slots.length; tries++) {
      const s = slots[tries % slots.length];
      const n = pools[s.key].length;
      if (n > 1) idx[s.key] = (idx[s.key] + 1) % n;
    }
    used.add(sig());

    let meals = [];
    for (const s of slots) {
      const pool = pools[s.key];
      if (!pool.length) continue;
      const swapId = swaps[`${d}-${s.key}`];
      const recipe = pool.find(r => r.id === swapId) || pool[idx[s.key]];
      meals.push(mealEntry(s, recipe, servingsFor(recipe, targets.calories * s.share, profile.setting), profile.setting, pool, d));
    }

    // Overshoot guard (low-calorie targets): shrink the biggest portion first.
    let base = sumMeals(meals);
    for (let i = 0; i < 24 && base.calories > target.calories * 1.05; i++) {
      const big = meals.filter(m => m.servings > SERVING_MIN).sort((a, b) => b.totals.calories - a.totals.calories)[0];
      if (!big) break;
      const s = slots.find(x => x.key === big.slot);
      meals = meals.map(m => m === big ? mealEntry(s, m.recipe, m.servings - SERVING_STEP, profile.setting, pools[s.key], d) : m);
      base = sumMeals(meals);
    }

    // Protein guard: on deficit days the dishes alone often miss protein. Add
    // lean protein top-ups and trim portions so calories stay on target.
    const proteinPicks = new Map();
    let withPicks = base;
    if (base.protein < target.protein * 0.9) {
      const lean = topUps.filter(t => t.primary_macro === "protein")
        .sort((a, b) => b.protein_per_unit / b.calories_per_unit - a.protein_per_unit / a.calories_per_unit || a.id.localeCompare(b.id));
      // Only add what the portions can make room for (every dish at its minimum).
      const minBase = meals.reduce((acc, m) => acc + recipeTotals(m.recipe, SERVING_MIN, profile.setting).calories, 0);
      let budget = target.calories * 1.03 - minBase;
      for (const t of lean) {
        while (withPicks.protein < target.protein * 0.95 && (proteinPicks.get(t.id) || 0) < (t.max_units || 2) && t.calories_per_unit <= budget) {
          budget -= t.calories_per_unit;
          proteinPicks.set(t.id, (proteinPicks.get(t.id) || 0) + 1);
          withPicks = addTotals(withPicks, topUpTotals(t));
        }
      }
      // Make room: shrink the most carb-heavy portion until within 3% of target.
      for (let i = 0; i < 24 && withPicks.calories > target.calories * 1.03; i++) {
        const big = meals.filter(m => m.servings > SERVING_MIN)
          .sort((a, b) => b.totals.carbs / b.totals.calories - a.totals.carbs / a.totals.calories || b.totals.calories - a.totals.calories)[0];
        if (!big) break;
        const s = slots.find(x => x.key === big.slot);
        const next = mealEntry(s, big.recipe, big.servings - SERVING_STEP, profile.setting, pools[s.key], d);
        withPicks = addTotals(withPicks, next.totals);
        withPicks = addTotals(withPicks, big.totals, -1);
        meals = meals.map(m => m === big ? next : m);
      }
      base = sumMeals(meals);
    }

    const bal = balance({ target, current: withPicks, topUps, rotate: d });
    if (proteinPicks.size) {
      const byId = Object.fromEntries(topUps.map(t => [t.id, t]));
      const merged = new Map(proteinPicks);
      bal.picks.forEach(p => merged.set(p.topUp.id, (merged.get(p.topUp.id) || 0) + p.units));
      bal.picks = [...merged.entries()].map(([id, units]) => ({ topUp: byId[id], units }));
      bal.after = bal.picks.reduce((acc, p) => addTotals(acc, topUpTotals(p.topUp, p.units)), base);
      bal.proteinGuard = true;
    }
    days.push({ index: d, name: DAYS[d], meals, base, balance: bal, target, eligibleTopUps: topUps });
  }
  return { slots, days, topUps };
}

/** Within-range check used by the UI badges. */
export function dayStatus(totals, target) {
  const pct = (totals.calories - target.calories) / target.calories;
  return {
    pct,
    under: pct < -0.05,
    over: pct > 0.05,
    proteinShort: totals.protein < target.protein * 0.9,
    fatOutOfRange: totals.fats < target.fats * 0.75 || totals.fats > target.fats * 1.3
  };
}
