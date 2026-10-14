/**
 * Маршруты и охрана (React Router 8, data mode).
 *
 * Охрана — middleware: функция, которая выполняется ДО того, как страница
 * начнёт загружаться. Нет сессии — redirect на вход (с адресом возврата).
 * Это защищает интерфейс, а не данные: данные защищает сервер (requireAuth).
 */
import {
  type MiddlewareFunction,
  createBrowserRouter,
  redirect,
} from "react-router";

import { BASE } from "@/auth/config";
import { bootstrapSession } from "@/auth/session";
import { getSession } from "@/auth/session-store";
import { AuthLayout } from "@/pages/auth/auth-layout";
import {
  ForgotPasswordPage,
  MagicLinkPage,
} from "@/pages/auth/email-request-page";
import { LoginPage } from "@/pages/auth/login-page";
import { MfaPage } from "@/pages/auth/mfa-page";
import { RegisterPage } from "@/pages/auth/register-page";
import { ResetPasswordPage } from "@/pages/auth/reset-password-page";
import { MagicLandingPage, VerifyEmailPage } from "@/pages/auth/token-landing";
import { ActivityPage } from "@/pages/account/activity-page";
import { AdminPage } from "@/pages/account/admin-page";
import { ProfilePage } from "@/pages/account/profile-page";
import { SecurityPage } from "@/pages/account/security-page";
import { SessionsPage } from "@/pages/account/sessions-page";
import { UnderTheHoodPage } from "@/pages/account/under-the-hood-page";
import { RomashkaAuthorizePage } from "@/pages/romashka/authorize-page";
import { RomashkaCallbackPage } from "@/pages/romashka/callback-page";

import { AppLayout } from "./app-layout";
import { RouteError } from "./route-error";

/** Только для вошедших. Сначала дождаться проверки сессии (refresh при старте). */
const requireUser: MiddlewareFunction = async ({ request }) => {
  await bootstrapSession();
  if (getSession().status !== "authenticated") {
    const url = new URL(request.url);
    const path = url.pathname.slice(BASE.length) || "/";
    throw redirect(`/login?next=${encodeURIComponent(path + url.search)}`);
  }
};

/** Только для администратора. Обычному пользователю — на главную. */
const requireAdmin: MiddlewareFunction = async () => {
  const session = getSession();
  if (session.status !== "authenticated" || session.user.role !== "admin")
    throw redirect("/");
};

/** Страницы входа вошедшему не нужны — сразу в кабинет. */
const guestOnly: MiddlewareFunction = async () => {
  await bootstrapSession();
  if (getSession().status === "authenticated") throw redirect("/");
};

// loader: () => null — у маршрута должен быть загрузчик, чтобы middleware
// гарантированно выполнялась при каждом переходе на него.
const noop = () => null;

/**
 * Роутер создаётся ФУНКЦИЕЙ, а не при импорте модуля. createBrowserRouter
 * сразу запускает первую навигацию — а с ней middleware и запрос refresh.
 * Если создать его при импорте, запрос уйдёт раньше, чем в main.tsx поднимется
 * демо-сервер (MSW), и получит 404 (урок в docs/lessons.md).
 */
export const createAppRouter = () =>
  createBrowserRouter(
    [
      {
        ErrorBoundary: RouteError,
        children: [
          {
            Component: AuthLayout,
            children: [
              {
                path: "login",
                middleware: [guestOnly],
                loader: noop,
                Component: LoginPage,
              },
              {
                path: "register",
                middleware: [guestOnly],
                loader: noop,
                Component: RegisterPage,
              },
              { path: "login/mfa", Component: MfaPage },
              { path: "magic-link", Component: MagicLinkPage },
              { path: "forgot-password", Component: ForgotPasswordPage },
              { path: "reset-password", Component: ResetPasswordPage },
              { path: "verify-email", Component: VerifyEmailPage },
              { path: "magic", Component: MagicLandingPage },
              { path: "auth/romashka", Component: RomashkaCallbackPage },
            ],
          },
          { path: "romashka/authorize", Component: RomashkaAuthorizePage },
          {
            path: "/",
            middleware: [requireUser],
            loader: noop,
            Component: AppLayout,
            children: [
              { index: true, Component: ProfilePage },
              { path: "security", Component: SecurityPage },
              { path: "sessions", Component: SessionsPage },
              { path: "activity", Component: ActivityPage },
              { path: "under-the-hood", Component: UnderTheHoodPage },
              {
                path: "admin",
                middleware: [requireAdmin],
                loader: noop,
                Component: AdminPage,
              },
            ],
          },
        ],
      },
    ],
    { basename: BASE || "/" },
  );
