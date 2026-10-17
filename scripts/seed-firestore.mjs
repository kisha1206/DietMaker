#!/usr/bin/env node
/* ==========================================================================
   scripts/seed-firestore.mjs
   Seeds the DietMaker Firestore database: `ingredients`, `recipes`, `top_ups`.

   This file is also the bundled data source: the browser imports its exports
   (INGREDIENTS, RECIPES, TOP_UPS) when Firestore is not configured or cannot
   be reached, so the site keeps working offline. Nothing here runs in a
   browser except the data definitions; the Admin SDK is only loaded in Node.

   Usage (from the repository root):
     npm install --no-save firebase-admin
     export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
     node scripts/seed-firestore.mjs                 # write all collections
     node scripts/seed-firestore.mjs --dry-run       # validate and print counts only
     node scripts/seed-firestore.mjs --project my-id # override the project id
     node scripts/seed-firestore.mjs --prune         # also delete docs not in this file

   Nutrition values are per 100 g of the raw / as-bought food, rounded from
   IFCT 2017 (National Institute of Nutrition, India) and USDA FoodData
   Central. Recipe macros are computed from these values for the listed raw
   quantities and EXCLUDE cooking oil; the calculator adds an explicit oil
   allowance for every cooked dish (see `oil_style`).
   ========================================================================== */

// --------------------------------------------------------------------------
// Ingredients
// category: protein | grain | veggie | dairy | staple   (chip groups use the first four)
// allergens: peanut | lactose | gluten
// diet: veg | egg | nonveg
// --------------------------------------------------------------------------
const I = (id, name, category, common_unit, kcal, protein, carbs, fats, extra = {}) => ({
  id, name, category, common_unit,
  calories_per_100g: kcal, protein_per_100g: protein, carbs_per_100g: carbs, fats_per_100g: fats,
  allergens: extra.allergens || [], diet: extra.diet || "veg", pantry: extra.pantry !== false
});

export const INGREDIENTS = [
  // Proteins
  I("egg", "Eggs", "protein", "1 egg (50 g)", 143, 12.6, 0.7, 9.5, { diet: "egg" }),
  I("egg-white", "Egg whites", "protein", "1 white (33 g)", 52, 10.9, 0.7, 0.2, { diet: "egg" }),
  I("chicken", "Chicken breast", "protein", "100 g raw, boneless", 120, 22.5, 0, 2.6, { diet: "nonveg" }),
  I("fish", "Fish (rohu / basa)", "protein", "100 g raw fillet", 111, 18, 0, 4, { diet: "nonveg" }),
  I("soya-chunks", "Soya chunks", "protein", "1 katori dry (30 g)", 345, 52, 33, 0.5),
  I("tofu", "Tofu", "protein", "100 g block", 76, 8, 1.9, 4.8),
  I("toor-dal", "Toor dal", "protein", "1 katori cooked (30 g raw)", 343, 22.3, 62.8, 1.7),
  I("moong-dal", "Moong dal", "protein", "1 katori cooked (30 g raw)", 348, 24.5, 59.9, 1.2),
  I("masoor-dal", "Masoor dal", "protein", "1 katori cooked (30 g raw)", 352, 24.6, 63.4, 1.1),
  I("urad-dal", "Urad dal", "protein", "2 tbsp (20 g)", 341, 25.2, 59, 1.6),
  I("rajma", "Rajma", "protein", "1 katori cooked (50 g raw)", 333, 23.6, 60, 0.8),
  I("kabuli-chana", "Kabuli chana", "protein", "1 katori cooked (50 g raw)", 364, 19.3, 60.6, 6),
  I("roasted-chana", "Roasted chana", "protein", "1 handful (30 g)", 369, 22.5, 58, 5.2),
  I("moong-sprouts", "Moong sprouts", "protein", "1 katori (100 g)", 30, 3, 5.9, 0.2),
  I("besan", "Besan (gram flour)", "protein", "4 tbsp (40 g)", 387, 22.4, 57.8, 6.7),
  I("peanuts", "Peanuts", "protein", "1 handful (20 g)", 567, 25.8, 16.1, 49.2, { allergens: ["peanut"] }),
  I("peanut-butter", "Peanut butter", "protein", "1 tbsp (16 g)", 588, 25, 20, 50, { allergens: ["peanut"] }),
  I("almonds", "Almonds", "protein", "10 almonds (12 g)", 579, 21.2, 21.6, 49.9),
  // Grains
  I("rice", "Rice", "grain", "1 katori cooked (50 g raw)", 345, 6.8, 78.2, 0.5),
  I("atta", "Atta (wheat flour)", "grain", "1 roti (30 g)", 341, 12.1, 69.4, 1.7, { allergens: ["gluten"] }),
  I("bread", "Whole wheat bread", "grain", "1 slice (30 g)", 247, 13, 41, 3.4, { allergens: ["gluten"] }),
  I("oats", "Rolled oats", "grain", "½ cup (40 g)", 389, 16.9, 66.3, 6.9, { allergens: ["gluten"] }),
  I("poha", "Poha", "grain", "1 cup (60 g)", 346, 6.6, 77.3, 1.2),
  // Veggies and fruit
  I("onion", "Onion", "veggie", "1 medium (80 g)", 40, 1.1, 9.3, 0.1),
  I("tomato", "Tomato", "veggie", "1 medium (100 g)", 18, 0.9, 3.9, 0.2),
  I("potato", "Potato", "veggie", "1 medium (100 g)", 77, 2, 17, 0.1),
  I("spinach", "Spinach (palak)", "veggie", "1 bunch (150 g)", 23, 2.9, 3.6, 0.4),
  I("capsicum", "Capsicum", "veggie", "1 medium (100 g)", 20, 0.9, 4.6, 0.2),
  I("carrot", "Carrot", "veggie", "1 medium (60 g)", 41, 0.9, 9.6, 0.2),
  I("cucumber", "Cucumber", "veggie", "1 medium (150 g)", 15, 0.7, 3.6, 0.1),
  I("cauliflower", "Cauliflower (gobi)", "veggie", "1 cup florets (100 g)", 25, 1.9, 5, 0.3),
  I("peas", "Green peas", "veggie", "½ cup (70 g)", 81, 5.4, 14.5, 0.4),
  I("banana", "Banana", "veggie", "1 medium (118 g)", 89, 1.1, 22.8, 0.3),
  I("apple", "Apple", "veggie", "1 medium (150 g)", 52, 0.3, 13.8, 0.2),
  // Dairy
  I("paneer", "Paneer", "dairy", "100 g", 265, 18.3, 1.2, 20.8, { allergens: ["lactose"] }),
  I("curd", "Curd (dahi)", "dairy", "1 katori (100 g)", 61, 3.5, 4.7, 3.3, { allergens: ["lactose"] }),
  I("milk", "Toned milk", "dairy", "1 glass (250 ml)", 58, 3.1, 4.8, 3, { allergens: ["lactose"] }),
  I("ghee", "Desi ghee", "dairy", "1 tsp (5 g)", 900, 0, 0, 100, { allergens: ["lactose"] }),
  // Staples (assumed in every kitchen, not shown as chips)
  I("oil", "Cooking oil", "staple", "1 tsp (5 g)", 884, 0, 0, 100, { pantry: false })
];

