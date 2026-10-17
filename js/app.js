/* ==========================================================================
   js/app.js
   Main orchestrator: tabs, the 5-step intake flow, plan rendering, top-up
   checkboxes, pantry chips and matching, the recipe drawer, export actions
   and localStorage persistence.
   ========================================================================== */

import { loadCatalog } from "./firebase.js";
import {
  ACTIVITY, GOALS, PACES, DEFAULT_PACE,
  cmFromFtIn, ftInFromCm, kgFromLb, lbFromKg, validateProfile, goalRules,
  computeTargets, generatePlan, recipeTotals, oilAllowance, scaledIngredients,
  recipeAllowed, slotsFor, slotPool, dayStatus
} from "./calculator.js";
import { balance, eligibleTopUps, applyChoices, topUpTotals } from "./balancer.js";

// ---------------------------------------------------------------- state
const STORE_KEY = "dietmaker:v2";
const DEFAULT_STATE = {
  tab: "planner",
  step: 0,                // 0 = landing, 1..4 intake, 5 = plan
  units: "metric",
  profile: {
    sex: "m", age: null, heightCm: null, weightKg: null, activity: 1.375,
    goal: null, goalTouched: false, pace: null,
    diet: "veg", setting: "hostel", exclusions: [],
    health: { pregnant: false, ckd: false, diabetes: false, ed: false }, healthNone: false
  },
  imperial: { ft: null, inch: null, lb: null },
  swaps: {},              // "<day>-<slot>": recipeId
  topups: {},             // "<day>": { topUpId: units }  (person's own choices)
  topupsKey: "",          // targets the top-up choices were made for
  day: 0,
  pantry: { selected: [], query: "", mealKcal: null, mealProtein: null }
};

let state = load();
let catalog = null;
let byId = { ingredients: {}, recipes: {}, topUps: {} };
let current = { targets: null, plan: null };

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return structuredClone(DEFAULT_STATE);
    const saved = JSON.parse(raw);
    return {
      ...structuredClone(DEFAULT_STATE), ...saved,
      profile: { ...DEFAULT_STATE.profile, ...(saved.profile || {}), health: { ...DEFAULT_STATE.profile.health, ...(saved.profile?.health || {}) } },
      imperial: { ...DEFAULT_STATE.imperial, ...(saved.imperial || {}) },
      pantry: { ...DEFAULT_STATE.pantry, ...(saved.pantry || {}) }
    };
  } catch { return structuredClone(DEFAULT_STATE); }
}

let saveTimer = 0;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch { /* storage blocked */ }
  }, 150);
}

// ---------------------------------------------------------------- helpers
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (v) => Math.round(v).toLocaleString("en-IN");
const fmt1 = (v) => (Math.round(v * 10) / 10).toLocaleString("en-IN");
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
const servingsText = (s) => (s === 1 ? "1 serving" : `${String(+s.toFixed(2))} servings`);
const unitsText = (n, unit) => (n === 1 ? unit : `${n} × ${unit}`);
const MEAL_LABEL = { breakfast: "Breakfast", lunch: "Lunch", snack: "Snack", dinner: "Dinner" };
const DIET_LABEL = { veg: "Veg", egg: "Egg", nonveg: "Non-veg" };
const EXCL_LABEL = { peanut: "peanuts", lactose: "lactose", gluten: "gluten" };
const GROUPS = [
  { key: "protein", label: "Proteins" },
  { key: "grain", label: "Grains" },
  { key: "veggie", label: "Veggies & fruit" },
  { key: "dairy", label: "Dairy" }
];

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, 2400);
}

const markHtml = (diet) => `<i class="mark ${diet === "nonveg" ? "nv" : diet}" title="${DIET_LABEL[diet]}" aria-label="${DIET_LABEL[diet]}"></i>`;

// ---------------------------------------------------------------- theme
function initTheme() {
  $("#themeToggle").addEventListener("click", () => {
    const root = document.documentElement;
    const isDark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    root.dataset.theme = isDark ? "light" : "dark";
    try { localStorage.setItem("dietmaker:theme", root.dataset.theme); } catch { /* ignore */ }
  });
}

// ---------------------------------------------------------------- tabs
function setTab(tab, focus = false) {
  state.tab = tab;
  $$(".tab").forEach(b => {
    const on = b.dataset.tab === tab;
    b.setAttribute("aria-selected", String(on));
    b.tabIndex = on ? 0 : -1;
    if (on && focus) b.focus();
  });
  $("#tab-planner").hidden = tab !== "planner";
  $("#tab-pantry").hidden = tab !== "pantry";
  if (tab === "pantry") renderPantry();
  save();
}

function initTabs() {
  $$(".tab").forEach(b => b.addEventListener("click", () => setTab(b.dataset.tab)));
  $(".tabs").addEventListener("keydown", (e) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const tabs = $$(".tab");
    const i = tabs.findIndex(t => t.dataset.tab === state.tab);
    const next = e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : (i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    setTab(tabs[next].dataset.tab, true);
  });
  $("#brandLink").addEventListener("click", (e) => { e.preventDefault(); setTab("planner"); goStep(0); });
}

// ---------------------------------------------------------------- intake form
const form = () => $("#intake");

function fillForm() {
  const p = state.profile, f = form();
  $("#activity").innerHTML = ACTIVITY.map(a => `<option value="${a.value}">${esc(a.label)}</option>`).join("");
  f.sex.value = p.sex;
  f.units.value = state.units;
  $("#age").value = p.age ?? "";
  $("#heightCm").value = p.heightCm ? +p.heightCm.toFixed(1) : "";
  $("#weightKg").value = p.weightKg ? +p.weightKg.toFixed(1) : "";
  $("#heightFt").value = state.imperial.ft ?? "";
  $("#heightIn").value = state.imperial.inch ?? "";
  $("#weightLb").value = state.imperial.lb ?? "";
  $("#activity").value = String(p.activity);
  f.diet.value = p.diet;
  f.setting.value = p.setting;
  $$("input[name=exclude]").forEach(x => { x.checked = p.exclusions.includes(x.value); });
  $$("input[name=health]").forEach(x => { x.checked = !!p.health[x.value]; });
  $("#healthNone").checked = !!p.healthNone;
  syncUnits();
  syncActivityHint();
}

function syncUnits() {
  $$("[data-units]").forEach(el => { el.hidden = el.dataset.units !== state.units; });
}

