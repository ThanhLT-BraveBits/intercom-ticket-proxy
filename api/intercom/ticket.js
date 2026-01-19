export default async function handler(req, res) {
  // ----- CORS -----
  const origin = req.headers.origin || "";
  const allowOrigin = process.env.ALLOWED_ORIGIN || ""; // ví dụ: http://127.0.0.1:5500 hoặc https://yourdomain.com
  if (allowOrigin) {
    res.setHeader("Access-Control-Allow-Origin", allowOrigin);
  } else {
    // fallback: echo origin (chỉ nên dùng khi bạn tự kiểm soát)
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-api-key");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // ----- optional API key -----
  const apiKey = process.env.FORM_API_KEY;
  if (apiKey) {
    const incoming = req.headers["x-api-key"];
    if (!incoming || incoming !== apiKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
  }

  // ----- env check -----
  const token = process.env.INTERCOM_ACCESS_TOKEN;
  const ticketTypeId = process.env.INTERCOM_TICKET_TYPE_ID;
  const intercomVersion = process.env.INTERCOM_VERSION || "Unstable";

  if (!token) return res.status(500).json({ error: "Missing INTERCOM_ACCESS_TOKEN" });
  if (!ticketTypeId) return res.status(500).json({ error: "Missing INTERCOM_TICKET_TYPE_ID" });

  // ----- parse body -----
  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch {}
  }

  const email = (body?.email || "").trim();
  const store_url = (body?.store_url || "").trim();
  const collaborator_code = (body?.collaborator_code || "").trim();
  const theme = (body?.theme || "").trim();
  const media_link = (body?.media_link || "").trim();
  const message = (body?.message || "").trim();

  if (!email || !store_url || !message) {
    return res.status(400).json({
      error: "Missing required fields",
      required: ["email", "store_url", "message"]
    });
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "Intercom-Version": intercomVersion
  };

  // ----- Step 1: upsert contact (optional but recommended) -----
  // Nếu custom attributes chưa tồn tại => sẽ bị 400 parameter_invalid
  // => bạn có 2 lựa chọn:
  //   (A) tạo attributes trong Intercom (khuyến nghị)
  //   (B) bật SKIP_CONTACT_ATTRIBUTES=true để không set custom_attributes
  const skipAttrs = process.env.SKIP_CONTACT_ATTRIBUTES === "true";

  let contactId = null;

  try {
    const contactPayload = {
      role: "lead",
      email,
      ...(skipAttrs ? {} : {
        custom_attributes: {
          store_url,
          theme,
          collaborator_code,
          media_link
        }
      })
    };

    const contactRes = await fetch("https://api.intercom.io/contacts", {
      method: "POST",
      headers,
      body: JSON.stringify(contactPayload)
    });

    const contactData = await contactRes.json();

    if (!contactRes.ok) {
      // nếu fail vì custom attribute không tồn tại thì trả lỗi rõ cho bạn
      return res.status(400).json({
        error: "Failed to upsert contact",
        details: contactData,
        hint:
          "Check Intercom Settings > Data > People/Contacts > Attributes. Ensure keys exist: store_url, theme, collaborator_code, media_link (type text). " +
          "Or set SKIP_CONTACT_ATTRIBUTES=true to bypass."
      });
    }

    contactId = contactData.id;
  } catch (e) {
    return res.status(500).json({ error: "Unexpected contact upsert error", message: String(e) });
  }

  // ----- Step 2: create ticket -----
  const title = `Support request - ${theme || "General"}`;
  const description =
`Store URL: ${store_url}
Theme: ${theme || "-"}
Collaborator code: ${collaborator_code || "-"}
Video/Screenshot link: ${media_link || "-"}

Message:
${message}
`;

  try {
    const ticketPayload = {
      ticket_type_id: ticketTypeId,
      ticket_attributes: {
        _default_title: title,
        _default_description: description
      },
      contacts: [{ id: contactId }]
    };

    const ticketRes = await fetch("https://api.intercom.io/tickets", {
      method: "POST",
      headers,
      body: JSON.stringify(ticketPayload)
    });

    const ticketData = await ticketRes.json();

    if (!ticketRes.ok) {
      return res.status(ticketRes.status).json({
        error: "Intercom create ticket failed",
        details: ticketData
      });
    }

    return res.status(200).json({
      ok: true,
      ticket_id: ticketData.ticket_id || ticketData.id,
      contact_id: contactId
    });
  } catch (e) {
    return res.status(500).json({ error: "Unexpected ticket error", message: String(e) });
  }
}