const ING = Object.fromEntries(INGREDIENTS.map(x => [x.id, x]));

// --------------------------------------------------------------------------
// Recipes. One serving each. `items`: [ingredient_id, raw grams, display quantity].
// settings: where the dish is realistic (home kitchen, hostel mess or stall).
// oil_style: none (not cooked in oil) | light (tadka / pan-fry) | rich (curry, mess gravy).
// --------------------------------------------------------------------------
const r1 = v => Math.round(v * 10) / 10;
const DIET_RANK = { veg: 0, egg: 1, nonveg: 2 };

function recipe(id, title, meal_type, { settings, oil_style, prep }, items, pantry_staples, instructions) {
  const tot = { k: 0, p: 0, c: 0, f: 0 };
  const allergens = new Set();
  let diet = "veg";
  const ingredients_detail = items.map(([ingredient_id, grams, quantity]) => {
    const x = ING[ingredient_id];
    if (!x) throw new Error(`Recipe ${id}: unknown ingredient ${ingredient_id}`);
    const m = grams / 100;
    tot.k += x.calories_per_100g * m; tot.p += x.protein_per_100g * m;
    tot.c += x.carbs_per_100g * m; tot.f += x.fats_per_100g * m;
    x.allergens.forEach(a => allergens.add(a));
    if (DIET_RANK[x.diet] > DIET_RANK[diet]) diet = x.diet;
    return { ingredient_id, grams, quantity };
  });
  return {
    id, title, meal_type,
    calories: Math.round(tot.k), protein: r1(tot.p), carbs: r1(tot.c), fats: r1(tot.f),
    prep_minutes: prep,
    ingredient_ids: [...new Set(items.map(i => i[0]))],
    ingredients_detail, pantry_staples, instructions,
    diet, allergens: [...allergens].sort(), settings, oil_style
  };
}

const HOME = ["home"], BOTH = ["home", "hostel"], MESS = ["hostel"];

