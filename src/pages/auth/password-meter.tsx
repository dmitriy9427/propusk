import { passwordStrength } from '@shared/schemas.ts'

import s from './auth.module.css'

const LABELS = ['Слишком короткий', 'Слабый', 'Средний', 'Хороший', 'Отличный']
const COLORS = ['var(--danger)', 'var(--danger)', 'var(--warning)', 'var(--accent)', 'var(--accent)']

/** Полоска надёжности пароля. Подсказка, а не правило: решает сервер. */
export function PasswordMeter({ value }: { value: string }) {
  const score = passwordStrength(value)
  return (
    <div aria-live="polite">
      <div className={s.meter} style={{ '--meter': COLORS[score] } as React.CSSProperties} aria-hidden>
        {[1, 2, 3, 4].map((i) => (
          <span key={i} data-on={score >= i} />
        ))}
      </div>
      <span>
        {value ? LABELS[score] : 'Не короче 10 символов.'} Длинная фраза из нескольких слов надёжнее «Pa$$w0rd».
      </span>
    </div>
  )
}
