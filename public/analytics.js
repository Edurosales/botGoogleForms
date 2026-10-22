// Google Analytics para las guías estáticas: mismo ID y mismo modo de
// consentimiento que el servicio (src/app/layout.tsx). Si el visitante ya
// aceptó cookies en el sitio, se respeta su elección.
(function () {
  var GA_ID = "G-4WCK4EME75";
  window.dataLayer = window.dataLayer || [];
  function gtag() { dataLayer.push(arguments); }
  window.gtag = window.gtag || gtag;
  window.gtag("consent", "default", {
    analytics_storage: "denied",
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
    wait_for_update: 500,
  });
  try {
    if (localStorage.getItem("formsbot-cookie-consent") === "accepted") {
      window.gtag("consent", "update", {
        analytics_storage: "granted",
        ad_storage: "granted",
        ad_user_data: "granted",
        ad_personalization: "granted",
      });
    }
  } catch (e) {}
  var s = document.createElement("script");
  s.async = true;
  s.src = "https://www.googletagmanager.com/gtag/js?id=" + GA_ID;
  document.head.appendChild(s);
  window.gtag("js", new Date());
  window.gtag("config", GA_ID);
})();
