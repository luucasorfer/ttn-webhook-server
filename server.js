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
  }),
);

// Endpoint chamado pelo TTN Webhook
app.post("/ttn", async (req, res) => {
  try {
    const body = req.body;

    await Uplink.create({
      deveui: body.end_device_ids.device_id,
      timestamp: body.uplink_message.received_at,
      payload: body.uplink_message.decoded_payload,
    });

    res.status(200).send("OK");
  } catch (err) {
    console.error(err);
    res.status(500).send("Erro");
  }
});

// Start server
app.listen(3000, () => console.log("Server OK"));
