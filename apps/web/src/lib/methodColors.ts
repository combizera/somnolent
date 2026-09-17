/** Tone per HTTP method, shared by the sidebar and the request's method picker. */
export const METHOD_TEXT: Record<string, string> = {
  GET: 'text-get',
  POST: 'text-post',
  PUT: 'text-put',
  PATCH: 'text-patch',
  DELETE: 'text-delete',
  HEAD: 'text-plain',
  OPTIONS: 'text-plain',
}

export const METHOD_CHIP: Record<string, string> = {
  GET: 'bg-get/15 text-get',
  POST: 'bg-post/15 text-post',
  PUT: 'bg-put/15 text-put',
  PATCH: 'bg-patch/15 text-patch',
  DELETE: 'bg-delete/15 text-delete',
  HEAD: 'bg-plain/15 text-plain',
  OPTIONS: 'bg-plain/15 text-plain',
}

/** Short form so the chip fits the sidebar column. */
export const METHOD_SHORT: Record<string, string> = { OPTIONS: 'OPTS', DELETE: 'DEL' }
