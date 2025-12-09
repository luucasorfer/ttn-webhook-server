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
    const ts_ptbr = new Date(ts_original).toLocaleString("pt-BR", {
      timeZone: "America/Sao_Paulo",
    });

    console.log(`Dados enviaddos: ${ts_original} --> ${ts_ptbr}`);

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