function syncActivityHint() {
  const a = ACTIVITY.find(x => String(x.value) === $("#activity").value);
  $("#activityHint").textContent = a ? a.hint : "";
}

/** Reads step 1 inputs into state.profile (always stored in metric). */
function readBody() {
  const p = state.profile;
  p.sex = form().sex.value;
  p.age = num($("#age").value);
  p.activity = num($("#activity").value) || 1.375;
  if (state.units === "metric") {
    p.heightCm = num($("#heightCm").value);
    p.weightKg = num($("#weightKg").value);
  } else {
    state.imperial.ft = num($("#heightFt").value);
    state.imperial.inch = num($("#heightIn").value);
    state.imperial.lb = num($("#weightLb").value);
    p.heightCm = state.imperial.ft != null ? cmFromFtIn(state.imperial.ft, state.imperial.inch || 0) : null;
    p.weightKg = state.imperial.lb != null ? kgFromLb(state.imperial.lb) : null;
  }
}

function switchUnits(units) {
  readBody();
  state.units = units;
  const p = state.profile;
  if (units === "imperial") {
    if (p.heightCm) { const { ft, inch } = ftInFromCm(p.heightCm); state.imperial.ft = ft; state.imperial.inch = inch; }
    if (p.weightKg) state.imperial.lb = Math.round(lbFromKg(p.weightKg) * 2) / 2;
  }
  fillForm();
  save();
}

function readPrefs() {
  const p = state.profile, f = form();
  p.diet = f.diet.value;
  p.setting = f.setting.value;
  p.exclusions = $$("input[name=exclude]:checked").map(x => x.value);
}

function readHealth() {
  const p = state.profile;
  $$("input[name=health]").forEach(x => { p.health[x.value] = x.checked; });
  p.healthNone = $("#healthNone").checked;
}

function showErrors(el, errs) {
  el.hidden = !errs.length;
  el.innerHTML = errs.map(e => esc(e.text)).join("<br>");
}

// ---------------------------------------------------------------- goal step
function renderGoalStep() {
  const p = state.profile;
  const rules = goalRules(p);
  if (!p.goalTouched || !p.goal || !rules.allowed[p.goal].ok) {
    if (p.goal !== rules.defaultGoal && DEFAULT_PACE[rules.defaultGoal]) p.pace = DEFAULT_PACE[rules.defaultGoal];
    p.goal = rules.defaultGoal;
  }

  $("#goalGrid").innerHTML = Object.entries(GOALS).map(([key, g]) => {
    const a = rules.allowed[key];
    return `<label class="goal-card${a.ok ? "" : " is-disabled"}">
      <input type="radio" name="goal" value="${key}"${p.goal === key ? " checked" : ""}${a.ok ? "" : " disabled"}>
      <span class="goal-body"><span class="goal-title">${esc(g.label)}${key === rules.defaultGoal ? ' <em class="tag">Suggested</em>' : ""}</span>
      <span class="goal-hint">${esc(a.ok ? g.hint : a.reason)}</span></span>
    </label>`;
  }).join("");

  $("#goalNotes").innerHTML = rules.notes.map(n => `<p class="note ${n.level}">${esc(n.text)}</p>`).join("");
  renderPace();
}

function renderPace() {
  const p = state.profile;
  const box = $("#paceBox");
  const opts = PACES[p.goal];
  box.hidden = !opts;
  if (!opts) return;
  if (!opts.includes(p.pace)) p.pace = DEFAULT_PACE[p.goal];
  $("#paceLbl").textContent = p.goal === "cut" ? "Aim to lose per week" : "Aim to gain per week";
  $("#pace").innerHTML = opts.map(v => `<option value="${v}"${v === p.pace ? " selected" : ""}>${v} kg a week${v === DEFAULT_PACE[p.goal] ? " (recommended)" : ""}</option>`).join("");
  syncPaceHint();
}

function syncPaceHint() {
  const p = state.profile;
  const daily = Math.round(p.pace * 1100);
  let hint = p.goal === "cut" ? `About ${daily} kcal a day below maintenance.` : `About ${daily} kcal a day above maintenance.`;
  if (p.goal === "cut" && p.weightKg && p.pace > p.weightKg * 0.01) hint += " That is more than 1% of your weight a week, which risks muscle loss.";
  if (p.goal === "gain" && p.pace > 0.25) hint += " Faster gains usually add more fat than muscle.";
  $("#paceHint").textContent = hint;
}

