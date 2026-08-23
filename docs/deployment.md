# Deployment — EC2, RDS, Docker Compose, nginx

The API and Redis run as containers on a single EC2 host, behind nginx with a
Let's Encrypt certificate. MySQL lives in **RDS**.

Why the split: MySQL holds data you cannot regenerate (users, orders, chat,
reviews), so it gets managed snapshots and point-in-time recovery. Redis holds
only short-lived state — OTP codes, the JWT denylist, rate-limit counters,
Socket.IO pub/sub, BullMQ jobs — so a container restart costs seconds and
managed Redis would not earn its price.

The instance already runs another Node app on **:8000**. Nothing here touches
it: the API binds to `127.0.0.1:3000`, Redis publishes no host port at all, and
the nginx config is a separate site file.

```
internet ──443──▶ nginx (host) ──▶ 127.0.0.1:3000 ──▶ api container
                                                          │
                                        compose network ──┴──▶ redis:6379
                                                          │
                                            VPC (private) └──▶ RDS MySQL :3306

     existing app ──▶ :8000 (untouched)
```

## Files

| File                             | Purpose                                   |
| -------------------------------- | ----------------------------------------- |
| `deploy/docker-compose.prod.yml` | redis + api + one-off migrate runner      |
| `deploy/.env.production.example` | template → copy to `deploy/.env`          |
| `deploy/nginx/elk-api.conf`      | nginx site (install to `sites-available`) |
| `deploy/deploy.sh`               | build → migrate → restart → health check  |

## One-time setup

### 1. RDS

Create a MySQL instance in the **same VPC** as the EC2 box:

- Engine **MySQL 8.4**, `db.t4g.micro` to start (resize later without a rewrite)
- **Public access: No**
- Initial database name `elk`, master username `elk`
- Storage autoscaling on; **automated backups on, 7-day retention** — this is
  the entire reason for using RDS, don't leave it at 0
- Multi-AZ only if you need failover; it roughly doubles the cost

Security group — reference the EC2 instance's security group rather than an IP,
so it keeps working if the instance is replaced:

```
Type: MySQL/Aurora   Port: 3306   Source: <sg-id of the EC2 instance>
```

Copy the writer endpoint from the console; it goes in `DATABASE_URL`.

Verify from the EC2 box before going further — this fails fast if the security
group is wrong:

```bash
sudo dnf install -y nc || sudo apt install -y netcat-openbsd
nc -zv <rds-endpoint> 3306
```

### 2. Docker

```bash
# Amazon Linux 2023
sudo dnf install -y docker && sudo systemctl enable --now docker
# Ubuntu
curl -fsSL https://get.docker.com | sudo sh && sudo systemctl enable --now docker

sudo usermod -aG docker "$USER"   # log out and back in for this to take effect
docker compose version            # must print v2.x — the plugin, not docker-compose
```

### 3. Swap, if the instance has ≤ 2 GB RAM

`npm ci` plus `nest build` will be OOM-killed on a 1 GB instance. This is the
most common cause of a build that dies with no useful error.

```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

### 4. Code

```bash
git clone <repo-url> /opt/elk-api && cd /opt/elk-api
git checkout main
```

### 5. Environment

```bash
cp deploy/.env.production.example deploy/.env
chmod 600 deploy/.env
nano deploy/.env
```

Every `CHANGE_ME` must be replaced. Generate the JWT secret on the box:

```bash
openssl rand -base64 48   # JWT_ACCESS_SECRET
```

Points that will bite you if skipped:

- **`DATABASE_URL`** points at the RDS endpoint, not localhost. URL-encode any
  of `: / ? # [ ] @` in the password.
