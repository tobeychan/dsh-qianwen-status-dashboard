/**
 * Host half of the Qianwen status dashboard.
 *
 * Serves an authenticated HTTP route that runs the local `qianwen` CLI's
 * `auth status` and `subscription status` commands, and an assisted re-login
 * flow: a timer detects an expired (or nearly expired) token, arms a device
 * authorization code, and polls `auth login --complete` in the background.
 * The user only opens the authorization URL and confirms in the browser.
 *
 * Nothing here changes credentials on its own beyond the login the user
 * confirms; configuration and subscription state are never modified.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const STATUS_PATH = '/api/qianwen-status'
const RELOGIN_PATH = '/api/qianwen-status/relogin'
const RUN_TIMEOUT_MS = 10_000
const MAX_OUTPUT_BYTES = 256 * 1024
/** How often the Host re-checks the token without an open dashboard. */
const CHECK_INTERVAL_MS = 5 * 60 * 1000
/** Start the assisted login once the token is this close to expiry. */
const ARM_WINDOW_MS = 2 * 60 * 60 * 1000
/** Wait before arming another device code after a failed attempt. */
const RETRY_COOLDOWN_MS = 60 * 1000
/** Device codes are short-lived; mirror the CLI's own default window. */
const COMPLETE_TIMEOUT_S = 300

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

/**
 * Run a qianwen command with explicit `--format json` and no shell.
 * Returns the parsed JSON object, or throws a descriptive Error.
 */
async function runQianwen(args, timeoutMs = RUN_TIMEOUT_MS) {
  let result
  try {
    result = await execFileAsync('qianwen', [...args, '--format', 'json'], {
      timeout: timeoutMs,
      maxBuffer: MAX_OUTPUT_BYTES,
      windowsHide: true,
      env: { ...process.env },
    })
  } catch (error) {
    const stderr = typeof error?.stderr === 'string' ? error.stderr.trim() : ''
    const stdout = typeof error?.stdout === 'string' ? error.stdout.trim() : ''
    const timedOut = error?.killed === true || error?.code === 'ETIMEDOUT'
    const detail = stderr || stdout || error?.message || 'unknown error'
    throw new Error(`qianwen ${args.join(' ')} failed${timedOut ? ' (timeout)' : ''}: ${detail}`.slice(0, 600))
  }
  const text = (result.stdout || '').trim()
  const start = text.indexOf('{')
  if (start < 0) throw new Error(`qianwen ${args.join(' ')} returned no JSON`)
  try {
    return JSON.parse(text.slice(start))
  } catch {
    throw new Error(`qianwen ${args.join(' ')} returned invalid JSON`)
  }
}

/** Normalize one edition's plan block into a comparable shape. */
function normalizePlan(edition) {
  if (edition === null || edition === undefined) return null
  return {
    edition: edition.edition ?? null,
    status: edition.status ?? null,
    name: edition.name ?? null,
    type: edition.type ?? null,
    autoRenew: edition.autoRenew?.enabled === true,
    periodStart: edition.period?.start ?? null,
    periodEnd: edition.period?.end ?? null,
    remainingDays: edition.remainingDays ?? null,
    monthlyCredits: edition.monthlyCredits ?? null,
  }
}

/** Pick the edition whose plan is actually in force. */
function selectPlan(sub) {
  const individual = normalizePlan(sub?.individual)
  const team = normalizePlan(sub?.team)
  const active = [individual, team].find(plan => plan?.status === 'active')
    ?? [individual, team].find(plan => plan && plan.status && plan.status !== 'not_subscribed')
    ?? individual
    ?? team
  return { individual, team, active }
}

