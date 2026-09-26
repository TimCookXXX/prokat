# prokat — Deployment Guide

> Целевая платформа: **Timeweb Cloud VPS** 1×5GHz / 1GB / 15GB. Один сервер,
> docker-compose (caddy + app + db + backup), Let's Encrypt автоматически.
>
> Гайд проверен пилотным деплоем (июль 2026, тогда домен был fuddly.ru).
> Шаги идут в правильном порядке — SSH-ключ и DNS раньше всего, т.к. у них
> внешние задержки. `example.ru` в примерах = твой домен (prokat.ru).

## 0. Pre-deploy smoke (на локальной машине)

Перед первым деплоем и перед каждым релизом:

1. `pnpm test` — зелёно (нужен локальный Postgres: `docker compose up -d db`)
2. `pnpm exec tsc --noEmit` — зелёно
3. `docker compose build app` — Docker-сборка локально проходит

Только после зелёного — деплой.

## 1. SSH-ключ (до создания VPS)

Timeweb привязывает ключ на этапе создания сервера, поэтому сначала ключ:

```bash
# Если ключа ещё нет:
ssh-keygen -t ed25519 -C "prokat-vps" -f ~/.ssh/id_ed25519
cat ~/.ssh/id_ed25519.pub
```

timeweb.cloud → Профиль → SSH-ключи → Добавить → вставить `.pub` целиком.

## 2. Создаём VPS на Timeweb

1. timeweb.cloud → Облачные серверы → Создать
2. Образ: **Ubuntu 24.04 LTS**
3. Тариф: **1×5GHz / 1GB / 15GB / 200 Мбит** (825 ₽/мес)
4. Сеть: IPv4 (+180 ₽/мес) + IPv6, **без приватной сети**
5. SSH-ключ: выбрать загруженный
6. Создать. Через ~60 секунд VPS готов; записать публичный IPv4.

## 3. DNS (сразу после создания VPS — пропагация идёт параллельно)

Если домен тоже на Timeweb — в том же кабинете, DNS-записи домена.
Существующие MX/TXT (почта) не трогать. Добавить:

- A-запись `@` (корень) → `<IPv4>`
- A-запись `www` → `<IPv4>`

Проверка с локальной машины (Timeweb пропагирует за 5–15 минут):

```bash
dig +short example.ru @1.1.1.1 && dig +short www.example.ru @1.1.1.1
# Оба должны вернуть <IPv4>
```

## 4. Базовая настройка сервера

Подключение: `ssh root@<IP>` (или Termius: Keychain → импорт приватного
ключа, Host → address/root/ключ).

### 4.1. Обновление, timezone, swap (обязательно!)

Без swap `next build` на 1GB RAM падает в OOM — это не опция, а обязательный шаг:

```bash
apt update && apt upgrade -y
timedatectl set-timezone Europe/Moscow

fallocate -l 2G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
free -h   # Swap: 2.0Gi
```

### 4.2. Firewall + fail2ban

```bash
apt install -y ufw fail2ban
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
systemctl enable --now fail2ban
```

### 4.3. Docker + compose plugin (официальный репозиторий)

В Ubuntu-репо устаревший docker.io без compose v2 — ставим из docker.com:

```bash
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  > /etc/apt/sources.list.d/docker.list
apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker
docker --version && docker compose version
```

### 4.4. Reboot (загрузить обновлённое ядро)

```bash
reboot
# Через ~60 сек переподключиться, проверить:
uname -r && docker ps && free -h
```

## 5. S3-buckets в Timeweb

Реальные параметры Timeweb S3 (проверено пилотом):

- Endpoint: `https://s3.twcstorage.ru` (общий для standard и cold)
- Регион: `ru-1`
- Имя бакета — UUID, генерируется Timeweb (не выбирается)
- Публичный URL — **path-style**: `https://s3.twcstorage.ru/<bucket-uuid>`

### 5.1. Бакет для картинок (Standard)

