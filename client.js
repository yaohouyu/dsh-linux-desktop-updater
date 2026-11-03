/**
 * DeepSeek Harness Linux desktop updater (Client half).
 *
 * Registers one Settings page ("版本更新" / "App Updates") that reads the
 * Host half through `/api/dsh-linux-desktop-updater/*` and offers one-click check,
 * download and install of the newest Linux desktop package published by
 * https://github.com/wenyinos/dsh-desktop-linux.
 */

(function () {
  const NS = 'dsh-linux-desktop-updater'
  const API = '/api/dsh-linux-desktop-updater'

  const DICT = {
    en: {
      title: 'App Updates',
      desc: 'Checks the Linux desktop package published by wenyinos/dsh-desktop-linux and installs a newer DeepSeek Harness version in one click.',
      'status.update': 'New version {version}',
      'status.latest': 'Up to date',
      'status.unchecked': 'Not checked yet',
      'status.checking': 'Checking…',
      'label.running': 'Running version',
      'label.installed': 'Installed package',
      'label.latest': 'Latest release',
      'label.package': 'Package name',
      'label.location': 'Install location',
      'label.arch': 'Architecture',
      'label.published': 'Published',
      'label.asset': 'Download asset',
      'label.method': 'Install method',
      'action.check': 'Check for updates',
      'action.update': 'Download & install',
      'action.cancel': 'Cancel',
      'action.openPage': 'Open releases page',
      'action.diagnostics': 'Refresh diagnostics',
      'action.testElevation': 'Test authorization',
      'action.copy': 'Copy command',
      'action.copied': 'Copied',
      'action.installed': 'Installed — restart to apply',
      'section.notes': 'Release notes for {version}',
      'section.log': 'Update log',
      'section.manual': 'Manual install command',
      'section.diag': 'Environment diagnostics',
      'section.package': 'Package',
      'hint.auth': 'Installing replaces the system package under /opt; the system authorization dialog (polkit) will ask for an administrator password. The new version takes effect after the app restarts.',
      'hint.restart': 'The package was updated. Fully quit and reopen DeepSeek Harness to use the new version.',
      'progress.downloading': 'Downloading… {received}',
      'progress.percent': '{percent}% · {received} / {total}',
      'diag.basic': 'Host environment',
      'diag.pkexec': 'pkexec',
      'diag.cache': 'Download cache',
      'diag.free': 'Free disk space',
      'diag.writable': 'Cache writable',
      'diag.dbus': 'Desktop bus',
      'diag.display': 'Display',
      'diag.testHint': 'Runs pkexec /usr/bin/true and shows a system authorization dialog to verify that elevation works in this desktop session.',
      'diag.testOk': 'Authorization works.',
      'diag.testFail': 'Authorization failed: {message}',
      'diag.none': 'not found',
      'diag.yes': 'yes',
      'diag.no': 'no',
      'notice.checked': 'Update check finished.',
      'notice.updateStarted': 'Update started. Follow the progress below.',
      'notice.cancelled': 'Cancellation requested.',
      'notice.copied': 'Command copied to the clipboard.',
      'notice.copyFailed': 'Copy failed; select the command manually.',
      'error.prefix': 'Error: {message}',
      'unknown': 'Unknown',
      'source.dpkg': 'dpkg',
      'source.rpm': 'rpm',
      'source.asar': 'bundled app',
    },
    zh: {
      title: '版本更新',
      desc: '检查 wenyinos/dsh-desktop-linux 发布的最新 Linux 安装包，一键下载并安装新版 DeepSeek Harness。',
      'status.update': '发现新版本 {version}',
      'status.latest': '已是最新版本',
      'status.unchecked': '尚未检查',
      'status.checking': '检查中…',
      'label.running': '运行中版本',
      'label.installed': '已安装包',
      'label.latest': '最新版本',
      'label.package': '软件包名',
      'label.location': '安装位置',
      'label.arch': '系统架构',
      'label.published': '发布时间',
      'label.asset': '下载文件',
      'label.method': '安装方式',
      'action.check': '检查更新',
      'action.update': '下载并安装',
      'action.cancel': '取消',
      'action.openPage': '打开发布页',
      'action.diagnostics': '重新检测环境',
      'action.testElevation': '测试授权',
      'action.copy': '复制命令',
      'action.copied': '已复制',
      'action.installed': '已安装，重启生效',
      'section.notes': '{version} 更新日志',
      'section.log': '更新日志输出',
      'section.manual': '手动安装命令',
      'section.diag': '环境自检',
      'section.package': '软件包',
      'hint.auth': '安装会替换 /opt 下的系统软件包，系统会弹出授权窗口要求输入管理员密码；新版本在应用重启后生效。',
      'hint.restart': '安装包已更新。请完全退出并重新打开 DeepSeek Harness 以使用新版本。',
      'progress.downloading': '正在下载… {received}',
      'progress.percent': '{percent}% · {received} / {total}',
      'diag.basic': '宿主环境',
      'diag.pkexec': 'pkexec',
      'diag.cache': '下载缓存',
      'diag.free': '磁盘可用空间',
      'diag.writable': '缓存可写',
      'diag.dbus': '桌面总线',
      'diag.display': '显示服务',
      'diag.testHint': '执行 pkexec /usr/bin/true 并弹出一次系统授权窗口，用于确认当前桌面会话可以提权。',
      'diag.testOk': '提权可用。',
      'diag.testFail': '提权失败：{message}',
      'diag.none': '未找到',
      'diag.yes': '是',
      'diag.no': '否',
      'notice.checked': '检查完成。',
      'notice.updateStarted': '已开始更新，请关注下方进度。',
      'notice.cancelled': '已请求取消。',
      'notice.copied': '命令已复制到剪贴板。',
      'notice.copyFailed': '复制失败，请手动选择命令复制。',
      'error.prefix': '错误：{message}',
      'unknown': '未知',
      'source.dpkg': 'dpkg',
      'source.rpm': 'rpm',
      'source.asar': '应用内置',
    },
  }

  const STYLE = `
.dau{display:flex;flex-direction:column;gap:14px;padding:2px 0 36px;min-width:0;color:var(--dsw-alias-label-primary);font-family:inherit}
.dau-head{display:flex;flex-direction:column;gap:10px}
.dau-title-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;min-width:0}
.dau-title{margin:0;font-size:24px;line-height:32px;font-weight:600;letter-spacing:-.4px}
.dau-desc{margin:0;color:var(--dsw-alias-label-tertiary);font-size:14px;line-height:22px}
.dau-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-left:auto}
.dau-card{border:0.5px solid var(--dsw-alias-border-l2);border-radius:16px;background:var(--dsw-alias-bg-layer-1);overflow:hidden}
.dau-row{display:flex;gap:16px;padding:10px 14px;border-top:0.5px solid var(--dsw-alias-border-l1);font-size:13px;line-height:20px}
.dau-row:first-child{border-top:0}
.dau-row-label{flex:none;width:120px;color:var(--dsw-alias-label-tertiary)}
.dau-row-value{flex:1;min-width:0;overflow-wrap:anywhere;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dau-mono{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px}
.dau-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:32px;padding:0 12px;border-radius:8px;border:0.5px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px;cursor:pointer;white-space:nowrap}
.dau-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2)}
.dau-btn:focus-visible{outline:1px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.dau-btn:disabled{opacity:.45;cursor:default}
.dau-btn-primary{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:#fff}
.dau-btn-primary:hover:not(:disabled){background:var(--dsw-alias-brand-primary);filter:brightness(1.07)}
.dau-btn-danger{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}
.dau-btn-sm{height:26px;padding:0 9px;font-size:12px;border-radius:7px}
.dau-badge{display:inline-flex;align-items:center;height:22px;padding:0 8px;border-radius:999px;border:0.5px solid transparent;font-size:12px;line-height:18px;white-space:nowrap}
.dau-badge-ok{color:var(--dsw-alias-state-success-primary);border-color:var(--dsw-alias-state-success-primary)}
.dau-badge-warn{color:var(--dsw-alias-state-warn-primary);border-color:var(--dsw-alias-state-warn-primary)}
.dau-badge-idle{color:var(--dsw-alias-label-tertiary);border-color:var(--dsw-alias-border-l2)}
.dau-banner{display:flex;gap:8px;padding:9px 12px;border-radius:12px;border:0.5px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;overflow-wrap:anywhere}
.dau-banner-error{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}
.dau-banner-success{color:var(--dsw-alias-state-success-primary);border-color:var(--dsw-alias-state-success-primary)}
.dau-banner-warn{color:var(--dsw-alias-state-warn-primary);border-color:var(--dsw-alias-state-warn-primary)}
.dau-progress{display:flex;flex-direction:column;gap:6px}
.dau-track{height:6px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);overflow:hidden}
.dau-bar{height:100%;border-radius:999px;background:var(--dsw-alias-brand-primary);transition:width .2s}
.dau-progress-label{font-size:12px;color:var(--dsw-alias-label-tertiary)}
.dau-details{border:0.5px solid var(--dsw-alias-border-l2);border-radius:16px;background:var(--dsw-alias-bg-layer-1);padding:10px 14px}
.dau-details>summary{cursor:pointer;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}
.dau-details[open]>summary{margin-bottom:8px}
.dau-pre{margin:0;max-height:260px;overflow:auto;white-space:pre-wrap;word-break:break-word;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.dau-code{display:flex;gap:10px;align-items:flex-start;justify-content:space-between;padding:8px 10px;border-radius:10px;background:var(--dsw-alias-bg-layer-2);font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px;line-height:18px;word-break:break-all;color:var(--dsw-alias-label-secondary)}
.dau-note{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);margin:0}
.dau-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
@media (max-width: 760px){.dau-grid{grid-template-columns:minmax(0,1fr)}}
.dau-accent{color:var(--dsw-alias-brand-primary)}
.dau-ok{color:var(--dsw-alias-state-success-primary)}
.dau-warn{color:var(--dsw-alias-state-warn-primary)}
.dau-err{color:var(--dsw-alias-state-error-primary)}
`

  function format(template, params) {
    if (typeof template !== 'string') return ''
    if (!params) return template
    return template.replace(/\{(\w+)\}/g, function (match, key) {
      const value = params[key]
      return value === undefined || value === null ? match : String(value)
    })
  }

  function formatBytes(value) {
    const bytes = Number(value)
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
    const units = ['B', 'KB', 'MB', 'GB', 'TB']
    let index = 0
    let size = bytes
    while (size >= 1024 && index < units.length - 1) {
      size /= 1024
      index += 1
    }
    return `${size.toFixed(index === 0 ? 0 : 1)} ${units[index]}`
  }

  async function request(pathname, body) {
    const headers = { 'x-dsh-linux-desktop-updater': '1' }
    const init = { headers }
    if (body !== undefined) {
      init.method = 'POST'
      headers['content-type'] = 'application/json'
      init.body = JSON.stringify(body || {})
    }
    const response = await fetch(API + pathname, init)
    const text = await response.text()
    let payload = {}
    try {
      payload = text ? JSON.parse(text) : {}
    } catch (parseError) {
      payload = {}
    }
    if (!response.ok || payload.ok === false) {
      throw new Error(payload && payload.error ? payload.error : `HTTP ${response.status}`)
    }
    return payload
  }

  function IconRefresh() {
    return h('svg', { viewBox: '0 0 16 16', width: 14, height: 14, 'aria-hidden': true, focusable: 'false' },
      h('path', {
        d: 'M13.4 8a5.4 5.4 0 1 1-1.6-3.8M13.5 2.6v3.2h-3.2',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.5,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      }))
  }

  function IconDownload() {
    return h('svg', { viewBox: '0 0 16 16', width: 14, height: 14, 'aria-hidden': true, focusable: 'false' },
      h('path', {
        d: 'M8 2.5v7.2M5.2 7l2.8 2.8L10.8 7M2.8 12.6h10.4',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.5,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      }))
  }

  function IconExternal() {
    return h('svg', { viewBox: '0 0 16 16', width: 14, height: 14, 'aria-hidden': true, focusable: 'false' },
      h('path', {
        d: 'M6.5 3.2H3.4a1 1 0 0 0-1 1v8.4a1 1 0 0 0 1 1h8.4a1 1 0 0 0 1-1V9.4M9.4 2.6h4v4M13.2 2.8 7.6 8.4',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.5,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      }))
  }

  let React = null
  let h = null
  let currentT = null

  function translate(key, params) {
    const dict = (currentT && currentT.dict) || DICT.zh
    const value = dict[key] || DICT.en[key] || key
    return format(value, params)
  }

  function Button(props) {
    const variant = props.variant === 'primary'
      ? 'dau-btn dau-btn-primary'
      : props.variant === 'danger'
        ? 'dau-btn dau-btn-danger'
        : props.variant === 'sm'
          ? 'dau-btn dau-btn-sm'
          : 'dau-btn'
    return h('button', {
      type: 'button',
      className: variant,
      disabled: props.disabled === true,
      onClick: props.onClick,
      title: props.title,
    }, props.icon || null, props.children)
  }

  function Badge(props) {
    const tone = props.tone === 'ok'
      ? 'dau-badge dau-badge-ok'
      : props.tone === 'warn'
        ? 'dau-badge dau-badge-warn'
        : 'dau-badge dau-badge-idle'
    return h('span', { className: tone }, props.children)
  }

  function Row(props) {
    return h('div', { className: 'dau-row' },
      h('div', { className: 'dau-row-label' }, props.label),
      h('div', { className: 'dau-row-value' }, props.children))
  }

  function Panel(props) {
    const t = props && typeof props.t === 'function' ? props.t : translate
    const [snap, setSnap] = React.useState(null)
    const [notice, setNotice] = React.useState(null)
    const [pending, setPending] = React.useState('')
    const [diag, setDiag] = React.useState(null)
    const [diagBusy, setDiagBusy] = React.useState(false)
    const [elevation, setElevation] = React.useState(null)
    const [copied, setCopied] = React.useState(false)
    const [checking, setChecking] = React.useState(false)
    const mounted = React.useRef(true)
    const autoChecked = React.useRef(false)

    const refresh = React.useCallback(function () {
      return request('/status')
        .then(function (data) {
          if (mounted.current) setSnap(data)
        })
        .catch(function (error) {
          if (mounted.current) {
            setNotice({ tone: 'error', text: format(t('error.prefix'), { message: error.message || String(error) }) })
          }
        })
    }, [t])

    React.useEffect(function () {
      mounted.current = true
      refresh()
      const timer = setInterval(function () {
        if (mounted.current) refresh()
      }, 15000)
      return function () {
        mounted.current = false
        clearInterval(timer)
      }
    }, [refresh])

    const busy = !!(snap && snap.state && snap.state.busy)
    const phase = (snap && snap.state && snap.state.phase) || 'idle'

    React.useEffect(function () {
      if (!snap || autoChecked.current) return
      autoChecked.current = true
      if (!snap.latest && !busy) {
        request('/check', {})
          .then(function () { return refresh() })
          .catch(function (error) {
            if (mounted.current) setNotice({ tone: 'error', text: format(t('error.prefix'), { message: error.message || String(error) }) })
          })
      }
    }, [snap, busy, refresh, t])

    React.useEffect(function () {
      if (!busy) return undefined
      const timer = setInterval(function () {
        if (mounted.current) refresh()
      }, 1200)
      return function () { clearInterval(timer) }
    }, [busy, refresh])

    function runAction(name, action, successKey) {
      if (pending || checking) return
      setPending(name)
      setNotice(null)
      setElevation(null)
      action()
        .then(function () {
          if (mounted.current && successKey) setNotice({ tone: 'ok', text: t(successKey) })
          return refresh()
        })
        .catch(function (error) {
          if (mounted.current) {
            setNotice({ tone: 'error', text: format(t('error.prefix'), { message: error.message || String(error) }) })
          }
        })
        .finally(function () {
          if (mounted.current) setPending('')
        })
    }

    function doCheck() {
      setChecking(true)
      request('/check', {})
        .then(function () { return refresh() })
        .catch(function (error) {
          if (mounted.current) {
            setNotice({ tone: 'error', text: format(t('error.prefix'), { message: error.message || String(error) }) })
          }
        })
        .finally(function () {
          if (mounted.current) setChecking(false)
        })
    }

    function doDiagnostics() {
      if (diagBusy) return
      setDiagBusy(true)
      request('/diagnostics')
        .then(function (result) { if (mounted.current) setDiag(result.diagnostics) })
        .catch(function (error) {
          if (mounted.current) {
            setNotice({ tone: 'error', text: format(t('error.prefix'), { message: error.message || String(error) }) })
          }
        })
        .finally(function () { if (mounted.current) setDiagBusy(false) })
    }

    function testElevation() {
      setElevation({ state: 'running' })
      request('/test-elevation', {})
        .then(function (result) {
          if (mounted.current) setElevation({ state: 'done', result: result.result })
          return refresh()
        })
        .catch(function (error) {
          if (mounted.current) setElevation({ state: 'done', error: error.message || String(error) })
        })
    }

    function copyManual(command) {
      const clipboard = typeof navigator !== 'undefined' && navigator.clipboard
      if (!clipboard || typeof clipboard.writeText !== 'function') {
        setNotice({ tone: 'warn', text: t('notice.copyFailed') })
        return
      }
      clipboard.writeText(command).then(function () {
        if (mounted.current) {
          setCopied(true)
          setNotice({ tone: 'ok', text: t('notice.copied') })
          setTimeout(function () { if (mounted.current) setCopied(false) }, 2000)
        }
      }).catch(function () {
        if (mounted.current) setNotice({ tone: 'warn', text: t('notice.copyFailed') })
      })
    }

    const state = (snap && snap.state) || {}
    const installed = (snap && snap.installed) || {}
    const running = (snap && snap.running) || {}
    const latest = snap ? snap.latest : null
    const comparison = snap ? snap.comparison : null
    const busyNow = busy || !!pending || checking
    const canUpdate = !busyNow && comparison === 1
    const canCancel = busy && (phase === 'checking' || phase === 'downloading' || phase === 'installing')

    let badge
    if (latest && comparison !== null) {
      badge = comparison > 0
        ? h(Badge, { tone: 'warn' }, t('status.update', { version: latest.version }))
        : h(Badge, { tone: 'ok' }, t('status.latest'))
    } else {
      badge = h(Badge, { tone: 'idle' }, t('status.unchecked'))
    }

    const actions = []
    if (canCancel) {
      actions.push(h(Button, {
        key: 'cancel',
        variant: 'danger',
        onClick: function () { runAction('cancel', function () { return request('/cancel', {}) }, 'notice.cancelled') },
      }, t('action.cancel')))
    }
    actions.push(h(Button, {
      key: 'check',
      icon: h(IconRefresh),
      disabled: busyNow,
      onClick: doCheck,
    }, checking || pending === 'check' ? t('status.checking') : t('action.check')))

    const updateDisabled = !canUpdate || phase === 'installed'
    actions.push(h(Button, {
      key: 'update',
      variant: 'primary',
      icon: h(IconDownload),
      disabled: updateDisabled,
      title: latest ? latest.url : '',
      onClick: function () {
        runAction('update', function () { return request('/update', {}) }, 'notice.updateStarted')
      },
    }, phase === 'installed' ? t('action.installed') : t('action.update')))

    actions.push(h(Button, {
      key: 'page',
      icon: h(IconExternal),
      onClick: function () {
        if (snap && snap.page) window.open(snap.page, '_blank', 'noreferrer')
      },
    }, t('action.openPage')))

    const rows = []
    rows.push(h(Row, { key: 'running', label: t('label.running') },
      h('span', { className: 'dau-mono' }, running.version || t('unknown')),
      running.version && installed.version && running.version !== installed.version
        ? h('span', { className: 'dau-warn' }, '→ ' + installed.version)
        : null))
    rows.push(h(Row, { key: 'installed', label: t('label.installed') },
      h('span', { className: 'dau-mono' }, installed.version || t('unknown')),
      installed.source ? h('span', { className: 'dau-note' }, t('source.' + installed.source)) : null))
    rows.push(h(Row, { key: 'latest', label: t('label.latest') },
      latest ? h('span', { className: 'dau-mono' }, latest.version) : h('span', { className: 'dau-note' }, t('status.unchecked')),
      latest && latest.publishedAt
        ? h('span', { className: 'dau-note' }, t('label.published') + ' ' + new Date(latest.publishedAt).toLocaleString())
        : null))
    rows.push(h(Row, { key: 'package', label: t('label.package') },
      h('span', { className: 'dau-mono' }, installed.packageName || 'deepseek-harness'),
      h('span', { className: 'dau-note' }, (installed.family || 'unknown') + ' · ' + (installed.arch || running.arch || '') )))
    rows.push(h(Row, { key: 'location', label: t('label.location') },
      h('span', { className: 'dau-mono' }, installed.root || '—')))
    if (latest) {
      rows.push(h(Row, { key: 'asset', label: t('label.asset') },
        h('span', { className: 'dau-mono' }, latest.assetName || '—')))
    }

    const children = []
    children.push(h('style', { key: 'style' }, STYLE))
    children.push(h('div', { key: 'head', className: 'dau-head' },
      h('div', { className: 'dau-title-row' },
        h('h2', { className: 'dau-title' }, t('title')),
        badge),
      h('p', { className: 'dau-desc' }, t('desc')),
      h('div', { className: 'dau-actions' }, actions)))

    if (state.requiresRestart) {
      children.push(h('div', { key: 'restart', className: 'dau-banner dau-banner-success' }, t('hint.restart')))
    }
    if (state.message) {
      const tone = phase === 'error' ? ' dau-banner-error' : phase === 'installed' ? ' dau-banner-success' : ''
      children.push(h('div', { key: 'message', className: 'dau-banner' + tone }, state.message))
    }
    if (state.error && !state.message) {
      children.push(h('div', { key: 'error', className: 'dau-banner dau-banner-error' }, t('error.prefix') ? format(t('error.prefix'), { message: state.error }) : state.error))
    }
    if (notice) {
      children.push(h('div', {
        key: 'notice',
        className: 'dau-banner' + (notice.tone === 'error' ? ' dau-banner-error' : notice.tone === 'ok' ? ' dau-banner-success' : ' dau-banner-warn'),
      }, notice.text))
    }
    if (phase === 'downloading' && state.progress) {
      const progress = state.progress
      const percent = progress.percent
      children.push(h('div', { key: 'progress', className: 'dau-progress' },
        h('div', { className: 'dau-track' },
          h('div', { className: 'dau-bar', style: { width: (percent === null || percent === undefined ? 8 : Math.max(2, percent)) + '%' } })),
        h('div', { className: 'dau-progress-label' },
          percent === null || percent === undefined
            ? format(t('progress.downloading'), { received: formatBytes(progress.received) })
            : format(t('progress.percent'), {
                percent: percent,
                received: formatBytes(progress.received),
                total: formatBytes(progress.total),
              }))))
    }

    children.push(h('div', { key: 'card', className: 'dau-card' }, rows))
    children.push(h('p', { key: 'hint', className: 'dau-note' }, t('hint.auth')))

    if (state.manualCommand) {
      children.push(h('div', { key: 'manual', className: 'dau-details' },
        h('div', { className: 'dau-note', style: { marginBottom: '6px' } }, t('section.manual')),
        h('div', { className: 'dau-code' },
          h('span', null, state.manualCommand),
          h(Button, { variant: 'sm', onClick: function () { copyManual(state.manualCommand) } }, copied ? t('action.copied') : t('action.copy')))))
    }

    if (state.log && state.log.length) {
      children.push(h('details', { key: 'log', className: 'dau-details' },
        h('summary', null, t('section.log')),
        h('pre', { className: 'dau-pre' }, state.log.join('\n'))))
    }

    if (latest && latest.notes) {
      children.push(h('details', { key: 'notes', className: 'dau-details' },
        h('summary', null, format(t('section.notes'), { version: latest.version })),
        h('pre', { className: 'dau-pre' }, latest.notes)))
    }

    if (diag || diagBusy) {
      const diagChildren = []
      if (diagBusy) {
        diagChildren.push(h('p', { key: 'loading', className: 'dau-note' }, '…'))
      } else if (diag) {
        const binaries = diag.binaries || {}
        diagChildren.push(h('div', { key: 'grid', className: 'dau-grid' },
          h('div', { className: 'dau-card' },
            h(Row, { label: 'platform' }, h('span', { className: 'dau-mono' }, diag.platform + ' · ' + diag.arch)),
            h(Row, { label: 'family' }, h('span', { className: 'dau-mono' }, diag.family)),
            h(Row, { label: t('diag.pkexec') }, h('span', { className: 'dau-mono' }, binaries.pkexec || t('diag.none'))),
            h(Row, { label: 'pkexec --version' }, h('span', { className: 'dau-mono' }, diag.pkexecVersion || '—')),
            h(Row, { label: 'apt-get' }, h('span', { className: 'dau-mono' }, binaries['apt-get'] || t('diag.none'))),
            h(Row, { label: 'dpkg' }, h('span', { className: 'dau-mono' }, binaries.dpkg || t('diag.none')))),
          h('div', { className: 'dau-card' },
            h(Row, { label: t('diag.cache') }, h('span', { className: 'dau-mono' }, diag.cacheDir || '—')),
            h(Row, { label: t('diag.writable') }, h('span', { className: diag.cacheWritable ? 'dau-ok' : 'dau-err' }, diag.cacheWritable ? t('diag.yes') : t('diag.no'))),
            h(Row, { label: t('diag.free') }, h('span', { className: 'dau-mono' }, formatBytes(diag.freeBytes))),
            h(Row, { label: t('diag.dbus') }, h('span', { className: diag.dbusSession ? 'dau-ok' : 'dau-err' }, diag.dbusSession ? t('diag.yes') : t('diag.no'))),
            h(Row, { label: t('diag.display') }, h('span', { className: 'dau-mono' }, diag.display || '—')))))
        diagChildren.push(h('p', { key: 'testhint', className: 'dau-note' }, t('diag.testHint')))
        diagChildren.push(h(Button, { key: 'test', variant: 'sm', onClick: testElevation, disabled: elevation && elevation.state === 'running' },
          elevation && elevation.state === 'running' ? '…' : t('action.testElevation')))
        if (elevation && elevation.state === 'done') {
          if (elevation.result) {
            const ok = elevation.result.ok === true
            diagChildren.push(h('div', { key: 'elevresult', className: 'dau-banner' + (ok ? ' dau-banner-success' : ' dau-banner-error') },
              ok
                ? t('diag.testOk') + ' ' + (elevation.result.message || '')
                : format(t('diag.testFail'), { message: elevation.result.message || elevation.result.code })))
            if (elevation.result.log && elevation.result.log.length) {
              diagChildren.push(h('pre', { key: 'elevlog', className: 'dau-pre' }, elevation.result.log.join('\n')))
            }
          } else if (elevation.error) {
            diagChildren.push(h('div', { key: 'eleverr', className: 'dau-banner dau-banner-error' },
              format(t('diag.testFail'), { message: elevation.error })))
          }
        }
      }
      children.push(h('details', { key: 'diag', className: 'dau-details', open: !!diag },
        h('summary', null, t('section.diag')),
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '10px' } },
          h(Button, { variant: 'sm', onClick: doDiagnostics, disabled: diagBusy },
            diagBusy ? '…' : t('action.diagnostics')),
          diagChildren)))
    } else {
      children.push(h('div', { key: 'diagbutton' },
        h(Button, { variant: 'sm', onClick: doDiagnostics }, t('section.diag'))))
    }

    return h('section', { className: 'dau' }, children)
  }

  window.__ModuleLoader__.load({
    id: NS,
    factory(require) {
      const ReactModule = require('react')
      React = ReactModule
      h = ReactModule.createElement
      function apply(context) {
        const locale = context.locale
        const bound = locale && typeof locale.bind === 'function' ? locale.bind(NS) : translate
        let activeLocale = ''
        try {
          activeLocale = locale && typeof locale.getLocale === 'function' ? locale.getLocale().active : ''
        } catch (error) {
          activeLocale = ''
        }
        currentT = {
          dict: /^en/i.test(activeLocale) ? DICT.en : DICT.zh,
        }
        context.effect(function () {
          const disposers = []
          try {
            disposers.push(locale.register(NS, 'en', DICT.en))
          } catch (error) {
            /* ignore duplicate registration */
          }
          try {
            disposers.push(locale.register(NS, 'zh', DICT.zh))
          } catch (error) {
            /* ignore duplicate registration */
          }
          return function () {
            for (const disposer of disposers) {
              try {
                disposer()
              } catch (error) {
                /* ignore */
              }
            }
          }
        }, 'dsh-linux-desktop-updater: locale dictionaries')
        context.slots.inject('settings.section', function () {
          return context.slots.register({
            name: 'settings.section',
            id: 'dsh-linux-desktop-updater',
            order: 30,
            label: function () { return bound('title') },
            locale: NS,
          }, Panel)
        })
      }
      return {
        inject: ['slots', 'locale'],
        apply: apply,
      }
    },
  })
})()