export const RECIPES = [
  // ---------------- Breakfast ----------------
  recipe("masala-omelette-toast", "Masala Omelette with Toast", "breakfast", { settings: HOME, oil_style: "light", prep: 10 },
    [["egg", 150, "3 eggs"], ["onion", 40, "1 small onion, chopped"], ["tomato", 50, "½ tomato, chopped"], ["bread", 60, "2 slices whole wheat bread"]],
    ["oil", "salt", "haldi", "red chilli"],
    ["Whisk the eggs with salt, a pinch of haldi, chilli, onion and tomato.",
      "Heat the measured oil in a pan, pour in the egg mix and spread it thin.",
      "Cook for 2 minutes, flip and cook 1 minute more.",
      "Toast the bread on the same pan and serve together."]),
  recipe("overnight-oats-banana-pb", "Overnight Oats with Banana and Peanut Butter", "breakfast", { settings: BOTH, oil_style: "none", prep: 5 },
    [["oats", 50, "½ cup rolled oats"], ["milk", 250, "1 glass (250 ml) toned milk"], ["banana", 100, "1 banana, sliced"], ["peanut-butter", 16, "1 tbsp peanut butter"]],
    [],
    ["Mix the oats and milk in a jar or steel dabba.",
      "Cover and keep in the fridge overnight (or at least 4 hours).",
      "In the morning stir, top with banana and peanut butter and eat cold."]),
  recipe("poha-peanuts", "Kanda Poha with Peanuts", "breakfast", { settings: BOTH, oil_style: "light", prep: 15 },
    [["poha", 60, "1 cup thick poha"], ["peanuts", 15, "1 tbsp peanuts"], ["onion", 30, "½ onion, chopped"], ["peas", 30, "2 tbsp peas"], ["potato", 50, "½ small potato, diced"]],
    ["oil", "salt", "haldi", "rai", "curry leaves", "lemon"],
    ["Rinse the poha in a strainer, drain and leave for 5 minutes to soften.",
      "Heat the oil, roast the peanuts, then add rai and curry leaves.",
      "Add onion, potato and peas; cover and cook until the potato is soft.",
      "Add haldi and salt, fold in the poha, cook 2 minutes and finish with lemon."]),
  recipe("besan-chilla-curd", "Besan Chilla with Curd", "breakfast", { settings: HOME, oil_style: "light", prep: 15 },
    [["besan", 60, "6 tbsp besan"], ["onion", 30, "½ onion, chopped"], ["tomato", 30, "¼ tomato, chopped"], ["spinach", 30, "a handful of palak, chopped"], ["curd", 150, "1½ katori curd"]],
    ["oil", "salt", "ajwain", "red chilli"],
    ["Whisk besan with water into a pouring batter; add salt, ajwain and chilli.",
      "Stir in the onion, tomato and palak.",
      "Brush a hot tawa with the measured oil and spread a ladle of batter thin.",
      "Cook both sides until golden; makes 2 chillas. Serve with curd."]),
  recipe("idli-sambar", "Idli Sambar", "breakfast", { settings: BOTH, oil_style: "light", prep: 25 },
    [["rice", 60, "rice for 4 idlis"], ["urad-dal", 20, "2 tbsp urad dal"], ["toor-dal", 25, "2½ tbsp toor dal"], ["tomato", 40, "½ tomato"], ["carrot", 30, "½ carrot, diced"], ["onion", 20, "a few onion pieces"]],
    ["oil", "salt", "sambar masala", "rai", "curry leaves", "tamarind"],
    ["Soak the rice and urad dal separately for 4 hours, grind, mix and ferment overnight.",
      "Steam the batter in greased idli moulds for 10 to 12 minutes; makes 4 idlis.",
      "Pressure-cook the toor dal; cook the vegetables with sambar masala and tamarind.",
      "Temper rai and curry leaves in the measured oil, pour over the sambar and serve."]),
  recipe("paneer-bhurji-roti", "Paneer Bhurji with Roti", "breakfast", { settings: HOME, oil_style: "light", prep: 20 },
    [["paneer", 80, "80 g paneer, crumbled"], ["onion", 40, "½ onion, chopped"], ["tomato", 50, "½ tomato, chopped"], ["capsicum", 30, "¼ capsicum, chopped"], ["atta", 60, "60 g atta (2 rotis)"]],
    ["oil", "salt", "haldi", "jeera", "garam masala"],
    ["Knead the atta and cook 2 rotis on a tawa.",
      "Heat the oil, add jeera, then onion and capsicum; cook until soft.",
      "Add tomato, haldi, salt and garam masala; cook until the tomato breaks down.",
      "Stir in the paneer, cook 2 minutes and serve with the rotis."]),
  recipe("moong-dal-chilla", "Moong Dal Chilla", "breakfast", { settings: HOME, oil_style: "light", prep: 20 },
    [["moong-dal", 60, "6 tbsp moong dal"], ["onion", 30, "½ onion, chopped"], ["tomato", 30, "¼ tomato, chopped"], ["spinach", 30, "a handful of palak, chopped"]],
    ["oil", "salt", "ginger", "green chilli"],
    ["Soak the moong dal for 2 hours, then grind with ginger, chilli and a little water.",
      "Stir in the onion, tomato, palak and salt.",
      "Brush a hot tawa with the measured oil and spread the batter thin.",
      "Cook both sides until crisp; makes 2 chillas."]),
  recipe("boiled-eggs-bread-banana", "Boiled Eggs, Bread and Banana", "breakfast", { settings: BOTH, oil_style: "none", prep: 12 },
    [["egg", 150, "3 eggs"], ["bread", 60, "2 slices whole wheat bread"], ["banana", 100, "1 banana"]],
    ["salt", "black pepper"],
    ["Boil the eggs for 9 to 10 minutes, then cool in water and peel.",
      "Slice, season with salt and pepper and eat with the bread and banana.",
      "In a hostel, boiled eggs from the canteen or a stall work the same."]),
  recipe("aloo-paratha-curd", "Aloo Paratha with Curd", "breakfast", { settings: BOTH, oil_style: "rich", prep: 30 },
    [["atta", 80, "80 g atta (2 parathas)"], ["potato", 100, "1 potato, boiled and mashed"], ["onion", 20, "2 tbsp onion, chopped"], ["curd", 100, "1 katori curd"]],
    ["oil", "salt", "ajwain", "red chilli", "amchur"],
    ["Mash the potato with onion, salt, chilli and amchur.",
      "Knead the atta with ajwain; roll 2 balls, fill with the potato and roll out.",
      "Cook on a hot tawa, brushing with the measured oil, until golden on both sides.",
      "Serve hot with curd."]),
  recipe("tofu-bhurji-toast", "Tofu Bhurji with Toast", "breakfast", { settings: HOME, oil_style: "light", prep: 15 },
    [["tofu", 150, "150 g tofu, crumbled"], ["onion", 40, "½ onion, chopped"], ["tomato", 50, "½ tomato, chopped"], ["capsicum", 30, "¼ capsicum, chopped"], ["bread", 60, "2 slices whole wheat bread"]],
    ["oil", "salt", "haldi", "jeera", "black pepper"],
    ["Heat the oil, add jeera, then onion and capsicum; cook until soft.",
      "Add tomato, haldi and salt and cook until soft.",
      "Add the crumbled tofu and pepper; stir-fry for 4 minutes.",
      "Serve with the bread toasted on the same pan."]),

  // ---------------- Lunch ----------------
  recipe("mess-thali-dal-sabzi", "Mess Thali: Roti, Rice, Dal, Aloo Gobi and Curd", "lunch", { settings: MESS, oil_style: "rich", prep: 5 },
    [["atta", 60, "2 rotis"], ["rice", 50, "1 small plate rice (150 g cooked)"], ["toor-dal", 30, "1 katori dal"], ["potato", 60, "½ katori aloo"], ["cauliflower", 60, "½ katori gobi"], ["curd", 100, "1 katori curd"], ["cucumber", 50, "salad: cucumber"], ["onion", 20, "salad: onion"]],
    ["oil", "salt", "spices"],
    ["Take 2 rotis and a small plate of rice.",
      "Ask for a full katori of dal; it is your main protein here.",
      "Take one katori of the sabzi and the curd, and fill the rest of the plate with salad.",
      "Skip the second helping of rice if you need fewer calories; add a roti if you need more."]),
  recipe("rajma-chawal-curd", "Rajma Chawal with Curd", "lunch", { settings: BOTH, oil_style: "rich", prep: 40 },
    [["rajma", 50, "1 katori rajma"], ["rice", 70, "1 plate rice (210 g cooked)"], ["onion", 40, "½ onion"], ["tomato", 60, "1 small tomato"], ["curd", 100, "1 katori curd"]],
    ["oil", "salt", "jeera", "ginger-garlic", "rajma masala"],
    ["Soak the rajma overnight and pressure-cook with salt for 6 to 7 whistles.",
      "Heat the oil, add jeera, onion and ginger-garlic; cook until brown.",
      "Add tomato and rajma masala, cook to a thick masala, add the rajma and simmer 10 minutes.",
      "Serve with steamed rice and curd."]),
  recipe("chole-rice", "Chole with Jeera Rice", "lunch", { settings: BOTH, oil_style: "rich", prep: 40 },
    [["kabuli-chana", 50, "1 katori chole"], ["rice", 70, "1 plate rice (210 g cooked)"], ["onion", 40, "½ onion"], ["tomato", 60, "1 small tomato"], ["cucumber", 50, "salad: cucumber"]],
    ["oil", "salt", "jeera", "chole masala", "ginger-garlic"],
    ["Soak the chana overnight and pressure-cook for 5 to 6 whistles.",
      "Heat the oil, add jeera, onion and ginger-garlic; cook until brown.",
      "Add tomato and chole masala, cook down, add the chana and simmer 10 minutes.",
      "Cook the rice with a little jeera and serve with cucumber."]),
  recipe("soya-curry-roti", "Soya Chunk Curry with Roti and Curd", "lunch", { settings: HOME, oil_style: "rich", prep: 30 },
    [["soya-chunks", 40, "40 g soya chunks (dry)"], ["atta", 80, "80 g atta (3 rotis)"], ["onion", 40, "½ onion"], ["tomato", 60, "1 small tomato"], ["curd", 100, "1 katori curd"]],
    ["oil", "salt", "haldi", "garam masala", "ginger-garlic"],
    ["Boil the soya chunks for 5 minutes, squeeze out the water.",
      "Heat the oil, cook onion and ginger-garlic, then tomato, haldi and garam masala.",
      "Add the soya and a cup of water; simmer 8 minutes.",
      "Serve with 3 rotis and curd."]),
  recipe("egg-curry-rice", "Egg Curry with Rice", "lunch", { settings: BOTH, oil_style: "rich", prep: 30 },
    [["egg", 100, "2 eggs, boiled"], ["rice", 70, "1 plate rice (210 g cooked)"], ["onion", 50, "1 small onion"], ["tomato", 60, "1 small tomato"]],
    ["oil", "salt", "haldi", "red chilli", "garam masala"],
    ["Boil the eggs for 10 minutes, peel and make a few slits.",
      "Heat the oil, cook the onion until brown, add tomato and spices.",
      "Add a cup of water and the eggs; simmer 8 minutes.",
      "Serve with steamed rice."]),
  recipe("chicken-curry-rice", "Chicken Curry with Rice", "lunch", { settings: BOTH, oil_style: "rich", prep: 35 },
    [["chicken", 150, "150 g chicken"], ["rice", 70, "1 plate rice (210 g cooked)"], ["onion", 50, "1 small onion"], ["tomato", 60, "1 small tomato"], ["curd", 50, "½ katori curd"]],
    ["oil", "salt", "haldi", "ginger-garlic", "garam masala"],
    ["Marinate the chicken in curd, salt and haldi for 15 minutes.",
      "Heat the oil, cook onion and ginger-garlic until brown, add tomato and spices.",
      "Add the chicken, cover and cook 15 to 18 minutes until done.",
      "Serve with steamed rice."]),
  recipe("palak-paneer-roti", "Palak Paneer with Roti", "lunch", { settings: HOME, oil_style: "rich", prep: 30 },
    [["paneer", 100, "100 g paneer, cubed"], ["spinach", 150, "1 bunch palak"], ["atta", 80, "80 g atta (3 rotis)"], ["onion", 40, "½ onion"], ["tomato", 40, "½ tomato"]],
    ["oil", "salt", "jeera", "garlic", "garam masala"],
    ["Blanch the palak for 2 minutes, cool and blend smooth.",
      "Heat the oil, add jeera, garlic and onion; cook, then add tomato.",
      "Add the palak purée, salt and garam masala; simmer 5 minutes.",
      "Add the paneer, cook 2 minutes and serve with 3 rotis."]),
  recipe("masoor-dal-chawal", "Masoor Dal Chawal with Salad", "lunch", { settings: BOTH, oil_style: "light", prep: 30 },
    [["masoor-dal", 40, "1 katori dal"], ["rice", 80, "1 plate rice (240 g cooked)"], ["onion", 30, "tadka onion"], ["tomato", 40, "½ tomato"], ["cucumber", 50, "salad: cucumber"]],
    ["oil", "salt", "haldi", "jeera", "garlic"],
    ["Pressure-cook the masoor dal with haldi and salt for 3 whistles.",
      "Make a tadka: jeera, garlic, onion and tomato in the measured oil.",
      "Pour the tadka over the dal and simmer 3 minutes.",
      "Serve with steamed rice and cucumber."]),
  recipe("fish-curry-rice", "Fish Curry with Rice", "lunch", { settings: BOTH, oil_style: "rich", prep: 30 },
    [["fish", 150, "150 g fish"], ["rice", 80, "1 plate rice (240 g cooked)"], ["onion", 40, "½ onion"], ["tomato", 50, "½ tomato"]],
    ["oil", "salt", "haldi", "red chilli", "mustard seeds"],
    ["Rub the fish with salt and haldi.",
      "Heat the oil, splutter mustard seeds, cook the onion, then tomato and chilli.",
      "Add a cup of water, bring to a boil and slide in the fish; cook 8 minutes.",
      "Serve with steamed rice."]),

  // ---------------- Snack ----------------
  recipe("roasted-chana-apple", "Roasted Chana and an Apple", "snack", { settings: BOTH, oil_style: "none", prep: 2 },
    [["roasted-chana", 40, "a big handful (40 g)"], ["apple", 150, "1 apple"]],
    [],
    ["Keep a jar of roasted chana in your room or bag.",
      "Eat a handful with an apple or any seasonal fruit."]),
  recipe("sprouts-chaat", "Sprouts Chaat", "snack", { settings: BOTH, oil_style: "none", prep: 10 },
    [["moong-sprouts", 150, "1½ katori sprouts"], ["onion", 30, "¼ onion, chopped"], ["tomato", 40, "½ tomato, chopped"], ["cucumber", 50, "¼ cucumber, chopped"], ["roasted-chana", 20, "2 tbsp roasted chana"]],
    ["salt", "chaat masala", "lemon"],
    ["Steam or boil the sprouts for 3 minutes if you like them soft.",
      "Mix with onion, tomato, cucumber and roasted chana.",
      "Season with salt, chaat masala and lemon."]),
  recipe("curd-banana-almonds", "Curd Bowl with Banana and Almonds", "snack", { settings: BOTH, oil_style: "none", prep: 3 },
    [["curd", 200, "2 katori curd"], ["banana", 100, "1 banana, sliced"], ["almonds", 10, "8 almonds, chopped"]],
    [],
    ["Whisk the curd until smooth.",
      "Top with sliced banana and chopped almonds."]),
  recipe("pb-toast-milk", "Peanut Butter Toast with Milk", "snack", { settings: BOTH, oil_style: "none", prep: 3 },
    [["bread", 30, "1 slice whole wheat bread"], ["peanut-butter", 16, "1 tbsp peanut butter"], ["milk", 200, "1 glass (200 ml) toned milk"]],
    [],
    ["Toast the bread and spread the peanut butter.",
      "Have it with a glass of milk."]),
  recipe("paneer-tikka", "Paneer Tikka", "snack", { settings: HOME, oil_style: "light", prep: 20 },
    [["paneer", 100, "100 g paneer, cubed"], ["capsicum", 50, "½ capsicum, squares"], ["onion", 40, "½ onion, squares"], ["curd", 30, "2 tbsp thick curd"]],
    ["oil", "salt", "tikka masala", "lemon"],
    ["Mix curd, salt and tikka masala; coat the paneer, capsicum and onion.",
      "Rest 15 minutes, then thread onto skewers or spread on a pan.",
      "Cook in the measured oil on a hot pan until charred on all sides; finish with lemon."]),
  recipe("boiled-eggs-apple", "Boiled Eggs with an Apple", "snack", { settings: BOTH, oil_style: "none", prep: 12 },
    [["egg", 100, "2 eggs"], ["apple", 150, "1 apple"]],
    ["salt", "black pepper"],
    ["Boil the eggs for 9 to 10 minutes, cool and peel.",
      "Season with salt and pepper and eat with the apple."]),
  recipe("soya-chaat", "Soya Chunk Chaat", "snack", { settings: BOTH, oil_style: "none", prep: 15 },
    [["soya-chunks", 30, "30 g soya chunks (dry)"], ["onion", 30, "¼ onion, chopped"], ["tomato", 40, "½ tomato, chopped"], ["cucumber", 50, "¼ cucumber, chopped"]],
    ["salt", "chaat masala", "lemon"],
    ["Boil the soya chunks for 5 minutes, drain and squeeze dry.",
      "Mix with onion, tomato and cucumber.",
      "Season with salt, chaat masala and lemon."]),
  recipe("chicken-tikka", "Chicken Tikka", "snack", { settings: BOTH, oil_style: "light", prep: 25 },
    [["chicken", 120, "120 g chicken, cubed"], ["curd", 30, "2 tbsp thick curd"], ["onion", 40, "½ onion, rings"]],
    ["oil", "salt", "tikka masala", "lemon"],
    ["Marinate the chicken in curd, salt and tikka masala for 20 minutes.",
      "Cook in the measured oil on a hot pan or grill for 10 to 12 minutes, turning.",
      "Serve with onion rings and lemon. From a dhaba, ask for it without butter."]),

  // ---------------- Dinner ----------------
  recipe("mess-roti-dal-sabzi", "Mess Dinner: Roti, Dal and Sabzi", "dinner", { settings: MESS, oil_style: "rich", prep: 5 },
    [["atta", 90, "3 rotis"], ["toor-dal", 30, "1 katori dal"], ["cauliflower", 80, "sabzi: gobi"], ["potato", 50, "sabzi: aloo"], ["peas", 30, "sabzi: matar"]],
    ["oil", "salt", "spices"],
    ["Take 3 rotis and a full katori of dal.",
      "Take one katori of the sabzi; skim off the oil floating on top if you can.",
      "Add salad if the mess has it."]),
  recipe("moong-khichdi-curd", "Moong Dal Khichdi with Curd", "dinner", { settings: BOTH, oil_style: "light", prep: 25 },
    [["rice", 50, "¼ cup rice"], ["moong-dal", 40, "4 tbsp moong dal"], ["carrot", 30, "½ carrot, diced"], ["peas", 30, "2 tbsp peas"], ["curd", 150, "1½ katori curd"]],
    ["oil", "salt", "haldi", "jeera", "hing"],
    ["Rinse the rice and dal together.",
      "Heat the oil in a pressure cooker, add jeera and hing, then the vegetables.",
      "Add rice, dal, haldi, salt and 3 cups of water; cook for 3 whistles.",
      "Serve with curd."]),
  recipe("egg-bhurji-roti", "Egg Bhurji with Roti", "dinner", { settings: BOTH, oil_style: "light", prep: 20 },
    [["egg", 150, "3 eggs"], ["onion", 50, "1 small onion, chopped"], ["tomato", 50, "½ tomato, chopped"], ["atta", 60, "60 g atta (2 rotis)"]],
    ["oil", "salt", "haldi", "jeera", "red chilli"],
    ["Knead the atta and cook 2 rotis on a tawa.",
      "Heat the oil, add jeera, then onion; cook until soft and add tomato and spices.",
      "Crack in the eggs and scramble on medium heat until just set.",
      "Serve hot with the rotis."]),
  recipe("soya-pulao-raita", "Soya Pulao with Raita", "dinner", { settings: HOME, oil_style: "light", prep: 30 },
    [["soya-chunks", 30, "30 g soya chunks (dry)"], ["rice", 70, "⅓ cup rice"], ["peas", 30, "2 tbsp peas"], ["carrot", 30, "½ carrot, diced"], ["curd", 100, "1 katori curd (raita)"]],
    ["oil", "salt", "jeera", "whole garam masala"],
    ["Soak the soya chunks in hot water for 10 minutes and squeeze dry.",
      "Heat the oil, add jeera and whole spices, then the vegetables and soya.",
      "Add the rinsed rice, salt and water; cook covered (or 2 whistles).",
      "Whisk the curd with salt and roasted jeera for raita."]),
  recipe("chicken-masala-roti", "Chicken Masala with Roti", "dinner", { settings: BOTH, oil_style: "rich", prep: 35 },
    [["chicken", 150, "150 g chicken"], ["onion", 50, "1 small onion"], ["tomato", 60, "1 small tomato"], ["atta", 80, "80 g atta (3 rotis)"]],
    ["oil", "salt", "haldi", "ginger-garlic", "garam masala"],
    ["Heat the oil, cook onion and ginger-garlic until brown.",
      "Add tomato, haldi, salt and garam masala; cook until thick.",
      "Add the chicken with a splash of water; cover and cook 15 to 18 minutes.",
      "Serve with 3 rotis."]),
  recipe("matar-paneer-roti", "Matar Paneer with Roti", "dinner", { settings: BOTH, oil_style: "rich", prep: 30 },
    [["paneer", 80, "80 g paneer, cubed"], ["peas", 50, "⅓ cup peas"], ["onion", 40, "½ onion"], ["tomato", 60, "1 small tomato"], ["atta", 80, "80 g atta (3 rotis)"]],
    ["oil", "salt", "haldi", "jeera", "garam masala"],
    ["Blend the onion and tomato to a paste.",
      "Heat the oil, add jeera, then the paste and spices; cook until the oil separates.",
      "Add the peas and a cup of water, simmer 8 minutes, then add the paneer.",
      "Serve with 3 rotis."]),
  recipe("tofu-veg-rice", "Tofu and Vegetable Stir-fry with Rice", "dinner", { settings: HOME, oil_style: "light", prep: 20 },
    [["tofu", 150, "150 g tofu, cubed"], ["capsicum", 50, "½ capsicum, sliced"], ["carrot", 50, "1 small carrot, sliced"], ["onion", 40, "½ onion, sliced"], ["rice", 70, "⅓ cup rice"]],
    ["oil", "salt", "garlic", "black pepper"],
    ["Cook the rice.",
      "Pan-fry the tofu in the measured oil until golden; set aside.",
      "Stir-fry garlic, onion, carrot and capsicum on high heat for 4 minutes.",
      "Add the tofu, salt and pepper, toss and serve over the rice."]),
  recipe("fish-fry-dal-rice", "Fish Fry with Dal and Rice", "dinner", { settings: BOTH, oil_style: "rich", prep: 30 },
    [["fish", 125, "125 g fish"], ["rice", 70, "1 plate rice (210 g cooked)"], ["masoor-dal", 30, "1 katori dal"], ["onion", 20, "tadka onion"]],
    ["oil", "salt", "haldi", "red chilli", "jeera"],
    ["Rub the fish with salt, haldi and chilli; rest 10 minutes.",
      "Shallow-fry the fish in the measured oil, 3 minutes a side.",
      "Pressure-cook the masoor dal and finish with a jeera and onion tadka.",
      "Serve with steamed rice."]),
  recipe("dal-palak-rice", "Dal Palak with Rice", "dinner", { settings: BOTH, oil_style: "light", prep: 30 },
    [["toor-dal", 40, "1 katori dal"], ["spinach", 100, "⅔ bunch palak, chopped"], ["rice", 70, "1 plate rice (210 g cooked)"], ["onion", 30, "tadka onion"], ["tomato", 40, "½ tomato"]],
    ["oil", "salt", "haldi", "jeera", "garlic"],
    ["Pressure-cook the toor dal with haldi and salt for 3 whistles.",
      "Make a tadka with jeera, garlic, onion and tomato; add the palak and wilt it.",
      "Add the dal and simmer 5 minutes.",
      "Serve with steamed rice."])
];

