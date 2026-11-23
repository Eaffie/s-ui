// sing-box route rules are first-match: once an inbound is claimed by an
// earlier rule that matches on the inbound alone, any later relay for the same
// inbound never fires — every node on it exits through the first landing
// (the "three relays, same landing IP" report). These helpers surface that.

// A rule that matches purely on inbound (no domain/ip/etc. conditions) and
// routes it somewhere — i.e. it captures ALL traffic of those inbounds.
const isInboundOnlyRoute = (rule: any): boolean =>
  !!rule && rule.action === 'route' && !!rule.outbound && !!rule.inbound &&
  Object.keys(rule).every((k) => ['inbound', 'action', 'outbound'].includes(k))

const toArr = (v: any): string[] => (Array.isArray(v) ? v : [v])

// inbound tag -> outbound tag of the FIRST rule that captures it.
export const inboundOwners = (rules: any[]): Record<string, string> => {
  const owners: Record<string, string> = {}
  for (const rule of rules || []) {
    if (!isInboundOnlyRoute(rule)) continue
    for (const t of toArr(rule.inbound)) if (!(t in owners)) owners[t] = rule.outbound
  }
  return owners
}

// For the rule at `index`: its inbounds that an earlier rule already captured,
// as { inbound tag: earlier outbound tag }.
export const shadowedInbounds = (rules: any[], index: number): Record<string, string> => {
  const owners = inboundOwners((rules || []).slice(0, index))
  const res: Record<string, string> = {}
  const self = rules[index]?.outbound
  for (const t of toArr(rules[index]?.inbound)) if (t in owners && owners[t] !== self) res[t] = owners[t]
  return res
}

// Everything in this panel's config model that can name an outbound tag, and
// still names `tag`. Deleting the outbound would leave these dangling. Most of
// them make sing-box 1.13 refuse to start at all — the core goes down for every
// node (DNS servers, an enabled NTP, selector / urltest members, rule-set
// download_detour, another outbound's or endpoint's detour, a reality / shadowtls
// handshake detour); a route rule pointing at it fails every connection it
// matches ("outbound not found"); a dangling clash UI detour only makes the UI
// download fail.
// `inbounds` must be FULL inbounds (api/inbounds?id=...); the list in Data()
// only carries tag/listen. Returns readable places ([] = nothing uses it).
const list = (v: any): any[] => (v == null ? [] : Array.isArray(v) ? v : [v])
export const outboundUsers = (tag: string, src: {
  config?: any, outbounds?: any[], endpoints?: any[], inbounds?: any[], services?: any[], tlsConfigs?: any[],
}): string[] => {
  const res: string[] = []
  const cfg = src.config || {}
  list(cfg.route?.rules).forEach((rule: any, i: number) => {
    // a legacy rule with no `action` ({outbound: X}) routes to X too; `bypass`
    // takes an outbound as well, and the `direct` action can dial via a detour
    const routes = ['route', 'bypass', undefined, ''].includes(rule?.action) && rule?.outbound === tag
    if (routes || (rule?.action === 'direct' && rule?.detour === tag)) res.push(`route.rules #${i + 1}`)
  })
  if (cfg.route?.final === tag) res.push('route.final')
  for (const rs of list(cfg.route?.rule_set)) {
    if (rs?.download_detour === tag) res.push(`route.rule_set "${rs.tag}" → download_detour`)
  }
  for (const s of list(cfg.dns?.servers)) {
    if (s?.detour === tag) res.push(`dns.servers "${s.tag}" → detour`)
  }
  // sing-box only builds NTP when it is enabled; a detour left in a disabled one is unused
  if (cfg.ntp?.enabled === true && cfg.ntp.detour === tag) res.push('ntp → detour')
  // the clash UI is only downloaded with both external_controller and external_ui set
  const ca = cfg.experimental?.clash_api
  if (ca?.external_controller && ca?.external_ui && ca.external_ui_download_detour === tag) {
    res.push('experimental.clash_api → external_ui_download_detour')
  }
  for (const o of list(src.outbounds)) {
    if (!o || o.tag === tag) continue
    // selector / urltest members and the selector's default
    if (o.detour === tag || list(o.outbounds).includes(tag) || o.default === tag) res.push(`outbound "${o.tag}"`)
  }
  for (const e of list(src.endpoints)) {
    if (e && e.tag !== tag && e.detour === tag) res.push(`endpoint "${e.tag}"`)
  }
  for (const ib of list(src.inbounds)) {
    // shadowtls: the handshake server is dialed through an outbound
    const hs = [ib?.handshake, ...Object.values(ib?.handshake_for_server_name || {}), ib?.tls?.reality?.handshake]
    if (hs.some((h: any) => h?.detour === tag)) res.push(`inbound "${ib.tag}"`)
  }
  for (const s of list(src.services)) {
    // ocm / ccm: detour; derp: verify_client_url[] and mesh_with[] dial fields
    const dials = [s, ...list(s?.verify_client_url), ...list(s?.mesh_with)]
    if (dials.some((d: any) => d && typeof d === 'object' && d.detour === tag)) res.push(`service "${s.tag}"`)
  }
  // TLS settings live in their own table; a reality server dials its handshake
  // target, optionally through an outbound. Only those an inbound / service uses
  // reach the core.
  const usedTls = new Set([...list(src.inbounds), ...list(src.services)].map((x: any) => x?.tls_id).filter((id: any) => id))
  for (const t of list(src.tlsConfigs)) {
    if (usedTls.has(t?.id) && t?.server?.reality?.handshake?.detour === tag) res.push(`tls "${t.name}"`)
  }
  return res
}
