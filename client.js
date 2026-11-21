/**
 * Browser half of the Qianwen status dashboard.
 *
 * Registers a Settings page that reads the Host's read-only status route and
 * renders authentication, token expiry countdown, subscription and credits.
 * No Harness Client packages are imported: React and styles come from the
 * module loader, and all colors use theme tokens.
 */
window.__ModuleLoader__.load({
  id: 'dsh-qianwen-status-dashboard',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useEffect, useRef, useState } = React
    const NS = 'qianwen-status'
    const STATUS_ROUTE = 'api/qianwen-status'
    const RELOGIN_ROUTE = 'api/qianwen-status/relogin'

    const zh = {
      nav: '千问状态看板',
      title: '千问状态看板',
      subtitle: '本机 qianwen CLI 的认证、Token 与订阅概览（只读）',
      refresh: '刷新',
      refreshing: '刷新中…',
      autoRefresh: '每 60 秒自动刷新',
      authCard: '认证状态',
      notLoggedIn: '未登录',
      loggedIn: '已登录',
      verified: '服务端已验证',
      unverified: '服务端未验证',
      account: '账号',
      authMode: '认证方式',
      expires: 'Token 到期',
      expiresIn: '剩余 {time}',
      expired: '已过期',
      expiringSoon: '即将过期，请在上方横幅完成授权，即可自动续上',
      loginAgain: 'Token 已过期，请在上方横幅点击按钮完成授权',
      edition: '版本',
      enabled: '已开启',
      disabled: '未开启',
      subscriptionCard: '订阅套餐',
      noSubscription: '未查询到个人订阅信息',
      planStatus: '状态',
      planEnd: '到期日',
      remainingDays: '剩余天数',
      autoRenew: '自动续费',
      plan: '套餐',
      status: '状态',
      verify: '校验',
      countdown: '倒计时',
      used: '已用',
      editionIndividual: '个人版',
      editionTeam: '团队版',
      loading: '正在读取 qianwen 状态…',
      refreshError: '刷新失败，显示上次读取的数据：{error}',
      creditsCard: '月度额度',
      creditsTotal: '本月总额度',
      creditsUsed: '已使用 {pct}%',
      creditsReset: '重置时间',
      errorTitle: '读取失败',
      lastUpdated: '更新于 {time}',
      unknown: '未知',
      renewTitle: '需要重新登录千问',
      renewBody: 'Token 已过期或即将过期。已自动准备好授权链接：点开它并在浏览器确认后，登录会自动完成，无需运行命令。',
      renewOpen: '打开授权链接',
      renewCopy: '复制链接',
      renewCopied: '已复制',
      renewRetry: '重新生成链接',
      renewStart: '生成授权链接',
      renewStartBody: 'Token 已过期或即将过期。点下面的按钮生成授权链接（约 5 分钟内有效），在浏览器确认后登录会自动完成，无需运行命令。',
      renewValidFor: '链接 {time} 内有效',
      renewFailed: '自动登录未能完成：{error}',
      renewExpired: '授权链接已过期，或没有在有效期内确认。点「重新生成链接」再试一次。',
      renewArmed: '已发起',
      renewIdle: '未发起',
      renewRow: '自动登录',
    }
    const en = {
      nav: 'Qianwen status',
      title: 'Qianwen status dashboard',
      subtitle: 'Read-only overview of the local qianwen CLI: authentication, token and subscription.',
      refresh: 'Refresh',
      refreshing: 'Refreshing…',
      autoRefresh: 'Auto-refreshes every 60 seconds',
      authCard: 'Authentication',
      notLoggedIn: 'Not logged in',
      loggedIn: 'Logged in',
      verified: 'Server verified',
      unverified: 'Server not verified',
      account: 'Account',
      authMode: 'Method',
      expires: 'Token expiry',
      expiresIn: '{time} left',
      expired: 'Expired',
      expiringSoon: 'Expiring soon — complete authorization in the banner above to renew automatically',
      loginAgain: 'Token expired — use the button in the banner above to authorize',
      edition: 'Edition',
      enabled: 'Enabled',
      disabled: 'Disabled',
      subscriptionCard: 'Subscription',
      noSubscription: 'No active subscription found',
      planStatus: 'Status',
      planEnd: 'Ends',
      remainingDays: 'Days left',
      autoRenew: 'Auto renew',
      plan: 'Plan',
      status: 'Status',
      verify: 'Verification',
      countdown: 'Countdown',
      used: 'Used',
      editionIndividual: 'Individual',
      editionTeam: 'Team',
      loading: 'Reading qianwen status…',
      refreshError: 'Refresh failed, showing last known data: {error}',
      creditsCard: 'Monthly credits',
      creditsTotal: 'Monthly total',
      creditsUsed: '{pct}% used',
      creditsReset: 'Resets',
      errorTitle: 'Could not load',
      lastUpdated: 'Updated at {time}',
      unknown: 'Unknown',
      renewTitle: 'Qianwen sign-in required',
      renewBody: 'The token is expired or about to expire. An authorization link is ready: open it and confirm in the browser, and sign-in completes automatically — no command needed.',
      renewOpen: 'Open authorization link',
      renewCopy: 'Copy link',
      renewCopied: 'Copied',
      renewRetry: 'Generate a new link',
      renewStart: 'Generate authorization link',
      renewStartBody: 'The token is expired or about to expire. Press the button to generate an authorization link (valid about 5 minutes); confirm it in the browser and sign-in completes automatically — no command needed.',
      renewValidFor: 'Link valid for {time}',
      renewFailed: 'Assisted sign-in did not complete: {error}',
      renewExpired: 'The authorization link expired, or was not confirmed in time. Use "Generate a new link" to try again.',
      renewArmed: 'In progress',
      renewIdle: 'Not started',
      renewRow: 'Assisted sign-in',
    }

    /* ---------- helpers ---------- */
    function fmtTime(value, fallback) {
      if (!value) return fallback
      const d = new Date(value)
      return Number.isNaN(d.getTime()) ? fallback : d.toLocaleString()
    }

    function fmtCountdown(expiresAt, t) {
      if (!expiresAt) return t('unknown')
      const ms = new Date(expiresAt).getTime() - Date.now()
      if (Number.isNaN(ms)) return t('unknown')
      if (ms <= 0) return t('expired')
      const mins = Math.floor(ms / 60000)
      const days = Math.floor(mins / 1440)
      const hours = Math.floor((mins % 1440) / 60)
      const rem = mins % 60
      const time = days > 0
        ? `${days}d ${hours}h ${rem}m`
        : `${hours}h ${rem}m`
      return t('expiresIn', { time })
    }

    function isSoon(expiresAt) {
      if (!expiresAt) return false
      const ms = new Date(expiresAt).getTime() - Date.now()
      return !Number.isNaN(ms) && ms > 0 && ms < 6 * 60 * 60 * 1000
    }

    /* ---------- styles ---------- */
    const css = `
.qw-root { color: var(--dsw-alias-label-primary); font-size: 13px; max-width: 720px; }
.qw-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 20px; }
.qw-title { font-size: 18px; font-weight: 600; margin: 0 0 6px; color: var(--dsw-alias-label-primary); }
.qw-subtitle { margin: 0; color: var(--dsw-alias-label-secondary); line-height: 1.5; }
.qw-btn {
  border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary); border-radius: 6px; padding: 6px 12px;
  font-size: 13px; cursor: pointer; white-space: nowrap;
}
.qw-btn:hover { background: var(--dsw-alias-interactive-bg-hover); }
.qw-btn:disabled { opacity: 0.6; cursor: default; }
.qw-note { color: var(--dsw-alias-label-caption); font-size: 12px; margin-top: 8px; }
.qw-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 14px; }
.qw-card {
  border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px;
  background: var(--dsw-alias-bg-layer-1); padding: 16px;
}
.qw-card-title { font-size: 14px; font-weight: 600; margin: 0 0 12px; color: var(--dsw-alias-label-primary); }
.qw-row { display: flex; justify-content: space-between; gap: 12px; padding: 5px 0; }
.qw-row .k { color: var(--dsw-alias-label-secondary); }
.qw-row .v { color: var(--dsw-alias-label-primary); text-align: right; word-break: break-all; }
.qw-badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 12px; }
.qw-badge.ok { background: var(--dsw-alias-state-success-secondary); color: var(--dsw-alias-state-success-primary); }
.qw-badge.bad { background: var(--dsw-alias-state-error-secondary); color: var(--dsw-alias-state-error-primary); }
.qw-badge.warn { background: var(--dsw-alias-state-warn-secondary); color: var(--dsw-alias-state-warn-primary); }
.qw-bar { height: 8px; border-radius: 4px; background: var(--dsw-alias-bg-layer-2); overflow: hidden; margin: 10px 0 6px; }
.qw-bar > span { display: block; height: 100%; background: var(--dsw-alias-brand-primary); border-radius: 4px; }
.qw-error { border: 1px solid var(--dsw-alias-border-l2); border-left: 3px solid var(--dsw-alias-state-error-primary);
  background: var(--dsw-alias-bg-layer-1); border-radius: 6px; padding: 12px; color: var(--dsw-alias-label-primary); }
.qw-empty { color: var(--dsw-alias-label-secondary); }
.qw-renew { border: 1px solid var(--dsw-alias-border-l2); border-left: 3px solid var(--dsw-alias-state-warn-primary);
  background: var(--dsw-alias-bg-layer-1); border-radius: 8px; padding: 14px 16px; margin-bottom: 16px; }
.qw-renew-title { font-size: 14px; font-weight: 600; margin: 0 0 6px; color: var(--dsw-alias-label-primary); }
.qw-renew-body { margin: 0 0 12px; color: var(--dsw-alias-label-secondary); line-height: 1.5; }
.qw-renew-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.qw-link {
  display: inline-block; padding: 6px 12px; border-radius: 6px; font-size: 13px; text-decoration: none;
  background: var(--dsw-alias-button-primary-fill); color: var(--dsw-alias-label-primary-foreground);
}
.qw-link:hover { background: var(--dsw-alias-button-primary-hover); }
.qw-url { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px;
  color: var(--dsw-alias-label-caption); word-break: break-all; margin-top: 10px; line-height: 1.4; }
.qw-renew-error { color: var(--dsw-alias-state-error-primary); margin: 0 0 10px; }
`

    /* ---------- small view components ---------- */
    function Row(props) {
      return h('div', { className: 'qw-row' },
        h('span', { className: 'k' }, props.k),
        h('span', { className: 'v' }, props.children),
      )
    }

    function Card(props) {
      return h('section', { className: 'qw-card' },
        h('h3', { className: 'qw-card-title' }, props.title),
        props.children,
      )
    }

    function AuthCard({ data, t }) {
      const a = data.auth
      const soon = isSoon(a.tokenExpiresAt)
      const expired = a.reason === 'token_expired'
        || (a.tokenExpiresAt !== null && new Date(a.tokenExpiresAt).getTime() <= Date.now())
      const actionHint = expired ? t('loginAgain') : t('expiringSoon')
      return h(Card, { title: t('authCard') },
        h(Row, { k: t('status') },
          h('span', { className: 'qw-badge ' + (a.authenticated ? 'ok' : 'bad') },
            a.authenticated ? t('loggedIn') : t('notLoggedIn'))),
        h(Row, { k: t('verify') },
          h('span', { className: 'qw-badge ' + (a.serverVerified ? 'ok' : 'warn') },
            a.serverVerified ? t('verified') : t('unverified'))),
        a.aliyunId ? h(Row, { k: t('account') }, a.aliyunId) : null,
        a.authMode ? h(Row, { k: t('authMode') }, a.authMode) : null,
        h(Row, { k: t('expires') }, fmtTime(a.tokenExpiresAt, t('unknown'))),
        h(Row, { k: t('countdown') },
          h('span', { className: 'qw-badge ' + ((soon || expired) ? 'warn' : '') },
            fmtCountdown(a.tokenExpiresAt, t))),
        data.renewal
          ? h(Row, { k: t('renewRow') },
            h('span', { className: 'qw-badge ' + (data.renewal.active ? 'ok' : '') },
              data.renewal.active ? t('renewArmed') : t('renewIdle')))
          : null,
        expired || soon
          ? h('div', { className: 'qw-note' }, actionHint)
          : null,
      )
    }

    function SubscriptionCard({ data, t }) {
      const s = data.plan
      const editionLabel = s?.edition === 'team' ? t('editionTeam')
        : s?.edition === 'individual' ? t('editionIndividual') : null
      return h(Card, { title: t('subscriptionCard') },
        s === null
          ? h('div', { className: 'qw-empty' }, t('noSubscription'))
          : h('div', null,
            editionLabel ? h(Row, { k: t('edition') }, editionLabel) : null,
            s.name ? h(Row, { k: t('plan') }, s.name) : null,
            s.status ? h(Row, { k: t('planStatus') },
              h('span', { className: 'qw-badge ' + (s.status === 'active' ? 'ok' : 'warn') }, s.status)) : null,
            s.periodEnd ? h(Row, { k: t('planEnd') }, fmtTime(s.periodEnd, t('unknown'))) : null,
            s.remainingDays !== null ? h(Row, { k: t('remainingDays') }, String(s.remainingDays)) : null,
            h(Row, { k: t('autoRenew') }, s.autoRenew ? t('enabled') : t('disabled')),
          ),
      )
    }

    function CreditsCard({ data, t }) {
      const c = data.credits
      return h(Card, { title: t('creditsCard') },
        c === null
          ? h('div', { className: 'qw-empty' }, t('noSubscription'))
          : h('div', null,
            c.total !== null ? h(Row, { k: t('creditsTotal') }, String(c.total)) : null,
            c.usedPct !== null ? h(Row, { k: t('used') }, t('creditsUsed', { pct: c.usedPct.toFixed(1) })) : null,
            c.usedPct !== null
              ? h('div', { className: 'qw-bar' },
                h('span', { style: { width: Math.min(100, Math.max(0, c.usedPct)) + '%' } }))
              : null,
            c.resetTime ? h(Row, { k: t('creditsReset') }, fmtTime(c.resetTime, t('unknown'))) : null,
          ),
      )
    }

    /** Milliseconds until a timestamp, rendered as "3m 20s". */
    function fmtRemaining(untilMs) {
      const ms = untilMs - Date.now()
      if (!Number.isFinite(ms) || ms <= 0) return null
      const total = Math.floor(ms / 1000)
      const mins = Math.floor(total / 60)
      const secs = total % 60
      return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`
    }

    /**
     * The assisted sign-in banner: an armed device code to confirm in the
     * browser, or the reason the last attempt did not complete.
     */
    function RenewalBanner({ renewal, t, onRelogin, busy }) {
      const [copied, setCopied] = useState(false)
      if (!renewal || typeof renewal !== 'object') return null
      const waiting = renewal.phase === 'waiting' && renewal.active === true
      const failed = renewal.phase === 'failed'
      const needed = renewal.phase === 'needed'
      if (!waiting && !failed && !needed) return null

      const remaining = waiting ? fmtRemaining(renewal.expiresAt) : null

      const copy = async () => {
        try {
          await navigator.clipboard.writeText(renewal.url)
          setCopied(true)
          setTimeout(() => setCopied(false), 2000)
        } catch { /* clipboard may be unavailable; the URL stays selectable */ }
      }

      return h('div', { className: 'qw-renew' },
        h('h3', { className: 'qw-renew-title' }, t('renewTitle')),
        h('p', { className: 'qw-renew-body' }, needed ? t('renewStartBody') : t('renewBody')),
        failed
          ? h('p', { className: 'qw-renew-error' },
            renewal.error === 'device_code_expired'
              ? t('renewExpired')
              : t('renewFailed', { error: renewal.error || t('unknown') }))
          : null,
        h('div', { className: 'qw-renew-actions' },
          waiting
            ? h('a', { className: 'qw-link', href: renewal.url, target: '_blank', rel: 'noreferrer noopener' },
              t('renewOpen'))
            : null,
          waiting
            ? h('button', { className: 'qw-btn', onClick: copy }, copied ? t('renewCopied') : t('renewCopy'))
            : null,
          // While a code is armed the CLI reuses it, so "regenerate" could not
          // produce a new link; offer the button only when none is armed.
          (failed || needed)
            ? h('button', { className: 'qw-btn', onClick: onRelogin, disabled: busy },
              busy ? t('refreshing') : (needed ? t('renewStart') : t('renewRetry')))
            : null,
          remaining ? h('span', { className: 'qw-note' }, t('renewValidFor', { time: remaining })) : null,
        ),
        waiting ? h('div', { className: 'qw-url' }, renewal.url) : null,
      )
    }

    function Dashboard({ t }) {
      const [data, setData] = useState(null)
      const [error, setError] = useState(null)
      const [busy, setBusy] = useState(false)
      const alive = useRef(true)

      const load = async () => {
        if (!alive.current) return
        setBusy(true)
        try {
          const res = await fetch(STATUS_ROUTE, { cache: 'no-store' })
          const body = await res.json()
          if (!alive.current) return
          if (!res.ok || body?.error) {
            setError(body?.error || `HTTP ${res.status}`)
            // Preserve the last successful snapshot during transient failures.
          } else {
            setError(null)
            setData(body)
          }
        } catch (err) {
          if (alive.current) setError(String(err?.message || err))
        } finally {
          if (alive.current) setBusy(false)
        }
      }

      useEffect(() => {
        alive.current = true
        load()
        const timer = setInterval(load, 60_000)
        return () => { alive.current = false; clearInterval(timer) }
      }, [])

      /** Arm a fresh authorization link on demand. */
      const relogin = async () => {
        if (!alive.current) return
        setBusy(true)
        try {
          const res = await fetch(RELOGIN_ROUTE, { method: 'POST', cache: 'no-store' })
          const body = await res.json()
          if (!alive.current) return
          if (res.ok && body?.renewal) {
            setData(prev => (prev ? { ...prev, renewal: body.renewal } : prev))
          } else {
            setError(body?.error || `HTTP ${res.status}`)
          }
        } catch (err) {
          if (alive.current) setError(String(err?.message || err))
        } finally {
          if (alive.current) setBusy(false)
        }
      }

      // Keep the countdown fresh between the 60-second data refreshes.
      const [, tick] = useState(0)
      useEffect(() => {
        const timer = setInterval(() => tick(n => n + 1), 30_000)
        return () => clearInterval(timer)
      }, [])

      return h('div', { className: 'qw-root' },
        h('style', null, css),
        h('div', { className: 'qw-head' },
          h('div', null,
            h('h2', { className: 'qw-title' }, t('title')),
            h('p', { className: 'qw-subtitle' }, t('subtitle')),
          ),
          h('button', { className: 'qw-btn', onClick: load, disabled: busy },
            busy ? t('refreshing') : t('refresh')),
        ),
        error
          ? h('div', { className: 'qw-error' },
            h('strong', null, (data ? t('refreshError', { error }) : t('errorTitle') + ': ')),
            data ? null : error)
          : null,
        !data && !error
          ? h('div', { className: 'qw-empty' }, t('loading'))
          : null,
        data
          ? h(RenewalBanner, { renewal: data.renewal, t, onRelogin: relogin, busy })
          : null,
        data
          ? h('div', null,
            h('div', { className: 'qw-grid' },
              h(AuthCard, { data, t }),
              h(SubscriptionCard, { data, t }),
              h(CreditsCard, { data, t }),
            ),
            data.fetchedAt
              ? h('div', { className: 'qw-note' },
                t('lastUpdated', { time: new Date(data.fetchedAt).toLocaleTimeString() }))
              : null,
            h('div', { className: 'qw-note' }, t('autoRefresh')),
          )
          : null,
      )
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        // Untyped single-locale registration; both baseline locales are provided.
        ctx.effect(() => ctx.locale.register(NS, 'zh', zh))
        ctx.effect(() => ctx.locale.register(NS, 'en', en))
        const t = ctx.locale.bind(NS)
        const inject = () => ({ t })
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'qianwen-status',
          order: 100,
          label: () => t('nav'),
          locale: NS,
          inject,
        }, Dashboard))
      },
    }
  },
})
