# Vehicle Info API

A thin, production-quality AWS Lambda service that wraps an upstream vehicle-information endpoint. Given an Israeli license plate number, the service validates input, calls the upstream API, normalises the response into a stable envelope, and returns clean success/error results. It deploys to AWS via Terraform and is designed so every design choice can be explained — see [DECISIONS.md](./DECISIONS.md) for the rationale log.

---

## Architecture

```
Client
  │  POST /vehicle-info  {"license_plate":"12345678"}
  ▼
API Gateway HTTP API (v2)
  │  AWS_PROXY integration, payload format 2.0
  ▼
Lambda (nodejs22.x) ── Layer: zod
  │  validate → call upstream with timeout + retry
  ▼
Upstream: insurance-webhook-945894769129.us-central1.run.app
  POST /vehicle-info
```

---

## Confirmed API Contract

### Our endpoint

**Request**
```
POST /vehicle-info
Content-Type: application/json

{ "license_plate": "<7 or 8 digit string>" }
```

Plate format (confirmed by live probing): exactly 7 or 8 numeric digits after trimming whitespace. Example: `"12345678"` or `"1234567"`.

**Success — HTTP 200**
```json
{
  "success": true,
  "data": {
    "license_plate": "12345678",
    "manufacturer": "טויוטה",
    "model": "קורולה",
    "year": 2020,
    "color": "לבן"
  }
}
```
Note: upstream returns data fields in Hebrew.

**Error envelope (all non-200 responses)**
```json
{
  "success": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "Vehicle not found",
    "field": "license_plate"   // only present for VALIDATION_ERROR
  }
}
```

### Error taxonomy

| Scenario | HTTP | `code` |
|----------|------|--------|
| Missing or non-string `license_plate` | 400 | `VALIDATION_ERROR` |
| Plate doesn't match `^\d{7,8}$` | 400 | `VALIDATION_ERROR` |
| Vehicle not found in upstream | 404 | `NOT_FOUND` |
| Upstream 5xx / timeout after retries | 502 | `BAD_GATEWAY` |
| Unexpected server error | 500 | `INTERNAL_ERROR` |

### Observed upstream discrepancies (spec vs. live)
- Spec says 400 for invalid plate format; live returns **422** (FastAPI/Pydantic).
- Spec shows 404 body as `{success, error}`; live wraps it under `detail` → `{"detail":{"success":false,"error":"..."}}`.
- Both cases are handled defensively in `src/vehicle-service.ts`.

---

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Node.js | ≥ 22 | Local dev, build, test |
| npm | ≥ 10 | Package manager |
| Terraform | ≥ 1.6 | Infrastructure provisioning |
| AWS CLI | v2 | Credentials / profile configuration |
| zip | any | Artifact packaging |
| jq | any | Prettier curl output (optional) |

Set up Node with nvm:
```bash
nvm install   # reads .nvmrc → installs Node 22
nvm use
```

---

## Local development & testing

```bash
# Install dependencies
npm install

# Type-check without building
npm run typecheck

# Run all unit tests + coverage (no network calls)
npm test

# Watch mode during development
npm run test:watch

# Run live smoke tests against the real upstream (requires internet)
RUN_LIVE=1 npm run test:live
```

Coverage report prints to the terminal after `npm test`. All unit tests mock `fetch` and run offline.

---

## Build

```bash
npm run build        # esbuild → dist/handler.js  (function bundle, CJS, minified)
npm run package      # full build + zip → artifacts/function.zip + artifacts/layer.zip
```

`scripts/package.sh` produces:
- `artifacts/function.zip` — the Lambda handler (~few KB, no node_modules)
- `artifacts/layer.zip` — `nodejs/node_modules/zod` packaged for Lambda layer

Neither zip is committed (`.gitignore`).

---

## Deploy

### First time

```bash
# 1. Build artifacts
npm run package

# 2. Initialise Terraform
cd infra
terraform init

# 3. Preview changes
terraform plan

# 4. Apply
terraform apply
```

Terraform will print the deployed URL and a ready-to-run curl command:

```
Outputs:

invoke_url  = "https://<id>.execute-api.us-east-1.amazonaws.com"
curl_example = "curl -s -X POST https://<id>.execute-api.us-east-1.amazonaws.com/vehicle-info ..."
```

### Re-deploying after code changes

```bash
npm run package && cd infra && terraform apply
```

### Configuration overrides

All defaults are production-ready, but you can override via a `.tfvars` file:

```hcl
# infra/my.tfvars  (not committed)
aws_region           = "eu-west-1"
log_retention_days   = 30
upstream_timeout_ms  = 3000
max_retries          = 1
```

```bash
terraform apply -var-file=my.tfvars
```

---

## Live test

After `terraform apply`, use the `curl_example` output or:

```bash
INVOKE_URL=$(cd infra && terraform output -raw invoke_url)

# Valid plate
curl -s -X POST "${INVOKE_URL}/vehicle-info" \
  -H "Content-Type: application/json" \
  -d '{"license_plate":"12345678"}' | jq .

# Unknown plate → 404
curl -s -X POST "${INVOKE_URL}/vehicle-info" \
  -H "Content-Type: application/json" \
  -d '{"license_plate":"9999999"}' | jq .

# Invalid plate → 400
curl -s -X POST "${INVOKE_URL}/vehicle-info" \
  -H "Content-Type: application/json" \
  -d '{"license_plate":"ABC"}' | jq .
```

---

## Teardown

```bash
cd infra
terraform destroy
```

This removes all AWS resources: Lambda function, layer, IAM role, API Gateway, CloudWatch log group.

---

## How this maps to the assignment

| Assignment requirement | Implementation |
|------------------------|----------------|
| Wrap the upstream vehicle-info endpoint | `src/vehicle-service.ts` |
| Input validation | `src/schema.ts` (zod), enforced in `src/handler.ts` before any network call |
| Normalize response | Stable `{success, data}` / `{success, error}` envelope; upstream quirks hidden |
| Deploy to AWS Lambda via Terraform | `infra/` — APIGW → Lambda → IAM → CloudWatch |
| Lambda Layer for third-party deps | `artifacts/layer.zip` containing `zod` under `nodejs/node_modules/` |
| Structured JSON logging | `console.info/warn/error(JSON.stringify(...))` → CloudWatch |
| Timeout + retry for transient failures | `AbortSignal.timeout()` + retry loop in `vehicle-service.ts` |
| Config via environment variables | `src/config.ts`, injected by Terraform `environment.variables` |
| Unit tests with coverage | `test/` — vitest, mocked fetch, 100% of error paths |
| Live smoke test | `test/live-smoke.test.ts`, skipped unless `RUN_LIVE=1` |
| DECISIONS.md for interview | See [DECISIONS.md](./DECISIONS.md) |
