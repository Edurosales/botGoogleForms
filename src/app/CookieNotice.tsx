"use client";

import { Rich, useLang } from "./LangProvider";

/** Aviso de cookies (los botones los maneja /script.js por sus data-*). */
export default function CookieNotice() {
  const { t } = useLang();
  return (
    <div className="cookie" role="dialog" aria-label={t("cookie.label")}>
      <p>
        <Rich text={t("cookie.text")} tags={{ privacy: (c) => <a href="/privacidad.html">{c}</a> }} />
      </p>
      <div className="cookie-actions">
        <button className="btn btn-ghost" type="button" data-cookie-reject="">
          {t("cookie.reject")}
        </button>
        <button className="btn" type="button" data-cookie-accept="">
          {t("cookie.accept")}
        </button>
      </div>
    </div>
  );
}
