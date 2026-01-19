// api/intercom/tickets.js
export default async function handler(req, res) {
  // --- CORS (để Shopify domain gọi được) ---
  const origin = req.headers.origin || "*";
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  try {
    // Body có thể là object (Vercel parse JSON), hoặc string (tùy client)
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;

    const {
      email,
      message,
      store_url,
      collaborator_code,
      theme,
      media_link
    } = body || {};

    // --- Validate tối thiểu ---
    if (!email || !message || !store_url) {
      return res.status(400).json({
        error: "Missing required fields",
        required: ["email", "message", "store_url"]
      });
    }

    // --- ENV bắt buộc ---
    const token = process.env.INTERCOM_ACCESS_TOKEN;
    const ticketTypeId = process.env.INTERCOM_TICKET_TYPE_ID; // ví dụ: 2763416
    const intercomVersion = process.env.INTERCOM_VERSION || "Unstable";

    if (!token || !ticketTypeId) {
      return res.status(500).json({
        error: "Server is not configured",
        missing: [
          !token ? "INTERCOM_ACCESS_TOKEN" : null,
          !ticketTypeId ? "INTERCOM_TICKET_TYPE_ID" : null
        ].filter(Boolean)
      });
    }

    // --- Build ticket description từ form Shopify ---
    const descriptionLines = [
      `Store URL: ${store_url}`,
      `Theme: ${theme || "-"}`,
      `Collaborator code: ${collaborator_code || "-"}`,
      `Video/Screenshot link: ${media_link || "-"}`,
      ``,
      `Message:`,
      `${message}`
    ];

    const payload = {
      ticket_type_id: ticketTypeId,
      contacts: [{ email }],
      ticket_attributes: {
        _default_title_: `Support request${theme ? " - " + theme : ""}`,
        _default_description_: descriptionLines.join("\n")
      }
    };

    const r = await fetch("https://api.intercom.io/tickets", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
        "Intercom-Version": intercomVersion
      },
      body: JSON.stringify(payload)
    });

    const data = await r.json();

    if (!r.ok) {
      return res.status(r.status).json({
        error: "Intercom API error",
        status: r.status,
        details: data
      });
    }

    // Trả về ticket id để bạn debug
    return res.status(200).json({
      ok: true,
      ticket_id: data.ticket_id || data.id,
      intercom: data
    });
  } catch (e) {
    return res.status(500).json({ error: "Unexpected server error", message: String(e?.message || e) });
  }
}