// ---------------------------------------------------------------- steps
function goStep(step) {
  state.step = step;
  $("#landing").hidden = step !== 0;
  $("#wizard").hidden = step === 0;
  $$("#intake .step").forEach(fs => { fs.hidden = Number(fs.dataset.step) !== step; });
  $("#intake").hidden = step === 5;
  $("#results").hidden = step !== 5;
  $$("#stepper li").forEach(li => {
    const n = Number(li.dataset.step);
    li.classList.toggle("is-current", n === step);
    li.classList.toggle("is-done", n < step);
    const b = $("button", li);
    b.disabled = n > maxReachableStep();
    if (n === step) b.setAttribute("aria-current", "step"); else b.removeAttribute("aria-current");
  });
  if (step === 2) renderGoalStep();
  if (step === 5) renderResults();
  save();
  if (step > 0) {
    const target = step === 5 ? $("#resultsTitle") : $(`#intake .step[data-step="${step}"] legend`);
    target?.setAttribute("tabindex", "-1");
    target?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
}

function step1Valid() {
  return validateProfile(state.profile).length === 0;
}
function healthAnswered() {
  const p = state.profile;
  return p.healthNone || Object.values(p.health).some(Boolean);
}
function maxReachableStep() {
  if (!step1Valid()) return 1;
  if (!healthAnswered()) return 4;
  return 5;
}

function next() {
  const s = state.step;
  if (s === 1) {
    readBody();
    const errs = validateProfile(state.profile);
    showErrors($("#step1Errors"), errs);
    if (errs.length) { $(`#${errs[0].field === "heightCm" && state.units === "imperial" ? "heightFt" : errs[0].field === "weightKg" && state.units === "imperial" ? "weightLb" : errs[0].field}`)?.focus(); return; }
  }
  if (s === 3) readPrefs();
  if (s === 4) {
    readHealth();
    if (!healthAnswered()) {
      showErrors($("#step4Errors"), [{ text: "Tick any that apply, or tick “None of these apply to me”." }]);
      return;
    }
    showErrors($("#step4Errors"), []);
  }
  goStep(Math.min(5, s + 1));
}

function initIntake() {
  fillForm();
  $("#startBtn").addEventListener("click", () => goStep(1));
  $("#resumeBtn").addEventListener("click", () => goStep(5));
  $$("[data-next]").forEach(b => b.addEventListener("click", next));
  $$("[data-prev]").forEach(b => b.addEventListener("click", () => goStep(Math.max(1, state.step - 1))));
  $$("#stepper button").forEach(b => b.addEventListener("click", () => {
    const n = Number(b.dataset.goto);
    if (n <= maxReachableStep()) goStep(n);
  }));
  form().addEventListener("submit", (e) => { e.preventDefault(); next(); });
  form().addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.tagName === "INPUT" && e.target.type !== "checkbox" && e.target.type !== "radio") { e.preventDefault(); next(); }
  });

  $$("input[name=units]").forEach(r => r.addEventListener("change", () => switchUnits(r.value)));
  $("#activity").addEventListener("change", () => { syncActivityHint(); readBody(); save(); });
  ["#age", "#heightCm", "#weightKg", "#heightFt", "#heightIn", "#weightLb"].forEach(sel =>
    $(sel).addEventListener("input", () => { readBody(); save(); }));
  $$("input[name=sex]").forEach(r => r.addEventListener("change", () => { readBody(); save(); }));

  $("#goalGrid").addEventListener("change", (e) => {
    if (e.target.name !== "goal") return;
    state.profile.goal = e.target.value;
    state.profile.goalTouched = true;
    if (DEFAULT_PACE[e.target.value]) state.profile.pace = DEFAULT_PACE[e.target.value];
    renderPace();
    save();
  });
  $("#pace").addEventListener("change", () => { state.profile.pace = num($("#pace").value); syncPaceHint(); save(); });

  $$("input[name=diet], input[name=setting], input[name=exclude]").forEach(x => x.addEventListener("change", () => { readPrefs(); save(); }));

  $$("input[name=health]").forEach(x => x.addEventListener("change", () => {
    if (x.checked) $("#healthNone").checked = false;
    readHealth(); save();
  }));
  $("#healthNone").addEventListener("change", () => {
    if ($("#healthNone").checked) $$("input[name=health]").forEach(x => { x.checked = false; });
    readHealth(); save();
  });
}

// ---------------------------------------------------------------- results
const targetsKey = (t) => (t && t.mode === "plan" ? [t.calories, t.protein, t.carbs, t.fats, state.profile.diet, state.profile.setting, state.profile.exclusions.join(",")].join("|") : "");

function computeAll() {
  current.targets = computeTargets(state.profile);
  current.plan = catalog && current.targets.mode === "plan"
    ? generatePlan(state.profile, current.targets, catalog, { swaps: state.swaps })
    : null;
  // Top-up choices belong to one set of targets; drop them when targets change.
  const key = targetsKey(current.targets);
  if (key !== state.topupsKey) { state.topups = {}; state.topupsKey = key; }
}

function renderResults() {
  computeAll();
  const t = current.targets;
  if (t.mode === "invalid") { goStep(1); return; }

  const clinical = t.mode === "clinical";
  $("#clinicalPanel").hidden = !clinical;
  $("#weekSection").hidden = clinical;
  $("#copyBtn").hidden = $("#shareBtn").hidden = $("#printBtn").hidden = clinical;
  $("#macroBar").hidden = clinical;

  if (clinical) {
    $("#resultsTitle").textContent = "Your baseline numbers";
    $("#targetsSub").textContent = `BMI ${t.bmi.toFixed(1)}. These are estimates of what your body uses, not a diet target.`;
    $("#targets").innerHTML = tile("Maintenance", t.maintenance, "kcal") + tile("Resting (BMR)", t.bmr, "kcal");
    $("#clinicalPanel").innerHTML = `
      <h3>Please plan your diet with a doctor or registered dietitian</h3>
      <p>You told us: <strong>${t.flags.map(esc).join(", ")}</strong>. With ${t.flags.length > 1 ? "these conditions" : "this condition"}, a fixed calorie or protein target from a general formula can do harm. For example, high protein strains the kidneys in kidney disease, carbohydrate timing matters with diabetes medication, pregnancy and breastfeeding need extra energy, and rigid meal plans can trigger relapse after an eating disorder.</p>
      <p>So DietMaker shows only your estimated maintenance calories as a starting point for that conversation, and no meal plan. You can still browse dishes in <button type="button" class="link-btn" data-tab-jump="pantry">Cook from Pantry</button>.</p>
      <p class="small muted">In India you can find a registered dietitian through the Indian Dietetic Association (IDA) or ask at your nearest government or college hospital. If you are struggling with eating, the Tele-MANAS helpline (14416) is free and available 24/7.</p>`;
    $("#clinicalPanel [data-tab-jump]").addEventListener("click", () => setTab("pantry"));
    $("#planNotes").innerHTML = "";
    return;
  }

  $("#resultsTitle").textContent = "Your daily targets";
  const goal = GOALS[t.goal].label;
  const change = t.goal === "cut" ? `about ${Math.abs(t.weekly).toFixed(2)} kg loss a week` : t.goal === "gain" ? `about ${t.weekly} kg gain a week` : "weight roughly steady";
  $("#targetsSub").textContent = `${goal}: ${t.adjustment} (maintenance ${fmt(t.maintenance)} kcal), ${change}. BMI ${t.bmi.toFixed(1)}.`;
  $("#targets").innerHTML =
    tile("Calories", t.calories, "kcal") +
    tile("Protein", t.protein, "g", "protein", `${t.perKg} g/kg`) +
    tile("Carbs", t.carbs, "g", "carbs") +
    tile("Fat", t.fats, "g", "fats");
  const pk = t.protein * 4, ck = t.carbs * 4, fk = t.fats * 9, sum = pk + ck + fk || 1;
  $("#macroBar").innerHTML = `<i class="protein" style="width:${(pk / sum) * 100}%"></i><i class="carbs" style="width:${(ck / sum) * 100}%"></i><i class="fats" style="width:${(fk / sum) * 100}%"></i>`;

  const notes = [...t.notes];
  if (t.lowCalorie) notes.push({ level: "info", text: "Your target is under 1,400 kcal, so the plan uses three meals and drops the snack to avoid going over." });
  notes.push({ level: "info", text: state.profile.setting === "hostel"
    ? "Cooking oil is counted: 1 tsp for lighter mess dishes and 2 tsp for curries and gravies (45 to 90 kcal, 5 to 10 g fat each)."
    : "Cooking oil is counted: 1 tsp (45 kcal, 5 g fat) for every cooked dish. Measure it with a teaspoon." });
  if (state.profile.exclusions.length) notes.push({ level: "info", text: `Excluded from every meal and top-up: ${state.profile.exclusions.map(x => EXCL_LABEL[x]).join(", ")}.` });
  if (!catalog) notes.push({ level: "info", text: "Loading dishes…" });
  $("#planNotes").innerHTML = notes.map(n => `<p class="note ${n.level}">${esc(n.text)}</p>`).join("");

  renderWeek();
}

