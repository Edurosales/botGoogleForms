import type { Metadata } from "next";
import SiteNav from "./SiteNav";

/**
 * Páginas de presentación por idioma (/en, /pt, /it, /fr) para que los
 * buscadores encuentren FormsBot en cada idioma. El español es la portada
 * (/). Cada una enlaza a la herramienta ya en su idioma (?lang=). Son
 * carpetas fijas (no una ruta dinámica) para que cualquier otra dirección
 * siga respondiendo un 404 real.
 */
const SITE = "https://bot-google-forms-servicio.vercel.app";
export type Lang = "en" | "pt" | "it" | "fr";


type Copy = {
  title: string;
  description: string;
  h1: string;
  lead: string;
  cta: string;
  stepsTitle: string;
  steps: [string, string][];
  featuresTitle: string;
  features: [string, string][];
  faqTitle: string;
  faq: [string, string][];
  fine: string;
};

const COPY: Record<Lang, Copy> = {
  en: {
    title: "FormsBot (Bot Forms) — Test your Google Form with automatic responses",
    description:
      "FormsBot, also known as Bot Forms, sends test responses to your own Google Form: random, fixed, by percentages or with AI, following each section's logic. Your first test is free.",
    h1: "Test your Google Form before you send it",
    lead: "FormsBot (Bot Forms) fills your own Google Form with test responses so you can check sections, required questions and charts before real people answer it.",
    cta: "Try it free",
    stepsTitle: "How it works",
    steps: [
      ["Paste the link", "Paste the public link of your Google Form. FormsBot reads every question, section and option."],
      ["Choose how to answer", "Random, fixed values, percentages per option or AI answers in English, Spanish, Portuguese, Italian or French."],
      ["Send and review", "Responses arrive in your form from the cloud. Check the summary, the section flow and export to Excel."],
    ],
    featuresTitle: "Why FormsBot",
    features: [
      ["Real section logic", "Each response follows the path a person would take: if an answer jumps to section 3, it goes there."],
      ["AI in 5 languages", "Open-ended answers written by AI in the language of your form."],
      ["Runs in the cloud", "Close the tab: sending keeps going and you get an email when it finishes."],
      ["Free first test", "Create an account with Google and try it free. Buy credits only if you need more."],
    ],
    faqTitle: "Frequently asked questions",
    faq: [
      ["Is FormsBot the same as Bot Forms?", "Yes. FormsBot is our name; many people search for it as Bot Forms, BotForms or Forms Bot."],
      ["Which forms can I use?", "Only your own forms or forms you have permission to test. FormsBot is a testing tool, not a way to inflate surveys."],
      ["How do I pay?", "With international cards (Visa, Mastercard, Amex, Diners) or Mercado Pago. Prices are in Peruvian soles; your bank converts them."],
    ],
    fine: "FormsBot is a tool for testing your own forms. It is not affiliated with Google.",
  },
  pt: {
    title: "FormsBot (Bot Forms) — Teste seu Google Form com respostas automáticas",
    description:
      "O FormsBot, também conhecido como Bot Forms, envia respostas de teste para o seu próprio Google Form: aleatórias, fixas, por porcentagens ou com IA, seguindo as seções. O primeiro teste é grátis.",
    h1: "Teste seu Google Form antes de enviá-lo",
    lead: "O FormsBot (Bot Forms) preenche o seu próprio Google Form com respostas de teste para você conferir seções, perguntas obrigatórias e gráficos antes que pessoas reais respondam.",
    cta: "Testar grátis",
    stepsTitle: "Como funciona",
    steps: [
      ["Cole o link", "Cole o link público do seu Google Form. O FormsBot lê cada pergunta, seção e opção."],
      ["Escolha como responder", "Aleatório, valores fixos, porcentagens por opção ou respostas com IA em português, espanhol, inglês, italiano ou francês."],
      ["Envie e confira", "As respostas chegam ao seu formulário pela nuvem. Veja o resumo, o fluxo das seções e exporte para Excel."],
    ],
    featuresTitle: "Por que o FormsBot",
    features: [
      ["Seções de verdade", "Cada resposta segue o caminho que uma pessoa seguiria: se uma resposta leva à seção 3, vai para lá."],
      ["IA em 5 idiomas", "Respostas abertas escritas por IA no idioma do seu formulário."],
      ["Funciona na nuvem", "Feche a aba: o envio continua e você recebe um e-mail quando terminar."],
      ["Primeiro teste grátis", "Crie sua conta com Google e teste grátis. Compre créditos só se precisar de mais."],
    ],
    faqTitle: "Perguntas frequentes",
    faq: [
      ["FormsBot é o mesmo que Bot Forms?", "Sim. FormsBot é o nosso nome; muita gente procura como Bot Forms, BotForms ou Forms Bot."],
      ["Quais formulários posso usar?", "Somente formulários próprios ou que você tem permissão para testar. O FormsBot é uma ferramenta de teste, não serve para inflar pesquisas."],
      ["Como pago?", "Com cartões internacionais (Visa, Mastercard, Amex, Diners) ou Mercado Pago. Os preços estão em soles peruanos; seu banco faz a conversão."],
    ],
    fine: "O FormsBot é uma ferramenta para testar seus próprios formulários. Não é afiliado ao Google.",
  },
  it: {
    title: "FormsBot (Bot Forms) — Prova il tuo Google Form con risposte automatiche",
    description:
      "FormsBot, conosciuto anche come Bot Forms, invia risposte di prova al tuo Google Form: casuali, fisse, in percentuale o con IA, seguendo le sezioni. La prima prova è gratis.",
    h1: "Prova il tuo Google Form prima di inviarlo",
    lead: "FormsBot (Bot Forms) compila il tuo Google Form con risposte di prova, così controlli sezioni, domande obbligatorie e grafici prima che rispondano persone reali.",
    cta: "Prova gratis",
    stepsTitle: "Come funziona",
    steps: [
      ["Incolla il link", "Incolla il link pubblico del tuo Google Form. FormsBot legge ogni domanda, sezione e opzione."],
      ["Scegli come rispondere", "Casuale, valori fissi, percentuali per opzione o risposte con IA in italiano, inglese, spagnolo, portoghese o francese."],
      ["Invia e controlla", "Le risposte arrivano al tuo modulo dal cloud. Controlla il riepilogo, il flusso delle sezioni ed esporta in Excel."],
    ],
    featuresTitle: "Perché FormsBot",
    features: [
      ["Sezioni reali", "Ogni risposta segue il percorso di una persona: se una risposta porta alla sezione 3, va lì."],
      ["IA in 5 lingue", "Risposte aperte scritte dall'IA nella lingua del tuo modulo."],
      ["Funziona nel cloud", "Chiudi la scheda: l'invio continua e ricevi un'email quando finisce."],
      ["Prima prova gratis", "Crea l'account con Google e prova gratis. Acquista crediti solo se te ne servono di più."],
    ],
    faqTitle: "Domande frequenti",
    faq: [
      ["FormsBot è lo stesso di Bot Forms?", "Sì. FormsBot è il nostro nome; molti lo cercano come Bot Forms, BotForms o Forms Bot."],
      ["Quali moduli posso usare?", "Solo moduli tuoi o che hai il permesso di provare. FormsBot è uno strumento di test, non serve a gonfiare sondaggi."],
      ["Come pago?", "Con carte internazionali (Visa, Mastercard, Amex, Diners) o Mercado Pago. I prezzi sono in soles peruviani; la conversione la fa la tua banca."],
    ],
    fine: "FormsBot è uno strumento per provare i propri moduli. Non è affiliato a Google.",
  },
  fr: {
    title: "FormsBot (Bot Forms) — Testez votre Google Form avec des réponses automatiques",
    description:
      "FormsBot, aussi appelé Bot Forms, envoie des réponses de test à votre propre Google Form : aléatoires, fixes, par pourcentages ou par IA, en suivant les sections. Le premier test est gratuit.",
    h1: "Testez votre Google Form avant de l'envoyer",
    lead: "FormsBot (Bot Forms) remplit votre propre Google Form avec des réponses de test pour vérifier les sections, les questions obligatoires et les graphiques avant que de vraies personnes répondent.",
    cta: "Essayer gratuitement",
    stepsTitle: "Comment ça marche",
    steps: [
      ["Collez le lien", "Collez le lien public de votre Google Form. FormsBot lit chaque question, section et option."],
      ["Choisissez comment répondre", "Aléatoire, valeurs fixes, pourcentages par option ou réponses par IA en français, anglais, espagnol, portugais ou italien."],
      ["Envoyez et vérifiez", "Les réponses arrivent dans votre formulaire depuis le cloud. Consultez le résumé, le parcours des sections et exportez vers Excel."],
    ],
    featuresTitle: "Pourquoi FormsBot",
    features: [
      ["Vraies sections", "Chaque réponse suit le chemin d'une personne : si une réponse mène à la section 3, elle y va."],
      ["IA en 5 langues", "Réponses ouvertes rédigées par l'IA dans la langue de votre formulaire."],
      ["Fonctionne dans le cloud", "Fermez l'onglet : l'envoi continue et vous recevez un e-mail à la fin."],
      ["Premier test gratuit", "Créez votre compte avec Google et testez gratuitement. Achetez des crédits seulement si besoin."],
    ],
    faqTitle: "Questions fréquentes",
    faq: [
      ["FormsBot est-il la même chose que Bot Forms ?", "Oui. FormsBot est notre nom ; beaucoup le cherchent sous Bot Forms, BotForms ou Forms Bot."],
      ["Quels formulaires puis-je utiliser ?", "Uniquement vos propres formulaires ou ceux que vous avez l'autorisation de tester. FormsBot est un outil de test, pas un moyen de gonfler des sondages."],
      ["Comment payer ?", "Par cartes internationales (Visa, Mastercard, Amex, Diners) ou Mercado Pago. Les prix sont en soles péruviens ; votre banque fait la conversion."],
    ],
    fine: "FormsBot est un outil pour tester vos propres formulaires. Il n'est pas affilié à Google.",
  },
};

