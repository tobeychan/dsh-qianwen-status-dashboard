# dsh-qianwen-status-dashboard

千问状态看板 — a [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin that shows the local `qianwen` CLI's state on a Settings page.

## What it shows

- **登录状态 / Authentication** — signed-in state, account id, server verification.
- **Token 倒计时 / Token countdown** — expiry time and live countdown; warns when expiring soon or expired.
- **订阅套餐 / Subscription** — the active plan (individual or team), status, remaining days, auto-renew.
- **月度额度 / Monthly credits** — total credits, used percentage with a progress bar, reset time.

## Usage

1. Install the plugin (see below).
2. Open **Settings** (设置).
3. Choose **千问状态看板** / **Qianwen status dashboard** in the left navigation.

The page reads once on open, then refreshes every 60 seconds; a **刷新 / Refresh** button updates it immediately. If a refresh fails, the last successful snapshot stays visible with an error notice.

## Requirements

The `qianwen` CLI must be installed and on the `PATH` of the machine running DeepSeek Harness (for example `/usr/local/bin/qianwen`).

## Commands it runs, and privacy

On a normal refresh the plugin runs two read-only commands:

```
qianwen auth status --format json
qianwen subscription status --format json
```

Only when you press the sign-in button does it additionally run the CLI's own device-code flow:

```
qianwen auth login --init-only --format json
qianwen auth login --complete --timeout 300 --format json
```

It never logs out, never changes your plan, and never writes credentials itself — the CLI owns the credential store and writes it on a successful sign-in. Data is served to the browser over the Harness's own authenticated route (`/api/qianwen-status` and `/api/qianwen-status/relogin`) and is never sent to a third party. No API key is required or stored.

When you connect to a remote Host, the dashboard reports the CLI state of the **Host** machine, not the browser's.

## Assisted re-login (定时检测 + 一键授权)

The CLI token expires periodically (observed: about 48 hours) and the CLI has no silent refresh. This plugin automates everything around that one manual step:

- A Host timer checks `qianwen auth status` every 5 minutes, even when the dashboard is closed.
- When the token is expired — or within 2 hours of expiry — the dashboard shows a sign-in banner with a **Generate authorization link** button.
- Pressing it runs `qianwen auth login --init-only`, shows the link with a copy button and its remaining validity, and polls `qianwen auth login --complete` in the background.
- You open the link and confirm in the browser. The background poll detects the confirmation and finishes the login; the dashboard returns to the signed-in state on its next refresh.

The link is generated on demand rather than by the timer: a device code only lives about 5 minutes, so arming one while nobody is watching would waste it and could leave a nearly-dead link on screen.

**The browser confirmation cannot be automated.** It signs in to your Qianwen account, so it requires you. No credential, password, or API key is stored by this plugin.

If a link expires before you confirm, use **重新生成链接 / Generate a new link**, or wait for the next automatic check.

## Limitations

- Sign-in still needs one click from you in the browser; the plugin cannot confirm authorization on your behalf.
- Device codes are short-lived (a few minutes). The banner shows the remaining time.
- The dashboard reports what the CLI returns; it does not extend the token's lifetime.

## Install

Install from the npm package name in **Plugins → Add plugin**, or from a local directory:

```
dsh-qianwen-status-dashboard
```

## License

MIT
