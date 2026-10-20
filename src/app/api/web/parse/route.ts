import { NextResponse } from "next/server";
import { parseForm, FormParseError } from "@/lib/formParser";
import { moderateForm } from "@/lib/aiProfiles";

export async function POST(request: Request) {
  let body: { url?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Solicitud inválida." }, { status: 400 });
  }

  const url = (body.url ?? "").trim();
  if (!url) {
    return NextResponse.json({ ok: false, error: "Pega el link de tu Google Form." }, { status: 400 });
  }

  let form;
  try {
    form = await parseForm(url);
  } catch (e) {
    const message = e instanceof FormParseError ? e.message : "No se pudo leer el formulario.";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }

  if (form.collectsEmail) {
    return NextResponse.json({
      ok: false,
      blocked: true,
      reason:
        "Este formulario exige una cuenta de Google con sesión iniciada para recolectar el correo verificado del encuestado. Ese dato no se puede simular: desactiva la recolección de correo en tu formulario (Configuración → Respuestas) para poder usarlo aquí.",
    });
  }

  let moderation;
  try {
    moderation = await moderateForm(form);
  } catch {
    return NextResponse.json({
      ok: false,
      blocked: true,
      reason: "No se pudo verificar el contenido del formulario en este momento. Intenta de nuevo en un momento.",
    });
  }

  if (!moderation.allowed) {
    return NextResponse.json({
      ok: false,
      blocked: true,
      reason:
        moderation.reason ||
        "Este formulario parece ser un concurso, sorteo, votación u otra actividad que no podemos procesar.",
    });
  }

  return NextResponse.json({
    ok: true,
    form: {
      title: form.title,
      description: form.description,
      numSections: form.numSections,
      questions: form.questions.map((q) => ({
        entry: q.entry,
        title: q.title,
        type: q.type,
        typeName: q.typeName,
        options: q.options,
        required: q.required,
      })),
    },
  });
}