const ALTERNATES = { es: `${SITE}/`, en: `${SITE}/en`, pt: `${SITE}/pt`, it: `${SITE}/it`, fr: `${SITE}/fr`, "x-default": `${SITE}/en` };

export function langMetadata(lang: Lang): Metadata {
  const c = COPY[lang];
  return {
    title: { absolute: c.title },
    description: c.description,
    keywords: ["FormsBot", "Bot Forms", "BotForms", "Forms Bot", "Google Forms", "Google Form test", "form testing"],
    alternates: { canonical: `${SITE}/${lang}`, languages: ALTERNATES },
    openGraph: { type: "website", title: c.title, description: c.description, url: `${SITE}/${lang}`, locale: lang, images: [`${SITE}/soft.png`] },
  };
}

export function LangLanding({ lang }: { lang: Lang }) {
  const c = COPY[lang];
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "SoftwareApplication",
        name: "FormsBot",
        alternateName: ["Bot Forms", "BotForms", "Forms Bot"],
        applicationCategory: "BusinessApplication",
        operatingSystem: "Web",
        inLanguage: lang,
        url: `${SITE}/${lang}`,
        description: c.description,
        offers: { "@type": "Offer", price: "0", priceCurrency: "PEN", description: c.features[3][1] },
      },
      {
        "@type": "FAQPage",
        inLanguage: lang,
        mainEntity: c.faq.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })),
      },
    ],
  };
  return (
    <main className="tool-page" lang={lang}>
      <SiteNav />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <div className="tool-wrap">
        <div className="intro">
          <h1>{c.h1}</h1>
          <p>{c.lead}</p>
          <p style={{ marginTop: 16 }}>
            <a className="b b-primary" href={`/?lang=${lang}`}>
              {c.cta}
            </a>
          </p>
        </div>
        <div className="sheet">
          <div className="sheet-body">
            <h2>{c.stepsTitle}</h2>
            <ol className="ref-steps">
              {c.steps.map(([h, p]) => (
                <li key={h}>
                  <b>{h}.</b> {p}
                </li>
              ))}
            </ol>
            <h2 style={{ marginTop: 24 }}>{c.featuresTitle}</h2>
            <ul className="ref-steps">
              {c.features.map(([h, p]) => (
                <li key={h}>
                  <b>{h}.</b> {p}
                </li>
              ))}
            </ul>
            <h2 style={{ marginTop: 24 }}>{c.faqTitle}</h2>
            {c.faq.map(([q, a]) => (
              <details key={q} className="group">
                <summary>
                  <b>{q}</b>
                </summary>
                <p className="fine">{a}</p>
              </details>
            ))}
            <p className="fine" style={{ marginTop: 20 }}>
              {c.fine}
            </p>
            <p style={{ marginTop: 12 }}>
              <a className="b b-primary" href={`/?lang=${lang}`}>
                {c.cta}
              </a>
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
