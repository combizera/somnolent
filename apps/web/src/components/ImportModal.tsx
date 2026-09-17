import { useState } from 'react'
import {
  curlHeadersToKeyValues,
  curlQueryToKeyValues,
  importInsomniaExport,
  parseCurl,
} from '@somnolent/core'
import { useStore } from '../store'

interface Summary {
  format: string
  collections: number
  requests: number
  environments: number
  warnings: string[]
}

const FORMAT_LABEL: Record<string, string> = {
  'insomnia-v5': 'Insomnia v5 (YAML)',
  'insomnia-v4': 'Insomnia v4 (JSON)',
}

export function ImportModal({ onClose }: { onClose: () => void }) {
  const importData = useStore((s) => s.importData)
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [summary, setSummary] = useState<Summary | null>(null)

  const importCurl = (command: string) => {
    const parsed = parseCurl(command)
    const store = useStore.getState()
    const id = store.addRequest(null)
    let name = parsed.url
    try {
      name = new URL(parsed.url.replace(/\{\{[^}]*\}\}/g, 'x')).pathname || parsed.url
    } catch {
      // URL with an unresolved template: use the string itself as the name.
    }
    store.updateRequest(id, {
      name,
      method: parsed.method,
      url: parsed.url,
      headers: curlHeadersToKeyValues(parsed, () => crypto.randomUUID()),
      queryParams: curlQueryToKeyValues(parsed, () => crypto.randomUUID()),
      body: parsed.body,
      bodyType: parsed.bodyType,
    })
    onClose()
  }

  const doImport = async () => {
    const trimmed = text.trim()
    setError('')
    setBusy(true)
    try {
      if (trimmed.startsWith('curl')) {
        importCurl(trimmed)
        return
      }
      const result = await importInsomniaExport(trimmed, {
        projectId: useStore.getState().openProjectId ?? '',
        makeId: () => crypto.randomUUID(),
        now: () => new Date().toISOString(),
      })
      importData(result)
      setSummary({
        format: FORMAT_LABEL[result.format] ?? result.format,
        collections: result.collections.length,
        requests: result.requests.length,
        environments: result.environments.length,
        warnings: result.warnings,
      })
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Could not import. Paste an Insomnia export or a curl command.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex w-full max-w-xl flex-col gap-3 rounded-lg border border-line bg-panel p-5 shadow-2xl"
      >
        {summary ? (
          <>
            <div>
              <h2 className="text-sm font-semibold text-ink">Imported</h2>
              <p className="text-sm text-ink-faint">{summary.format}</p>
            </div>

            <div className="grid grid-cols-3 gap-2">
              {[
                { label: 'requests', value: summary.requests },
                { label: 'folders', value: summary.collections },
                { label: 'environments', value: summary.environments },
              ].map((item) => (
                <div
                  key={item.label}
                  className="rounded-md border border-line bg-app px-3 py-2 text-center"
                >
                  <p className="font-mono text-xl text-ink">{item.value}</p>
                  <p className="text-xs tracking-wider text-ink-faint uppercase">
                    {item.label}
                  </p>
                </div>
              ))}
            </div>

            {summary.warnings.length > 0 && (
              <div className="flex flex-col gap-1.5 rounded-md border border-warn/40 bg-warn/10 p-3">
                <p className="text-sm font-semibold text-warn">Worth checking</p>
                <ul className="flex flex-col gap-1">
                  {summary.warnings.map((w, i) => (
                    <li key={i} className="text-sm leading-relaxed text-ink-dim">
                      {w}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <button
              onClick={onClose}
              className="self-end rounded-md bg-brand px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-hi"
            >
              Close
            </button>
          </>
        ) : (
          <>
            <div>
              <h2 className="text-sm font-semibold text-ink">Import</h2>
              <p className="text-sm text-ink-faint">
                Paste an Insomnia export — <span className="text-ink-dim">v5 (YAML)</span> or{' '}
                <span className="text-ink-dim">v4 (JSON)</span> — or a{' '}
                <span className="text-ink-dim">curl command</span>. The format is detected
                on its own.
              </p>
            </div>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              spellCheck={false}
              placeholder={
                'type: collection.insomnia.rest/5.0\nname: My API\ncollection:\n  - url: ...\n\nor\n\ncurl -X POST https://api.com/login -d \'{...}\''
              }
              className="h-56 w-full resize-none rounded-md border border-line bg-app p-3 font-mono text-sm text-ink placeholder:text-ink-faint focus:border-brand focus:outline-none"
            />
            {error && <p className="text-sm leading-relaxed text-bad">{error}</p>}
            <div className="flex justify-end gap-2">
              <button
                onClick={onClose}
                className="rounded-md px-3 py-1.5 text-sm text-ink-dim transition hover:bg-raised hover:text-ink"
              >
                Cancel
              </button>
              <button
                onClick={doImport}
                disabled={!text.trim() || busy}
                className="rounded-md bg-brand px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-hi disabled:opacity-40"
              >
                {busy ? 'Importing…' : 'Import'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
