"use client";

import Link from "next/link";
import { useLang } from "./LangProvider";

/** Encabezados de las páginas (el servidor no sabe el idioma; se traduce en el navegador). */
export function HomeIntro() {
  const { t } = useLang();
  return (
    <div className="intro">
      <h1>{t("home.h1")}</h1>
      <p>
        {t("home.lead")} <Link href="/sobre">{t("home.how")}</Link>
      </p>
    </div>
  );
}

export function SimpleIntro({ title, lead }: { title: string; lead?: string }) {
  const { tr } = useLang();
  return (
    <div className="intro">
      <h1>{tr(title)}</h1>
      {lead && <p>{tr(lead)}</p>}
    </div>
  );
}

export function StoreIntro() {
  const { t } = useLang();
  return (
    <div className="intro">
      <h1>{t("store.h1")}</h1>
      <p>{t("store.lead")}</p>
      <p className="fine">{t("store.prices")}</p>
    </div>
  );
}
