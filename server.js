import express from "express";
import mongoose from "mongoose";
import winston from "winston";
import { z } from "zod";
import crypto from "crypto";

const app = express();
app.use(express.json());

// ===== LOGGING =====
const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json(),
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.simple(),
    }),
  ],
});

// ===== CONEXÃO MONGODB =====
try {
  await mongoose.connect(process.env.MONGO_URI);
  logger.info("✅ Conectado ao MongoDB");
} catch (err) {
  logger.error("❌ Erro ao conectar ao MongoDB:", err);
  process.exit(1);
}

// ===== SCHEMA MELHORADO =====
const sensorReadingSchema = new mongoose.Schema(
  {
    // Identificação
    device_id: String,
    dev_eui: String,
    application_id: String,

    // Dados do sensor (DESNORMALIZADOS)
    temperature_celsius: Number,
    humidity_percent: Number,
    packet_counter: Number,

    // Metadados de transmissão
    f_port: Number,
    f_cnt: Number,

    // Informações do gateway
    gateway_id: String,
    gateway_eui: String,

    // Qualidade do sinal
    rssi: Number,
    snr: Number,

    // Configurações
    spreading_factor: Number,
    bandwidth: Number,
    frequency: Number,

    // Localização
    gateway_location: {
      latitude: Number,
      longitude: Number,
      altitude: Number,
    },

    // Timestamps
    received_at: Date,
    created_at: { type: Date, default: Date.now },

    // ID único para evitar duplicatas (gerado automaticamente)
    unique_id: { type: String, unique: true, sparse: true },

    // Payload completo para auditoria
    full_payload: mongoose.Schema.Types.Mixed,
  },
  { timestamps: true },
);

// Criar índices
sensorReadingSchema.index({ device_id: 1, received_at: -1 });
sensorReadingSchema.index({ received_at: -1 });
sensorReadingSchema.index({ rssi: 1 });
sensorReadingSchema.index(
  { created_at: 1 },
  { expireAfterSeconds: 90 * 24 * 60 * 60 },
); // TTL: 90 dias

const SensorReading = mongoose.model("SensorReading", sensorReadingSchema);

// ===== FUNÇÃO AUXILIAR: Gerar unique_id =====
function generateUniqueId(body) {
  // Usar f_cnt (frame counter) + device_id + timestamp como base
  const uplink = body.uplink_message;
  const fcnt = uplink.f_cnt || 0;
  const deviceId = body.end_device_ids.device_id;
  const timestamp = uplink.received_at;

  // Criar hash único
  const data = `${deviceId}-${fcnt}-${timestamp}`;
  return crypto
    .createHash("sha256")
    .update(data)
    .digest("hex")
    .substring(0, 16);
}

// ===== VALIDAÇÃO (SCHEMA FLEXÍVEL) =====
const ttnWebhookSchema = z
  .object({
    uplink_message: z.object({
      decoded_payload: z
        .object({
          temperature_celsius: z.number(),
          humidity_percent: z.number(),
          packet_counter: z.number(),
        })
        .optional(),
      rx_metadata: z
        .array(
          z.object({
            rssi: z.number(),
            snr: z.number(),
            gateway_ids: z.object({
              gateway_id: z.string(),
              eui: z.string(),
            }),
            received_at: z.string(),
          }),
        )
        .optional(),
      received_at: z.string(),
      f_port: z.number().optional(),
      f_cnt: z.number().optional(),
      settings: z
        .object({
          data_rate: z
            .object({
              lora: z
                .object({
                  bandwidth: z.number(),
                  spreading_factor: z.number(),
                })
                .optional(),
            })
            .optional(),
        })
        .optional(),
    }),
    end_device_ids: z.object({
      device_id: z.string(),
      dev_eui: z.string(),
      application_ids: z.object({
        application_id: z.string(),
      }),
    }),
  })
  .passthrough(); // Permite campos adicionais

