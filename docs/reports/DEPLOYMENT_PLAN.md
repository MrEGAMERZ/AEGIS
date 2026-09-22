# AEGIS Cloud Deployment Architecture (Hugging Face Edition)

## Goal
Transition the AEGIS backend from a local laptop environment (`localhost:8000` -> local Ollama) to a stable, enterprise-grade cloud architecture using **Hugging Face Inference Endpoints**.

## Architecture Overview (The 3-Tier Enterprise Model)

```mermaid
flowchart TD
    A[AEGIS Chrome Extension\n(User's Browser)] -->|HTTPS + Gateway Password\nRedacted Payloads Only| B(API Gateway\nNode.js on Render/Railway)
    B -->|HF Bearer Auth\nOpenAI-compatible API| C{Hugging Face Dedicated GPU\nNvidia L4 / A10G}
    C -->|Qwen2.5-VL 7B| C
```

## Why Hugging Face is the Perfect Choice
Since you have credits, this is by far the best option for a hackathon:
1. **Real Enterprise Infrastructure:** You are deploying a dedicated GPU endpoint, exactly how real companies productionize open-weights models.
2. **OpenAI Compatible:** Hugging Face's `vLLM` endpoints natively accept the standard OpenAI chat format, which our Node.js gateway already speaks.
3. **Scale to Zero (Cost Control):** You can set HF endpoints to pause automatically when not in use so you don't burn credits while sleeping.

---

## The Execution Plan (Step-by-Step)

### Step 1: Spin up the GPU (Hugging Face)
1. Go to **Hugging Face > Inference Endpoints**.
2. Click **New Endpoint**.
3. Select Model: `Qwen/Qwen2.5-VL-7B-Instruct`.
4. Cloud & Region: Pick whatever is cheapest (e.g., AWS us-east).
5. Instance Type: Select a GPU with at least 16GB VRAM (Nvidia L4 or A10G).
6. **Important:** Under Advanced Configuration, set the container type to **vLLM** and ensure the task is "Text Generation / Chat".
7. Copy the **Endpoint URL** and your **HF Access Token**.

### Step 2: Secure the Gateway (Node.js)
Right now, `server/index.js` allows anyone to hit it. If we put it on the public internet, a bot could find it and drain your Hugging Face credits. 
*   **Action:** I will modify `server/index.js` to require a `GATEWAY_PASSWORD`. The Chrome extension will pass this password, and the Gateway will verify it before spending your HF credits.

### Step 3: Deploy the Gateway (Render/Railway/Fly.io)
1. Create a new Web Service on Render (linked to your GitHub repo).
2. Set the build command: `npm install` and start command: `node server/index.js`.
3. Add these Environment Variables:
   *   `UPSTREAM_BASE_URL` = `[YOUR_HUGGINGFACE_URL]/v1`
   *   `UPSTREAM_API_KEY` = `[YOUR_HUGGINGFACE_TOKEN]`
   *   `UPSTREAM_MODEL` = `Qwen/Qwen2.5-VL-7B-Instruct`
   *   `GATEWAY_PASSWORD` = `sih-hackathon-2026-secret`

### Step 4: Update the Chrome Extension
*   We will update `src/background/background.js` (or the settings page) to point to your new Render URL (`https://aegis-api.render.com`) and pass the `GATEWAY_PASSWORD` in the headers.

---

Are you ready to proceed? If so, **go ahead and start Step 1 on Hugging Face**, and tell me to implement Step 2 (securing the gateway) right now!