1. Timeweb → S3-хранилище → Создать → тип **Standard**, публичное чтение: да
2. Доступы → создать service-пользователя → записать access/secret
3. В `.env`:
   - `STORAGE_ENDPOINT=https://s3.twcstorage.ru`
   - `STORAGE_BUCKET=<bucket-uuid>`
   - `STORAGE_PUBLIC_BASE=https://s3.twcstorage.ru/<bucket-uuid>`

### 5.2. Бакет для бэкапов (Cold)

1. Создать → тип **Cold**
2. Lifecycle: удаление объектов старше 30 дней (если доступно в тарифе)
3. В `.env`: `BACKUP_S3_*` (endpoint тот же, bucket — UUID cold-бакета)

## 6. OAuth-приложения

Redirect URI **разные по механике** — Яндекс идёт через next-auth,
VK — через собственный PKCE-роут:

- Яндекс (oauth.yandex.ru): `https://example.ru/api/auth/callback/yandex`
- VK ID (id.vk.com): `https://example.ru/api/oauth/vk/callback` ← **не** `/api/auth/callback/vk`!

К существующему приложению можно просто добавить prod-URI рядом с
localhost-URI — отдельное приложение не обязательно. Изменения применяются
сразу, перезапуск не нужен.

### 6.1. Почта для регистрации по паролю

Ящик `noreply@<домен>` поднимается в Яндекс 360, в `.env` идут `SMTP_*` (все пять
или ни одной). **SPF и DKIM обязательны** — без них письма подтверждения уходят в
спам, и регистрация по почте перестаёт работать на практике, оставаясь «рабочей»
технически.

Без `SMTP_*` в проде форма входа по паролю остаётся, а регистрация и сброс скрыты:
завершить их без письма всё равно нельзя.

## 7. Деплой кода

```bash
cd /opt
git clone https://github.com/<you>/prokat.git prokat   # имя папки любое
cd prokat
```

### 7.1. Прод `.env`

Секреты сгенерировать на локалке:

```bash
openssl rand -base64 32                          # NEXTAUTH_SECRET
openssl rand -base64 24 | tr -d '/+=' | head -c 32   # DB_PASSWORD (без спецсимволов — попадает в URL)
openssl rand -hex 16                             # INDEXNOW_KEY
```

Шаблон рабочего прод `.env` (все переменные обязательны, кроме помеченных):

```bash
NODE_ENV=production

DOMAIN=example.ru
LETSENCRYPT_EMAIL=you@example.com
NEXTAUTH_URL=https://example.ru
NEXTAUTH_SECRET=<openssl rand -base64 32>
# Обязательно за reverse-proxy: без этого Auth.js режет все /api/auth/* (UntrustedHost)
AUTH_TRUST_HOST=true

DB_PASSWORD=<пароль>
# Хост db — имя сервиса в docker-compose, не localhost!
DATABASE_URL=postgres://app:<пароль>@db:5432/app

YANDEX_CLIENT_ID=...
YANDEX_CLIENT_SECRET=...
VK_CLIENT_ID=...
VK_CLIENT_SECRET=...

STORAGE_ENDPOINT=https://s3.twcstorage.ru
STORAGE_BUCKET=<bucket-uuid>
STORAGE_ACCESS_KEY_ID=...
STORAGE_SECRET_ACCESS_KEY=...
STORAGE_PUBLIC_BASE=https://s3.twcstorage.ru/<bucket-uuid>

BACKUP_S3_ENDPOINT=https://s3.twcstorage.ru
BACKUP_S3_BUCKET=<cold-bucket-uuid>
BACKUP_S3_ACCESS_KEY_ID=...
BACKUP_S3_SECRET_ACCESS_KEY=...

INDEXNOW_KEY=<openssl rand -hex 16>
YANDEX_METRIKA_ID=          # опционально, пусто = метрика выключена
```

```bash
chmod 600 .env
```

