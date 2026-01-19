// api/intercom/ticket.js
export default async function handler(req, res) {
  const origin = req.headers.origin || "*";
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const INTERCOM_ACCESS_TOKEN = process.env.INTERCOM_ACCESS_TOKEN;
  const INTERCOM_TICKET_TYPE_ID = process.env.INTERCOM_TICKET_TYPE_ID;
  const INTERCOM_VERSION = process.env.INTERCOM_VERSION || "2.13";

  if (!INTERCOM_ACCESS_TOKEN) return res.status(500).json({ error: "Missing INTERCOM_ACCESS_TOKEN env" });
  if (!INTERCOM_TICKET_TYPE_ID) return res.status(500).json({ error: "Missing INTERCOM_TICKET_TYPE_ID env" });

  // Map ticket attribute key (ở Intercom Ticket Type) qua ENV để tránh hardcode sai key
  // Ví dụ: nếu ticket attribute key của bạn là "store_url" thì set ENV:
  // TICKET_ATTR_STORE_URL_KEY=store_url
  const TICKET_ATTR_KEYS = {
    store_url: process.env.TICKET_ATTR_STORE_URL_KEY,
    theme: process.env.TICKET_ATTR_THEME_KEY,
    collaborator_code: process.env.TICKET_ATTR_COLLABORATOR_CODE_KEY,
    media_link: process.env.TICKET_ATTR_MEDIA_LINK_KEY,
    message: process.env.TICKET_ATTR_MESSAGE_KEY,
  };

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;

    const email = (body?.email || "").trim();
    const storeUrl = (body?.store_url || "").trim();
    const collaboratorCode = (body?.collaborator_code || "").trim();
    const theme = (body?.theme || "").trim();
    const mediaLink = (body?.media_link || "").trim();
    const message = (body?.message || "").trim();

    if (!email) return res.status(400).json({ error: "Missing email" });
    if (!storeUrl) return res.status(400).json({ error: "Missing store_url" });
    if (!message) return res.status(400).json({ error: "Missing message" });

    // 1) Upsert contact: CHỈ update Lead data field "store-url"
    const upsertPayload = {
      role: "lead",
      email,
      custom_attributes: {
        "store-url": storeUrl, // <- đúng theo bạn: key contact attribute là store-url
      },
    };

    const contactResp = await fetch("https://api.intercom.io/contacts", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${INTERCOM_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
        "Intercom-Version": INTERCOM_VERSION,
      },
      body: JSON.stringify(upsertPayload),
    });

    const contactData = await contactResp.json();
    if (!contactResp.ok) {
      return res.status(contactResp.status).json({
        error: "Failed to upsert contact",
        details: contactData,
        sent: upsertPayload,
      });
    }

    const contactId = contactData?.id;
    if (!contactId) return res.status(500).json({ error: "Missing contact id", details: contactData });

    // 2) Ticket description: FULL field luôn hiển thị
    const title = theme ? `Support request - ${theme}` : "Support request";

    const desc = [
      `Store URL: ${storeUrl}`,
      `Theme: ${theme || "-"}`,
      `Collaborator code: ${collaboratorCode || "-"}`,
      `Video/Screenshot link: ${mediaLink || "-"}`,
      "",
      "Message:",
      message,
    ].join("\n");

    // 3) Ticket attributes: set theo key đã tạo trên Ticket Type (nếu có ENV key)
    // Chỉ thêm attribute nếu:
    // - có key mapping (ENV)
    // - và có value (không rỗng)
    const extraTicketAttrs = {};
    const maybeSet = (envKey, value) => {
      if (!envKey) return; // chưa cấu hình key => bỏ qua, không gây lỗi
      const v = (value || "").trim();
      if (!v) return;
      extraTicketAttrs[envKey] = v;
    };

    maybeSet(TICKET_ATTR_KEYS.store_url, storeUrl);
    maybeSet(TICKET_ATTR_KEYS.theme, theme);
    maybeSet(TICKET_ATTR_KEYS.collaborator_code, collaboratorCode);
    maybeSet(TICKET_ATTR_KEYS.media_link, mediaLink);
    maybeSet(TICKET_ATTR_KEYS.message, message);

    const ticketPayload = {
      ticket_type_id: String(INTERCOM_TICKET_TYPE_ID),
      contacts: [{ type: "contact", id: contactId }],
      ticket_attributes: {
        "_default_title_": title,
        "_default_description_": desc,
        ...extraTicketAttrs, // <- ticket attributes (nếu key hợp lệ)
      },
    };

    const ticketResp = await fetch("https://api.intercom.io/tickets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${INTERCOM_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
        "Intercom-Version": INTERCOM_VERSION,
      },
      body: JSON.stringify(ticketPayload),
    });

    const ticketData = await ticketResp.json();
    if (!ticketResp.ok) {
      return res.status(ticketResp.status).json({
        error: "Failed to create ticket",
        details: ticketData,
        sent: ticketPayload,
        hint: "Nếu lỗi 'Extra attributes...' => bạn đang set ticket attribute key không tồn tại trên Ticket Type. Hãy map đúng key qua ENV TICKET_ATTR_*_KEY.",
      });
    }

    return res.status(200).json({
      ok: true,
      contact_id: contactId,
      ticket_id: ticketData?.ticket_id || ticketData?.id,
      used_ticket_attribute_keys: extraTicketAttrs,
      intercom: ticketData,
    });
  } catch (e) {
    return res.status(500).json({ error: "Unexpected server error", message: String(e?.message || e) });
  }
}
