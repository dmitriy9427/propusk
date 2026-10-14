/**
 * Куда вернуть человека после входа: /login?next=/security.
 *
 * Ловушка «открытого редиректа»: если взять next как есть, злоумышленник
 * пришлёт ссылку /login?next=https://evil.example. Человек войдёт на НАСТОЯЩЕМ
 * сайте и тут же окажется на поддельном, где его попросят «ещё раз ввести
 * пароль». Поэтому принимаем только пути внутри сайта.
 */
export function safeNext(value: string | null | undefined): string {
  if (!value) return '/'
  // «/путь» — да; «//evil.example» (адрес без протокола) и «/\evil» — нет.
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return '/'
  return value
}
