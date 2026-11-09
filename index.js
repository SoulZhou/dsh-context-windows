// dsh-context-windows — host half
//
// Exposes two same-origin loopback routes used by the browser settings page:
//   GET  /plugins/dsh-context-windows/state  -> current per-model budgets
//   POST /plugins/dsh-context-windows/set    -> change one model's budget
//
// It deliberately does NOT try to read the model ROSTER here. The client page
// fetches that from each connector's own proven `/plugins/<pkg>/usage` route.
// This half only reads/writes the `contextBudgets` field inside each
// connector's `regions` config map, using the Host settings service exactly
// the way the connectors' own `__save` / card writers do:
//   settings.describe() -> find ns -> mutate(ns, [{op:'set',path:['regions'],value:merged}], void 0)

const STATE_PATH = '/plugins/dsh-context-windows/state'
const SET_PATH = '/plugins/dsh-context-windows/set'

const PANELS = {
  workbuddy: ['cn', 'global'],
  trae: ['cn', 'enterprise', 'ai'],
}

export const inject = ['settings']
export const name = 'dsh-context-windows'

// ── small local helpers (do not import the connectors' private helpers) ─────

function isPlain(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

// Peel schemastery volatile live references ({ get(): T }) recursively.
function unwrapVolatileDeep(value) {
  if (value === null || typeof value !== 'object') return value
  if (typeof value.get === 'function') return unwrapVolatileDeep(value.get())
  if (Array.isArray(value)) return value.map(unwrapVolatileDeep)
  const out = {}
  for (const key of Object.keys(value)) out[key] = unwrapVolatileDeep(value[key])
  return out
}

function json(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {})
      } catch (e) {
        reject(e)
      }
    })
    req.on('error', reject)
  })
}

// Same-origin loopback guard. Browser fetches to this path carry a loopback
// Origin; DNS-rebinding attempts with a foreign Host/Origin are refused.
function isLoopback(req) {
  const host = String(req.headers?.host ?? '')
  const hostOk = /^(127\.0\.0\.1|localhost|\[::1\]|0:0:0:0:0:0:0:1)(:\d+)?$/i.test(host)
  const origin = req.headers?.origin
  const originOk = !origin || /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?\/?$/i.test(String(origin))
  const remote = String(req.socket?.remoteAddress ?? '')
  const remoteOk = /^(::1|::ffff:127\.0\.0\.1|127\.0\.0\.1)$/.test(remote)
  return (hostOk || remoteOk) && originOk
}

// The `regions` map of one namespace, unwrapped and narrowed to a plain object.
function regionsOf(row) {
  const section = unwrapVolatileDeep(row?.value ?? {})
  const regions = unwrapVolatileDeep(isPlain(section) ? (section.regions ?? {}) : {})
  return isPlain(regions) ? regions : {}
}

function budgetsOf(row, region) {
  const regions = regionsOf(row)
  const slot = unwrapVolatileDeep(isPlain(regions[region]) ? regions[region] : {})
  const cb = isPlain(slot) && isPlain(slot.contextBudgets) ? slot.contextBudgets : {}
  return cb
}

function findRow(settings, connector) {
  const needle = connector === 'workbuddy' ? /workbuddy/i : /trae/i
  return settings.describe().find((r) => needle.test(String(r.ns)))
}

// ── route handlers ──────────────────────────────────────────────────────────

async function handleState(ctx, res) {
  const settings = ctx.get?.('settings')
  if (settings === undefined) return json(res, 503, { error: 'settings service unavailable' })
  const namespaces = {}
  const budgets = {}
  for (const connector of Object.keys(PANELS)) {
    const row = findRow(settings, connector)
    namespaces[connector] = row ? String(row.ns) : null
    for (const panel of PANELS[connector]) {
      budgets[connector + ':' + panel] = row ? budgetsOf(row, panel) : {}
    }
  }
  return json(res, 200, { ok: true, namespaces, budgets })
}

async function handleSet(ctx, req, res) {
  const settings = ctx.get?.('settings')
  if (settings === undefined) return json(res, 503, { error: 'settings service unavailable' })
  let body
  try {
    body = await readBody(req)
  } catch {
    return json(res, 400, { error: 'invalid JSON body' })
  }
  const connector = body.connector
  const region = body.region
  const modelId = body.modelId
  const value = body.value
  if (!Array.isArray(PANELS[connector])) return json(res, 400, { error: 'unknown connector' })
  if (!PANELS[connector].includes(region)) return json(res, 400, { error: 'unknown region' })
  if (typeof modelId !== 'string' || modelId.length === 0) return json(res, 400, { error: 'modelId required' })
  const clear = value === null || value === undefined || value === ''
  const num = clear ? null : Number(value)
  if (!clear && (!Number.isInteger(num) || num < 1 || num > 4000000)) {
    return json(res, 400, { error: 'value must be a positive integer token count or null' })
  }
  const row = findRow(settings, connector)
  if (!row) return json(res, 503, { error: connector + ' namespace missing from describe()' })
  try {
    const regions = regionsOf(row)
    const prior = isPlain(regions[region]) ? unwrapVolatileDeep(regions[region]) : {}
    const slot = { ...prior }
    const budgets = { ...(isPlain(slot.contextBudgets) ? slot.contextBudgets : {}) }
    if (clear) delete budgets[modelId]
    else budgets[modelId] = num
    slot.contextBudgets = budgets
    const merged = { ...regions, [region]: slot }
    await settings.mutate(String(row.ns), [{ op: 'set', path: ['regions'], value: merged }], undefined)
    return json(res, 200, { ok: true, value: clear ? null : num, budgets })
  } catch (e) {
    return json(res, 500, { error: 'settings.mutate failed: ' + String(e && e.message ? e.message : e) })
  }
}

// ── apply ───────────────────────────────────────────────────────────────────

export function apply(ctx, config) {
  ctx.inject(['webServer'], (hostCtx) => {
    const server = (hostCtx && hostCtx.webServer) || ctx.webServer
    if (!server) return undefined
    const disposers = []
    disposers.push(server.register({
      kind: 'exact',
      path: STATE_PATH,
      handler: async (req, res) => {
        if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed' })
        if (!isLoopback(req)) return json(res, 403, { error: 'forbidden' })
        try {
          return await handleState(ctx, res)
        } catch (e) {
          return json(res, 500, { error: String(e && e.message ? e.message : e) })
        }
      },
    }))
    disposers.push(server.register({
      kind: 'exact',
      path: SET_PATH,
      handler: async (req, res) => {
        if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
        if (!isLoopback(req)) return json(res, 403, { error: 'forbidden' })
        try {
          return await handleSet(ctx, req, res)
        } catch (e) {
          return json(res, 500, { error: String(e && e.message ? e.message : e) })
        }
      },
    }))
    return () => {
      for (const d of disposers) {
        try { if (typeof d === 'function') d() } catch { /* ignore */ }
      }
    }
  })
}
