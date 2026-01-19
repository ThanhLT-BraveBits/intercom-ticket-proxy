export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const {
      email,
      store_url,
      message = "",
      theme = "Support request"
    } = req.body || {};

    if (!email || !store_url) {
      return res.status(400).json({
        error: "Missing required fields",
        required: ["email", "store_url"]
      });
    }

    const INTERCOM_TOKEN = process.env.INTERCOM_ACCESS_TOKEN;
    const TICKET_TYPE_ID = process.env.INTERCOM_TICKET_TYPE_ID;

    /* --------------------------------------------------
     * 1️⃣ UPSERT CONTACT (Lead) – chỉ set store-url
     * -------------------------------------------------- */
    const contactRes = await fetch("https://api.intercom.io/contacts", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${INTERCOM_TOKEN}`,
        "Content-Type": "application/json",
        "Intercom-Version": "Unstable"
      },
      body: JSON.stringify({
        role: "lead",
        email,
        custom_attributes: {
          "store-url": store_url
        }
      })
    });

    const contactData = await contactRes.json();

    if (!contactRes.ok) {
      return res.status(contactRes.status).json({
        error: "Failed to upsert contact",
        details: contactData
      });
    }

    const contactId = contactData.id;

    /* --------------------------------------------------
     * 2️⃣ CREATE TICKET
     * -------------------------------------------------- */
    const ticketRes = await fetch("https://api.intercom.io/tickets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${INTERCOM_TOKEN}`,
        "Content-Type": "application/json",
        "Intercom-Version": "Unstable"
      },
      body: JSON.stringify({
        ticket_type_id: TICKET_TYPE_ID,
        contacts: [{ id: contactId }],
        ticket_attributes: {
          _default_title: `Support request - ${theme}`,
          _default_description: message
        }
      })
    });

    const ticketData = await ticketRes.json();

    if (!ticketRes.ok) {
      return res.status(ticketRes.status).json({
        error: "Failed to create ticket",
        details: ticketData
      });
    }

    /* --------------------------------------------------
     * 3️⃣ DONE
     * -------------------------------------------------- */
    return res.status(200).json({
      ok: true,
      contact_id: contactId,
      ticket_id: ticketData.ticket_id || ticketData.id
    });

  } catch (err) {
    return res.status(500).json({
      error: "Unexpected server error",
      message: String(err)
    });
  }
}
