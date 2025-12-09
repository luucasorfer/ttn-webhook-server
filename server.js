import express from "express";
import mongoose from "mongoose";

const app = express();
app.use(express.json());

// Conecta ao MongoDB Atlas
await mongoose.connect(process.env.MONGO_URI);

// Modelo
const Uplink = mongoose.model(
  "Uplink",
  new mongoose.Schema({
    deveui: String,
    timestamp: Date,
    payload: Object,
    full_payload: Object,
  }),
);

// Endpoint chamado pelo TTN Webhook
app.post("/ttn", async (req, res) => {
  try {
    const body = req.body;

    const ts_original = body.uplink_message.received_at;

    // Date em UTC
    const d_utc = new Date(ts_original);

    // Date no fuso GMT-3 (America/Sao_Paulo)
    const d_br = new Date(ts_original).toLocaleString("en-US", {
      timeZone: "America/Sao_Paulo",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    });

    // Formato UTC
    const d_utc_fmt = d_utc.toLocaleString("en-US", {
      timeZone: "UTC",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    });

    // Timestamp em ms
    const ts_ms = d_utc.getTime();

    // Impressão:
    console.log("Dados enviados:");
    console.log(`GMT-3: ${d_br}`);
    console.log(`UTC: ${d_utc_fmt}`);
    console.log(`Timestamp: ${ts_ms}`);

    await Uplink.create({
      deveui: body.end_device_ids.device_id,
      timestamp: body.uplink_message.received_at,
      payload: body.uplink_message.decoded_payload,
      full_payload: body, // aqui salva o JSON completo do TTN
    });

    res.status(200).send("OK");
  } catch (err) {
    console.error(err);
    res.status(500).send("Erro");
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server OK on port ${PORT}`));
