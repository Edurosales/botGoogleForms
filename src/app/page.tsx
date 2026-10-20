import type { Metadata } from "next";
import Script from "next/script";

export const metadata: Metadata = {
  title: "FormsBot — Rellena Google Forms automáticamente con IA",
  description:
    "Bot que rellena Google Forms con respuestas reales usando IA. 50 respuestas en menos de 2 minutos. Servicio desde S/25 o software por S/300. Lima, Perú.",
  keywords:
    "rellenar google forms automaticamente, bot google forms, llenar formularios con IA, google forms bot peru",
  alternates: { canonical: "https://googleformsbot.vercel.app/" },
  openGraph: {
    type: "website",
    title: "FormsBot — Google Forms Bot con IA",
    description: "Rellena tu Google Form en segundos con IA. Respuestas reales, no genéricas.",
    url: "https://googleformsbot.vercel.app/",
    images: ["https://googleformsbot.vercel.app/soft.png"],
  },
};

export default function Home() {
  return (
    <>
      <header>
        <div className="w">
          <a className="logo" href="#">
            Forms<b>Bot</b>
          </a>
          <button
            className="menu-toggle"
            type="button"
            aria-controls="main-nav"
            aria-expanded="false"
            aria-label="Abrir menú"
          >
            <span></span>
            <span></span>
            <span></span>
          </button>
          <nav id="main-nav" aria-label="Principal">
            <a href="#como">Cómo funciona</a>
            <a href="guias.html">Guías</a>
            <a href="#precios">Precios</a>
            <a href="#faq">Preguntas</a>
            <a href="acerca-de.html">Acerca de</a>
            <a href="#contacto">Contacto</a>
            <a
              className="btn wa"
              href="https://wa.me/51935372306?text=Hola%2C%20quiero%20probar%20mi%20Google%20Form"
              target="_blank"
              rel="noopener"
            >
              WhatsApp
            </a>
          </nav>
        </div>
      </header>

      <main>
        <section className="hero">
          <div className="w">
            <div>
              <h1>Prueba tu Google Form con 50 respuestas reales antes de lanzarlo</h1>
              <p className="lead" style={{ marginTop: 18 }}>
                La IA contesta cada pregunta como una persona de verdad, no con «test123». Tú ves
                todo en tu Google Sheets en minutos.
              </p>
              <div className="cta">
                <a
                  className="btn wa"
                  href="https://wa.me/51935372306?text=Hola%2C%20quiero%20probar%20mi%20Google%20Form"
                  target="_blank"
                  rel="noopener"
                >
                  Pedir por WhatsApp
                </a>
                <a className="btn" href="#como">
                  Ver cómo funciona
                </a>
              </div>
              <div className="trust">
                <span>⚡ 50 respuestas en &lt;2 min</span>
                <span>🧠 IA que entiende el contexto</span>
                <span>📊 Directo a tu Sheets</span>
              </div>
            </div>
            <div className="mock" aria-hidden="true">
              <div className="bar">
                <span></span>
                <span></span>
                <span></span>
                <div className="url">docs.google.com/forms/d/e/.../viewform</div>
              </div>
              <div className="fld">
                <span>Nombre completo</span>
                <div className="in"></div>
              </div>
              <div className="fld">
                <span>¿Cómo calificarías el servicio?</span>
                <div className="opts">
                  <div className="rad on"></div>
                  <div className="rad"></div>
                  <div className="rad"></div>
                  <div className="rad"></div>
                </div>
              </div>
              <div className="fld">
                <span>Comentarios</span>
                <div className="in big"></div>
              </div>
              <div className="prog">
                <span></span>
              </div>
              <div className="stat">
                <b id="n">0</b> de 50 respuestas enviadas
              </div>
            </div>
          </div>
        </section>

        <section className="ad-section" aria-label="Publicidad">
          <div className="w">
            <p className="ad-label">Contenido patrocinado</p>
            <div className="ad-slot ad-slot-wide">
              <script async data-cfasync="false" src="https://abscloud.org/1/07db29a64bd7b48faed9a33e546f06d2"></script>
            </div>
            <a
              className="ad-direct-link"
              href="https://araplhn.org/4/1e40ef10fa915b77e0e219426d40ab27"
              target="_blank"
              rel="sponsored noopener"
            >
              Ver anuncio
            </a>
            <div className="ad-slot">
              <script async data-cfasync="false" src="https://bauval.org/14/782dacab651cd462139a728f471d7582"></script>
            </div>
            <div className="ad-slot ad-slot-wide">
              <script async data-cfasync="false" src="https://bauval.org/21/ff70015e1463c68e0f8c8477b447e1a4"></script>
              <div id="container-ff70015e1463c68e0f8c8477b447e1a4"></div>
            </div>
          </div>
        </section>

        <section id="como">
          <div className="w">
            <h2>Cómo funciona</h2>
            <p className="lead">Tres pasos. Sin complicaciones.</p>
            <ol className="steps">
              <li>
                <h3>Me mandas el link de tu form</h3>
                <p>Solo el link público de tu Google Form, por WhatsApp o Telegram, en menos de un minuto.</p>
              </li>
              <li>
                <h3>La IA genera respuestas reales</h3>
                <p>
                  El bot analiza cada pregunta y responde como una persona real. Puedes darle un
                  perfil: «actúa como empresario de 35 años». Nada de «John Doe / test@test.com».
                </p>
              </li>
              <li>
                <h3>Las respuestas llegan a tu Google Sheets</h3>
                <p>En minutos tienes todo en tu hoja de cálculo. Confirmas que funciona y lo lanzas con confianza.</p>
              </li>
            </ol>
          </div>
        </section>

        <section id="demo">
          <div className="w">
            <h2>El software en acción</h2>
            <p className="lead">Interfaz limpia, workers en paralelo y log completo de cada envío.</p>
            <figure>
              <img
                src="/soft.png"
                alt="Captura de FormsBot v6 con la lista de envíos y los workers en paralelo"
                loading="lazy"
              />
            </figure>
          </div>
        </section>

        <section id="features">
          <div className="w">
            <h2>Qué incluye el bot</h2>
            <p className="lead">No es un script. Es software de escritorio completo.</p>
            <dl className="feat">
              <div>
                <dt>IA con API integrada</dt>
                <dd>Conecta Groq (gratis), OpenAI u otros. Tú defines el perfil y la IA genera respuestas coherentes.</dd>
              </div>
              <div>
                <dt>Workers paralelos</dt>
                <dd>Múltiples envíos simultáneos. 50 respuestas en segundos.</dd>
              </div>
              <div>
                <dt>Multi-sección</dt>
                <dd>Formularios con varias páginas y saltos condicionales.</dd>
              </div>
              <div>
                <dt>Proxies opcionales</dt>
                <dd>Cada respuesta desde una IP diferente si lo necesitas.</dd>
              </div>
              <div>
                <dt>Captura por envío</dt>
                <dd>PNG automático de cada formulario enviado como comprobante.</dd>
              </div>
              <div>
                <dt>Exportar CSV / JSON</dt>
                <dd>Log completo de todos los envíos en el formato que prefieras.</dd>
              </div>
              <div>
                <dt>Cookies de Google</dt>
                <dd>Para formularios que exigen una cuenta de Google con sesión iniciada.</dd>
              </div>
              <div>
                <dt>Programar envíos</dt>
                <dd>Define la hora exacta. Modo secuencial o con intervalo.</dd>
              </div>
            </dl>
          </div>
        </section>

        <section className="editorial" id="guias">
          <div className="w">
            <span className="eyebrow">Centro de recursos</span>
            <h2>Aprende a validar tus formularios</h2>
            <p className="lead">
              Guías prácticas para mejorar tus encuestas antes de compartirlas. Todo el contenido
              está pensado para formularios propios y pruebas controladas.
            </p>
            <div className="articles">
              <article className="article-card">
                <span className="eyebrow">Diseño</span>
                <h3>Cómo probar un Google Form antes de lanzarlo</h3>
                <p>
                  Una lista de comprobación para detectar preguntas confusas, campos obligatorios y
                  saltos que no funcionan.
                </p>
                <a href="guia-probar-google-form.html">Leer la guía</a>
              </article>
              <article className="article-card">
                <span className="eyebrow">Datos</span>
                <h3>Cómo validar una encuesta con datos de prueba</h3>
                <p>
                  Aprende a distinguir una prueba técnica de una respuesta real y a documentar tus
                  resultados con claridad.
                </p>
                <a href="guia-datos-de-prueba.html">Leer la guía</a>
              </article>
              <article className="article-card">
                <span className="eyebrow">Sheets</span>
                <h3>Errores comunes al diseñar formularios</h3>
                <p>Los problemas que más afectan la calidad de las respuestas y cómo corregirlos antes de publicar.</p>
                <a href="guia-errores-formularios.html">Leer la guía</a>
              </article>
            </div>
            <div style={{ textAlign: "center", marginTop: 28 }}>
              <a
                className="btn"
                href="guias.html"
                style={{ background: "#5B21B6", color: "#fff", display: "inline-block" }}
              >
                Explorar las 9 guías y tutoriales completos →
              </a>
            </div>
          </div>
        </section>

        <section id="precios">
          <div className="w">
            <h2>Precios</h2>
            <p className="lead">
              Pago único en ambos casos. ¿Un formulario puntual? Elige el servicio. ¿Pruebas seguido?
              Te conviene el software.
            </p>
            <div className="plans">
              <div className="plan">
                <h3>Yo lo hago por ti</h3>
                <p>Me mandas el link, yo lleno tu form y ves los resultados en tu Sheets.</p>
                <a
                  className="pack"
                  href="https://wa.me/51935372306?text=Hola%2C%20quiero%20el%20pack%20de%2050%20respuestas"
                  target="_blank"
                  rel="noopener"
                >
                  <div>
                    <b>50 respuestas</b>
                    <small>Básico</small>
                  </div>
                  <span>S/ 25</span>
                </a>
                <a
                  className="pack pop"
                  href="https://wa.me/51935372306?text=Hola%2C%20quiero%20el%20pack%20de%20150%20respuestas"
                  target="_blank"
                  rel="noopener"
                >
                  <div>
                    <b>150 respuestas</b>
                    <small>Más pedido</small>
                  </div>
                  <span>S/ 60</span>
                </a>
                <a
                  className="pack"
                  href="https://wa.me/51935372306?text=Hola%2C%20quiero%20el%20pack%20de%20500%20respuestas"
                  target="_blank"
                  rel="noopener"
                >
                  <div>
                    <b>500 respuestas</b>
                    <small>Completo</small>
                  </div>
                  <span>S/ 180</span>
                </a>
                <p className="note">
                  Toca un pack y se abre WhatsApp con tu pedido listo. También por{" "}
                  <a href="https://t.me/onPowerTec" target="_blank" rel="noopener">
                    Telegram
                  </a>{" "}
                  o{" "}
                  <a href="mailto:edroservices@gmail.com?subject=Consulta%20sobre%20el%20servicio%20de%20FormsBot">
                    correo
                  </a>
                  .
                </p>
              </div>
              <div className="plan">
                <h3>El bot para ti</h3>
                <p>Licencia completa. Lo usas tú mismo, cuando quieras, sin límites.</p>
                <div className="price">
                  <sup>$</sup>99
                </div>
                <div className="once">Pago único · Sin mensualidad · Sin renovación</div>
                <ul>
                  <li>App de escritorio para Windows y Mac</li>
                  <li>IA con API (Groq)</li>
                  <li>Workers paralelos ilimitados</li>
                  <li>Proxies y cookies de Google</li>
                  <li>Exportar CSV y JSON</li>
                  <li>Sin límite de formularios</li>
                </ul>
                <a className="btn wa" href="https://licenses-forms.vercel.app/comprar" target="_blank" rel="noopener">
                  Comprar
                </a>
              </div>
            </div>
            <p className="note">
              Pago por Yape o Paypal. Confirmo el pago y te entrego el software o inicio el servicio de inmediato.
            </p>
          </div>
        </section>

        <section id="faq">
          <div className="w">
            <h2>Preguntas frecuentes</h2>
            <p className="lead">Lo que más me preguntan antes de comprar.</p>
            <div className="faq">
              <details>
                <summary>¿Las respuestas se ven reales o como bot?</summary>
                <p>
                  La IA analiza cada pregunta y genera respuestas coherentes. Puedes darle instrucciones
                  como «actúa como empresario de 35 años de Lima» y así van a sonar. Nada de «test123» ni
                  datos genéricos.
                </p>
              </details>
              <details>
                <summary>¿Funciona con cualquier Google Form?</summary>
                <p>
                  Sí. Formularios simples, multi-sección, con saltos condicionales, opción múltiple, texto
                  corto y largo, escalas y checkboxes. Si requiere cuenta de Google, también funciona con
                  cookies.
                </p>
              </details>
              <details>
                <summary>¿Con qué formularios trabajas?</summary>
                <p>
                  Solo con formularios tuyos o de tu organización. Antes de empezar confirmo que eres el
                  dueño y que aceptas los términos del servicio.
                </p>
              </details>
              <details>
                <summary>¿Cuánto demora el servicio?</summary>
                <p>
                  50 respuestas en menos de 2 minutos. 500 respuestas entre 5 y 15 minutos, según la
                  complejidad del form y la velocidad de la IA.
                </p>
              </details>
              <details>
                <summary>¿El software es para Windows o Mac?</summary>
                <p>Es compatible con Windows y macOS. Si tienes otra configuración, escríbeme antes de comprar y lo verificamos.</p>
              </details>
              <details>
                <summary>¿Cómo pago y cómo recibo el software?</summary>
                <p>Pago por Yape o Paypal. Confirmo el pago y te envío el software por Telegram o WhatsApp en minutos. Sin burocracia.</p>
              </details>
              <details>
                <summary>¿Qué necesito para usar la IA?</summary>
                <p>
                  El bot viene configurado con Groq, que es gratis. Creas una cuenta en console.groq.com,
                  copias tu API Key y la pegas en el software. También puedes usar OpenAI.
                </p>
              </details>
            </div>
          </div>
        </section>

        <section id="contacto">
          <div className="w">
            <h2>¿Listo para probarlo?</h2>
            <p className="lead">Elige el canal que prefieras. Te respondo personalmente.</p>
            <div className="ways">
              <a
                className="way wa"
                href="https://wa.me/51935372306?text=Hola%2C%20quiero%20probar%20mi%20Google%20Form"
                target="_blank"
                rel="noopener"
              >
                <b>WhatsApp</b>
                <small>La forma más rápida</small>
              </a>
              <a className="way" href="https://t.me/onPowerTec" target="_blank" rel="noopener">
                <b>Telegram</b>
                <small>@onPowerTec</small>
              </a>
              <a className="way" href="mailto:edroservices@gmail.com">
                <b>Correo</b>
                <small>edroservices@gmail.com</small>
              </a>
            </div>
            <form className="cf" id="cf">
              <h3>O déjame tu mensaje</h3>
              <label htmlFor="nombre">Tu nombre</label>
              <input id="nombre" name="nombre" autoComplete="name" required />
              <label htmlFor="need">¿Qué necesitas?</label>
              <select id="need" name="need">
                <option>Que llenen mi form (servicio)</option>
                <option>Quiero el software</option>
                <option>Tengo una duda</option>
              </select>
              <label htmlFor="msg">Mensaje (opcional)</label>
              <textarea id="msg" name="msg"></textarea>
              <button className="btn wa" type="submit">
                Enviar por WhatsApp
              </button>
            </form>
          </div>
        </section>
      </main>

      <footer>
        <p>
          FormsBot v6 · Lima, Perú · <a href="https://t.me/onPowerTec">@onPowerTec</a>
        </p>
        <p style={{ marginTop: 4 }}>© 2026 · Hecho por un dev peruano</p>
        <div className="footer-links">
          <a href="acerca-de.html">Acerca de</a>
          <a href="privacidad.html">Privacidad</a>
          <a href="terminos.html">Términos de uso</a>
          <a href="guias.html">Guías</a>
        </div>
      </footer>

      <div className="bar-m">
        <a
          className="btn wa"
          href="https://wa.me/51935372306?text=Hola%2C%20quiero%20probar%20mi%20Google%20Form"
          target="_blank"
          rel="noopener"
        >
          WhatsApp
        </a>
        <a className="btn" href="https://t.me/onPowerTec" target="_blank" rel="noopener">
          Telegram
        </a>
      </div>

      <div className="cookie" role="dialog" aria-label="Preferencias de cookies">
        <p>
          Usamos cookies necesarias y medición anónima para mejorar el sitio. Puedes consultar nuestra{" "}
          <a href="privacidad.html">política de privacidad</a>.
        </p>
        <button className="btn" type="button" data-cookie-accept="">
          Aceptar
        </button>
      </div>

      <Script src="/script.js" strategy="afterInteractive" />
    </>
  );
}
