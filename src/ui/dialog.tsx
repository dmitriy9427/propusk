/**
 * Модальное окно на нативном <dialog> (подробно — saldo/docs/code/02-modal.md):
 * фокус внутри, Esc закрывает, страница под окном недоступна с клавиатуры.
 */
import { X } from 'lucide-react'
import { type ReactNode, useEffect, useId, useRef } from 'react'

import s from './dialog.module.css'

export function Dialog({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) {
      dialog.showModal()
      dialog.querySelector<HTMLElement>('[data-autofocus]')?.focus()
    }
    if (!open && dialog.open) dialog.close()
  }, [open])
  return (
    <dialog ref={ref} className={s.dialog} aria-labelledby={titleId} onClose={onClose} onClick={(e) => e.target === e.currentTarget && onClose()}>
      {open && (
        <div className={s.box}>
          <header className={s.head}>
            <h2 id={titleId}>{title}</h2>
            <button type="button" className={s.close} onClick={onClose} aria-label="Закрыть">
              <X />
            </button>
          </header>
          {children}
        </div>
      )}
    </dialog>
  )
}