> `STORAGE_PUBLIC_BASE` используется дважды: в рантайме (ссылки на картинки)
> и **на этапе сборки** (allow-list хостов next/image). docker-compose
> прокидывает его в билд как build arg автоматически — просто заполни `.env`
> до первого `docker compose build`.

### 7.2. Первый запуск

Сначала — граф дорог для расстояний «до проката» (OSRM, ~2 минуты, данные
OpenStreetMap по Краснодару и Адыгее в `data/osrm/`):

```bash
bash scripts/osrm/prepare.sh
docker compose up -d --build
```

Без графа сайт работает, но считает расстояние по прямой × 1,3 — через Кубань
(Яблоновский, Новая Адыгея) это в разы меньше реального. Карту обновлять раз в
месяц: `bash scripts/osrm/prepare.sh && docker compose restart osrm`.

Первый билд на 1GB VPS — 10–15 минут. Дальше по кешу быстрее (~3–5 мин).

Миграции БД применяются **автоматически** при старте app-контейнера
(`scripts/entrypoint.sh`: `node migrate.cjs` → `node sync-catalog.cjs` → `node server.js`).
`sync-catalog.cjs` приводит справочник сравнения (Краснодар, категории, группы и классы)
к `src/lib/compare/catalog-data.ts` — идемпотентно, ничего не удаляет.
Запускать вручную ничего не нужно. В runner-образе нет pnpm/tsx —
`docker compose exec app pnpm ...` не сработает.

### 7.3. Проверки

```bash
docker compose ps        # все 4 сервиса Up, app и db — (healthy)
docker compose logs app --tail=20    # "Migrations applied" + "Ready in ..."
docker compose logs caddy | grep -i "certificate obtained"
# Ожидаемо две строки: для example.ru и www.example.ru (~30–60 сек после старта)
```

С локальной машины:

```bash
curl -I https://example.ru
# HTTP/2 200 + strict-transport-security + x-frame-options: DENY
```

В браузере (**в инкогнито** — обычная вкладка может держать кеш от локального
dev-стека и сыпать "Failed to find Server Action"):

- `/` открывается, обложки постов грузятся (это проверяет next/image + S3)
- Логин через Яндекс и VK проходит и возвращает на сайт
- Создание поста с картинкой — файл появляется в бакете
- Регистрация по почте: письмо приходит (проверить, что не в спаме), ссылка
  подтверждает аккаунт и логинит, повторный вход по паролю работает
- Сброс пароля: письмо приходит, новый пароль применяется, старая сессия
  в другом браузере перестаёт работать
- `@node-rs/argon2` — нативный модуль: убедиться, что контейнер стартует и
  регистрация внутри него проходит (трассировка standalone-сборки)

## 8. Post-deploy ручные шаги

### 8.1. IndexNow verification file

```bash
cd /opt/prokat
echo "<INDEXNOW_KEY>" > "public/<INDEXNOW_KEY>.txt"
docker compose up -d --build app
curl https://example.ru/<INDEXNOW_KEY>.txt   # вернёт ключ
```

(Файл коммитится в репо с локалки, на VPS только `git pull` — VPS-копия
репозитория read-only по договорённости.)

### 8.2. Yandex.Metrika

1. metrica.yandex.ru → создать счётчик → ID в `.env` (`YANDEX_METRIKA_ID=`)
2. `docker compose up -d --force-recreate app` (пересоздание, не restart!)
3. Network в DevTools: грузится `mc.yandex.ru/metrika/tag.js`

### 8.3. Yandex Webmaster / Google Search Console

1. Верификация HTML-файлом → файл в `public/` → redeploy
2. Submit sitemap: `https://example.ru/sitemap.xml`

### 8.4. UptimeRobot + Telegram

1. uptimerobot.com (free) → Add Monitor → HTTP(s) → `https://example.ru/api/health`,
   interval 5 min, alert after 2 failures
