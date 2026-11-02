/**
 * Idiomas de la interfaz: español (base), inglés, portugués, italiano y
 * francés. Se elige así: 1) lo que la persona eligió (cookie fb_lang),
 * 2) ?lang= en el enlace, 3) el país de su conexión, 4) el idioma del
 * navegador, 5) español. Los textos que aún no tienen traducción se muestran
 * en español (nunca una clave vacía).
 */
export const LOCALES = ["es", "en", "pt", "it", "fr"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "es";
export const LANG_COOKIE = "fb_lang";

export const LOCALE_LABEL: Record<Locale, string> = { es: "Español", en: "English", pt: "Português", it: "Italiano", fr: "Français" };
export const LOCALE_SHORT: Record<Locale, string> = { es: "ES", en: "EN", pt: "PT", it: "IT", fr: "FR" };

/** Idioma de las respuestas de la IA (códigos de SUPPORTED_LANGUAGES) según el de la interfaz. */
export const AI_LANGUAGE: Record<Locale, string> = { es: "español", en: "inglés", pt: "portugués", it: "italiano", fr: "francés" };

export function isLocale(v: unknown): v is Locale {
  return typeof v === "string" && (LOCALES as readonly string[]).includes(v);
}

const BY_COUNTRY: Record<string, Locale> = {
  BR: "pt", PT: "pt", AO: "pt", MZ: "pt", CV: "pt",
  IT: "it", SM: "it", VA: "it",
  FR: "fr", BE: "fr", LU: "fr", MC: "fr", SN: "fr", CI: "fr", CM: "fr", HT: "fr",
  US: "en", GB: "en", IE: "en", CA: "en", AU: "en", NZ: "en", IN: "en", ZA: "en", NG: "en", PH: "en", SG: "en", JM: "en",
};
const SPANISH = new Set(["PE", "MX", "AR", "CO", "CL", "VE", "EC", "GT", "CU", "BO", "DO", "HN", "PY", "SV", "NI", "CR", "PA", "UY", "PR", "ES", "GQ"]);

export function localeFromCountry(country: string | null | undefined): Locale | null {
  const c = (country || "").toUpperCase();
  if (SPANISH.has(c)) return "es";
  return BY_COUNTRY[c] ?? null;
}

export function localeFromAcceptLanguage(header: string | null | undefined): Locale | null {
  for (const part of (header || "").split(",")) {
    const code = part.trim().slice(0, 2).toLowerCase();
    if (isLocale(code)) return code;
  }
  return null;
}

type Entry = [es: string, en: string, pt: string, it: string, fr: string];
const IDX: Record<Locale, number> = { es: 0, en: 1, pt: 2, it: 3, fr: 4 };

/** Diccionario. {n}, {left}… se reemplazan con los valores que se pasen. */
const DICT = {
  // Menú
  "nav.tool": ["Herramienta", "Tool", "Ferramenta", "Strumento", "Outil"],
  "nav.buy": ["Comprar créditos", "Buy credits", "Comprar créditos", "Compra crediti", "Acheter des crédits"],
  "nav.about": ["Sobre FormsBot", "About FormsBot", "Sobre o FormsBot", "Info su FormsBot", "À propos de FormsBot"],
  "nav.login": ["Iniciar sesión", "Log in", "Entrar", "Accedi", "Se connecter"],
  "nav.signup": ["Registrarse", "Sign up", "Cadastrar-se", "Registrati", "S'inscrire"],
  "nav.account": ["Mi cuenta", "My account", "Minha conta", "Il mio account", "Mon compte"],
  "nav.yourAccount": ["Tu cuenta", "Your account", "Sua conta", "Il tuo account", "Votre compte"],
  "nav.logout": ["Cerrar sesión", "Log out", "Sair", "Esci", "Se déconnecter"],
  "nav.loggingOut": ["Cerrando sesión…", "Logging out…", "Saindo…", "Uscita in corso…", "Déconnexion…"],
  "nav.credits": ["créditos", "credits", "créditos", "crediti", "crédits"],
  "nav.free": ["gratis", "free", "grátis", "gratis", "gratuites"],
  "nav.balanceTitle": ["Créditos comprados y respuestas gratis disponibles", "Purchased credits and free responses available", "Créditos comprados e respostas grátis disponíveis", "Crediti acquistati e risposte gratuite disponibili", "Crédits achetés et réponses gratuites disponibles"],
  "nav.invite": ["Invita y gana +{n}", "Invite & earn +{n}", "Convide e ganhe +{n}", "Invita e guadagna +{n}", "Invitez et gagnez +{n}"],
  "nav.language": ["Idioma", "Language", "Idioma", "Lingua", "Langue"],
  "nav.main": ["Principal", "Main", "Principal", "Principale", "Principal"],

  // Inicio
  "home.h1": ["Llena tu Google Form de prueba", "Test-fill your Google Form", "Preencha seu Google Form de teste", "Compila di prova il tuo Google Form", "Remplissez votre Google Form pour le tester"],
  "home.lead": [
    "Pega el link, revisa cómo se responde cada pregunta y envía. Tu primera vez es gratis.",
    "Paste the link, check how each question will be answered, and send. Your first time is free.",
    "Cole o link, veja como cada pergunta será respondida e envie. A primeira vez é grátis.",
    "Incolla il link, controlla come verrà risposta ogni domanda e invia. La prima volta è gratis.",
    "Collez le lien, vérifiez comment chaque question sera remplie et envoyez. La première fois est gratuite.",
  ],
  "home.how": ["Cómo funciona", "How it works", "Como funciona", "Come funziona", "Comment ça marche"],

  // Acceso
  "auth.tabs": ["Acceso", "Access", "Acesso", "Accesso", "Accès"],
  "auth.tabLogin": ["Iniciar sesión", "Log in", "Entrar", "Accedi", "Se connecter"],
  "auth.tabRegister": ["Crear cuenta", "Create account", "Criar conta", "Crea account", "Créer un compte"],
  "auth.welcome": ["Bienvenido de nuevo", "Welcome back", "Bem-vindo de volta", "Bentornato", "Bon retour"],
  "auth.loginOffer": [
    "Entra con la cuenta de Google con la que te registraste. No necesitas volver a aceptar nada.",
    "Log in with the Google account you signed up with. You don't need to accept anything again.",
    "Entre com a conta Google que você usou no cadastro. Não precisa aceitar nada de novo.",
    "Accedi con l'account Google con cui ti sei registrato. Non devi accettare nulla di nuovo.",
    "Connectez-vous avec le compte Google utilisé à l'inscription. Rien à accepter de nouveau.",
  ],
  "auth.loginBtn": ["Entrar con Google", "Log in with Google", "Entrar com Google", "Accedi con Google", "Se connecter avec Google"],
  "auth.continueBtn": ["Continuar con Google", "Continue with Google", "Continuar com Google", "Continua con Google", "Continuer avec Google"],
  "auth.firstTime": ["¿Primera vez en FormsBot?", "New to FormsBot?", "Primeira vez no FormsBot?", "Prima volta su FormsBot?", "Nouveau sur FormsBot ?"],
  "auth.createFree": ["Crea tu cuenta gratis", "Create your free account", "Crie sua conta grátis", "Crea il tuo account gratis", "Créez votre compte gratuit"],
  "auth.createOffer": [
    "Tu primera vez: <b>{n} respuestas gratis</b> en modo aleatorio o fijo. Solo pedimos tu cuenta de Google, sin contraseña.",
    "Your first time: <b>{n} free responses</b> in random or fixed mode. We only need your Google account, no password.",
    "Sua primeira vez: <b>{n} respostas grátis</b> no modo aleatório ou fixo. Só pedimos sua conta Google, sem senha.",
    "La prima volta: <b>{n} risposte gratuite</b> in modalità casuale o fissa. Serve solo il tuo account Google, senza password.",
    "Votre première fois : <b>{n} réponses gratuites</b> en mode aléatoire ou fixe. Seul votre compte Google est nécessaire, sans mot de passe.",
  ],
  "auth.point1": ["Las respuestas gratis son una sola vez por persona.", "Free responses are once per person.", "As respostas grátis são uma única vez por pessoa.", "Le risposte gratuite sono una sola volta per persona.", "Les réponses gratuites sont offertes une seule fois par personne."],
  "auth.point2": ["Con créditos comprados se activan las respuestas con IA y la fila prioritaria.", "Purchased credits unlock AI answers and the priority queue.", "Com créditos comprados você libera respostas com IA e a fila prioritária.", "Con i crediti acquistati si attivano le risposte con IA e la coda prioritaria.", "Les crédits achetés activent les réponses par IA et la file prioritaire."],
  "auth.createBtn": ["Crear cuenta con Google", "Sign up with Google", "Criar conta com Google", "Registrati con Google", "Créer un compte avec Google"],
  "auth.checkFirst": ["Marca la primera casilla para continuar. Las otras dos son opcionales.", "Tick the first box to continue. The other two are optional.", "Marque a primeira caixa para continuar. As outras duas são opcionais.", "Spunta la prima casella per continuare. Le altre due sono facoltative.", "Cochez la première case pour continuer. Les deux autres sont facultatives."],
  "auth.haveAccount": ["¿Ya tienes cuenta?", "Already have an account?", "Já tem conta?", "Hai già un account?", "Vous avez déjà un compte ?"],
  "auth.required": ["Obligatorio.", "Required.", "Obrigatório.", "Obbligatorio.", "Obligatoire."],
  "auth.optional": ["Opcional.", "Optional.", "Opcional.", "Facoltativo.", "Facultatif."],
  "auth.consentTerms": [
    "Tengo 16 años o más, acepto los <terms>términos del servicio</terms> y la <privacy>política de privacidad</privacy>, y solo usaré la herramienta con formularios propios o con permiso de su dueño.",
    "I am 16 or older, I accept the <terms>terms of service</terms> and the <privacy>privacy policy</privacy>, and I will only use the tool with my own forms or with the owner's permission.",
    "Tenho 16 anos ou mais, aceito os <terms>termos de serviço</terms> e a <privacy>política de privacidade</privacy>, e só usarei a ferramenta com formulários próprios ou com permissão do dono.",
    "Ho 16 anni o più, accetto i <terms>termini del servizio</terms> e l'<privacy>informativa sulla privacy</privacy>, e userò lo strumento solo con moduli miei o con il permesso del proprietario.",
    "J'ai 16 ans ou plus, j'accepte les <terms>conditions du service</terms> et la <privacy>politique de confidentialité</privacy>, et j'utiliserai l'outil uniquement avec mes propres formulaires ou avec l'accord de leur propriétaire.",
  ],
  "auth.consentMarketing": [
    "Quiero recibir por correo novedades y ofertas de FormsBot. Puedo darme de baja con un clic en cualquier correo.",
    "I want to receive FormsBot news and offers by email. I can unsubscribe with one click in any email.",
    "Quero receber novidades e ofertas do FormsBot por e-mail. Posso cancelar com um clique em qualquer e-mail.",
    "Voglio ricevere via email novità e offerte di FormsBot. Posso disiscrivermi con un clic in qualsiasi email.",
    "Je souhaite recevoir par e-mail les nouveautés et offres de FormsBot. Désinscription en un clic dans chaque e-mail.",
  ],
  "auth.consentCountry": [
    "Guardar mi país (según mi conexión) para estadísticas del servicio.",
    "Save my country (based on my connection) for service statistics.",
    "Salvar meu país (pela minha conexão) para estatísticas do serviço.",
    "Salvare il mio paese (in base alla connessione) per le statistiche del servizio.",
    "Enregistrer mon pays (selon ma connexion) pour les statistiques du service.",
  ],

  // Cookies
  "cookie.text": [
    "Usamos cookies necesarias para que el sitio funcione y, solo si aceptas, cookies de medición (Google Analytics) y de publicidad. Puedes rechazarlas sin perder ninguna función. Más en la <privacy>política de privacidad</privacy>.",
    "We use cookies needed for the site to work and, only if you accept, analytics (Google Analytics) and advertising cookies. You can reject them without losing any feature. More in the <privacy>privacy policy</privacy>.",
    "Usamos cookies necessários para o site funcionar e, só se você aceitar, cookies de medição (Google Analytics) e de publicidade. Você pode recusá-los sem perder nenhuma função. Mais na <privacy>política de privacidade</privacy>.",
    "Usiamo cookie necessari al funzionamento del sito e, solo se accetti, cookie di misurazione (Google Analytics) e pubblicitari. Puoi rifiutarli senza perdere alcuna funzione. Maggiori informazioni nell'<privacy>informativa sulla privacy</privacy>.",
    "Nous utilisons des cookies nécessaires au fonctionnement du site et, seulement si vous acceptez, des cookies de mesure (Google Analytics) et publicitaires. Vous pouvez les refuser sans perdre aucune fonction. Plus d'infos dans la <privacy>politique de confidentialité</privacy>.",
  ],
  "cookie.reject": ["Rechazar", "Reject", "Recusar", "Rifiuta", "Refuser"],
  "cookie.accept": ["Aceptar", "Accept", "Aceitar", "Accetta", "Accepter"],
  "cookie.label": ["Preferencias de cookies", "Cookie preferences", "Preferências de cookies", "Preferenze cookie", "Préférences de cookies"],

  // Soporte y chat
  "sup.support": ["Soporte", "Support", "Suporte", "Assistenza", "Support"],
  "sup.messages": ["Mensajes", "Messages", "Mensagens", "Messaggi", "Messages"],
  "sup.contact": ["Contactar a soporte", "Contact support", "Falar com o suporte", "Contatta l'assistenza", "Contacter le support"],
  "sup.newMsgs": ["Soporte, {n} mensajes nuevos", "Support, {n} new messages", "Suporte, {n} mensagens novas", "Assistenza, {n} nuovi messaggi", "Support, {n} nouveaux messages"],
  "sup.howHelp": ["¿Cómo prefieres que te ayudemos?", "How would you like us to help?", "Como prefere que ajudemos?", "Come preferisci che ti aiutiamo?", "Comment préférez-vous être aidé ?"],
  "sup.email": ["Correo", "Email", "E-mail", "Email", "E-mail"],
  "sup.title": ["Soporte FormsBot", "FormsBot Support", "Suporte FormsBot", "Assistenza FormsBot", "Support FormsBot"],
  "sup.subtitle": ["Te respondemos por aquí mismo", "We reply right here", "Respondemos por aqui mesmo", "Ti rispondiamo proprio qui", "Nous répondons ici même"],
  "sup.prevTitle": ["Chats anteriores", "Previous chats", "Conversas anteriores", "Chat precedenti", "Discussions précédentes"],
  "sup.prevSub": ["Se guardan al pasar 24 h sin mensajes", "Saved after 24 h without messages", "Salvas após 24 h sem mensagens", "Salvate dopo 24 h senza messaggi", "Enregistrées après 24 h sans message"],
  "sup.prevOne": ["Chat anterior", "Previous chat", "Conversa anterior", "Chat precedente", "Discussion précédente"],
  "sup.readOnly": ["solo lectura", "read only", "somente leitura", "sola lettura", "lecture seule"],
  "sup.back": ["Volver", "Back", "Voltar", "Indietro", "Retour"],
  "sup.close": ["Cerrar", "Close", "Fechar", "Chiudi", "Fermer"],
  "sup.loading": ["Cargando…", "Loading…", "Carregando…", "Caricamento…", "Chargement…"],
  "sup.emptyCan": ["¿En qué te ayudamos? Escribe tu consulta abajo.", "How can we help? Write your question below.", "Como podemos ajudar? Escreva sua dúvida abaixo.", "Come possiamo aiutarti? Scrivi la tua domanda qui sotto.", "Comment pouvons-nous vous aider ? Écrivez votre question ci-dessous."],
  "sup.emptyNew": ["Nueva conversación. Tus chats anteriores están en el ícono del reloj, arriba.", "New conversation. Your previous chats are under the clock icon above.", "Nova conversa. Suas conversas anteriores estão no ícone do relógio, acima.", "Nuova conversazione. Le chat precedenti sono nell'icona dell'orologio, in alto.", "Nouvelle discussion. Vos discussions précédentes sont sous l'icône de l'horloge, en haut."],
  "sup.emptyCant": ["Aún no tienes mensajes. Si necesitas ayuda, escríbenos por WhatsApp, Telegram o correo.", "No messages yet. If you need help, write to us on WhatsApp, Telegram or email.", "Ainda não há mensagens. Se precisar de ajuda, escreva pelo WhatsApp, Telegram ou e-mail.", "Ancora nessun messaggio. Se hai bisogno di aiuto, scrivici su WhatsApp, Telegram o email.", "Pas encore de messages. Besoin d'aide ? Écrivez-nous sur WhatsApp, Telegram ou par e-mail."],
  "sup.auto": ["FormsBot (automático)", "FormsBot (automatic)", "FormsBot (automático)", "FormsBot (automatico)", "FormsBot (automatique)"],
  "sup.closed": ["Conversación cerrada", "Conversation closed", "Conversa encerrada", "Conversazione chiusa", "Discussion fermée"],
  "sup.yourMsg": ["Tu mensaje", "Your message", "Sua mensagem", "Il tuo messaggio", "Votre message"],
  "sup.write": ["Escribe tu mensaje…", "Write your message…", "Escreva sua mensagem…", "Scrivi il tuo messaggio…", "Écrivez votre message…"],
  "sup.limit": ["Llegaste al máximo de mensajes de hoy", "You reached today's message limit", "Você atingiu o limite de mensagens de hoje", "Hai raggiunto il limite di messaggi di oggi", "Vous avez atteint la limite de messages du jour"],
  "sup.left": ["te quedan {left} de {per} mensajes hoy", "{left} of {per} messages left today", "restam {left} de {per} mensagens hoje", "ti restano {left} di {per} messaggi oggi", "il vous reste {left} sur {per} messages aujourd'hui"],
  "sup.send": ["Enviar", "Send", "Enviar", "Invia", "Envoyer"],
  "sup.sending": ["Enviando…", "Sending…", "Enviando…", "Invio…", "Envoi…"],
  "sup.activate": ["El chat se activa cuando intentas comprar créditos. Mientras tanto:", "Chat opens once you try to buy credits. Meanwhile:", "O chat é ativado quando você tenta comprar créditos. Enquanto isso:", "La chat si attiva quando provi ad acquistare crediti. Nel frattempo:", "Le chat s'active quand vous essayez d'acheter des crédits. En attendant :"],
  "sup.prevCount": ["Chats anteriores ({n})", "Previous chats ({n})", "Conversas anteriores ({n})", "Chat precedenti ({n})", "Discussions précédentes ({n})"],
  "sup.msgsN": ["{n} mensajes", "{n} messages", "{n} mensagens", "{n} messaggi", "{n} messages"],

  // Regalo (Invita y gana)
  "gift.btn": ["Gana <b>{n}</b> créditos invitando", "Earn <b>{n}</b> credits by inviting", "Ganhe <b>{n}</b> créditos convidando", "Guadagna <b>{n}</b> crediti invitando", "Gagnez <b>{n}</b> crédits en invitant"],
  "gift.title": ["Gana <b>{n} créditos</b> por cada amigo", "Earn <b>{n} credits</b> for each friend", "Ganhe <b>{n} créditos</b> por cada amigo", "Guadagna <b>{n} crediti</b> per ogni amico", "Gagnez <b>{n} crédits</b> par ami"],
  "gift.i1": ["Tu amigo se registra con tu enlace (vale {days} días).", "Your friend signs up with your link (valid {days} days).", "Seu amigo se cadastra com seu link (vale {days} dias).", "Il tuo amico si registra con il tuo link (valido {days} giorni).", "Votre ami s'inscrit avec votre lien (valable {days} jours)."],
  "gift.i2": ["Cuando hace su primera compra de {min} o más, tú ganas {a} y él {b} créditos.", "When they make a first purchase of {min} or more, you get {a} and they get {b} credits.", "Quando fizer a primeira compra de {min} ou mais, você ganha {a} e ele {b} créditos.", "Quando fa il primo acquisto di {min} o più, tu ricevi {a} e lui {b} crediti.", "Lors de son premier achat de {min} ou plus, vous recevez {a} et lui {b} crédits."],
  "gift.i3": ["Una sola vez por amigo; si la compra se devuelve, el premio se retira.", "Once per friend; if the purchase is refunded, the reward is removed.", "Uma vez por amigo; se a compra for reembolsada, o prêmio é retirado.", "Una sola volta per amico; se l'acquisto viene rimborsato, il premio viene ritirato.", "Une seule fois par ami ; si l'achat est remboursé, la récompense est retirée."],
  "gift.cta": ["Obtener mi enlace", "Get my link", "Obter meu link", "Ottieni il mio link", "Obtenir mon lien"],
  "gift.terms": ["Términos y condiciones", "Terms and conditions", "Termos e condições", "Termini e condizioni", "Conditions générales"],
  "gift.hide": ["No mostrar", "Don't show", "Não mostrar", "Non mostrare", "Ne plus afficher"],

  // Llegada por invitación
  "inv.new": [
    "<b>¡Te invitaron!</b> Crea tu cuenta y en tu primera compra de al menos {min} recibes <b>{n} créditos extra</b>.",
    "<b>You've been invited!</b> Create your account and get <b>{n} extra credits</b> on your first purchase of at least {min}.",
    "<b>Você foi convidado!</b> Crie sua conta e ganhe <b>{n} créditos extras</b> na primeira compra de pelo menos {min}.",
    "<b>Sei stato invitato!</b> Crea il tuo account e ricevi <b>{n} crediti extra</b> al primo acquisto di almeno {min}.",
    "<b>Vous avez été invité !</b> Créez votre compte et recevez <b>{n} crédits en plus</b> lors de votre premier achat d'au moins {min}.",
  ],
  "inv.old": [
    "<b>Esta invitación no es para ti:</b> solo vale para cuentas nuevas y tú ya tienes cuenta. Igual puedes ganar <b>{n} créditos</b> por cada amigo que invites.",
    "<b>This invitation isn't for you:</b> it only applies to new accounts and you already have one. You can still earn <b>{n} credits</b> for each friend you invite.",
    "<b>Este convite não é para você:</b> vale só para contas novas e você já tem conta. Mesmo assim pode ganhar <b>{n} créditos</b> por cada amigo convidado.",
    "<b>Questo invito non è per te:</b> vale solo per i nuovi account e tu ne hai già uno. Puoi comunque guadagnare <b>{n} crediti</b> per ogni amico invitato.",
    "<b>Cette invitation n'est pas pour vous :</b> elle ne vaut que pour les nouveaux comptes et vous en avez déjà un. Vous pouvez quand même gagner <b>{n} crédits</b> par ami invité.",
  ],
  "inv.create": ["Crear mi cuenta", "Create my account", "Criar minha conta", "Crea il mio account", "Créer mon compte"],
  "inv.conditions": ["Condiciones", "Conditions", "Condições", "Condizioni", "Conditions"],

  // Tienda
  "store.h1": ["Comprar créditos", "Buy credits", "Comprar créditos", "Acquista crediti", "Acheter des crédits"],
  "store.lead": [
    "Un crédito es una respuesta enviada. Con créditos comprados se activan las respuestas con IA, la fila prioritaria y los formularios de más de 30 preguntas.",
    "One credit is one response sent. Purchased credits unlock AI answers, the priority queue and forms with more than 30 questions.",
    "Um crédito é uma resposta enviada. Com créditos comprados você libera respostas com IA, a fila prioritária e formulários com mais de 30 perguntas.",
    "Un credito è una risposta inviata. Con i crediti acquistati si attivano le risposte con IA, la coda prioritaria e i moduli con più di 30 domande.",
    "Un crédit correspond à une réponse envoyée. Les crédits achetés activent les réponses par IA, la file prioritaire et les formulaires de plus de 30 questions.",
  ],
  "store.prices": [
    "Precios en soles peruanos (PEN). Aceptamos tarjetas internacionales; tu banco hace la conversión.",
    "Prices in Peruvian soles (PEN). International cards are accepted; your bank handles the conversion.",
    "Preços em soles peruanos (PEN). Aceitamos cartões internacionais; seu banco faz a conversão.",
    "Prezzi in soles peruviani (PEN). Accettiamo carte internazionali; la conversione la fa la tua banca.",
    "Prix en soles péruviens (PEN). Les cartes internationales sont acceptées ; votre banque fait la conversion.",
  ],
  "store.method": ["Medio de pago", "Payment method", "Forma de pagamento", "Metodo di pagamento", "Moyen de paiement"],
  "store.mpDesc": ["Tarjeta, Yape, PagoEfectivo o saldo de Mercado Pago", "Card, Yape, PagoEfectivo or Mercado Pago balance", "Cartão, Yape, PagoEfectivo ou saldo do Mercado Pago", "Carta, Yape, PagoEfectivo o saldo Mercado Pago", "Carte, Yape, PagoEfectivo ou solde Mercado Pago"],
  "store.card": ["Tarjeta", "Card", "Cartão", "Carta", "Carte"],
  "store.cardDesc": ["Visa, Mastercard, Amex, Diners (Izipay)", "Visa, Mastercard, Amex, Diners (Izipay)", "Visa, Mastercard, Amex, Diners (Izipay)", "Visa, Mastercard, Amex, Diners (Izipay)", "Visa, Mastercard, Amex, Diners (Izipay)"],
  "store.payMp": ["Pagar {amount} con Mercado Pago", "Pay {amount} with Mercado Pago", "Pagar {amount} com Mercado Pago", "Paga {amount} con Mercado Pago", "Payer {amount} avec Mercado Pago"],
  "store.payCard": ["Pagar {amount} con tarjeta", "Pay {amount} by card", "Pagar {amount} com cartão", "Paga {amount} con carta", "Payer {amount} par carte"],
  "store.preparing": ["Preparando el pago…", "Preparing payment…", "Preparando o pagamento…", "Preparazione del pagamento…", "Préparation du paiement…"],
  "store.paused": ["Compra pausada por hoy", "Purchases paused for today", "Compras pausadas por hoje", "Acquisti in pausa per oggi", "Achats suspendus pour aujourd'hui"],
  "store.loginToPay": ["Inicia sesión para pagar", "Log in to pay", "Entre para pagar", "Accedi per pagare", "Connectez-vous pour payer"],
  "store.choose": ["Elige un paquete", "Choose a package", "Escolha um pacote", "Scegli un pacchetto", "Choisissez un forfait"],
  "store.secure": ["Pago seguro y cifrado", "Secure, encrypted payment", "Pagamento seguro e criptografado", "Pagamento sicuro e crittografato", "Paiement sécurisé et chiffré"],

  // 404
  "nf.title": ["Esta página no existe", "This page doesn't exist", "Esta página não existe", "Questa pagina non esiste", "Cette page n'existe pas"],
  "nf.desc": ["Puede que el enlace esté mal escrito o que la página se haya movido.", "The link may be mistyped or the page may have moved.", "O link pode estar errado ou a página foi movida.", "Il link potrebbe essere errato o la pagina è stata spostata.", "Le lien est peut-être mal saisi ou la page a été déplacée."],
  "nf.tool": ["Ir a la herramienta", "Go to the tool", "Ir para a ferramenta", "Vai allo strumento", "Aller à l'outil"],

  // Campana
  "bell.title": ["Notificaciones", "Notifications", "Notificações", "Notifiche", "Notifications"],
  "bell.unread": ["Notificaciones, {n} sin leer", "Notifications, {n} unread", "Notificações, {n} não lidas", "Notifiche, {n} non lette", "Notifications, {n} non lues"],
  "bell.markRead": ["Marcar leídas", "Mark as read", "Marcar como lidas", "Segna come lette", "Marquer comme lues"],
  "bell.deleteAll": ["Borrar todas", "Delete all", "Apagar todas", "Elimina tutte", "Tout supprimer"],
  "bell.empty": ["No tienes notificaciones.", "You have no notifications.", "Você não tem notificações.", "Non hai notifiche.", "Vous n'avez aucune notification."],
  "bell.delete": ["Borrar notificación", "Delete notification", "Apagar notificação", "Elimina notifica", "Supprimer la notification"],
} satisfies Record<string, Entry>;

export type MsgKey = keyof typeof DICT;

/** Texto traducido con {variables}. Sin traducción → español. */
export function translate(locale: Locale, key: MsgKey, vars?: Record<string, string | number>): string {
  const entry = DICT[key] as Entry;
  let s = entry[IDX[locale]] || entry[0];
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}
