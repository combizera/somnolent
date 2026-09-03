/**
 * Copia texto pro clipboard. O `navigator.clipboard` exige contexto seguro
 * (HTTPS ou localhost) e permissão; onde faltar, cai numa textarea temporária.
 */
export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    return
  } catch {
    // segue pro fallback
  }
  const ta = document.createElement('textarea')
  ta.value = text
  ta.setAttribute('readonly', '')
  ta.style.position = 'fixed'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  ta.select()
  document.execCommand('copy')
  ta.remove()
}
