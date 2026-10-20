import { NextResponse } from "next/server";
import { parseForm, FormParseError } from "@/lib/formParser";
import { generateProfiles, moderateForm, type QuestionConfigMap } from "@/lib/aiProfiles";
import { submitOne } from "@/lib/formSubmitter";
import { FREE_TEST_CAP } from "@/lib/webConfig";

interface RunBody {
  url?: string;
  total?: number;
  language?: string;
  customInstructions?: string;
  qConfig?: QuestionConfigMap;
}

export async function POST(request: Request) {
  let body: RunBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Solicitud inválida." }, { status: 400 });
  }

  const url = (body.url ?? "").trim();
  if (!url) {
    return NextResponse.json({ ok: false, error: "Falta el link del formulario." }, { status: 400 });
  }

  const total = Math.min(FREE_TEST_CAP, Math.max(1, Math.floor(body.total ?? FREE_TEST_CAP)));

  // Re-validar todo en el servidor: nunca confiar en el estado que manda el cliente.
  let form;
  try {
    form = await parseForm(url);
  } catch (e) {
    const message = e instanceof FormParseError ? e.message : "No se pudo leer el formulario.";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }

  if (form.collectsEmail) {
    return NextResponse.json(
      { ok: false, blocked: true, reason: "Este formulario exige correo verificado de Google y no se puede procesar." },
      { status: 400 }
    );
  }

  const moderation = await moderateForm(form).catch(() => ({ allowed: false, reason: "" }));
  if (!moderation.allowed) {
    return NextResponse.json(
      {
        ok: false,
        blocked: true,
        reason: moderation.reason || "Este formulario no puede ser procesado por nuestras políticas de uso.",
      },
      { status: 400 }
    );
  }

  let profiles;
  try {
    profiles = await generateProfiles(form, {
      nProfiles: total,
      qConfig: body.qConfig ?? {},
      language: body.language || "español",
      customInstructions: body.customInstructions || "",
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "No se pudieron generar las respuestas." },
      { status: 502 }
    );
  }

  let sent = 0;
  let failed = 0;
  for (const profile of profiles) {
    const result = await submitOne(form, profile);
    if (result.ok) sent++;
    else failed++;
  }

  return NextResponse.json({ ok: true, sent, failed, total: profiles.length });
}
