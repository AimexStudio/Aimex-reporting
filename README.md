# Aimex Studio — Client Marketing Dashboard

A standalone web app where Aimex Studio uploads each client's monthly marketing numbers as a CSV, and each client signs in to see only their own results.

Stack: Next.js 16 (App Router) + TypeScript + Tailwind CSS 4, Cloud Firestore through the Firebase Admin SDK, bcrypt-hashed passwords and signed HTTP-only session cookies. It uses its own Firebase project, separate from KeyGo or any other app.

## 1. Create the Firebase project (once)

1. Go to https://console.firebase.google.com and select **Create a project**. Name it something like `aimex-reports`. Google Analytics isn't needed.
2. In the project, open **Build → Firestore Database → Create database**. Choose a location near your clients (`africa-south1`, Johannesburg, if offered) and **production mode**.
3. Open the **Rules** tab, replace everything with the contents of `firestore.rules` from this folder, and select **Publish**. This blocks all direct access, so only the dashboard's server can read or write the data.
4. Open **Project settings** (gear icon) **→ Service accounts → Generate new private key**. Save the downloaded file into this folder as `firebase-service-account.json`. Treat it like a password: it's already excluded from git, and you should never email or share it.
5. Note the **Project ID** shown under Project settings → General.

## 2. Run it on your Mac

You need Node.js 20 or newer (`node -v` to check).

```bash
cd ~/Downloads/marketing-dashboard
npm install
cp .env.example .env
open -e .env
```

In `.env`, fill in `FIREBASE_PROJECT_ID`, `ADMIN_EMAIL` and `ADMIN_PASSWORD` (at least 10 characters, in double quotes). Generate the session secret with:

```bash
SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))") && sed -i '' "s|^SESSION_SECRET=.*|SESSION_SECRET=$SECRET|" .env
```

Then:

```bash
npm run check:firebase   # should print "✓ Connected to Firestore"
npm run setup            # creates your admin login in Firestore
npm run dev              # http://localhost:3000
```

Because the data lives in Firestore, the copy on your Mac and the hosted copy share the same clients and figures. Run `npm run setup` once and your admin login works in both places.

Want sample data first? `npm run db:demo` adds "Harbour & Vine Wine Co." with 12 months of figures and prints a client login. Delete it from the admin screen when you're done.

## Brand settings

All brand styling lives at the top of `src/app/globals.css`, in the block marked **BRAND SETTINGS**:

- `--color-brand`: Aimex Studio orange, `#E54019`, sampled from the logo. Used for highlights, chart focus and badges.
- `--color-night` and `--color-night-2`: the dark brand surfaces (header, results band, login panel).
- Headings use Montserrat in the uppercase "WHAT **WE OFFER**" style of aimexstudio.co.za.

The logo is `public/brand/logo-color.png` and is always shown in brand orange, on dark and light backgrounds. The browser tab icon (`src/app/icon.png`) is the orange A mark. To update the logo, replace those files, keeping the names.

## What clients see

- **Results band:** a plain-English headline, then "You invested → You received → Each lead cost" (or "invested → revenue → return" with a spend-versus-revenue bar for clients with sales data), plus your note for the month.
- **The numbers:** other key figures with month-on-month change and trend lines.
- **From views to leads:** a funnel from ad views to results. A middle step (like clicks) only appears when every channel in it reports that figure.
- **What worked best** (from platform exports broken down by ad, ad set, age or gender):
  - three plain-English takeaways
  - *Where the money went*: each ad's and targeting approach's share of spend against its share of results
  - best-performing ads with cost per result, and a comparison of targeting approaches
  - results by age (with cost per result), a gender split donut, and an age-and-gender heatmap
- **From the second month:** *Money in, results out* (monthly spend against results), *Cost per result* over time, and a month-by-month chart of any measure.
- **With two or more channels:** donuts for share of spend and share of results or revenue, plus a channel table.
- **Every number:** the full table, including cost per 1,000 impressions.

Figures that combine channels (cost per lead, ROAS, CTR, funnel steps) only use the channels that produced them, so Google spend is never divided by Meta leads.

## Full screen and printing

- The report uses the full width of the screen (capped on very wide monitors so it stays readable).
- **Full screen** in the report header hides the browser's toolbars, for presenting on a TV or projector. It's hidden on phones and on browsers that don't support it (iPhone).
- **Print** prints the month and dashboard currently on screen, or saves them as a PDF from the print dialog ("Save as PDF" / "Microsoft Print to PDF"). On paper:
  - the brand colours and dark results band are kept
  - buttons, tabs and the month picker are left out
  - every ad and the full "Every number" table are included, even if collapsed on screen
  - charts are resized to fit A4, and cards aren't split across pages
  - the footer shows the date it was printed

Pressing Cmd/Ctrl+P also works, but the **Print** button gives the best result because it resizes the charts first.

## Clients with several companies or streams

A client account can hold several **dashboards**, one per sub-company or stream (for example BRRV I, BRRV II and BRRV Rentals under "BRRV Group"). The client keeps one login.

