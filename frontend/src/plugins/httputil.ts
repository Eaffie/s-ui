import api from './api'
import { i18n } from '@/locales'
import router from '@/router'
import { push } from 'notivue'

export interface Msg {
  success: boolean
  msg: string
  obj: any | null
}

// While the panel updates it restarts, and every poll (status, onlines…) fails
// with 503 / network errors for a minute or two. Those are expected — don't pop
// a red toast for each one. Business errors (success:false with a message from
// the backend) still show.
let quietUntil = 0
export function quietNetworkErrors(ms: number) {
  quietUntil = ms > 0 ? Date.now() + ms : 0
}

function _handleMsg(msg: any): void {
  if (!isMsg(msg)) {
    return
  }
  if (!msg.success && Date.now() < quietUntil && /AxiosError|Network Error|status code 50\d/.test(String(msg.msg))) {
    return
  }
  if(msg.msg){
    if (!msg.success && msg.msg == "Invalid login") {
      push.error({
        title: i18n.global.t('invalidLogin'),
      })
      logout()
      return
    }
    if (msg.success) {
      push.success({
        message: i18n.global.t('success') + ": " + i18n.global.t('actions.' + msg.msg),
      })
    } else {
      push.error({
        title: i18n.global.t('failed'),
        message: msg.msg
      })
    }
  }
}

export const logout = async () => {
  const response = await HttpUtils.get('api/logout')
  if(response.success){
    router.push('/login')
  }
}

function _respToMsg(resp: any): Msg {
  const data = resp.data
  if (data == null) {
    return { success: true, msg: "", obj: null }
  } else if (isMsg(data)) {
    if (data.hasOwnProperty('success')) {
        return { success: data.success, msg: data.msg, obj: data.obj || null }
    } else {
        return data
    }
  } else {
    return { success: false, msg: `unknown data: ${data}`, obj: null }
  }
}

function isMsg(obj: any): obj is Msg {
  return Object.hasOwn(obj,'success') && Object.hasOwn(obj,'msg') && Object.hasOwn(obj, 'obj')
}
  
// Currently managed remote server id ('' = this local panel). When set, API
// calls carry X-Remote-Server so the backend forwards them to that server's
// APIv2 (the central-management proxy).
let currentRemote = ''
export function setRemoteServer(id: string | number | null) {
  currentRemote = id ? String(id) : ''
}
export function getRemoteServer(): string {
  return currentRemote
}

// After saving the config the panel restarts the core once it has been idle
// for a moment. When the panel is opened through a node of this very server,
// whatever request is in flight at that moment is cut — the backend can't see
// requests still on their way. So wait until the panel says the restart is done
// before sending anything else. Polls are silent (no toasts): the one in flight
// during the restart is expected to fail. Gives up after maxMs and carries on;
// a panel without this status key (older backend) answers with no `restart`
// and we return at once.
export async function waitCoreRestart(maxMs = 15000): Promise<void> {
  const end = Date.now() + maxMs
  while (Date.now() < end) {
    try {
      const config: any = { params: { r: 'restart' }, timeout: 3000 }
      if (currentRemote) config.headers = { 'X-Remote-Server': currentRemote }
      const resp = await api.get('api/status', config)
      if (resp.data?.obj?.restart?.pending !== true) return
    } catch (e) {
      // cut by the restart, or timed out: keep polling
    }
    // >= the panel's idle window (0.3s), so polling itself doesn't hold the restart off
    await new Promise((r) => setTimeout(r, 500))
  }
}

const HttpUtils = {
  async get(url: string, data: object = {}, options: any[] = []): Promise<Msg> {
    let msg: Msg
    try {
        const config: any = { params: data, ...options }
        if (currentRemote) config.headers = { ...(config.headers || {}), 'X-Remote-Server': currentRemote }
        const resp = await api.get(url, config)
        msg = _respToMsg(resp)
    } catch (e: any) {
        msg = { success: false, msg: e.toString(), obj: null }
    }
    _handleMsg(msg)
    return msg
  },
  async post(url: string, data: object | null, options: any = undefined): Promise<Msg> {
    let msg: Msg
    try {
        const config: any = { ...(options || {}) }
        if (currentRemote) config.headers = { ...(config.headers || {}), 'X-Remote-Server': currentRemote }
        const resp = await api.post(url, data, config)
        msg = _respToMsg(resp)
    } catch (e: any) {
        msg = { success: false, msg: e.toString(), obj: null }
    }
    _handleMsg(msg)
    return msg
  },
}

export default HttpUtils