/** Convert CLI payloads plus renewal state into the dashboard snapshot. */
function buildSnapshot(auth, sub, renewal) {
  const authenticated = auth?.authenticated === true
  const tokenExpiresAt = auth?.token?.expires_at ?? null
  const { individual, team, active } = selectPlan(sub)
  const creditsSource = active?.monthlyCredits ?? individual?.monthlyCredits ?? null
  const credits = creditsSource === null ? null : {
    total: creditsSource.total ?? null,
    usedPct: typeof creditsSource.usedPct === 'number' ? creditsSource.usedPct : null,
    resetTime: creditsSource.resetTime ?? null,
  }

  return {
    auth: {
      authenticated,
      serverVerified: auth?.server_verified === true,
      authMode: auth?.auth_mode ?? null,
      reason: auth?.reason ?? null,
      aliyunId: auth?.user?.aliyunId ?? null,
      tokenExpiresAt,
      scopes: Array.isArray(auth?.token?.scopes) ? auth.token.scopes : [],
    },
    plan: active === null || active === undefined ? null : {
      edition: active.edition,
      status: active.status,
      name: active.name,
      type: active.type,
      autoRenew: active.autoRenew,
      periodStart: active.periodStart,
      periodEnd: active.periodEnd,
      remainingDays: active.remainingDays,
    },
    editions: { individual, team },
    credits,
    renewal,
    errors: [
      ...(Array.isArray(sub?.error) ? sub.error : (sub?.error ? [sub.error] : [])),
      ...(Array.isArray(sub?.diagnostics) ? sub.diagnostics : []),
    ],
    fetchedAt: new Date().toISOString(),
  }
}

/**
 * Assisted login state machine.
 *
 * `idle` → nothing to do; `waiting` → a device code is armed and `--complete`
 * polls until the user authorizes or the code expires; `failed` → report the
 * reason and retry after a cooldown.
 */
class Renewal {
  constructor(logger) {
    this.logger = logger
    this.phase = 'idle'
    this.url = null
    this.armedAt = null
    this.expiresAt = null
    this.error = null
    this.lastFailureAt = 0
    this.polling = null
    this.changed = null
  }

  /** Public, serializable view of the current state. */
  view() {
    return {
      phase: this.phase,
      url: this.url,
      armedAt: this.armedAt,
      expiresAt: this.expiresAt,
      error: this.error,
      active: this.phase === 'waiting' && this.expiresAt !== null && this.expiresAt > Date.now(),
    }
  }

  /**
   * Flag that sign-in is required without spending a device code.
   * The dashboard shows a button; the code is armed only when it is pressed.
   */
  markNeeded() {
    if (this.phase === 'waiting' || this.polling !== null) return
    this.phase = 'needed'
    this.url = null
    this.armedAt = null
    this.expiresAt = null
    this.error = null
  }

  /** Forget an armed code whose window has closed. */
  expireStale() {
    if (this.phase === 'waiting' && this.expiresAt !== null && this.expiresAt <= Date.now()) {
      this.phase = 'idle'
      this.url = null
      this.armedAt = null
      this.expiresAt = null
    }
  }

  /**
   * Arm a device code and poll for its completion.
   * @returns the resulting view.
   */
  async arm(force = false) {
    this.expireStale()
    if (this.phase === 'waiting') return this.view()
    if (!force && Date.now() - this.lastFailureAt < RETRY_COOLDOWN_MS) return this.view()
    if (this.polling !== null) return this.view()

    let device
    try {
      device = await runQianwen(['auth', 'login', '--init-only'])
    } catch (error) {
      this.fail(error)
      return this.view()
    }

    const event = device?.events?.find(entry => entry?.event === 'device_code')
    const url = event?.verification_url
    if (typeof url !== 'string' || url === '') {
      this.fail(new Error('qianwen auth login returned no authorization URL'))
      return this.view()
    }

    const ttlSeconds = Number.isFinite(event?.expires_in_seconds) ? event.expires_in_seconds : COMPLETE_TIMEOUT_S
    this.phase = 'waiting'
    this.url = url
    this.armedAt = Date.now()
    this.expiresAt = Date.now() + ttlSeconds * 1000
    this.error = null

    // Poll in the background; authorization happens in the user's browser.
    this.polling = runQianwen(['auth', 'login', '--complete', '--timeout', String(COMPLETE_TIMEOUT_S)], (COMPLETE_TIMEOUT_S + 30) * 1000)
      .then(result => {
        const outcome = result?.events?.find(entry => entry?.event === 'success' || entry?.event === 'expired' || entry?.event === 'error')
        if (outcome?.event === 'success') {
          this.phase = 'idle'
          this.url = null
          this.armedAt = null
          this.expiresAt = null
          this.error = null
          this.lastFailureAt = 0
          this.logger?.info?.('qianwen-status-dashboard: assisted login succeeded')
        } else if (outcome?.event === 'expired') {
          // The CLI reports an unconfirmed code as "expired" once its poll
          // budget runs out; surface a stable code the Client can localize.
          this.fail(new Error('device_code_expired'))
        } else {
          this.fail(new Error(outcome?.message || 'authorization was not confirmed'))
        }
      })
      .catch(error => { this.fail(error) })
      .finally(() => { this.polling = null })
    return this.view()
  }

