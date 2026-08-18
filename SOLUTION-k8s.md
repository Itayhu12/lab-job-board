# SOLUTION-k8s.md — DevSecOps22 Job Board: Kubernetes Migration

Source lab: https://hothaifa96.github.io/DevSecOps22/projects/lab-job-board/k8s/README-k8s/

This document is updated after every step/task is completed, with the commands run, the actual output, and an explanation of what happened and why. Environment: minikube v1.38.1 on Ubuntu 24.04, driver=docker, Kubernetes v1.35.1.

---

## Step 1 — Start Minikube with Required Addons

**Status:** ✅ Complete

**Goal:** Bring up a local Kubernetes cluster sized for the Job Board workload (Postgres + 3 microservices + ingress controller + HPA headroom), with the NGINX Ingress Controller and metrics-server addons enabled.

**Why these addons:**
- `ingress` — NGINX Ingress Controller. Will later route external HTTP (port 80) to `frontend`, `jobs-service`, and `applications-service` based on path rules (Step 4/Task 2).
- `metrics-server` — supplies CPU/memory metrics to the HorizontalPodAutoscaler. Without it, `kubectl get hpa` shows `<unknown>` for targets and scaling never triggers (Task 4).

**Commands run:**

```bash
minikube start \
  --cpus=4 \
  --memory=4096 \
  --driver=docker \
  --addons=ingress,metrics-server

minikube addons list | grep -E "ingress|metrics-server"

kubectl wait --namespace ingress-nginx \
  --for=condition=ready pod \
  --selector=app.kubernetes.io/component=controller \
  --timeout=120s
```

**Output:**
```
😄  minikube v1.38.1 on Ubuntu 24.04
✨  Using the docker driver based on user configuration
❗  Starting v1.39.0, minikube will default to "containerd" container runtime. See #21973 for more info.
📌  Using Docker driver with root privileges
👍  Starting "minikube" primary control-plane node in "minikube" cluster
🚜  Pulling base image v0.0.50 ...
🔥  Creating docker container (CPUs=4, Memory=4096MB) ...
🐳  Preparing Kubernetes v1.35.1 on Docker 29.2.1 ...
🔗  Configuring bridge CNI (Container Networking Interface) ...
🔎  Verifying Kubernetes components...
    ▪ Using image registry.k8s.io/ingress-nginx/kube-webhook-certgen:v1.6.7
    ▪ Using image registry.k8s.io/ingress-nginx/kube-webhook-certgen:v1.6.7
    ▪ Using image registry.k8s.io/ingress-nginx/controller:v1.14.3
    ▪ Using image gcr.io/k8s-minikube/storage-provisioner:v5
    ▪ Using image registry.k8s.io/metrics-server/metrics-server:v0.8.1
🔎  Verifying ingress addon...
🌟  Enabled addons: storage-provisioner, metrics-server, default-storageclass, ingress
🏄  Done! kubectl is now configured to use "minikube" cluster and "default" namespace by default

│ ingress                     │ minikube │ enabled ✅ │ Kubernetes                             │
│ ingress-dns                 │ minikube │ disabled   │ minikube                               │
│ metrics-server              │ minikube │ enabled ✅ │ Kubernetes                             │

pod/ingress-nginx-controller-596f8778bc-mmkfl condition met
```

**Verification / explanation:**
- Both `ingress` and `metrics-server` show `enabled ✅`.
- `kubectl wait` returned `condition met` for `pod/ingress-nginx-controller-596f8778bc-mmkfl` — the controller pod passed its readiness probe, so it can accept and route traffic. Cluster is healthy and ready for image builds.
- Note: minikube warned that from v1.39.0 it will default to the `containerd` runtime instead of Docker's `docker` runtime. Not an issue for this lab, but worth knowing if a future `minikube start` behaves differently after an upgrade.

**Troubleshooting notes:**
- If `minikube start` fails on resources, lower `--cpus`/`--memory` slightly or check Docker's resource allocation.
- If `kubectl wait` times out, run `kubectl get pods -n ingress-nginx` then `kubectl describe pod <name> -n ingress-nginx` for events.

---

## Step 2 — Build Application Container Images
**Status:** ✅ Complete

**Goal:** Build the three application images (`jobs-service`, `applications-service`, `frontend`) directly inside minikube's own Docker daemon.

**Repo used:** No official starter code needed to be built from scratch — the actual course repo (`https://github.com/hothaifa96/DevSecOps22`, subfolder `projects/lab-job-board`) contains the full app: Python/FastAPI `jobs-service`, Node/Express `applications-service`, React `frontend`, `docker-compose.yml`, and a `k8s/` folder with template manifests + `kustomization.yaml`. Cloned to `DevSecOps22/projects/lab-job-board`, which is the working directory for all subsequent commands.

**Commands run:**

```bash
cd "DevSecOps22/projects/lab-job-board"
eval $(minikube docker-env)

docker build -t jobs-service:latest ./jobs-service
docker build -t applications-service:latest ./applications-service
docker build -t frontend:latest ./frontend

docker images | grep -E "jobs-service|applications-service|frontend"
```

**Issues hit and fixes:**

1. **`applications-service` and `frontend` failed on `npm ci`** — `npm error EUSAGE: The npm ci command can only install with an existing package-lock.json`. Cause: the repo doesn't commit `package-lock.json` (each student generates their own locked versions). Fix: ran `npm install` inside each service directory once, on the host, to generate the lock file before rebuilding:
   ```bash
   cd applications-service && npm install && cd ..
   cd frontend && npm install && cd ..
   ```

2. **`frontend` build failed on `RUN apk update && apk upgrade --no-cache`** — `Permission denied` fetching the Alpine `main` package index, exit code 2. No `USER` switch exists before that line in the Dockerfile, ruling out a permissions bug in the Dockerfile itself; the identical command had just succeeded in the `builder` stage and in `applications-service`. Diagnosed as a transient network blip reaching `dl-cdn.alpinelinux.org` (through minikube's internal Docker daemon, routed via `eval $(minikube docker-env)`). Fix: simply retried `docker build -t frontend:latest ./frontend` — succeeded in 10.1s on the next attempt with no code changes.

**Final result:**
```
jobs-service:latest            1d19fc92fa54   189MB
applications-service:latest    7b20f79ee89a   151MB
frontend:latest                455ad1737d5a   (built, image ID confirmed via export)
```

**Verification / explanation:** All three images exist inside minikube's Docker daemon (not the host's), confirmed by IDs returned from the `eval $(minikube docker-env)`-scoped `docker build`/`docker images` calls. Kubernetes Deployments referencing these image names with `imagePullPolicy: Never` (or `IfNotPresent`) will find them locally without needing a registry push.

---

## Step 3 — Create PostgreSQL Credentials Secret
**Status:** ✅ Complete

**Goal:** Generate a strong random password for Postgres and inject it, base64-encoded, into `k8s/01-secret.yaml` (Kubernetes Secrets store values base64-encoded — this is encoding, not encryption; anyone with API/etcd read access can trivially decode it. Covered further in Task 5 — Configuration Management).

**Commands run** (from `DevSecOps22/projects/lab-job-board`):

```bash
cp k8s/01-secret.yaml.example k8s/01-secret.yaml

PASS=$(openssl rand -base64 20)
PASS_B64=$(echo -n "$PASS" | base64)

sed -i "s|REPLACE_WITH_BASE64_ENCODED_PASSWORD|$PASS_B64|" k8s/01-secret.yaml

grep POSTGRES_PASSWORD k8s/01-secret.yaml
```

**Result:** Substitution confirmed successful — `k8s/01-secret.yaml` now contains a real base64-encoded value in place of the `REPLACE_WITH_BASE64_ENCODED_PASSWORD` placeholder. (Actual password value intentionally not recorded in this document — it's a credential, not something that belongs in a file that may end up committed/shared. It only needs to exist in the cluster's Secret object and in your own password manager for the later `pg_dump` backup task.)

`k8s/01-secret.yaml` remains git-ignored per the repo's `.gitignore`, so the real credential never gets committed — only the `.example` template is tracked.

---

## Step 4 — Deploy All Kubernetes Resources
**Status:** ✅ Complete

**Goal:** Apply the namespace, secret, database, three services, ingress rules, and HPAs to the cluster in one shot via Kustomize.

