# Deploying the backend to production — step by step

This guide updates the **already running** production API
(`https://api.elkcompany.online`) to the latest code on GitHub `main`: the
cleaning, repair and admin features.

The first-time server setup (RDS, Docker, nginx, certificate) was done
before and is described in [deployment.md](deployment.md). You don't repeat it.

**Time needed:** about 10–15 minutes, mostly waiting for the build.
**Downtime:** a few seconds while the API container restarts.

---

## Before you start

You need:

1. **The server key**: the `.pem` file you use to log in to the EC2 server.
2. **The server address**: `13.207.17.115`.
3. **Your laptop's terminal.**

Check the current production server is alive (run on your laptop):

```bash
curl https://api.elkcompany.online/health/ready
```

Expected:

```
{"status":"ok","checks":{"database":"up","redis":"up"}}
```

---

## Step 1: Make sure the code is on GitHub

On your laptop:

```bash
cd ~/Desktop/Projects/ME/elk-backend-v2
git status
git log origin/main -1 --oneline
```

- `git status` should say `nothing to commit, working tree clean`.
- The last line should show `77c4819 docs: postman and API reference ...`
  (or something newer).

If you have uncommitted changes you want deployed, commit and push first:

```bash
git add -A
git commit -m "your message in lowercase"
git push origin main
```

The server pulls from GitHub, so only pushed code gets deployed.

---

## Step 2: Log in to the server

On your laptop:

```bash
chmod 400 /path/to/your-key.pem        # only needed once
ssh -i /path/to/your-key.pem ec2-user@13.207.17.115
```

If it says `Permission denied (publickey)`, try `ubuntu` instead of `ec2-user`:

```bash
ssh -i /path/to/your-key.pem ubuntu@13.207.17.115
```

Your prompt changes to something like `[ec2-user@ip-172-31-... ~]$`.
**Every command below runs on the server** until Step 9.

---

## Step 3: Go to the project folder

```bash
cd /opt/elk-api
ls
```

You should see `Dockerfile`, `deploy`, `prisma`, `src`, ….

If `/opt/elk-api` doesn't exist, find where the code lives:

```bash
sudo find / -name docker-compose.prod.yml -path "*deploy*" 2>/dev/null
```

Then `cd` to the folder **above** the `deploy` folder it prints, and use
that path wherever this guide says `/opt/elk-api`.

---

## Step 4: Check the server can pull from GitHub

```bash
git status
git fetch origin
```

- `git status` should say `On branch main` and show no changed files.
- `git fetch` should finish with no error.

