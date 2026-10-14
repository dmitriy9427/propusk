/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** true — запущено с настоящим сервером (npm run dev:real), false — демо на MSW. */
  readonly VITE_REAL_SERVER: boolean
}
