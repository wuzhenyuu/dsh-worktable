export type ModalFocusGuardOptions = {
  dialog: HTMLElement
  initialFocus: HTMLElement
  returnFocus: HTMLElement | null
  onEscape: () => void
  schedule?: (callback: () => void) => unknown
}

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'a[href]',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

/** Install the keyboard contract shared by the destructive confirmation. */
export function installModalFocusGuard(options: ModalFocusGuardOptions): () => void {
  const { dialog, initialFocus, returnFocus, onEscape } = options
  const ownerDocument = dialog.ownerDocument
  const schedule = options.schedule ?? ((callback: () => void) => window.requestAnimationFrame(callback))
  let active = true

  const focusable = (): HTMLElement[] => Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onEscape()
      return
    }
    if (event.key !== 'Tab') return
    const items = focusable()
    if (items.length === 0) {
      event.preventDefault()
      dialog.focus()
      return
    }
    const first = items[0]
    const last = items[items.length - 1]
    const current = ownerDocument.activeElement
    if (!dialog.contains(current)) {
      event.preventDefault()
      first.focus()
    } else if (event.shiftKey && current === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && current === last) {
      event.preventDefault()
      first.focus()
    }
  }

  ownerDocument.addEventListener('keydown', onKeyDown, true)
  schedule(() => { if (active && initialFocus.isConnected) initialFocus.focus() })
  return () => {
    active = false
    ownerDocument.removeEventListener('keydown', onKeyDown, true)
    schedule(() => { if (returnFocus?.isConnected) returnFocus.focus() })
  }
}