**Why Kustomize here:** `kubectl apply -k k8s/` reads `k8s/kustomization.yaml`, which lists all the individual manifest files in the right order and applies consistent labels across them (identifying everything as part of the `jobboard` app, per the repo's kustomization summary). It's equivalent to applying each file manually in sequence, just less error-prone (can't forget a file or apply out of order).

**Command run** (from `DevSecOps22/projects/lab-job-board`):

```bash
kubectl apply -k k8s/
```

**Output:**
```
Warning: 'commonLabels' is deprecated. Please use 'labels' instead. Run 'kustomize edit fix' to update your Kustomization automatically.
namespace/jobboard created
secret/postgres-secret created
service/applications-service created
service/frontend created
service/jobs-service created
service/postgres created
persistentvolumeclaim/postgres-pvc created
deployment.apps/applications-service created
deployment.apps/frontend created
deployment.apps/jobs-service created
deployment.apps/postgres created
horizontalpodautoscaler.autoscaling/applications-service-hpa created
horizontalpodautoscaler.autoscaling/jobs-service-hpa created
ingress.networking.k8s.io/applications-ingress created
ingress.networking.k8s.io/frontend-ingress created
ingress.networking.k8s.io/jobs-ingress created
```

**Verification / explanation:** All 15 resources created — namespace, secret, 4 Services (jobs, applications, frontend, postgres), 1 PVC, 4 Deployments, 2 HorizontalPodAutoscalers, and 3 Ingress rules (one per externally-routed service). Only `frontend-service`'s HPA is notably absent from the two HPAs — per the README, HPAs target `jobs-service` and `applications-service` specifically, not the static frontend.

The `commonLabels` deprecation warning is cosmetic: the repo's `k8s/kustomization.yaml` uses the older `commonLabels` field name instead of the newer `labels` field. Nothing failed — this can optionally be cleaned up later with `kustomize edit fix`, noted here as a minor polish item, not a blocker.

---

## Step 5 — Verify Pod Readiness
**Status:** ✅ Complete

**Goal:** Confirm every pod (postgres, jobs-service, applications-service, frontend) reaches `Running` with all containers passing their readiness probes before seeding data or testing the app.

**Commands used:**

```bash
kubectl get pods -n jobboard -w
kubectl wait --for=condition=ready pod --selector=app.kubernetes.io/part-of=jobboard -n jobboard --timeout=180s
```

### Bug #1 — postgres: CreateContainerError (grpc invalid UTF-8)

**Symptom:** `postgres` pod stuck in `Waiting: CreateContainerError`. `kubectl describe pod` showed:
```
Warning  Failed  kubelet  spec.containers{postgres}: Error: grpc: error while marshaling: string field contains invalid UTF-8
```

**Diagnosis:** Tested each Secret value by decoding it and validating UTF-8:
```bash
kubectl get secret postgres-secret -n jobboard -o jsonpath='{.data.POSTGRES_PASSWORD}' | base64 -d | iconv -f utf-8 -t utf-8 -o /dev/null
```
`POSTGRES_USER` and `POSTGRES_DB` decoded cleanly to plain text (`postgres`, `jobboard`). `POSTGRES_PASSWORD` failed immediately (`illegal input sequence at position 0`) — the signature of decoding raw random bytes rather than text, meaning the Secret's `data.POSTGRES_PASSWORD` field held a single-encoded value where a double-encoded one was needed (Secret `data:` fields must be `base64(plaintext)`; the value present decoded straight to noise instead of a readable password string).

**Fix:** Regenerated the secret from a clean copy of the template, re-verified the encoding *before* applying it:
```bash
cd DevSecOps22/projects/lab-job-board
PASS=$(openssl rand -base64 20)
cp k8s/01-secret.yaml.example k8s/01-secret.yaml
PASS_B64=$(printf '%s' "$PASS" | base64 -w0)
sed -i "s|REPLACE_WITH_BASE64_ENCODED_PASSWORD|$PASS_B64|" k8s/01-secret.yaml
# verified UTF-8 validity in the file before applying
kubectl apply -f k8s/01-secret.yaml
kubectl delete pod -n jobboard -l app=postgres   # env vars only re-read on pod (re)creation
```
**Result:** `postgres` pod reached `1/1 Running`. This unblocked `jobs-service` and `applications-service`, which were both stuck in `Init:0/1` waiting on Postgres — both are now `1/1 Running` as well.

### Bug #2 — frontend: CrashLoopBackOff (bad nginx.conf)

**Symptom:** `nginx: [emerg] unknown directive "eserver" in /etc/nginx/conf.d/default.conf:1`. The `nginx.conf` source file on disk read cleanly (`server {` on line 1, no visible corruption) — but the already-built `frontend:latest` image was crashing on a corrupted version of that same line, implying either a hidden byte (e.g. a stray BOM introduced by the Google Drive-synced Windows filesystem) present in the file but invisible in a terminal/paste, or the image having been built from an earlier, briefly-broken version of the file.

**Fix:** Rewrote `frontend/nginx.conf` with guaranteed-clean content via a heredoc (eliminates any hidden byte regardless of cause), rebuilt the image, and forced the Deployment to recreate its pods so they'd pick up the freshly-tagged image (kubelet's `imagePullPolicy: Never` uses whatever `frontend:latest` currently points to locally, but existing crashing pods needed an explicit restart to re-resolve it immediately rather than waiting out their backoff timer):
```bash
cat > frontend/nginx.conf << 'EOF'
server {
    listen 80;
    root /usr/share/nginx/html;
    index index.html;
    location / {
        try_files $uri $uri/ /index.html;
    }
    gzip on;
    gzip_vary on;
    gzip_types text/plain text/css application/javascript application/json image/svg+xml;
    add_header X-Frame-Options "SAMEORIGIN";
    add_header X-Content-Type-Options "nosniff";
}
EOF
eval $(minikube docker-env)
docker build -t frontend:latest ./frontend
kubectl rollout restart deployment/frontend -n jobboard
```
**Result:** All `frontend` pods reached `1/1 Running`.

**Final state — all pods healthy:** postgres, jobs-service (x2), applications-service (x2), frontend (x2) all `Running` and ready.

---

## Step 6 — Seed Database with Initial Data
**Status:** ✅ Complete

**Goal:** Run a one-off Kubernetes Job that populates Postgres with initial job listings / sample data, now that the database and both API services are confirmed healthy.

**Why this had to wait:** the seed job needs Postgres to be ready *and* usually needs the schema/tables to exist (often created by jobs-service or applications-service on startup) — running it too early would just fail or silently do nothing. That's also why `08-seed-job.yaml` is commented out of `kustomization.yaml` by default.

**Commands run** (from `DevSecOps22/projects/lab-job-board`):

```bash
sed -i 's/# *- 08-seed-job.yaml/- 08-seed-job.yaml/' k8s/kustomization.yaml
kubectl apply -f k8s/08-seed-job.yaml
kubectl logs -f job/seed-database -n jobboard
kubectl get jobs -n jobboard
```

**Result:**
```
NAME             STATUS     COMPLETIONS   DURATION   AGE
seed-database    Complete   1/1           14s        25s
```

**Verification / explanation:** A Kubernetes `Job` (as opposed to a `Deployment`) runs its pod to completion exactly once and then stops — it does not restart on success. `COMPLETIONS: 1/1` confirms the seed script ran fully and exited 0. Database now has initial data; all 7 app pods (postgres, 2x jobs-service, 2x applications-service, 2x frontend) are healthy.

---

## Step 7 — Access the Running Application
**Status:** ✅ Complete

**Goal:** Hit the app through the Ingress Controller (the same path real external traffic would take) and confirm both the API and the UI respond.

**Commands run:**

```bash
MINIKUBE_IP=$(minikube ip)
curl -s http://$MINIKUBE_IP/api/jobs/ | python3 -m json.tool | head -20
```

### Bug — Ingress rewrite-target / backend route mismatch (307 redirect loop)

**Symptom:** `curl` returned nothing (`Expecting value: line 1 column 1 (char 0)` from `json.tool`). Verbose curl (`-v`) revealed the real response: `HTTP/1.1 307 Temporary Redirect`, `location: http://192.168.49.2/jobs` — a redirect to a path with no `/api` prefix, which the Ingress has no rule for (it would fall through to `frontend-ingress`'s catch-all `/` and return the React app's HTML instead of JSON).

**Diagnosis:** Bypassed the Ingress entirely to test `jobs-service` directly via port-forward:
```bash
kubectl port-forward -n jobboard svc/jobs-service 8000:8000 &
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8000/jobs    # 200
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8000/jobs/   # 307
```
Confirmed: `jobs-service`'s route is registered **without** a trailing slash. But `jobs-ingress`'s `nginx.ingress.kubernetes.io/rewrite-target: /jobs/$2` annotation unconditionally hardcoded a trailing `/` onto every proxied request, regardless of what path the client used — a mismatch between the Ingress rewrite rule and the backend's actual routing.

**Fix (two attempts):**
1. First attempt changed `rewrite-target` to `/jobs$1$2` (reusing capture group 1, the literal `/` or empty string the client's path actually contained, instead of hardcoding one) — but a stray `/` was left in during editing (`/jobs/$1$2`), so the bug persisted identically.
2. Corrected to exactly `/jobs$1$2` (no slash between the literal `jobs` and `$1`), same fix applied to `applications-ingress`'s `/applications$1$2`. Reapplied:
```bash
kubectl apply -f k8s/06-ingress.yaml
curl -s http://$MINIKUBE_IP/api/jobs | python3 -m json.tool | head -20
```

**Result:** Returns real JSON — seeded job listings (e.g. "Senior DevOps Engineer" at TechCorp Ltd., "Backend Developer (Python)" at StartupXYZ, etc.) with `id`, `title`, `description`, `company`, `location`, `salary_range`, `created_at` fields.

**Side note — label drift:** applying the Ingress file directly with `kubectl apply -f` (rather than through Kustomize) dropped the `app.kubernetes.io/managed-by=kustomize` and `app.kubernetes.io/part-of=jobboard` labels that Kustomize normally injects. Re-applied the full stack via `kubectl apply -k k8s/` afterward to restore consistent labeling across all resources.

**Relevance to Task 2 (Networking & Ingress):** this whole investigation — tracing the request path, understanding what `rewrite-target` and its capture groups actually do, and explaining why a backend's own redirect behavior can conflict with a reverse proxy's path rewriting — directly answers several of Task 2's required explanations. Worth reusing this writeup there.

---

## Task 1 — Cluster Exploration (15 pts)
**Status:** ✅ Complete

### 1.1 — Inspect all objects (5 pts)

```bash
kubectl get all -n jobboard
kubectl get pvc -n jobboard
kubectl get ingress -n jobboard
kubectl get hpa -n jobboard
kubectl get secret -n jobboard
```

**Output (abridged):**
```
NAME                                   READY   UP-TO-DATE   AVAILABLE   AGE
deployment.apps/applications-service   2/2     2            2           7h10m
deployment.apps/frontend               2/2     2            2           7h10m
deployment.apps/jobs-service           2/2     2            2           7h10m
deployment.apps/postgres               1/1     1            1           7h10m

NAME                           TYPE        CLUSTER-IP       PORT(S)
service/applications-service   ClusterIP   10.110.78.217    3001/TCP
service/frontend               ClusterIP   10.106.62.227    80/TCP
service/jobs-service           ClusterIP   10.108.227.47    8000/TCP
service/postgres               ClusterIP   10.103.238.232   5432/TCP

NAME           STATUS   CAPACITY   ACCESS MODES   STORAGECLASS
postgres-pvc   Bound    1Gi        RWO            standard

NAME                       REFERENCE                         TARGETS                         MINPODS   MAXPODS   REPLICAS
applications-service-hpa   Deployment/applications-service   cpu: 3%/60%, memory: 17%/75%    2         6         2
jobs-service-hpa           Deployment/jobs-service           cpu: 10%/60%, memory: 45%/75%   2         6         2

NAME              TYPE     DATA
postgres-secret   Opaque   3
```

**What is the READY ratio for each Deployment?**
`applications-service` 2/2, `frontend` 2/2, `jobs-service` 2/2, `postgres` 1/1 — all Deployments are fully ready (live pod count matches desired replica count).

**What is the CLUSTER-IP of each Service?**
`applications-service` → `10.110.78.217`, `frontend` → `10.106.62.227`, `jobs-service` → `10.108.227.47`, `postgres` → `10.103.238.232`. All four are `ClusterIP` type — internal-only, not reachable from outside the cluster.

**What storage class was assigned to `postgres-pvc`?**
`standard` — minikube's default StorageClass, backed by the `k8s.io/minikube-hostpath` provisioner.

### 1.2 — Describe a Pod (5 pts)

```bash
POD=$(kubectl get pods -n jobboard -l app=jobs-service -o jsonpath='{.items[0].metadata.name}')
kubectl describe pod $POD -n jobboard
```

**Relevant output:**
```
Init Containers:
  wait-for-postgres:
    Image:         busybox:1.36
    Command:       sh -c until nc -z postgres 5432; do echo "Waiting for postgres..."; sleep 2; done; echo "PostgreSQL is ready."
    State:         Terminated / Reason: Completed / Exit Code: 0

Containers:
  jobs-service:
    Image:          jobs-service:latest
    Liveness:       http-get http://:8000/health delay=30s timeout=5s period=15s #success=1 #failure=3
    Readiness:      http-get http://:8000/health delay=10s timeout=5s period=10s #success=1 #failure=3
    Environment:
      POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB   (from secret 'postgres-secret')
      DATABASE_URL:  postgresql://$(POSTGRES_USER):$(POSTGRES_PASSWORD)@postgres:5432/$(POSTGRES_DB)
```

**What `initContainer` runs first and why?**
`wait-for-postgres`, a small `busybox` container running a shell loop (`until nc -z postgres 5432; do ...; sleep 2; done`) that blocks until Postgres accepts TCP connections on port 5432. Init containers always run to completion, in order, before any main container in the pod starts — so this guarantees `jobs-service`'s actual application process never even attempts to start until the database is reachable, instead of starting immediately and crash-looping on connection-refused errors. (This container's own history is a good real example: its `Finished` timestamp was hours after `Started`, because it was legitimately stuck looping during the Step 5 Postgres secret bug — proof this mechanism does what it's designed to do.)

**What do the `readinessProbe` and `livenessProbe` check?**
Both hit the same endpoint, `http-get http://:8000/health`, but on different schedules: liveness waits 30s before the first check and re-checks every 15s; readiness waits only 10s and re-checks every 10s (faster and sooner, since it gates traffic).

**What is the difference between them? What happens if readiness fails vs. liveness fails?**
Readiness controls whether the pod currently receives traffic — if it fails (3 consecutive misses here), Kubernetes removes the pod from the Service's endpoint list so no new requests get routed to it, but the container itself keeps running untouched; it automatically rejoins the endpoint list once the probe passes again. Liveness controls whether the container is considered alive at all — if it fails (3 consecutive misses), kubelet kills the container and restarts it (incrementing `RESTARTS`), on the assumption that a process which is technically running but unresponsive is stuck/deadlocked and needs a fresh start rather than just a traffic pause. In short: readiness failure = "temporarily stop sending traffic here"; liveness failure = "kill and restart this container."

### 1.3 — Exec into a pod (5 pts)

```bash
kubectl exec -it $POD -n jobboard -- sh
python3 -c "
import urllib.request
resp = urllib.request.urlopen('http://localhost:8000/health')
print(resp.read().decode())
"
exit
```
Result: `{"status":"healthy","service":"jobs-service","version":"1.0.0"}` — confirmed the app itself is healthy from inside its own container.

DNS resolution (this image doesn't ship `nslookup`, so used Python's `socket.gethostbyname` instead — same underlying resolution mechanism):
```bash
kubectl exec -it $POD -n jobboard -- python3 -c "import socket; print(socket.gethostbyname('postgres'))"
kubectl exec -it $POD -n jobboard -- python3 -c "import socket; print(socket.gethostbyname('postgres.jobboard.svc.cluster.local'))"
```
Both resolved to `10.103.238.232` — matching the `postgres` Service's ClusterIP exactly.

**What is the full DNS name of the `postgres` service?**
`postgres.jobboard.svc.cluster.local` — format `<service>.<namespace>.svc.cluster.local`.

**Why can pods use the short name `postgres` instead of the FQDN?**
Every pod's `/etc/resolv.conf` is auto-populated by Kubernetes with a set of DNS search domains, the first of which is the pod's own namespace (`jobboard.svc.cluster.local`). When code resolves just `postgres`, the resolver automatically appends each search domain in order and tries each one — `postgres.jobboard.svc.cluster.local` matches on the very first attempt (same namespace), so the short name works transparently for same-namespace service-to-service calls without any extra configuration. (Reaching a service in a *different* namespace would require at least `<service>.<other-namespace>`, since the short name alone would only match within your own namespace's search domain.)

---

## Task 2 — Kubernetes Networking & Ingress (20 pts)
**Status:** ✅ Complete

### 2.1 — Trace an Ingress request (8 pts)

**Diagram — full request journey for `POST http://<minikube-ip>/api/applications/`:**

```
┌─────────────────────────────────────────────────────────────────────┐
│ CLIENT                                                                │
│   POST http://192.168.49.2/api/applications/                         │
│   Body: {"job_id":"job-001","applicant_name":"Test User", ...}       │
└───────────────────────────────┬──────────────────────────────────────┘
                                 │ TCP to 192.168.49.2:80
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│ INGRESS-NGINX CONTROLLER  (namespace: ingress-nginx)                  │
│   Single entry point for all HTTP traffic into the cluster            │
└───────────────────────────────┬───────────────────────────────────────┘
                                 │ matches path against every Ingress rule
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│ HOP 1 — INGRESS MATCH: applications-ingress                           │
│   Path pattern: /api/applications(/|$)(.*)                            │
│   Input:        /api/applications/                                    │
│     → group1 "(/|$)" = "/"     group2 "(.*)" = ""                     │
└───────────────────────────────┬───────────────────────────────────────┘
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│ HOP 2 — REWRITE-TARGET TRANSFORM                                      │
│   Annotation: rewrite-target: /applications$1$2                       │
│   Result: "/applications" + "/" + "" = "/applications/"               │
│   (the "/api" prefix is stripped — the backend never sees it)         │
└───────────────────────────────┬───────────────────────────────────────┘
                                 │ proxy_pass to backend Service
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│ HOP 3 — SERVICE: applications-service (ClusterIP)                     │
│   ClusterIP: 10.110.78.217   Port: 3001                               │
└───────────────────────────────┬───────────────────────────────────────┘
                                 │ kube-proxy picks one matching endpoint
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│ HOP 4 — POD SELECTION (via label selector)                            │
│   Service selector: {"app":"applications-service", ...}               │
│   Matches pods: applications-service-5dd8c5968f-9dg8h (10.244.0.7)    │
│                 applications-service-5dd8c5968f-cskzf (10.244.0.8)    │
│   kube-proxy's iptables/IPVS rules picked one of the two for this     │
│   request (load-balanced across both, see 2.3/Task-2 evidence)        │
└───────────────────────────────┬───────────────────────────────────────┘
                                 │ POST + body delivered unmodified
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│ HOP 5 — NODE.JS (EXPRESS) HANDLER — inside the selected pod            │
│   Receives POST /applications/ with the JSON body                     │
│   → validates it, INSERTs a new row into Postgres                     │
│   → returns 201 Created with the persisted record:                    │
│     {"id":"e4c1ea8f-2248-40f4-ba81-062633e4386a","job_id":"job-001",  │
│      "applicant_name":"Test User","applicant_email":"test@lab.com",   │
│      "cover_letter":null,"status":"pending",                          │
│      "created_at":"2026-08-17T19:48:42.203Z"}                         │
└───────────────────────────────┬───────────────────────────────────────┘
                                 │ response flows back: Pod → Service →
                                 │ Ingress Controller → Client (reverse path)
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│ CLIENT receives: 201 Created + the JSON body above                    │
└─────────────────────────────────────────────────────────────────────┘
```

**Same journey, tabulated:**

| Hop | Detail |
|---|---|
| 1. Ingress resource match | `applications-ingress` — path pattern `/api/applications(/|$)(.*)` matches `/api/applications/` (group1=`/`, group2=``) |
| 2. rewrite-target transform | `/applications$1$2` → `/applications` + `/` + `` = `/applications/` |
| 3. Service + port | `applications-service` (ClusterIP), port `3001` |
| 4. Pod selection | Service selector `{"app":"applications-service", ...}` matches any pod carrying that label — currently `applications-service-5dd8c5968f-9dg8h` (10.244.0.7) and `-cskzf` (10.244.0.8); kube-proxy picked one of the two for this request |
| 5. Node.js (Express) handler response | `201 Created` with the persisted record: `{"id":"e4c1ea8f-2248-40f4-ba81-062633e4386a","job_id":"job-001","applicant_name":"Test User","applicant_email":"test@lab.com","cover_letter":null,"status":"pending","created_at":"2026-08-17T19:48:42.203Z"}` — the handler validated the POST body, inserted a new row into Postgres (server-generated `id`/`created_at`, `status` defaulted to `"pending"`), and returned the created resource, REST-style. |

**Verify command used:**
```bash
curl -sv -X POST http://$MINIKUBE_IP/api/applications/ \
  -H "Content-Type: application/json" \
  -d '{"job_id":"job-001","applicant_name":"Test User","applicant_email":"test@lab.com"}' \
  2>&1 | grep -E "< HTTP|Location|{"
```
Result: `< HTTP/1.1 201 Created`, no redirect.

**Note on trailing slash:** unlike `jobs-service` (FastAPI/Starlette, which 307-redirects between `/jobs` and `/jobs/` — the Step 7 bug), this POST with a trailing slash succeeded directly. Express's default routing is not strict about trailing slashes (`strict routing` is off unless explicitly enabled), so `/applications` and `/applications/` are treated as the same route — a useful contrast between the two backend frameworks' default behaviors.

### 2.2 — Why three Ingress objects? (4 pts)

The API routes use two separate Ingress objects (`jobs-ingress` and `applications-ingress`) instead of one, plus a third (`frontend-ingress`) for the UI.

**Why `rewrite-target` only takes one value per Ingress object:** it's an annotation on the *Ingress resource itself* (`metadata.annotations`), not on an individual path rule within it. Even though one Ingress object can list multiple `path` rules, the NGINX ingress controller applies a single global `rewrite-target` template to *all* paths matched by that object — there's no per-path override in the stock annotation model (some other ingress controllers/CRDs support per-path rewrites, but `nginx.ingress.kubernetes.io/rewrite-target` does not).

**What would break with one combined Ingress:** say a single Ingress covered both `/api/jobs` and `/api/applications` with one `rewrite-target: /jobs$1$2`. Every path matched by that object — including requests to `/api/applications/...` — would get rewritten using that *same* `/jobs...` template, producing a nonsensical backend path (something like `/jobsapplications/...`) instead of `/applications/...`. There's no way to say "rewrite `/api/jobs/*` one way and `/api/applications/*` a different way" within a single annotation value — hence two separate Ingress objects, each with its own independent `rewrite-target`.

**Alternative architecture that would allow a single Ingress:** if `jobs-service` and `applications-service` each natively served their routes under path prefixes matching their external API paths — i.e., if `jobs-service` itself handled requests at `/api/jobs/...` internally, instead of just `/jobs/...` — then no rewriting would be needed at all. The Ingress could forward each path unmodified, and a single Ingress object with two plain path rules (no `rewrite-target` annotation) would work fine. This is a common real-world pattern: design backend services to be "ingress-path-aware" so the gateway/routing layer stays dumb (pure forwarding, no rewriting).

### 2.3 — NodePort vs ClusterIP vs LoadBalancer (4 pts)

| Type | Reachable from | Use case | Example in this lab |
|---|---|---|---|
| **ClusterIP** | Only from inside the cluster (pod-to-pod) | Internal service-to-service communication; the default, most secure option — nothing is exposed outside the cluster unless something else routes to it | `postgres`, `jobs-service`, `applications-service`, and `frontend` (its original type, before the test below) |
| **NodePort** | From outside the cluster, via `<any-node-IP>:<allocated-port>` (30000-32767 range) | Quick/dev-only external access without needing a LoadBalancer or Ingress; opens the same static port on *every* node | `frontend`, temporarily patched to `NodePort` for this exercise — reachable directly at `http://192.168.49.2:31569`, completely bypassing the Ingress |
| **LoadBalancer** | From outside the cluster, via a cloud-provisioned external IP (or `minikube tunnel` locally) | Production external access to a single service, when the platform can provision a real load balancer | Not used in this lab — minikube has no cloud LB provisioner by default; would need `minikube tunnel` to simulate one |
| **Ingress** | From outside the cluster, via the Ingress Controller's one shared address, HTTP(S) only | Path/host-based routing for multiple HTTP services behind a single external address, with rewriting and (optionally) TLS termination | `jobs-ingress`, `applications-ingress`, `frontend-ingress` — all three routed through the single address `192.168.49.2:80` |

**Hands-on verification — patched `frontend` to NodePort:**
```bash
kubectl patch svc frontend -n jobboard -p '{"spec":{"type":"NodePort"}}'
kubectl get svc frontend -n jobboard
minikube service frontend -n jobboard --url
curl -s -o /dev/null -w "%{http_code}\n" $(minikube service frontend -n jobboard --url)
```
Result:
```
NAME       TYPE       CLUSTER-IP      EXTERNAL-IP   PORT(S)        AGE
frontend   NodePort   10.106.62.227   <none>        80:31569/TCP   6h44m
http://192.168.49.2:31569
200
```
Confirms `frontend` is now directly reachable at `192.168.49.2:31569` — bypassing the Ingress Controller entirely, hitting the node's own allocated port straight through to the Service.

### 2.4 — Network Policies (4 pts) *(Hard)*

**File:** `k8s/09-network-policy.yaml`
```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: postgres-network-policy
  namespace: jobboard
  labels:
    app.kubernetes.io/part-of: jobboard
    app.kubernetes.io/managed-by: kustomize
spec:
  podSelector:
    matchLabels:
      app: postgres
  policyTypes:
    - Ingress
  ingress:
    - from:
        - podSelector:
            matchLabels:
              app: jobs-service
        - podSelector:
            matchLabels:
              app: applications-service
      ports:
        - protocol: TCP
          port: 5432
```

**Intent:** allow only `jobs-service` and `applications-service` pods to reach `postgres` on port 5432; deny all other ingress traffic to it (including `frontend` and anything outside the cluster). Once any NetworkPolicy selects a pod for `Ingress`, Kubernetes switches that pod from default-allow to deny-except-explicitly-listed — so this one policy both allows the two app services and blocks everyone else, by construction.

**Applied and verified with the spec's exact test commands:**
```bash
kubectl apply -f k8s/09-network-policy.yaml

# This should FAIL (blocked by NetworkPolicy):
kubectl run test-block --image=busybox -n jobboard --restart=Never -- nc -zv -w3 postgres 5432
kubectl logs test-block -n jobboard
kubectl delete pod test-block -n jobboard

# This should SUCCEED (from an actual jobs-service pod):
POD=$(kubectl get pod -n jobboard -l app=jobs-service -o jsonpath='{.items[0].metadata.name}')
kubectl exec $POD -n jobboard -- python3 -c "import socket; s=socket.create_connection(('postgres',5432), timeout=5); print('Connected')"
```

**Results:**
- `test-block` (no matching label, should be blocked): `postgres (10.103.238.232:5432) open` — **connected successfully**, i.e. NOT blocked.
- `jobs-service` pod (should be allowed): `Connected` — succeeded, as expected either way.

**Observation (as the task explicitly asks to document):** the policy is semantically correct and was applied successfully, but is **not being enforced**. `test-block`, despite matching neither `app: jobs-service` nor `app: applications-service`, still connected to Postgres on port 5432 without restriction.

**Why:** NetworkPolicy is a Kubernetes API object; *enforcing* it requires the cluster's CNI (the plugin implementing pod networking) to actually read and apply those rules — not all CNIs do. minikube's default CNI here is the `bridge` CNI (visible in Step 1's `minikube start` output: "Configuring bridge CNI"), which does not implement NetworkPolicy enforcement at all. The policy sits validly in the API server, but nothing in the data path consults it.

**What a real fix would require:** starting minikube with a NetworkPolicy-capable CNI instead, e.g. `minikube start --cni=calico` (or Cilium) — which means recreating the cluster from scratch. Not done here, to avoid re-running Steps 1-7 on infrastructure that's otherwise working correctly. On any managed cloud Kubernetes (GKE, EKS with the right CNI add-on, AKS), this same YAML would enforce as intended with no changes.

---

## Task 3 — Persistent Storage & Data Lifecycle (15 pts)
**Status:** ✅ Complete

### 3.1 — Inspect the PersistentVolumeClaim (5 pts)

```bash
kubectl describe pvc postgres-pvc -n jobboard
kubectl get pv
```

**Output:**
```
Name:            postgres-pvc
Namespace:       jobboard
StorageClass:    standard
Status:          Bound
Volume:          pvc-52304327-715d-48c5-9f50-2a5ea854f0da
Annotations:     volume.kubernetes.io/storage-provisioner: k8s.io/minikube-hostpath
Capacity:        1Gi
Access Modes:    RWO
VolumeMode:      Filesystem
Used By:         postgres-5b8d74874c-9jwml

NAME                                       CAPACITY   ACCESS MODES   RECLAIM POLICY   STATUS   CLAIM                    STORAGECLASS
pvc-52304327-715d-48c5-9f50-2a5ea854f0da   1Gi        RWO            Delete           Bound    jobboard/postgres-pvc    standard
```

**What is the Reclaim Policy of the bound PersistentVolume?**
`Delete`.

**What does `Retain` vs `Delete` mean for data when the PVC is deleted?**
`Delete` (what's configured here) means that when the `PersistentVolumeClaim` object is deleted, Kubernetes automatically deletes the underlying `PersistentVolume` *and* the actual data it points to (here, the hostPath directory on the minikube node's disk) — the data does not survive PVC deletion. `Retain`, by contrast, leaves the `PersistentVolume` and its underlying data intact even after the claim is deleted; the PV just moves to a `Released` state, and someone has to manually reclaim/delete it (or manually rebind it to a new PVC) before that storage can be reused. For a lab environment `Delete` is convenient (no leftover cruft after `minikube delete`), but for a real production database, `Retain` is usually the safer default — an accidental `kubectl delete pvc` shouldn't be able to instantly destroy your actual data.

**What is the Access Mode, and why can't postgres use `ReadWriteMany`?**
`RWO` (`ReadWriteOnce`) — the volume can be mounted read-write by only one node at a time (in single-node minikube, this effectively means one pod at a time). Postgres can't use `ReadWriteMany` for two separate reasons: first, architecturally, Postgres's storage engine assumes exclusive ownership of its data directory — it manages its own locking, write-ahead logs, and file consistency assuming no other process is writing to those same files concurrently; if two Postgres instances mounted the same RWX volume and both tried to write, the result would be data corruption, not a working replica (Postgres isn't designed for shared-disk clustering this way). Second, infrastructurally, this specific setup couldn't do it anyway — the `k8s.io/minikube-hostpath` provisioner backing this StorageClass only supports `RWO`; `ReadWriteMany` requires a network filesystem-backed StorageClass (like NFS or CephFS), which minikube doesn't provide by default.

---

### 3.2 — Verify data persistence across pod restarts (5 pts)

```bash
MINIKUBE_IP=$(minikube ip)

# 1. Create a job via the API
curl -s -X POST http://$MINIKUBE_IP/api/jobs \
  -H "Content-Type: application/json" \
  -d '{"title":"K8s Persistence Test","description":"This job must survive a pod restart","company":"TestCo","location":"Remote","salary_range":"$1 - $2"}' \
  | python3 -m json.tool

# 2. Delete the postgres pod (Deployment will recreate it)
kubectl delete pod -l app=postgres -n jobboard

# 3. Wait for the new pod to be ready
kubectl wait --for=condition=ready pod -l app=postgres -n jobboard --timeout=60s

# 4. Verify the job still exists
curl -s http://$MINIKUBE_IP/api/jobs | python3 -m json.tool | grep "K8s Persistence"
```

**Note on paths:** the spec's example commands use a trailing slash (`/api/jobs/`); `jobs-service` (FastAPI) 307-redirects trailing-slash requests to the non-slash form (the same behavior documented in Step 7 and Task 2.1), so both the POST and the final GET had to drop the trailing slash to get a real response instead of an empty body.

**Results:**
```
POST response: {"title":"K8s Persistence Test", ..., "id":"88c5a7c4-e69b-48ec-a0f3-b680984a8ab1", "created_at":"2026-08-18T07:04:07.554817Z"}
pod "postgres-5b8d74874c-9jwml" deleted
pod/postgres-5b8d74874c-pn8kw condition met   (new pod ready)
GET after restart: "title": "K8s Persistence Test"   ← still present
```

**Why the data survived — the role of the PVC and the Deployment's `Recreate` strategy:**

Deleting the pod only destroys the pod object (the running container and its process) — it does not touch the `postgres-pvc` PersistentVolumeClaim or the PersistentVolume it's bound to. The actual data lives in the hostPath directory backing that PV, on the minikube node's own disk, completely independent of any pod's lifecycle. When the Deployment controller notices the pod is gone, it creates a brand-new pod from the same template, which mounts that *same* PVC at the *same* path (`/var/lib/postgresql/data`) — so the new Postgres process starts up, finds its existing data files exactly where the old one left them, and resumes serving the same database with no data loss.

The `strategy: Recreate` setting (confirmed via `kubectl get deployment postgres -o jsonpath='{.spec.strategy}'` → `{"type":"Recreate"}`) matters specifically because of the PVC's Access Mode: `postgres-pvc` is `RWO` (`ReadWriteOnce`), meaning it can only be attached to one pod/node at a time. The default Deployment strategy, `RollingUpdate`, briefly runs the old and new pod *simultaneously* during a rollout — which would be impossible here, since the new pod couldn't attach the RWO volume until the old pod fully released it, causing the rollout to hang or fail with a multi-attach error. `Recreate` avoids this entirely by guaranteeing the old pod is fully terminated (and its volume detached) *before* the new pod is even created — the correct strategy for any single-replica, RWO-backed stateful workload like this one.

---

### 3.3 — Manual database backup from Kubernetes (5 pts)

```bash
PG_POD=$(kubectl get pods -n jobboard -l app=postgres -o jsonpath='{.items[0].metadata.name}')

kubectl exec -n jobboard $PG_POD -- \
  sh -c 'PGPASSWORD=$POSTGRES_PASSWORD pg_dump -U $POSTGRES_USER -d $POSTGRES_DB --no-owner' \
  > k8s-backup-$(date +%Y%m%d_%H%M%S).sql

head -30 k8s-backup-*.sql
wc -l k8s-backup-*.sql
```

**Result:** `k8s-backup-20260818_100619.sql`, 114 lines. Dump header confirms PostgreSQL 16.15, and the schema (`CREATE TABLE public.applications ...`) is visible immediately — data rows (`COPY`/`INSERT` statements) follow further down for both the `jobs` and `applications` tables, including the `K8s Persistence Test` row from 3.2.

**Restore procedure — exact `kubectl exec` commands to restore this backup to a fresh postgres pod:**

```bash
# Identify the target pod (a newly-created/empty postgres pod)
NEW_PG_POD=$(kubectl get pods -n jobboard -l app=postgres -o jsonpath='{.items[0].metadata.name}')

# Option A — stream the local backup file directly into psql via stdin (no copy step needed)
kubectl exec -i -n jobboard $NEW_PG_POD -- \
  sh -c 'PGPASSWORD=$POSTGRES_PASSWORD psql -U $POSTGRES_USER -d $POSTGRES_DB' \
  < k8s-backup-20260818_100619.sql

# Option B — copy the file into the pod first, then execute it from inside
kubectl cp k8s-backup-20260818_100619.sql jobboard/$NEW_PG_POD:/tmp/backup.sql
kubectl exec -n jobboard $NEW_PG_POD -- \
  sh -c 'PGPASSWORD=$POSTGRES_PASSWORD psql -U $POSTGRES_USER -d $POSTGRES_DB -f /tmp/backup.sql'

# Verify the restore succeeded
kubectl exec -n jobboard $NEW_PG_POD -- \
  sh -c 'PGPASSWORD=$POSTGRES_PASSWORD psql -U $POSTGRES_USER -d $POSTGRES_DB -c "SELECT count(*) FROM jobs;"'
```

`kubectl exec -i` (Option A) pipes the local file's contents into the container's stdin, which `psql` reads and executes as a script — the simplest path, no intermediate file inside the pod. `kubectl cp` + `-f` (Option B) is the alternative when the dump is large enough that you'd rather have it as a real file inside the container (e.g., to re-run it, or if piping over a slow connection is a concern). Either restores the full schema and data captured in the dump onto a completely fresh Postgres instance.

---

## Task 4 — Scaling & Rolling Updates (25 pts)
**Status:** ✅ Complete

### 4.1 — Manual scaling (5 pts)

```bash
kubectl scale deployment jobs-service --replicas=4 -n jobboard
kubectl get pods -n jobboard -l app=jobs-service -w
kubectl rollout status deployment/jobs-service -n jobboard
```

**Result:** all 4 replicas reached `Running`/`1/1` within ~14 seconds (2 new pods went `Init:0/1` → `PodInitializing` → `Running`); `kubectl rollout status` confirmed `deployment "jobs-service" successfully rolled out`.

**How does the Ingress distribute traffic across 4 replicas?**
The Ingress Controller doesn't talk to individual pods directly through the Kubernetes Service abstraction in the way one might assume — `ingress-nginx` specifically watches `EndpointSlices` for the target Service and proxies straight to the current set of healthy pod IPs, bypassing the Service's ClusterIP for performance. Either way, from the Deployment's perspective: scaling to 4 replicas means the Service now has 4 matching pod IPs in its endpoint list instead of 2, and every subsequent request gets spread across all 4 rather than 2.

**What load-balancing algorithm does the nginx ingress use by default?**
`round_robin` — each new connection goes to the next endpoint in sequence, cycling through all available pod IPs evenly. This can be changed per-Ingress via the `nginx.ingress.kubernetes.io/load-balance` annotation (e.g. `ewma` for least-outstanding-requests-weighted, or `ip_hash` for session affinity by client IP), but none of this app's Ingress objects override it, so plain round-robin is what's in effect.

**Scale back to 2 replicas — what happens to in-flight requests?**
```bash
kubectl scale deployment jobs-service --replicas=2 -n jobboard
```
Result: the two extra pods (`84w2w`, `dhljk`) transitioned `Terminating` → `Completed` cleanly, not killed abruptly. Mechanically: when a pod is marked for termination, Kubernetes immediately removes it from the Service's endpoint list (so kube-proxy/ingress stop routing *new* connections to it), then sends `SIGTERM` to the container and waits up to `terminationGracePeriodSeconds` (default 30s) for it to finish any request already in progress and shut down cleanly — only escalating to `SIGKILL` if it doesn't exit in time. So a request already being handled by a terminating pod is allowed to complete normally; only new requests stop being sent there.

*Caveat on this run's evidence:* the 30-request curl loop (all returned `200`, zero errors) actually finished executing *before* the `scale --replicas=2` command ran — both were typed sequentially into the same terminal rather than run concurrently in two separate terminals as intended, so this particular test doesn't capture a truly overlapping in-flight request during the scale-down transition. The graceful `Terminating → Completed` pod lifecycle observed is still solid evidence the mechanism itself works as described above, just not a live-request-under-fire demonstration.

---


### 4.2 — Rolling update with zero downtime (10 pts)

```bash
eval $(minikube docker-env)
docker build -t jobs-service:v2 ./jobs-service

kubectl set image deployment/jobs-service jobs-service=jobs-service:v2 -n jobboard
kubectl rollout status deployment/jobs-service -n jobboard -w
```
In parallel, a continuous health check loop:
```bash
for i in $(seq 1 60); do
  curl -s -o /dev/null -w "%{http_code} " http://$MINIKUBE_IP/api/jobs
  sleep 0.5
done
```

**Note on the build:** every Docker layer hit cache, producing an image hash (`sha256:1d19fc92fa54...`) byte-identical to the original `jobs-service:latest` from Step 2 — nothing in the build context had actually changed. So `jobs-service:v2` is functionally the same image as v1, just re-tagged. This still exercises the real rolling-update *mechanism* (pods get replaced under a new tag with zero downtime), just without an actual code/behavior difference to verify against — documenting this honestly rather than implying more was tested than actually was.

**Results:**
```
deployment "jobs-service" successfully rolled out
```
Health-check loop: 60/60 requests returned `200`, zero errors, across a 30-second window spanning the rollout.

**What does `maxSurge: 1, maxUnavailable: 0` mean?**
Confirmed via `kubectl get deployment jobs-service -o jsonpath='{.spec.strategy.rollingUpdate}'` → `{"maxSurge":1,"maxUnavailable":0}`. `maxUnavailable: 0` means the number of *available* pods may never drop below the desired replica count during a rollout — no old pod is terminated until its replacement is confirmed ready. `maxSurge: 1` means Kubernetes is allowed to temporarily run *one extra* pod above the desired count to make that possible. Together, they guarantee full serving capacity is maintained at every single point during the rollout — the mechanism that produced the unbroken 60/60 `200`s above.

**Timeline for `replicas: 2, maxSurge: 1, maxUnavailable: 0`:**
```
T0:  [v1] [v1]                    — 2/2 available, steady state
T1:  [v1] [v1] [v2:starting]      — new pod created (surge +1, total 3); still 2/2 available (v2 not ready yet)
T2:  [v1] [v1] [v2:ready]         — v2 passes readiness; now 3/3 available
T3:  [v1] [v2]                    — one old pod terminated (back to desired count 2); 2/2 available throughout
T4:  [v1] [v2] [v2:starting]      — second new pod created (surge +1 again, total 3); 2/2 available
T5:  [v1] [v2] [v2:ready]         — second v2 passes readiness; 3/3 available
T6:  [v2] [v2]                    — last old pod terminated; rollout complete, 2/2 available, all v2
```
At no point does available capacity drop below 2 — the surge pod absorbs the "extra" slot needed to replace one old pod at a time without ever going under.

**How would you rollback if the new version was broken?**
```bash
kubectl rollout undo deployment/jobs-service -n jobboard
kubectl rollout history deployment/jobs-service -n jobboard
```
`rollout undo` reverts to the previous ReplicaSet revision (here, revision 1) using the exact same rolling, zero-downtime mechanism described above — it's not a special case, just another rolling update targeting the prior image. `rollout history` lists all retained revisions (confirmed: revisions 1 and 2 both present after this update) so you can target a specific older revision with `--to-revision=N` if you need to roll back further than one step.

---

---

### 4.3 — HorizontalPodAutoscaler (10 pts)

```bash
kubectl get hpa -n jobboard
kubectl run load-gen --rm -it --image=busybox -n jobboard -- \
  sh -c "while true; do wget -qO- http://jobs-service:8000/jobs > /dev/null; done"
# (in parallel) kubectl get pods -n jobboard -l app=jobs-service -w
kubectl describe hpa jobs-service-hpa -n jobboard
```

**Result — `jobs-service` scaled from 2 up to 6 replicas (the configured max) under load:**
```
Metrics:  ( current / target )
  resource cpu on pods (as a percentage of request):     172% (86m) / 60%
  resource memory on pods (as a percentage of request):  46% (60488Ki) / 75%
Min replicas: 2   Max replicas: 6   Deployment pods: 6 current / 6 desired

Behavior:
  Scale Up:   Stabilization Window: 60s   Policies: +2 pods per 60s (Select Policy: Max)
  Scale Down: Stabilization Window: 300s  Policies: -1 pod per 120s (Select Policy: Max)

Events:
  SuccessfulRescale  New size: 3; reason: All metrics below target
  SuccessfulRescale  New size: 2; reason: All metrics below target
  SuccessfulRescale  New size: 4; reason: cpu resource utilization (percentage of request) above target
  SuccessfulRescale  New size: 6; reason: cpu resource utilization (percentage of request) above target
```
This single output happens to capture both directions — scale-up under the load generator (4 → 6, driven by CPU exceeding its 60% target) and earlier scale-down events (3 → 2, "All metrics below target") from a previous quiet period.

**What is the formula the HPA uses to calculate desired replicas?**
```
desiredReplicas = ceil(currentReplicas × (currentMetricValue / desiredMetricValue))
```
Applied here: with CPU at 172% against a 60% target, from a starting point of 4 replicas, the raw formula gives `ceil(4 × (172/60)) = ceil(11.47) = 12` — but the HPA is capped at `maxReplicas: 6`, which is exactly why it landed on 6 rather than climbing further; the load generator was pushing well past what even the maximum replica count could bring back under target.

**What is `stabilizationWindowSeconds` and why is it important for scale-down?**
It's the lookback window the HPA controller uses before acting on a *decrease* in desired replicas — rather than reacting to the single latest metric reading, it takes the highest recommended replica count across the entire window (here, 300 seconds / 5 minutes for scale-down, vs. only 60 seconds for scale-up) and only scales down if that sustained maximum still supports fewer pods. This prevents "flapping" — rapidly oscillating replica counts when load bounces around near the threshold, which would otherwise mean constantly killing and recreating pods (wasteful, and disruptive to in-flight connections on the pods being removed). The asymmetry — short window for scaling up, long window for scaling down — is deliberate: under-provisioning during a real spike is costly (dropped/slow requests), so the HPA reacts to spikes fast, but removing capacity is done cautiously, only once reduced load is clearly sustained.

**What happens if `metrics-server` is not installed? How would you diagnose this?**
Without `metrics-server`, the HPA controller has no CPU/memory data to act on at all — `kubectl get hpa` would show `<unknown>` in place of real percentages for every metric, and the HPA would never scale in either direction (frozen at whatever replica count it last had). This exact failure mode was actually observed live in this cluster's own event history, even *with* `metrics-server` installed: `Warning FailedGetResourceMetric ... "did not receive metrics for targeted pods (pods might be unready)"` — happening transiently while pods were mid-restart during earlier debugging, and a separate `Warning FailedGetScale ... Unauthorized` event (an RBAC hiccup) that self-resolved once conditions normalized. To diagnose a stuck/`<unknown>` HPA:
```bash
kubectl describe hpa jobs-service-hpa -n jobboard   # check Events for FailedGetResourceMetric / FailedGetScale
kubectl top pods -n jobboard                        # fails outright if metrics-server isn't running/reachable
kubectl get deployment metrics-server -n kube-system # confirm it's actually deployed and healthy
kubectl get apiservices | grep metrics               # confirm the metrics.k8s.io APIService is Available
```

---

---

## Task 5 — Secrets & ConfigMaps (10 pts)
**Status:** In progress (5.1 done)

### 5.1 — Inspect the Secret (4 pts)

```bash
kubectl get secret postgres-secret -n jobboard -o yaml
kubectl get secret postgres-secret -n jobboard -o jsonpath='{.data.POSTGRES_PASSWORD}' | base64 -d; echo
```

**Output:**
```yaml
apiVersion: v1
data:
  POSTGRES_DB: am9iYm9hcmQ=
  POSTGRES_PASSWORD: <redacted-base64-value>
  POSTGRES_USER: cG9zdGdyZXM=
kind: Secret
type: Opaque
```
Decoded password: `<redacted — decoded successfully with a single \`base64 -d\` command, no key or credential required>` (actual value intentionally not recorded in this document — it's a credential, not something that belongs in a file that may end up committed/shared).

**Kubernetes Secrets are base64-encoded, not encrypted. What does this mean for security?**
Base64 is a reversible *encoding* (making arbitrary binary data safe to represent as text in YAML/JSON), not *encryption* — there's no key involved, and anyone with read access to the Secret object can decode it in one command, as demonstrated above. Practically, this means: RBAC permissions on Secret objects are the *only* real protection — any user, service account, or compromised pod that can `kubectl get secret -o yaml` (or read the Secret's mounted file/env var from inside a pod that consumes it) has the plaintext credential instantly. It also means Kubernetes' backing datastore, etcd, stores Secret data unencrypted by default, unless encryption-at-rest is separately configured at the cluster level — so anyone with etcd access (direct or via a backup snapshot) can extract every Secret in the cluster with zero cryptographic effort. Base64 exists purely for safe text representation, not confidentiality.

**Name two production solutions that provide real secret encryption in Kubernetes:**
1. *A Kubernetes-native solution:* Encryption at Rest, configured via an `EncryptionConfiguration` passed to `kube-apiserver` (`--encryption-provider-config`), which encrypts Secret data before it's ever persisted to etcd — using a local key (`aescbc` provider) or, more robustly, a cloud KMS (AWS KMS / GCP KMS / Azure Key Vault) via the `kms` provider plugin, so the actual encryption key never lives inside the cluster itself.
2. *An external secrets manager:* HashiCorp Vault (via the Vault Agent Injector, which mutates pods to fetch secrets at startup) or a cloud-native equivalent like AWS Secrets Manager / GCP Secret Manager, typically integrated through the External Secrets Operator — these store and encrypt secrets entirely outside the cluster, syncing only what's needed into Kubernetes Secret objects (or bypassing them entirely) at runtime.

**What is Sealed Secrets and how does it work?**
Sealed Secrets (Bitnami) is an open-source controller plus a `kubeseal` CLI tool that solves a narrower, very practical problem: safely committing secrets to git. It runs in-cluster holding an asymmetric keypair. You encrypt a real Secret manifest client-side with `kubeseal`, using only the controller's *public* key (fetchable by anyone), producing a `SealedSecret` custom resource containing ciphertext — since only the *private* key (which never leaves the cluster) can decrypt it, the SealedSecret YAML is safe to commit to a public repo even though the original Secret wasn't. Applying the SealedSecret to the cluster triggers the controller to decrypt it and automatically create/update the corresponding real Kubernetes `Secret` object from the plaintext — so the workflow becomes "commit the encrypted SealedSecret to git, let the controller materialize the real Secret," instead of ever committing raw base64'd credentials.

---

### 5.2 — Add a ConfigMap for app configuration (6 pts)
**Status:** ✅ Complete

**`k8s/10-configmap.yaml`:**
```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: jobboard-config
  namespace: jobboard
data:
  LOG_LEVEL:       "info"
  MAX_JOBS:        "100"
  ALLOWED_ORIGINS: "http://localhost,http://jobboard.local"
```

**Patched `k8s/03-jobs-service.yaml`** to consume it — added `envFrom` as a sibling of the existing `env:` block on the container:
```yaml
          envFrom:
            - configMapRef:
                name: jobboard-config
          env:
            - name: POSTGRES_USER
              ...
```

**Two real issues hit getting this applied — both instructive:**

1. **`kubectl apply -f k8s/03-jobs-service.yaml` failed:** `spec.selector: Invalid value ...: field is immutable`. Root cause: the cluster's `jobs-service` Deployment was originally created via `kubectl apply -k k8s/` (Kustomize), and the (deprecated) `commonLabels` field in `k8s/kustomization.yaml` injects its labels into `spec.selector.matchLabels`, not just `metadata.labels` — confirmed via `kubectl get deployment jobs-service -o jsonpath='{.spec.selector}'` → `{"matchLabels":{"app":"jobs-service","app.kubernetes.io/managed-by":"kustomize","app.kubernetes.io/part-of":"jobboard"}}`, three labels, vs. the raw file's single-label selector. Applying the raw file directly tried to shrink the selector back down to one label — and `spec.selector` is deliberately immutable on Deployments (changing it could cause two Deployments to fight over the same pods), so the API server rejected it outright. **Fix:** apply through Kustomize instead (`kubectl apply -k k8s/`), so the selector Kustomize generates matches what's already live.
2. **New pod stuck in `CreateContainerConfigError`:** the `k8s/10-configmap.yaml` file had been written to disk but never actually `kubectl apply`'d before the Deployment update went out — so the new pod's `envFrom` reference pointed at a ConfigMap that didn't exist yet. Confirmed via `kubectl get configmap jobboard-config -n jobboard` → `NotFound`. **Fix:** `kubectl apply -f k8s/10-configmap.yaml`, after which the stuck pod recovered automatically (no restart needed — the Deployment controller just retried).

Useful side-evidence from issue #2: while the new pod was stuck, the *old* two pods stayed `Running` and kept serving traffic untouched — `maxUnavailable: 0` (from Task 4.2) refusing to kill them until a replacement was actually healthy, exactly as designed.

**Final verification:**
```bash
kubectl exec -it $POD -n jobboard -- env | grep -E "LOG_LEVEL|MAX_JOBS"
```
```
MAX_JOBS=100
LOG_LEVEL=info
```

**What is the difference between `env` (individual key) and `envFrom` (all keys)?**
`env` declares environment variables one at a time, each with an explicit `name:` and a `value:` or `valueFrom:` pointing at a specific key in a Secret/ConfigMap/pod field — full control over naming and exactly which keys get pulled in (as used for `POSTGRES_USER`, `POSTGRES_PASSWORD`, etc., each individually sourced from `postgres-secret`). `envFrom` instead bulk-imports *every* key from an entire ConfigMap or Secret as environment variables, using each key's own name verbatim as the variable name — much less boilerplate when you want the whole thing, but no renaming and no picking-and-choosing; if two `envFrom` sources happen to share a key name, whichever is listed later silently wins.

**When would you use a ConfigMap vs a Secret?**
ConfigMap for non-sensitive configuration — values that are fine to see in plaintext via `kubectl get`, in logs, or committed to git (log levels, feature flags, allowed CORS origins, non-secret URLs — exactly what `jobboard-config` holds here). Secret for anything sensitive — credentials, API keys, tokens, certificates — where leaking the value would be a real security incident. Functionally the two are consumed almost identically (`env`/`envFrom`/volume mounts all work the same way for both), but only Secrets integrate with the encryption-at-rest, RBAC-scoping, and external-secrets-manager tooling discussed in 5.1 — using a ConfigMap for credentials would mean skipping all of that protection entirely.

**What happens to running pods when you update a ConfigMap? (Hint: it depends...)**
It depends entirely on *how* the pod consumes it. If mounted as a **volume**, the kubelet periodically syncs the mounted files in-place inside the already-running container (typically within about a minute) — no pod restart — but the application itself has to notice the file changed and reload it; many apps don't watch for this automatically. If consumed via **`env`/`envFrom`** (as done here), environment variables are only ever set once, at container start — updating the ConfigMap does **not** change anything in an already-running container. The Deployment has to be manually rolled (`kubectl rollout restart deployment/jobs-service`) for pods to pick up the new values. This is exactly why some setups hash the ConfigMap's content into a pod template annotation, specifically to force an automatic rollout whenever the config changes — env-var consumption otherwise silently goes stale.

---


## Task 6 — CI/CD Integration (15 pts)
**Status:** Complete — `deploy-to-k8s` job added to the real, existing CI/CD pipeline and pushed to GitHub.

**Important correction from an earlier draft of this section:** I initially assumed this repo had no working CI/CD pipeline and drafted a brand-new `push-to-registry` job from scratch. That was wrong — this repo already has a complete, real Part 1 pipeline at `.github/workflows/ci.yml` with 7 jobs:

```
lint-python ─┐
audit-node ──┼─→ build-images ─→ trivy-scan ─────────┐
unit-tests ──┘                 → integration-tests ───┴─→ push-images
```

`push-images` already builds and pushes all four images (`jobs-service`, `applications-service`, `frontend`, `nginx`) to Docker Hub, tagged with both `latest` and `${{ github.sha }}`, using `${{ env.IMAGE_PREFIX }}` = `${{ secrets.DOCKERHUB_USERNAME }}/jobboard`. Once I had the real file (not a WebFetch summary — verbatim, pasted from the terminal), I added `deploy-to-k8s` as job #8, depending on the real `push-images` job rather than inventing a duplicate.

### 6.1 — `deploy-to-k8s` job added to `.github/workflows/ci.yml`

```yaml
  # ── 8. Deploy to Kubernetes (K8s Lab Extension, Task 6) ───────────────────
  deploy-to-k8s:
    name: Deploy to Kubernetes
    runs-on: ubuntu-latest
    needs: [push-images]
    if: github.ref == 'refs/heads/main' && github.event_name == 'push'
    steps:
      - uses: actions/checkout@v4
      - name: Set up kubectl
        uses: azure/setup-kubectl@v3
      - name: Configure kubeconfig
        run: |
          echo "${{ secrets.KUBECONFIG_BASE64 }}" | base64 -d > kubeconfig.yml
          echo "KUBECONFIG=$(pwd)/kubeconfig.yml" >> "$GITHUB_ENV"
      - name: Deploy jobs-service
        run: |
          kubectl set image deployment/jobs-service \
            jobs-service=${{ env.IMAGE_PREFIX }}-jobs-service:${{ github.sha }} \
            -n jobboard
          kubectl rollout status deployment/jobs-service -n jobboard --timeout=120s
      - name: Deploy applications-service
        run: |
          kubectl set image deployment/applications-service \
            applications-service=${{ env.IMAGE_PREFIX }}-applications-service:${{ github.sha }} \
            -n jobboard
          kubectl rollout status deployment/applications-service -n jobboard --timeout=120s
      - name: Deploy frontend
        run: |
          kubectl set image deployment/frontend \
            frontend=${{ env.IMAGE_PREFIX }}-frontend:${{ github.sha }} \
            -n jobboard
          kubectl rollout status deployment/frontend -n jobboard --timeout=120s
      - name: Smoke test - pods running
        run: |
          kubectl get pods -n jobboard
          NOT_RUNNING=$(kubectl get pods -n jobboard --field-selector=status.phase!=Running --no-headers | wc -l)
          if [ "$NOT_RUNNING" -gt 0 ]; then
            echo "ERROR: $NOT_RUNNING pod(s) not Running"
            exit 1
          fi
      - name: Smoke test - health endpoints
        run: |
          kubectl run smoke-test --rm -i --restart=Never --image=curlimages/curl -n jobboard -- \
            sh -c "curl -sf http://jobs-service:8000/health && echo && curl -sf http://applications-service:3001/health && echo"
```

`deploy-to-k8s` runs only after `push-images` succeeds (`needs: [push-images]`) and only on a push to `main` — same gate `push-images` itself uses. It updates the three Deployments this lab's k8s manifests define (`jobs-service`, `applications-service`, `frontend` — no separate `nginx` Deployment exists in the k8s version; the frontend serves its own `nginx.conf` directly), using the exact SHA-tagged images `push-images` just pushed, then verifies each rollout and runs the same two smoke-test checks documented in 6.2.

### 6.2 — Smoke test steps, verified for real against minikube

Before pushing, I ran the exact commands the workflow uses, directly against the running minikube cluster:

**Pods Running:**
```bash
kubectl get pods -n jobboard
```
```
NAME                                    READY   STATUS    RESTARTS   AGE
applications-service-5dd8c5968f-9dg8h   1/1     Running   0          22h
applications-service-5dd8c5968f-cskzf   1/1     Running   0          22h
frontend-667676749f-k8vt2               1/1     Running   0          17h
frontend-667676749f-sf4p5               1/1     Running   0          17h
jobs-service-79bf545784-hrj7f           1/1     Running   0          168m
jobs-service-79bf545784-xnh7j           1/1     Running   0          3h4m
postgres-5b8d74874c-pn8kw               1/1     Running   0          5h12m
```

**Health endpoints (from inside the cluster):**
```bash
kubectl run smoke-test --rm -i --restart=Never --image=curlimages/curl -n jobboard -- \
  sh -c "curl -sf http://jobs-service:8000/health && echo && curl -sf http://applications-service:3001/health && echo"
```
```
{"status":"healthy","service":"jobs-service","version":"1.0.0"}
{"status":"healthy","service":"applications-service","version":"1.0.0"}
pod "smoke-test" deleted from jobboard namespace
```

### Real bugs found and fixed during end-to-end browser verification

Everything above was verified via `curl` and `kubectl`, which is why these next two bugs went undetected until the app was actually opened in a real browser — a good example of why the Submission Checklist asks for a browser screenshot, not just command output.

**Bug 1 — Frontend crashed with a blank white page after loading for under a second.**

Browser DevTools showed `Uncaught TypeError: e.map is not a function`, and the Network tab showed the real cause:
```
GET http://192.168.49.2/api/jobs/  →  307 Temporary Redirect  →  Location: http://192.168.49.2/jobs
```
`frontend/src/App.jsx` calls `` `${API_BASE}/api/jobs/` `` with a trailing slash. FastAPI (jobs-service) auto-redirects `/jobs/` → `/jobs` internally, but builds that `Location` header using the browser's own host — so the browser followed it to `http://192.168.49.2/jobs` directly, skipping the `/api` prefix and the Ingress rewrite entirely. That bare path only matches the frontend's catch-all Ingress rule, so the browser received the SPA's `index.html` instead of JSON, and the frontend crashed trying to `.map()` over an HTML string.

This bug was always latent — Task 3.2 had already worked around the same FastAPI trailing-slash redirect behavior by dropping the slash in `curl` commands, but the frontend's own hardcoded fetch calls were never fixed, and this was the first time the app was tested through an actual browser rather than `curl`.

**Fix:** removed the trailing slash from both fetch calls in `frontend/src/App.jsx` (lines 95 and 146):
```bash
sed -i 's|/api/jobs/`|/api/jobs`|g' frontend/src/App.jsx
```

**Bug 2 — Rebuilding the frontend image then caused a `CrashLoopBackOff`.**

After rebuilding and rolling out, the new frontend pod failed its liveness/readiness probes indefinitely (`connect: connection refused` on port 80) and was killed in a loop. Pod logs showed nginx starting normally, then `unlink() "/run/nginx.pid" failed (13: Permission denied)` on shutdown — a sign nginx was running as a non-root user.

Root cause: `frontend/Dockerfile` runs `USER nginx` (non-root, per the Part 1 hardening) and `frontend/nginx-spa.conf` correctly listens on `8080` (unprivileged, non-root can't bind port 80). But `k8s/05-frontend.yaml` was built assuming port `80` — `containerPort`, both probes, and the Service's `targetPort` all pointed at 80. The old pods that had been running for 19 hours were built earlier in this session from a different, non-hardened `nginx.conf` (root, port 80), which is why they hadn't surfaced this — only the freshly-rebuilt image, using the real committed source, exposed the mismatch.

**Fix:** updated `k8s/05-frontend.yaml` — `containerPort: 8080`, both probes' `port: 8080`, Service `targetPort: 8080` (the Service's external `port: 80` was left unchanged, so `k8s/06-ingress.yaml` needed no changes).

**Bug 3 — Reapplying hit the same immutable-selector issue from Task 5.2.**

```
error: The Deployment "frontend" is invalid: spec.selector: Invalid value: {"matchLabels":{"app":"frontend"}}: field is immutable
```
Same root cause as Task 5.2: Kustomize's deprecated `commonLabels` had injected extra labels into the *live* Deployment's `spec.selector.matchLabels`, mismatching the raw file's plain selector. Applying through Kustomize instead of the raw file resolved it, consistent with the fix already documented in Task 5.2:
```bash
kubectl apply -k k8s/
```

**Verification after all three fixes:**
```bash
kubectl get pods -n jobboard
```
```
NAME                                    READY   STATUS    RESTARTS   AGE
applications-service-5dd8c5968f-9dg8h   1/1     Running   0          25h
applications-service-5dd8c5968f-cskzf   1/1     Running   0          25h
frontend-667788bcbd-p6l4c               1/1     Running   0          2m59s
frontend-667788bcbd-xgg2l               1/1     Running   0          2m46s
jobs-service-79bf545784-hrj7f           1/1     Running   0          5h31m
jobs-service-79bf545784-xnh7j           1/1     Running   0          5h46m
postgres-5b8d74874c-pn8kw               1/1     Running   0          7h54m
```

Browser Network tab, reloaded:
```
GET http://192.168.49.2/api/jobs  →  200 OK
Content-Type: application/json
Content-Length: 5484
```

The job board UI now loads and stays loaded, with the jobs list rendering correctly end-to-end through the real Ingress path.

### Committing and pushing to GitHub

Before staging, `k8s/01-secret.yaml` (the real Postgres password) was added to `.gitignore` and confirmed absent from `git status`. After pushing, I independently verified `k8s/01-secret.yaml` returns a 404 on GitHub — it was never committed.

**Final commit and push:**
```bash
git commit -m "Add Kubernetes manifests and deploy-to-k8s CI job"
git push origin main
```
```
To https://github.com/Itayhu12/lab-job-board.git
   71cfac4..914fcf2  main -> main
```

Verified on GitHub afterward: `k8s/kustomization.yaml` and the rest of the `k8s/` folder are live at commit `914fcf2`, and `k8s/01-secret.yaml` correctly returns 404 (not committed).

**Honest caveat remaining:** the `deploy-to-k8s` job itself has not been confirmed to actually *run* successfully inside GitHub Actions — that requires the `KUBECONFIG_BASE64` secret pointing at a reachable cluster (minikube itself can't be reached by a GitHub-hosted runner, as noted below). The job is committed, valid YAML, and its logic was verified command-by-command against the live cluster, but an actual green GitHub Actions run against a real remote cluster was not performed in this session.

### Setting up `KUBECONFIG_BASE64` for a real cluster

minikube cannot be a CI deploy target — a GitHub-hosted Actions runner has no network path to a local minikube VM. For an actual reachable cluster (cloud-managed or self-hosted):

1. **Get a kubeconfig scoped to what CI needs** — ideally a dedicated ServiceAccount in the `jobboard` namespace with a Role/RoleBinding limited to `get`/`list`/`patch` on Deployments and `get` on Pods, rather than a full admin kubeconfig.
2. **Base64-encode it:**
   ```bash
   base64 -w0 ci-deploy-kubeconfig.yaml > kubeconfig.b64
   ```
   (`-w0` avoids line-wrapping, which would break the workflow's `base64 -d` step.)
3. **Add it as a GitHub Secret:** repo → Settings → Secrets and variables → Actions → New repository secret → name `KUBECONFIG_BASE64`, paste the base64 content.
4. **`DOCKERHUB_USERNAME` / `DOCKERHUB_TOKEN`** are already configured in this repo (used by the existing `push-images` job), so `deploy-to-k8s` reuses them via `${{ env.IMAGE_PREFIX }}` — no extra Docker Hub setup needed.
5. **Cluster reachability** — the kubeconfig's API server endpoint needs to be reachable from GitHub's runner. A cloud-managed cluster (EKS/GKE/AKS) with a public API endpoint works by default; a self-hosted/firewalled cluster needs either a self-hosted Actions runner on the same network, or an allow-listed API server plus a token-based (not client-cert-based) kubeconfig.

## Screenshots

**All manifests applied (`kubectl get all -n jobboard` — pods, services, deployments, replicasets, HPAs):**

![All k8s resources running in the jobboard namespace](screenshots/k8s-all-resources.png)

**All pods Running and Ready (`kubectl get pods -n jobboard`):**

![All pods Running and Ready in the jobboard namespace](screenshots/k8s-pods-running.png)

**Application accessible via minikube IP (browser screenshot):**

![Job board UI loaded via minikube IP through the real Ingress path, showing 16 available positions](screenshots/k8s-frontend-working.png)

## Submission Checklist
- [x] Screenshots showing all resources deployed and running — see **Screenshots** section above: `kubectl get all -n jobboard` (all manifests applied), `kubectl get pods -n jobboard` (all 7 pods `1/1 Running`), and a browser screenshot of the job board UI fully rendered at `http://<minikube-ip>/` with 16 positions listed, loaded end-to-end through the real Ingress path (`/api/jobs` → `200 OK`)
- [x] NetworkPolicy manifest — `k8s/09-network-policy.yaml` — committed to GitHub at commit `914fcf2`
- [x] ConfigMap manifest — `k8s/10-configmap.yaml` — committed to GitHub at commit `914fcf2`
- [x] GitHub Actions pipeline updated with Kubernetes deployment job — `deploy-to-k8s` appended to the real `.github/workflows/ci.yml` (job #8, `needs: [push-images]`), pushed to GitHub (`71cfac4..914fcf2`); smoke-test steps verified locally against minikube; the job's actual execution inside GitHub Actions against a real reachable cluster has not been confirmed (see caveat in Task 6)
- [x] This file complete with all task answers and command outputs