function tile(label, value, unit, cls = "", sub = "") {
  return `<div class="tile ${cls}"><div class="tile-k">${cls ? `<i class="dot ${cls}" aria-hidden="true"></i>` : ""}${esc(label)}</div>
    <div class="tile-v">${fmt(value)}<small>${unit}</small></div>${sub ? `<div class="tile-s">${esc(sub)}</div>` : ""}</div>`;
}

/** The top-ups ticked for a day: the person's own choices if any, else the balancer's. */
function dayChoices(day) {
  const own = state.topups[day.index];
  if (own) return own;
  return Object.fromEntries(day.balance.picks.map(p => [p.topUp.id, p.units]));
}

function dayFinalTotals(day) {
  return applyChoices(day.base, dayChoices(day), byId.topUps);
}

function renderWeek() {
  const plan = current.plan;
  if (!plan) { $("#dayStrip").innerHTML = ""; $("#dayCard").innerHTML = catalog ? "" : `<p class="muted">Loading dishes…</p>`; return; }
  state.day = Math.min(6, Math.max(0, state.day || 0));
  $("#dayStrip").innerHTML = plan.days.map(d => {
    const tot = dayFinalTotals(d);
    const st = dayStatus(tot, d.target);
    const pct = Math.round(st.pct * 100);
    return `<button type="button" role="tab" class="day-btn${d.index === state.day ? " is-active" : ""}" aria-selected="${d.index === state.day}" data-day="${d.index}" tabindex="${d.index === state.day ? 0 : -1}">
      <span class="d-name">${d.name.slice(0, 3)}</span>
      <span class="d-pct ${st.under ? "warn" : st.over ? "over" : "ok"}">${pct > 0 ? "+" : ""}${pct}%</span>
    </button>`;
  }).join("");
  renderDay();
}

function renderDay() {
  const day = current.plan.days[state.day];
  const choices = dayChoices(day);
  const final = applyChoices(day.base, choices, byId.topUps);
  const st = dayStatus(final, day.target);

  const meals = day.meals.map(m => {
    const r = m.recipe;
    return `<li class="meal">
      <div class="meal-top">
        <span class="slot">${esc(m.label)} <small>${esc(m.time)}</small></span>
        <span class="meal-kcal">${fmt(m.totals.calories)} kcal</span>
      </div>
      <h3 class="meal-title">${markHtml(r.diet)} ${esc(r.title)}</h3>
      <p class="meal-meta">${servingsText(m.servings)} · P ${fmt(m.totals.protein)} g · C ${fmt(m.totals.carbs)} g · F ${fmt(m.totals.fats)} g</p>
      ${m.oil.tsp ? `<p class="oil">+ ${m.oil.tsp} tsp cooking oil counted (${m.oil.calories} kcal, ${m.oil.fats} g fat)</p>` : ""}
      <div class="meal-actions">
        <button type="button" class="btn btn-sm btn-ghost" data-recipe="${esc(r.id)}" data-servings="${m.servings}">Recipe</button>
        <button type="button" class="btn btn-sm btn-ghost" data-swap="${esc(m.swapKey)}" data-slot="${m.slot}" ${m.poolSize < 2 ? "disabled" : ""}>Swap</button>
      </div>
    </li>`;
  }).join("");

  const warn = [];
  if (st.under) warn.push(`This day is ${Math.abs(Math.round(st.pct * 100))}% under your calorie target. Tick top-ups below to close the gap.`);
  if (st.over) warn.push(`This day is ${Math.round(st.pct * 100)}% over your calorie target.`);
  if (st.proteinShort) warn.push(`Protein is ${fmt(day.target.protein - final.protein)} g short. A protein top-up below helps.`);
  if (st.fatOutOfRange && !st.under) warn.push(`Fat is ${fmt(final.fats)} g against a ${fmt(day.target.fats)} g target.`);

  $("#dayCard").innerHTML = `
    <header class="day-head"><h3>${esc(day.name)}</h3>${Object.keys(state.swaps).some(k => k.startsWith(day.index + "-")) ? `<button type="button" class="link-btn" data-reset-day="${day.index}">Undo swaps</button>` : ""}</header>
    <ol class="meals">${meals}</ol>
    ${balancerWidget({ id: `day${day.index}`, choices, suggested: day.balance, eligible: day.eligibleTopUps, triggered: day.balance.triggered || st.under || st.proteinShort })}
    <div class="totals" id="dayTotals">${totalsHtml(final, day.target)}</div>
    ${warn.length ? `<div class="notes">${warn.map(w => `<p class="note warn">${esc(w)}</p>`).join("")}</div>` : ""}`;
}

function totalsHtml(tot, target) {
  const cell = (label, v, t, unit, cls) => {
    const pct = t ? Math.round((v / t) * 100) : 0;
    // Going over on protein is fine; over on calories, carbs or fat is flagged.
    const state = pct < 95 ? "warn" : pct > 105 && cls !== "protein" ? "over" : "ok";
    return `<div class="total ${cls}"><span class="total-k">${label}</span><span class="total-v">${fmt(v)}<small>/ ${fmt(t)} ${unit}</small></span>
      <span class="meter" aria-hidden="true"><i class="${state}" style="width:${Math.min(100, pct)}%"></i></span></div>`;
  };
  return `<p class="totals-title">Day total</p><div class="totals-grid">
    ${cell("Calories", tot.calories, target.calories, "kcal", "")}
    ${cell("Protein", tot.protein, target.protein, "g", "protein")}
    ${cell("Carbs", tot.carbs, target.carbs, "g", "carbs")}
    ${cell("Fat", tot.fats, target.fats, "g", "fats")}</div>`;
}

