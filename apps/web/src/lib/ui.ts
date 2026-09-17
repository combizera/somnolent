/** UI classes and helpers shared by the dialogs. */

/** Base for every form control. The height is fixed on purpose: input and select
 *  have different internal metrics and would never line up without it. */
export const controlClass =
  'h-9 w-full rounded-md border border-line bg-app px-3 text-sm text-ink transition focus:border-brand focus:outline-none'

export const inputClass = `${controlClass} placeholder:text-ink-faint`

/** Without `appearance-none` the browser draws its native select next to inputs
 *  in the app's tone; `Select` overlays the chevron. */
export const selectClass = `${controlClass} cursor-pointer appearance-none pr-8 hover:border-line-soft`

export const fieldLabel = 'text-xs font-semibold tracking-wider text-ink-faint uppercase'

/** Header controls share the dialog controls' `h-9` for the same reason, and the
 *  height lives here: per-component heights would drift apart again. */
export const headerGroup =
  'flex h-9 items-stretch overflow-hidden rounded-md border border-line focus-within:border-brand'

/** Standalone header button: square, icon only. */
export const headerButton =
  'flex h-9 items-center justify-center gap-1.5 rounded-md border border-line bg-panel px-2 text-ink-dim transition hover:bg-raised hover:text-ink'

/** Slice of the group holding icon + select; the left breathing room is what
 *  separates content from the group's border. */
export const headerGroupBody = 'flex items-center gap-2 border-r border-line bg-panel pr-1.5 pl-3.5'

/** Select inside a header group: no vertical padding, since the group owns the
 *  height, and full height so the hit area covers the control. */
export const headerSelect =
  'h-full cursor-pointer appearance-none bg-transparent pr-7 pl-0 text-sm font-medium text-ink focus:outline-none focus-visible:outline-none'

/** The key rides in the fragment: fragments reach neither the server nor its logs. */
export const linkFor = (key: string) => `${window.location.origin}/#k=${key}`
