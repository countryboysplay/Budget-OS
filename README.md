# Budget OS

Shows the "Analysis from Gross Sales Report" tab from each location's sales
comparison workbook to the sales team, on any phone or desktop.

How it flows:

    Excel on Dropbox  ->  publisher/publish.py (office PC)  ->  data/*.json in this repo
                      ->  git push  ->  Cloudflare Pages redeploys  ->  team opens the site

The app is plain HTML/JS, no build step. `data/` is generated; don't hand-edit it.

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

### 3. Cloudflare Pages

1. Cloudflare dashboard -> Workers & Pages -> Create -> Pages -> Connect to Git
2. Pick `countryboysplay/Budget-OS`, branch `main`
3. Framework preset: **None**. Build command: leave empty. Output directory: `/`
4. Deploy. You'll get a `something.pages.dev` URL. Every push redeploys it.

### 4. Lock it down (Cloudflare Access)

1. Zero Trust -> Access -> Applications -> Add an application -> Self-hosted
2. Application domain: your `something.pages.dev` hostname
3. Add a policy: Action **Allow**, Include -> **Emails** (list each agent's
   email) or **Emails ending in** `@yourcompany.com`
4. Under Authentication, keep **One-time PIN** on. Agents enter their email,
   get a code, and they're in. Sessions last as long as you set (24h default).

Anyone not on the list sees a Cloudflare login page, not the data.

### 5. Run the publisher at logon

Task Scheduler -> Create Basic Task:

- Trigger: When I log on
- Action: Start a program
- Program: `C:\Users\jonat\Budget-OS\publisher\start_publisher.bat`
- Start in: `C:\Users\jonat\Budget-OS\publisher`

Or drop a shortcut to `start_publisher.bat` in
`%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup`.

## Day to day

Save a workbook in Excel. Within about a minute the site shows the new numbers
and "updated just now". The status text turns amber if a location hasn't
published in two days.

`publisher/publisher.log` shows what the publisher did and any errors.

## Commands

    python publish.py            publish all, then watch Dropbox for saves
    python publish.py --once     publish all and exit
    python publish.py --no-push  commit locally but don't push (testing)

## Adding or changing a location

Edit `publisher/config.json`. `sheet` and `range` at the top apply to every
location; add the same keys inside a location entry to override them for
that one file. Restart the publisher after editing.
