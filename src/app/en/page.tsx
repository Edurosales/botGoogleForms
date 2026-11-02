import { LangLanding, langMetadata } from "../LangLanding";

export const metadata = langMetadata("en");

export default function Page() {
  return <LangLanding lang="en" />;
}
