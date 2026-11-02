"use client";

import { useLang } from "./LangProvider";

/** Textos de la página 404 en el idioma de la persona. */
export default function NotFoundText({ part }: { part: "body" | "tool" | "account" }) {
  const { t } = useLang();
  if (part === "tool") return <>{t("nf.tool")}</>;
  if (part === "account") return <>{t("nav.account")}</>;
  return (
    <>
      <h1 style={{ margin: "6px 0 8px", fontSize: 22, lineHeight: 1.25 }}>{t("nf.title")}</h1>
      <p style={{ margin: "0 0 22px", color: "#4F4666", fontSize: 15, lineHeight: 1.5 }}>{t("nf.desc")}</p>
    </>
  );
}
