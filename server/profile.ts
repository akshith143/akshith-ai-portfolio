// The single source of truth for what the AI twin knows. Everything it says
// about Akshith must be derivable from this file (plus live GitHub data).
// Edit freely — the system prompt is rebuilt from it at startup.

export const profile = {
  name: "Satya Akshith Pakalapati",
  shortName: "Akshith",
  headline: "Full Stack Software Engineer · Node.js · Angular · TypeScript · MySQL · Fintech",
  location: "Pune, India",
  targetRole: "Software engineering roles — backend or full stack (open to any software engineering role)",
  // Spoken when a visitor starts a conversation. Canned (no model call) and cached as audio.
  greeting:
    "Hi, I'm Akshith's AI twin. I can tell you about my seven years building fintech and logistics systems, from credit-card repayments at OneCard to order pipelines at Udaan. What would you like to know?",
  contact: {
    email: "akshith.pakalapati@gmail.com",
    phone: "+91-9848174081",
    linkedin: "https://linkedin.com/in/akshith-pakalapati-993646108",
    github: "https://github.com/akshith143",
  },
  githubBio:
    "I build payment systems that stay fast under load. 10M+ txns/month at sub-200ms. Fintech backends in Node.js & Kotlin. Now going deep on LLMs.",

  summary:
    "Full Stack Software Engineer with 7 years of experience building fintech and logistics platforms with Node.js, Express.js, Angular, TypeScript and MySQL, plus Kotlin backend experience at Udaan. At OneCard I own credit-card and loan repayment services for 1M+ users, delivering REST APIs that handle 10M+ transactions a month at sub-200 ms response times under PCI-DSS.",

  skills: {
    Languages: ["JavaScript (ES6+)", "TypeScript", "Java", "Kotlin", "Python", "SQL"],
    Backend: [
      "Node.js", "Express.js", "RESTful API design", "Microservices",
      "Passport.js authentication", "AWS Cognito SSO", "API security",
      "Asynchronous processing", "Background jobs",
    ],
    Frontend: ["Angular", "HTML5", "CSS3", "Bootstrap", "Responsive design"],
    "Databases & caching": [
      "MySQL", "MongoDB", "Redis", "Schema design", "Indexing", "Query optimization",
    ],
    "Cloud & DevOps": ["AWS", "GCP", "Docker", "CI/CD", "Git"],
    "AI tools": ["Claude Code", "Claude", "ChatGPT", "Kiro (AI-assisted coding, debugging, code review)"],
    Architecture: [
      "System design", "Scalability", "High availability", "Caching strategies",
      "Load balancing", "Performance tuning",
    ],
    Domain: [
      "Fintech (credit cards, loan repayments, payment integrations)",
      "PCI-DSS compliance", "Logistics", "B2B e-commerce",
    ],
  },

  experience: [
    {
      company: "FPL Technologies (OneCard)",
      role: "Software Development Engineer",
      period: "Jan 2023 – Present",
      highlights: [
        "Own end-to-end development of credit-card and loan repayment features (Node.js/Express.js services, Angular front end, MySQL) for a customer base of 1M+ users.",
        "Designed and built secure REST APIs processing 10M+ transactions per month, keeping response times under 200 ms during peak billing cycles.",
        "Integrated 5+ third-party payment and financial service APIs, replacing manual workflows and reducing manual processing effort by 40%.",
        "Improved application performance by 30% by indexing and rewriting slow MySQL queries, adding Redis caching for frequently accessed data, and moving non-critical work to asynchronous processing.",
        "Implemented API security controls — Passport.js authentication, AWS Cognito-based SSO, authorization and input validation — to keep services compliant with PCI-DSS and data protection standards.",
        "Work with product, design and QA teams to turn requirements into technical designs and releases.",
      ],
    },
    {
      company: "Udaan",
      role: "Application Developer",
      period: "Nov 2021 – Dec 2022",
      highlights: [
        "Built backend services and REST APIs in Kotlin and MySQL for B2B order and shipment workflows processing 500K+ orders per day.",
        "Reworked background batch jobs for order processing, reducing batch processing time by 35%.",
        "Refactored legacy microservices and their data-access layers, reducing API latency by 25% and improving service reliability.",
      ],
    },
    {
      company: "Codeaxes",
      role: "Senior Software Developer",
      period: "Jun 2021 – Oct 2021",
      highlights: [
        "Led delivery of client-facing web features, improving page load time by 20%, and ran code reviews that reduced production defects by 30%.",
      ],
    },
    {
      company: "Cargo Exchange India Private Limited",
      role: "MEAN Stack Developer",
      period: "Jun 2019 – May 2021",
      highlights: [
        "Built logistics web applications with Angular, Node.js/Express.js, MongoDB and MySQL, used by 10K+ monthly active users.",
        "Designed normalized database schemas and REST APIs, improving data retrieval performance by 40%.",
        "Optimized front-end rendering and API data flows, reducing average page load time by 35%.",
        "Also completed a software development internship at the company on its AgriTrade platform.",
      ],
    },
  ],

  projects: [
    {
      name: "Target Brazil E-commerce — SQL Business Case",
      kind: "SQL case study",
      summary:
        "End-to-end SQL analysis of 100K Target orders in Brazil (2016–2018) across 8 tables — orders, customers, sellers, items, payments, reviews, products and geolocation — turned into insights and business recommendations.",
      findings: [
        "Written entirely in SQL on BigQuery: CTEs, multi-table joins, date arithmetic, CASE bucketing and window functions (RANK) for top/bottom-5 state rankings.",
        "Order value (payments) grew about 137% from Jan–Aug 2017 to Jan–Aug 2018; orders grew from 329 in 2016 to 45,101 in 2017 and 54,011 in 2018.",
        "Most orders are placed in the afternoon (13–18h, ~38K), then night; São Paulo (SP) has by far the most customers (~41.7K).",
        "Delivery: SP averages ~8 days vs ~29 days in Roraima (RR); SP also has the lowest average freight, while northern states (RR, PB, RO, AC, PI) pay the most.",
        "Payments: credit card dominates; ~49K orders were paid in a single installment.",
        "Recommendations covered regional logistics hubs, realistic delivery estimates, peak-hour campaigns, and EMI/no-cost-installment offers.",
      ],
      stack: ["SQL", "BigQuery", "CTEs", "Window functions", "Joins & aggregation"],
      file: "case-studies/target-sql-business-case.pdf",
    },
    {
      name: "FinanceAI — Personal Finance Manager",
      kind: "Personal project",
      summary:
        "Full-stack personal finance app with AI/ML-powered spend analysis: spend forecasting (linear regression + seasonal decomposition), z-score anomaly detection, TF-IDF transaction categorisation, and a Claude-powered chat assistant with live financial context.",
      stack: ["React 18", "Node.js", "Express", "MySQL 8", "Claude API", "Recharts"],
    },
    {
      name: "Graduate Admission Prediction (Jamboree case study)",
      kind: "M.Sc. AI/ML coursework",
      summary:
        "Regression study of the factors driving graduate admission chances: EDA, multicollinearity checks, linear regression assumption testing, and Ridge/Lasso regularisation, ending in business recommendations.",
      stack: ["Python", "pandas", "scikit-learn", "statsmodels"],
    },
    {
      name: "This AI portfolio",
      kind: "Personal project",
      summary:
        "The voice-interactive site the visitor is using right now: browser speech recognition → streamed Claude responses over SSE → sentence-level pipelining into a cloned-voice TTS stream played through Web Audio, with an audio-driven avatar. Built for low time-to-first-word.",
      stack: ["TypeScript", "Node.js", "Express", "Claude API", "ElevenLabs", "Web Audio", "Three.js", "Vite"],
    },
  ],

  education: [
    {
      degree: "M.Sc., Artificial Intelligence & Machine Learning (online, part-time)",
      school: "Woolf University, through Scaler Neovarsity",
      period: "Expected 2027",
    },
    { degree: "B.Tech., Computer Science", school: "Aditya Engineering College", period: "2019" },
  ],

  fellowships: [
    {
      title: "University Innovation Fellow",
      org: "Hasso Plattner Institute of Design (d.school), Stanford University",
      period: "2017 – 2018",
      detail:
        "Ran design-thinking workshops and hackathons for 100+ students across branches; visited Stanford and Google HQ, Mountain View, CA.",
    },
  ],

  certifications: [
    {
      title: "Skill Mastery Certification — SQL",
      issuer: "Scaler, with NSDC (National Skill Development Corporation)",
      detail: "Mastered and cleared Scaler's SQL skill assessment.",
      image: "certs/scaler-sql.jpg",
    },
  ],

  languages: ["English", "Telugu", "Hindi"],

  hobbies: ["Playing badminton", "Binge-watching anime and series", "Reading, sometimes"],

  // Talking points for common recruiter questions. Keep them true.
  pitch: [
    "Seven years shipping production systems, the last three-plus owning money-moving fintech services where correctness, latency and compliance all matter at once.",
    "Comfortable across the stack — Node.js/Express and Kotlin services, MySQL/MongoDB/Redis, Angular front ends — and across the lifecycle from design to production support.",
    "Track record of measurable performance work: 30% app performance gain at OneCard, 25% API latency cut and 35% faster batch jobs at Udaan, 40% faster data retrieval at Cargo Exchange.",
    "Actively building with LLMs — an M.Sc. in AI/ML plus hands-on Claude integrations with real guardrails (FinanceAI and this site).",
  ],
} as const;

export type Profile = typeof profile;