  fail(error) {
    this.phase = 'failed'
    this.url = null
    this.armedAt = null
    this.expiresAt = null
    this.error = error instanceof Error ? error.message : String(error)
    this.lastFailureAt = Date.now()
  }

  /** Reset after a successful authentication. */
  reset() {
    this.phase = 'idle'
    this.url = null
    this.armedAt = null
    this.expiresAt = null
    this.error = null
    this.lastFailureAt = 0
  }
}

/** Whether this auth payload means the token is gone. */
function tokenMissing(auth) {
  if (auth?.authenticated !== true) return true
  const expires = auth?.token?.expires_at
  if (typeof expires !== 'string') return false
  const at = new Date(expires).getTime()
  return !Number.isNaN(at) && at <= Date.now()
}

/** Whether the token is close enough to expiry to arm a login in advance. */
function tokenExpiringSoon(auth) {
  const expires = auth?.token?.expires_at
  if (typeof expires !== 'string') return false
  const at = new Date(expires).getTime()
  return !Number.isNaN(at) && at > Date.now() && at - Date.now() <= ARM_WINDOW_MS
}

/** Register the status and assisted-login routes, plus the background check. */
export function apply(ctx) {
  const renewal = new Renewal(ctx.logger)

  /**
   * Re-check the token on a timer.
   *
   * Detection is periodic, but arming is deliberately left to the dashboard
   * (GET) and the explicit re-login button (POST): a device code only lives
   * ~300s, so arming while nobody is watching burns codes and can leave a
   * nearly-dead link on screen when the user finally opens the page.
   */
  const check = async () => {
    let auth
    try {
      auth = await runQianwen(['auth', 'status'])
    } catch (error) {
      ctx.logger?.warn?.(`qianwen-status-dashboard: auth check failed: ${error instanceof Error ? error.message : String(error)}`)
      return
    }
    renewal.expireStale()
    if (!tokenMissing(auth) && !tokenExpiringSoon(auth)) {
      if (renewal.phase !== 'waiting') renewal.reset()
      return
    }
    ctx.logger?.info?.('qianwen-status-dashboard: token expired or expiring soon; open the dashboard to authorize')
  }

  ctx.effect(() => {
    const timer = setInterval(() => { check().catch(() => {}) }, CHECK_INTERVAL_MS)
    timer.unref?.()
    check().catch(() => {})
    return () => clearInterval(timer)
  }, 'qianwen-status-dashboard: token check timer')

  ctx.inject(['connection'], (scope) => {
    scope.effect(() => scope.connection.fetch.register({
      path: STATUS_PATH,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async () => {
        let auth
        try {
          // `auth status` exits 0 even when the token is expired.
          auth = await runQianwen(['auth', 'status'])
        } catch (error) {
          return json({ error: error instanceof Error ? error.message : String(error) }, 502)
        }

        renewal.expireStale()
        const missing = tokenMissing(auth)
        // Show a "sign in" button rather than spending a device code on every
        // 60-second refresh; the code is armed when the user presses it.
        if (missing) renewal.markNeeded()

        // Subscription reads need a live token; report the sign-in state instead
        // of failing the whole dashboard while one is expired.
        let sub = null
        if (!missing) {
          try {
            sub = await runQianwen(['subscription', 'status'])
          } catch (error) {
            sub = { error: error instanceof Error ? error.message : String(error) }
          }
        }
        return json(buildSnapshot(auth, sub, renewal.view()))
      },
    }), 'qianwen-status-dashboard: status route')

    scope.effect(() => scope.connection.fetch.register({
      path: RELOGIN_PATH,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async () => json({ renewal: await renewal.arm(true) }),
    }), 'qianwen-status-dashboard: relogin route')
  })
}