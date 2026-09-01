import { useState } from 'react'
import { Check, ChevronDown, Eye, EyeOff, Loader2, Send } from 'lucide-react'
import CodeMirror from '@uiw/react-codemirror'
import { json } from '@codemirror/lang-json'
import {
  buildContext,
  resolveRequest,
  resolveTemplate,
  toCurl,
  type ApiRequest,
  type HttpMethod,
  type RequestAuth,
} from '@somnolent/core'
import { useActiveEnv, useBaseEnv, useStore } from '../store'
import { useSession } from '../sessionStore'
import { sendRequest } from '../lib/send'
import { api } from '../lib/api'
import { TemplateInput } from './TemplateInput'
import { KeyValueEditor } from './KeyValueEditor'
import { METHOD_TEXT } from '../lib/methodColors'

const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']
type Tab = 'params' | 'headers' | 'auth' | 'body'

const AUTH_LABEL: Record<RequestAuth['type'], string> = {
  none: 'Nenhuma',
  bearer: 'Bearer token',
  basic: 'Basic',
}

/** Base64 tolerante: token com acento faria o btoa estourar. */
function toBase64(text: string): string {
  try {
    return btoa(text)
  } catch {
    return '—'
  }
}

/** Uma linha rótulo + campo, no mesmo idioma das tabelas de variáveis. */
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
      {/* Sempre TemplateInput: o campo guarda o template, não o segredo — quem
          precisa de máscara é o valor resolvido, logo abaixo em "Envia". */}
      <div className="rounded-md border border-line bg-app focus-within:border-brand">
        <TemplateInput value={value} onChange={onChange} ctx={ctx} placeholder={placeholder} />
      </div>
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

  // O que vai sair no header, já resolvido no environment ativo.
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
          Tipo
        </label>
        {/* mesmo idioma do seletor de método: chevron sobreposto, não background-image */}
        <div className="relative">
          <select
            value={auth.type}
            onChange={(e) => onChange({ ...auth, type: e.target.value as RequestAuth['type'] })}
            className="cursor-pointer appearance-none rounded-md border border-line bg-app py-1.5 pr-8 pl-3 text-xs font-medium text-ink focus:border-brand focus:outline-none"
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
        <p className="rounded-md border border-dashed border-line px-3 py-4 text-center text-xs leading-relaxed text-ink-faint">
          Esta request vai sem header <span className="font-mono">Authorization</span>.
          <br />
          Escolha um tipo acima, ou escreva o header na aba Headers.
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
            label="Usuário"
            value={auth.username ?? ''}
            onChange={(username) => onChange({ ...auth, username })}
            ctx={ctx}
            placeholder="{{ user }}"
          />
          <AuthField
            label="Senha"
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
              Envia
            </span>
            <div className="flex min-w-0 items-center gap-1 rounded-md border border-line-soft bg-app px-3 py-1.5">
              {preview.missing.length > 0 ? (
                <p className="min-w-0 flex-1 font-mono text-xs text-bad">
                  variáveis faltando: {preview.missing.join(', ')}
                </p>
              ) : (
                <>
                  <p className="min-w-0 flex-1 truncate font-mono text-xs text-ink-dim">
                    <span className="text-ink-faint">Authorization: </span>
                    {revealed ? preview.text : preview.text.replace(/\S/g, '•').slice(0, 44)}
                  </p>
                  <button
                    onClick={() => setRevealed((r) => !r)}
                    className="shrink-0 text-ink-faint transition hover:text-ink"
                    title={revealed ? 'Ocultar valor enviado' : 'Mostrar valor enviado'}
                    aria-label={revealed ? 'Ocultar valor enviado' : 'Mostrar valor enviado'}
                  >
                    {revealed ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                  </button>
                </>
              )}
            </div>
          </div>
          <p className="pl-[100px] text-xs text-ink-faint">
            Um header <span className="font-mono">Authorization</span> manual na aba Headers tem
            precedência.
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
  const [tab, setTab] = useState<Tab>('params')
  const [copied, setCopied] = useState(false)

  const ctx = buildContext(base, active)
  const resolved = resolveRequest(request, base, active)
  const folder = collections.find((c) => c.id === request.collectionId)?.name

  const send = async () => {
    if (sending || !request.url.trim()) return
    const final = resolveRequest(request, base, active)
    if (
      final.body !== null &&
      request.bodyType === 'json' &&
      !final.headers.some((h) => h.key.toLowerCase() === 'content-type')
    ) {
      final.headers.push({ key: 'Content-Type', value: 'application/json' })
    }
    setSending(request.id, true)
    let result = await sendRequest(final)
    // Falhou sem resposta (CORS, offline)? Com uma chave de sync em mãos,
    // tenta de novo pelo proxy do servidor, que não sofre CORS.
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
    const text = toCurl(resolveRequest(request, base, active))
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // Sem permissão de clipboard: fallback via textarea temporária.
      const ta = document.createElement('textarea')
      ta.value = text
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      ta.remove()
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const tabs: { id: Tab; label: string; count?: number; dot?: boolean }[] = [
    { id: 'params', label: 'Query', count: request.queryParams.filter((p) => p.enabled).length },
    { id: 'headers', label: 'Headers', count: request.headers.filter((h) => h.enabled).length },
    { id: 'auth', label: 'Auth', dot: !!request.auth && request.auth.type !== 'none' },
    { id: 'body', label: 'Body', dot: request.bodyType !== 'none' },
  ]

  return (
    <section className="flex h-full min-w-0 flex-col bg-panel">
      {/* trilha: pasta › nome da request */}
      <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-line px-3 text-xs">
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
        {/* grupo conectado: método · url · enviar */}
        <div className="flex items-stretch overflow-hidden rounded-md border border-line bg-app focus-within:border-brand">
          {/* o chevron é um ícone sobreposto, não background-image: assim segue o tema */}
          <div className="relative shrink-0 border-r border-line bg-raised">
            <select
              value={request.method}
              onChange={(e) => updateRequest(request.id, { method: e.target.value as HttpMethod })}
              className={`h-full cursor-pointer appearance-none bg-transparent py-2 pr-7 pl-3 font-mono text-xs font-bold focus:outline-none ${METHOD_TEXT[request.method]}`}
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
              placeholder="{{ base_url }}/v1/recurso"
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
            Enviar
          </button>
        </div>

        {/* url resolvida no environment ativo */}
        <div className="flex items-center gap-2 rounded-md border border-line-soft bg-app px-2.5 py-1.5">
          <span className="shrink-0 font-mono text-[10px] tracking-wider text-ink-faint uppercase">
            URL final
          </span>
          <span className="min-w-0 flex-1 truncate font-mono text-xs">
            {resolved.missing.length > 0 ? (
              <span className="text-bad">
                variáveis faltando: {resolved.missing.join(', ')}
              </span>
            ) : (
              <span className="text-ink-dim" title={resolved.url}>
                {resolved.url || '—'}
              </span>
            )}
          </span>
          <button
            onClick={copyCurl}
            className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-ink-faint transition hover:bg-raised hover:text-ink"
            title="Copiar como comando curl (com variáveis resolvidas)"
          >
            {copied ? (
              <span className="flex items-center gap-1">
                <Check className="size-3" />
                copiado
              </span>
            ) : (
              'cURL'
            )}
          </button>
        </div>
      </div>

      {request.description && (
        <p className="mx-3 -mt-1 mb-2 border-l-2 border-line pl-2 text-xs leading-relaxed text-ink-faint">
          {request.description}
        </p>
      )}

      {/* abas */}
      <div className="flex shrink-0 gap-4 border-b border-line px-4">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`-mb-px flex items-center gap-1.5 border-b-2 py-2 text-xs font-medium transition ${
              tab === t.id
                ? 'border-brand text-ink'
                : 'border-transparent text-ink-dim hover:text-ink'
            }`}
          >
            {t.label}
            {t.count !== undefined && t.count > 0 && (
              <span className="rounded bg-raised px-1.5 py-px font-mono text-[10px] text-ink-dim">
                {t.count}
              </span>
            )}
            {t.dot && <span className="size-1.5 rounded-full bg-get" />}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {tab === 'params' && (
          <KeyValueEditor
            items={request.queryParams}
            onChange={(queryParams) => updateRequest(request.id, { queryParams })}
            ctx={ctx}
            keyPlaceholder="param"
          />
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
                {(['none', 'json', 'text'] as const).map((bt) => (
                  <button
                    key={bt}
                    onClick={() =>
                      updateRequest(request.id, {
                        bodyType: bt,
                        body: bt === 'none' ? null : (request.body ?? ''),
                      })
                    }
                    className={`rounded px-3 py-1 text-xs transition ${
                      request.bodyType === bt ? 'bg-raised text-ink' : 'text-ink-dim hover:text-ink'
                    }`}
                  >
                    {bt}
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
                      /* JSON inválido (ou com {{vars}}): mantém como está */
                    }
                  }}
                  className="ml-auto rounded px-2 py-1 text-xs text-ink-faint transition hover:bg-raised hover:text-ink"
                >
                  formatar
                </button>
              )}
            </div>
            {request.bodyType !== 'none' ? (
              <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-line bg-app">
                <CodeMirror
                  value={request.body ?? ''}
                  onChange={(body) => updateRequest(request.id, { body })}
                  extensions={request.bodyType === 'json' ? [json()] : []}
                  theme="dark"
                  height="100%"
                  style={{ height: '100%' }}
                />
              </div>
            ) : (
              <p className="text-xs text-ink-faint">Esta request não envia body.</p>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
