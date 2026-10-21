/**
 * Generador de datos aleatorios realistas SIN IA, por palabras clave en
 * el título de la pregunta. Puerto de app/core/data_gen.py (bot de
 * escritorio) — ahí es donde vivía esta lógica y nunca se había
 * portado al servicio web; "aleatorio" en preguntas de texto libre
 * (nombre, correo, edad, ciudad...) caía igual en la IA por no tener
 * de dónde sacar un valor sin ella.
 */

import type { ParsedQuestion } from "./formParser";

const NOMBRES_M = [
  "Miguel", "Carlos", "Juan", "Luis", "Pedro", "Jorge", "Fernando",
  "Ricardo", "Roberto", "Eduardo", "Gabriel", "Diego", "Alejandro",
  "Antonio", "Manuel", "Javier", "Marcos", "Andrés", "David", "Daniel",
  "Pablo", "Mario", "Sergio", "Raúl", "Ernesto", "Rodrigo", "Francisco",
  "Arturo", "Ignacio", "Héctor", "Oscar", "Gustavo", "Álvaro", "Adrián",
  "Iván", "Nicolás", "Santiago", "Sebastián", "Leonardo", "Felipe",
  "Jesús", "Rafael", "Enrique", "Víctor", "César", "Omar", "Rubén",
  "Lorenzo", "Joel", "Samuel", "Abraham", "Cristian", "Emilio", "Hugo",
  "Bryan", "Kevin", "Jonathan", "Erick", "William", "Christopher",
  "Alexis", "Jhon", "Steven", "Christian", "Michael", "Jefferson",
  "Anderson", "Darwin", "Wilmer", "Ramón", "Bernardo", "Claudio",
  "Edgardo", "Esteban", "Félix", "Gerardo", "Gilberto", "Gregorio",
  "Horacio", "Jaime", "Julio", "Leandro", "Martín", "Nelson",
  "Néstor", "Patricio", "Renato", "Rolando", "Tomás", "Ulises", "Xavier",
];

const NOMBRES_F = [
  "María", "Ana", "Laura", "Carmen", "Isabel", "Sandra", "Patricia",
  "Claudia", "Mónica", "Diana", "Gabriela", "Sofía", "Valentina",
  "Fernanda", "Camila", "Daniela", "Alejandra", "Paola", "Andrea",
  "Natalia", "Verónica", "Lucía", "Elena", "Rosa", "Cristina", "Silvia",
  "Beatriz", "Jimena", "Lorena", "Valeria", "Karla", "Rebeca", "Mariana",
  "Juliana", "Sara", "Yolanda", "Esperanza", "Gloria", "Marisol",
  "Liliana", "Irene", "Adriana", "Jessica", "Fabiola", "Ximena",
  "Brenda", "Erika", "Vanessa", "Melissa", "Carolina", "Michelle",
  "Stephanie", "Nicole", "Pamela", "Leslie", "Yesenia", "Wendy",
  "Keyla", "Dayana", "Nathaly", "Genesis", "Evelyn", "Estefany",
  "Angie", "Cindy", "Katherine", "Leidy", "Lizeth", "Nataly",
  "Amarilis", "Angélica", "Blanca", "Celia", "Consuelo",
  "Dolores", "Edith", "Estela", "Evangelina", "Florencia", "Graciela",
  "Inés", "Leticia", "Lourdes", "Magdalena", "Marta", "Mercedes",
  "Miriam", "Norma", "Olga", "Pilar", "Rosario", "Susana", "Teresa",
];

const NOMBRES = [...NOMBRES_M, ...NOMBRES_F];

