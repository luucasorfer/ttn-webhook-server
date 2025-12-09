# **ttn-webhook-server: Enviando dados do TTN para MongoDB usando Render**

---

## **O que você vai precisar**

1. Conta no **The Things Network (TTN)**
2. Conta no **MongoDB Atlas**
3. Conta no **Render**
4. Conta no **GitHub**
5. Computador com **Node.js** instalado
6. Programa para testar requisições, como **Insomnia** ou **Postman**

---

## **Passo 1: Criar projeto Node.js**

1. Crie uma **pasta no seu computador**

   - Exemplo: `ttn-webhook-server`

2. Abra o terminal nessa pasta e rode:

```
npm init -y
```

> Cria o `package.json` com configurações básicas

3. Instale as dependências:

```
npm install express mongoose
```

---

## **Passo 2: Criar o servidor**

1. Crie um arquivo chamado **server.js**
2. Cole o código abaixo:

```js
import express from "express";
import mongoose from "mongoose";

const app = express();
app.use(express.json());

await mongoose.connect(process.env.MONGO_URI);

const Uplink = mongoose.model(
  "Uplink",
  new mongoose.Schema({
    deveui: String,
    timestamp: Date,
    payload: Object,
    full_payload: Object,
  }),
);

app.post("/ttn", async (req, res) => {
  try {
    const body = req.body;

    await Uplink.create({
      deveui: body.end_device_ids.device_id,
      timestamp: body.uplink_message.received_at,
      payload: body.uplink_message.decoded_payload,
      full_payload: body,
    });

    res.status(200).send("OK");
  } catch (err) {
    console.error(err);
    res.status(500).send("Erro");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server OK on port ${PORT}`));
```

> **Explicação:**
>
> - `/ttn` → endpoint que o TTN chamará
> - `Uplink.create` → salva os dados no MongoDB
> - `full_payload` → guarda o JSON completo do TTN

---

## **Passo 3: Criar repositório no GitHub**

1. Vá para **GitHub → New Repository**

![GitHub New Repo](https://i.imgur.com/yourimage1.png)

2. Nomeie como `ttn-webhook-server`
3. No terminal:

```bash
git init
git add .
git commit -m "Primeiro commit"
git branch -M main
git remote add origin <URL-do-repositorio>
git push -u origin main
```

> Substitua `<URL-do-repositorio>` pela URL do seu GitHub

---

## **Passo 4: Criar serviço no Render**

1. Acesse **render.com → New → Web Service**
2. Conecte ao GitHub e selecione o repositório

![Render New Service](https://i.imgur.com/yourimage2.png)

3. Preencha:

| Campo         | Valor              |
| ------------- | ------------------ |
| Name          | ttn-webhook-server |
| Runtime       | Node               |
| Branch        | main               |
| Build Command | npm install        |
| Start Command | node server.js     |
| Plan          | Free               |

4. Adicione **variáveis de ambiente**:

| Key         | Value                                                            |
| ----------- | ---------------------------------------------------------------- |
| `MONGO_URI` | `mongodb+srv://<usuario>:<senha>@cluster.mongodb.net/<database>` |

5. Clique em **Create Web Service**
6. Espere o deploy terminar → você terá uma URL do tipo:

```
https://ttn-webhook-server.onrender.com
```

---

## **Passo 5: Testar o servidor no Insomnia**

1. Abra Insomnia
2. Crie uma requisição **POST** para:

```
https://ttn-webhook-server.onrender.com/ttn
```

3. No corpo, selecione **JSON** e cole:

```json
{
  "end_device_ids": {
    "device_id": "teste"
  },
  "uplink_message": {
    "received_at": "2025-12-09T12:00:00Z",
    "decoded_payload": {
      "temperature": 25.3,
      "humidity": 60
    }
  }
}
```

4. Clique em **Send**
5. Verifique:

- Retorno: `200 OK`
- MongoDB Atlas → documento criado
- Render → logs mostram o POST recebido

---

## **Passo 6: Configurar Webhook no TTN**

1. TTN Console → Applications → sua aplicação → Integrations → Webhooks → Add Webhook → Custom

![TTN Webhook](https://i.imgur.com/yourimage3.png)

2. Preencha:

| Campo           | Valor                                         |
| --------------- | --------------------------------------------- |
| Webhook ID      | render-mongo                                  |
| Base URL        | `https://ttn-webhook-server.onrender.com/ttn` |
| Uplink messages | ✅ Ativo                                      |

3. Salve
4. Agora, qualquer uplink do dispositivo vai direto para o MongoDB

---

## **Passo 7: Atualizar servidor**

1. Faça mudanças no `server.js`
2. Commit e push para o GitHub:

```bash
git add .
git commit -m "Atualização"
git push origin main
```

3. Render faz deploy automático
4. Teste novamente no Insomnia ou TTN

---

## **Dicas importantes**

- Não compartilhe a MONGO_URI publicamente
- Teste primeiro no Insomnia antes de conectar ao TTN
- Use logs do Render para depurar erros
