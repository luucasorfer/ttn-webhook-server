// npm install axios mongodb dotenv
require("dotenv").config();
const axios = require("axios");
const { MongoClient } = require("mongodb");

// Configurações
const JSONBIN_API_KEY =
  process.env.JSONBIN_API_KEY ||
  "$2a$10$jvW.NjFzRdaM.7FHGJ77w.bvxyCT6JHHFKIUnAu2t9oKDXOoO1Vgi";
const COLLECTION_ID = process.env.COLLECTION_ID || "68c4dae4ae596e708fecef02";
const MONGODB_URI =
  process.env.MONGODB_URI ||
  "mongodb+srv://luucasorfer:FAtXLL0OtYGK4sEt@lora-siot-data.ewg7i1n.mongodb.net/";
const DATABASE_NAME = process.env.DATABASE_NAME || "lora_siot";
const COLLECTION_NAME = process.env.COLLECTION_NAME || "sensores";

const BATCH_SIZE = 10; // tamanho do lote de bins

// Conecta ao MongoDB
async function connectMongo() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db(DATABASE_NAME);
  const collection = db.collection(COLLECTION_NAME);
  return { client, collection };
}

// Busca todos os bin IDs da coleção
async function fetchAllBinIds() {
  console.log("📦 Buscando todos os bin IDs da coleção...");
  try {
    const url = `https://api.jsonbin.io/v3/c/${COLLECTION_ID}/bins`;
    const response = await axios.get(url, {
      headers: { "X-Master-Key": JSONBIN_API_KEY },
    });
    const bins = response.data?.record || response.data?.records || [];
    const ids = bins.map((b) => b.id);
    console.log(`✅ Encontrados ${ids.length} bins`);
    return ids;
  } catch (err) {
    console.error("❌ Erro ao buscar bins:", err.message);
    return [];
  }
}

// Busca dados de um bin específico
async function fetchBinData(binId) {
  try {
    const url = `https://api.jsonbin.io/v3/b/${binId}/latest`;
    const response = await axios.get(url, {
      headers: { "X-Master-Key": JSONBIN_API_KEY },
    });
    return response.data.record;
  } catch (err) {
    console.error(`❌ Erro ao buscar bin ${binId}:`, err.message);
    return null;
  }
}

// Insere dados no MongoDB em lotes
async function insertData(collection, data) {
  if (!data || data.length === 0) return 0;
  try {
    const result = await collection.insertMany(data, { ordered: false });
    return result.insertedCount;
  } catch (err) {
    if (err.code === 11000) {
      console.log("⚠️ Alguns documentos já existiam (duplicados ignorados)");
      return 0;
    } else {
      console.error("❌ Erro ao inserir no MongoDB:", err.message);
      return 0;
    }
  }
}

// Função principal
async function migrate() {
  console.log("🚀 Iniciando migração JSONBin → MongoDB\n");

  const { client, collection } = await connectMongo();
  try {
    const binIds = await fetchAllBinIds();
    if (binIds.length === 0) {
      console.log("❌ Nenhum bin encontrado");
      return;
    }

    let totalDocs = 0;

    // Processar em lotes de BATCH_SIZE
    for (let i = 0; i < binIds.length; i += BATCH_SIZE) {
      const batchIds = binIds.slice(i, i + BATCH_SIZE);
      const batchData = [];

      for (let j = 0; j < batchIds.length; j++) {
        const binId = batchIds[j];
        process.stdout.write(
          `\r🌐 Processando bin ${i + j + 1}/${binIds.length}...`,
        );
        const data = await fetchBinData(binId);
        if (data) {
          if (Array.isArray(data)) batchData.push(...data);
          else batchData.push(data);
        }
        // Pequeno delay para não sobrecarregar a API
        await new Promise((r) => setTimeout(r, 50));
      }

      // Inserir lote no MongoDB
      const inserted = await insertData(collection, batchData);
      totalDocs += inserted;
      console.log(` | ✅ Inseridos ${inserted} documentos neste lote`);
    }

    console.log(
      `\n🎉 Migração concluída! Total de documentos inseridos: ${totalDocs}`,
    );
  } catch (err) {
    console.error("\n❌ Erro na migração:", err.message);
  } finally {
    await client.close();
  }
}

// Executar
migrate();
