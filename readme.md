# 🤖 Smart Code Reviewer

An AI-powered GitHub Pull Request review platform that automatically analyzes code for quality, security, architecture, and performance using multiple AI agents.

> Review code faster, catch issues earlier, and automate pull request feedback.

---

## ✨ Features

- 🔍 Automated GitHub Pull Request reviews
- 🤖 Multi-agent AI code analysis
- 🛡️ Dependency vulnerability scanning with OSV Scanner
- 🏗️ Architecture and design pattern analysis
- ⚡ Performance and optimization suggestions
- 📏 Code quality & best practice recommendations
- 💬 Automatic review comments on GitHub Pull Requests
- 🔄 GitHub Webhook integration
- 📊 Structured review reports

---

## 🏛️ Architecture

```text
GitHub
   │
   ▼
GitHub Webhook
   │
   ▼
FastAPI Backend
   │
   ▼
Celery + Redis
   │
   ▼
Repository Cloning
   │
   ├──────────────┐
   ▼              ▼
AI Agents     OSV Scanner
   │              │
   └──────┬───────┘
          ▼
 Review Aggregator
          │
          ▼
LLM Summary
          │
          ▼
GitHub Review Comment
```

---

## 🧠 AI Review Agents

The review pipeline consists of specialized AI agents responsible for different aspects of code analysis.

- Code Quality Agent
- Security Agent
- Architecture Agent
- Performance Agent
- Best Practices Agent
- Review Aggregator

Each agent focuses on a specific domain before producing a unified review.

---

## 🛡️ Security Analysis

Security checks include:

- Dependency vulnerability scanning using OSV Scanner
- Detection of insecure dependencies
- CVE reporting
- Upgrade recommendations
- AI-generated explanations of security findings

---

## 🛠️ Tech Stack

### Backend

- FastAPI
- Python
- Celery
- Redis
- LangGraph

### Frontend

- React
- TypeScript
- Tailwind CSS
- Vite

### Database

- PostgreSQL

### AI

- OpenAI
- LangGraph
- Multi-Agent Workflow

### DevOps

- Docker
- GitHub Actions
- GitHub Webhooks

---

## 📂 Project Structure

```text
smart-code-reviewer/

├── backend/
├── frontend/
├── worker/
├── ai-agents/
├── docs/
├── docker/
├── .github/
├── docker-compose.yml
└── README.md
```

---

## 🚀 Roadmap

- [ ] GitHub Authentication
- [ ] Repository Management
- [ ] GitHub Webhooks
- [ ] Repository Cloning
- [ ] Multi-Agent Review Pipeline
- [ ] OSV Security Scanner
- [ ] GitHub Review Comments
- [ ] Dashboard
- [ ] Review History
- [ ] CI/CD Pipeline
- [ ] Docker Deployment

---

## 🎯 Future Enhancements

- CodeQL integration
- Secret scanning
- Repository learning from previous PRs
- Custom review rules
- Team knowledge base
- Slack/Discord notifications
- Self-hosted LLM support

---

## 🤝 Contributing

Contributions are welcome!

Feel free to open an issue or submit a pull request.

---

## 📄 License

This project is licensed under the MIT License.