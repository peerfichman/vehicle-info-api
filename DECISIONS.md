# Design Decisions

Interview cheat-sheet — every non-obvious choice with its trade-off.

---

## Module format: CommonJS (`--format=cjs`)

**Chose**: CJS (`handler.js`, no `"type":"module"` in package.json)  
**Why**: Lambda's Node 22 runtime supports both CJS and ESM, but CJS requires no file-extension ceremony (`.mjs` vs `.js`) and has no `__filename`/`__dirname` shim issues. ESM offers no real advantage for a single-function handler.  
**Trade-off**: CJS is older; if this were a shared library ESM tree-shaking would matter. For a Lambda handler it's irrelevant.

---

## Bundler: esbuild, single output file

**Chose**: `esbuild` bundling `src/handler.ts` → `dist/handler.js`  
**Why**: Fast, zero-config for TS→JS, explicit `external` for AWS SDK, produces a tiny minified file. Alternatives (tsc, webpack, rollup) are slower or more complex for this use case.  
**Trade-off**: esbuild doesn't type-check; we run `tsc --noEmit` separately. Acceptable because the build step and type-check step are distinct concerns.

---

## Lambda Layer for zod vs. bundling it

**Chose**: `zod` in a Lambda Layer (`artifacts/layer.zip → nodejs/node_modules/zod`)  
**Why**: Keeps the function zip tiny (handler is <20KB). The layer is shared across Lambda versions, so re-deploying code doesn't re-upload the same zod bytes. This is the pattern Terraform + Lambda tooling is designed for.  
**Trade-off**: Slightly more complex packaging (`scripts/package.sh` builds two zips). Worth it for zip size discipline and cleaner separation of "my code" vs "dependencies".

---

## AWS SDK marked external in esbuild

**Chose**: `external: ['@aws-sdk/*']` in esbuild config  
**Why**: The Lambda runtime already provides `@aws-sdk` v3. Bundling it would add ~3MB to the function zip for no benefit and would shadow the runtime version.  
**Trade-off**: If the runtime ever removes or downgrades the SDK version, we'd need to ship it ourselves — but that's a hypothetical; AWS guarantees SDK v3 for Node runtimes.

---

## HTTP client: `globalThis.fetch` (no library)

**Chose**: built-in `fetch` (undici, available in Node 18+)  
**Why**: Zero dependencies for a single upstream call. `AbortSignal.timeout()` handles the timeout cleanly. Adding axios/got would bloat the layer for no gain.  
**Trade-off**: Built-in fetch has fewer convenience features (no automatic retry, no response interceptors). We implement our own retry loop — which is intentional so the retry policy is visible and testable.

---

## Validation: zod as single source of truth

**Chose**: `zod` schemas in `src/schema.ts`; all TypeScript types inferred with `z.infer<>`  
**Why**: One place to change the schema; type inference prevents the "schema says X, interface says Y" drift bug. Zod's `.safeParse()` gives a typed result without throwing.  
**Trade-off**: Adds a dependency. Acceptable — zod is the de-facto TS validation library.

---

## API Gateway HTTP API (v2) vs. Lambda Function URL

**Chose**: API Gateway HTTP API with payload format v2  
**Why**: HTTP API v2 supports throttling, WAF attachment, custom domains, and multiple routes — none of which are needed now but add no cost at this scale. Function URLs are simpler but are a dead end if the service grows.  
**Trade-off**: API Gateway adds ~1ms latency and a small cost per million requests. For this use case that's negligible. The assignment also specifically asks for API Gateway.

---

## Error code 502 (Bad Gateway) for upstream failures

**Chose**: HTTP 502 for upstream timeouts, 5xx responses, and network errors  
**Why**: 502 = "The server, while acting as a gateway, received an invalid response from the upstream server." That's precisely our situation — we are a gateway and upstream is the problem.  
**Trade-off**: 503 ("Service Unavailable") would also be defensible and some argue it's more client-friendly (implies retry). 502 is more precise about the fault location.

---

## Retry policy: exponential backoff with full jitter, transient-only

**Chose**: Retry on 5xx and `TimeoutError`; no retry on 4xx (404, 422); 2 retries by default; base delay 200ms with full jitter, cap 5s.  
**Why**: Retrying deterministic failures wastes time and Lambda billing. Full jitter (random delay in [0, exponential]) avoids thundering-herd when many Lambdas retry simultaneously.  
**Trade-off**: Two retries × up to 5s timeout = up to 15s worst case, still under our Lambda timeout of 10s per attempt. The Lambda function timeout of 10s is per-invocation, not per-attempt, so worst case with retries is covered.

---

## Config: environment variables only (no SSM by default)

**Chose**: All config from env vars injected by Terraform; SSM not used by default  
**Why**: Simplest, most auditable approach. Every config value is visible in the Terraform plan. SSM adds IAM complexity and an extra network call on cold start.  
**Trade-off**: Sensitive values (e.g., an API key if the upstream required auth) should use SSM + KMS. The current upstream requires no auth, so env vars are appropriate. Adding SSM is documented as an extension in the README.

---

## Structured JSON logging

**Chose**: `console.info/warn/error(JSON.stringify({level, ...data}))` → CloudWatch  
**Why**: Lambda captures stdout to CloudWatch Logs. JSON logs are queryable with CloudWatch Logs Insights (`filter level="error"`). No logging library dependency needed.  
**Trade-off**: No log sampling or redaction middleware. The license plate is logged at info level — it's low-sensitivity (not a secret, just a reference number), but raw request/response bodies are never logged.

---

## Fail-fast config validation at cold start

**Chose**: `src/config.ts` loads and validates all env vars when the module is first imported (i.e., at cold start)  
**Why**: Better to crash immediately with a clear error message than to fail silently on the first request. Lambda's CloudWatch logs will show exactly which variable is missing.  
**Trade-off**: Tests that import `handler.ts` need to set env vars before import or mock `config.ts`. We handle this in tests with `vi.mock('../src/config.js', ...)`.

---

## TypeScript strict mode

**Chose**: `"strict": true` in tsconfig  
**Why**: Catches the most common classes of runtime errors at compile time. Every exported function has explicit types. No `any` unless unavoidable.  
**Trade-off**: More verbose in places (explicit `unknown` casts from `JSON.parse`, etc.). Worth it for a take-home that's evaluated for code quality.