/** Deficit Balancer widget: suggested top-ups ticked, others available, live totals. */
function balancerWidget({ id, choices, suggested, eligible, triggered }) {
  if (!eligible.length) return "";
  const suggestedIds = new Set(suggested.picks.map(p => p.topUp.id));
  const row = (t) => {
    const units = choices[t.id] || suggested.picks.find(p => p.topUp.id === t.id)?.units || 1;
    const on = (choices[t.id] || 0) > 0;
    const tt = topUpTotals(t, units);
    return `<li class="topup${on ? " is-on" : ""}">
      <label class="check">
        <input type="checkbox" data-topup="${esc(t.id)}" data-units="${units}" ${on ? "checked" : ""}>
        <span><strong>${esc(t.name)}</strong> <span class="pill ${t.primary_macro}">${t.primary_macro}</span><br>
        <small>${esc(unitsText(units, t.unit))} · ${fmt(tt.calories)} kcal · P ${fmt1(tt.protein)} · C ${fmt1(tt.carbs)} · F ${fmt1(tt.fats)}</small></span>
      </label>
      <span class="stepper-mini" role="group" aria-label="Units of ${esc(t.name)}">
        <button type="button" class="icon-btn sm" data-topup-step="-1" data-id="${esc(t.id)}" aria-label="One less ${esc(t.name)}">−</button>
        <span class="u">${units}</span>
        <button type="button" class="icon-btn sm" data-topup-step="1" data-id="${esc(t.id)}" aria-label="One more ${esc(t.name)}">+</button>
      </span>
    </li>`;
  };
  const top = eligible.filter(t => suggestedIds.has(t.id) || (choices[t.id] || 0) > 0);
  const rest = eligible.filter(t => !top.includes(t));
  const head = triggered && suggested.picks.length
    ? `Suggested top-ups to close a ${Math.round(suggested.deficitPct * 100)}% gap`
    : top.length ? "Your top-ups" : "Need a little more? Add a top-up";
  return `<section class="balancer" data-balancer="${id}" aria-label="Deficit balancer">
    <h4>${esc(head)}</h4>
    ${top.length ? `<ul class="topups">${top.map(row).join("")}</ul>` : ""}
    <details class="more-topups"${!top.length && triggered ? " open" : ""}><summary>${top.length ? "More top-ups" : "Show top-ups"} (${rest.length})</summary>
      <ul class="topups">${rest.map(row).join("")}</ul></details>
  </section>`;
}

function initResults() {
  $("#dayStrip").addEventListener("click", (e) => {
    const b = e.target.closest("[data-day]");
    if (!b) return;
    state.day = Number(b.dataset.day);
    renderWeek(); save();
  });
  $("#dayStrip").addEventListener("keydown", (e) => {
    if (!["ArrowLeft", "ArrowRight"].includes(e.key)) return;
    e.preventDefault();
    state.day = (state.day + (e.key === "ArrowRight" ? 1 : 6)) % 7;
    renderWeek(); save();
    $(`[data-day="${state.day}"]`).focus();
  });

  $("#dayCard").addEventListener("click", (e) => {
    const rb = e.target.closest("[data-recipe]");
    if (rb) { openRecipe(rb.dataset.recipe, { servings: num(rb.dataset.servings) || 1, from: "plan" }); return; }
    const sb = e.target.closest("[data-swap]");
    if (sb) { swapMeal(sb.dataset.swap, sb.dataset.slot); return; }
    const rs = e.target.closest("[data-reset-day]");
    if (rs) {
      Object.keys(state.swaps).filter(k => k.startsWith(rs.dataset.resetDay + "-")).forEach(k => delete state.swaps[k]);
      delete state.topups[rs.dataset.resetDay];
      renderResults(); save(); return;
    }
    const st = e.target.closest("[data-topup-step]");
    if (st) { stepTopUp(st.dataset.id, Number(st.dataset.topupStep)); }
  });
  $("#dayCard").addEventListener("change", (e) => {
    const cb = e.target.closest("[data-topup]");
    if (!cb) return;
    const day = current.plan.days[state.day];
    const choices = { ...dayChoices(day) };
    if (cb.checked) choices[cb.dataset.topup] = Number(cb.dataset.units) || 1; else delete choices[cb.dataset.topup];
    state.topups[day.index] = choices;
    refreshDay(cb.dataset.topup);
  });

  $("#editBtn").addEventListener("click", () => goStep(1));
  $("#copyBtn").addEventListener("click", copyPlan);
  $("#shareBtn").addEventListener("click", sharePlan);
  $("#printBtn").addEventListener("click", () => { renderPrint(); window.print(); });
  window.addEventListener("beforeprint", renderPrint);
}

function stepTopUp(id, delta) {
  const day = current.plan.days[state.day];
  const t = byId.topUps[id];
  const choices = { ...dayChoices(day) };
  const cur = choices[id] || 0;
  const n = Math.max(0, Math.min((t.max_units || 2) * 2, cur + delta));
  if (n > 0) choices[id] = n; else delete choices[id];
  state.topups[day.index] = choices;
  refreshDay(id);
}

/** Re-renders the day card and strip in place, keeping keyboard focus on the same control. */
function refreshDay(focusId) {
  const active = document.activeElement;
  const sel = active?.dataset?.topupStep ? `[data-topup-step="${active.dataset.topupStep}"][data-id="${CSS.escape(focusId)}"]` : `[data-topup="${CSS.escape(focusId)}"]`;
  const openMore = $$(".more-topups", $("#dayCard")).map(d => d.open);
  renderWeek();
  $$(".more-topups", $("#dayCard")).forEach((d, i) => { if (openMore[i]) d.open = true; });
  $(sel, $("#dayCard"))?.focus();
  save();
}

function swapMeal(key, slot) {
  const pool = slotPool(catalog.recipes, slot, state.profile);
  const day = current.plan.days[state.day];
  const meal = day.meals.find(m => m.slot === slot);
  if (!meal || pool.length < 2) return;
  const i = pool.findIndex(r => r.id === meal.recipe.id);
  const nextRecipe = pool[(i + 1) % pool.length];
  state.swaps[key] = nextRecipe.id;
  delete state.topups[day.index]; // new meal, fresh suggestions
  renderResults();
  save();
  toast(`Swapped to ${nextRecipe.title}`);
}

