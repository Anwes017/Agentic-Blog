# Agentic Blog

Agentic Blog is a React + FastAPI + LangGraph app for generating technical blogs, editing the markdown, exporting in multiple formats, and sharing drafts to Gmail or Slack.

## Features

- Generate blogs with an agentic planning and writing flow
- Stream live progress while the blog is being built
- Edit the generated markdown in a split preview
- Regenerate individual sections
- Export as Markdown, HTML, DOCX, PDF, or ZIP
- Save blog state in SQLite
- Share the draft to Gmail or Slack through local MCP servers

## Tech Stack

- Frontend: React, Vite
- Backend: FastAPI
- Agent core: LangGraph
- Storage: SQLite
- Sharing: FastMCP + MCP client

## Project Structure

```text
Agentic Blog/
  api_server.py
  bwa_backend/
  frontend/
  mcp_servers/
  outputs/
  blog_agent.db
  requirements.txt
  .env
```

## Setup

### 1. Create and activate the virtual environment

```bash
cd "/Users/anwes/Desktop/Blog Agent"
source .venv/bin/activate
```

### 2. Install Python dependencies

```bash
python -m pip install -r requirements.txt
```

### 3. Install frontend dependencies

```bash
cd frontend
npm install
```

## Environment Variables

Put your keys in `.env` in the project root.

```env
GOOGLE_API_KEY=your_google_ai_studio_key
TAVILY_API_KEY=your_tavily_key

GMAIL_USERNAME=your_gmail@gmail.com
GMAIL_APP_PASSWORD=your_gmail_app_password
GMAIL_TO=recipient@gmail.com
GMAIL_FROM=your_gmail@gmail.com
GMAIL_SMTP_HOST=smtp.gmail.com
GMAIL_SMTP_PORT=587

SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
# or
SLACK_BOT_TOKEN=xoxb-...
SLACK_CHANNEL=#general
```

Notes:
- `GOOGLE_API_KEY` is used by Gemini for writing and image generation.
- `TAVILY_API_KEY` is optional unless you want web research.
- For Gmail, use a Google app password.
- For Slack, you can use either an incoming webhook or a bot token.

## Run the App

Open two terminals.

### Terminal 1: Backend

```bash
cd "/Users/anwes/Desktop/Blog Agent"
source .venv/bin/activate
python -m uvicorn api_server:api --reload --port 8000
```

### Terminal 2: Frontend

```bash
cd "/Users/anwes/Desktop/Blog Agent/frontend"
npm run dev
```

Open:

```text
http://localhost:5173
```

## What Happens When You Generate

- The router decides whether research is needed
- The planner creates the blog outline
- Workers write each section
- The reducer merges the final markdown and images
- The result is saved under `outputs/<blog_title>/`
- Blog metadata is saved in SQLite

## Output Format

Each blog is saved like this:

```text
outputs/
  my_blog_title/
    blog.md
    images/
      image_1.png
```

## Sharing

After generating a blog, use the Share menu in the UI:

- Gmail sends a polished HTML email
- Slack sends a compact summary message

## GitHub

If you want to publish the repo:

```bash
git add README.md
git commit -m "add README"
git push
```

