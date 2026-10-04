(()=>{
const ins=[...document.querySelectorAll('.in')],sc=[...document.querySelectorAll('.scale i')],pr=document.querySelector('.prog span'),n=document.getElementById('n');
const data=['Camila Rojas Quispe','San Miguel, Lima','Atención rápida, volvería a comprar.'];
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function run(){
  for(;;){
    ins.forEach(element=>{element.textContent='';element.classList.remove('on')});sc.forEach(element=>element.classList.remove('sel'));pr.style.width='0';n.textContent='0';
    for(let i=0;i<3;i++){
      ins[i].classList.add('on');
      for(const character of data[i]){ins[i].textContent+=character;await sleep(38)}
      if(i===1){await sleep(300);sc[3].classList.add('sel')}
      await sleep(300);
    }
    for(let count=1;count<=50;count++){pr.style.width=count*2+'%';n.textContent=count;await sleep(35)}
    await sleep(2500);
  }
}
if(pr&&matchMedia('(prefers-reduced-motion:reduce)').matches){ins.forEach((element,index)=>element.textContent=data[index]);sc[3].classList.add('sel');pr.style.width='100%';n.textContent='50'}else if(pr){run()}

const mobileBar=document.querySelector('.bar-m');
if(mobileBar){
  const seen=new Set();
  const observer=new IntersectionObserver(entries=>{entries.forEach(entry=>entry.isIntersecting?seen.add(entry.target):seen.delete(entry.target));mobileBar.classList.toggle('off',seen.size>0)});
  ['.cta','#contacto'].forEach(selector=>{const element=document.querySelector(selector);if(element)observer.observe(element)});
}
let menuToggle=document.querySelector('.menu-toggle');
const mainNav=document.getElementById('main-nav')||document.querySelector('nav[aria-label="Principal"]');
if(mainNav&&!mainNav.id)mainNav.id='main-nav';
if(mainNav&&!menuToggle){
  menuToggle=document.createElement('button');
  menuToggle.className='menu-toggle';
  menuToggle.type='button';
  menuToggle.setAttribute('aria-controls','main-nav');
  menuToggle.setAttribute('aria-expanded','false');
  menuToggle.setAttribute('aria-label','Abrir menú');
  menuToggle.innerHTML='<span></span><span></span><span></span>';
  mainNav.parentElement.insertBefore(menuToggle,mainNav);
}
if(menuToggle&&mainNav){
  const closeMenu=()=>{menuToggle.setAttribute('aria-expanded','false');menuToggle.setAttribute('aria-label','Abrir menú');mainNav.classList.remove('open')};
  menuToggle.addEventListener('click',()=>{const isOpen=menuToggle.getAttribute('aria-expanded')==='true';menuToggle.setAttribute('aria-expanded',String(!isOpen));menuToggle.setAttribute('aria-label',isOpen?'Abrir menú':'Cerrar menú');mainNav.classList.toggle('open',!isOpen)});
  mainNav.querySelectorAll('a').forEach(link=>link.addEventListener('click',closeMenu));
  document.addEventListener('click',event=>{if(!mainNav.contains(event.target)&&!menuToggle.contains(event.target))closeMenu()});
  document.addEventListener('keydown',event=>{if(event.key==='Escape')closeMenu()});
}
const contactForm=document.getElementById('cf');
if(contactForm)contactForm.addEventListener('submit',event=>{event.preventDefault();const form=event.target;const message='Hola, soy '+form.nombre.value+'. Necesito: '+form.need.value+(form.msg.value?'. '+form.msg.value:'');window.open('https://wa.me/51935372306?text='+encodeURIComponent(message),'_blank','noopener')});

const cookieBanner=document.querySelector('.cookie');
const cookieButton=document.querySelector('[data-cookie-accept]');
if(cookieBanner&&cookieButton&&!localStorage.getItem('formsbot-cookie-consent')){cookieButton.addEventListener('click',()=>{localStorage.setItem('formsbot-cookie-consent','accepted');cookieBanner.hidden=true})}else if(cookieBanner){cookieBanner.hidden=true}
})();
