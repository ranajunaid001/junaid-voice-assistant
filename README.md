# 🇵🇰 AI Assistant for your portfolio.

AI-powered voice agent for registering government complaints in Urdu, Punjabi, and Saraiki.

## 🌟 Features

- 🎤 Voice-based complaint registration
- 🌐 Multi-language support (Urdu, Punjabi, Saraiki)
- 🏢 Automatic department routing based on location
- 🎫 Automatic ticket generation
- 📱 Mobile-friendly interface

## 🚀 Live Demo

[View Live Demo](https://your-app.up.railway.app)

## 🛠️ Tech Stack

- **Frontend:** HTML, CSS, JavaScript
- **Backend:** Node.js, Express.js
- **AI Assistant:** Uplift AI Voice Assistant
- **Deployment:** Railway

## 📋 Prerequisites

- Node.js (v18 or higher)
- npm or yarn
- Uplift AI account
- Railway account (for deployment)

## ⚙️ Installation

1. Clone the repository:
```bash
git clone https://github.com/YOUR_USERNAME/pakistan-complaint-system.git
cd pakistan-complaint-system
```

2. Install dependencies:
```bash
npm install
```

3. Create `.env` file and add your credentials:
```env
UPLIFT_API_KEY=your_uplift_api_key
UPLIFT_ASSISTANT_ID=your_assistant_id
PORT=3000
NODE_ENV=development
```

4. Run the development server:
```bash
npm start
```

5. Open http://localhost:3000 in your browser

## 🏗️ Project Structure

```
pakistan-complaint-system/
├── public/
│   └── index.html          # Main HTML interface
├── server.js              # Express server
├── package.json           # Dependencies
├── .env                   # Environment variables (not in git)
├── .gitignore            # Git ignore file
└── README.md             # Documentation
```

## 🚢 Deployment to Railway

1. Push code to GitHub
2. Connect GitHub repo to Railway
3. Add environment variables in Railway dashboard
4. Deploy automatically

## 🏛️ Supported Government Departments

### Electricity
- LESCO (Lahore)
- GEPCO (Gujranwala)
- FESCO (Faisalabad)
- IESCO (Islamabad/Rawalpindi)
- MEPCO (Multan)
- PESCO (Peshawar)
- K-Electric (Karachi)
- QESCO (Quetta)
- SEPCO (Sukkur)
- HESCO (Hyderabad)

### Water & Sanitation
- WASA (Various cities)
- KWSB (Karachi)
- CDA Water (Islamabad)

### Gas
- SNGPL (Punjab, KPK)
- SSGC (Sindh, Balochistan)

### Other Services
- Police (15)
- Rescue (1122)
- Health Department
- Road Infrastructure
- Garbage Collection

## 📱 How It Works

1. User clicks "Start Voice Assistant"
2. Opens Uplift AI assistant in new tab
3. User speaks complaint in Urdu/Punjabi/Saraiki
4. AI identifies department based on location
5. Generates ticket number
6. Complaint forwarded to relevant department

## 🔧 API Endpoints

- `GET /` - Main application
- `GET /api/health` - Health check
- `GET /api/config` - Assistant configuration
- `POST /api/complaints` - Submit complaint (future)

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📄 License

MIT License

## 👨‍💻 Author

Your Name

## 🙏 Acknowledgments

- Uplift AI for voice technology
- Railway for hosting
- Pakistan government departments

## 📞 Support

For issues or questions, please open an issue on GitHub.