// --------------------------------------------------------------------------
// Top-ups: single-macro additions the balancer adds when a day or meal is short.
// max_units caps how many the balancer suggests per day.
// --------------------------------------------------------------------------
const T = (id, name, primary_macro, unit, k, p, c, f, extra = {}) => ({
  id, name, primary_macro, unit,
  calories_per_unit: k, protein_per_unit: p, carbs_per_unit: c, fats_per_unit: f,
  diet: extra.diet || "veg", allergens: extra.allergens || [], max_units: extra.max || 2,
  settings: extra.settings || BOTH, note: extra.note || ""
});

export const TOP_UPS = [
  T("phulka", "Phulka", "carb", "1 phulka (25 g atta)", 85, 3, 17.4, 0.4, { allergens: ["gluten"], max: 3, note: "An extra phulka with lunch or dinner." }),
  T("steamed-rice", "Steamed Rice", "carb", "½ katori cooked (100 g)", 130, 2.7, 28, 0.3, { max: 2 }),
  T("banana", "Banana", "carb", "1 medium banana", 105, 1.3, 27, 0.4, { max: 2 }),
  T("banana-shake", "Banana Shake", "carb", "1 glass (250 ml milk + 1 banana)", 250, 9.1, 39, 7.9, { allergens: ["lactose"], max: 2, note: "Blend a banana with a glass of milk; best after training." }),
  T("roasted-chana", "Roasted Chana", "carb", "1 handful (30 g)", 111, 6.8, 17.4, 1.6, { max: 2 }),
  T("pb-roti", "Peanut Butter Roti", "fat", "1 phulka + 1 tbsp peanut butter", 179, 7, 20.6, 8.4, { allergens: ["peanut", "gluten"], max: 2 }),
  T("desi-ghee", "Desi Ghee", "fat", "1 tsp (5 g)", 45, 0, 0, 5, { allergens: ["lactose"], max: 3, note: "Stir into dal or on a roti." }),
  T("raw-almonds", "Raw Almonds", "fat", "10 almonds (12 g)", 69, 2.5, 2.6, 6, { max: 3 }),
  T("roasted-peanuts", "Roasted Peanuts", "fat", "1 handful (20 g)", 113, 5.2, 3.2, 9.8, { allergens: ["peanut"], max: 2 }),
  T("plain-curd", "Plain Curd", "protein", "1 katori (100 g)", 61, 3.5, 4.7, 3.3, { allergens: ["lactose"], max: 3 }),
  T("extra-milk", "Extra Milk", "protein", "1 glass (250 ml toned)", 145, 7.8, 12, 7.5, { allergens: ["lactose"], max: 2 }),
  T("egg-whites", "Boiled Egg Whites", "protein", "1 boiled egg white", 17, 3.6, 0.2, 0.1, { diet: "egg", max: 6, note: "Boil whole eggs and eat the whites." }),
  T("soya-chunks", "Soya Chunks", "protein", "25 g dry, boiled", 86, 13, 8.3, 0.1, { max: 2, note: "Boil for 5 minutes and add to dal or sabzi, or make chaat." }),
  T("paneer-cubes", "Paneer Cubes", "protein", "50 g", 132, 9.2, 0.6, 10.4, { allergens: ["lactose"], max: 2 })
];

