/**
 * Кнопка «Почта» в углу экрана и выезжающая панель с письмами.
 * Новые письма считаются от момента последнего открытия (в sessionStorage).
 */
import { Mail as MailIcon, Trash2, X } from 'lucide-react'
import { useState } from 'react'

import { useClearMailbox, useMailbox } from './mail'
import s from './mail.module.css'

const SEEN_KEY = 'propusk:mail-seen'

export function MailButton() {
  const { data = [] } = useMailbox()
  const clear = useClearMailbox()
  const [open, setOpen] = useState(false)
  const [seen, setSeen] = useState(() => Number(sessionStorage.getItem(SEEN_KEY) ?? 0))
  const unread = data.filter((m) => m.createdAt > seen).length

  function toggle() {
    const now = Date.now()
    sessionStorage.setItem(SEEN_KEY, String(now))
    setSeen(now)
    setOpen(!open)
  }

  return (
    <>
      <button type="button" className={s.fab} onClick={toggle} aria-expanded={open} aria-controls="mailbox">
        <MailIcon aria-hidden /> Почта
        {unread > 0 && <span className={s.count}>{unread}</span>}
      </button>
      {open && (
        <aside id="mailbox" className={s.panel} aria-label="Демо-почта">
          <header className={s.head}>
            <b>Почта (демо)</b>
            <span>
              <button type="button" className={s.icon} onClick={() => void clear()} aria-label="Очистить почту" title="Очистить">
                <Trash2 />
              </button>
              <button type="button" className={s.icon} onClick={() => setOpen(false)} aria-label="Закрыть почту">
                <X />
              </button>
            </span>
          </header>
          {data.length === 0 ? (
            <p className={s.empty}>Писем пока нет. Зарегистрируйтесь или запросите вход по ссылке.</p>
          ) : (
            <ul className={s.list}>
              {data.map((mail) => (
                <li key={mail.id} className={s.mail}>
                  <div className={s.meta}>
                    <span>{mail.to}</span>
                    <time>{new Date(mail.createdAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</time>
                  </div>
                  <p className={s.subject}>{mail.subject}</p>
                  <p className={s.text}>{mail.text}</p>
                  {mail.link && (
                    <a href={mail.link} className={s.link}>
                      Открыть ссылку из письма →
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </aside>
      )}
    </>
  )
}
