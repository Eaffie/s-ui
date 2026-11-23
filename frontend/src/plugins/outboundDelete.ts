// Delete outbounds / endpoints only when nothing references them any more.
// A dangling reference is not harmless: a DNS server, an enabled NTP, a selector,
// a rule set or another outbound pointing at a deleted tag makes sing-box refuse to start,
// taking every node on the server down. Used by the Relay page and by the
// Outbounds / Endpoints pages. (Frontend check only — the backend still lets an
// outbound be deleted, as upstream does.)
import Data from '@/store/modules/data'
import HttpUtils from '@/plugins/httputil'
import { outboundUsers } from '@/plugins/relayUtil'

// Everything outboundUsers needs. The inbound list in Data() has no options, so
// the shadowtls ones (whose handshake can dial through an outbound) are read in
// full. null = couldn't read them, so nothing can be confirmed unused.
async function loadSources() {
  const d = Data()
  const ids = (d.inbounds || []).filter((i: any) => i.type === 'shadowtls').map((i: any) => i.id)
  let full: any[] = []
  if (ids.length > 0) {
    const msg = await HttpUtils.get('api/inbounds', { id: ids.join(',') })
    if (!msg.success) return null
    full = msg.obj?.inbounds ?? []
  }
  // keep every inbound (tls_id is needed to know which TLS settings are in use)
  const inbounds = (d.inbounds || []).map((i: any) => full.find((f: any) => f.id === i.id) ?? i)
  return () => ({
    config: Data().config, outbounds: Data().outbounds, endpoints: Data().endpoints,
    services: Data().services, tlsConfigs: Data().tlsConfigs, inbounds,
  })
}

export interface DeleteResult {
  deleted: string[]
  kept: Record<string, string[]>  // tag -> where it is still used (as of the end)
  failed: string[]                // the delete request itself failed (already shown as an error)
  unchecked: boolean              // couldn't check references: nothing was deleted
}

// Delete `tags` (all outbounds, or all endpoints). One may reference another in
// the same batch (landB.detour = land): passes repeat until one deletes nothing
// new, so referrers go first and their targets follow. What is reported as
// kept is re-checked at the end.
export async function deleteUnused(object: 'outbounds' | 'endpoints', tags: string[]): Promise<DeleteResult> {
  const res: DeleteResult = { deleted: [], kept: {}, failed: [], unchecked: false }
  let pending = [...new Set(tags)]
  const sources = await loadSources()
  if (!sources) {
    res.unchecked = true
    return res
  }
  const exists = (t: string) => ((object === 'outbounds' ? Data().outbounds : Data().endpoints) || []).some((o: any) => o.tag === t)
  // gone already (e.g. deleted elsewhere): nothing to do
  pending = pending.filter(exists)
  let progress = true
  while (progress && pending.length > 0) {
    progress = false
    for (const tag of [...pending]) {
      if (outboundUsers(tag, sources()).length > 0) continue
      pending = pending.filter((t) => t !== tag)
      if (await Data().save(object, 'del', tag)) {
        res.deleted.push(tag)
        progress = true
      } else {
        res.failed.push(tag)
      }
    }
  }
  for (const tag of pending) res.kept[tag] = outboundUsers(tag, sources())
  return res
}