// ---------------------------------------------------------------- export
function planText() {
  const t = current.targets, plan = current.plan;
  if (!plan) return "";
  const lines = [`DietMaker plan: ${fmt(t.calories)} kcal · P ${t.protein} g · C ${t.carbs} g · F ${t.fats} g a day`, ""];
  for (const d of plan.days) {
    const fin = dayFinalTotals(d);
    lines.push(`${d.name.toUpperCase()} (${fmt(fin.calories)} kcal, ${fmt(fin.protein)} g protein)`);
    for (const m of d.meals) {
      lines.push(`- ${m.label}: ${m.recipe.title}, ${servingsText(m.servings)}${m.oil.tsp ? `, +${m.oil.tsp} tsp oil` : ""} (${fmt(m.totals.calories)} kcal)`);
    }
    const ch = dayChoices(d);
    const tops = Object.entries(ch).filter(([, n]) => n > 0).map(([id, n]) => `${byId.topUps[id]?.name} ×${n}`);
    if (tops.length) lines.push(`- Top-ups: ${tops.join(", ")}`);
    lines.push("");
  }
  lines.push("Estimates from the Mifflin-St Jeor equation; not medical advice.");
  return lines.join("\n");
}

async function copyPlan() {
  const text = planText();
  try { await navigator.clipboard.writeText(text); toast("Plan copied"); }
  catch {
    const ta = document.createElement("textarea");
    ta.value = text; document.body.append(ta); ta.select();
    try { document.execCommand("copy"); toast("Plan copied"); } catch { toast("Couldn't copy; select and copy manually"); }
    ta.remove();
  }
}

async function sharePlan() {
  const text = planText();
  if (navigator.share) {
    try { await navigator.share({ title: "My DietMaker plan", text }); return; }
    catch (err) { if (err && err.name === "AbortError") return; }
  }
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener");
}

function renderPrint() {
  const t = current.targets, plan = current.plan;
  if (!plan) { $("#printArea").innerHTML = ""; return; }
  $("#printArea").innerHTML = `<h1>DietMaker 7-day plan</h1>
    <p>${fmt(t.calories)} kcal · Protein ${t.protein} g · Carbs ${t.carbs} g · Fat ${t.fats} g a day (${esc(GOALS[t.goal].label)})</p>
    ${plan.days.map(d => {
      const fin = dayFinalTotals(d);
      const ch = dayChoices(d);
      const tops = Object.entries(ch).filter(([, n]) => n > 0);
      return `<section class="print-day"><h2>${esc(d.name)} <small>${fmt(fin.calories)} kcal · P ${fmt(fin.protein)} · C ${fmt(fin.carbs)} · F ${fmt(fin.fats)}</small></h2>
      <table><tbody>${d.meals.map(m => `<tr><th>${esc(m.label)}</th><td>${esc(m.recipe.title)}<br><small>${servingsText(m.servings)}${m.oil.tsp ? ` · +${m.oil.tsp} tsp oil` : ""}</small></td><td>${fmt(m.totals.calories)} kcal</td></tr>`).join("")}
      ${tops.map(([id, n]) => { const tu = byId.topUps[id]; return tu ? `<tr><th>Top-up</th><td>${esc(tu.name)} <small>${esc(unitsText(n, tu.unit))}</small></td><td>${fmt(tu.calories_per_unit * n)} kcal</td></tr>` : ""; }).join("")}
      </tbody></table></section>`;
    }).join("")}
    <p class="small">${esc($("#resultsDisclaimer").textContent.trim())}</p>`;
}

// ---------------------------------------------------------------- recipe drawer
function openRecipe(id, { servings = 1, from = "pantry" } = {}) {
  const r = byId.recipes[id];
  if (!r) return;
  const setting = state.profile.setting || "home";
  const oil = oilAllowance(r, setting);
  const ing = scaledIngredients(r, servings, byId.ingredients);
  const tot = recipeTotals(r, servings, setting);

  $("#modalKicker").innerHTML = `${markHtml(r.diet)} ${esc(MEAL_LABEL[r.meal_type])} · ${r.prep_minutes} min${servings !== 1 ? ` · ${servingsText(servings)}` : ""}`;
  $("#modalTitle").textContent = r.title;
  const allergens = (r.allergens || []).length ? `<p class="small muted">Contains: ${r.allergens.map(a => EXCL_LABEL[a]).join(", ")}.</p>` : "";
  const pantryNote = from === "pantry" ? pantryMissingNote(r) : "";

  $("#modalBody").innerHTML = `
    <div class="macro-chips" id="modalTotals">${macroChips(tot)}</div>
    ${pantryNote}
    <h3>Ingredients</h3>
    <ul class="ing-list">
      ${ing.map(i => `<li><span>${esc(i.name)}</span><span class="qty">${servings === 1 ? esc(i.quantity) : `${i.scaledGrams} g <small>(${esc(i.quantity)} per serving)</small>`}</span></li>`).join("")}
      ${oil.tsp ? `<li class="oil-row"><span>Cooking oil (allowance)</span><span class="qty">${oil.tsp} tsp · ${oil.calories} kcal · ${oil.fats} g fat</span></li>` : `<li class="oil-row"><span>Cooking oil</span><span class="qty">none needed</span></li>`}
    </ul>
    ${r.pantry_staples?.length ? `<p class="small muted">Pantry staples: ${r.pantry_staples.map(esc).join(", ")}.</p>` : ""}
    ${allergens}
    <h3>Method</h3>
    <ol class="steps">${r.instructions.map(s => `<li>${esc(s)}</li>`).join("")}</ol>
    ${from === "pantry" ? `<div id="modalBalancer"></div>` : ""}
    <p class="small muted">Macros are for ${servingsText(servings)} and include the oil allowance for ${setting === "hostel" ? "mess" : "home"} cooking.</p>`;

  if (from === "pantry") renderModalBalancer(r);
  const dlg = $("#recipeModal");
  if (!dlg.open) dlg.showModal();
  $("#modalClose").focus();
}

function macroChips(t) {
  return `<span class="mchip"><b>${fmt(t.calories)}</b> kcal</span><span class="mchip protein"><b>${fmt1(t.protein)}</b> g protein</span><span class="mchip carbs"><b>${fmt1(t.carbs)}</b> g carbs</span><span class="mchip fats"><b>${fmt1(t.fats)}</b> g fat</span>`;
}