// ===== ENDPOINT WEBHOOK TTN =====
app.post("/ttn", async (req, res) => {
  try {
    const body = req.body;

    // Gerar unique_id automaticamente se não existir
    const unique_id = body.unique_id || generateUniqueId(body);

    logger.info(`📨 Webhook recebido: ${unique_id}`);

    // Validar estrutura (com tratamento de erro mais flexível)
    try {
      ttnWebhookSchema.parse(body);
    } catch (validationErr) {
      logger.warn(
        `⚠️ Validação parcial: ${JSON.stringify(validationErr.errors)}`,
      );
      // Continuar mesmo com validação parcial
    }

    // Verificar duplicata
    const existing = await SensorReading.findOne({ unique_id });
    if (existing) {
      logger.warn(`⚠️ Duplicata ignorada: ${unique_id}`);
      return res
        .status(200)
        .json({ success: true, message: "Duplicata ignorada", unique_id });
    }

    // Extrair dados
    const uplink = body.uplink_message;
    const payload = uplink.decoded_payload || {};
    const rxMetadata = uplink.rx_metadata?.[0] || {};
    const settings = uplink.settings || {};

    // Converter timestamp para GMT-3
    const receivedAt = new Date(uplink.received_at);

    // Validar ranges (com valores padrão)
    const temperature = payload.temperature_celsius || 0;
    const humidity = payload.humidity_percent || 0;

    if (temperature < -40 || temperature > 80) {
      logger.warn(`⚠️ Temperatura fora do range: ${temperature}`);
    }

    if (humidity < 0 || humidity > 100) {
      logger.warn(`⚠️ Umidade fora do range: ${humidity}`);
    }

    // Preparar documento
    const document = {
      device_id: body.end_device_ids.device_id,
      dev_eui: body.end_device_ids.dev_eui,
      application_id: body.end_device_ids.application_ids.application_id,

      temperature_celsius: temperature,
      humidity_percent: humidity,
      packet_counter: payload.packet_counter || 0,

      f_port: uplink.f_port || 1,
      f_cnt: uplink.f_cnt || 0,

      gateway_id: rxMetadata.gateway_ids?.gateway_id || "unknown",
      gateway_eui: rxMetadata.gateway_ids?.eui || "unknown",

      rssi: rxMetadata.rssi || 0,
      snr: rxMetadata.snr || 0,

      spreading_factor: settings.data_rate?.lora?.spreading_factor || 0,
      bandwidth: settings.data_rate?.lora?.bandwidth || 0,
      frequency: settings.frequency ? parseInt(settings.frequency) : 0,

      gateway_location: rxMetadata.location
        ? {
            latitude: rxMetadata.location.latitude,
            longitude: rxMetadata.location.longitude,
            altitude: rxMetadata.location.altitude || 0,
          }
        : null,

      received_at: receivedAt,
      unique_id: unique_id,
      full_payload: body,
    };

    // Salvar no MongoDB
    await SensorReading.create(document);

    logger.info(`✅ Dados armazenados: ${body.end_device_ids.device_id}`, {
      temperature: temperature,
      humidity: humidity,
      rssi: rxMetadata.rssi,
      unique_id: unique_id,
    });

    res.status(200).json({
      success: true,
      message: "Dados armazenados",
      unique_id: unique_id,
    });
  } catch (err) {
    logger.error("❌ Erro ao processar webhook", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ===== ENDPOINT: Obter última leitura =====
app.get("/api/sensor/latest", async (req, res) => {
  try {
    const { device_id } = req.query;

    if (!device_id) {
      return res.status(400).json({ error: "device_id é obrigatório" });
    }

    const latest = await SensorReading.findOne({ device_id })
      .sort({ received_at: -1 })
      .lean();

    if (!latest) {
      return res.status(404).json({ error: "Nenhuma leitura encontrada" });
    }

    res.json(latest);
  } catch (err) {
    logger.error("❌ Erro em /api/sensor/latest", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

// ===== ENDPOINT: Obter histórico com filtros =====
app.get("/api/sensor/readings", async (req, res) => {
  try {
    const {
      device_id,
      limit = 100,
      skip = 0,
      start_date,
      end_date,
    } = req.query;

    if (!device_id) {
      return res.status(400).json({ error: "device_id é obrigatório" });
    }

    const query = { device_id };

    if (start_date || end_date) {
      query.received_at = {};
      if (start_date) query.received_at.$gte = new Date(start_date);
      if (end_date) query.received_at.$lte = new Date(end_date);
    }

    const readings = await SensorReading.find(query)
      .sort({ received_at: -1 })
      .limit(parseInt(limit))
      .skip(parseInt(skip))
      .lean();

    const total = await SensorReading.countDocuments(query);

    res.json({
      total,
      limit: parseInt(limit),
      skip: parseInt(skip),
      data: readings,
    });
  } catch (err) {
    logger.error("❌ Erro em /api/sensor/readings", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

// ===== ENDPOINT: Obter estatísticas =====
app.get("/api/sensor/statistics", async (req, res) => {
  try {
    const { device_id, period = "24h" } = req.query;

    if (!device_id) {
      return res.status(400).json({ error: "device_id é obrigatório" });
    }

    // Calcular data de início
    const now = new Date();
    let startDate;

    switch (period) {
      case "1h":
        startDate = new Date(now - 1 * 60 * 60 * 1000);
        break;
      case "24h":
        startDate = new Date(now - 24 * 60 * 60 * 1000);
        break;
      case "7d":
        startDate = new Date(now - 7 * 24 * 60 * 60 * 1000);
        break;
      case "30d":
        startDate = new Date(now - 30 * 24 * 60 * 60 * 1000);
        break;
      default:
        startDate = new Date(now - 24 * 60 * 60 * 1000);
    }

    const stats = await SensorReading.aggregate([
      {
        $match: {
          device_id,
          received_at: { $gte: startDate },
        },
      },
      {
        $group: {
          _id: null,
          temp_min: { $min: "$temperature_celsius" },
          temp_max: { $max: "$temperature_celsius" },
          temp_avg: { $avg: "$temperature_celsius" },
          humid_min: { $min: "$humidity_percent" },
          humid_max: { $max: "$humidity_percent" },
          humid_avg: { $avg: "$humidity_percent" },
          rssi_min: { $min: "$rssi" },
          rssi_max: { $max: "$rssi" },
          rssi_avg: { $avg: "$rssi" },
          snr_min: { $min: "$snr" },
          snr_max: { $max: "$snr" },
          snr_avg: { $avg: "$snr" },
          packet_count: { $sum: 1 },
        },
      },
    ]);

    if (stats.length === 0) {
      return res.status(404).json({ error: "Nenhum dado encontrado" });
    }

    const data = stats[0];

    // Calcular taxa de sucesso
    const expectedPackets = Math.floor((now - startDate) / (2 * 60 * 1000));
    const successRate =
      expectedPackets > 0
        ? ((data.packet_count / expectedPackets) * 100).toFixed(2)
        : 0;

    res.json({
      period,
      temperature: {
        min: data.temp_min.toFixed(2),
        max: data.temp_max.toFixed(2),
        avg: data.temp_avg.toFixed(2),
      },
      humidity: {
        min: data.humid_min.toFixed(1),
        max: data.humid_max.toFixed(1),
        avg: data.humid_avg.toFixed(1),
      },
      rssi: {
        min: data.rssi_min,
        max: data.rssi_max,
        avg: data.rssi_avg.toFixed(1),
      },
      snr: {
        min: data.snr_min,
        max: data.snr_max,
        avg: data.snr_avg.toFixed(1),
      },
      packet_count: data.packet_count,
      success_rate: parseFloat(successRate),
    });
  } catch (err) {
    logger.error("❌ Erro em /api/sensor/statistics", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

// ===== ENDPOINT: Obter qualidade do sinal =====
app.get("/api/sensor/quality", async (req, res) => {
  try {
    const { device_id, limit = 100 } = req.query;

    if (!device_id) {
      return res.status(400).json({ error: "device_id é obrigatório" });
    }

    const readings = await SensorReading.find({ device_id })
      .sort({ received_at: -1 })
      .limit(parseInt(limit))
      .lean();

    if (readings.length === 0) {
      return res.status(404).json({ error: "Nenhuma leitura encontrada" });
    }

    const rssiValues = readings.map((r) => r.rssi);
    const avgRssi = rssiValues.reduce((a, b) => a + b, 0) / rssiValues.length;

    let quality = "poor";
    if (avgRssi > -70) quality = "excellent";
    else if (avgRssi > -80) quality = "good";
    else if (avgRssi > -90) quality = "fair";

    const signalStrength = {
      excellent: rssiValues.filter((r) => r > -70).length,
      good: rssiValues.filter((r) => r > -80 && r <= -70).length,
      fair: rssiValues.filter((r) => r > -90 && r <= -80).length,
      poor: rssiValues.filter((r) => r <= -90).length,
    };

    res.json({
      current_rssi: rssiValues[0],
      avg_rssi: avgRssi.toFixed(1),
      quality,
      signal_strength: signalStrength,
      total_readings: readings.length,
    });
  } catch (err) {
    logger.error("❌ Erro em /api/sensor/quality", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

// ===== HEALTH CHECK =====
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok", timestamp: new Date() });
});

// ===== INICIAR SERVIDOR =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  logger.info(`🚀 Servidor iniciado na porta ${PORT}`);
});
