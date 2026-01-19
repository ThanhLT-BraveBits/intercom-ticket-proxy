// api/intercom/ticket.js

export default async function handler(req, res) {
  // ===== CORS (dev friendly) =====
  const origin = req.headers.origin || "*";
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const INTERCOM_ACCESS_TOKEN = process.env.INTERCOM_ACCESS_TOKEN;
  const INTERCOM_TICKET_TYPE_ID = process.env.INTERCOM_TICKET_TYPE_ID;

  if (!INTERCOM_ACCESS_TOKEN) {
    return res.status(500).json({ error: "Missing INTERCOM_ACCESS_TOKEN env" });
  }
  if (!INTERCOM_TICKET_TYPE_ID) {
    return res.status(500).json({ error: "Missing INTERCOM_TICKET_TYPE_ID env" });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;

    const email = (body?.email || "").trim();
    const storeUrl = (body?.store_url || "").trim();
    const theme = (body?.theme || "").trim();

    if (!email) return res.status(400).json({ error: "Missing email" });
    if (!storeUrl) return res.status(400).json({ error: "Missing store_url" });

    // ===== 1) Upsert Contact (Lead data) with ONLY store-url =====
    const upsertPayload = {
      role: "lead",
      email,
      custom_attributes: {
        // key bạn nói là "store-url"
        "store-url": storeUrl,
      },
    };

    const contactResp = await fetch("https://api.intercom.io/contacts", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${INTERCOM_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
        "Intercom-Version": "2.13",
      },
      body: JSON.stringify(upsertPayload),
    });

    const contactData = await contactResp.json();
    if (!contactResp.ok) {
      return res.status(contactResp.status).json({
        error: "Failed to upsert contact",
        details: contactData,
        sent: upsertPayload,
        hint:
          "Vào Intercom Settings > Data > People/Contacts > Attributes để kiểm tra key contact attribute có đúng là store-url không.",
      });
    }

    const contactId = contactData?.id;
    if (!contactId) {
      return res.status(500).json({
        error: "Upsert contact succeeded but missing contact id",
        details: contactData,
      });
    }

    // ===== 2) Create Ticket =====
    // LƯU Ý: default keys bắt buộc là _default_title_ và _default_description_
    const title = theme ? `Support request - ${theme}` : "Support request";
    const desc = storeUrl; // bạn muốn tạm thời chỉ store url

    const ticketPayload = {
      ticket_type_id: String(INTERCOM_TICKET_TYPE_ID),
      contacts: [{ type: "contact", id: contactId }],
      ticket_attributes: {
        "_default_title_": title,
        "_default_description_": desc,
      },
    };

    const ticketResp = await fetch("https://api.intercom.io/tickets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${INTERCOM_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
        "Intercom-Version": "2.13",
      },
      body: JSON.stringify(ticketPayload),
    });

    const ticketData = await ticketResp.json();
    if (!ticketResp.ok) {
      return res.status(ticketResp.status).json({
        error: "Failed to create ticket",
        details: ticketData,
        sent: ticketPayload,
        hint:
          "Nếu vẫn báo ticket type mismatch, hãy gọi GET /ticket_types để chắc INTERCOM_TICKET_TYPE_ID đúng và ticket type đó có default title/description.",
      });
    }

    return res.status(200).json({
      ok: true,
      contact_id: contactId,
      ticket_id: ticketData?.ticket_id || ticketData?.id,
      intercom: ticketData,
    });
  } catch (e) {
    return res.status(500).json({ error: "Unexpected server error", message: String(e?.message || e) });
  }
}