**If `git fetch` fails** with `Permission denied (publickey)`, the server
has no access to the GitHub repo. See [Problem: GitHub access](#problem-github-access).

**If `git status` lists changed files**, someone edited code directly on the
server. See what changed first:

```bash
git diff
```

If those edits are not needed, throw them away:

```bash
git checkout -- .
```

---

## Step 5: Add the admin phone number

Only the first time. This makes `+919562461531` an admin when it logs in.

```bash
grep ADMIN_PHONES deploy/.env
```

- If it prints `ADMIN_PHONES=+919562461531`, skip to Step 6.
- If it prints `ADMIN_PHONES=` (empty) or nothing, edit the file:

```bash
nano deploy/.env
```

Find the `ADMIN_PHONES=` line, or add one at the bottom, so it reads:

```
ADMIN_PHONES=+919562461531
```

To add more admins later, separate the numbers with commas:
`ADMIN_PHONES=+919562461531,+91XXXXXXXXXX`

Save and exit nano: **Ctrl+O**, **Enter**, **Ctrl+X**.

Check it saved:

```bash
grep ADMIN_PHONES deploy/.env
```

While you're in this file, also check `OTP_TEST_PHONES=` is **empty**. The
API refuses to start in production if it isn't.

---

## Step 6: Back up the database (recommended)

This update only **adds** tables and columns, so nothing existing is lost.
A snapshot is still cheap insurance.

**Easiest:** AWS Console → **RDS** → **Databases** → select the ELK database
→ **Actions** → **Take snapshot**. Name it
`elk-before-home-services-2026-09-28` and wait until its status is
**Available**.

**Or**, if the AWS CLI is set up on the server:

```bash
aws rds create-db-snapshot --db-instance-identifier elk-prod \
  --db-snapshot-identifier elk-before-home-services-$(date +%Y%m%d-%H%M)
```

---

## Step 7: Deploy

```bash
cd /opt/elk-api
./deploy/deploy.sh --pull
```

The script runs these steps and prints each one:

| Output                                   | What happens                                                                              |
| ---------------------------------------- | ----------------------------------------------------------------------------------------- |
| `==> Pulling latest code`                | `git pull` from GitHub `main`                                                             |
| `==> Building images`                    | Builds the new API image. **Takes 3–8 minutes.**                                          |
| `==> Starting Redis`                     | Redis keeps running if it already is                                                      |
| `==> Applying database migrations (RDS)` | Creates the cleaning, repair and admin tables and adds the 6 cleaning + 6 repair services |
| `==> Starting API`                       | Swaps in the new API container                                                            |
| `==> Waiting for readiness`              | Waits up to 60 seconds for the API to answer                                              |
| `==> Healthy: {"status":"ok",...}`       | **Done**                                                                                  |

During the migration step you should see these three being applied:

```
20260925120000_cleaning_pricing
20260926120000_repair_pricing
20260928120000_home_services
```

If the script ends with `API did not become ready in 60s` and prints logs,
go to [Troubleshooting](#troubleshooting).

---

## Step 8: Check on the server

```bash
cd /opt/elk-api/deploy
docker compose -f docker-compose.prod.yml ps
```

Both `api` and `redis` should show `Up` (Redis also shows `healthy`).

Confirm all migrations are applied:

```bash
docker compose -f docker-compose.prod.yml --profile tools run --rm migrate npx prisma migrate status
```

Expected: `Database schema is up to date!`

Log out of the server:

```bash
exit
```

---

## Step 9: Check from your laptop

```bash
curl https://api.elkcompany.online/health/ready
curl -s -o /dev/null -w "%{http_code}\n" https://api.elkcompany.online/api/v1/services
curl -s -o /dev/null -w "%{http_code}\n" https://api.elkcompany.online/api/v1/admin/dashboard
```

| Result                  | Meaning                                            |
| ----------------------- | -------------------------------------------------- |
| health shows `"ok"`     | API, database and Redis are up                     |
| `401` for the other two | **New code is live.** They exist and need a login. |
| `404`                   | Still the old code: the deploy didn't happen       |

---

## Step 10: Set up the admin side

In the ELK app (production build) or the web admin panel:

1. Log in with **+919562461531** and enter the OTP from the SMS.
2. The app opens the **admin panel**.
3. **Service locations → Add location**: add each area you serve (area name,
   district, pincode, radius in km).
   **Customers can't book cleaning or repair until at least one location
   exists.**
4. **Professionals → Add professional**: add your team, with a base location.
5. **Services & pricing**: check the hourly rates of the 12 starting
   services and change any you need.
6. **Offers & codes** (optional): add promo codes.

Then log in with a normal customer number and place a test cleaning booking
at an address inside one of your locations. It should appear under
**Bookings** in the admin panel as _Pending_.

---

## Troubleshooting

See the logs:

```bash
cd /opt/elk-api/deploy
docker compose -f docker-compose.prod.yml logs --tail=100 api
```

| Problem                                                 | Fix                                                                                                                                                            |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Build stops with `Killed` and no other error            | The server ran out of memory. Add swap: [deployment.md](deployment.md), section "Swap", then re-run Step 7                                                     |
| `git pull` says `Not possible to fast-forward`          | Server has its own commits. Run `git reset --hard origin/main` (discards them), then re-run Step 7                                                             |
| `Invalid environment configuration`                     | A value in `deploy/.env` is wrong; the log names it. Fix it and re-run Step 7                                                                                  |
| `OTP_TEST_PHONES must be empty in production`           | Set `OTP_TEST_PHONES=` (empty) in `deploy/.env`                                                                                                                |
| Migration hangs, then times out                         | The server can't reach RDS. Check the RDS security group allows port 3306 from the EC2 server                                                                  |
| `permission denied ... docker.sock`                     | Run `sudo usermod -aG docker $USER`, log out, log back in, retry                                                                                               |
| `502 Bad Gateway` from the website                      | The API isn't running. Check the logs above                                                                                                                    |
| Admin number opens the normal home, not the admin panel | `ADMIN_PHONES` wasn't set when the API started. Fix Step 5, run `docker compose -f docker-compose.prod.yml up -d api`, then log out and log back in on the app |
| No OTP SMS arrives                                      | Check `SMS_ENABLED=true` and the SMS tokens in `deploy/.env`                                                                                                   |

### Going back to the previous version

If the new version misbehaves:

```bash
cd /opt/elk-api
git log --oneline -10               # find the commit that was running before
git checkout <that-commit>
./deploy/deploy.sh                  # no --pull
```

The new tables stay in the database. The old code ignores them. To return
to the latest code afterwards:

```bash
git checkout main && ./deploy/deploy.sh --pull
```

### Problem: GitHub access

The repo is private (`git@github.com:elkbusinesshub/v2-backend.git`), so
the server needs a **deploy key**.

On the server:

```bash
ssh-keygen -t ed25519 -C "elk-ec2-deploy" -f ~/.ssh/id_ed25519 -N ""
cat ~/.ssh/id_ed25519.pub
```

Copy the line it prints. On GitHub, open the repo → **Settings** →
**Deploy keys** → **Add deploy key**. Paste it, give it a title like
`EC2 server`, leave **Allow write access** unticked, and save.

Back on the server:

```bash
ssh -T git@github.com               # answer "yes" once; it greets the repo
cd /opt/elk-api && git fetch origin
```

Then continue from Step 4.

---

## Next time

For future updates, after pushing to GitHub, only three commands are needed:

```bash
ssh -i /path/to/your-key.pem ec2-user@13.207.17.115
cd /opt/elk-api && ./deploy/deploy.sh --pull
exit
```

Then run the Step 9 checks from your laptop.
