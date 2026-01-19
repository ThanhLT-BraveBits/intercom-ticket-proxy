// api/intercom/ticket.js

export default async function handler(req, res) {
  // ---- CORS (needed for Shopify frontend calling Vercel endpoint)
  const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);

  const origin = req.headers.origin || "";
  if (origin && allowedOrigins.length > 0 && !allowedOrigins.includes(origin)) {
    return res.status(403).json({ error: "Forbidden origin" });
  }

  res.setHeader("Access-Control-Allow-Origin", origin || "*");
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, x-api-key"
  );

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // ---- Optional API key protection
  // If FORM_API_KEY is set on Vercel, requests must include header: x-api-key: <value>
  if (process.env.FORM_API_KEY) {
    const apiKey = req.headers["x-api-key"];
    if (!apiKey || apiKey !== process.env.FORM_API_KEY) {
      return res.status(401).json({ error: "Unauthorized" });
    }
  }

  // ---- Required env
  const token = process.env.INTERCOM_ACCESS_TOKEN;
  const ticketTypeId = process.env.INTERCOM_TICKET_TYPE_ID;
  const intercomVersion = process.env.INTERCOM_VERSION || "Unstable";

  if (!token) return res.status(500).json({ error: "Missing INTERCOM_ACCESS_TOKEN" });
  if (!ticketTypeId) return res.status(500).json({ error: "Missing INTERCOM_TICKET_TYPE_ID" });

  // ---- Parse body (Vercel provides JSON body automatically, but keep safe)
  const body = typeof req.body === "string" ? safeJsonParse(req.body) : req.body || {};

  const email = String(body.email || "").trim();
  const store_url = String(body.store_url || "").trim();
  const collaborator_code = String(body.collaborator_code || "").trim();
  const theme = String(body.theme || "").trim();
  const media_link = String(body.media_link || "").trim();
  const message = String(body.message || "").trim();

  if (!email) return res.status(400).json({ error: "email is required" });
  if (!store_url) return res.status(400).json({ error: "store_url is required" });
  if (!message) return res.status(400).json({ error: "message is required" });

  try {
    // =========================================================
    // 1) Upsert Contact (Lead) + set custom_attributes
    //    => This is what makes fields appear in "Lead data"
    // =========================================================
    const contactPayload = {
      role: "lead",
      email,
      custom_attributes: {
        store_url,
        theme,
        collaborator_code,
        media_link
      }
    };

    const contactRes = await fetch("https://api.intercom.io/contacts", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Intercom-Version": intercomVersion
      },
      body: JSON.stringify(contactPayload)
    });

    const contactData = await contactRes.json();

    if (!contactRes.ok) {
      return res.status(contactRes.status).json({
        error: "Failed to upsert contact",
        details: contactData
      });
    }

    // =========================================================
    // 2) Create Ticket and attach the contact by ID
    // =========================================================
    const title = `Support request - ${theme || "General"}`;

    const descriptionLines = [
      `Store URL: ${store_url}`,
      `Theme: ${theme || "-"}`,
      `Collaborator code: ${collaborator_code || "-"}`,
      `Video/Screenshot link: ${media_link || "-"}`,
      "",
      "Message:",
      message
    ];

    const ticketPayload = {
      ticket_type_id: ticketTypeId,
      contacts: [{ id: contactData.id }],
      ticket_attributes: {
        _default_title_: title,
        _default_description_: descriptionLines.join("\n")
      }
    };

    const ticketRes = await fetch("https://api.intercom.io/tickets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Intercom-Version": intercomVersion
      },
      body: JSON.stringify(ticketPayload)
    });

    const ticketData = await ticketRes.json();

    if (!ticketRes.ok) {
      return res.status(ticketRes.status).json({
        error: "Intercom API error (create ticket)",
        details: ticketData
      });
    }

    return res.status(200).json({
      ok: true,
      contact_id: contactData.id,
      ticket_id: ticketData.ticket_id || ticketData.id,
      intercom: ticketData
    });
  } catch (e) {
    return res.status(500).json({
      error: "Unexpected server error",
      message: String(e?.message || e)
    });
  }
}

function safeJsonParse(str) {
  try {
    return JSON.parse(str);
  } catch {
    return {};
  }
}
