import { isRouteErrorResponse, Link, useRouteError } from 'react-router'

export function RouteError() {
  const error = useRouteError()
  const notFound = isRouteErrorResponse(error) && error.status === 404
  return (
    <main style={{ display: 'grid', gap: 12, placeItems: 'center', minHeight: '70dvh', padding: 24, textAlign: 'center' }}>
      <h1>{notFound ? 'Страница не найдена' : 'Что-то сломалось'}</h1>
      <p style={{ color: 'var(--muted)' }}>{notFound ? 'Возможно, ссылка устарела.' : String((error as Error)?.message ?? error)}</p>
      <Link to="/">На главную</Link>
    </main>
  )
}
