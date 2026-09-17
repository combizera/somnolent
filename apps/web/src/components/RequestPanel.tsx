import { useState } from 'react'
import { Check, ChevronDown, Eye, EyeOff, Loader2, Send } from 'lucide-react'
import CodeMirror from '@uiw/react-codemirror'
import { json } from '@codemirror/lang-json'
import { EditorView } from '@codemirror/view'
import {
  buildContext,
  extractPathParams,
  resolveRequest,
  resolveTemplate,
  toCurl,
  type ApiRequest,
  type HttpMethod,
  type KeyValue,
  type RequestAuth,
} from '@somnolent/core'
import { codeTheme } from '../lib/codeTheme'
import { templateVariables } from '../lib/cmTemplate'
import { copyText } from '../lib/clipboard'
import { useActiveEnv, useBaseEnv, useStore } from '../store'
import { useLayout, type RequestTab } from '../layoutStore'
import { useSession } from '../sessionStore'
import { sendRequest } from '../lib/send'
import { api } from '../lib/api'
import { TemplateInput } from './TemplateInput'
import { KeyValueEditor } from './KeyValueEditor'
import { METHOD_TEXT } from '../lib/methodColors'

const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']
type Tab = RequestTab

const BODY_TYPES = ['none', 'json', 'text', 'form'] as const
type BodyType = (typeof BODY_TYPES)[number]

const BODY_LABEL: Record<BodyType, string> = {
  none: 'None',
  json: 'JSON',
  text: 'Text',
  form: 'Form',
}

/** Content-Type implied by the body type, when no manual header exists. */
const BODY_CONTENT_TYPE: Partial<Record<BodyType, string>> = {
  json: 'application/json',
  form: 'application/x-www-form-urlencoded',
}

const AUTH_LABEL: Record<RequestAuth['type'], string> = {
  none: 'None',
  bearer: 'Bearer token',
  basic: 'Basic',
}

/** Separate `body`/`formBody` fields, so Form ↔ JSON round-trips; only None drops the text. */
function changeBodyType(request: ApiRequest, bodyType: BodyType): Partial<ApiRequest> {
  if (bodyType === 'none') return { bodyType, body: null }
  if (bodyType === 'form') return { bodyType, formBody: request.formBody ?? [] }
  return { bodyType, body: request.body ?? '' }
}

/** Tolerant base64: an accented token would blow up btoa. */
function toBase64(text: string): string {
  try {
    return btoa(text)
  } catch {
    return '—'
  }
}

/** One label + field row, in the same language as the variable tables. */
function AuthField({
  label,
  value,
  onChange,
  ctx,
  placeholder,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  ctx: Record<string, string>
  placeholder: string
}) {
  return (
    <div className="grid grid-cols-[88px_minmax(0,1fr)] items-center gap-3">
      <label className="text-[10px] font-semibold tracking-wider text-ink-faint uppercase">
        {label}
      </label>
      {/* Always TemplateInput: the field holds the template, not the secret —
          what needs masking is the resolved value below, under "Sends". */}
      <div className="rounded-md border border-line bg-app focus-within:border-brand">
        <TemplateInput value={value} onChange={onChange} ctx={ctx} placeholder={placeholder} />
      </div>
    </div>
  )
}

/** Rows for the URL's `:params`. The names come from the URL itself, so only the
 *  value is editable — the name lives in the URL. */
