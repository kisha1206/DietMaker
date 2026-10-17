# Deploying DietMaker

DietMaker is a static site: plain HTML, CSS and ES modules with no build step. You can put it live today on a free `*.pages.dev` or `*.vercel.app` address and add your own domain later (section 5).

```
index.html
css/styles.css
js/app.js            UI, tabs, intake flow, pantry, localStorage
js/calculator.js     Mifflin-St Jeor engine, guardrails, 7-day plan
js/balancer.js       deterministic top-up balancer
js/firebase.js       Firestore client + sessionStorage cache  ← paste your config here
scripts/seed-firestore.mjs   seed data + Node seeding script
```

Until Firebase is configured the site uses the built-in copy of the data in `scripts/seed-firestore.mjs`, so it works from the first deploy. The footer says which source is in use ("built-in copy" or "live database").

---

## 1. Create the Firebase project

1. Go to <https://console.firebase.google.com> and click **Add project**. Name it (for example `dietmaker`). Google Analytics is optional.
2. **Build → Firestore Database → Create database.** Pick **Production mode** and a location close to your users (for India: `asia-south1` Mumbai). The location can't be changed later.
3. **Project settings (gear icon) → General → Your apps → Web (`</>`).** Register an app called `dietmaker-web`. Hosting is not needed.
4. Copy the `firebaseConfig` values it shows into `js/firebase.js`, replacing every `REPLACE_ME_…` value:

   ```js
   export const FIREBASE_CONFIG = {
     apiKey: "AIza…",
     authDomain: "dietmaker-xxxx.firebaseapp.com",
     projectId: "dietmaker-xxxx",
     storageBucket: "dietmaker-xxxx.appspot.com",
     messagingSenderId: "1234567890",
     appId: "1:1234567890:web:abc123"
   };
   ```

   These values are public identifiers, not passwords. Access is controlled by the security rules in step 2.

## 2. Firestore security rules (read-only for visitors)

**Firestore Database → Rules**, replace everything with this and click **Publish**:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{collection}/{docId} {
      allow read: if collection in ['ingredients', 'recipes', 'top_ups', 'meta'];
      allow write: if false;
    }
  }
}
```

Visitors can only read the four catalog collections. Nobody can write from the browser; only the seed script (which uses the Admin SDK and a service-account key) can change data.

Optional hardening: in Google Cloud Console → **APIs & Services → Credentials**, open the browser API key and add **Website restrictions** for your live address(es), e.g. `https://dietmaker.pages.dev/*` and later `https://yourdomain.in/*`.

## 3. Seed the database

You need Node.js 18 or newer.

1. **Project settings → Service accounts → Generate new private key.** Save the JSON file outside the repository (never commit it).
2. From the repository root:

   ```bash
   npm install --no-save firebase-admin
   export GOOGLE_APPLICATION_CREDENTIALS="$HOME/keys/dietmaker-service-account.json"
   node scripts/seed-firestore.mjs --dry-run     # validates the data and lists every dish
   node scripts/seed-firestore.mjs               # writes ingredients, recipes, top_ups, meta/catalog
   ```

   On Windows PowerShell use `$env:GOOGLE_APPLICATION_CREDENTIALS="C:\keys\dietmaker-service-account.json"`.

3. Re-run the script whenever you edit the data. Add `--prune` to also delete documents you removed from the file. Each run writes a new `meta/catalog.version`, and browsers drop their cached copy on the next session.

What gets seeded: 39 ingredients, 36 Indian dishes and 14 single-macro top-ups. Recipe macros are computed from the ingredient values, before cooking oil; the app adds the oil allowance (1 tsp for home cooking, 1 to 2 tsp for mess food) to every cooked dish.

**Read costs.** A first visit reads about 90 documents (3 collections + the version doc); after that the browser serves them from `sessionStorage` for 6 hours. Firestore's free tier is 50,000 reads a day, which covers roughly 500 new visitor sessions a day.

## 4. Run it locally

ES modules don't load from `file://`, so serve the folder:

```bash
npx http-server -c-1 .      # or: python3 -m http.server 8080
```

Then open <http://localhost:8080>. Check the footer: "live database" means Firestore is connected.

## 5. Deploy

### Option A: Cloudflare Pages (recommended for India: fast edge, free, unlimited bandwidth)

1. <https://dash.cloudflare.com> → **Workers & Pages → Create → Pages → Connect to Git**, pick `kisha1206/dietmaker`.
2. Build settings: **Framework preset: None**, **Build command:** leave empty, **Build output directory:** `/`.
3. **Save and Deploy.** The site is live at `https://<project>.pages.dev`. Every push to `main` redeploys; other branches get preview URLs.

### Option B: Vercel

1. <https://vercel.com/new> → import `kisha1206/dietmaker`.
2. **Framework Preset: Other**, no build command, output directory `.` (root).
3. **Deploy.** Live at `https://<project>.vercel.app`.

The existing GitHub Pages workflow (`.github/workflows/pages.yml`) keeps working too, since nothing needs building.

## 6. Custom domain DNS (when you buy one)

Use one host, not both. In the examples `yourdomain.in` is the apex and `www.yourdomain.in` is the www name. Pick one as the main address and redirect the other.

### Cloudflare Pages

Cloudflare Pages has no fixed IP, so it uses `CNAME` records only.

- **Apex (`yourdomain.in`)** must be on Cloudflare DNS. Add the domain to Cloudflare (**Websites → Add a site**, Free plan) and change the nameservers at your registrar (GoDaddy, Hostinger, BigRock, Namecheap…) to the two Cloudflare gives you. Wait until the zone shows **Active**.
- In **Workers & Pages → your project → Custom domains → Set up a custom domain**, add `yourdomain.in` and then `www.yourdomain.in`. Cloudflare creates these records itself:

  | Type  | Name  | Target               | Proxy   |
  |-------|-------|----------------------|---------|
  | CNAME | `@`   | `<project>.pages.dev` | Proxied |
  | CNAME | `www` | `<project>.pages.dev` | Proxied |

  (An apex CNAME is allowed on Cloudflare through CNAME flattening.)
- If you keep DNS at your registrar instead, only `www` can be connected: add `CNAME www → <project>.pages.dev` there, then add `www.yourdomain.in` under Custom domains. Use the registrar's URL forwarding to send the apex to `https://www.yourdomain.in`.
- Redirect the second name to the main one: **Rules → Redirect Rules**, e.g. `www.yourdomain.in/*` → `https://yourdomain.in/${1}`, status 301.

### Vercel

1. **Project → Settings → Domains → Add** `yourdomain.in`, choosing to redirect `www.yourdomain.in` to it (or the other way round).
2. At your registrar's DNS panel, add:

   | Type  | Name  | Value                  | TTL  |
   |-------|-------|------------------------|------|
   | A     | `@`   | `76.76.21.21`          | 3600 |
   | CNAME | `www` | `cname.vercel-dns.com` | 3600 |

   Delete any other `A`, `AAAA` or `CNAME` records for `@` and `www` (registrars often add parking records). Vercel's Domains page shows the exact values for your project; if they differ from the table, use Vercel's.
3. Vercel issues the HTTPS certificate once DNS resolves, usually within minutes; DNS changes can take up to 48 hours to spread.

### After the domain is live

- Add the new address to the API key's website restrictions (section 2) if you set them.
- Check `https://yourdomain.in` and `https://www.yourdomain.in` both load, one redirecting to the other, and the footer shows "live database".

## 7. Release checklist

- [ ] `js/firebase.js` has your real config (no `REPLACE_ME` left).
- [ ] Firestore rules published (read-only).
- [ ] `node scripts/seed-firestore.mjs` ran without errors.
- [ ] Site loads on the `pages.dev` / `vercel.app` address and the footer says "live database".
- [ ] Walk through all five steps on a phone: an under-18 profile can't pick "Lose fat", ticking a health condition shows the referral notice with no meal plan, and swaps survive a page reload.