// --------------------------------------------------------------------------
// Validation (used by --dry-run and before every write)
// --------------------------------------------------------------------------
export function validate() {
  const errors = [];
  const ids = new Set();
  for (const [name, list] of [["ingredients", INGREDIENTS], ["recipes", RECIPES], ["top_ups", TOP_UPS]]) {
    ids.clear();
    for (const d of list) {
      if (!d.id || ids.has(d.id)) errors.push(`${name}: duplicate or missing id ${d.id}`);
      ids.add(d.id);
    }
  }
  for (const rc of RECIPES) {
    if (!["breakfast", "lunch", "snack", "dinner"].includes(rc.meal_type)) errors.push(`${rc.id}: bad meal_type`);
    if (!rc.instructions.length) errors.push(`${rc.id}: no instructions`);
    const k = rc.protein * 4 + rc.carbs * 4 + rc.fats * 9;
    if (Math.abs(k - rc.calories) / rc.calories > 0.12) errors.push(`${rc.id}: calories ${rc.calories} disagree with macros (${Math.round(k)})`);
  }
  for (const t of TOP_UPS) {
    if (!["carb", "fat", "protein"].includes(t.primary_macro)) errors.push(`${t.id}: bad primary_macro`);
  }
  if (INGREDIENTS.length < 30) errors.push("need 30+ ingredients");
  if (RECIPES.length < 15) errors.push("need 15+ recipes");
  if (TOP_UPS.length < 8) errors.push("need 8+ top-ups");
  return errors;
}

