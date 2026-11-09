// dsh-context-windows — client half (browser settings page)
//
// Registers a settings.section page under the Harness Settings navigation,
// mirroring the "Settings -> Qoder CN" experience but for the WorkBuddy and
// Trae connectors. The page reads model rosters from each connector's own
// proven /plugins/<pkg>/usage route, and reads / writes per-model
// context-window overrides through this plugin's own host routes:
//   GET  /plugins/dsh-context-windows/state
//   POST /plugins/dsh-context-windows/set
//
// Behavioural honesty: a budget only changes the contextWindow DSH advertises
// for the model (which drives auto-compression timing). It does NOT change the
// window the upstream service actually serves for a request.
//   - WorkBuddy honours ANY budget <= the native window (Math.min).
//   - Trae honours ONLY its own declared ladder: dev / 500K (when Max>=500K) /
//     Max. A model declaring no Max window is therefore read-only here, and we
//     say so explicitly instead of offering a control that silently does
//     nothing.

window.__ModuleLoader__.load({
  id: 'dsh-context-windows',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    const React = require('react')
    const {
      createElement: h,
      useState,
      useEffect,
      useCallback,
    } = React

    const NS = 'dsh-context-windows'
    const inject = ['slots', 'locale']

    const STATE_PATH = '/plugins/dsh-context-windows/state'
    const SET_PATH = '/plugins/dsh-context-windows/set'

    // Convenient stops for WorkBuddy. Because WorkBuddy applies
    // Math.min(native, budget), any positive integer below the native window
    // is effective; these are just the human-friendly round numbers.
    const WB_LADDER = [64000, 128000, 200000, 256000, 320000, 384000, 500000, 800000, 1000000]

    const SOURCES = [
      { connector: 'workbuddy', region: 'cn', labelKey: 'regionCn', url: '/plugins/dsh-connect-workbuddy/usage?region=cn' },
      { connector: 'workbuddy', region: 'global', labelKey: 'regionGlobal', url: '/plugins/dsh-connect-workbuddy/usage?region=global' },
      { connector: 'trae', region: 'cn', labelKey: 'regionCn', url: '/plugins/dsh-connect-trae/usage?region=cn&detail=fast' },
      { connector: 'trae', region: 'enterprise', labelKey: 'regionEnterprise', url: '/plugins/dsh-connect-trae/usage?region=enterprise&detail=fast' },
      { connector: 'trae', region: 'ai', labelKey: 'regionGlobal', url: '/plugins/dsh-connect-trae/usage?region=ai&detail=fast' },
    ]

    const zh = {
      nav: '模型上下文窗口',
      title: '模型上下文窗口',
      intro: '为 WorkBuddy 与 Trae 已接入的模型逐项设置上下文窗口大小，改动即时生效，无需重启。',
      warn: '这里调整的是 DSH 侧识别到的上下文窗口，用来决定自动压缩的触发时机；它不会改变上游服务实际为该请求提供的窗口。窗口设得越大，自动压缩触发得越晚；若对话经常超限，请选较小的窗口。',
      qoderNote: 'Qoder CN 请到「设置 → Qoder CN」中单独调整。',
      refresh: '刷新',
      reloading: '刷新中…',
      loading: '正在加载模型列表…',
      saved: '已保存',
      saving: '保存中…',
      loadError: '加载失败',
      default: '默认（跟随上游）',
      native: '上游',
      readOnly: '暂不可调',
      notEffective: '未生效',
      clear: '恢复默认',
      noModels: '该分区暂无可用模型',
      signedOut: '未登录',
      signedIn: '已登录',
      connectorWorkbuddy: 'WorkBuddy',
      connectorTrae: 'Trae',
      regionCn: '国内版',
      regionGlobal: '国际版',
      regionEnterprise: '企业版',
      count: '共 {count} 个模型',
      namespaceMissing: '未找到该接入的配置命名空间，可能尚未启用对应插件。',
      wbHint: 'WorkBuddy 会用 Math.min(上游窗口, 设定值) 限制窗口，因此这里提供的是「调小」档位；任意小于上游窗口的正整数都会生效。',
      traeHint: 'Trae 仅接受其自身声明的档位（默认 / 500K / Max）。上游未声明 Max 窗口的模型暂不可调，本页会如实标注。',
      dshOnly: '仅影响 DSH 压缩时机',
    }

    const en = {
      nav: 'Model Context Windows',
      title: 'Model Context Windows',
      intro: 'Set the context window per model for connected WorkBuddy and Trae providers. Changes apply immediately, no restart needed.',
      warn: 'This changes the context window DSH advertises for the model, which controls when auto-compression kicks in. It does NOT change the window the upstream service actually serves for a request. A larger window delays compression; if conversations frequently overflow, pick a smaller one.',
      qoderNote: 'For Qoder CN, use its own page under "Settings > Qoder CN".',
      refresh: 'Refresh',
      reloading: 'Refreshing…',
      loading: 'Loading model list…',
      saved: 'Saved',
      saving: 'Saving…',
      loadError: 'Failed to load',
      default: 'Default (follow upstream)',
      native: 'Upstream',
      readOnly: 'Not adjustable',
      notEffective: 'not applied',
      clear: 'Reset',
      noModels: 'No models available in this region',
      signedOut: 'Signed out',
      signedIn: 'Signed in',
      connectorWorkbuddy: 'WorkBuddy',
      connectorTrae: 'Trae',
      regionCn: 'China',
      regionGlobal: 'Global',
      regionEnterprise: 'Enterprise',
      count: '{count} models',
      namespaceMissing: 'Config namespace for this connector was not found; the plugin may not be enabled.',
      wbHint: 'WorkBuddy clamps with Math.min(native, budget), so the options here only lower the window; any positive value below the upstream window takes effect.',
      traeHint: 'Trae only accepts its own declared ladder (default / 500K / Max). Models declaring no Max window are shown as read-only.',
      dshOnly: 'Affects DSH compression timing only',
    }

    // Extra CSS that inline styles cannot express (pseudo-classes, color-scheme).
    // Deliberately free of backticks: the module loader evaluates this file's
    // source, and a stray backtick inside a string here used to break parsing.
    const STYLE_TEXT = [
      '.dcw-root{isolation:isolate}',
      '.dcw-root select{color-scheme:light dark}',
      '.dcw-root button:hover{opacity:.75}',
      '.dcw-root button:disabled{opacity:.5;cursor:default}',
      '.dcw-root .dcw-row:hover{background:var(--dsw-alias-bg-hover, rgba(128,128,128,.06))}',
    ].join('\n')

    // Small translation wrapper. Uses the host's live locale.bind(NS) so the
    // page reacts to language changes, and adds {placeholder} substitution plus
    // a safe fallback to the Chinese dictionary / the key itself.
    function makeT(ctx) {
      let bound = null
      try {
        if (ctx.locale && typeof ctx.locale.bind === 'function') bound = ctx.locale.bind(NS)
      } catch (e) {
        bound = null
      }
      return (key, vars) => {
        let s = bound ? bound(key) : undefined
        if (typeof s !== 'string' || s === key || s.length === 0) {
          s = zh[key] !== undefined ? zh[key] : key
        }
        if (vars) {
          for (const k of Object.keys(vars)) {
            s = s.split('{' + k + '}').join(String(vars[k]))
          }
        }
        return s
      }
    }

    function formatCapacity(n) {
      const v = Number(n)
      if (!Number.isFinite(v) || v <= 0) return '—'
      if (v >= 1000000) {
        const m = v / 1000000
        return (Number.isInteger(m) ? String(m) : m.toFixed(1).replace(/\.0$/, '')) + 'M'
      }
      if (v >= 1000) {
        const k = v / 1000
        return (Number.isInteger(k) ? String(k) : k.toFixed(1).replace(/\.0$/, '')) + 'K'
      }
      return String(v)
    }

    async function fetchJson(url, options) {
      const opts = options || {}
      const res = await fetch(url, {
        method: opts.method || 'GET',
        headers: { accept: 'application/json', ...(opts.headers || {}) },
        credentials: 'same-origin',
        body: opts.body,
      })
      const text = await res.text()
      let data = {}
      try {
        data = text ? JSON.parse(text) : {}
      } catch (e) {
        data = {}
      }
      if (!res.ok) throw new Error(data && data.error ? data.error : 'HTTP ' + res.status)
      return data
    }

    // Numbers the connector will ACTUALLY honour, excluding the "default"
    // (clear) option. Returns { defaultWindow, choices, readOnly }.
    function ladderFor(connector, model, savedBudget) {
      if (connector === 'workbuddy') {
        const native = Number(model.nativeContextWindow || model.contextWindow) || 200000
        const set = []
        const push = (v) => {
          const n = Number(v)
          if (Number.isInteger(n) && n >= 1 && n <= native && !set.includes(n)) set.push(n)
        }
        for (const v of WB_LADDER) push(v)
        push(model.contextWindow) // effective window if a budget is already set
        if (savedBudget !== undefined) push(savedBudget)
        set.sort((a, b) => a - b)
        return { defaultWindow: native, choices: set.filter((v) => v !== native), readOnly: false }
      }
      // Trae: only dev / 500K (when Max >= 500K) / Max are honoured.
      const dev = Number(model.contextWindow) || 200000
      const max = Number(model.maxContextWindow) || 0
      const set = []
      const push = (v) => {
        const n = Number(v)
        if (Number.isInteger(n) && n >= 1 && !set.includes(n)) set.push(n)
      }
      push(dev)
      if (max >= 500000 && 500000 > dev) push(500000)
      push(max)
      set.sort((a, b) => a - b)
      const choices = set.filter((v) => v !== dev)
      return { defaultWindow: dev, choices: choices, readOnly: choices.length === 0 }
    }

    // Proven theme tokens, copied from dsh-qoder-link/client.js css object.
    const css = {
      page: {
        maxWidth: '900px', display: 'flex', flexDirection: 'column', gap: '14px',
        color: 'var(--dsw-alias-label-primary)', font: 'inherit', isolation: 'isolate',
      },
      header: { display: 'flex', alignItems: 'center', gap: '10px' },
      h2: { margin: 0, fontSize: '1.15em', fontWeight: 600 },
      spacer: { flex: '1 1 auto' },
      btn: {
        padding: '6px 12px', borderRadius: '7px',
        border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.35))',
        background: 'transparent', color: 'inherit', cursor: 'pointer',
        font: 'inherit', fontSize: '0.88em',
      },
      intro: { margin: 0, opacity: 0.72, lineHeight: 1.55, fontSize: '0.9em' },
      note: {
        margin: 0, padding: '10px 12px', borderRadius: '8px',
        border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.25))',
        background: 'var(--dsw-alias-bg-base, transparent)',
        fontSize: '0.82em', opacity: 0.82, lineHeight: 1.6,
      },
      group: {
        display: 'flex', flexDirection: 'column', gap: '10px',
        border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.25))',
        borderRadius: '10px', padding: '14px 16px',
      },
      groupHead: { display: 'flex', alignItems: 'center', gap: '10px' },
      h3: { margin: 0, fontSize: '0.98em', fontWeight: 600 },
      tag: {
        fontSize: '0.72em', padding: '1px 7px', borderRadius: '5px',
        border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.35))', opacity: 0.8,
      },
      connectorTag: {
        fontSize: '0.72em', padding: '1px 7px', borderRadius: '5px',
        border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.35))',
        color: 'var(--dsw-alias-brand-primary, #4c6ef5)',
      },
      count: { fontSize: '0.82em', opacity: 0.65, marginLeft: 'auto' },
      list: {
        display: 'flex', flexDirection: 'column',
        border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.25))',
        borderRadius: '10px', overflow: 'hidden',
      },
      row: {
        display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 14px',
        borderTop: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.15))',
      },
      rowFirst: { borderTop: 'none' },
      name: { flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2px' },
      nameText: { fontSize: '0.92em', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      id: { fontSize: '0.75em', opacity: 0.55, fontFamily: 'ui-monospace, monospace' },
      meta: { fontSize: '0.76em', opacity: 0.62, whiteSpace: 'nowrap' },
      select: {
        padding: '5px 8px', borderRadius: '7px',
        border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.35))',
        background: 'var(--dsw-alias-bg-base, transparent)', color: 'inherit',
        font: 'inherit', fontSize: '0.85em', minWidth: '150px', colorScheme: 'light dark',
      },
      hint: { fontSize: '0.78em', opacity: 0.62, lineHeight: 1.5 },
      err: { fontSize: '0.86em', color: 'var(--dsw-alias-label-danger, #e03131)' },
      ok: { fontSize: '0.86em', color: 'var(--dsw-alias-brand-primary, #4c6ef5)' },
      muted: { fontSize: '0.84em', opacity: 0.6 },
    }

    function SettingsPage(props) {
      const ctx = props.ctx
      const t = props.t
      const [loading, setLoading] = useState(true)
      const [error, setError] = useState(null)
      const [namespaces, setNamespaces] = useState({})
      const [budgets, setBudgets] = useState({})
      const [groups, setGroups] = useState([])
      const [saving, setSaving] = useState({})
      const [flash, setFlash] = useState(null)
      const [reloading, setReloading] = useState(false)

      const load = useCallback(async (silent) => {
        if (!silent) setLoading(true)
        setError(null)
        try {
          const rosterCalls = SOURCES.map((s) =>
            fetchJson(s.url).catch((e) => ({
              status: 'error',
              models: [],
              error: String(e && e.message ? e.message : e),
            }))
          )
          const results = await Promise.all([fetchJson(STATE_PATH)].concat(rosterCalls))
          const state = results[0] || {}
          setNamespaces(state.namespaces || {})
          setBudgets(state.budgets || {})
          setGroups(
            SOURCES.map((s, i) => {
              const r = results[i + 1] || {}
              return {
                source: s,
                status: r.status,
                models: Array.isArray(r.models) ? r.models : [],
                error: r.error,
              }
            })
          )
        } catch (e) {
          setError(String(e && e.message ? e.message : e))
        } finally {
          if (!silent) setLoading(false)
        }
      }, [])

      useEffect(() => {
        load(false)
      }, [load])

      const refresh = useCallback(async () => {
        setReloading(true)
        setFlash(null)
        await load(true)
        setReloading(false)
      }, [load])

      const setBudget = useCallback(
        async (source, modelId, rawValue) => {
          const key = source.connector + ':' + source.region + ':' + modelId
          setSaving((prev) => ({ ...prev, [key]: true }))
          setFlash(null)
          const value = rawValue === '' || rawValue === null || rawValue === undefined ? null : Number(rawValue)
          try {
            const data = await fetchJson(SET_PATH, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                connector: source.connector,
                region: source.region,
                modelId: modelId,
                value: value,
              }),
            })
            if (!data.ok) throw new Error(data.error || 'write rejected')
            await load(true) // re-fetch rosters so the effective window proves the write
            setFlash({ ok: true, msg: t('saved') })
          } catch (e) {
            setFlash({ ok: false, msg: String(e && e.message ? e.message : e) })
          } finally {
            setSaving((prev) => {
              const next = { ...prev }
              delete next[key]
              return next
            })
          }
        },
        [load, t]
      )

      const renderRow = (source, model, index, budgetMap) => {
        const saved = budgetMap[model.id]
        const ladder = ladderFor(source.connector, model, saved)
        const key = source.connector + ':' + source.region + ':' + model.id
        const busy = !!saving[key]
        const savedNum = saved === undefined ? undefined : Number(saved)
        const selected = savedNum === undefined || savedNum === ladder.defaultWindow ? '' : String(savedNum)
        const stale = ladder.readOnly && savedNum !== undefined

        let control
        if (ladder.readOnly) {
          control = h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
            h(
              'span',
              { style: css.hint },
              stale
                ? t('saved') + ' ' + formatCapacity(saved) + ' · ' + t('notEffective')
                : t('readOnly')
            ),
            stale
              ? h('button', { style: css.btn, disabled: busy, onClick: () => setBudget(source, model.id, null) }, t('clear'))
              : null
          )
        } else {
          const opts = [
            h('option', { key: 'default', value: '' }, t('default') + ' · ' + formatCapacity(ladder.defaultWindow)),
          ]
          for (const v of ladder.choices) {
            opts.push(h('option', { key: String(v), value: String(v) }, formatCapacity(v)))
          }
          control = h(
            'select',
            {
              style: css.select,
              value: selected,
              disabled: busy,
              onChange: (ev) => setBudget(source, model.id, ev.target.value),
              'aria-label': t('title') + ' - ' + String(model.id),
            },
            opts
          )
        }

        return h(
          'div',
          { key: model.id, className: 'dcw-row', style: { ...css.row, ...(index === 0 ? css.rowFirst : {}) } },
          h(
            'div',
            { style: css.name },
            h('span', { style: css.nameText }, String(model.name || model.id)),
            h('span', { style: css.id }, String(model.id))
          ),
          h('span', { style: css.meta }, t('native') + ' ' + formatCapacity(ladder.defaultWindow)),
          control,
          busy ? h('span', { style: css.muted }, t('saving')) : null
        )
      }

      const renderGroup = (g) => {
        const s = g.source
        const budgetMap = budgets[s.connector + ':' + s.region] || {}
        const connected = g.status === 'signed-in'
        const nsMissing = namespaces[s.connector] == null
        const models = connected ? g.models : []
        return h(
          'section',
          { key: s.connector + ':' + s.region, style: css.group },
          h(
            'div',
            { style: css.groupHead },
            h(
              'span',
              { style: css.connectorTag },
              s.connector === 'workbuddy' ? t('connectorWorkbuddy') : t('connectorTrae')
            ),
            h('h3', { style: css.h3 }, t(s.labelKey)),
            h('span', { style: css.tag }, connected ? t('signedIn') : t('signedOut')),
            h('span', { style: css.count }, t('count', { count: models.length }))
          ),
          h('div', { style: css.hint }, s.connector === 'workbuddy' ? t('wbHint') : t('traeHint')),
          nsMissing ? h('div', { style: css.err }, t('namespaceMissing')) : null,
          models.length === 0
            ? h(
                'div',
                { style: css.muted },
                connected ? t('noModels') : t('signedOut') + (g.error ? ' · ' + g.error : '')
              )
            : h('div', { style: css.list }, models.map((m, i) => renderRow(s, m, i, budgetMap)))
        )
      }

      if (loading) {
        return h(
          'div',
          { className: 'dcw-root', style: css.page },
          h('style', null, STYLE_TEXT),
          h('div', { style: css.muted }, t('loading'))
        )
      }

      return h(
        'div',
        { className: 'dcw-root', style: css.page },
        h('style', null, STYLE_TEXT),
        h(
          'div',
          { style: css.header },
          h('h2', { style: css.h2 }, t('title')),
          h('span', { style: css.spacer }),
          h('button', { style: css.btn, disabled: reloading, onClick: refresh }, reloading ? t('reloading') : t('refresh'))
        ),
        h('p', { style: css.intro }, t('intro')),
        h('p', { style: css.note }, t('warn') + ' ' + t('qoderNote')),
        h('div', { style: css.hint }, '· ' + t('dshOnly')),
        error ? h('div', { style: css.err }, t('loadError') + ' · ' + error) : null,
        flash ? h('div', { style: flash.ok ? css.ok : css.err }, flash.msg) : null,
        ...groups.map(renderGroup)
      )
    }

    function apply(ctx) {
      const t = makeT(ctx)
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-context-windows: dictionaries')
      ctx.effect(() =>
        ctx.slots.inject('settings.section', () =>
          ctx.slots.register(
            { name: 'settings.section', id: NS, order: 38, label: () => t('nav'), locale: NS },
            (props) => h(SettingsPage, { ...props, ctx, t })
          )
        ), 'dsh-context-windows: settings page')
    }

    exports.apply = apply
    exports.inject = inject
    exports.name = NS
    exports.__test = { zh, en, makeT, formatCapacity, ladderFor, SettingsPage, NS, SOURCES, WB_LADDER }
    return module.exports
  },
})