- **Admin:** on the client's page, the **Dashboards** box shows a tab per dashboard. Use **+ Add dashboard** to create one, and rename or delete the selected one there. Uploads, months, notes and upload history all apply to the selected dashboard. Deleting a dashboard removes only its own data, and a client always keeps at least one.
- **Client:** with two or more dashboards, the client lands on an **Overview** of all companies combined (total spend, total results, blended cost per result, and a *Results by company* comparison), with a tab for each company's full report. With one dashboard they see exactly the single report, with no tabs.
- In the overview, month-on-month changes are only shown when the same companies have figures in both months; otherwise the report says why they're hidden.
- Clients created before dashboards existed have their data moved into a first dashboard (named after the client) automatically, the first time they're opened.

## Roles

| Role | Who | Can do |
| --- | --- | --- |
| **Super admin** | Aimex staff, managed on the **Team** page | Everything: all clients, every client's logins, uploads, notes and settings, and other super admins. |
| **Admin** (per client) | Someone at the client, added under the client's **Logins** with permission *Admin* | Views their own client's reports, and from **Manage this client's data** uploads CSVs, writes notes, insights and warnings, and edits goals, roadmap, benchmark, planner values and logo, for **their client only**. Can't see other clients, manage logins or delete the client. |
| **Viewer** (per client) | Added under **Logins** with permission *Viewer* | Views their own client's reports only. |

- Each client can have several logins. Super admins add them, change Viewer ↔ Admin, reset passwords and remove them on the client's page. Changing someone's permission signs them out so it applies immediately.
- Every page and action re-checks permission on the server, so a client admin can't reach another client even by editing a web address or form.
- If you're ever locked out completely, `npm run setup` recreates the super admin from `ADMIN_EMAIL` and `ADMIN_PASSWORD` in `.env`.

## The client report

The report has a sidebar with the client's logo, the reporting period, a company switcher (for groups) and these sections:

- **Overview:** results band (invested → leads → cost per lead, with the market benchmark), your monthly note and overview insights, figures, funnel, month-by-month charts, results by channel, the project roadmap, and every number.
- **One page per channel** (e.g. Meta Ads, Google Ads): that channel's own results band, insights and any warning box, its figures, a full campaign / ad set table (status, budget, optimisation score, reach and frequency where the export allows, clicks, CTR, CPC, results, spend, cost per result, conversion rate), and "What worked best".
- **Sales** (when sales figures have been entered): total, committed and available units and value, a table of units, value and size by status with percentages and totals, a donut of units by status, and what changed since the previous month's figures.
- **Goals:** each monthly target with last month vs this month and a progress bar.
- **ROI planner:** sliders for budget, cost per lead, lead-to-sale rate and average sale value, starting from the month's real figures, with projected leads, sales, sales value and return. Labelled as estimates.

The top bar shows the blended cost per lead and click-to-lead rate, plus **Full screen** and **Print**.

### What admins fill in (client page)

- **Months on file → Insights and warnings:** per month, choose Overview or a channel; write insights one per line (start with "Title:" to make the title bold), and optionally a warning title and details (shown as a red box). Goals entered by hand (like reservations) get their monthly figures here too.
- **Report settings:** market benchmark range, goals (from an uploaded figure or entered by hand, "at least" or "at most"), roadmap milestones (done, in progress, planned), and ROI planner starting values.
- **Sales figures:** choose a month and enter units, value (R) and size (m²) for each status (Available, Reserved, Sold, Granted and Bankable by default; rename, add or remove as needed). Leave value or size blank if not tracked. A new month starts from the latest saved figures. Super admins and the client's own admins can enter them.
- **Client logo:** PNG or JPG; it's resized automatically.

## Monthly workflow

1. In Admin, open the client (or **Add client** first; leave the password blank to generate one, then send the client the login details shown).
2. Under **Upload monthly data**, choose the month and one or more CSV files, for example a Meta export and a Google Ads export together. Each file gets its own preview and channel (filled in automatically for Meta and Google exports). If two files contain the same channel for the same month, or any file has a problem, nothing is imported until it's fixed.
3. Optionally write a note for the client. It appears at the top of their dashboard for that month.
4. Select **Import**. Their dashboard updates immediately. Uploading the same month again replaces it, so corrections are safe.

Use **See their dashboard** to check what the client will see.

To try an upload straight away, use a real Ads Manager export, or the `samples/` folder: `template.csv` (the simple format) and `messy-export-example.csv` (spreadsheet-style column names, rand amounts with spaces and commas, a Total row).

## CSV format

You can upload either of two kinds of file.

**A platform export as it comes**, from Meta Ads Manager or Google Ads (either "CSV" or "CSV (Excel)" download). Title lines above the column headings, like Google's "Campaign report" and date range, are skipped, and the month is read from that date range. Google's "Total: …" rows and "--" blanks are handled. For Google Ads, choose **Count conversions as: Leads** on the file if those conversions are form fills or calls, so they add up with Meta leads. Rows broken down by campaign, ad set, ad, age or gender are added up into one total per channel. The month is read from the "Reporting starts" date and the channel is detected (Meta Ads, Google Ads), or set with the Channel field in the upload form. Meta's "Results" column is saved as the right measure for its result type, so "Leads (form)" becomes leads and "Purchase" becomes conversions.

