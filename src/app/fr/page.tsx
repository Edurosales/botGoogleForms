import { LangLanding, langMetadata } from "../LangLanding";

export const metadata = langMetadata("fr");

export default function Page() {
  return <LangLanding lang="fr" />;
}
