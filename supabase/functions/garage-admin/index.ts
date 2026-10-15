const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-pin",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function constantTimeEqual(left: string, right: string) {
  const length = Math.max(left.length, right.length);
  let mismatch = left.length ^ right.length;
  for (let index = 0; index < length; index++) {
    mismatch |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return mismatch === 0;
}

async function databaseRequest(path: string, init: RequestInit = {}) {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) throw new Error("Supabase function secrets are not configured.");

  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: "Invalid response from database." };
    }
  }
  if (!response.ok) {
    const message = typeof data === "object" && data && "message" in data
      ? String(data.message)
      : "Database request failed.";
    throw Object.assign(new Error(message), { status: response.status });
  }
  return data;
}

async function clientHash(request: Request) {
  const address = request.headers.get("cf-connecting-ip")
    || request.headers.get("x-forwarded-for")?.split(",")[0].trim()
    || "unknown";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(address));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse(405, { error: "Method not allowed." });

  const expectedPin = Deno.env.get("ADMIN_PIN") || "";
  if (expectedPin.length < 12) return jsonResponse(503, { error: "Admin PIN is not configured. Set an ADMIN_PIN secret of at least 12 characters." });
  if (!constantTimeEqual(request.headers.get("x-admin-pin") || "", expectedPin)) {
    const allowed = await databaseRequest("rpc/record_admin_pin_failure", {
      method: "POST",
      body: JSON.stringify({ p_client_hash: await clientHash(request) }),
    });
    if (!allowed) return jsonResponse(429, { error: "Zbyt wiele nieudanych prób. Spróbuj ponownie za 15 minut." });
    return jsonResponse(401, { error: "Nieprawidłowy PIN." });
  }

  try {
    await databaseRequest("rpc/clear_admin_pin_failures", {
      method: "POST",
      body: JSON.stringify({ p_client_hash: await clientHash(request) }),
    });
    const body = await request.json();

    if (body.action === "list-reservations") {
      const [reservations, items] = await Promise.all([
        databaseRequest("reservations?select=id,item_id,name,contact,created_at&released_at=is.null&order=created_at.desc"),
        databaseRequest("items?select=id,name&is_listed=eq.true"),
      ]) as [Array<Record<string, unknown>>, Array<Record<string, unknown>>];
      const itemNames = new Map(items.map((item) => [item.id, item.name]));
      return jsonResponse(200, reservations.map((reservation) => ({
        id: reservation.id,
        itemId: reservation.item_id,
        itemName: itemNames.get(reservation.item_id) || "Usunięty przedmiot",
        name: reservation.name,
        contact: reservation.contact,
        createdAt: reservation.created_at,
      })));
    }

    if (body.action === "add-item") {
      const item = body.item || {};
      const name = typeof item.name === "string" ? item.name.trim().slice(0, 80) : "";
      const imageUrl = typeof item.imageUrl === "string" ? item.imageUrl.trim().slice(0, 500) : "";
      if (!name) return jsonResponse(400, { error: "Wpisz nazwę przedmiotu." });
      if (imageUrl && !/^https?:\/\//i.test(imageUrl)) {
        return jsonResponse(400, { error: "Link do zdjęcia musi zaczynać się od http:// lub https://." });
      }
      await databaseRequest("items", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          name,
          category: typeof item.category === "string" ? item.category.trim().slice(0, 40) : "Inne",
          condition: typeof item.condition === "string" ? item.condition.trim().slice(0, 40) : "Używany",
          description: typeof item.description === "string" ? item.description.trim().slice(0, 500) : "",
          image_url: imageUrl,
        }),
      });
      return jsonResponse(201, { ok: true });
    }

    if (body.action === "release-reservation") {
      await databaseRequest("rpc/release_reservation", {
        method: "POST",
        body: JSON.stringify({ p_reservation_id: body.id }),
      });
      return jsonResponse(200, { ok: true });
    }

    if (body.action === "remove-item") {
      const result = await databaseRequest(`items?id=eq.${encodeURIComponent(String(body.id))}&is_reserved=eq.false&is_listed=eq.true`, {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ is_listed: false }),
      }) as Array<Record<string, unknown>>;
      if (!result.length) return jsonResponse(409, { error: "Nie można usunąć przedmiotu. Może być już zarezerwowany." });
      return jsonResponse(200, { ok: true });
    }

    return jsonResponse(400, { error: "Nieznana operacja administracyjna." });
  } catch (error) {
    console.error("Admin operation failed:", error);
    const status = error instanceof Error && "status" in error ? Number(error.status) : 500;
    if (error instanceof Error && error.message.includes("ITEM_UNAVAILABLE")) {
      return jsonResponse(409, { error: "Ten przedmiot został już zarezerwowany." });
    }
    if (error instanceof Error && error.message.includes("RESERVATION_NOT_FOUND")) {
      return jsonResponse(404, { error: "Nie znaleziono aktywnej rezerwacji." });
    }
    return jsonResponse(status >= 400 && status < 500 ? status : 500, {
      error: status >= 400 && status < 500 ? "Nie udało się wykonać tej operacji." : "Błąd serwera. Spróbuj ponownie później.",
    });
  }
});