function PathParams({
  names,
  values,
  onChange,
  ctx,
}: {
  names: string[]
  values: KeyValue[]
  onChange: (values: KeyValue[]) => void
  ctx: Record<string, string>
}) {
  const valueOf = (name: string) => values.find((v) => v.key === name)?.value ?? ''

  const setValue = (name: string, value: string) => {
    const existe = values.some((v) => v.key === name)
    onChange(
      existe
        ? values.map((v) => (v.key === name ? { ...v, value } : v))
        : [...values, { id: crypto.randomUUID(), key: name, value, enabled: true }],
    )
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="grid grid-cols-[1fr_1.5fr] items-center gap-1 px-1 pb-0.5 text-[10px] tracking-wider text-ink-faint uppercase">
        <span>path param</span>
        <span>value</span>
      </div>
      {names.map((name) => {
        const preenchido = valueOf(name).trim() !== ''
        return (
          <div
            key={name}
            className={`grid grid-cols-[1fr_1.5fr] items-center gap-1 rounded-md border-2 bg-app transition ${
              preenchido ? 'border-line-soft hover:border-line' : 'border-bad'
            }`}
          >
            <span
              className="truncate px-3 py-2 font-mono text-sm text-brand-hi"
              title="The name comes from the URL — edit it there to rename"
            >
              :{name}
            </span>
            <TemplateInput
              value={valueOf(name)}
              onChange={(value) => setValue(name, value)}
              ctx={ctx}
              placeholder="Value that goes into the URL"
            />
          </div>
        )
      })}
    </div>
  )
}

function AuthEditor({
  auth,
  onChange,
  ctx,
}: {
  auth: RequestAuth
  onChange: (auth: RequestAuth) => void
  ctx: Record<string, string>
}) {
  const [revealed, setRevealed] = useState(false)

  // What will go out in the header, already resolved in the active environment.
  const preview = (() => {
    if (auth.type === 'bearer') {
      const token = resolveTemplate(auth.token ?? '', ctx)
      return {
        text: `Bearer ${token.output || '…'}`,
        missing: token.missing,
      }
    }
    if (auth.type === 'basic') {
      const user = resolveTemplate(auth.username ?? '', ctx)
      const pass = resolveTemplate(auth.password ?? '', ctx)
      return {
        text: `Basic ${toBase64(`${user.output}:${pass.output}`)}`,
        missing: [...user.missing, ...pass.missing],
      }
    }
    return null
  })()

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <div className="flex items-center gap-3">
        <label className="text-[10px] font-semibold tracking-wider text-ink-faint uppercase">
          Type
        </label>
        {/* same language as the method picker: overlaid chevron, not background-image */}
        <div className="relative">
          <select
            value={auth.type}
            onChange={(e) => onChange({ ...auth, type: e.target.value as RequestAuth['type'] })}
            className="cursor-pointer appearance-none rounded-md border border-line bg-app py-1.5 pr-8 pl-3 text-sm font-medium text-ink focus:border-brand focus:outline-none"
          >
            {(['none', 'bearer', 'basic'] as const).map((t) => (
              <option key={t} value={t}>
                {AUTH_LABEL[t]}
              </option>
            ))}
          </select>
          <ChevronDown
            aria-hidden
            className="pointer-events-none absolute top-1/2 right-2.5 size-3 -translate-y-1/2 text-ink-faint"
          />
        </div>
      </div>

      {auth.type === 'none' && (
        <p className="rounded-md border border-dashed border-line px-3 py-4 text-center text-sm leading-relaxed text-ink-faint">
          This request goes without an <span className="font-mono">Authorization</span> header.
          <br />
          Pick a type above, or write the header in the Headers tab.
        </p>
      )}

      {auth.type === 'bearer' && (
        <AuthField
          label="Token"
          value={auth.token ?? ''}
          onChange={(token) => onChange({ ...auth, token })}
          ctx={ctx}
          placeholder="{{ token }}"
        />
      )}

      {auth.type === 'basic' && (
        <div className="flex flex-col gap-2">
          <AuthField
            label="Username"
            value={auth.username ?? ''}
            onChange={(username) => onChange({ ...auth, username })}
            ctx={ctx}
            placeholder="{{ user }}"
          />
          <AuthField
            label="Password"
            value={auth.password ?? ''}
            onChange={(password) => onChange({ ...auth, password })}
            ctx={ctx}
            placeholder="{{ password }}"
          />
        </div>
      )}

      {preview && (
        <div className="flex flex-col gap-1.5">
          <div className="grid grid-cols-[88px_minmax(0,1fr)] items-start gap-3">
            <span className="pt-1.5 text-[10px] font-semibold tracking-wider text-ink-faint uppercase">
              Sends
            </span>
            <div className="flex min-w-0 items-center gap-1 rounded-md border border-line-soft bg-app px-3 py-1.5">
              {preview.missing.length > 0 ? (
                <p className="min-w-0 flex-1 font-mono text-sm text-bad">
                  missing variables: {preview.missing.join(', ')}
                </p>
              ) : (
                <>
                  <p className="min-w-0 flex-1 truncate font-mono text-sm text-ink-dim">
                    <span className="text-ink-faint">Authorization: </span>
                    {revealed ? preview.text : preview.text.replace(/\S/g, '•').slice(0, 44)}
                  </p>
                  <button
                    onClick={() => setRevealed((r) => !r)}
                    className="shrink-0 text-ink-faint transition hover:text-ink"
                    title={revealed ? 'Hide the value sent' : 'Show the value sent'}
                    aria-label={revealed ? 'Hide the value sent' : 'Show the value sent'}
                  >
                    {revealed ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                  </button>
                </>
              )}
            </div>
          </div>
          <p className="pl-[100px] text-sm text-ink-faint">
            A manual <span className="font-mono">Authorization</span> header in the Headers tab
            takes precedence.
          </p>
        </div>
      )}
    </div>
  )
}

