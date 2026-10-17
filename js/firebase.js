/* ==========================================================================
   js/firebase.js
   Firestore (Firebase v10 modular Web SDK) client with a sessionStorage
   cache so a visitor costs a handful of reads per session, not per click.

   Fill in FIREBASE_CONFIG below (see DEPLOY.md, "1. Create the Firebase
   project"). While it still holds the REPLACE_ME placeholders, or when
   Firestore can't be reached, the app uses the bundled seed data from
   scripts/seed-firestore.mjs so it still works.
   ========================================================================== */

// ---- REPLACE THESE PLACEHOLDERS with your Firebase web app config ----------
// Firebase console > Project settings > General > Your apps > Web app > Config.
// These values are public identifiers, not secrets; access is controlled by
// the Firestore security rules in DEPLOY.md.
export const FIREBASE_CONFIG = {
  apiKey: "REPLACE_ME_API_KEY",
  authDomain: "REPLACE_ME_PROJECT_ID.firebaseapp.com",
  projectId: "REPLACE_ME_PROJECT_ID",
  storageBucket: "REPLACE_ME_PROJECT_ID.appspot.com",
  messagingSenderId: "REPLACE_ME_SENDER_ID",
  appId: "REPLACE_ME_APP_ID"
};
// -----------------------------------------------------------------------------

const SDK_VERSION = "10.12.2";
const SDK = `https://www.gstatic.com/firebasejs/${SDK_VERSION}`;
const CACHE_PREFIX = "dietmaker:fs:v1:";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const TIMEOUT_MS = 8000;

export const isConfigured = () =>
  !Object.values(FIREBASE_CONFIG).some(v => typeof v !== "string" || v.includes("REPLACE_ME"));

let dbPromise = null;
let fsApi = null;

/** Lazily loads the SDK and returns the Firestore instance (null when not configured). */
export async function getDb() {
  if (!isConfigured()) return null;
  if (!dbPromise) {
    dbPromise = (async () => {
      const [{ initializeApp, getApps }, firestore] = await Promise.all([
        import(`${SDK}/firebase-app.js`),
        import(`${SDK}/firebase-firestore.js`)
      ]);
      fsApi = firestore;
      const app = getApps()[0] || initializeApp(FIREBASE_CONFIG);
      return firestore.getFirestore(app);
    })().catch(err => { dbPromise = null; throw err; });
  }
  return dbPromise;
}

// ---------------------------------------------------------------- cache
function cacheGet(key) {
  try {
    const raw = sessionStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const { at, data } = JSON.parse(raw);
    if (Date.now() - at > CACHE_TTL_MS) { sessionStorage.removeItem(CACHE_PREFIX + key); return null; }
    return data;
  } catch { return null; }
}

function cacheSet(key, data) {
  try { sessionStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ at: Date.now(), data })); }
  catch { /* storage full or blocked: carry on without caching */ }
}

export function clearCache() {
  try {
    Object.keys(sessionStorage).filter(k => k.startsWith(CACHE_PREFIX)).forEach(k => sessionStorage.removeItem(k));
  } catch { /* ignore */ }
}

const withTimeout = (p, ms = TIMEOUT_MS) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("Firestore request timed out")), ms))]);

async function cached(key, fetcher) {
  const hit = cacheGet(key);
  if (hit) return hit;
  const data = await withTimeout(fetcher());
  cacheSet(key, data);
  return data;
}

const docsOf = (snap) => snap.docs.map(d => ({ id: d.id, ...d.data() }));
const strip = ({ seeded_at, ...rest }) => rest;

// ---------------------------------------------------------------- queries
export async function fetchCollection(name) {
  return cached(`col:${name}`, async () => {
    const db = await getDb();
    if (!db) throw new Error("Firebase not configured");
    const snap = await fsApi.getDocs(fsApi.collection(db, name));
    return docsOf(snap).map(strip);
  });
}

export const fetchIngredients = () => fetchCollection("ingredients");
export const fetchRecipes = () => fetchCollection("recipes");
export const fetchTopUps = () => fetchCollection("top_ups");

/** Recipes for one meal type (breakfast | lunch | snack | dinner). */
export async function fetchRecipesByMealType(mealType) {
  return cached(`recipes:meal:${mealType}`, async () => {
    const db = await getDb();
    if (!db) throw new Error("Firebase not configured");
    const q = fsApi.query(fsApi.collection(db, "recipes"), fsApi.where("meal_type", "==", mealType));
    return docsOf(await fsApi.getDocs(q)).map(strip);
  });
}

/** Recipes that use a given ingredient (array-contains on ingredient_ids). */
export async function fetchRecipesByIngredient(ingredientId) {
  return cached(`recipes:ing:${ingredientId}`, async () => {
    const db = await getDb();
    if (!db) throw new Error("Firebase not configured");
    const q = fsApi.query(fsApi.collection(db, "recipes"), fsApi.where("ingredient_ids", "array-contains", ingredientId));
    return docsOf(await fsApi.getDocs(q)).map(strip);
  });
}

/** Top-ups for one primary macro ('carb' | 'fat' | 'protein'). */
export async function fetchTopUpsByMacro(macro) {
  return cached(`topups:macro:${macro}`, async () => {
    const db = await getDb();
    if (!db) throw new Error("Firebase not configured");
    const q = fsApi.query(fsApi.collection(db, "top_ups"), fsApi.where("primary_macro", "==", macro));
    return docsOf(await fsApi.getDocs(q)).map(strip);
  });
}

export async function fetchRecipe(id) {
  return cached(`recipe:${id}`, async () => {
    const db = await getDb();
    if (!db) throw new Error("Firebase not configured");
    const snap = await fsApi.getDoc(fsApi.doc(db, "recipes", id));
    return snap.exists() ? strip({ id: snap.id, ...snap.data() }) : null;
  });
}

/** The seed script writes meta/catalog.version; a changed version drops the cache. */
async function checkVersion() {
  const db = await getDb();
  if (!db) return;
  const snap = await withTimeout(fsApi.getDoc(fsApi.doc(db, "meta", "catalog")), 4000);
  const version = snap.exists() ? snap.data().version : null;
  let stored = null;
  try { stored = sessionStorage.getItem(CACHE_PREFIX + "version"); } catch { /* ignore */ }
  if (version && version !== stored) {
    clearCache();
    try { sessionStorage.setItem(CACHE_PREFIX + "version", version); } catch { /* ignore */ }
  }
}

async function bundled() {
  const m = await import("../scripts/seed-firestore.mjs");
  return { ingredients: m.INGREDIENTS, recipes: m.RECIPES, topUps: m.TOP_UPS };
}

/**
 * Loads the whole catalog the app needs: { ingredients, recipes, topUps, source, error }.
 * source is "firestore", "cache" or "bundled".
 */
export async function loadCatalog() {
  if (!isConfigured()) return { ...(await bundled()), source: "bundled", error: "Firebase is not configured yet." };
  try {
    const hadCache = !!cacheGet("col:recipes");
    if (!hadCache) await checkVersion().catch(() => {});
    const [ingredients, recipes, topUps] = await Promise.all([fetchIngredients(), fetchRecipes(), fetchTopUps()]);
    if (!recipes.length || !ingredients.length || !topUps.length) throw new Error("Firestore collections are empty; run the seed script.");
    return { ingredients, recipes, topUps, source: hadCache ? "cache" : "firestore", error: null };
  } catch (err) {
    console.warn("[DietMaker] Using bundled data:", err.message);
    return { ...(await bundled()), source: "bundled", error: err.message };
  }
}
