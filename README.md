# Budget OS

Shows the "Analysis from Gross Sales Report" tab from each location's sales
comparison workbook to the sales team, on any phone or desktop.

How it flows:

    Excel on Dropbox  ->  publisher/publish.py (office PC)  ->  public/data/*.json
                      ->  git push  ->  Cloudflare Workers Builds redeploys
                      ->  team opens the site

The app is plain HTML/JS, no build step. Everything the site serves lives in
`public/`; nothing outside it is published. `public/data/` is generated, so
don't hand-edit it.

The visual design follows `design-system/budget-os/MASTER.md`, generated with the
UI/UX Pro Max skill (Flat Design, blue + green palette, Fira Code for numbers,
Fira Sans for labels, dense dashboard spacing). Edit tokens in `style.css` `:root`
if you want to change colors; light and dark mode both come from those tokens.

## One-time setup

### 1. Get the repo on the office PC

    cd C:\Users\jonat
    git clone https://github.com/countryboysplay/Budget-OS.git
    cd Budget-OS\publisher
    pip install -r requirements.txt

Check `publisher/config.json`: `repo_dir` must be where you cloned, and each
location's `path` must match the file in Dropbox exactly.

### 2. Make git push work without a prompt

Do one push by hand so Git Credential Manager can save your login:

    cd C:\Users\jonat\Budget-OS
    python publisher\publish.py --once

The first push opens a GitHub sign-in window. After that, pushes are silent.
If you'd rather use a token, create a fine-grained token scoped to this repo
(Contents: read/write) and enter it as the password when prompted.

### 3. Cloudflare

The site is the `budget-os` Worker, serving `public/` as static assets.
`wrangler.jsonc` in the repo root is what tells it that, so the deploy needs no
build step.

1. Cloudflare dashboard -> Workers & Pages -> `budget-os` -> Settings -> Builds
2. Git repository must be **connected** to `countryboysplay/Budget-OS`. If it
   says "This project is disconnected from your Git account", hit **Manage** and
   re-authorize -- while it's disconnected, pushes land on GitHub and the site
   silently keeps serving the last deploy.
3. Production branch `main`, deploy command `npx wrangler deploy`, root `/`.
4. Every push to `main` then redeploys automatically.

To deploy by hand: `npx wrangler deploy` from the repo root.

### 4. Lock it down (Cloudflare Access)

1. Zero Trust -> Access -> Applications -> Add an application -> Self-hosted
2. Application domain: your `something.workers.dev` hostname
3. Add a policy: Action **Allow**, Include -> **Emails** (list each agent's
   email) or **Emails ending in** `@yourcompany.com`
4. Under Authentication, keep **One-time PIN** on. Agents enter their email,
   get a code, and they're in. Sessions last as long as you set (24h default).

Anyone not on the list sees a Cloudflare login page, not the data.

### 5. Run the publisher at logon

Already set up on the office PC as the scheduled task **Budget OS Publisher**.
It starts 30 seconds after you sign in and runs headless under `pythonw.exe` --
no console window. `publisher/budget-os-publisher-task.xml` is the definition,
so you can recreate it on another machine with:

    schtasks /Create /TN "Budget OS Publisher" /XML publisher\budget-os-publisher-task.xml /F

Two settings in there matter and are easy to lose if you rebuild the task by
hand in the Task Scheduler wizard:

- `ExecutionTimeLimit` is `PT0S` (unlimited). The wizard's default stops a task
  after 3 days, which would silently kill the publisher mid-week.
- `StopIfGoingOnBatteries` is false, so it keeps running on a laptop.

Managing it:

    schtasks /Query /TN "Budget OS Publisher" /V /FO LIST    is it registered?
    schtasks /Run   /TN "Budget OS Publisher"                start it now
    schtasks /End   /TN "Budget OS Publisher"                stop it

Because it's headless, `publisher/publisher.log` is the only place it speaks --
check there first. The publisher also refuses to start if another copy is
already running, so you can't end up with two instances racing each other on
`git commit`.

## Day to day

Save a workbook in Excel. Within about a minute the site shows the new numbers
and "updated just now". The status text turns amber if a location hasn't
published in two days.

`publisher/publisher.log` shows what the publisher did and any errors. It runs
headless, so that log is the only place it reports anything.

If the numbers on the site look stale, check in this order: the log (did the
publisher see the save?), then `git log` (did it commit and push?), then
Cloudflare's build history (did the push trigger a deploy?). A break in that
last link is silent -- pushes keep succeeding and the site keeps serving the
previous deploy.

## Commands

    python publish.py            publish all, then watch Dropbox for saves
    python publish.py --once     publish all and exit
    python publish.py --no-push  commit locally but don't push (testing)

These refuse to run while the scheduled task holds the lock; stop it first with
`schtasks /End /TN "Budget OS Publisher"`.

## Adding or changing a location

Edit `publisher/config.json`. `sheet` and `range` at the top apply to every
location; add the same keys inside a location entry to override them for
that one file. Restart the publisher after editing.
