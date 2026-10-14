/**
 * Базовые детали интерфейса: кнопка, поле, карточка, сообщение, значок.
 * Устроены как в «Сальдо» (подробный разбор — saldo/docs/code/01-basics.md).
 */
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react'
import { type ComponentProps, type ReactNode, useId } from 'react'

import s from './ui.module.css'

export const cx = (...names: (string | false | null | undefined)[]) => names.filter(Boolean).join(' ')

interface ButtonProps extends ComponentProps<'button'> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost'
  loading?: boolean
  icon?: ReactNode
  block?: boolean
}

export function Button({ variant = 'secondary', loading, icon, block, className, children, disabled, ...props }: ButtonProps) {
  return (
    <button
      type="button"
      className={cx(s.button, variant !== 'secondary' && s[variant], block && s.block, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <span className={s.spinner} aria-hidden /> : icon}
      {children}
    </button>
  )
}

interface FieldProps {
  label: string
  error?: string
  hint?: ReactNode
  children: (a11y: { id: string; 'aria-invalid'?: boolean; 'aria-describedby'?: string }) => ReactNode
}

/** Подпись + поле + ошибка, связанные для скринридера (htmlFor, aria-invalid, aria-describedby). */
export function Field({ label, error, hint, children }: FieldProps) {
  const id = useId()
  const messageId = `${id}-message`
  return (
    <div className={s.field}>
      <label htmlFor={id} className={s.label}>
        {label}
      </label>
      {children({ id, 'aria-invalid': error ? true : undefined, 'aria-describedby': error || hint ? messageId : undefined })}
      {error ? (
        <p id={messageId} className={s.error} role="alert">
          {error}
        </p>
      ) : (
        hint && (
          <div id={messageId} className={s.hint}>
            {hint}
          </div>
        )
      )}
    </div>
  )
}

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input className={cx(s.input, className)} {...props} />
}

export function Card({ title, children, className, action }: { title?: ReactNode; children: ReactNode; className?: string; action?: ReactNode }) {
  return (
    <section className={cx(s.card, className)}>
      {(title || action) && (
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          {title && <h2 className={s.cardTitle}>{title}</h2>}
          {action}
        </header>
      )}
      {children}
    </section>
  )
}

const ALERT_ICONS = { info: Info, success: CheckCircle2, warning: AlertTriangle, danger: XCircle }

export function Alert({ tone = 'info', children }: { tone?: keyof typeof ALERT_ICONS; children: ReactNode }) {
  const Icon = ALERT_ICONS[tone]
  return (
    <div className={cx(s.alert, tone === 'danger' ? s.alertDanger : s[tone])} role={tone === 'danger' ? 'alert' : 'status'}>
      <Icon aria-hidden />
      <div>{children}</div>
    </div>
  )
}

export function Badge({ tone, children }: { tone?: 'ok' | 'warn' | 'danger'; children: ReactNode }) {
  return <span className={cx(s.badge, tone === 'ok' && s.badgeOk, tone === 'warn' && s.badgeWarn, tone === 'danger' && s.badgeDanger)}>{children}</span>
}