// Meal-level balancer state for the open pantry recipe.
let modalState = null;

function mealTarget(mealType) {
  const t = current.targets?.mode === "plan" ? current.targets : computeTargets(state.profile);
  const kcal = num(state.pantry.mealKcal);
  const prot = num(state.pantry.mealProtein);
  if (t.mode === "plan") {
    const slot = slotsFor(t.calories).find(s => s.key === mealType) || { share: 0.3 };
    return {
      calories: kcal || Math.round(t.calories * slot.share),
      protein: prot || Math.round(t.protein * slot.share),
      carbs: Math.round(t.carbs * slot.share),
      fats: Math.round(t.fats * slot.share)
    };
  }
  const k = kcal || 600;
  return { calories: k, protein: prot || 30, carbs: Math.round((k * 0.5) / 4), fats: Math.round((k * 0.25) / 9) };
}

function renderModalBalancer(r) {
  const setting = state.profile.setting || "home";
  const base = recipeTotals(r, 1, setting);
  const target = mealTarget(r.meal_type);
  const eligible = eligibleTopUps(catalog.topUps, state.profile);
  const suggested = balance({ target, current: base, topUps: eligible, rotate: 0, maxDistinct: 3, force: true });
  if (!modalState || modalState.id !== r.id) {
    modalState = { id: r.id, base, target, eligible, suggested, choices: Object.fromEntries(suggested.picks.map(p => [p.topUp.id, p.units])) };
  }
  drawModalBalancer();
}

function drawModalBalancer() {
  const m = modalState;
  const after = applyChoices(m.base, m.choices, byId.topUps);
  const gap = (m.target.calories - m.base.calories) / m.target.calories;
  const head = gap > 0.05
    ? `<p class="note warn">This dish gives ${fmt(m.base.calories)} kcal against your ${fmt(m.target.calories)} kcal meal target (${Math.round(gap * 100)}% short).</p>`
    : `<p class="note ok">This dish covers your ${fmt(m.target.calories)} kcal meal target.</p>`;
  $("#modalBalancer").innerHTML = `<h3>Deficit balancer</h3>${head}
    ${balancerWidget({ id: "modal", choices: m.choices, suggested: m.suggested, eligible: m.eligible, triggered: gap > 0.05 })}
    <div class="totals">${totalsHtml(after, m.target).replace("Day total", "Meal total with top-ups")}</div>`;
}

function initModal() {
  const dlg = $("#recipeModal");
  $("#modalClose").addEventListener("click", () => dlg.close());
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
  dlg.addEventListener("close", () => { modalState = null; });
  $("#modalBody").addEventListener("change", (e) => {
    const cb = e.target.closest("[data-topup]");
    if (!cb || !modalState) return;
    if (cb.checked) modalState.choices[cb.dataset.topup] = Number(cb.dataset.units) || 1; else delete modalState.choices[cb.dataset.topup];
    const openMore = $(".more-topups", $("#modalBalancer"))?.open;
    drawModalBalancer();
    if (openMore) $(".more-topups", $("#modalBalancer")).open = true;
    $(`[data-topup="${CSS.escape(cb.dataset.topup)}"]`, $("#modalBalancer"))?.focus();
  });
  $("#modalBody").addEventListener("click", (e) => {
    const st = e.target.closest("[data-topup-step]");
    if (!st || !modalState) return;
    const id = st.dataset.id, t = byId.topUps[id];
    const cur = modalState.choices[id] || 0;
    const n = Math.max(0, Math.min((t.max_units || 2) * 2, cur + Number(st.dataset.topupStep)));
    if (n > 0) modalState.choices[id] = n; else delete modalState.choices[id];
    const openMore = $(".more-topups", $("#modalBalancer"))?.open;
    drawModalBalancer();
    if (openMore) $(".more-topups", $("#modalBalancer")).open = true;
    $(`[data-topup-step="${st.dataset.topupStep}"][data-id="${CSS.escape(id)}"]`, $("#modalBalancer"))?.focus();
  });
}

// ---------------------------------------------------------------- pantry
function pantryMatches() {
  const sel = new Set(state.pantry.selected);
  if (!sel.size) return [];
  return catalog.recipes
    .filter(r => recipeAllowed(r, state.profile))
    .map(r => {
      const missing = r.ingredient_ids.filter(id => !sel.has(id) && byId.ingredients[id]?.category !== "staple");
      const have = r.ingredient_ids.length - missing.length;
      return { r, missing, have };
    })
    .filter(x => x.missing.length <= 1 && x.have > 0)
    .sort((a, b) => a.missing.length - b.missing.length || b.have - a.have || b.r.protein - a.r.protein || a.r.id.localeCompare(b.r.id));
}

function pantryMissingNote(r) {
  const sel = new Set(state.pantry.selected);
  const missing = r.ingredient_ids.filter(id => !sel.has(id));
  if (!sel.size) return "";
  if (!missing.length) return `<p class="badge-line"><span class="badge green">100% pantry match</span></p>`;
  return `<p class="badge-line"><span class="badge amber">Missing ${missing.length}: ${missing.map(id => esc(byId.ingredients[id]?.name || id)).join(", ")}</span></p>`;
}

// Chips follow the planner's diet and exclusions, like the dishes do.
function ingredientAllowed(i) {
  return recipeAllowed({ diet: i.diet || "veg", allergens: i.allergens || [] }, state.profile);
}

function renderChips() {
  const q = state.pantry.query.trim().toLowerCase();
  const sel = new Set(state.pantry.selected);
  const groups = GROUPS.map(g => {
    const items = catalog.ingredients.filter(i => i.category === g.key && i.pantry !== false && ingredientAllowed(i)
      && (!q || i.name.toLowerCase().includes(q) || i.id.includes(q)));
    if (!items.length) return "";
    return `<div class="chip-group"><h3>${esc(g.label)}</h3><div class="chips">
      ${items.map(i => `<button type="button" class="chip${sel.has(i.id) ? " is-on" : ""}" aria-pressed="${sel.has(i.id)}" data-ing="${esc(i.id)}">${esc(i.name)}</button>`).join("")}
    </div></div>`;
  }).join("");
  $("#chipGroups").innerHTML = groups || `<p class="muted small">No ingredient matches “${esc(state.pantry.query)}”.</p>`;
  $("#selectedCount").textContent = sel.size ? `${sel.size} selected` : "Nothing selected";
  $("#clearPantry").hidden = !sel.size;
}

