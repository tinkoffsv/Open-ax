/**
 * Technology catalog: what the scan recognizes and which signals reveal it.
 *
 * This is data, not logic. Adding a technology is one entry. Patterns are matched as follows:
 * - `deps`: normalized dependency names from any manifest (lowercase, `_` → `-`, no extras/versions)
 * - `env`: environment variable names (never values)
 * - `images`: compose service names and images
 * - `paths`: repository-relative file paths
 * - `source`: an extended regex for `git grep -i` over source code. Avoid `\b`, which not every
 *   platform's regex engine supports.
 */

import type { Category } from "./types.js";

export type Mechanism =
  | "authentication"
  | "payments"
  | "notifications"
  | "generation"
  | "caching"
  | "background processing"
  | "persistence";

/** Techs sharing a purpose; two detected in the same purpose raise a candidate. */
export type Purpose =
  | "sql"
  | "key-value"
  | "document"
  | "object-storage"
  | "background-jobs"
  | "scheduler"
  | "message-broker"
  | "http-client"
  | "llm"
  | "email"
  | "payments"
  | "messaging";

export interface Signals {
  deps?: RegExp[];
  env?: RegExp[];
  images?: RegExp[];
  paths?: RegExp[];
  source?: string;
}

export interface Tech {
  id: string;
  name: string;
  category: Category;
  detail?: string;
  purpose?: Purpose;
  mechanism?: Mechanism;
  /** Words that identify modules dedicated to this tech (for duplicate-module candidates). */
  keywords?: string[];
  signals: Signals;
}