const APELLIDOS = [
  "García", "Martínez", "López", "Rodríguez", "Pérez", "González",
  "Hernández", "Sánchez", "Ramírez", "Torres", "Flores", "Rivera",
  "Gómez", "Díaz", "Cruz", "Morales", "Reyes", "Gutiérrez", "Vargas",
  "Castillo", "Ramos", "Mendoza", "Jiménez", "Álvarez", "Rojas",
  "Romero", "Navarro", "Ortiz", "Delgado", "Fernández", "Ruiz",
  "Castro", "Vásquez", "Medina", "Aguilar", "Muñoz", "Mora", "Herrera",
  "Acosta", "Suárez", "Fuentes", "Ortega", "Lara", "Parra", "Salazar",
  "Campos", "Santos", "Miranda", "Guerrero", "Ríos", "Espinoza",
  "Molina", "Silva", "Paredes", "Serrano", "Peña", "Nieto", "Padilla",
  "Bravo", "Cabrera", "Restrepo", "Cárdenas", "Villanueva", "Quispe",
  "Mamani", "Chávez", "Sandoval", "Contreras", "Pacheco", "Vega",
  "Montes", "Ibarra", "Bermúdez", "Solano", "Figueroa", "Benavides",
  "Coronado", "Estrada", "Gallardo", "Henríquez", "Izquierdo", "León",
  "Meza", "Nava", "Ojeda", "Quintero", "Rosales", "Tapia", "Uribe",
  "Valencia", "Zamora", "Benítez", "Cortez", "Fuenmayor",
  "Garrido", "Iglesias", "Lozano", "Mena", "Ocampo", "Quiroz",
  "Rivas", "Soriano", "Trujillo", "Urbina", "Valenzuela", "Zapata",
  "Alonso", "Andrade", "Arias", "Barrios", "Bautista", "Beltrán",
  "Castañeda", "Ceballos", "Cordero", "Corona", "Cuéllar", "Duarte",
  "Escobar", "Espinal", "Farfán", "Franco", "Gallegos", "Giraldo",
  "Guzmán", "Heredia", "Hidalgo", "Huerta", "Jaramillo", "Linares",
  "Londoño", "Lucero", "Maldonado", "Montoya", "Navarrete", "Ochoa",
  "Olivares", "Orozco", "Palacios", "Pardo", "Peralta", "Pineda",
  "Ponce", "Prado", "Quintana", "Rangel", "Rendón", "Rincón",
  "Robles", "Rocha", "Roldán", "Salas", "Salcedo", "Salgado",
  "Sanabria", "Santana", "Sarmiento", "Segura", "Sierra", "Soto",
  "Téllez", "Tobar", "Trejo", "Valdés", "Vallejo", "Varela",
  "Velásquez", "Villegas", "Villalobos", "Yáñez", "Zambrano", "Zavala",
  "Zuleta", "Zúñiga", "Aguirre", "Alfaro", "Aragón", "Arce",
  "Arévalo", "Avila", "Balderas", "Ballesteros", "Barajas", "Barreto",
  "Becerra", "Berrío", "Blandón", "Bonilla", "Borbón", "Bustos",
  "Calderón", "Calvo", "Camacho", "Carbajal", "Carrasco", "Carrillo",
  "Carvajal", "Casas", "Castellanos", "Cedillo", "Centeno", "Cervantes",
  "Céspedes", "Chacón", "Cisneros", "Colón", "Conde", "Córdova",
  "Correa", "Cortés", "Cotto", "Cuenca", "Dávila",
];

const CIUDADES = [
  "Ciudad de México", "Buenos Aires", "Lima", "Bogotá", "Santiago",
  "Caracas", "Quito", "La Paz", "Montevideo", "Asunción", "San José",
  "Tegucigalpa", "Managua", "Guadalajara", "Monterrey", "Medellín",
  "Cali", "Rosario", "Córdoba", "Valparaíso", "Arequipa", "Guayaquil",
  "Barranquilla", "Cusco", "Cochabamba", "Santa Cruz", "Maracaibo",
  "Valencia", "Maracay", "Barquisimeto", "Mérida", "Puebla", "Tijuana",
  "Juárez", "Torreón", "Querétaro", "San Luis Potosí",
  "Cancún", "Acapulco", "Veracruz", "Chihuahua", "Hermosillo",
  "Trujillo", "Chiclayo", "Iquitos", "Pucallpa", "Huancayo", "Ica",
  "Cúcuta", "Bucaramanga", "Cartagena", "Pereira", "Manizales",
  "Concepción", "Viña del Mar", "Antofagasta", "Temuco", "La Serena",
];

const OCUPACIONES = [
  "Estudiante", "Maestro", "Ingeniero", "Médico", "Enfermero",
  "Contador", "Abogado", "Arquitecto", "Psicólogo", "Administrador",
  "Vendedor", "Diseñador gráfico", "Programador", "Electricista",
  "Mecánico", "Cocinero", "Periodista", "Trabajador independiente",
  "Comerciante", "Empresario", "Investigador", "Docente universitario",
  "Secretaria", "Recepcionista", "Auxiliar contable", "Técnico",
  "Plomero", "Carpintero", "Agricultor", "Ganadero", "Ama de casa",
];

const PAISES = [
  "México", "Colombia", "Argentina", "Perú", "Venezuela", "Chile",
  "Ecuador", "Guatemala", "Cuba", "Bolivia", "Honduras", "Paraguay",
  "El Salvador", "Nicaragua", "Costa Rica", "Panamá", "Uruguay",
  "República Dominicana", "Puerto Rico", "España",
];

const EMAIL_DOMAINS = [
  ...Array(14).fill("gmail.com"),
  "hotmail.com", "hotmail.com", "hotmail.com", "hotmail.es", "hotmail.es",
  "outlook.com", "outlook.com", "outlook.es",
  "yahoo.com", "yahoo.es",
  "live.com", "live.com.mx",
  "icloud.com",
];

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "");
}