- **`CORS_ORIGINS`** must list the real origins that call the API
  (`https://api.example.com`, the web app's origin, …), comma-separated, no
  trailing slash. It gates both CORS and the Socket.IO handshake — a wrong
  value here looks exactly like "websockets are broken".
- **`OTP_TEST_PHONES` must be empty.** Your dev `.env` has `+919999999999`,
  which is a permanent unauthenticated login. The app refuses to boot in
  production if it is set.
- **`ADMIN_PHONES` is empty in the template.** There is no seeded admin, so
  until you add at least one E.164 phone, the admin routes are unreachable.
- **`SWAGGER_ENABLED`** is irrelevant in production — Swagger is force-disabled.

### 6. Secrets file (FCM)

Only if `PUSH_ENABLED=true`. Otherwise set it to `false` and skip this —
notifications are still stored and returned by the API, they just don't reach
devices.

```bash
mkdir -p deploy/secrets
# copy the service-account JSON from your machine:
#   scp firebase-service-account.json ec2-user@<host>:/opt/elk-api/deploy/secrets/
chmod 600 deploy/secrets/firebase-service-account.json
```

`deploy/secrets/` is gitignored and mounted read-only at `/app/secrets`.

### 7. S3 access

Prefer an **IAM instance role** over static keys: attach a role granting
`s3:GetObject`, `s3:PutObject`, `s3:DeleteObject` on `arn:aws:s3:::<bucket>/*`,
then leave `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` empty. The SDK picks
the role up from instance metadata. Static keys in `deploy/.env` also work but
are worse — they don't rotate.

### 8. Security group (EC2)

Inbound: `80` and `443` from `0.0.0.0/0`, `22` from your IP only. **Do not open
3000** — the API is bound to loopback and only nginx should reach it.

## First deploy

```bash
cd /opt/elk-api
./deploy/deploy.sh
```

That builds the images, starts Redis, applies migrations to RDS, starts the
API, and polls `/health/ready` until it answers. Expected output:

```
==> Healthy: {"status":"ok","checks":{"database":"up","redis":"up"}}
```

Migrations run in a **separate one-off container** (the `migrator` Dockerfile
stage), not at container start. The runner image prunes dev dependencies, so
the Prisma CLI does not exist there — this is why the extra stage is needed.

## nginx + TLS

Point your domain's A record at the instance's Elastic IP **before** running
certbot, or the challenge fails.

```bash
# Install nginx if it isn't already there.
sudo dnf install -y nginx || sudo apt install -y nginx
sudo systemctl enable --now nginx
```

If nginx already fronts the app on :8000, check what's there first so you add a
site rather than replace one:

```bash
ls /etc/nginx/sites-enabled/ /etc/nginx/conf.d/
```

Install the site (edit `api.example.com` to your domain first — it appears in
`server_name`):

```bash
sudo cp deploy/nginx/elk-api.conf /etc/nginx/sites-available/elk-api
sudo ln -s /etc/nginx/sites-available/elk-api /etc/nginx/sites-enabled/elk-api
sudo nginx -t && sudo systemctl reload nginx
```

On Amazon Linux there is no `sites-enabled`; copy to `/etc/nginx/conf.d/elk-api.conf`
instead and skip the symlink.

Then get the certificate — certbot rewrites the file in place, adding the :443
server block and an HTTP→HTTPS redirect:

```bash
sudo dnf install -y certbot python3-certbot-nginx || sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d api.example.com
sudo systemctl list-timers | grep certbot   # confirm auto-renewal is armed
```

Verify from your laptop:

```bash
curl https://api.example.com/health/ready
```

## Redeploying

```bash
cd /opt/elk-api && ./deploy/deploy.sh --pull
```

Pulls, rebuilds, migrates, restarts. There is a few seconds of downtime while
the container swaps — acceptable for a single-instance deployment. Zero-downtime
needs a second instance behind a load balancer.

**Take an RDS snapshot before any deploy carrying a destructive migration**
(dropped column, dropped table). Automated backups let you recover, but a
manual snapshot taken deliberately is faster to reason about:

```bash
aws rds create-db-snapshot --db-instance-identifier elk-prod \
  --db-snapshot-identifier elk-prod-predeploy-$(date +%Y%m%d-%H%M)
```

## Operations

```bash
cd /opt/elk-api/deploy
C="docker compose -f docker-compose.prod.yml"

$C ps                        # container + health status
$C logs -f api               # follow logs (JSON lines from pino)
$C logs -f api | npx pino-pretty
$C restart api
$C down                      # stop api + redis (RDS is unaffected)
```

Logs are capped at 10 MB × 5 files per container, so they cannot fill the disk.

### Database access

RDS is not publicly reachable, so connect from the EC2 box. Either install the
client, or borrow the one in the migrator image:

```bash
$C --profile tools run --rm migrate npx prisma migrate status
$C --profile tools run --rm migrate npx prisma db execute --stdin <<< 'SELECT COUNT(*) FROM users;'
```

From your laptop, tunnel through the instance:

```bash
ssh -L 3307:<rds-endpoint>:3306 ec2-user@<ec2-host>
# then connect a local client to 127.0.0.1:3307
```

### Backups

Handled by RDS automated backups (7-day retention, set in step 1) plus
point-in-time recovery. Confirm it is actually on:

```bash
aws rds describe-db-instances --db-instance-identifier elk-prod \
  --query 'DBInstances[0].BackupRetentionPeriod'
```

A non-zero number is the answer you want. `0` means you have no backups.

## Troubleshooting

| Symptom                                       | Cause                                                                            |
| --------------------------------------------- | -------------------------------------------------------------------------------- |
| Build killed with no error                    | Out of memory — add swap (step 3)                                                |
| `Invalid environment configuration` on boot   | A var failed validation; the log names every offender. Check `deploy/.env`       |
| `OTP_TEST_PHONES must be empty in production` | Clear it — it bypasses OTP                                                       |
| Migration hangs, then times out               | RDS security group doesn't allow 3306 from the EC2 SG. Test with `nc -zv`        |
| `Access denied for user`                      | Password in `DATABASE_URL` wrong or not URL-encoded                              |
| `/health/ready` 503 `database: down`          | Wrong RDS endpoint, SG, or credentials — check the api logs for the Prisma error |
| `/health/ready` 503 `redis: down`             | `REDIS_URL` should be `redis://redis:6379`                                       |
| 502 from nginx                                | API isn't up, or `API_HOST_PORT` ≠ the port in `elk-api.conf`'s `upstream`       |
| Websockets fail to connect                    | Origin missing from `CORS_ORIGINS`, or nginx not sending the upgrade headers     |
| `413 Request Entity Too Large` on upload      | Raise `client_max_body_size` in the nginx site                                   |
| Port 8000 app broke                           | Shouldn't be possible — nothing here binds 8000. Check `sudo ss -tlnp`           |