export function RequestPanel({ request }: { request: ApiRequest }) {
  const updateRequest = useStore((s) => s.updateRequest)
  const pushHistory = useStore((s) => s.pushHistory)
  const collections = useStore((s) => s.collections)
  const base = useBaseEnv()
  const active = useActiveEnv()
  const setResponse = useSession((s) => s.setResponse)
  const setSending = useSession((s) => s.setSending)
  const sending = useSession((s) => s.sending[request.id] ?? false)
  const order = useLayout((s) => s.requestTabs)
  const moveRequestTab = useLayout((s) => s.moveRequestTab)
  const [tab, setTab] = useState<Tab>('params')
  /** Tab being dragged; dataTransfer cannot be read during dragover. */
  const [dragging, setDragging] = useState<Tab | null>(null)
  // The :params come from the URL, not from a separate list.
  const pathNames = extractPathParams(request.url)
  const [copied, setCopied] = useState(false)

  const ctx = buildContext(base, active)
  const resolved = resolveRequest(request, base, active)
  const folder = collections.find((c) => c.id === request.collectionId)?.name

  const send = async () => {
    if (sending || !request.url.trim()) return
    const final = resolveRequest(request, base, active)
    const contentType = BODY_CONTENT_TYPE[request.bodyType]
    if (
      final.body !== null &&
      contentType &&
      !final.headers.some((h) => h.key.toLowerCase() === 'content-type')
    ) {
      final.headers.push({ key: 'Content-Type', value: contentType })
    }
    setSending(request.id, true)
    let result = await sendRequest(final)
    // Failed with no response (CORS, offline)? With a sync key at hand, retry
    // through the server proxy, which CORS does not affect.
    const key = useStore.getState().connection.key
    if (!result.ok && result.network && key) {
      result = await api.proxy(key, final)
    }
    setSending(request.id, false)
    setResponse(request.id, result)
    if (result.ok) {
      pushHistory({
        requestId: request.id,
        method: final.method,
        url: final.url,
        status: result.status,
        statusText: result.statusText,
        timeMs: result.timeMs,
        sizeBytes: result.sizeBytes,
        headers: result.headers,
        body: result.body,
      })
    }
  }

  const copyCurl = async () => {
    await copyText(toCurl(resolveRequest(request, base, active)))
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const badge: Record<Tab, { label: string; count?: number; dot?: boolean }> = {
    params: {
      label: 'Params',
      count: request.queryParams.filter((p) => p.enabled).length + pathNames.length,
    },
    headers: { label: 'Headers', count: request.headers.filter((h) => h.enabled).length },
    auth: { label: 'Auth', dot: !!request.auth && request.auth.type !== 'none' },
    body: { label: 'Body', dot: request.bodyType !== 'none' },
  }

  return (
    <section className="flex h-full min-w-0 flex-col bg-panel">
      {/* trail: folder › request name */}
      <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-line px-3 text-sm">
        {folder && (
          <>
            <span className="text-ink-faint">{folder}</span>
            <span className="text-ink-faint">›</span>
          </>
        )}
        <input
          value={request.name}
          spellCheck={false}
          onChange={(e) => updateRequest(request.id, { name: e.target.value })}
          className="min-w-0 flex-1 rounded bg-transparent px-1 py-0.5 text-ink hover:bg-raised focus:bg-raised focus:outline-none"
        />
      </div>

      <div className="flex flex-col gap-2 p-3">
        {/* connected group: method · url · send */}
        <div className="flex items-stretch overflow-hidden rounded-md border border-line bg-app focus-within:border-brand">
          {/* the chevron is an overlaid icon, not a background-image, so it follows the theme */}
          <div className="relative shrink-0 border-r border-line bg-raised">
            <select
              value={request.method}
              onChange={(e) => updateRequest(request.id, { method: e.target.value as HttpMethod })}
              className={`h-full cursor-pointer appearance-none bg-transparent py-2 pr-7 pl-3 font-mono text-sm font-bold focus:outline-none ${METHOD_TEXT[request.method]}`}
            >
              {METHODS.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
            <ChevronDown
              aria-hidden
              className="pointer-events-none absolute top-1/2 right-2 size-3 -translate-y-1/2 text-ink-faint"
            />
          </div>
          <div className="min-w-0 flex-1">
            <TemplateInput
              value={request.url}
              onChange={(url) => updateRequest(request.id, { url })}
              ctx={ctx}
              placeholder="{{ base_url }}/v1/resource"
            />
          </div>
          <button
            onClick={send}
            disabled={sending || !request.url.trim()}
            className="flex shrink-0 items-center gap-1.5 bg-brand px-5 text-sm font-semibold text-white transition hover:bg-brand-hi disabled:cursor-not-allowed disabled:opacity-40"
          >
            {sending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Send className="size-4" />
            )}
            Send
          </button>
        </div>

        {/* url resolved in the active environment */}
        <div className="flex items-center gap-2 rounded-md border border-line-soft bg-app px-2.5 py-1.5">
          <span className="shrink-0 font-mono text-[10px] tracking-wider text-ink-faint uppercase">
            Final URL
          </span>
          <span className="min-w-0 flex-1 truncate font-mono text-sm">
            {resolved.missing.length > 0 ? (
              <span className="text-bad">
                missing variables: {resolved.missing.join(', ')}
              </span>
            ) : (
              <span className="text-ink-dim" title={resolved.url}>
                {resolved.url || '—'}
              </span>
            )}
          </span>
          <button
            onClick={copyCurl}
            className="shrink-0 rounded px-1.5 py-0.5 text-xs text-ink-faint transition hover:bg-raised hover:text-ink"
            title="Copy as a curl command (with variables resolved)"
          >
            {copied ? (
              <span className="flex items-center gap-1">
                <Check className="size-3" />
                Copied
              </span>
            ) : (
              'cURL'
            )}
          </button>
        </div>
      </div>

      {/* tabs — draggable, and the order is saved */}
      <div className="flex shrink-0 gap-4 border-b border-line px-4">
        {order.map((id) => {
          const t = badge[id]
          return (
            <button
              key={id}
              draggable
              onDragStart={(e) => {
                setDragging(id)
                e.dataTransfer.effectAllowed = 'move'
                // Firefox needs a payload or the drag never starts.
                e.dataTransfer.setData('text/plain', id)
              }}
              onDragEnd={() => setDragging(null)}
              onDragOver={(e) => {
                if (!dragging) return
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
              }}
              onDrop={(e) => {
                e.preventDefault()
                if (dragging) moveRequestTab(dragging, id)
                setDragging(null)
              }}
              onClick={() => setTab(id)}
              title="Drag to reorder"
              className={`-mb-px flex cursor-pointer items-center gap-1.5 border-b-2 py-2 text-sm font-medium transition ${
                tab === id
                  ? 'border-brand text-ink'
                  : 'border-transparent text-ink-dim hover:text-ink'
              } ${dragging === id ? 'opacity-40' : ''}`}
            >
              {t.label}
              {t.count !== undefined && t.count > 0 && (
                <span className="rounded bg-raised px-1.5 py-px font-mono text-[10px] text-ink-dim">
                  {t.count}
                </span>
              )}
              {t.dot && <span className="size-1.5 rounded-full bg-get" />}
            </button>
          )
        })}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {tab === 'params' && (
          <div className="flex flex-col gap-5">
            {pathNames.length > 0 && (
              <PathParams
                names={pathNames}
                values={request.pathParams ?? []}
                onChange={(pathParams) => updateRequest(request.id, { pathParams })}
                ctx={ctx}
              />
            )}
            <KeyValueEditor
              items={request.queryParams}
              onChange={(queryParams) => updateRequest(request.id, { queryParams })}
              ctx={ctx}
              keyPlaceholder="Query param"
            />
          </div>
        )}
        {tab === 'headers' && (
          <KeyValueEditor
            items={request.headers}
            onChange={(headers) => updateRequest(request.id, { headers })}
            ctx={ctx}
            keyPlaceholder="Header"
          />
        )}
        {tab === 'auth' && (
          <AuthEditor
            auth={request.auth ?? { type: 'none' }}
            onChange={(auth) => updateRequest(request.id, { auth })}
            ctx={ctx}
          />
        )}
        {tab === 'body' && (
          <div className="flex h-full flex-col gap-2">
            <div className="flex items-center gap-2">
              <div className="flex w-fit gap-0.5 rounded-md bg-app p-0.5">
                {BODY_TYPES.map((bt) => (
                  <button
                    key={bt}
                    onClick={() => updateRequest(request.id, changeBodyType(request, bt))}
                    className={`rounded px-3 py-1 text-sm transition ${
                      request.bodyType === bt ? 'bg-raised text-ink' : 'text-ink-dim hover:text-ink'
                    }`}
                  >
                    {BODY_LABEL[bt]}
                  </button>
                ))}
              </div>
              {request.bodyType === 'json' && (
                <button
                  onClick={() => {
                    try {
                      updateRequest(request.id, {
                        body: JSON.stringify(JSON.parse(request.body ?? ''), null, 2),
                      })
                    } catch {
                      /* invalid JSON (or with {{vars}}): leave it as is */
                    }
                  }}
                  className="ml-auto rounded px-2 py-1 text-sm text-ink-faint transition hover:bg-raised hover:text-ink"
                >
                  Format
                </button>
              )}
            </div>
            {request.bodyType === 'form' ? (
              <KeyValueEditor
                items={request.formBody ?? []}
                onChange={(formBody) => updateRequest(request.id, { formBody })}
                ctx={ctx}
                keyPlaceholder="Field"
              />
            ) : request.bodyType !== 'none' ? (
              <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-line bg-app">
                <CodeMirror
                  value={request.body ?? ''}
                  onChange={(body) => updateRequest(request.id, { body })}
                  extensions={[
                    ...(request.bodyType === 'json' ? [json()] : []),
                    EditorView.lineWrapping,
                    codeTheme,
                    // `{{ var }}` works in the body too, not just the URL.
                    templateVariables(ctx),
                  ]}
                  theme="none"
                  height="100%"
                  style={{ height: '100%' }}
                />
              </div>
            ) : (
              <p className="text-sm text-ink-faint">This request sends no body.</p>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