const KW: Record<string, string[]> = {
  nombre_completo: [
    "nombre completo", "full name", "nombre y apellido",
    "nombre apellido", "tu nombre completo", "su nombre completo",
    "escribe tu nombre", "escribe su nombre", "nombre del encuestado",
    "nombre encuestado", "nombre de encuestado", "nombre del participante",
    "nombre participante", "nombre del entrevistado", "nombres y apellidos",
    "apellidos y nombres", "datos del encuestado", "persona encuestada",
    "nombre de la persona",
  ],
  nombre: [
    "nombre", "name", "nombres", "primer nombre", "first name",
    "como te llamas", "cual es tu nombre", "tu nombre", "su nombre",
    "encuestado", "participante", "entrevistado",
  ],
  apellido: [
    "apellido", "apellidos", "last name", "surname",
    "primer apellido", "segundo apellido", "tus apellidos",
    "sus apellidos", "apellidos del encuestado",
  ],
  edad: ["edad", "age", "cuantos años", "que edad", "tu edad", "su edad", "cual es tu edad"],
  email: [
    "email", "correo", "e-mail", "mail", "correo electronico",
    "tu correo", "su correo", "direccion de correo",
  ],
  ciudad: [
    "ciudad", "city", "municipio", "localidad", "residencia",
    "en que ciudad", "lugar de residencia", "donde vives",
    "donde resides", "ciudad de residencia", "lugar donde vives",
  ],
  pais: ["pais", "country", "nacion", "de que pais", "tu pais", "su pais", "nacionalidad"],
  ocupacion: [
    "ocupacion", "profesion", "trabajo", "cargo", "puesto", "empleo",
    "ocupas", "a que te dedicas", "cual es tu profesion", "cual es tu ocupacion",
  ],
  telefono: [
    "telefono", "celular", "phone", "movil",
    "numero de telefono", "numero de celular", "numero telefonico",
  ],
};

function matches(titleNorm: string, keys: string[]): boolean {
  return keys.some((k) => titleNorm.includes(normalize(k)));
}

class UniquePool {
  private remaining: string[] = [];
  constructor(private items: string[]) {}
  pick(): string {
    if (this.remaining.length === 0) {
      this.remaining = [...this.items].sort(() => Math.random() - 0.5);
    }
    return this.remaining.pop()!;
  }
}

/** Crea pools nuevos para una tanda de generación (sin repetir nombres/apellidos dentro de ella). */
export function createNameState() {
  const poolNombres = new UniquePool(NOMBRES);
  const poolApellidos = new UniquePool(APELLIDOS);
  const usedSurnames = new Set<string>();
  const emailsSeen = new Set<string>();

  function pickSurname(): string {
    let a = poolApellidos.pick();
    let guard = 0;
    while (usedSurnames.has(a.toLowerCase()) && guard++ < 50) a = poolApellidos.pick();
    usedSurnames.add(a.toLowerCase());
    return a;
  }

  function dosApellidos(): string {
    const a1 = pickSurname();
    let a2 = pickSurname();
    let guard = 0;
    while (a2.toLowerCase() === a1.toLowerCase() && guard++ < 50) a2 = pickSurname();
    return `${a1} ${a2}`;
  }

  function nombreCompleto(): string {
    return `${poolNombres.pick()} ${dosApellidos()}`;
  }

  function randomEmailFromName(nombre?: string): string {
    const raw = nombre && nombre.trim().length >= 3 ? nombre : nombreCompleto();
    const parts = normalize(raw).split(/\s+/).filter(Boolean);
    const n1 = parts[0] || "carlos";
    const a1 = parts[1] || normalize(poolApellidos.pick());
    const a2 = parts[2] || normalize(poolApellidos.pick());

    const birthYear = 1975 + Math.floor(Math.random() * 32);
    const shortYear = String(birthYear).slice(2);
    const day = 1 + Math.floor(Math.random() * 28);
    const month = 1 + Math.floor(Math.random() * 12);
    const numChoices = [
      "", "", "",
      shortYear, shortYear,
      String(birthYear),
      `${String(day).padStart(2, "0")}${String(month).padStart(2, "0")}`,
      String(1 + Math.floor(Math.random() * 99)),
      String(100 + Math.floor(Math.random() * 900)),
    ];
    const numSuffix = numChoices[Math.floor(Math.random() * numChoices.length)];

    for (let i = 0; i < 60; i++) {
      const domain = EMAIL_DOMAINS[Math.floor(Math.random() * EMAIL_DOMAINS.length)];
      const patterns = [
        `${n1}${a1}${numSuffix}`,
        `${n1}.${a1}${numSuffix}`,
        `${n1}_${a1}${numSuffix}`,
        `${n1}${a1[0]}${a2}${numSuffix}`,
        `${n1}.${a1[0]}.${a2}${numSuffix}`,
        `${n1[0]}${a1}${numSuffix}`,
        `${n1[0]}.${a1}${numSuffix}`,
        `${a1}.${n1}${numSuffix}`,
        `${n1}-${a1}${numSuffix}`,
      ];
      let user = patterns[Math.floor(Math.random() * patterns.length)]
        .toLowerCase()
        .replace(/[^a-z0-9._-]/g, "")
        .replace(/^[._-]+|[._-]+$/g, "");
      if (user.length < 4) user += String(10 + Math.floor(Math.random() * 90));
      const email = `${user}@${domain}`;
      if (!emailsSeen.has(email)) {
        emailsSeen.add(email);
        return email;
      }
    }
    const ts = String(Date.now()).slice(-6);
    const email = `${n1}${a1}${ts}@${EMAIL_DOMAINS[0]}`;
    emailsSeen.add(email);
    return email;
  }

  return { nombreCompleto, dosApellidos, pickSurname, randomEmailFromName };
}