**A simple sheet with one row per channel**, as in `samples/template.csv`:

```csv
month,channel,spend,impressions,clicks,conversions,revenue,leads,sessions
2026-09,Google Ads,15000,120000,3400,180,92000,,
2026-09,Meta Ads,9000,310000,4100,95,41000,60,
2026-09,Website,,,,,,,8200
```

What the importer does with every file:

- Text columns (campaign names, ad names, age bands) are ignored. Only real number columns are imported.
- Common names are recognised: `amount spent`/`cost` → spend, `link clicks` → clicks, `purchases` → conversions, `conversion value` → revenue, and more (see `BASE_METRICS` in `src/lib/metrics.ts`). Currency in brackets like `(ZAR)` is ignored.
- Numbers like `R 16 250,50`, `$12,345.67` and `45%` are read correctly. Rows named "Total" are skipped.
- Averages and rates (frequency, CTR, CPC, CPM, cost per result, ROAS) are never added up. They're recalculated from the totals.
- Reach and website users are skipped when a channel is split across several rows, because the same people appear in more than one row. For accurate reach, export at campaign level with no breakdowns.
- Uploading replaces only the channels in the file for that month. A Meta upload never touches Google Ads figures already saved.
- Any other number column is kept as a custom metric under its column name.

The preview lists exactly what was combined, skipped and why, before anything is saved.

## How client data is kept separate

- A client account is tied to one client record. The client dashboard loads data using the ID stored on the signed-in account, never from the URL, so there is no address a client could change to reach someone else's data.
- Every admin page and every admin action checks for an admin session against the database. `src/proxy.ts` also redirects signed-out visitors, but security does not depend on it.
- Changing a client's password or deleting them signs them out everywhere immediately.
- Failed sign-ins are rate-limited (8 attempts per email and network per 15 minutes).

## How the data is stored

```
clients/{clientId}                                          name, currency, private notes
clients/{clientId}/dashboards/{dashboardId}                 a sub-company or stream
clients/{clientId}/dashboards/{dashboardId}/months/{YYYY-MM} every channel's figures for that month, plus the note
clients/{clientId}/dashboards/{dashboardId}/imports/{id}    upload history
users/{userId}                         logins (admin, or a client tied to one clientId)
emails/{email}                         keeps login emails unique
loginThrottle/{id}                     failed sign-in counters
```

Adding API integrations later: a Google Ads, Meta or GA4 sync only needs to call `saveImport()` in `src/lib/data.ts` with its own `source` value (for example `"google_ads"`). It writes into the same month documents, so the dashboards need no changes.

## Hosting it online

The app needs to run on a host that supports Next.js server features. Two good options:

**Firebase App Hosting (recommended).** It lives in the same Firebase project and needs no service-account key on the server, since Google connects it automatically. It requires the project to be on the pay-as-you-go **Blaze** plan; a dashboard this size normally stays within the free allowance.

1. Put this folder in a new **private** GitHub repository.
2. In the Firebase console open **Build → App Hosting → Get started**, connect the repository, and choose the `main` branch.
3. Add the session secret once, from this folder: `npx firebase-tools apphosting:secrets:set sessionSecret` (paste a new random string, generated as above). `apphosting.yaml` already points the app at it.
4. Each push to `main` deploys automatically. Your admin login is already in Firestore from `npm run setup`.

**Vercel.** Import the GitHub repository, then add these environment variables in the project settings: `SESSION_SECRET`, `FIREBASE_PROJECT_ID`, and `FIREBASE_SERVICE_ACCOUNT_BASE64` (run `npm run firebase:env` to print it). Note that Vercel's free Hobby plan is for non-commercial use, so client work needs the Pro plan.

Either way, the site is served over HTTPS, which the secure login cookie requires.

**Backups:** in the Google Cloud console, Firestore → Disaster recovery lets you schedule daily backups for the project.

## Useful commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Start locally with live reload |
| `npm run check:firebase` | Test the connection to Firestore |
| `npm run setup` | Create the admin account, or update its password from `.env` |
| `npm run firebase:env` | Print the service-account key as one line for a host's settings |
| `npm run db:demo` | Add the sample client with 12 months of data |
| `npm run build && npm start` | Production build and server |
| `npm run typecheck` | Check TypeScript |

## Project map

```
src/
  app/
    login/                 sign-in page and action
    dashboard/             client's own dashboard
    admin/                 clients list, add/edit client, upload, preview
      actions.ts           all admin server actions (each checks admin)
      _components/         admin forms and the CSV upload panel
  components/Dashboard.tsx the client-facing report (charts, figures, tables)
  db/types.ts              Firestore document shapes
  db/core.ts               Firestore connection and credentials
  lib/
    auth.ts                sessions and role checks
    csv.ts                 CSV parsing and validation
    metrics.ts             metric list, calculated rates, number formatting
    data.ts                every Firestore read and write
  proxy.ts                 redirects signed-out visitors
scripts/seed.ts            admin account and demo data
```
