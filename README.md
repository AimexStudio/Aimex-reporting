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

## Downloading uploaded files

Every upload made from now on keeps the file itself, stored with the client's dashboard in Firestore (in pieces of about 700 KB, so any size the upload accepts fits): data CSVs and Property24 PDFs under **Upload history**, sales and room sales files under their saved upload. Each has a **Download** link that returns the file as it was uploaded (CSVs saved as UTF-8; PDFs byte for byte). Deleting a sales or room sales upload deletes its file; deleting a client deletes everything.

Uploads from before files were kept show **Not kept** in the history. For those, **Download CSV** on any month or week (Months on file / Weeks on file), sales period or room sales report exports the stored figures in the portal's own upload layout, so the file can be uploaded again unchanged. It holds every figure the report uses, but not campaign-by-campaign tables.

Downloads are allowed for Aimex staff and for that client's own admins (`/admin/clients/<id>/download`), the same rule as uploading.

## Admin Report (ClickUp)

**Admin Report** (top navigation, after Team) shows the ClickUp tasks assigned to the token's owner, especially production work, without showing their name. Only super admins (Aimex staff, the same rule as the Team page) can open the page or its API routes; client logins get a redirect or 403.

- **Token:** ClickUp is called only by the server, with the token in `CLICKUP_API_TOKEN` (the team member's personal token: ClickUp → Settings → Apps → API Token). Locally, put it in `.env`. On Cloud Run, store it in Secret Manager as `clickup-api-token`; `npm run deploy:gcp` passes it to the service when that secret exists. Optional `CLICKUP_TEAM_ID` picks a workspace; otherwise the token's first workspace is used.
- **Routes:** `GET /admin/task-report/api/summary` (user, workspace, tasks; cached 5 minutes, `?refresh=1` skips the cache) and `GET /admin/task-report/api/comments/:taskId` (newest first; cached 10 minutes).
- **Rate limits:** outgoing requests are throttled to about 92 a minute. A 429 waits for ClickUp's reset and retries once, then shows a clear message; a 401 shows "ClickUp rejected the API token. Check CLICKUP_API_TOKEN."
- **Code:** `src/lib/clickup.ts` (server: token lookup in `getClickUpToken`, ready for per-member tokens later), `src/lib/task-report.ts` (the prototype's logic), `src/app/admin/task-report/` (page, component and routes).

## Meta total rows, reach and frequency

Meta exports often start with a **total row** (no campaign, ad set or ad name). It's left out of the sums, so figures aren't counted twice, and its **reach** is used as the channel's reach: it counts each person once, which adding up campaign reach can't. **Frequency** (impressions ÷ reach, the average number of times each person saw the ads) is worked out wherever reach is known: the Meta channel tiles, each campaign's row, the overview figures and "Every number". Without a total row, a file split across several rows has no reliable reach, so reach and frequency are left out and the preview says why. Budgets show "/ day" or "lifetime" only when the export says which.

## Removing a wrong upload, and "All channels"

Under **Months on file** (and **Weeks on file**), each period lists its channels with a **×** to remove just that channel's figures and notes from that period; the other channels stay. Uploads must say which channel they're for (a channel column, a recognised Meta / Google / Analytics export, or the Channel box): a file without one is refused rather than filed under "All channels".

To remove a channel from **every** client and dashboard at once (for example leftover "All channels" data), run from the project folder on your Mac:

```bash
npm run remove:channel -- "All channels"           # lists what would change
npm run remove:channel -- "All channels" --apply   # removes it
```

## Marketing channels banner

Super admins tick the channels each client uses under **Marketing channels** on the client's admin page (per dashboard): Google Business Profile (GMB), Meta Ads, Facebook Page, Instagram Page, Google Ads, RoomRaccoon and NightsBridge. They appear as a banner at the top of the report's **Overview**, grouped as advertising, social pages, listings and booking platforms. A group overview shows every channel used across its companies. With nothing ticked, no banner is shown. Client admins and viewers can't change the list; the save is checked on the server.

## Client categories: Developments and Spectrum Collection

Clients are grouped into two categories, shown as two sections on the Clients page:

- **Developments** (property developments): everything as described in this README, including **Sales figures** (unit sales by status).
- **Spectrum Collection** (hospitality): the same features, except that **Sales figures** is replaced by **Room sales**.

The category is chosen when adding a client ("+ Add to …" on each section pre-selects it) and can be changed under the client's **Client details**. Clients created before categories existed were sorted once: 9 on Barrack into Spectrum Collection, everyone else into Developments.

**Room sales (Spectrum Collection):** upload the hotel's daily dashboard CSV as exported. The reader takes the **Reporting date**, the monthly forecast table (Month, Rooms Available, OTB Rooms, OTB Revenue, plus Key Demand Driver, Commercial Priority, Rate Strategy and Sales / Marketing Action) and the daily OTB table (Date, Rooms Available, OTB Rooms, OTB Revenue, Value Focus, Rate Action, Sales Action). Each upload is kept under its reporting date (latest 60), so the report can show pickup between reports. Each report can carry **comments** (added with the upload or later), shown under the room sales summary. Occupancy, ADR and RevPAR are always worked out from rooms and revenue, and the preview warns when a month's figures disagree (e.g. a file's ADR not matching revenue ÷ rooms, or the monthly row not matching the daily rows).

The report's **Room sales** section is built for **weekly uploads that each cover about three months** (for example from RoomRaccoon or NightsBridge). Months are never added together:

- **This month:** the month of the reporting date: rooms on the books out of rooms available, occupancy, revenue, ADR and RevPAR, with pickup since the previous upload and a **projected month end**.
  The month's revenue is split into **Revenue so far** (nights already stayed, 1st of the month to the day before the reporting date) and **Booked, not yet stayed** (the reporting date to the month end), worked out from the daily rows. **Budget Variance** compares stayed + booked with the budget. Without matching daily rows, a single **Revenue on the books** tile is shown instead.
- **Months ahead:** each later month on its own row: on the books, occupancy, revenue, ADR, pickup since the previous upload, **booking pace** (rooms gained per week over up to the last four weeks of uploads) and its projected month end, with the month's priority, rate strategy, sales action and demand driver.
- **Booking pace:** occupancy on the books for each week ahead (Monday to Sunday, from the daily rows), from the first upload; from the second upload each week is shown next to the previous report, and a line per month shows how it built up across uploads. Without matching daily rows, it shows each month instead.
- **Daily inventory:** a daily chart coloured by value focus, opening on the week of the reporting date. Choose This week, Next week, Next 4 weeks, a month or All days, pick any From / To dates, or step through periods with the arrows; the line above the chart totals room nights sold, occupancy, revenue and ADR for the range. Shown only when the daily table matches the monthly figures (same rooms available); the upload preview warns otherwise.

**Budgets:** add a budget column to the monthly forecast table (any of: `Budget`, `Budget Revenue`, `Revenue Budget`, `Monthly Budget`, `Revenue Target`), with each month's revenue budget in rands. When this month has a budget, the report shows **Monthly Budget** and **Budget Variance** tiles; the outlook table shows each month's budget and how far revenue on the books is ahead or behind; the projection card shows each month as a percentage of its budget. Without the column, the budget tiles are left out. Nothing is assumed.

**Keys:** the number of rooms (keys) is worked out from the monthly figures: rooms available ÷ nights in the month (840 ÷ 30 = 28).

The projection is rooms on the books plus the month's weekly pace times the weeks left until its last night, capped at the rooms available; revenue is projected at the current ADR. It needs at least two uploads and is labelled as an estimate.

## Weekly and monthly uploads

Every upload is either **monthly** or **weekly**, chosen in the upload box's **Period** toggle (two calendar icons: month and week; their names show on hover). Both kinds sit side by side for every client, so a client can have, say, weekly Meta and Google reports and monthly Property24 figures.

- **Set automatically:** when the first file's own dates fall in a single week (a Meta, Google Ads or Google Analytics export for Monday to Sunday), the upload switches to **Weekly** and says so. Anything else stays **Monthly**. You can change it before importing.
- Weeks run **Monday to Sunday** (ISO weeks, e.g. "Week 41: 5 – 11 October 2026"). For weekly uploads the form asks for **any day in the week**; simple sheets can put a date (`2026-10-05`) or a week (`2026-W41`) in the month column.
- A file covering **more than one week** can't be uploaded as weekly, so a month of results can't land in one week. Property24 PDFs only have monthly figures, so they're monthly uploads only.
- The client's admin page lists **Months on file** and **Weeks on file** separately; notes, insights and warnings work for both.
- **The report** gets a **Monthly / Weekly** switch in its sidebar when the client has both. The weekly view reads "Week 41 results", "The week of 5 October brought in…", "vs last week", "Week by week"; goals and the ROI planner work per week. Sales figures stay monthly: the weekly view shows the month the week falls in.
- The clients list tags clients "Weekly" or "Monthly & weekly"; clients with only weekly uploads are flagged when last week is missing.

**Comparing periods:** totals are only compared with the previous period when the same channels have figures in both. If, say, Google Ads was uploaded this week but not last, the overview explains that instead of counting Google's results as growth. Each channel's own page still compares like with like.

## Full screen and printing

- The report uses the full width of the screen (capped on very wide monitors so it stays readable).
- **Full screen** in the report header hides the browser's toolbars, for presenting on a TV or projector. It's hidden on phones and on browsers that don't support it (iPhone).
- **Download** creates the **whole report** as one PDF for the month (or week) on screen as one document: the Overview, then each channel page, then Sales or Room sales, Goals and the ROI planner, each section starting on a new page. It opens the browser's save dialog: choose **Save as PDF** ("Microsoft Print to PDF" on Windows) as the destination. On paper:
  - the brand colours and dark results band are kept
  - buttons, tabs and the month picker are left out
  - every ad and the full "Every number" table are included, even if collapsed on screen
  - charts are resized to fit A4, and cards aren't split across pages
  - the footer shows the date it was printed

Pressing Cmd/Ctrl+P also works, but the **Download** button gives the best result because it resizes the charts first.

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

- **One login, several clients:** adding an email that already has a login (on a client's **Logins**, or as the first login of a new client) gives it access to that client too, keeping its password. Each client has its own permission (Viewer or Admin) for that login. Someone with several clients gets a **Client** switcher at the top of their report sidebar, and "Manage data" only for clients where they're an admin. Removing a login from a client only takes that client away; the login is deleted when it has no clients left, or when its last client is deleted.
- **Logins page (super admins):** **Add a login to several clients** at once (tick clients grouped by category, with "Select all" and a permission per client), and a table of every client login with the clients it can see.
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

The top bar shows the blended cost per lead and click-to-lead rate, plus **Full screen** and **Download**.

### What admins fill in (client page)

- **Months on file → Insights and warnings:** per month, choose Overview or a channel; write insights one per line (start with "Title:" to make the title bold), and optionally a warning title and details (shown as a red box). Goals entered by hand (like reservations) get their monthly figures here too.
- **Report settings:** market benchmark range, goals (from an uploaded figure or entered by hand, "at least" or "at most"), roadmap milestones (done, in progress, planned), and ROI planner starting values.
- **Sales figures:** uploaded as a CSV, monthly or weekly (calendar icon toggle). Two layouts are read: a **summary** with one row per status (status, units, value, size; percentage columns and a Total row are ignored, so a copy of the report's own table works) or a **unit list** with one row per unit and its status, value and size, which is counted and added up per status. A preview shows the totals before saving; re-uploading a period replaces it. Optional **comments** can be added with the upload or later ("Add comment" on a saved upload); they appear under the figures in the report and in the printed PDF, and are kept when a period is re-uploaded without a new comment. "Download the sales template" gives the summary layout. In the report, the Sales section follows the Monthly / Weekly view; a week without weekly sales figures shows the month's, and figures from a later period are never shown for an earlier one.
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

**A Property24 "Agency Statistics" PDF** (downloaded from Property24, not scanned): saved as the **Property24** channel, with listing views, listing leads (counted as leads), average active listings, alert emails and alerted listings, for **every month the report covers**. The report doesn't print a year, so its last month is read as the most recent such month up to today. A partly covered month (e.g. "1st – 11th Oct") is saved as month-to-date and marked, so no month-on-month changes are shown for it (or for the month after it) until a full report replaces it. Market share and the leads split by type appear only as charts in the PDF and can't be imported. Other PDFs are refused.

**A Google Analytics 4 "Reports snapshot"** (CSV download from the Reports snapshot page): saved as the **Website** channel, with active users, new users, sessions, average engagement time (and key events and revenue when tracked), plus the sessions-by-source table for the report's "Where your visitors came from" section. The month comes from the report's start and end dates.

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

**Branches:** add a `branch` column to a simple sheet to break a line into branches, sites or streams. Give each branch its own row with the same `channel` (e.g. InCase / GP North, InCase / GP East). The line's total is the sum of its branches, the overview shows "InCase (4 branches)", and the line's own page gets a "By branch" donut and table. If the branches don't add up to the line's real total, add a row such as "Other enquiries" for the difference.

The downloadable template is only for channels with no export of their own (for example email or offline campaigns). The unchanged template is refused, and a file can't repeat a channel and month that another file in the same upload already contains.

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

## Hosting on Google Cloud (Cloud Run)

The portal runs as a container on **Cloud Run**, in the same Google Cloud project as its Firestore database. On Cloud Run it reaches Firestore with its own identity (a service account), so **no key file is uploaded or needed**. The sign-in secret lives in **Secret Manager**.

**One-time, on your Mac:**

1. Install the Google Cloud CLI: https://cloud.google.com/sdk/docs/install (or `brew install --cask google-cloud-sdk`).
2. Sign in and choose the project that holds the Firestore database:
   ```bash
   gcloud auth login
   gcloud projects list
   gcloud config set project YOUR-PROJECT-ID
   ```
3. Billing must be on for that project (Firebase "Blaze" plan). Cloud Run's free allowance covers a small portal like this, so costs stay low.

**Deploy (first time and every update):**

```bash
npm run deploy:gcp
```

`scripts/deploy-gcp.sh` turns on the needed services, creates the site's identity (`aimex-reports-run`) with Firestore access, stores a sign-in secret (`session-secret`), builds the container from the `Dockerfile` and deploys service `aimex-reports` in **europe-west1 (Belgium)**, a region where Cloud Run can map custom domains directly (Johannesburg can't). It prints the live address (`https://aimex-reports-….run.app`). Later runs only publish the new code.

Notes:
- The Firestore data is the same as before, so clients, logins and figures all carry over. A new sign-in secret means everyone signs in once more.
- `.gcloudignore` / `.dockerignore` keep `.env` files and any service-account key out of uploads and images.
- To change region or name: `GCP_REGION=europe-west4 GCP_SERVICE=reports npm run deploy:gcp` (use the same `GCP_REGION` for the domain step).

**Custom domain:**

```bash
npm run domain:gcp -- reports.aimexstudio.co.za
```

The first time for a domain, Google asks you to prove you own it (a TXT record at your registrar); then run the command again. It creates the mapping and prints the DNS record (usually a CNAME to `ghs.googlehosted.com`) to add at your registrar. Google issues the HTTPS certificate automatically, usually within 15 minutes. Cloud Run's domain mapping works in europe-west1/4, europe-north1, us-central1/east1/east4/west1 and asia-east1/northeast1/southeast1.