export const CATALOG: Tech[] = [
  // --- frameworks (components) ---
  { id: "flask", name: "Flask", category: "component", detail: "backend framework",
    signals: { deps: [/^flask$/], source: "(from|import) +flask" } },
  { id: "fastapi", name: "FastAPI", category: "component", detail: "backend framework",
    signals: { deps: [/^fastapi$/], source: "(from|import) +fastapi" } },
  { id: "django", name: "Django", category: "component", detail: "backend framework",
    signals: { deps: [/^django$/], paths: [/(^|\/)manage\.py$/], source: "(from|import) +django" } },
  { id: "express", name: "Express", category: "component", detail: "backend framework",
    signals: { deps: [/^express$/], source: "require\\(['\"]express['\"]\\)|from +['\"]express['\"]" } },
  { id: "nestjs", name: "NestJS", category: "component", detail: "backend framework",
    signals: { deps: [/^@nestjs\/core$/] } },
  { id: "react", name: "React", category: "component", detail: "frontend framework",
    signals: { deps: [/^react$/] } },
  { id: "vue", name: "Vue", category: "component", detail: "frontend framework",
    signals: { deps: [/^vue$/] } },
  { id: "nextjs", name: "Next.js", category: "component", detail: "full-stack framework",
    signals: { deps: [/^next$/], paths: [/(^|\/)next\.config\.(js|mjs|ts)$/] } },
  { id: "nginx", name: "nginx", category: "component", detail: "reverse proxy",
    signals: { images: [/nginx/], paths: [/(^|\/)nginx[^/]*\.conf$/] } },
  { id: "caddy", name: "Caddy", category: "component", detail: "reverse proxy",
    signals: { images: [/caddy/], paths: [/(^|\/)Caddyfile$/] } },
  { id: "traefik", name: "Traefik", category: "component", detail: "reverse proxy",
    signals: { images: [/traefik/] } },

  // --- data stores ---
  { id: "postgresql", name: "PostgreSQL", category: "datastore", purpose: "sql", mechanism: "persistence",
    signals: {
      deps: [/^psycopg2(-binary)?$/, /^psycopg$/, /^asyncpg$/, /^pg$/, /^postgres$/, /^geoalchemy2$/, /github\.com\/(lib\/pq|jackc\/pgx)/],
      images: [/postgres|postgis/],
      source: "postgres(ql)?(\\+[a-z0-9]+)?://|import +psycopg|from +psycopg|asyncpg",
    } },
  { id: "mysql", name: "MySQL", category: "datastore", purpose: "sql", mechanism: "persistence",
    signals: { deps: [/^mysqlclient$/, /^pymysql$/, /^mysql2?$/, /go-sql-driver\/mysql/], images: [/mysql|mariadb/],
      source: "mysql(\\+[a-z0-9]+)?://|import +pymysql|require\\(['\"]mysql2?['\"]\\)" } },
  { id: "sqlite", name: "SQLite", category: "datastore", purpose: "sql", mechanism: "persistence",
    signals: { deps: [/^better-sqlite3$/, /^sqlite3$/], source: "sqlite(3)?://|import +sqlite3" } },
  { id: "redis", name: "Redis", category: "datastore", purpose: "key-value",
    signals: { deps: [/^redis$/, /^ioredis$/, /^aioredis$/, /go-redis/], env: [/^REDIS_/], images: [/redis/],
      source: "import +redis|from +redis|require\\(['\"]ioredis['\"]\\)|from +['\"]ioredis['\"]|redis://" } },
  { id: "mongodb", name: "MongoDB", category: "datastore", purpose: "document", mechanism: "persistence",
    signals: { deps: [/^pymongo$/, /^motor$/, /^mongoose$/, /^mongodb$/], env: [/^MONGO/], images: [/mongo/],
      source: "import +pymongo|from +pymongo|mongoose|mongodb(\\+srv)?://" } },
  { id: "s3", name: "S3-compatible storage", category: "datastore", purpose: "object-storage",
    signals: { deps: [/^boto3$/, /^@aws-sdk\/client-s3$/, /^minio$/], env: [/^(AWS_S3|S3)_/, /^MINIO_/], images: [/minio/],
      source: "boto3\\.(client|resource)\\(['\"]s3|S3Client|import +minio" } },

  // --- execution mechanisms ---
  { id: "celery", name: "Celery", category: "execution", purpose: "background-jobs", mechanism: "background processing",
    signals: { deps: [/^celery$/], env: [/^CELERY_/], source: "(from|import) +celery" } },
  { id: "celery-beat", name: "Celery beat", category: "execution", purpose: "scheduler", mechanism: "background processing",
    signals: { images: [/beat/], source: "beat_schedule|celery +beat|crontab\\(" } },
  { id: "rq", name: "RQ", category: "execution", purpose: "background-jobs", mechanism: "background processing",
    signals: { deps: [/^rq$/], source: "from +rq +import|import +rq" } },
  { id: "dramatiq", name: "Dramatiq", category: "execution", purpose: "background-jobs", mechanism: "background processing",
    signals: { deps: [/^dramatiq$/], source: "import +dramatiq" } },
  { id: "bullmq", name: "BullMQ", category: "execution", purpose: "background-jobs", mechanism: "background processing",
    signals: { deps: [/^bullmq$/, /^bull$/], source: "from +['\"]bullmq['\"]|require\\(['\"]bullmq['\"]\\)" } },
  { id: "kafka", name: "Kafka", category: "execution", purpose: "message-broker", mechanism: "background processing",
    signals: { deps: [/^kafka-python$/, /^confluent-kafka$/, /^aiokafka$/, /^kafkajs$/], env: [/^KAFKA_/], images: [/kafka/],
      source: "(from|import) +(kafka|confluent_kafka|aiokafka)|kafkajs" } },
  { id: "rabbitmq", name: "RabbitMQ", category: "execution", purpose: "message-broker", mechanism: "background processing",
    signals: { deps: [/^pika$/, /^aio-pika$/, /^amqplib$/], env: [/^(RABBITMQ|AMQP)_/], images: [/rabbitmq/],
      source: "import +pika|aio_pika|amqplib|amqps?://" } },
  { id: "cron", name: "cron", category: "execution", purpose: "scheduler", mechanism: "background processing",
    signals: { deps: [/^node-cron$/, /^cron$/, /^python-crontab$/], paths: [/(^|\/)crontab$/, /\.cron$/], images: [/cron/] } },
  { id: "apscheduler", name: "APScheduler", category: "execution", purpose: "scheduler", mechanism: "background processing",
    signals: { deps: [/^apscheduler$/], source: "(from|import) +apscheduler" } },
  { id: "polling-worker", name: "Polling worker loop", category: "execution", purpose: "background-jobs",
    mechanism: "background processing", detail: "long-running loop with sleep",
    signals: {} }, // detected in code by sources.ts: a loop with sleep in a worker file

  // --- integrations ---
  { id: "stripe", name: "Stripe", category: "integration", purpose: "payments", mechanism: "payments", keywords: ["stripe"],
    signals: { deps: [/^stripe$/], env: [/^STRIPE_/], source: "import +stripe|require\\(['\"]stripe['\"]\\)|from +['\"]stripe['\"]" } },
  { id: "robokassa", name: "Robokassa", category: "integration", purpose: "payments", mechanism: "payments", keywords: ["robokassa"],
    signals: { deps: [/robokassa/], env: [/^ROBOKASSA_/], source: "robokassa" } },
  { id: "yookassa", name: "YooKassa", category: "integration", purpose: "payments", mechanism: "payments", keywords: ["yookassa"],
    signals: { deps: [/^yookassa$/, /^@a2seven\/yoo-checkout$/], env: [/^YOOKASSA_/, /^YOOKASSA/], source: "yookassa" } },
  { id: "paypal", name: "PayPal", category: "integration", purpose: "payments", mechanism: "payments", keywords: ["paypal"],
    signals: { deps: [/paypal/], env: [/^PAYPAL_/], source: "paypal" } },
  { id: "telegram", name: "Telegram", category: "integration", purpose: "messaging", mechanism: "notifications", keywords: ["telegram", "tg_bot"],
    signals: { deps: [/^python-telegram-bot$/, /^aiogram$/, /^pytelegrambotapi$/, /^telegraf$/, /^node-telegram-bot-api$/, /^grammy$/],
      env: [/^TELEGRAM_/, /^TG_/, /BOT_TOKEN$/], source: "api\\.telegram\\.org|(from|import) +(telegram|aiogram|telebot)|telegraf|grammy" } },
  { id: "sendgrid", name: "SendGrid", category: "integration", purpose: "email", mechanism: "notifications", keywords: ["sendgrid"],
    signals: { deps: [/^sendgrid$/, /^@sendgrid\/mail$/], env: [/^SENDGRID_/], source: "sendgrid" } },
  { id: "resend", name: "Resend", category: "integration", purpose: "email", mechanism: "notifications", keywords: ["resend"],
    signals: { deps: [/^resend$/], env: [/^RESEND_/], source: "import +resend|from +['\"]resend['\"]|resend\\.(emails|Emails)" } },
  { id: "smtp", name: "SMTP email", category: "integration", purpose: "email", mechanism: "notifications",
    signals: { deps: [/^nodemailer$/, /^flask-mail$/], env: [/^SMTP_/, /^MAIL_SERVER$/], source: "import +smtplib|nodemailer" } },
  { id: "openai", name: "OpenAI", category: "integration", purpose: "llm", mechanism: "generation", keywords: ["openai"],
    signals: { deps: [/^openai$/], env: [/^OPENAI_/], source: "(from|import) +openai|from +['\"]openai['\"]|api\\.openai\\.com" } },
  { id: "anthropic", name: "Anthropic", category: "integration", purpose: "llm", mechanism: "generation", keywords: ["anthropic", "claude"],
    signals: { deps: [/^anthropic$/, /^@anthropic-ai\/sdk$/], env: [/^ANTHROPIC_/], source: "(from|import) +anthropic|@anthropic-ai/sdk|api\\.anthropic\\.com" } },
  { id: "openrouter", name: "OpenRouter", category: "integration", purpose: "llm", mechanism: "generation", keywords: ["openrouter"],
    signals: { env: [/^OPENROUTER_/], source: "openrouter\\.ai" } },
  { id: "google-oauth", name: "Google OAuth", category: "integration", mechanism: "authentication", keywords: ["google_oauth", "google-oauth", "oauth"],
    signals: { deps: [/^passport-google-oauth20$/, /^google-auth(-oauthlib)?$/, /^authlib$/], env: [/^GOOGLE_(CLIENT|OAUTH)_/],
      source: "accounts\\.google\\.com|oauth2\\.googleapis\\.com|passport-google-oauth" } },

  // --- HTTP clients (purpose only; used for duplicate-client candidates) ---
  { id: "requests", name: "requests", category: "mechanism", detail: "HTTP client", purpose: "http-client",
    signals: { deps: [/^requests$/], source: "import +requests" } },
  { id: "httpx", name: "httpx", category: "mechanism", detail: "HTTP client", purpose: "http-client",
    signals: { deps: [/^httpx$/], source: "import +httpx" } },
  { id: "aiohttp", name: "aiohttp", category: "mechanism", detail: "HTTP client", purpose: "http-client",
    signals: { deps: [/^aiohttp$/], source: "import +aiohttp" } },
  { id: "axios", name: "axios", category: "mechanism", detail: "HTTP client", purpose: "http-client",
    signals: { deps: [/^axios$/], source: "from +['\"]axios['\"]|require\\(['\"]axios['\"]\\)" } },

  // --- technical mechanisms ---
  { id: "jwt", name: "JWT", category: "mechanism", detail: "authentication", mechanism: "authentication",
    signals: { deps: [/^flask-jwt-extended$/, /^pyjwt$/, /^python-jose$/, /^jsonwebtoken$/, /^jose$/, /^djangorestframework-simplejwt$/],
      env: [/^JWT_/], source: "jwt_required|create_access_token|jsonwebtoken|import +jwt" } },
  { id: "sessions", name: "Server-side sessions", category: "mechanism", detail: "authentication", mechanism: "authentication",
    signals: { deps: [/^express-session$/, /^flask-login$/, /^flask-session$/], source: "express-session|login_required|flask_login" } },
  { id: "sqlalchemy", name: "SQLAlchemy", category: "mechanism", detail: "ORM", mechanism: "persistence",
    signals: { deps: [/^sqlalchemy$/, /^flask-sqlalchemy$/], source: "(from|import) +(sqlalchemy|flask_sqlalchemy)" } },
  { id: "prisma", name: "Prisma", category: "mechanism", detail: "ORM", mechanism: "persistence",
    signals: { deps: [/^prisma$/, /^@prisma\/client$/], paths: [/(^|\/)schema\.prisma$/] } },
  { id: "cache-lib", name: "Application cache", category: "mechanism", detail: "caching", mechanism: "caching",
    signals: { deps: [/^flask-caching$/, /^cachetools$/, /^django-redis$/, /^node-cache$/, /^lru-cache$/],
      source: "lru_cache|@cache(d)?\\(|cachetools|flask_caching" } },
  { id: "rate-limit", name: "Rate limiting", category: "mechanism", detail: "request throttling",
    signals: { deps: [/^flask-limiter$/, /^express-rate-limit$/, /^slowapi$/], source: "flask_limiter|express-rate-limit|slowapi" } },
];

export function techById(id: string): Tech {
  const tech = CATALOG.find((t) => t.id === id);
  if (!tech) throw new Error(`unknown tech ${id}`);
  return tech;
}