export type NameState = ReturnType<typeof createNameState>;

function randomTelefono(): string {
  const fmts = [
    () => `${300 + Math.floor(Math.random() * 700)}-${100 + Math.floor(Math.random() * 900)}-${1000 + Math.floor(Math.random() * 9000)}`,
    () => `+${1 + Math.floor(Math.random() * 999)} ${300 + Math.floor(Math.random() * 700)} ${100 + Math.floor(Math.random() * 900)} ${1000 + Math.floor(Math.random() * 9000)}`,
    () => `0${10 + Math.floor(Math.random() * 90)}-${1000000 + Math.floor(Math.random() * 9000000)}`,
  ];
  return fmts[Math.floor(Math.random() * fmts.length)]();
}

function randomFecha(): string {
  const base = new Date(1960, 0, 1).getTime();
  const end = new Date(2005, 11, 31).getTime();
  const d = new Date(base + Math.random() * (end - base));
  return d.toISOString().slice(0, 10);
}

function randomHora(): string {
  const hour = 7 + Math.floor(Math.random() * 16);
  const minute = [0, 15, 30, 45][Math.floor(Math.random() * 4)];
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function isNameField(q: ParsedQuestion): boolean {
  const t = normalize(q.title);
  return matches(t, KW.nombre_completo) || matches(t, KW.nombre);
}

export function isEmailField(q: ParsedQuestion): boolean {
  return matches(normalize(q.title), KW.email);
}

/**
 * Genera un valor aleatorio realista para una pregunta de TEXTO LIBRE
 * (sin opciones), sin usar IA. `state` se comparte entre llamadas de la
 * misma tanda para no repetir nombres/apellidos/correos dentro de ella.
 */
export function smartRandom(q: ParsedQuestion, state: NameState): string {
  if (q.type === 9) return randomFecha();
  if (q.type === 10) return randomHora();
  // Cuadrícula/escala sin opciones parseadas (caso raro) — igual que el
  // bot de escritorio, un valor genérico razonable en vez de fallar.
  if (q.type === 7 || q.type === 13) {
    const opts = ["De acuerdo", "En desacuerdo", "Neutral", "Siempre", "A veces", "Nunca", "Sí", "No"];
    return opts[Math.floor(Math.random() * opts.length)];
  }
  if (q.type === 5) return String(1 + Math.floor(Math.random() * 5));

  const t = normalize(q.title);

  if (matches(t, KW.nombre_completo) || matches(t, KW.nombre)) return state.nombreCompleto();
  if (t.includes("primer apellido") || t.includes("1er apellido")) return state.pickSurname();
  if (t.includes("segundo apellido") || t.includes("2do apellido")) return state.pickSurname();
  if (matches(t, KW.apellido)) return state.dosApellidos();
  if (matches(t, KW.edad)) return String(15 + Math.floor(Math.random() * 51));
  if (matches(t, KW.email)) return state.randomEmailFromName();
  if (matches(t, KW.ciudad)) return CIUDADES[Math.floor(Math.random() * CIUDADES.length)];
  if (matches(t, KW.pais)) return PAISES[Math.floor(Math.random() * PAISES.length)];
  if (matches(t, KW.ocupacion)) return OCUPACIONES[Math.floor(Math.random() * OCUPACIONES.length)];
  if (matches(t, KW.telefono)) return randomTelefono();

  const fallback = [
    "Sí", "No", "Tal vez", "A veces", "Siempre", "Nunca",
    "De acuerdo", "En desacuerdo", "Regular", "Bien", "Muy bien",
    "Me parece correcto", "Estoy de acuerdo", "No estoy seguro",
  ];
  return fallback[Math.floor(Math.random() * fallback.length)];
}