// --------------------------------------------------------------------------
// Node entry point
// --------------------------------------------------------------------------
async function main() {
  const args = process.argv.slice(2);
  const dry = args.includes("--dry-run");
  const prune = args.includes("--prune");
  const pIdx = args.indexOf("--project");
  const projectId = pIdx >= 0 ? args[pIdx + 1] : process.env.FIREBASE_PROJECT_ID || undefined;

  const errors = validate();
  if (errors.length) {
    console.error("Seed data failed validation:\n  " + errors.join("\n  "));
    process.exit(1);
  }
  console.log(`Validated ${INGREDIENTS.length} ingredients, ${RECIPES.length} recipes, ${TOP_UPS.length} top-ups.`);
  if (dry) {
    for (const rc of RECIPES) console.log(`  ${rc.meal_type.padEnd(9)} ${String(rc.calories).padStart(4)} kcal  ${String(rc.protein).padStart(5)} g P  ${rc.diet.padEnd(6)} ${rc.allergens.join(",") || "-"}  ${rc.title}`);
    return;
  }

  let admin;
  try {
    const { initializeApp, applicationDefault } = await import("firebase-admin/app");
    const { getFirestore } = await import("firebase-admin/firestore");
    admin = { initializeApp, applicationDefault, getFirestore };
  } catch {
    console.error("firebase-admin is not installed. Run: npm install --no-save firebase-admin");
    process.exit(1);
  }
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.error("Set GOOGLE_APPLICATION_CREDENTIALS to the path of a service-account JSON key (see DEPLOY.md).");
    process.exit(1);
  }

  admin.initializeApp({ credential: admin.applicationDefault(), ...(projectId ? { projectId } : {}) });
  const db = admin.getFirestore();
  const seededAt = new Date().toISOString();

  for (const [name, list] of [["ingredients", INGREDIENTS], ["recipes", RECIPES], ["top_ups", TOP_UPS]]) {
    // Firestore batches hold up to 500 writes.
    for (let i = 0; i < list.length; i += 400) {
      const batch = db.batch();
      for (const d of list.slice(i, i + 400)) batch.set(db.collection(name).doc(d.id), { ...d, seeded_at: seededAt });
      await batch.commit();
    }
    if (prune) {
      const keep = new Set(list.map(d => d.id));
      const snap = await db.collection(name).get();
      const stale = snap.docs.filter(d => !keep.has(d.id));
      for (const d of stale) await d.ref.delete();
      if (stale.length) console.log(`  removed ${stale.length} stale ${name} docs`);
    }
    console.log(`  wrote ${list.length} ${name}`);
  }
  // A version doc lets clients drop their sessionStorage cache when data changes.
  await db.collection("meta").doc("catalog").set({ version: seededAt });
  console.log(`Done. Catalog version ${seededAt}.`);
}

if (typeof window === "undefined" && typeof process !== "undefined" && process.argv?.[1]) {
  const { pathToFileURL } = await import("node:url");
  if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch(err => { console.error(err); process.exit(1); });
  }
}