function renderPantryResults() {
  const list = pantryMatches();
  const setting = state.profile.setting || "home";
  if (!state.pantry.selected.length) {
    $("#pantryResults").innerHTML = `<p class="empty">Pick a few ingredients to see what you can cook. Try <button type="button" class="link-btn" data-quick="egg,onion,tomato,atta">eggs, onion, tomato and atta</button> or <button type="button" class="link-btn" data-quick="rice,toor-dal,spinach,onion,tomato">rice, dal and palak</button>.</p>`;
    return;
  }
  if (!list.length) {
    $("#pantryResults").innerHTML = `<p class="empty">No dish fits yet. Add a grain (rice or atta) and a protein (dal, eggs, paneer or soya).</p>`;
    return;
  }
  $("#pantryResults").innerHTML = list.map(({ r, missing }) => {
    const tot = recipeTotals(r, 1, setting);
    const badge = missing.length
      ? `<span class="badge amber">Missing 1: ${esc(byId.ingredients[missing[0]]?.name || missing[0])}</span>`
      : `<span class="badge green">100% match</span>`;
    return `<button type="button" class="recipe-card" data-recipe="${esc(r.id)}">
      <span class="rc-top">${badge}<span class="rc-meal">${esc(MEAL_LABEL[r.meal_type])} · ${r.prep_minutes} min</span></span>
      <span class="rc-title">${markHtml(r.diet)} ${esc(r.title)}</span>
      <span class="rc-macros">${fmt(tot.calories)} kcal · P ${fmt(tot.protein)} g · C ${fmt(tot.carbs)} g · F ${fmt(tot.fats)} g</span>
    </button>`;
  }).join("");
}

function renderPantry() {
  if (!catalog) { $("#pantryResults").innerHTML = `<p class="muted">Loading dishes…</p>`; return; }
  $("#pantrySearch").value = state.pantry.query;
  renderChips();
  renderPantryResults();
  const p = state.profile;
  const bits = [DIET_LABEL[p.diet] + " dishes"];
  if (p.exclusions.length) bits.push("no " + p.exclusions.map(x => EXCL_LABEL[x]).join(", no "));
  $("#pantryPrefs").innerHTML = `Showing ${esc(bits.join(", "))}, oil counted for ${p.setting === "hostel" ? "mess" : "home"} cooking. <button type="button" class="link-btn" id="pantryEditPrefs">Change</button>`;
  const t = current.targets?.mode === "plan" ? current.targets : null;
  $("#mtKcal").placeholder = t ? String(Math.round(t.calories * 0.3)) : "600";
  $("#mtProtein").placeholder = t ? String(Math.round(t.protein * 0.3)) : "30";
  $("#mtKcal").value = state.pantry.mealKcal ?? "";
  $("#mtProtein").value = state.pantry.mealProtein ?? "";
  $("#mtHint").textContent = t
    ? "Left empty, each dish is compared with your plan's share for that meal (for example 30% of your day at lunch)."
    : "Left empty, a 600 kcal, 30 g protein meal is used. Build a plan to use your own numbers.";
}

function initPantry() {
  $("#pantrySearch").addEventListener("input", (e) => { state.pantry.query = e.target.value; renderChips(); save(); });
  $("#pantrySearch").addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const first = $("#chipGroups .chip");
    if (first) { toggleIngredient(first.dataset.ing); state.pantry.query = ""; $("#pantrySearch").value = ""; renderChips(); }
  });
  $("#chipGroups").addEventListener("click", (e) => {
    const c = e.target.closest("[data-ing]");
    if (!c) return;
    toggleIngredient(c.dataset.ing);
    $(`[data-ing="${CSS.escape(c.dataset.ing)}"]`)?.focus();
  });
  $("#clearPantry").addEventListener("click", () => { state.pantry.selected = []; renderChips(); renderPantryResults(); save(); });
  $("#pantryResults").addEventListener("click", (e) => {
    const q = e.target.closest("[data-quick]");
    if (q) { state.pantry.selected = q.dataset.quick.split(","); renderChips(); renderPantryResults(); save(); return; }
    const c = e.target.closest("[data-recipe]");
    if (c) openRecipe(c.dataset.recipe, { from: "pantry" });
  });
  $("#pantryPrefs").addEventListener("click", (e) => {
    if (e.target.id === "pantryEditPrefs") { setTab("planner"); goStep(3); }
  });
  $("#mtKcal").addEventListener("input", (e) => { state.pantry.mealKcal = num(e.target.value); save(); });
  $("#mtProtein").addEventListener("input", (e) => { state.pantry.mealProtein = num(e.target.value); save(); });
}

function toggleIngredient(id) {
  const s = new Set(state.pantry.selected);
  if (s.has(id)) s.delete(id); else s.add(id);
  state.pantry.selected = [...s];
  renderChips();
  renderPantryResults();
  save();
}

// ---------------------------------------------------------------- boot
async function boot() {
  initTheme();
  initTabs();
  initIntake();
  initResults();
  initModal();
  initPantry();

  $("#resumeBtn").hidden = !(state.step === 5 && step1Valid() && healthAnswered());
  setTab(state.tab);
  goStep(state.step === 5 && !(step1Valid() && healthAnswered()) ? 1 : state.step);

  catalog = await loadCatalog();
  byId = {
    ingredients: Object.fromEntries(catalog.ingredients.map(x => [x.id, x])),
    recipes: Object.fromEntries(catalog.recipes.map(x => [x.id, x])),
    topUps: Object.fromEntries(catalog.topUps.map(x => [x.id, x]))
  };
  // Drop saved choices that point at data that no longer exists.
  for (const [k, id] of Object.entries(state.swaps)) if (!byId.recipes[id]) delete state.swaps[k];
  state.pantry.selected = state.pantry.selected.filter(id => byId.ingredients[id]);

  $("#dataSource").textContent = catalog.source === "bundled"
    ? `Food data: built-in copy (${catalog.recipes.length} dishes).`
    : `Food data: live database (${catalog.recipes.length} dishes).`;

  if (state.step === 5) renderResults();
  if (state.tab === "pantry") renderPantry();
}

boot();