2. Telegram-алерт: бот у @BotFather → Alert Contact типа Webhook →
   URL `https://api.telegram.org/bot<TOKEN>/sendMessage`, POST JSON:
   `{"chat_id":"<CHAT_ID>","text":"*alertTypeFriendlyName* - *monitorFriendlyName*"}`

## 9. Регулярные операции

### Обновление кода

```bash
cd /opt/prokat
git pull
docker compose build app && docker compose up -d app
```

Миграции применятся сами при старте контейнера.

### Импорт цен прокатов (CSV)

Формат — `docs/inrenta-pivot/data/offers.template.csv`. Файл проверяется целиком:
при любой ошибке в базу не пишется ничего, ошибки печатаются со строкой файла.

```bash
docker compose cp offers.csv app:/tmp/offers.csv
docker compose exec app node import-offers.cjs /tmp/offers.csv --dry-run   # только счётчики
docker compose exec app node import-offers.cjs /tmp/offers.csv
```

Повторный импорт того же файла безопасен: прокат находится по названию и телефону,
предложение — по (прокат, класс, модель); цена с более старой датой проверки
не затирает более свежую.

### Изменение `.env`

`docker compose restart` **не перечитывает** env_file! Только пересоздание:

```bash
docker compose up -d --force-recreate app
```

Если менялся `STORAGE_PUBLIC_BASE` — нужен ещё и rebuild (он запечён в билд).

### Логи

```bash
docker compose logs -f --tail=200 app
docker compose logs -f --tail=200 caddy
docker compose logs backup --tail=50
```

### Бэкапы

Ежедневно ~03:00 MSK в cold-бакет `db/backup-YYYY-MM-DD-HHMM.sql.gz`.
Ручной прогон: `docker compose exec backup sh /backup.sh`.
Восстановление: [`docs/RECOVERY.md`](./RECOVERY.md).

## 10. Troubleshooting (реальные кейсы пилота)

| Симптом | Причина | Действие |
|---|---|---|
| `[auth][error] UntrustedHost` на все /api/auth/* | Нет `AUTH_TRUST_HOST=true` в `.env` | Добавить + `up -d --force-recreate app` |
| OAuth-редирект уводит на `http://<container-id>:3000` | Редиректы строились от `req.url` | Исправлено в коде (base = `NEXTAUTH_URL`); проверить, что `NEXTAUTH_URL` = публичный https-URL |
| Upload фото → 500, в логах `sharp ... ERR_DLOPEN_FAILED libvips` | Версия sharp в package.json ≠ версии, которую Next несёт как optional dep → standalone-трейс не кладёт libvips | Держать sharp той же minor-версии, что у Next (см. `pnpm why sharp`); `.npmrc` с `node-linker=hoisted` — в репо |
| Обложка `/_next/image?url=...` → 400, но `<img>` в посте работает | `STORAGE_PUBLIC_BASE` не был доступен при сборке → S3-хост не в remotePatterns | Заполнить `.env` до сборки; compose прокидывает build arg сам |
| `app` контейнер `unhealthy`, но сайт работает | Next standalone биндился на `$HOSTNAME` (= container ID), healthcheck по localhost не проходил | Исправлено: `ENV HOSTNAME=0.0.0.0` в Dockerfile |
| Поменял `.env`, но ничего не изменилось | `restart` не перечитывает env_file | `up -d --force-recreate app` |
| `acme: error` в Caddy | DNS ещё не указывает на VPS / 80,443 закрыты | `dig +short example.ru @1.1.1.1`; `ufw status` |
| `Failed to find Server Action` в браузере | Кеш вкладки от другого билда/стека | Инкогнито или hard reload |
| Бэкап падает `Unable to locate credentials` | AWS_* не экспортированы в сессии | Уже самодостаточно в `scripts/backup.sh`; проверить `BACKUP_S3_*` в `.env` |
| `pnpm build` OOM на VPS | Нет swap | §4.1 — swap обязателен |

## 11. Восстановление из бэкапа

См. отдельный документ: [`docs/RECOVERY.md`](./RECOVERY.md).
